import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

test('saved editions get clickable section titles immediately without republishing',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ht-section-links-'));
 try{
  const entry=path.join(dir,'entry.ts'),out=path.join(dir,'entry.mjs');
  fs.writeFileSync(entry,`export {withSectionHeadingLinks} from '${process.cwd()}/lib/section-heading-document';export {renderEdition} from '${process.cwd()}/lib/render-edition';export {default as worker} from '${process.cwd()}/worker/production';export {categories} from '${process.cwd()}/lib/contracts';export {editionAssets} from '${process.cwd()}/lib/edition-assets';`);
  await build({entryPoints:[entry],outfile:out,bundle:true,platform:'node',format:'esm'});
  const {withSectionHeadingLinks,renderEdition,worker,categories,editionAssets}=await import(pathToFileURL(out));
  const edition=JSON.parse(fs.readFileSync('data/published-seed.json'));
  const version='e-'+ 'a'.repeat(24),current=renderEdition(edition,version);
  const retained=current.replace(/<h2 id="(desk-[a-z]+)"><a href="#[^"]+" data-section="([^"]+)">\2<\/a><\/h2>/g,(_,id,name)=>`<h2 id="${id}">${name}</h2><button data-section="${name}">View all <span aria-hidden="true">→</span></button>`).replace(editionAssets.css,'/reader-assets/paper-0000000000000000.css');
  assert.notEqual(retained,current);
  assert.equal(withSectionHeadingLinks(retained),current);
  assert.equal(withSectionHeadingLinks(current),current);
  const previousGridCSS=current.replace(editionAssets.css,'/reader-assets/paper-45999a7f119cb388.css');
  assert.notEqual(previousGridCSS,current);
  assert.equal(withSectionHeadingLinks(previousGridCSS),current);
  const untouchedArchive=current.replace(editionAssets.css,'/reader-assets/paper-1111111111111111.css');
  assert.equal(withSectionHeadingLinks(untouchedArchive),untouchedArchive);
  for(const name of categories){
   const id='desk-'+name.toLowerCase();
   const old=`<h2 id="${id}">${name}</h2><button data-section="${name}">View all <span aria-hidden="true">→</span></button>`;
   assert.equal(withSectionHeadingLinks(old),`<h2 id="${id}"><a href="#${id}" data-section="${name}">${name}</a></h2>`);
  }
  const publication={version,edition,html:retained},before=structuredClone(publication),reads=[];
  const env={NEWSROOM:{idFromName:x=>x,get:()=>({fetch:async req=>{
   assert.equal(new URL(req.url).pathname,'/edition');reads.push(await req.json());return Response.json(publication);
  }})}};
  for(const query of ['', '?date=2024-01-01']){
   const response=await worker.fetch(new Request('https://reader.example/'+query),env);
   assert.equal(response.status,200);
   assert.equal(response.headers.get('X-Edition-Version'),version);
   assert.equal(await response.text(),current);
  }
  assert.deepEqual(reads,[{}, {date:'2024-01-01'}]);
  assert.deepEqual(publication,before);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
