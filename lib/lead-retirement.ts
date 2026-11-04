/**
 * Permanent lead retirements. Only the caller's successful Publication CAS can
 * activate an index. Preparing shards never changes a current/backup pointer.
 * Old shards and unreferenced prepared shards are safe to retain indefinitely.
 */
export type RetirementIndex = {
  schema: 1;
  /** Number of distinct identity hashes, not the number of articles. */
  count: number;
  buckets: Record<string, string>;
};

export type StoryIdentity = {idKey: string; articleKey: string};
export type RetirementStorage = Pick<R2Bucket, 'get' | 'put'>;
type Storage = RetirementStorage;
type Shard = {schema: 1; bucket: string; keys: string[]};

export const RETIREMENT_LIMITS = Object.freeze({
  buckets: 256,
  keysPerBucket: 4096,
  objectBytes: 512 * 1024,
  requestedKeys: 128,
  concurrency: 4,
});
export const RETIREMENT_SHARD_PREFIX = 'publication/lead-retirements/v1/';
const HASH = /^[a-f0-9]{64}$/;
const PREFIX = /^[a-f0-9]{2}$/;
const encoder = new TextEncoder();
const trackingParameters = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'utm_id', 'utm_source_platform', 'utm_creative_format', 'utm_marketing_tactic',
  'gclid', 'dclid', 'fbclid', 'msclkid', 'twclid', 'ttclid', 'gbraid', 'wbraid',
  'mc_cid', 'mc_eid', '_ga', '_gl', 'igshid',
]);

function invalid(detail: string): never {
  throw new Error('Invalid lead retirement ledger: ' + detail);
}

function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactFields(value: Record<string, unknown>, fields: string[]): boolean {
  const own = Object.keys(value);
  return own.length === fields.length && fields.every(field => Object.hasOwn(value, field));
}

export function emptyIndex(): RetirementIndex {
  return {schema: 1, count: 0, buckets: {}};
}

/** Structural validation is synchronous; referenced shard bytes are verified on read. */
export function validateRetirementIndex(value: unknown): asserts value is RetirementIndex {
  if (!record(value) || !exactFields(value, ['schema', 'count', 'buckets']) || value.schema !== 1 ||
      !Number.isSafeInteger(value.count) || !record(value.buckets)) invalid('index shape');
  const count = value.count as number;
  const entries = Object.entries(value.buckets);
  if (entries.length > RETIREMENT_LIMITS.buckets || count < entries.length ||
      count > entries.length * RETIREMENT_LIMITS.keysPerBucket ||
      (entries.length === 0 && count !== 0)) invalid('index count or capacity');
  for (const [prefix, digest] of entries) {
    if (!PREFIX.test(prefix) || typeof digest !== 'string' || !HASH.test(digest)) invalid('index reference');
  }
}

function snapshotIndex(value: RetirementIndex): RetirementIndex {
  validateRetirementIndex(value);
  return {schema: 1, count: value.count, buckets: {...value.buckets}};
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Derive identity only from the server's HN link, never a page's canonical tag.
 * First-release identity v1 includes the user's approved equivalences: HTTP and
 * HTTPS, a single leading www label, and trailing path slashes identify the same
 * article. WHATWG URL parsing lowercases hosts and removes default ports.
 * Fragments and explicitly listed tracking parameters are ignored; query keys
 * are sorted stably, retaining repeated-value order and meaningful values.
 * Path case, internal slashes, encoded slashes, and other subdomains stay
 * distinct; standard WHATWG dot-segment resolution is retained. Repeated www
 * labels are preserved as unusual subdomains, rather
 * than stripping one on each call and making normalization non-idempotent.
 * Titles, page content, and page-provided canonical tags never merge identities.
 */
export function normalizeArticleUrl(value: string): string {
  if (typeof value !== 'string' || !value || value.length > 2500 ||
      value.trim() !== value || /[\x00-\x20\x7f\\]/.test(value)) invalid('article URL');
  let url: URL;
  try { url = new URL(value); } catch { invalid('article URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) invalid('article URL');
  url.protocol = 'https:';
  if (url.hostname.startsWith('www.') && !url.hostname.startsWith('www.www.')) url.hostname = url.hostname.slice(4);
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (trackingParameters.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.toString();
}

/** An article repost matches articleKey even though it has a new HN idKey. */
export async function storyIdentity(story: {id: number; url: string}): Promise<StoryIdentity> {
  if (!story || !Number.isSafeInteger(story.id) || story.id <= 0) invalid('HN story ID');
  const normalized = normalizeArticleUrl(story.url);
  const [idKey, articleKey] = await Promise.all([
    sha256('hn-id:v1:' + story.id),
    sha256('article-url:v1:' + normalized),
  ]);
  return {idKey, articleKey};
}

function requestedKeys(keys: readonly string[]): string[] {
  if (!Array.isArray(keys) || keys.length > RETIREMENT_LIMITS.requestedKeys) invalid('requested key limit');
  for (const key of keys) if (typeof key !== 'string' || !HASH.test(key)) invalid('identity hash');
  return [...new Set(keys)].sort();
}

/** Wait for all in-flight work even on failure; never leave unobserved promises. */
async function boundedMap<T, U>(items: T[], run: (item: T) => Promise<U>): Promise<U[]> {
  const results: U[] = new Array(items.length);
  let next = 0;
  let failed = false;
  let failure: unknown;
  await Promise.all(Array.from({length: Math.min(items.length, RETIREMENT_LIMITS.concurrency)}, async () => {
    while (!failed) {
      const position = next++;
      if (position >= items.length) return;
      try { results[position] = await run(items[position]); }
      catch (error) { if (!failed) { failed = true; failure = error; } }
    }
  }));
  if (failed) throw failure;
  return results;
}

function shardPath(prefix: string, digest: string): string {
  return RETIREMENT_SHARD_PREFIX + prefix + '/' + digest + '.json';
}

async function readShard(storage: Storage, prefix: string, digest: string): Promise<Shard> {
  const object = await storage.get(shardPath(prefix, digest));
  if (!object) invalid('missing referenced shard');
  if (!Number.isSafeInteger(object.size) || object.size < 1 || object.size > RETIREMENT_LIMITS.objectBytes) invalid('shard size');
  const text = await object.text();
  const bytes = encoder.encode(text).byteLength;
  if (bytes !== object.size || bytes > RETIREMENT_LIMITS.objectBytes) invalid('shard size');
  if (await sha256(text) !== digest) invalid('shard digest mismatch');
  let value: unknown;
  try { value = JSON.parse(text); } catch { invalid('shard JSON'); }
  if (!record(value) || !exactFields(value, ['schema', 'bucket', 'keys']) || value.schema !== 1 ||
      value.bucket !== prefix || !Array.isArray(value.keys) || value.keys.length < 1 ||
      value.keys.length > RETIREMENT_LIMITS.keysPerBucket) invalid('shard shape or capacity');
  let previous = '';
  for (const key of value.keys) {
    if (typeof key !== 'string' || !HASH.test(key) || !key.startsWith(prefix) || key <= previous) invalid('shard keys, order, or bucket');
    previous = key;
  }
  return value as Shard;
}

function validateLoadedCounts(index: RetirementIndex, loadedCount: number, loadedBuckets: number): void {
  const unseenBuckets = Object.keys(index.buckets).length - loadedBuckets;
  // Exact when all buckets were touched; otherwise validate the possible range.
  // Per-bucket caps remain authoritative even when not all shards are needed.
  if (index.count < loadedCount + unseenBuckets ||
      index.count > loadedCount + unseenBuckets * RETIREMENT_LIMITS.keysPerBucket) invalid('index/shard count mismatch');
}

/**
 * Writer/rebuild integrity gate: verify every referenced shard and the exact
 * total count, with no more than 256 reads and four storage requests in flight.
 * Use this before accepting a saved publication as authoritative writer state.
 * Each worker discards its decoded shard after counting it. Memory is bounded
 * by four 512 KiB objects plus their parsed representation, not the full ledger.
 */
export async function verifyRetirementIndex(storage: Storage, value: RetirementIndex): Promise<void> {
  const index = snapshotIndex(value);
  const prefixes = Object.keys(index.buckets).sort();
  const counts = await boundedMap(prefixes, async prefix => {
    const shard = await readShard(storage, prefix, index.buckets[prefix]);
    return shard.keys.length;
  });
  validateLoadedCounts(index, counts.reduce((total, count) => total + count, 0), prefixes.length);
}

/** Throws on corrupt/missing state. Callers must not treat errors as an empty ledger. */
export async function readRetiredKeys(storage: Storage, value: RetirementIndex, keys: readonly string[]): Promise<Set<string>> {
  const index = snapshotIndex(value);
  const requested = requestedKeys(keys);
  const requestedSet = new Set(requested);
  const prefixes = [...new Set(requested.map(key => key.slice(0, 2)))].filter(prefix => Object.hasOwn(index.buckets, prefix));
  // Keep only matching requested keys, never retain all decoded bucket arrays.
  const results = await boundedMap(prefixes, async prefix => {
    const shard = await readShard(storage, prefix, index.buckets[prefix]);
    return {count: shard.keys.length, matches: shard.keys.filter(key => requestedSet.has(key))};
  });
  validateLoadedCounts(index, results.reduce((total, result) => total + result.count, 0), prefixes.length);
  return new Set(results.flatMap(result => result.matches));
}

async function composeShard(storage: Storage, index: RetirementIndex, prefix: string, requested: string[]) {
  const oldKeys = Object.hasOwn(index.buckets, prefix) ? (await readShard(storage, prefix, index.buckets[prefix])).keys : [];
  const nextKeys = [...new Set([...oldKeys, ...requested])].sort();
  if (nextKeys.length > RETIREMENT_LIMITS.keysPerBucket) invalid('bucket capacity exceeded; permanent retirements cannot be forgotten');
  const added = nextKeys.length - oldKeys.length;
  if (!added) return {prefix, oldCount: oldKeys.length, added, text: '', digest: ''};
  const text = JSON.stringify({schema: 1, bucket: prefix, keys: nextKeys} satisfies Shard);
  if (encoder.encode(text).byteLength > RETIREMENT_LIMITS.objectBytes) invalid('shard size');
  return {prefix, oldCount: oldKeys.length, added, text, digest: await sha256(text)};
}

/**
 * Create immutable, content-addressed shards and return an inactive new index.
 * No expiration, truncation, deletion, mutable ledger, or activation occurs here.
 * The caller must atomically commit this index with the new Publication, after
 * deciding whether the incumbent article really changed (compare articleKey).
 * Two bounded passes check every capacity before any writes, retaining only
 * tiny digest plans between passes. At most four shard bodies/decoded key sets
 * are in flight, rather than up to 128 complete shards. Changed source shards
 * are reread in the write pass and must still match their content hashes.
 */
export async function prepareRetirements(storage: Storage, value: RetirementIndex, keys: readonly string[]): Promise<RetirementIndex> {
  const index = snapshotIndex(value);
  const requested = requestedKeys(keys);
  const prefixes = [...new Set(requested.map(key => key.slice(0, 2)))];
  const byPrefix = new Map(prefixes.map(prefix => [prefix, requested.filter(key => key.startsWith(prefix))]));
  const checked = await boundedMap(prefixes, async prefix => {
    const shard = await composeShard(storage, index, prefix, byPrefix.get(prefix)!);
    return {prefix, digest: shard.digest, added: shard.added, oldCount: shard.oldCount};
  });
  validateLoadedCounts(index, checked.reduce((count, plan) => count + plan.oldCount, 0), prefixes.filter(prefix => Object.hasOwn(index.buckets, prefix)).length);
  const addedCount = checked.reduce((count, plan) => count + plan.added, 0);
  const plans = checked.filter(plan => plan.added > 0);
  const nextIndex: RetirementIndex = {schema: 1, count: index.count + addedCount, buckets: {...index.buckets}};
  for (const plan of plans) nextIndex.buckets[plan.prefix] = plan.digest;
  nextIndex.buckets = Object.fromEntries(Object.entries(nextIndex.buckets).sort(([a], [b]) => a.localeCompare(b)));
  validateRetirementIndex(nextIndex);
  await boundedMap(plans, async ({prefix, digest}) => {
    const shard = await composeShard(storage, index, prefix, byPrefix.get(prefix)!);
    if (shard.digest !== digest) invalid('prepared shard changed between passes');
    const written = await storage.put(shardPath(prefix, digest), shard.text, {
      onlyIf: {etagDoesNotMatch: '*'},
      httpMetadata: {contentType: 'application/json'},
    });
    // A concurrent/repeated prepare may have created identical immutable data.
    // Verify it rather than overwriting it or assuming a failed put is harmless.
    if (!written) await readShard(storage, prefix, digest);
  });
  return nextIndex;
}
