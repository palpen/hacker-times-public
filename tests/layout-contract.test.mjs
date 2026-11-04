import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ht-layout-contract-'));
try{
 const out=path.join(tmp,'renderers.cjs');
 await build({stdin:{contents:`import {createElement} from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import FrontPage from './app/front-page'; export {editionLayout} from './lib/layout'; export {renderEdition} from './lib/render-edition'; export const renderReact=edition=>renderToStaticMarkup(createElement(FrontPage,{initialEdition:edition}));`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,platform:'node',format:'cjs',jsx:'automatic',outfile:out});
 const {editionLayout,renderEdition,renderReact}=await import(pathToFileURL(out));
 const seed=JSON.parse(fs.readFileSync('data/published-seed.json'));
 const legacy=JSON.parse(fs.readFileSync('data/edition.json'));
 const ids=html=>[...html.matchAll(/<article[^>]*data-story-id="(\d+)"/g)].map(m=>Number(m[1]));
 const expected=[...seed.stories.filter(s=>['lead','top'].includes(s.placement)),...seed.stories.filter(s=>s.placement==='discussion'),...['Technology','Software','Science','Culture','Business'].flatMap(c=>seed.stories.filter(s=>s.placement==='section'&&s.category===c))].map(s=>s.id);
 for(const render of [edition=>renderEdition(edition,'test-version'),renderReact]){
  const original=render(seed);
  assert.deepEqual(ids(original),expected);
  for(const edition of [{...seed,algorithmVersion:3},{...seed,algorithmVersion:500,layoutVersion:1},{...seed,layoutVersion:1,stories:[...seed.stories].reverse()}]){
   const found=ids(render(edition));assert.equal(found.length,34);assert.equal(new Set(found).size,34);assert.deepEqual([...found].sort((a,b)=>a-b),seed.stories.map(s=>s.id).sort((a,b)=>a-b));assert.equal(found[0],seed.stories.find(s=>s.placement==='lead').id);
  }
  assert.deepEqual(ids(render(legacy)),legacy.stories.map(s=>s.id));
  assert.equal(editionLayout(legacy).expanded,false);
  assert.ok(!render(seed).includes('six hours'));
  assert.throws(()=>render({...seed,schemaVersion:99}),/Unsupported edition schema/);
  assert.throws(()=>render({...seed,layoutVersion:99}),/Unsupported edition layout/);
  assert.throws(()=>render({...seed,stories:seed.stories.map(s=>s.placement==='section'?{...s,category:'Unknown'}:s)}),/Unsupported topic desk/);
  assert.throws(()=>render({...seed,stories:seed.stories.map((s,i)=>i===8?{...s,placement:'top'}:s)}),/layout capacity/);
  assert.throws(()=>render({...seed,stories:seed.stories.map((s,i)=>i===8?{...s,placement:undefined}:s)}),/supported placement/);
  const sparse={...seed,stories:seed.stories.slice(0,8)};assert.equal(ids(render(sparse)).length,8);
 }
 assert.ok(renderEdition(seed,'test').includes('regularly updated'));
 assert.ok(fs.readFileSync('app/front-page.tsx','utf8').includes('regularly updated'));
 assert.ok(renderEdition({...seed,ranking:'Policy revision 50: <safe> & pinned.'},'test').includes('Policy revision 50: &lt;safe&gt; &amp; pinned.'));
 console.log('PASS: static/React readers ignore policy version; 34 distinct stories; legacy editions; explicit lead; sparse desks; layout version/capacity validation; stored escaped policy explanation.');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
