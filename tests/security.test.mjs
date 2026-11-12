import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import {build} from 'esbuild';import {pathToFileURL} from 'node:url';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ht-security-'));
async function mod(n){const outfile=path.join(tmp,n+'.mjs');await build({entryPoints:['lib/'+n+'.ts'],bundle:true,platform:'node',format:'esm',outfile});return import(pathToFileURL(outfile));}
try{
 const {publicUrl,validateEdition}=await mod('news');const {safeFetch,article}=await mod('reporting');const {boundedBody,jsonBody,secureResponse}=await mod('security');const {themeInitScript}=await mod('theme');const {renderEdition}=await mod('render-edition');
 for(const url of ['http://localhost.','https://foo.internal.','https://foo.local.','https://foo.local','https://metadata.google.internal','http://2130706433','http://0x7f000001','http://127.1','http://[::ffff:127.0.0.1]','http://192.168.0.1','https://name:password@example.com','https://example.com:444','https://foo_bar.com','https://foo.onion',' https://example.com','https://example.com\\@evil.com','https://a.example\n.com'])assert.equal(publicUrl(url),false,url);
 assert.equal(publicUrl('https://news.ycombinator.com/'),true);assert.equal(publicUrl('https://example.com/article?q=ok'),true);
 const seed=JSON.parse(fs.readFileSync('data/published-seed.json'));seed.generatedAt=new Date().toISOString();const first=seed.stories[0];
 for(const changed of [{id:-1},{score:1.5},{comments:NaN},{imageAlt:{}},{articleStatus:[]}])assert.throws(()=>validateEdition({...seed,stories:[{...first,...changed}]}));
 assert.throws(()=>validateEdition({...seed,generatedAt:'2026-11-02'}));assert.throws(()=>validateEdition({...seed,stories:[null]}));
 const body=new Request('https://site.example',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({word:'☃'.repeat(10)})});await assert.rejects(()=>jsonBody(body,25),e=>e.status===413);
 await assert.rejects(()=>jsonBody(new Request('https://site.example',{method:'POST',headers:{'content-type':'application/json-bad'},body:'{}'})),e=>e.status===415);
 await assert.rejects(()=>jsonBody(new Request('https://site.example',{method:'POST',headers:{'content-type':'application/json'},body:'[]'})),e=>e.status===400);
 await assert.rejects(()=>jsonBody(new Request('https://site.example',{method:'POST',headers:{'content-type':'application/json'},body:'{bad'})),e=>e.status===400);
 await assert.rejects(()=>boundedBody(new Response('abcdef'),5),e=>e.status===413);
 let pulls=0;const slow=new Response(new ReadableStream({pull(){pulls++;return new Promise(()=>{});}}));await assert.rejects(()=>boundedBody(slow,5,10),e=>e.status===408);
 const previousFetch=globalThis.fetch;const calls=[];
 try{globalThis.fetch=async(url,options)=>{calls.push({url,options});return new Response(null,{status:302,headers:{location:'http://localhost./secret'}});};await assert.rejects(()=>safeFetch('https://example.com'));assert.equal(calls.length,1);assert.equal(calls[0].options.redirect,'manual');assert.deepEqual(Object.keys(calls[0].options.headers).sort(),['accept','user-agent']);await assert.rejects(()=>safeFetch('https://example-installation.chatgpt.site/api/candidates'));assert.equal(calls.length,1);
 let n=0;globalThis.fetch=async()=>++n===1?new Response(null,{status:302,headers:{location:'https://publisher.example/sub/article'}}):new Response('<title>Title &#99999999;</title><meta property="og:image" content="photo.jpg"><article>Text.</article>',{headers:{'content-type':'text/html'}});const a=await article('https://example.com/original');assert.equal(a.articleStatus,'fetched');assert.deepEqual(a.imageCandidates,['https://publisher.example/sub/photo.jpg']);
 // Legacy HTML bytes must decode without weakening strict API JSON decoding.
 const legacy=new Uint8Array([...Buffer.from('<article>Caf'),0xe9,...Buffer.from(' and '),0x93,...Buffer.from('fictional'),0x94,...Buffer.from(' archives.</article>')]);
 for(const contentType of ['text/html','text/html; charset=windows-1252']){
  globalThis.fetch=async()=>new Response(legacy,{headers:{'content-type':contentType}});
  const decoded=await article('https://fictional.example/legacy');assert.equal(decoded.articleStatus,'fetched');assert.equal(decoded.excerpt,'Café and “fictional” archives.');
 }
 globalThis.fetch=async()=>new Response('<meta charset="utf-8"><article>Fictional 雪 archive.</article>',{headers:{'content-type':'text/html'}});
 assert.equal((await article('https://fictional.example/utf8')).excerpt,'Fictional 雪 archive.');
 await assert.rejects(()=>boundedBody(new Response(new Uint8Array([0xff])),10));
 }finally{globalThis.fetch=previousFetch;}
 const evil='</script><script>alert(1)</script><img src=x onerror="evil()">';const story={...first,headline:evil,summary:evil,publisher:evil,imageAlt:evil,imageCredit:evil};const html=renderEdition({...seed,stories:[story]},'test');assert.equal(html.includes('<script>alert(1)'),false);assert.ok(html.includes('&lt;script&gt;alert(1)'));assert.ok(html.includes('\\u003c/script\\u003e'));
 const response=await secureResponse(new Response(html,{headers:{'content-type':'text/html','cache-control':'private, no-store'}}));const csp=response.headers.get('content-security-policy');const hash=crypto.createHash('sha256').update(themeInitScript).digest('base64');assert.ok(csp.includes("'sha256-"+hash+"'"));assert.ok(!csp.includes('unsafe-inline'));assert.ok(csp.includes("connect-src 'self'"));assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 console.log('PASS: URL canonicalization/private aliases, redirect revalidation/no credential forwarding, source bounds/final-URL metadata, integer/object validation, streamed byte+time limits, escaped malicious copy/JSON, exact theme CSP hash and restrictive security headers.');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
