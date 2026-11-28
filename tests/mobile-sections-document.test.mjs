import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {cloudflareNode} from './fixtures/cloudflare-node.mjs';

test('current and retained editions get one mobile stylesheet and reader without mutating saved records',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ht-mobile-sections-'));
 try{
  const out=path.join(dir,'bundle.mjs');
  await build({stdin:{resolveDir:process.cwd(),contents:`
    export {withMobileSections,mobileSectionsAssets} from './lib/mobile-sections-document';
    export {renderEdition} from './lib/render-edition';
    export {editionAssets} from './lib/edition-assets';
    export {default as worker} from './worker/production';`},outfile:out,bundle:true,platform:'node',format:'esm',plugins:[cloudflareNode]});
  const {withMobileSections,mobileSectionsAssets,renderEdition,editionAssets,worker}=await import(pathToFileURL(out));
  const version='e-'+'a'.repeat(24),edition=JSON.parse(fs.readFileSync('data/published-seed.json'));
  const current=renderEdition(edition,version),oldPaper='/reader-assets/paper-478d1c01f5113ae5.css';
  const retained=current.replace(mobileSectionsAssets(),'').replace(editionAssets.css,oldPaper).replace(editionAssets.js,'/reader-assets/reader-0000000000000000.js');
  const upgraded=withMobileSections(retained);
  assert.equal(upgraded,current.replace(editionAssets.css,oldPaper).replace(editionAssets.js,'/reader-assets/reader-0000000000000000.js'));
  assert.equal(withMobileSections(upgraded),upgraded);
  assert.equal(withMobileSections(current),current);
  assert.equal(withMobileSections('<html><head></head><body>Unrelated</body></html>'),'<html><head></head><body>Unrelated</body></html>');
  const publication={version,edition,html:retained},before=structuredClone(publication),reads=[];
  const env={NEWSROOM:{idFromName:x=>x,get:()=>({fetch:async req=>{
   assert.equal(new URL(req.url).pathname,'/edition');reads.push(await req.json());return Response.json(publication);
  }})}};
  for(const route of ['/', '/?date=2024-01-01']){
   const response=await worker.fetch(new Request('https://reader.example'+route),env);
   assert.equal(response.status,200);
   assert.equal(response.headers.get('X-Edition-Version'),version);
   assert.equal(await response.text(),upgraded);
  }
  for(const [asset,contentType] of [[editionAssets.mobileSectionsCss,'text/css; charset=utf-8'],[editionAssets.mobileSectionsJs,'text/javascript; charset=utf-8']]){
   const response=await worker.fetch(new Request('https://reader.example'+asset),env);
   assert.equal(response.status,200);
   assert.equal(response.headers.get('Content-Type'),contentType);
   assert.match(response.headers.get('Cache-Control'),/immutable/);
  }
  for(const key of ['mobileSectionsCss','mobileSectionsJs']){
   const size=fs.statSync('public/edition-assets/'+editionAssets[key].split('/').at(-1)).size;
   assert.ok(size<3500,key+' stays below 3.5 KB');
  }
  const api=await worker.fetch(new Request('https://reader.example/api/edition'),env);
  assert.deepEqual(await api.json(),{...edition,publicationVersion:version,persisted:true});
  assert.deepEqual(reads,[{}, {date:'2024-01-01'}, {}]);
  assert.deepEqual(publication,before);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
