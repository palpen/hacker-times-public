import {publicUrl} from './news';
import {boundedBody,sameOriginOperation} from './security';
/** Public, read-only HN data. Never forward a visitor header, credential or URL.
 * HN reference: https://github.com/HackerNews/API (kids are in HN display order).
 * Limits are per isolate, not a distributed abuse-prevention guarantee: 12 items
 * per page, 50 pages per parent, 8 visible levels, 22 item lookups/request, 4
 * parallel lookups/request, 12 global upstream requests, 6 active pages, 60 burst
 * upstream reads replenishing at 180/minute. A single item has a 12s deadline;
 * an entire page has an 18s deadline, including publication lookup/ancestry.
 * Any transient item timeout fails the page for retry, never a false empty page.
 * Cache: 128 sanitized items, 45s TTL
 * (10s for missing items), shared in-flight deduplication. No persistent storage,
 * credentials, writes, cross-origin allowance, polling or background refresh.
 */
export const COMMENT_LIMITS = Object.freeze({
  pageSize: 12, maxChildren: 600, maxDepth: 8, maxLookups: 22,
  concurrency: 4, globalConcurrency: 12, activePages: 6,
  itemBytes: 100_000, textLength: 20_000, tokenCount: 2_000, tokenDepth: 16,
  requestMs: 18_000, itemMs: 12_000, cacheEntries: 128, cacheMs: 45_000,
  burst: 60, readsPerMinute: 180,
});
const HN_API = 'https://hacker-news.firebaseio.com/v0/item/';
const HN_WEB = 'https://news.ycombinator.com/';
const responseHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
};
export type SafeCommentToken =
  | { type: 'text'; text: string }
  | { type: 'br' }
  | { type: 'p' | 'em' | 'strong' | 'code' | 'pre'; children: SafeCommentToken[] }
  | { type: 'a'; href: string; children: SafeCommentToken[] };
export type ReaderComment = {
  id: number; parentId: number; by: string | null; time: number | null;
  deleted: boolean; dead: boolean; unavailable: boolean;
  content: SafeCommentToken[]; contentTruncated: boolean;
  replyCount: number; repliesAvailable: boolean;
};
export type CommentsPage = {
  storyId: number; parentId: number; depth: number; comments: ReaderComment[];
  page: { offset: number; limit: number; total: number; nextOffset: number | null; truncated: boolean; partial: boolean };
  fetchedAt: string; hnUrl: string;
};
type SafeItem = {
  id: number; type: string; parent: number | null; kids: number[]; childCount: number; sampledAt: number;
  by: string | null; time: number | null; deleted: boolean; dead: boolean;
  content: SafeCommentToken[]; contentTruncated: boolean;
};
export type EditionLike = { stories: { id: number }[]; editionDate?: string; generatedAt?: string; schemaVersion?: number; layoutVersion?: number };
export type Dependencies = {
  fetcher: typeof fetch;
  now: () => number;
  readEdition: (request: Request, env: Cloudflare.Env, date: string | null, version: string | null) => Promise<EditionLike | null>;
};
class CommentsError extends Error {
  constructor(public code: string, message: string, public status = 503) { super(message); }
}
function positiveId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
function hnLink(id: number) { return `${HN_WEB}item?id=${id}`; }
function decodeEntities(text: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
  return text.replace(/&(#(?:x[0-9a-f]{1,8}|[0-9]{1,10})|amp|lt|gt|quot|apos|nbsp);/gi, (original, entity: string) => {
    if (entity[0] !== '#') return named[entity.toLowerCase()] ?? original;
    const hex = entity[1]?.toLowerCase() === 'x';
    const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '\ufffd';
  });
}
function safeLink(attributes: string): string | null {
  // Attributes never reach the DOM. Ambiguous/duplicate hrefs are discarded.
  const matches = [...attributes.matchAll(/(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`=]+))/gi)];
  if (matches.length !== 1) return null;
  const raw = decodeEntities(matches[0][1] ?? matches[0][2] ?? matches[0][3] ?? '');
  if (!raw || raw.length > 2_500 || /[\x00-\x20\x7f\\]/.test(raw)) return null;
  try {
    const url = new URL(raw, HN_WEB);
    return publicUrl(url.href) ? url.href : null;
  } catch { return null; }
}

/** A deliberately small HTML-to-data tokenizer, NOT an HTML passthrough.
 * Unknown tags/attributes are never emitted. Active/raw-text containers and
 * their contents are dropped; only typed text/allowlisted nodes reach readers.
 * Even malformed markup becomes inert data, never an HTML string to insert.
 */
export function sanitizeCommentHTML(input: string): { content: SafeCommentToken[]; truncated: boolean } {
  const max = COMMENT_LIMITS;
  let truncated = input.length > max.textLength;
  const source = input.slice(0, max.textLength);
  const content: SafeCommentToken[] = [];
  const stack: { tag: string; children: SafeCommentToken[] }[] = [{ tag: '', children: content }];
  const dropped = new Set(['script', 'style', 'iframe', 'object', 'template', 'svg', 'math', 'textarea', 'title', 'noscript', 'xmp', 'plaintext']);
  const aliases: Record<string, 'p' | 'em' | 'strong' | 'code' | 'pre' | 'a' | 'br'> = { p: 'p', i: 'em', em: 'em', b: 'strong', strong: 'strong', code: 'code', pre: 'pre', a: 'a', br: 'br' };
  let blocked: string | null = null, nodes = 0, cursor = 0;
  const append = (token: SafeCommentToken) => {
    if (nodes >= max.tokenCount) { truncated = true; return false; }
    stack[stack.length - 1].children.push(token); nodes++; return true;
  };
  const text = (value: string) => {
    if (!value || blocked) return;
    const clean = decodeEntities(value).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
    if (clean) append({ type: 'text', text: clean });
  };
  while (cursor < source.length && nodes < max.tokenCount) {
    const open = source.indexOf('<', cursor);
    if (open < 0) { text(source.slice(cursor)); cursor = source.length; break; }
    text(source.slice(cursor, open));
    if (source.startsWith('<!--', open)) {
      const end = source.indexOf('-->', open + 4); cursor = end < 0 ? source.length : end + 3; continue;
    }
    // Scan a tag once, respecting quotes. Unterminated tags are simply dropped.
    let end = open + 1, quote = '';
    for (; end < source.length; end++) {
      const char = source[end];
      if (quote) { if (char === quote) quote = ''; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
    }
    if (end === source.length) { cursor = end; break; }
    const raw = source.slice(open + 1, end);
    cursor = end + 1;
    const match = /^\s*(\/?)\s*([a-z][a-z0-9]*)(?=\s|\/|$)([\s\S]*)$/i.exec(raw);
    if (!match) { if (!blocked && !raw.startsWith('!') && !raw.startsWith('?')) text('<' + raw + '>'); continue; }
    const closing = !!match[1], tag = match[2].toLowerCase();
    if (blocked) { if (closing && tag === blocked) blocked = null; continue; }
    if (dropped.has(tag)) { if (!closing) blocked = tag; continue; }
    const type = aliases[tag];
    if (!type) continue;
    if (closing) {
      for (let index = stack.length - 1; index > 0; index--) {
        if (stack[index].tag === type) { stack.length = index; break; }
      }
      continue;
    }
    // HN often omits </p>; preserve separate paragraphs rather than nesting them.
    if (type === 'p') {
      const paragraph = stack.findIndex(frame => frame.tag === 'p');
      if (paragraph > 0) stack.length = paragraph;
    }
    if (type === 'br') { append({ type: 'br' }); continue; }
    if (stack.length >= max.tokenDepth) { truncated = true; continue; }
    const children: SafeCommentToken[] = [];
    if (type === 'a') {
      const href = safeLink(match[3]);
      if (!href || stack.some(frame => frame.tag === 'a')) continue;
      if (!append({ type, href, children })) break;
    } else if (!append({ type, children })) break;
    if (!/\/\s*$/.test(match[3])) stack.push({ tag: type, children });
  }
  if (cursor < source.length) truncated = true;
  return { content, truncated };
}
function normalizeItem(value: unknown, id: number, sampledAt: number): SafeItem | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CommentsError('upstream_invalid', 'Hacker News returned an invalid response.');
  const item = value as Record<string, unknown>;
  if (item.id !== id || typeof item.type !== 'string' || !['story', 'poll', 'pollopt', 'comment', 'job'].includes(item.type)) throw new CommentsError('upstream_invalid', 'Hacker News returned an invalid item.');
  if (item.kids !== undefined && (!Array.isArray(item.kids) || !item.kids.every(positiveId))) throw new CommentsError('upstream_invalid', 'Hacker News returned invalid replies.');
  const kids = [...new Set((item.kids as number[] | undefined) ?? [])];
  const hidden = item.deleted === true || item.dead === true;
  const parsed = !hidden && typeof item.text === 'string' ? sanitizeCommentHTML(item.text) : { content: [], truncated: false };
  return {
    id, sampledAt, type: item.type, parent: positiveId(item.parent) ? item.parent : null,
    kids: kids.slice(0, COMMENT_LIMITS.maxChildren), childCount: kids.length,
    by: !hidden && typeof item.by === 'string' && /^[\w-]{1,50}$/.test(item.by) ? item.by : null,
    time: positiveId(item.time) && item.time <= 253402300799 ? item.time : null,
    deleted: item.deleted === true, dead: item.dead === true,
    content: parsed.content, contentTruncated: parsed.truncated,
  };
}
function query(request: Request) {
  if (request.url.length > 2_048) throw new CommentsError('invalid_query', 'Comments query is too long.', 400);
  const params = new URL(request.url).searchParams;
  for (const key of params.keys()) if (!['storyId', 'parentId', 'offset', 'date', 'version'].includes(key) || params.getAll(key).length !== 1) throw new CommentsError('invalid_query', 'Invalid comments query.', 400);
  const id = (value: string | null) => {
    if (!value || !/^[1-9][0-9]{0,15}$/.test(value) || !positiveId(Number(value))) throw new CommentsError('invalid_query', 'A valid story or parent ID is required.', 400);
    return Number(value);
  };
  const storyId = id(params.get('storyId'));
  const parentId = params.has('parentId') ? id(params.get('parentId')) : storyId;
  const offsetText = params.get('offset') ?? '0';
  if (!/^(0|[1-9][0-9]{0,2})$/.test(offsetText)) throw new CommentsError('invalid_query', 'Invalid comments page.', 400);
  const offset = Number(offsetText);
  if (offset % COMMENT_LIMITS.pageSize !== 0 || offset >= COMMENT_LIMITS.maxChildren) throw new CommentsError('invalid_query', 'Invalid comments page.', 400);
  const date = params.get('date');
  if (date !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) throw new CommentsError('invalid_query', 'Invalid edition date.', 400);
  const version = params.get('version');
  if (version !== null && !/^(?:e-[a-f0-9]{24}|bundled-[a-f0-9]{16})$/.test(version)) throw new CommentsError('invalid_query', 'Invalid edition version.', 400);
  return { storyId, parentId, offset, date, version };
}
// Dependency injection is only for local tests; no request/env flag changes the
// upstream host, limits or policy. Cache entries contain only sanitized HN data.
export function createCommentsService(dependencies: Partial<Dependencies> & Pick<Dependencies,'readEdition'>) {
  const fetcher = dependencies.fetcher ?? fetch;
  const now = dependencies.now ?? Date.now;
  const readEdition = dependencies.readEdition;
  const cache = new Map<number, { item: SafeItem | null; until: number }>();
  const pending = new Map<number, Promise<SafeItem | null>>();
  let activePages = 0, upstreamActive = 0, allowance: number = COMMENT_LIMITS.burst, replenishedAt = now();
  function reserveRead() {
    const stamp = now();
    allowance = Math.min(COMMENT_LIMITS.burst, allowance + Math.max(0, stamp - replenishedAt) * COMMENT_LIMITS.readsPerMinute / 60_000);
    replenishedAt = stamp;
    if (allowance < 1 || upstreamActive >= COMMENT_LIMITS.globalConcurrency) throw new CommentsError('busy', 'Comments are busy. Please try again shortly.', 429);
    allowance--; upstreamActive++;
  }
  async function upstream(id: number): Promise<SafeItem | null> {
    reserveRead();
    const controller = new AbortController();
    const itemDeadline = Date.now() + COMMENT_LIMITS.itemMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let response: Response | undefined;
    const expires = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); void response?.body?.cancel().catch(() => {}); reject(new CommentsError('upstream_timeout', 'Hacker News took too long to respond.')); }, COMMENT_LIMITS.itemMs);
    });
    try {
      return await Promise.race([(async () => {
        response = await fetcher(`${HN_API}${id}.json`, {
          method: 'GET', redirect: 'manual', credentials: 'omit',
          headers: { Accept: 'application/json' }, signal: controller.signal,
        });
        if (!response.ok || response.redirected || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) throw new CommentsError('upstream_unavailable', 'Hacker News comments are temporarily unavailable.');
        const body = await boundedBody(response, COMMENT_LIMITS.itemBytes, Math.max(1, itemDeadline - Date.now()));
        return normalizeItem(JSON.parse(body), id, now());
      })(), expires]);
    } catch (error) {
      if (error instanceof CommentsError) throw error;
      throw new CommentsError('upstream_unavailable', 'Hacker News comments are temporarily unavailable.');
    } finally {
      clearTimeout(timer); controller.abort(); upstreamActive--;
      void response?.body?.cancel().catch(() => {});
    }
  }
  async function item(id: number): Promise<SafeItem | null> {
    const cached = cache.get(id);
    if (cached && cached.until > now()) { cache.delete(id); cache.set(id, cached); return cached.item; }
    cache.delete(id);
    const existing = pending.get(id);
    if (existing) return existing;
    const read = upstream(id).then(result => {
      cache.set(id, { item: result, until: now() + (result ? COMMENT_LIMITS.cacheMs : 10_000) });
      while (cache.size > COMMENT_LIMITS.cacheEntries) cache.delete(cache.keys().next().value!);
      return result;
    }).finally(() => { pending.delete(id); });
    pending.set(id, read);
    return read;
  }
  return async function respond(request: Request, env: Cloudflare.Env): Promise<Response> {
    const send = (value: unknown, status = 200) => new Response(request.method === 'HEAD' ? null : JSON.stringify(value), {
      status, headers: { ...responseHeaders, ...(status === 405 ? { Allow: 'GET, HEAD' } : {}), ...(status === 429 ? { 'Retry-After': '20' } : {}) },
    });
    if (!['GET', 'HEAD'].includes(request.method)) return send({ error: 'Web API mutations are disabled', code: 'method_not_allowed' }, 405);
    let storyId: number | undefined, timer: ReturnType<typeof setTimeout> | undefined, admitted = false, stopped = false;
    try {
      try { sameOriginOperation(request); } catch { throw new CommentsError('cross_origin', 'Cross-origin comments requests are not allowed.', 403); }
      const parsed = query(request); storyId = parsed.storyId;
      if (activePages >= COMMENT_LIMITS.activePages) throw new CommentsError('busy', 'Comments are busy. Please try again shortly.', 429);
      activePages++; admitted = true;
      const deadline = now() + COMMENT_LIMITS.requestMs;
      const checked = new Map<number, Promise<SafeItem | null>>();
      function checkTime() { if (stopped || now() >= deadline) throw new CommentsError('request_timeout', 'Comments took too long to load. Please try again.'); }
      const load = (id: number) => {
        checkTime();
        const existing = checked.get(id); if (existing) return existing;
        if (checked.size >= COMMENT_LIMITS.maxLookups) throw new CommentsError('request_limit', 'This discussion is too large to load here.');
        const result = item(id); checked.set(id, result); return result;
      };
      const work = async (): Promise<CommentsPage> => {
        const edition = await readEdition(request, env, parsed.date, parsed.version); checkTime();
        if (!edition || !edition.stories.some(story => story.id === parsed.storyId)) throw new CommentsError('story_not_published', 'This story is not in the selected edition.', 404);
        const root = await load(parsed.storyId); checkTime();
        if (!root || !['story', 'poll'].includes(root.type)) throw new CommentsError('invalid_story', 'This Hacker News discussion is unavailable.', 404);
        let parent = root, depth = 0;
        if (parsed.parentId !== parsed.storyId) {
          const ancestors = new Set<number>([parsed.storyId]);
          let currentId = parsed.parentId;
          while (currentId !== parsed.storyId) {
            if (ancestors.has(currentId)) throw new CommentsError('invalid_parent', 'This reply is not part of the selected discussion.', 404);
            if (depth >= COMMENT_LIMITS.maxDepth - 1) throw new CommentsError('depth_limit', 'Continue this deeper thread on Hacker News.', 400);
            ancestors.add(currentId);
            const current = await load(currentId); checkTime();
            if (!current || current.type !== 'comment' || !current.parent) throw new CommentsError('invalid_parent', 'This reply is not part of the selected discussion.', 404);
            if (depth === 0) parent = current;
            depth++;
            const ancestor = await load(current.parent); checkTime();
            if (!ancestor || !ancestor.kids.includes(currentId)) throw new CommentsError('invalid_parent', 'This reply is not part of the selected discussion.', 404);
            currentId = current.parent;
          }
        }
        if (parsed.offset > 0 && parsed.offset >= parent.kids.length) throw new CommentsError('invalid_page', 'This comments page is no longer available. Reload the discussion.', 400);
        const ids = parent.kids.slice(parsed.offset, parsed.offset + COMMENT_LIMITS.pageSize);
        const comments: ReaderComment[] = new Array(ids.length);
        let cursor = 0, sampledAt = Math.min(root.sampledAt, parent.sampledAt);
        await Promise.all(Array.from({ length: Math.min(COMMENT_LIMITS.concurrency, ids.length) }, async () => {
          while (cursor < ids.length) {
            checkTime(); const index = cursor++, id = ids[index];
            const child = await load(id); checkTime();
            if (child) sampledAt = Math.min(sampledAt, child.sampledAt);
            const available = !!child && child.type === 'comment' && child.parent === parent.id && id !== parent.id && id !== root.id;
            comments[index] = {
              id, parentId: parent.id, by: available ? child.by : null, time: available ? child.time : null,
              deleted: available && child.deleted, dead: available && child.dead, unavailable: !available,
              content: available ? child.content : [], contentTruncated: available && child.contentTruncated,
              replyCount: available ? child.childCount : 0,
              repliesAvailable: available && child.childCount > 0 && depth + 1 < COMMENT_LIMITS.maxDepth,
            };
          }
        }));
        const next = parsed.offset + ids.length;
        return {
          storyId: root.id, parentId: parent.id, depth, comments,
          page: { offset: parsed.offset, limit: COMMENT_LIMITS.pageSize, total: parent.childCount, nextOffset: next < parent.kids.length ? next : null, truncated: parent.childCount > COMMENT_LIMITS.maxChildren, partial: comments.some(comment => comment.unavailable) },
          fetchedAt: new Date(sampledAt).toISOString(), hnUrl: hnLink(root.id),
        };
      };
      const expired = new Promise<never>((_, reject) => { timer = setTimeout(() => { stopped = true; reject(new CommentsError('request_timeout', 'Comments took too long to load. Please try again.')); }, COMMENT_LIMITS.requestMs); });
      return send(await Promise.race([work(), expired]));
    } catch (error) {
      const failure = error instanceof CommentsError ? error : new CommentsError('unavailable', 'Comments are temporarily unavailable.');
      return send({ error: failure.message, code: failure.code, ...(storyId ? { hnUrl: hnLink(storyId) } : {}) }, failure.status);
    } finally {
      stopped = true; clearTimeout(timer); if (admitted) activePages--;
    }
  };
}

