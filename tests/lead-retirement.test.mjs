import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ht-lead-retirement-'));
const out = path.join(dir, 'retirement.mjs');
await build({entryPoints: ['lib/lead-retirement.ts'], bundle: true, platform: 'node', format: 'esm', outfile: out});
const moduleUrl = pathToFileURL(out).href;
const ledger = await import(moduleUrl);
const secondInstance = await import(moduleUrl + '?instance=second');
const {emptyIndex, storyIdentity, normalizeArticleUrl, readRetiredKeys, prepareRetirements,
  validateRetirementIndex, verifyRetirementIndex, RETIREMENT_LIMITS, RETIREMENT_SHARD_PREFIX} = ledger;
const hash = text => createHash('sha256').update(text).digest('hex');
const keyAt = (prefix, n) => prefix + n.toString(16).padStart(62, '0');
const shardPath = (prefix, digest) => RETIREMENT_SHARD_PREFIX + prefix + '/' + digest + '.json';

class MockR2 {
  data = new Map();
  reads = [];
  writes = [];
  failWrite = () => false;
  failRead = () => false;
  rejectCreate = false;
  active = 0;
  peak = 0;
  async operation(action) {
    this.active++;
    this.peak = Math.max(this.peak, this.active);
    try { await new Promise(resolve => setImmediate(resolve)); return action(); }
    finally { this.active--; }
  }
  async get(key) {
    this.reads.push(key);
    return this.operation(() => {
      if (this.failRead(key)) throw Error('injected read failure');
      const object = this.data.get(key);
      return object ? {size: object.size ?? Buffer.byteLength(object.text), text: async () => object.text} : null;
    });
  }
  async put(key, text, options) {
    this.writes.push({key, text, options});
    return this.operation(() => {
      if (this.failWrite(key)) throw Error('injected write failure');
      assert.deepEqual(options.onlyIf, {etagDoesNotMatch: '*'}, 'shards must only be conditionally created');
      assert.equal(options.httpMetadata.contentType, 'application/json');
      if (this.rejectCreate || this.data.has(key)) return null;
      this.data.set(key, {text});
      return {etag: hash(text)};
    });
  }
}

function seedShard(storage, {prefix = 'aa', keys = [keyAt('aa', 1)], fields, text, count, size} = {}) {
  const body = text ?? JSON.stringify(fields ?? {schema: 1, bucket: prefix, keys});
  const digest = hash(body);
  const key = shardPath(prefix, digest);
  storage.data.set(key, {text: body, ...(size === undefined ? {} : {size})});
  return {index: {schema: 1, count: count ?? keys.length, buckets: {[prefix]: digest}}, key};
}

try {
  // Only server-supplied URL data determines identity. Hash domains cannot collide
  // between the HN ID and article URL just because their input text resembles one another.
  const first = await storyIdentity({id: 101, url: 'https://EXAMPLE.com:443/Story?b=2&utm_source=hn&a=1#comments'});
  const repost = await storyIdentity({id: 202, url: 'https://example.com/Story?a=1&b=2&fbclid=tracking'});
  assert.notEqual(first.idKey, repost.idKey);
  assert.equal(first.articleKey, repost.articleKey);
  assert.equal(first.idKey, hash('hn-id:v1:101'));
  assert.equal(first.articleKey, hash('article-url:v1:https://example.com/Story?a=1&b=2'));
  assert.equal((await storyIdentity({id: 101, url: 'https://example.com/different'})).idKey, first.idKey);
  assert.equal(normalizeArticleUrl('http://EXAMPLE.com:80/p?UTM_MEDIUM=hn&gclid=x#part'), 'https://example.com/p');
  assert.equal(normalizeArticleUrl('https://example.com/p?z=2&a=one&a=two&z=1'), 'https://example.com/p?a=one&a=two&z=2&z=1');
  assert.equal(normalizeArticleUrl('https://example.com/p?q=a%20b'), normalizeArticleUrl('https://example.com/p?q=a+b'));
  const approvedAliases = [
    'http://example.com/Story?a=1&b=2',
    'https://www.example.com/Story?a=1&b=2',
    'https://example.com/Story/?a=1&b=2',
    'http://WWW.EXAMPLE.COM:80/Story///?b=2&a=1&utm_source=hn#comments',
    'https://www.example.com:443/Story//?a=1&b=2&fbclid=tracking',
  ];
  for (const url of approvedAliases) assert.equal((await storyIdentity({id: 303, url})).articleKey, first.articleKey, url);
  for (const url of [
    'https://example.com/story?a=1&b=2',
    'https://example.com/different-path?a=1&b=2',
    'https://example.net/Story?a=1&b=2',
    'https://news.example.com/Story?a=1&b=2',
    'https://www.www.example.com/Story?a=1&b=2',
    'https://example.com/%53tory?a=1&b=2',
    'https://example.com/Story?a=1&b=3',
    'https://example.com/Story?a=1&b=2&id=7',
    'https://example.com/Story?a=1&b=2&ref=home',
    'https://example.com/Story?a=1&b=2&source=newsletter',
    'https://example.com/Story?a=1&b=2&utm_custom=meaningful',
    'https://example.com:8443/Story?a=1&b=2',
  ]) assert.notEqual((await storyIdentity({id: 303, url})).articleKey, first.articleKey, url);
  assert.notEqual(normalizeArticleUrl('https://example.com/p?a=one&a=two'), normalizeArticleUrl('https://example.com/p?a=two&a=one'));
  assert.notEqual(normalizeArticleUrl('https://example.com/p?q=Word'), normalizeArticleUrl('https://example.com/p?q=word'));
  assert.notEqual(normalizeArticleUrl('https://example.com/p?Q=word'), normalizeArticleUrl('https://example.com/p?q=word'));
  assert.notEqual(normalizeArticleUrl('https://example.com/Story//part/'), normalizeArticleUrl('https://example.com/Story/part/'));
  assert.notEqual(normalizeArticleUrl('https://example.com/Story%2F'), normalizeArticleUrl('https://example.com/Story/'));
  assert.notEqual(normalizeArticleUrl('https://example.com/Story%2f'), normalizeArticleUrl('https://example.com/Story%2F'));
  assert.equal(normalizeArticleUrl('https://example.com/%2e/Story'), normalizeArticleUrl('https://example.com/Story'));
  assert.equal(normalizeArticleUrl('https://example.com/./Story'), normalizeArticleUrl('https://example.com/Story'));
  assert.equal(normalizeArticleUrl('https://example.com/earlier/../Story'), normalizeArticleUrl('https://example.com/Story'));
  assert.equal(normalizeArticleUrl('http://www.example.com///?q=path/'), 'https://example.com/?q=path%2F');
  assert.equal(normalizeArticleUrl('https://www.news.example.com/Story/'), normalizeArticleUrl('https://news.example.com/Story'));
  const normalizationInputs = [...approvedAliases,
    'http://www.example.com', 'https://example.com/', 'https://example.com////',
    'https://www.www.example.com/Story///', 'https://www.www.www.example.com/Story/',
    'https://example.com/Part//Section///?q=Case&same=first&same=second&utm_medium=hn',
    'https://example.com/Part%2fSection///?q=path%2f&b=2&a=1',
    'http://www.example.com:8080/Story/', 'http://www.example.com:443/Story/',
  ];
  for (const url of normalizationInputs) {
    const normalized = normalizeArticleUrl(url);
    assert.equal(normalizeArticleUrl(normalized), normalized, 'normalization must be idempotent: ' + url);
  }
  for (const url of ['javascript:alert(1)', 'data:text/plain,x', '/relative', 'https://user:password@example.com/',
    ' https://example.com/', 'https://example.com/white space', 'https://example.com/\\path', 'https://example.com/' + 'x'.repeat(2500)]) {
    await assert.rejects(() => storyIdentity({id: 1, url}), /article URL/);
  }
  for (const id of [0, -1, 1.2, Number.MAX_SAFE_INTEGER + 1, '101', null]) {
    await assert.rejects(() => storyIdentity({id, url: 'https://example.com/'}), /HN story ID/);
  }

  // Preparing cannot activate a ledger, mutate a supplied index, or write a
  // publication pointer. Once explicitly committed by a caller, any instance reads it.
  const storage = new MockR2();
  const base = Object.freeze({schema: 1, count: 0, buckets: Object.freeze({})});
  const oldSnapshot = JSON.stringify(base);
  const prepared = await prepareRetirements(storage, base, [first.idKey, first.articleKey, first.idKey]);
  assert.equal(prepared.count, 2);
  assert.equal(JSON.stringify(base), oldSnapshot);
  assert.deepEqual(await readRetiredKeys(storage, base, [first.idKey, repost.articleKey]), new Set());
  let committedIndex = base;
  assert.deepEqual(await secondInstance.readRetiredKeys(storage, committedIndex, [first.idKey]), new Set());
  committedIndex = JSON.parse(JSON.stringify(prepared)); // Simulate the caller's publication CAS.
  assert.deepEqual(await secondInstance.readRetiredKeys(storage, committedIndex, [first.idKey, repost.idKey, repost.articleKey]),
    new Set([first.idKey, first.articleKey]));
  assert.ok(storage.writes.every(write => write.key.startsWith(RETIREMENT_SHARD_PREFIX)));
  assert.ok(storage.writes.every(write => !write.key.includes('current.json')));
  const firstWrites = storage.writes.length;
  const same = await prepareRetirements(storage, prepared, [repost.articleKey, first.idKey]);
  assert.deepEqual(same, prepared);
  assert.equal(storage.writes.length, firstWrites, 'already retired batch performs no writes');
  const originalObjects = new Map([...storage.data].map(([key, object]) => [key, object.text]));
  const retry = await prepareRetirements(storage, base, [first.articleKey, first.idKey]);
  assert.deepEqual(retry, prepared, 'same uncommitted preparation is deterministic');
  for (const [key, text] of originalObjects) assert.equal(storage.data.get(key).text, text);

  // The incumbent repost can be recognized before deciding to retire anything.
  assert.equal(first.articleKey, repost.articleKey, 'same-article transitions must not retire themselves');
  // Different article replaces it: both the old HN identity and future reposts
  // are barred, while neither next lead identity is implicitly retired.
  const next = await storyIdentity({id: 404, url: 'https://example.net/new-article'});
  assert.deepEqual(await readRetiredKeys(storage, prepared, Object.values(next)), new Set());

  // New immutable shard supersedes only its own prefix in the returned index.
  const oldKey = keyAt('aa', 1), newKey = keyAt('aa', 2), anotherKey = keyAt('bb', 1);
  const additionsStore = new MockR2();
  const additionsFirst = await prepareRetirements(additionsStore, emptyIndex(), [oldKey, anotherKey]);
  const additionsSecond = await prepareRetirements(additionsStore, additionsFirst, [newKey]);
  assert.equal(additionsSecond.count, 3);
  assert.notEqual(additionsFirst.buckets.aa, additionsSecond.buckets.aa);
  assert.equal(additionsFirst.buckets.bb, additionsSecond.buckets.bb);
  assert.ok(additionsStore.data.has(shardPath('aa', additionsFirst.buckets.aa)), 'old shard retained permanently');
  assert.deepEqual(await readRetiredKeys(additionsStore, additionsFirst, [newKey, oldKey]), new Set([oldKey]));
  assert.deepEqual(await readRetiredKeys(additionsStore, additionsSecond, [newKey, oldKey]), new Set([newKey, oldKey]));

  // Failed writes and failed conditional creates never return an activatable index.
  const failedStore = new MockR2();
  failedStore.failWrite = key => key.includes('/bb/');
  const failedBase = emptyIndex();
  await assert.rejects(() => prepareRetirements(failedStore, failedBase, [oldKey, anotherKey]), /injected write failure/);
  assert.deepEqual(failedBase, emptyIndex());
  assert.equal(failedStore.active, 0, 'all in-flight writes settle before failure returns');
  assert.deepEqual(await readRetiredKeys(failedStore, failedBase, [oldKey]), new Set());
  failedStore.failWrite = () => false;
  const recovered = await prepareRetirements(failedStore, failedBase, [oldKey, anotherKey]);
  assert.equal(recovered.count, 2);
  const rejectedStore = new MockR2();
  rejectedStore.rejectCreate = true;
  await assert.rejects(() => prepareRetirements(rejectedStore, emptyIndex(), [oldKey]), /missing referenced shard/);

  // Corruption is always an error, never a silently empty retirement result.
  const missingStore = new MockR2();
  const missingIndex = {schema: 1, count: 1, buckets: {aa: 'f'.repeat(64)}};
  await assert.rejects(() => readRetiredKeys(missingStore, missingIndex, [oldKey]), /missing referenced shard/);
  await assert.rejects(() => prepareRetirements(missingStore, missingIndex, [newKey]), /missing referenced shard/);
  await assert.rejects(() => verifyRetirementIndex(missingStore, missingIndex), /missing referenced shard/);
  const corruptStore = new MockR2();
  const corrupt = seedShard(corruptStore);
  corruptStore.data.get(corrupt.key).text = corruptStore.data.get(corrupt.key).text.replace('0001', '0002');
  await assert.rejects(() => readRetiredKeys(corruptStore, corrupt.index, [oldKey]), /digest mismatch/);
  const corruptedPreparedStore = new MockR2();
  const corruptedPrepared = await prepareRetirements(corruptedPreparedStore, emptyIndex(), [oldKey]);
  corruptedPreparedStore.data.get(shardPath('aa', corruptedPrepared.buckets.aa)).text = '{}';
  await assert.rejects(() => prepareRetirements(corruptedPreparedStore, emptyIndex(), [oldKey]), /digest mismatch/);
  const cases = [
    {text: '{broken', expected: /shard JSON/},
    {fields: {schema: 2, bucket: 'aa', keys: [oldKey]}, expected: /shard shape/},
    {fields: {schema: 1, bucket: 'bb', keys: [oldKey]}, expected: /shard shape/},
    {fields: {schema: 1, bucket: 'aa', keys: [oldKey], hidden: true}, expected: /shard shape/},
    {fields: {schema: 1, bucket: 'aa', keys: []}, expected: /shard shape/},
    {fields: {schema: 1, bucket: 'aa', keys: [anotherKey]}, expected: /bucket/},
    {fields: {schema: 1, bucket: 'aa', keys: [oldKey, oldKey]}, count: 2, expected: /order/},
    {fields: {schema: 1, bucket: 'aa', keys: [newKey, oldKey]}, count: 2, expected: /order/},
    {fields: {schema: 1, bucket: 'aa', keys: ['aa-not-a-hash']}, expected: /shard keys/},
    {count: 2, expected: /count mismatch/},
    {size: RETIREMENT_LIMITS.objectBytes + 1, expected: /shard size/},
    {size: 1, expected: /shard size/},
    {size: undefined, text: ' '.repeat(RETIREMENT_LIMITS.objectBytes + 1), expected: /shard size/},
  ];
  for (const options of cases) {
    const mock = new MockR2();
    const seeded = seedShard(mock, options);
    await assert.rejects(() => readRetiredKeys(mock, seeded.index, [oldKey]), options.expected);
  }
  const readFailure = new MockR2();
  readFailure.failRead = () => true;
  await assert.rejects(() => readRetiredKeys(readFailure, missingIndex, [oldKey]), /injected read failure/);
  const badIndices = [null, [], {}, {schema: 2, count: 0, buckets: {}}, {schema: 1, count: -1, buckets: {}},
    {schema: 1, count: 0.1, buckets: {}}, {schema: 1, count: 1, buckets: {}}, {schema: 1, count: 0, buckets: []},
    {schema: 1, count: 1, buckets: {'AA': 'f'.repeat(64)}}, {schema: 1, count: 1, buckets: {'aaa': 'f'.repeat(64)}},
    {schema: 1, count: 1, buckets: {aa: '../current'}}, {schema: 1, count: 0, buckets: {aa: 'f'.repeat(64)}},
    {schema: 1, count: 4097, buckets: {aa: 'f'.repeat(64)}}, {schema: 1, count: 0, buckets: {}, ttl: 10}];
  for (const index of badIndices) assert.throws(() => validateRetirementIndex(index), /Invalid lead retirement ledger/);
  assert.throws(() => validateRetirementIndex({schema: 1, count: 257, buckets: Object.fromEntries(Array.from({length: 257}, (_, n) => [n.toString(16), 'f'.repeat(64)]))}), /index/);

  // Hard caps fail closed before writing; they never evict old retirements.
  const cappedStore = new MockR2();
  const fullKeys = Array.from({length: RETIREMENT_LIMITS.keysPerBucket}, (_, n) => keyAt('aa', n));
  const full = seedShard(cappedStore, {keys: fullKeys});
  const fullSnapshot = JSON.stringify(full.index);
  await assert.rejects(() => prepareRetirements(cappedStore, full.index, [keyAt('aa', 4096), anotherKey]), /capacity exceeded/);
  assert.equal(cappedStore.writes.length, 0, 'all capacities checked before any write');
  assert.equal(JSON.stringify(full.index), fullSnapshot);
  assert.deepEqual(await prepareRetirements(cappedStore, full.index, [fullKeys[0]]), full.index);
  assert.deepEqual(await readRetiredKeys(cappedStore, full.index, [fullKeys[0], fullKeys[4095]]), new Set([fullKeys[0], fullKeys[4095]]));
  const overfullStore = new MockR2();
  const overfull = seedShard(overfullStore, {keys: [...fullKeys, keyAt('aa', 4096)], count: 4096});
  await assert.rejects(() => readRetiredKeys(overfullStore, overfull.index, [oldKey]), /capacity/);
  for (const keys of [Array(129).fill(oldKey), ['wrong'], ['A'.repeat(64)], null]) {
    await assert.rejects(() => prepareRetirements(storage, emptyIndex(), keys), /key limit|identity hash/);
    await assert.rejects(() => readRetiredKeys(storage, emptyIndex(), keys), /key limit|identity hash/);
  }

  // Both reads and writes stay bounded, including the maximum allowed batch.
  const concurrentStore = new MockR2();
  const batch = Array.from({length: 128}, (_, n) => keyAt(n.toString(16).padStart(2, '0'), 1));
  const batchIndex = await prepareRetirements(concurrentStore, emptyIndex(), batch);
  assert.equal(batchIndex.count, 128);
  assert.ok(concurrentStore.peak >= 1 && concurrentStore.peak <= 4);
  concurrentStore.peak = 0;
  assert.equal((await readRetiredKeys(concurrentStore, batchIndex, batch)).size, 128);
  assert.ok(concurrentStore.peak >= 1 && concurrentStore.peak <= 4);
  assert.equal(concurrentStore.active, 0);
  const beforeNoop = concurrentStore.reads.length + concurrentStore.writes.length;
  assert.deepEqual(await prepareRetirements(concurrentStore, batchIndex, []), batchIndex);
  assert.deepEqual(await readRetiredKeys(concurrentStore, batchIndex, []), new Set());
  assert.equal(concurrentStore.reads.length + concurrentStore.writes.length, beforeNoop);
  const nextBatch = Array.from({length: 128}, (_, n) => keyAt((n + 128).toString(16).padStart(2, '0'), 1));
  const allBuckets = await prepareRetirements(concurrentStore, batchIndex, nextBatch);
  assert.equal(Object.keys(allBuckets.buckets).length, RETIREMENT_LIMITS.buckets);
  concurrentStore.peak = 0;
  const beforeFullVerify = concurrentStore.reads.length;
  await verifyRetirementIndex(concurrentStore, allBuckets);
  assert.equal(concurrentStore.reads.length - beforeFullVerify, 256);
  assert.ok(concurrentStore.peak >= 1 && concurrentStore.peak <= 4);
  await assert.rejects(() => verifyRetirementIndex(concurrentStore, {...allBuckets, count: 257}), /count mismatch/);
  concurrentStore.data.delete(shardPath('ff', allBuckets.buckets.ff));
  assert.equal((await readRetiredKeys(concurrentStore, allBuckets, [batch[0]])).size, 1);
  await assert.rejects(() => verifyRetirementIndex(concurrentStore, allBuckets), /missing referenced shard/);
  await verifyRetirementIndex(new MockR2(), emptyIndex());

  // Maximum ledger verification, maximum membership batch, and maximum changed
  // batch must fit a 64 MiB V8 heap. Virtual R2 generates each shard on demand so
  // the fixture itself does not retain the full million-key ledger in memory.
  const heapProbe = spawnSync(process.execPath, ['--max-old-space-size=64', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import {createHash} from 'node:crypto';
    const {verifyRetirementIndex, readRetiredKeys, prepareRetirements, RETIREMENT_SHARD_PREFIX} = await import(${JSON.stringify(moduleUrl)});
    const key = (prefix, n) => prefix + n.toString(16).padStart(62, '0');
    const body = (prefix, count) => JSON.stringify({schema: 1, bucket: prefix, keys: Array.from({length: count}, (_, n) => key(prefix, n))});
    const hash = text => createHash('sha256').update(text).digest('hex');
    function indexFor(count) {
      const buckets = {};
      for (let n = 0; n < 256; n++) {
        const prefix = n.toString(16).padStart(2, '0');
        buckets[prefix] = hash(body(prefix, count));
      }
      return {schema: 1, count: 256 * count, buckets};
    }
    let count = 4096, current = indexFor(count), writes = 0;
    const storage = {
      get: async path => {
        const suffix = path.slice(RETIREMENT_SHARD_PREFIX.length);
        const prefix = suffix.slice(0, 2);
        assert.equal(path, RETIREMENT_SHARD_PREFIX + prefix + '/' + current.buckets[prefix] + '.json');
        const text = body(prefix, count);
        return {size: Buffer.byteLength(text), text: async () => text};
      },
      put: async (path, text, options) => {
        assert.equal(options.onlyIf.etagDoesNotMatch, '*');
        const digest = hash(text);
        assert.ok(path.endsWith('/' + digest + '.json'));
        writes++;
        return {etag: digest};
      },
    };
    await verifyRetirementIndex(storage, current);
    const batch = Array.from({length: 128}, (_, n) => key(n.toString(16).padStart(2, '0'), 0));
    assert.equal((await readRetiredKeys(storage, current, batch)).size, 128);
    count = 4095;
    current = indexFor(count);
    const additions = Array.from({length: 128}, (_, n) => key(n.toString(16).padStart(2, '0'), 4095));
    const next = await prepareRetirements(storage, current, additions);
    assert.equal(next.count, current.count + 128);
    assert.equal(writes, 128);
    console.log('PASS maximum-size ledger operations under 64 MiB V8 heap');
  `], {encoding: 'utf8', timeout: 120_000, maxBuffer: 1024 * 1024});
  assert.equal(heapProbe.status, 0, 'bounded memory regression: ' + heapProbe.stderr + heapProbe.stdout + (heapProbe.error?.message || ''));
  console.log(heapProbe.stdout.trim());

  console.log('PASS: approved HTTP/HTTPS, www/bare, and trailing-slash equivalence; meaningful path/query/subdomain distinctions; normalization idempotence; server-derived repost identity; immutable conditional shards; caller-only activation; no TTL or eviction; repeatable/idempotent batches; cross-instance reads; corrupt/missing/oversize state and write/read failure fail closed; full 256-bucket integrity gate; count/prefix/digest/uniqueness validation; 4096-key bucket and 128-key request caps; concurrency at most 4.');
} finally {
  fs.rmSync(dir, {recursive: true, force: true});
}
