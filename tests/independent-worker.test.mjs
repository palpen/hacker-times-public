import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

test('synthetic Worker cannot read real state even if bindings or forged identity are supplied', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ht-independent-'));
  const oldFetch = globalThis.fetch;
  try {
    const out = path.join(dir, 'worker.mjs');
    const built = await build({entryPoints:['worker/independent.ts'], outfile:out, bundle:true, platform:'node', format:'esm', metafile:true});
    assert.ok(!Object.keys(built.metafile.inputs).some(p=>/lib\/(publication|api|storage|comments-api)\.|data\//.test(p)), 'no production-data modules bundled');
    const worker = (await import(pathToFileURL(out))).default;
    globalThis.fetch = async () => { throw Error('Network forbidden'); };
    const env = new Proxy({}, { get() { throw Error('Environment access forbidden'); } });
    const request = (pathname, method='GET') => new Request('https://reader.example'+pathname,{method,headers:{'oai-authenticated-user-email':'owner@example.com',authorization:'Bearer forged',cookie:'session=forged'}});
    for (const route of ['/mcp','/publishing','/api/publish','/api/rebuild','/api/candidates','/signin-with-chatgpt']) {
      for (const method of ['GET','POST']) assert.equal((await worker.fetch(request(route,method),env)).status,404);
    }
    for (const method of ['POST','PUT','PATCH','DELETE']) assert.equal((await worker.fetch(request('/',method),env)).status,404);
    const response = await worker.fetch(request('/?refresh=1&date=2099-01-01'),env);
    assert.equal(response.status,200);
    assert.equal(response.headers.get('X-Edition-Version'),'synthetic-preview-v1');
    assert.equal(response.headers.get('X-Robots-Tag'),'noindex, nofollow');
    assert.match(response.headers.get('Content-Security-Policy'),/default-src 'none'/);
    assert.match(await response.text(),/SYNTHETIC PREVIEW/);
    assert.equal(await (await worker.fetch(request('/','HEAD'),env)).text(),'');
    const edition=await (await worker.fetch(request('/api/edition'),env)).json();
    assert.equal(edition.synthetic,true);
    assert.ok(edition.stories.every(s=>s.articleStatus==='synthetic_demo' && s.url.startsWith('https://example.org/')));
    assert.deepEqual(await (await worker.fetch(request('/api/archive?date=2099-01-01'),env)).json(),{dates:[],synthetic:true});
    assert.equal((await worker.fetch(request('/api/comments?id=1'),env)).status,404);
    assert.equal((await (await worker.fetch(request('/healthz'),env)).json()).productionData,false);
    // Supplying the former restoration controls cannot enable real-data access.
    const trap={get:()=>{throw Error('storage touched');}};
    const injected={BUCKET:trap,RESTORED_PUBLICATION_VERSION:'real-version'};
    assert.deepEqual(await (await worker.fetch(request('/api/edition'),injected)).json(),edition);
    const config=fs.readFileSync('vite.cloudflare.config.ts','utf8');
    assert.doesNotMatch(config,/r2_buckets|d1_databases|RESTORED_PUBLICATION_VERSION|vinext/);
  } finally {
    globalThis.fetch=oldFetch;
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
