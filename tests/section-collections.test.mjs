import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ht-sections-'));
try{
 const out=path.join(tmp,'sections.mjs');await build({stdin:{contents:"export * from './lib/policy';export * from './lib/layout';export {renderEdition} from './lib/render-edition';export {validateEdition} from './lib/news';export {filterStories,readerLocation,readerURL} from './web/reader';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:out});
 const {selectMonthlyStories,classifyTopicV4,editionLayout,renderEdition,validateEdition,filterStories,readerLocation,readerURL}=await import(pathToFileURL(out));
 const at=Date.now(),stamp=new Date(at).toISOString(),categories=['Technology','AI','Software','Science','Culture','Business','Games'];
 const pool=categories.flatMap((category,c)=>Array.from({length:24},(_,i)=>({id:c*100+i+1,title:category+' article '+i,url:'https://example.org/'+c+'/'+i,category,score:300-i,comments:30-i,time:Math.floor(at/1000)-3600-i,editorialScore:0})));
 pool.push({...pool[0],id:9999,url:pool[0].url.replace('https:','http:')+'/?utm_source=sample',score:9000});
 const first=pool.slice(0,25).map(s=>s.id),selected=selectMonthlyStories(pool,first,1,at,1,true);
 assert.equal(selected.length,112);assert.equal(new Set(selected.map(s=>s.id)).size,112);assert.ok(!selected.some(s=>s.id===9999));
 const today=selected.filter(s=>s.placement!=='section-only');assert.ok(today.length<=42);assert.equal(new Set(today.map(s=>s.id)).size,today.length);
 for(const c of categories){assert.equal(selected.filter(s=>s.category===c).length,16);assert.ok(selected.some(s=>s.category===c&&s.placement==='section-only'));assert.ok(today.filter(s=>s.category===c&&s.placement==='section').length<=4);}
 assert.deepEqual(selectMonthlyStories([...pool].reverse(),first,1,at,1,true),selected);
 const snapshot={schemaVersion:1,selectionVersion:4,layoutVersion:3,summaryPolicyVersion:1,leadPolicyVersion:'hn-balanced-lead-v2',leadPlan:{},policyVersion:'hn-month-sections-v4',basePublicationVersion:'base',generatedAt:stamp,windowStart:new Date(at-30*864e5).toISOString(),windowEnd:stamp,sourceMode:'hn-month-sample',algorithmVersion:3,discovery:{coverage:'sampled'},frontPageIds:first,sourcePages:[],rankedStories:pool,selectedStories:selected};
 const payload={generatedAt:stamp,stories:selected.map(s=>({...s,headline:s.title,summary:'',shortSummary:'',summarySource:'unavailable',publisher:'Example'}))};
 const edition=validateEdition(payload,undefined,snapshot),layout=editionLayout(edition),html=renderEdition(edition,'test');
 assert.equal(layout.features.length,8);const rendered=[...html.matchAll(/<article[^>]*data-story-id="(\d+)"/g)].map(m=>Number(m[1]));assert.equal(rendered.length,today.length);assert.equal(new Set(rendered).size,rendered.length);assert.ok(selected.filter(s=>s.placement==='section-only').every(s=>!rendered.includes(s.id)));
 for(const c of categories)assert.equal(filterStories(edition.stories,c,'',true).length,16);
 const only=selected.find(s=>s.placement==='section-only');assert.ok(filterStories(edition.stories,'Today',only.title,true).some(s=>s.id===only.id));
 assert.throws(()=>validateEdition({...payload,stories:payload.stories.slice(0,-1)},undefined,snapshot),/every selected/);
 const sparse=selectMonthlyStories(pool.filter(s=>s.category!=='Games'||s.id===601),first,1,at,1,true);assert.equal(sparse.filter(s=>s.category==='Games').length,1);
 assert.equal(classifyTopicV4('AMD expects to outsell Intel in Q4 for the first time in history','https://example.org'),'Business');assert.equal(classifyTopicV4('The history of the Linux kernel','https://example.org'),'Software');
 assert.equal(classifyTopicV4('A new telescope observes a distant galaxy','https://example.org'),'Science');assert.equal(classifyTopicV4('History of music notation','https://example.org'),'Culture');assert.equal(classifyTopicV4('An open source chess engine','https://example.org'),'Games');
 assert.equal(classifyTopicV4("Denmark set to allow return of physical force in school",'https://example.org'),'Culture');assert.equal(classifyTopicV4('Root shell on Samsung TV','https://example.org'),'Software');assert.equal(classifyTopicV4('Brief History of PDP Computers','https://example.org'),'Software');assert.equal(classifyTopicV4('Physical Intelligence API Beta: Frontier Models for Every Robot','https://example.org'),'AI');
 assert.equal(classifyTopicV4("Linux's Early Boot-Time Physical Memory Allocator",'https://example.org'),'Software');assert.equal(classifyTopicV4('From Initial Access to Physical Damage: Supermarket Cyberattack','https://example.org'),'Technology');assert.equal(classifyTopicV4('To Honor Sir Patrick Stewart, Enjoy the TNG Episode Guessing Game','https://example.org'),'Games');
 assert.deepEqual(readerLocation('https://paper.example/?date=2026-11-04&section=Science&q=telescope'),{section:'Science',query:'telescope'});assert.equal(readerURL('https://paper.example/?date=2026-11-04&refresh=1','Science',''), '/?date=2026-11-04&section=Science');
 console.log('PASS independent sections: 112 stories, 16 per desk, <=42 Today placements, section-only search, sparse honest coverage, normalized repost dedupe, deterministic ranking, v4 validation and preserved archive URL.');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
