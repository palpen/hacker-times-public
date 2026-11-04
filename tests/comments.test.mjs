import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ht-comments-'));
try {
  const compiled = path.join(temp, 'comments.mjs');
  await build({ entryPoints: ['lib/comments.ts'], bundle: true, platform: 'node', format: 'esm', loader: { '.md': 'text', '.html': 'text' }, outfile: compiled });
  const { createCommentsService, sanitizeCommentHTML, COMMENT_LIMITS: limits } = await import(pathToFileURL(compiled));
  const rootId = 100;
  const root = (kids = [], extra = {}) => ({ id: rootId, type: 'story', kids, ...extra });
  const comment = (id, parent = rootId, extra = {}) => ({ id, type: 'comment', parent, by: 'valid_user-1', time: 1730000000, text: `<p>Comment ${id}`, ...extra });
  const req = (query = 'storyId=100', init = {}) => new Request(`https://paper.example/api/comments?${query}`, init);
  const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  const fixture = (items = {}, overrides = {}) => {
    const calls = []; let active = 0, maxActive = 0, reads = 0;
    const service = createCommentsService({
      readEdition: async () => { reads++; return { stories: [{ id: rootId }] }; },
      fetcher: async (url, options) => {
        calls.push({ url, options }); active++; maxActive = Math.max(maxActive, active);
        await new Promise(resolve => setTimeout(resolve, 1));
        active--; return json(items[Number(/\/(\d+)\.json$/.exec(url)[1])] ?? null);
      }, ...overrides,
    });
    return { service, calls, stats: () => ({ maxActive, reads }) };
  };
  const invoke = async (service, query, init) => { const response = await service(req(query, init), {}); return { response, data: init?.method === 'HEAD' ? null : await response.json() }; };
  const flattened = tokens => tokens.map(token => token.type === 'text' ? token.text : token.children ? flattened(token.children) : '\n').join('');
  function safeTree(tokens, depth = 0) {
    assert.ok(depth < limits.tokenDepth);
    for (const token of tokens) {
      assert.ok(['text', 'br', 'p', 'em', 'strong', 'code', 'pre', 'a'].includes(token.type));
      assert.deepEqual(Object.keys(token).sort(), (token.type === 'text' ? ['type', 'text'] : token.type === 'br' ? ['type'] : token.type === 'a' ? ['type', 'href', 'children'] : ['type', 'children']).sort());
      if (token.type === 'a') { const url = new URL(token.href); assert.ok(['http:', 'https:'].includes(url.protocol)); assert.equal(url.username, ''); }
      if (token.children) safeTree(token.children, depth + 1);
    }
  }
  {
    const input = `Hello &amp; goodbye<p>New <i>emphasis</i> and <b>bold</b><p><pre><code>&lt;safe&gt;\n x=1</code></pre><a href="/item?id=1">thread</a><br>End &#x1f642; &#1114112;`;
    const parsed = sanitizeCommentHTML(input); safeTree(parsed.content);
    assert.equal(parsed.truncated, false);
    assert.match(flattened(parsed.content), /Hello & goodbye/);
    assert.match(flattened(parsed.content), /<safe>\n x=1/);
    assert.match(flattened(parsed.content), /🙂 �/);
    assert.equal(parsed.content.filter(token => token.type === 'p').length, 2);
    assert.ok(JSON.stringify(parsed.content).includes('https://news.ycombinator.com/item?id=1'));
  }
  {
    const threats = [
      '<script>alert(document.cookie)</script><p>kept', '<style>body{display:none}</style>kept',
      '<iframe src="https://tracker.example">private</iframe>kept', '<svg onload=alert(1)><a href="https://evil.example">bad</a></svg>kept',
      '<math><mtext><img src=x onerror=alert(1)></mtext></math>kept', '<!-- hidden -->kept',
      '<object><embed src=x>bad</object>kept', '<template><p>bad</template>kept',
      '<img src="https://tracker.example/secret" onerror="alert(1)">kept',
      '<p style="color:red" onclick="alert(1)">kept</p>', '<a href="javascript:alert(1)">kept</a>',
      '<a href="JaVaScRiPt:alert(1)">kept</a>', '<a href="&#106;avascript:alert(1)">kept</a>',
      '<a href="java&#x09;script:alert(1)">kept</a>', '<a href="data:text/html;base64,AA==">kept</a>',
      '<a href="https://user:password@safe.example">kept</a>', '<a href="http://127.0.0.1/">kept</a>',
      '<a href="http://0x7f000001/">kept</a>', '<a href="file:///etc/passwd">kept</a>',
      '<a href="https://localhost/">kept</a>', '<a href="https://safe.example:8443/">kept</a>',
      '<a href="https://safe.example" href="javascript:alert(1)">kept</a>',
      '<a href="javascript:alert(1)" onmouseover="x">kept</a>',
      '<p><strong><em>kept</p></strong></em>', '<p><a href="https://safe.example">kept</p>',
      '<p>kept<a href="unterminated', '<p>kept<img/src=x/onerror=alert(1)>',
    ];
    for (const html of threats) {
      const parsed = sanitizeCommentHTML(html); safeTree(parsed.content);
      assert.ok(flattened(parsed.content).includes('kept'), html);
      assert.ok(!JSON.stringify(parsed.content).includes('tracker.example'), html);
      assert.ok(!flattened(parsed.content).includes('alert('), html);
    }
    for (const html of ['<a href="vbscript:x">x</a>', '<a href="https:\\evil.example">x</a>', '<a href="//localhost">x</a>', '<a href="mailto:private@example.com">x</a>']) {
      const tree = sanitizeCommentHTML(html).content; safeTree(tree); assert.ok(!JSON.stringify(tree).includes('"type":"a"'));
    }
    assert.equal(sanitizeCommentHTML('x'.repeat(limits.textLength + 1)).truncated, true);
    assert.equal(flattened(sanitizeCommentHTML('x'.repeat(limits.textLength + 1)).content).length, limits.textLength);
    assert.equal(sanitizeCommentHTML('<br>'.repeat(limits.tokenCount + 1)).content.length, limits.tokenCount);
    assert.equal(sanitizeCommentHTML('<em>'.repeat(40) + 'deep' + '</em>'.repeat(40)).truncated, true);
    safeTree(sanitizeCommentHTML('<em>'.repeat(40) + 'deep' + '</em>'.repeat(40)).content);
  }
  {
    const f = fixture({ 100: root([8, 3, 5, 7, 8]), 8: comment(8), 3: comment(3, 100, { deleted: true, text: 'deleted secret', kids: [31] }), 5: comment(5, 100, { dead: true, text: 'dead secret' }) });
    const { response, data } = await invoke(f.service, undefined, { headers: { Cookie: 'secret=1', Authorization: 'Bearer private', 'OAI-Sites-Authorization': 'secret', 'oai-authenticated-user-email': 'owner@example.com' } });
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store'); assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.deepEqual(data.comments.map(c => c.id), [8, 3, 5, 7]); assert.equal(data.parentId, rootId); assert.equal(data.depth, 0);
    assert.equal(data.comments[1].deleted, true); assert.equal(data.comments[1].replyCount, 1); assert.equal(data.comments[1].repliesAvailable, true); assert.deepEqual(data.comments[1].content, []);
    assert.equal(data.comments[2].dead, true); assert.deepEqual(data.comments[2].content, []); assert.equal(data.comments[3].unavailable, true); assert.equal(data.page.partial, true);
    assert.equal(data.page.total, 4); assert.equal(data.hnUrl, 'https://news.ycombinator.com/item?id=100'); assert.ok(!JSON.stringify(data).includes('secret')); assert.ok(!('score' in data.comments[0]));
    for (const { url, options } of f.calls) {
      assert.match(url, /^https:\/\/hacker-news\.firebaseio\.com\/v0\/item\/[1-9][0-9]*\.json$/);
      assert.deepEqual(options.headers, { Accept: 'application/json' }); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'manual'); assert.equal(options.method, 'GET');
    }
    const before = f.calls.length; await invoke(f.service); assert.equal(f.calls.length, before, 'successful and missing items are cached');
    const head = await f.service(req(undefined, { method: 'HEAD' }), {}); assert.equal(head.status, 200); assert.equal(await head.text(), '');
  }
  {
    const f = fixture({ 100: root() });
    const invalid = ['', 'storyId=0', 'storyId=-1', 'storyId=1.2', 'storyId=1e2', 'storyId=01', 'storyId=9007199254740992', 'storyId=https://evil.example', 'storyId=100&storyId=101', 'storyId=100&url=https://evil.example', 'storyId=100&parentId=0', 'storyId=100&offset=1', 'storyId=100&offset=600', 'storyId=100&offset=-12', 'storyId=100&offset=00', 'storyId=100&date=2026-02-30', 'storyId=100&date=', 'storyId=100&date=2026-11-03&date=2026-11-02', 'storyId=100&' + 'x'.repeat(2048)];
    for (const query of invalid) assert.equal((await invoke(f.service, query)).response.status, 400, query);
    assert.equal(f.calls.length, 0); assert.equal(f.stats().reads, 0);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) assert.equal((await invoke(f.service, undefined, { method })).response.status, 405);
    for (const headers of [{ Origin: 'https://evil.example' }, { 'Sec-Fetch-Site': 'cross-site' }]) assert.equal((await invoke(f.service, undefined, { headers })).response.status, 403);
    assert.equal(f.calls.length, 0);
    assert.equal((await invoke(f.service, 'storyId=101')).response.status, 404); assert.equal(f.calls.length, 0);
    const sameOrigin = await invoke(f.service, undefined, { headers: { Origin: 'https://paper.example' } }); assert.equal(sameOrigin.response.status, 200);
  }
  {
    for (const type of ['comment', 'job', 'pollopt']) {
      const f = fixture({ 100: root([], { type }) }); assert.equal((await invoke(f.service)).response.status, 404);
    }
    const poll = fixture({ 100: root([], { type: 'poll' }) }); assert.equal((await invoke(poll.service)).response.status, 200);
    const missing = fixture(); assert.equal((await invoke(missing.service)).response.status, 404);
    let seenDate;
    const archived = fixture({ 100: root() }, { readEdition: async (_request, _env, date) => { seenDate = date; return date === '2026-11-02' ? { stories: [{ id: 100 }] } : null; } });
    assert.equal((await invoke(archived.service, 'storyId=100&date=2026-11-02')).response.status, 200); assert.equal(seenDate, '2026-11-02');
    assert.equal((await invoke(archived.service, 'storyId=100&date=2026-11-01')).response.status, 404);
  }
  {
    // A displayed immutable edition remains eligible after the same UTC day's
    // hourly publication changes; neither unknown versions nor private keys
    // are allowed to turn this endpoint into an arbitrary HN/storage reader.
    const versionA = 'e-' + 'a'.repeat(24), versionB = 'e-' + 'b'.repeat(24), unknownVersion = 'e-' + 'f'.repeat(24);
    const editionA = { generatedAt: '2026-11-03T10:00:00.000Z', editionDate: '2026-11-03', stories: [{ id: 100 }] };
    const editionB = { ...editionA, generatedAt: '2026-11-03T11:00:00.000Z', stories: [{ id: 101 }] };
    const record = (version, edition) => ({ version, edition, html: `<!doctype html><meta content="${version}">` });
    const recordA = record(versionA, editionA), recordB = record(versionB, editionB);
    let current = recordA; const storageReads = [], upstreamReads = [];
    const objects = new Map([[`publication/versions/${versionA}.json`, recordA], [`publication/versions/${versionB}.json`, recordB]]);
    const env = { BUCKET: { get: async key => {
      storageReads.push(key);
      const value = key === 'publication/current.json' ? { schema: 1, current, archives: { '2026-11-03': current.version } } : objects.get(key);
      return value ? { json: async () => structuredClone(value) } : null;
    } } };
    const service = createCommentsService({ fetcher: async url => { upstreamReads.push(url); const id = Number(/\/(\d+)\.json$/.exec(url)[1]); return json({ id, type: 'story', kids: [] }); } });
    const get = async query => { const response = await service(req(query), env); return { response, data: await response.json() }; };
    assert.equal((await get('storyId=100&date=2026-11-03')).response.status, 200);
    current = recordB;
    assert.equal((await get('storyId=100&date=2026-11-03')).response.status, 404, 'hourly edition B no longer contains story X');
    assert.equal((await get(`storyId=100&version=${versionA}`)).response.status, 200, 'displayed immutable A still allows X');
    assert.equal((await get(`storyId=100&date=2026-11-03&version=${versionA}`)).response.status, 200);
    const before = upstreamReads.length;
    for (const query of [`storyId=100&version=${versionB}`, `storyId=100&version=${unknownVersion}`, `storyId=100&date=2026-11-02&version=${versionA}`, 'storyId=100&version=bundled-ffffffffffffffff']) assert.equal((await get(query)).response.status, 404, query);
    assert.equal(upstreamReads.length, before, 'unknown version/wrong membership/date never fetches HN');
    const readsBeforeInvalid = storageReads.length;
    for (const version of ['', 'publication/current.json', '../current.json', versionA + '/../../private', 'https://evil.example', 'e-' + 'A'.repeat(24), 'legacy-2026-11-03', 'e-' + 'a'.repeat(23)]) assert.equal((await get('storyId=100&version=' + encodeURIComponent(version))).response.status, 400, version);
    assert.equal((await get(`storyId=100&version=${versionA}&version=${versionA}`)).response.status, 400);
    assert.equal(storageReads.length, readsBeforeInvalid, 'invalid versions never reach storage');
    assert.equal(upstreamReads.length, before);
    objects.set(`publication/versions/${unknownVersion}.json`, recordA);
    assert.equal((await get(`storyId=100&version=${unknownVersion}`)).response.status, 404, 'stored record must match its exact immutable key');
    objects.set(`publication/versions/${unknownVersion}.json`, record(unknownVersion, { ...editionA, generatedAt: 'invalid' }));
    assert.equal((await get(`storyId=100&version=${unknownVersion}`)).response.status, 404);
    assert.equal(upstreamReads.length, before);
    const monthlyVersion = 'e-' + 'c'.repeat(24);
    const monthlyEdition = { ...editionA, schemaVersion: 1, layoutVersion: 2, stories: Array.from({ length: 42 }, (_, index) => ({ id: 500 + index })) };
    objects.set(`publication/versions/${monthlyVersion}.json`, record(monthlyVersion, monthlyEdition));
    assert.equal((await get(`storyId=541&version=${monthlyVersion}`)).response.status, 200, 'full layout-2 monthly edition supports its 42nd story');
    const readsBeforeInvalidSchema = upstreamReads.length;
    for (const invalidEdition of [{ ...monthlyEdition, schemaVersion: 2 }, { ...monthlyEdition, layoutVersion: 999 }, { ...monthlyEdition, layoutVersion: null }, { ...monthlyEdition, layoutVersion: 1 }, { ...monthlyEdition, layoutVersion: 2, stories: [...monthlyEdition.stories, { id: 542 }] }]) {
      objects.set(`publication/versions/${monthlyVersion}.json`, record(monthlyVersion, invalidEdition));
      assert.equal((await get(`storyId=541&version=${monthlyVersion}`)).response.status, 404, 'unsupported schema/layout or capacity is rejected');
    }
    assert.equal(upstreamReads.length, readsBeforeInvalidSchema);
    const legacyVersion = 'e-' + 'd'.repeat(24);
    objects.set(`publication/versions/${legacyVersion}.json`, record(legacyVersion, { ...editionA, stories: Array.from({ length: 34 }, (_, index) => ({ id: 700 + index })) }));
    assert.equal((await get(`storyId=733&version=${legacyVersion}`)).response.status, 200, 'schema/layout-less legacy 34-story versions remain readable');
    const bundled = JSON.parse(fs.readFileSync('data/prebuilt-version.json', 'utf8'));
    const seed = JSON.parse(fs.readFileSync('data/published-seed.json', 'utf8'));
    assert.equal((await get(`storyId=${seed.stories[0].id}&version=${bundled.version}`)).response.status, 200, 'exact shipped bundled snapshot survives newer publication');
    assert.ok(storageReads.every(key => key === 'publication/current.json' || /^publication\/versions\/e-[a-f0-9]{24}\.json$/.test(key)), 'no arbitrary public storage key');
  }
  {
    const kids = Array.from({ length: 25 }, (_, index) => index + 200);
    const items = Object.fromEntries(kids.map(id => [id, comment(id)])); items[100] = root(kids);
    const f = fixture(items);
    for (const [offset, count, next] of [[0, 12, 12], [12, 12, 24], [24, 1, null]]) {
      const { data, response } = await invoke(f.service, `storyId=100&offset=${offset}`);
      assert.equal(response.status, 200); assert.equal(data.comments.length, count); assert.equal(data.page.nextOffset, next); assert.equal(data.page.total, 25); assert.deepEqual(data.comments.map(c => c.id), kids.slice(offset, offset + 12));
    }
    assert.ok(f.stats().maxActive <= limits.concurrency); assert.ok(f.stats().maxActive > 1);
    assert.equal((await invoke(f.service, 'storyId=100&offset=36')).response.status, 400);
    const hugeKids = Array.from({ length: 601 }, (_, index) => index + 1000);
    const hugeItems = Object.fromEntries(hugeKids.slice(588, 600).map(id => [id, comment(id)])); hugeItems[100] = root(hugeKids);
    const large = fixture(hugeItems); const last = await invoke(large.service, 'storyId=100&offset=588');
    assert.equal(last.response.status, 200); assert.equal(last.data.page.total, 601); assert.equal(last.data.page.nextOffset, null); assert.equal(last.data.page.truncated, true);
  }
  {
    const items = { 100: root([200]), 200: comment(200, 100, { kids: [201] }), 201: comment(201, 200, { kids: [202] }), 202: comment(202, 201) };
    const f = fixture(items); const nested = await invoke(f.service, 'storyId=100&parentId=201');
    assert.equal(nested.response.status, 200); assert.equal(nested.data.parentId, 201); assert.equal(nested.data.depth, 2); assert.equal(nested.data.comments[0].parentId, 201);
    const foreign = fixture({ ...items, 300: comment(300, 999), 999: { id: 999, type: 'story', kids: [300] } });
    assert.equal((await invoke(foreign.service, 'storyId=100&parentId=300')).response.status, 404);
    const mismatch = fixture({ ...items, 300: comment(300, 100) }); assert.equal((await invoke(mismatch.service, 'storyId=100&parentId=300')).response.status, 404);
    const cycle = fixture({ 100: root(), 200: comment(200, 201, { kids: [201] }), 201: comment(201, 200, { kids: [200] }) });
    const cyclic = await invoke(cycle.service, 'storyId=100&parentId=200'); assert.equal(cyclic.response.status, 404); assert.equal(cyclic.data.code, 'invalid_parent'); assert.equal(cycle.calls.length, 3);
    const self = fixture({ 100: root([100, 200]), 200: comment(200, 555) }); const badChildren = await invoke(self.service); assert.ok(badChildren.data.comments.every(c => c.unavailable));
    const deepItems = { 100: root([200]) };
    for (let depth = 1; depth <= 9; depth++) deepItems[199 + depth] = comment(199 + depth, depth === 1 ? 100 : 198 + depth, { kids: [200 + depth] });
    const deep = fixture(deepItems);
    const eighth = await invoke(deep.service, 'storyId=100&parentId=206'); assert.equal(eighth.response.status, 200); assert.equal(eighth.data.depth, 7); assert.equal(eighth.data.comments[0].replyCount, 1); assert.equal(eighth.data.comments[0].repliesAvailable, false);
    const tooDeep = await invoke(deep.service, 'storyId=100&parentId=207'); assert.equal(tooDeep.response.status, 400); assert.equal(tooDeep.data.code, 'depth_limit');
    const wideDeep = { ...deepItems }; wideDeep[206] = comment(206, 205, { kids: Array.from({ length: 12 }, (_, n) => 300 + n) });
    for (let n = 0; n < 12; n++) wideDeep[300 + n] = comment(300 + n, 206);
    const budget = fixture(wideDeep); assert.equal((await invoke(budget.service, 'storyId=100&parentId=206')).response.status, 200); assert.equal(budget.calls.length, 20); assert.ok(budget.calls.length <= limits.maxLookups);
  }
  {
    let stamp = Date.parse('2026-11-03T00:00:00Z');
    const f = fixture({ 100: root([200]), 200: comment(200) }, { now: () => stamp });
    await Promise.all([invoke(f.service), invoke(f.service), invoke(f.service)]); assert.equal(f.calls.length, 2, 'in-flight items are deduplicated');
    const originalTime = (await invoke(f.service)).data.fetchedAt; stamp += 30_000;
    assert.equal((await invoke(f.service)).data.fetchedAt, originalTime, 'cache does not pretend to be freshly fetched'); assert.equal(f.calls.length, 2);
    stamp += limits.cacheMs; await invoke(f.service); assert.equal(f.calls.length, 4);
    let expiryStamp = stamp;
    const missing = fixture({ 100: root([200]) }, { now: () => expiryStamp }); await invoke(missing.service); expiryStamp += 10_001; await invoke(missing.service); assert.equal(missing.calls.length, 3);
  }
  {
    let stamp = Date.parse('2026-11-03T00:00:00Z'), calls = 0;
    const kids = Array.from({ length: 200 }, (_, n) => 1000 + n);
    const service = createCommentsService({ now: () => stamp, readEdition: async () => ({ stories: [{ id: 100 }] }), fetcher: async url => { calls++; stamp += 300; const id = Number(/\/(\d+)\.json$/.exec(url)[1]); return json(id === 100 ? root(kids) : comment(id)); } });
    for (let offset = 0; offset < 132; offset += 12) assert.equal((await invoke(service, `storyId=100&offset=${offset}`)).response.status, 200);
    assert.equal(calls, 133); await invoke(service); assert.ok(calls > 133, 'bounded LRU evicts oldest children even inside TTL');
  }
  {
    const invalidResponses = [
      () => new Response('redirect', { status: 302, headers: { Location: 'https://evil.example' } }),
      () => new Response('{}', { headers: { 'Content-Type': 'text/html' } }),
      () => new Response('oops', { headers: { 'Content-Type': 'application/json' } }),
      () => json([]), () => json({ ...root(), id: 101 }), () => json(root([-1])),
      () => new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Length': String(limits.itemBytes + 1) } }),
      () => json({ ...root(), text: 'x'.repeat(limits.itemBytes) }),
      () => Promise.reject(new Error('secret upstream URL or private credential')),
    ];
    for (const response of invalidResponses) {
      let calls = 0; const f = fixture({}, { fetcher: async () => { calls++; return response(); } });
      const result = await invoke(f.service); assert.equal(result.response.status, 503); assert.equal(result.data.hnUrl, 'https://news.ycombinator.com/item?id=100'); assert.ok(!JSON.stringify(result.data).includes('secret'));
      await invoke(f.service); assert.equal(calls, 2, 'failed upstream reads are not cached');
    }
    let canceled = false;
    const stream = fixture({}, { fetcher: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(limits.itemBytes)); controller.enqueue(new Uint8Array(1)); }, cancel() { canceled = true; } }), { headers: { 'Content-Type': 'application/json' } }) });
    assert.equal((await invoke(stream.service)).response.status, 503); assert.equal(canceled, true);
  }
  {
    // Accelerated real timers verify both timeout races without slowing the suite.
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (callback, delay, ...args) => realSetTimeout(callback, delay === limits.itemMs || delay === limits.requestMs ? (delay === limits.itemMs ? 10 : 40) : delay, ...args);
    try {
      let aborted = false;
      const hung = fixture({}, { fetcher: async (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => { aborted = true; reject(Error('aborted')); })) });
      const timeout = await invoke(hung.service); assert.equal(timeout.response.status, 503); assert.equal(timeout.data.code, 'upstream_timeout'); assert.equal(aborted, true);
      const childHang = fixture({}, { fetcher: async url => url.endsWith('/100.json') ? json(root([200])) : new Promise(() => {}) });
      const childTimeout = await invoke(childHang.service); assert.equal(childTimeout.response.status, 503); assert.equal(childTimeout.data.code, 'upstream_timeout'); assert.equal(childTimeout.data.comments, undefined, 'a failed child is not returned as an empty/complete page');
      let release; let fetched = false;
      const editionHang = fixture({}, { readEdition: async () => new Promise(resolve => { release = resolve; }), fetcher: async () => { fetched = true; return json(root()); } });
      const deadline = await invoke(editionHang.service); assert.equal(deadline.response.status, 503); assert.equal(deadline.data.code, 'request_timeout');
      release({ stories: [{ id: 100 }] }); await new Promise(resolve => realSetTimeout(resolve, 5)); assert.equal(fetched, false, 'timed out requests cannot start late upstream work');
    } finally { globalThis.setTimeout = realSetTimeout; }
  }
  {
    let stamp = 1_800_000_000_000;
    const kids = Array.from({ length: 120 }, (_, n) => 1000 + n);
    const items = Object.fromEntries(kids.map(id => [id, comment(id)])); items[100] = root(kids);
    const f = fixture(items, { now: () => stamp });
    let throttled = false;
    for (let offset = 0; offset < kids.length; offset += 12) {
      const result = await invoke(f.service, `storyId=100&offset=${offset}`);
      if (result.response.status === 429) { throttled = true; assert.equal(result.response.headers.get('retry-after'), '20'); break; }
    }
    assert.equal(throttled, true); assert.ok(f.calls.length <= limits.burst);
    stamp += 60_000; assert.equal((await invoke(f.service, 'storyId=100&offset=108')).response.status, 200, 'rate bucket replenishes');
    let release; const gate = new Promise(resolve => { release = resolve; });
    const busy = fixture({}, { readEdition: async () => { await gate; return { stories: [{ id: 100 }] }; } });
    const running = Array.from({ length: limits.activePages }, () => invoke(busy.service));
    assert.equal((await invoke(busy.service)).response.status, 429); release(); await Promise.all(running);
  }
  {
    let release, active = 0, peak = 0;
    const gate = new Promise(resolve => { release = resolve; });
    const ids = Array.from({ length: 6 }, (_, index) => 100 + index);
    const service = createCommentsService({
      readEdition: async () => ({ stories: ids.map(id => ({ id })) }),
      fetcher: async url => {
        const id = Number(/\/(\d+)\.json$/.exec(url)[1]); active++; peak = Math.max(active, peak);
        try {
          if (ids.includes(id)) return json({ id, type: 'story', kids: Array.from({ length: 12 }, (_, n) => id * 100 + n) });
          await gate; return json(comment(id, Math.floor(id / 100)));
        } finally { active--; }
      },
    });
    const running = ids.map(id => invoke(service, `storyId=${id}`));
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.ok(peak <= limits.globalConcurrency); assert.equal(peak, limits.globalConcurrency);
    release(); const results = await Promise.all(running);
    assert.ok(results.some(result => result.response.status === 429));
    assert.ok(results.every(result => [200, 429].includes(result.response.status)));
  }
  {
    // Integration checks: new route is read-only and does not activate editor routes.
    const apiFile = path.join(temp, 'api.mjs');
    await build({ entryPoints: ['lib/api.ts'], bundle: true, platform: 'node', format: 'esm', loader: { '.md': 'text', '.html': 'text' }, outfile: apiFile });
    const { newsApi } = await import(pathToFileURL(apiFile));
    let reads = 0, writes = 0; const env = { BUCKET: { get: async () => { reads++; return null; }, put: async () => { writes++; } } };
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      for (const route of ['comments', 'edition', 'rebuild', 'candidates']) {
        const response = await newsApi(new Request(`https://paper.example/api/${route}`, { method, headers: { 'oai-authenticated-user-id': 'owner', 'oai-authenticated-user-email': 'owner@example.com', 'OAI-Sites-Authorization': 'forged' } }), env); assert.equal(response.status, 405);
      }
    }
    for (const route of ['workflow', 'candidates', 'rebuild']) assert.equal((await newsApi(new Request(`https://paper.example/api/${route}`), env)).status, 404);
    assert.equal((await newsApi(req('storyId=0'), env)).status, 400); assert.equal(reads, 0); assert.equal(writes, 0);
  }
  console.log('PASS: safe comment AST and URLs; read-only fixed-origin credentialless API; current/archive/immutable-version allowlist; threading/order/deleted/dead/missing; bounded pages/depth/ancestry/cycles/body/time/fetches/concurrency/cache/dedup/rate; unchanged web editor boundary.');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
