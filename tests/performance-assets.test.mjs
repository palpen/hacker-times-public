import fs from'node:fs';import crypto from'node:crypto';import assert from'node:assert/strict';import{gzipSync}from'node:zlib';
const manifest=fs.readFileSync('lib/edition-assets.ts','utf8').match(/editionAssets=(.*);/)[1];const assets=JSON.parse(manifest);const js=fs.readFileSync('public/edition-assets/'+assets.js.split('/').pop()),css=fs.readFileSync('public/edition-assets/'+assets.css.split('/').pop()),font=fs.readFileSync('public/fonts/ManufacturingConsent-HackerTimes.woff2'),html=fs.readFileSync('data/prebuilt.html','utf8');
// Natural flicks and the next-page peek add no runtime fetch or dependency.
// Explicit ceilings: 15 KB / 6.3 KB reader and 22.5 KB / 4.8 KB CSS (raw/gzip).
// Budget includes independently ranked section navigation and submission-age presentation.
assert.ok(js.length<15000);assert.ok(gzipSync(js).length<6300);assert.ok(css.length<22500);assert.ok(gzipSync(css).length<4800);assert.equal(font.length,4868);assert.equal(crypto.createHash('sha256').update(font).digest('hex'),'c3f475e61938f7245ec88cf3b6f93b7342da7c3d0344d2d527b3e49615199c4d');assert.ok(!js.toString().includes('/api/edition'));assert.ok(!html.includes('_next/static'));assert.ok(html.includes('type="font/woff2" crossorigin'));assert.equal((html.match(/<h1>Hacker Times<\/h1>/g)||[]).length,1);assert.ok(css.toString().includes("Manufacturing Consent")||css.toString().includes('Manufacturing\\ Consent'));
assert.equal(new Set([...html.matchAll(/<article[^>]*data-story-id="(\d+)"/g)].map(m=>m[1])).size,34);assert.ok(!html.includes('<img')); // Public demo ships no publisher photos.
// Exercise image priority behavior with explicit test-only URLs.
const {build}=await import('esbuild');const os=await import('node:os');const path=await import('node:path');const {pathToFileURL}=await import('node:url');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ht-image-priority-'));try{const out=path.join(tmp,'renderer.mjs');await build({entryPoints:['lib/render-edition.ts'],bundle:true,platform:'node',format:'esm',outfile:out});const {renderEdition}=await import(pathToFileURL(out));const fixture=JSON.parse(fs.readFileSync('data/published-seed.json'));fixture.stories=fixture.stories.map((s,i)=>({...s,image:'https://example.org/fixture-'+i+'.png'}));const rendered=renderEdition(fixture,'test');assert.ok(rendered.includes('fetchpriority="high"'));assert.ok(rendered.includes('loading="lazy"'));}finally{fs.rmSync(tmp,{recursive:true,force:true});}
assert.ok(fs.readFileSync('public/fonts/OFL-ManufacturingConsent.txt','utf8').includes('SIL OPEN FONT LICENSE'));
console.log('PASS: reader budget, no hydration/duplicate edition fetch, exact licensed WOFF2, whole masthead, complete34-story HTML, prioritized lead/lazy lower images.');console.log(JSON.stringify({html:{raw:Buffer.byteLength(html),gzip:gzipSync(html).length},js:{raw:js.length,gzip:gzipSync(js).length},css:{raw:css.length,gzip:gzipSync(css).length},font:font.length}));

const lazyJS=fs.readFileSync('public/edition-assets/'+assets.comments.split('/').pop()),lazyCSS=fs.readFileSync('public/edition-assets/'+assets.commentsCss.split('/').pop());
assert.ok(lazyJS.length<15000);assert.ok(lazyCSS.length<6000);
assert.ok(!html.includes('src="'+assets.comments+'"'));assert.ok(!html.includes('href="'+assets.commentsCss+'"'));
assert.ok(!js.toString().includes('Live comments from Hacker News'));
console.log('PASS: drawer code/styles remain lazy, no boot fetch/module/style; separate bounded assets.');
console.log(JSON.stringify({lazyJS:{raw:lazyJS.length,gzip:gzipSync(lazyJS).length},lazyCSS:{raw:lazyCSS.length,gzip:gzipSync(lazyCSS).length}}));
