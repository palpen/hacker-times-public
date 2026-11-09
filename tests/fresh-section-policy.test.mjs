import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ht-fresh-sections-'));
try{
 const out=path.join(tmp,'policy.mjs');await build({stdin:{contents:"export * from './lib/policy';export {validateEdition} from './lib/news';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:out});
 const {freshSectionScore:score,selectFreshMonthlyStories:select,isRecentSectionStory:recent,qualifiesForTodayPreview:qualifies,validateEdition}=await import(pathToFileURL(out));
 const at=Date.now(),stamp=new Date(at).toISOString(),sec=Math.floor(at/1000),day=86400;
 const item=(id,days,points=100,comments=10,category='Science',url='https://example.org/'+id)=>({id,title:'Story '+id,url,score:points,comments,time:sec-days*day,category,editorialScore:0});
 const lead=item(1,0,100,10,'Technology');lead.time=sec-100;
 assert.equal(score(item(2,0),100,10,sec*1000),85);
 assert.equal(score(item(2,2),100,10,sec*1000),42.5);
 assert.equal(score(item(2,4),100,10,sec*1000),21.25);
 assert.equal(score(item(2,0,0,0),100,10,sec*1000),0);
 assert.equal(recent(item(2,7),sec*1000),false);assert.equal(recent({...item(2,7),time:sec-7*day+1},sec*1000),true);
 assert.equal(recent(item(2,0),sec*1000),false); // pinned window excludes exact future/upper bound
 assert.equal(qualifies(item(2,1,19,4),new Set()),false);assert.equal(qualifies(item(2,1,20,0),new Set()),true);assert.equal(qualifies(item(2,1,0,5),new Set()),true);assert.equal(qualifies(item(2,1,1,0),new Set([2])),true);
 const pool=[lead,item(2,1,35,5),item(3,8,9999,9999),item(4,23,9999,9999),item(5,6,300,100),item(6,1,1,0),item(7,30,400,90),item(8,31,400,90),item(9,4,400,150,'Games')];
 const chosen=select(pool,[1],1,sec*1000,1);
 assert.ok(chosen.filter(s=>s.placement!=='section-only'&&s.id!==1).every(s=>recent(s,sec*1000)));
 assert.ok(!chosen.some(s=>s.id===8));assert.ok(chosen.some(s=>s.id===7&&s.placement==='section-only'));
 assert.ok(chosen.some(s=>s.id===6&&s.placement==='section-only'));assert.ok(chosen.some(s=>s.id===9&&s.placement==='section')); // no 72-hour cutoff
 assert.equal(chosen.filter(s=>s.placement==='section'&&s.category==='Science').length,2); // preview slots get qualified stories before the hidden discussion allocation
 assert.deepEqual(select([...pool].reverse(),[1],1,sec*1000,1),chosen);
 const repost=[lead,item(10,20,9000,9000,'Science','http://www.example.org/article/?utm_source=old'),item(11,1,60,12,'Science','https://example.org/article#new')];
 const withRepost=select(repost,[1],1,sec*1000,1);assert.ok(withRepost.some(s=>s.id===11));assert.ok(!withRepost.some(s=>s.id===10));assert.equal(withRepost.find(s=>s.id===11).score,60);assert.equal(withRepost.find(s=>s.id===11).comments,12);
 const leadAlias=[lead,{...item(12,0,99999,99999),url:lead.url+'/?utm_source=alias'}];assert.deepEqual(select(leadAlias,[1,12],1,at,1).map(s=>s.id),[1]);
 const crowded=[lead,...Array.from({length:40},(_,i)=>item(100+i,1,300-i,100-i,'Technology')),...Array.from({length:8},(_,i)=>item(200+i,8+i,300-i,100-i,'Technology'))];
 const crowdedSelection=select(crowded,[1,...crowded.slice(1,30).map(s=>s.id)],1,sec*1000,1);
 assert.equal(crowdedSelection.length,16);assert.equal(crowdedSelection.filter(s=>!recent(s,sec*1000)).length,4);assert.equal(crowdedSelection.filter(s=>s.placement==='section').length,4);
 const oldReposts=[lead,item(210,8,300,50,'Games','https://example.org/old-game'),item(211,20,300,50,'Games','http://www.example.org/old-game/?utm_source=x')];
 assert.ok(select(oldReposts,[1],1,sec*1000,1).some(s=>s.id===210));assert.ok(!select(oldReposts,[1],1,sec*1000,1).some(s=>s.id===211));
 const snapshot={schemaVersion:1,selectionVersion:5,freshnessPolicyVersion:1,layoutVersion:3,summaryPolicyVersion:1,leadPolicyVersion:'hn-balanced-lead-v2',leadPlan:{},policyVersion:'hn-month-fresh-sections-v5',basePublicationVersion:'base',generatedAt:stamp,windowStart:new Date(at-30*864e5).toISOString(),windowEnd:stamp,sourceMode:'hn-month-sample',algorithmVersion:3,discovery:{coverage:'sampled'},frontPageIds:[1],sourcePages:[{url:'https://news.ycombinator.com/',ids:[1]}],rankedStories:pool,selectedStories:select(pool,[1],1,at,1)};
 const payload={generatedAt:stamp,stories:snapshot.selectedStories.map(s=>({...s,headline:s.title,summary:'',shortSummary:'',summarySource:'unavailable',publisher:'Example'}))};
 const edition=validateEdition(payload,undefined,snapshot);assert.equal(edition.freshnessPolicyVersion,1);assert.equal(edition.selectionVersion,5);
 const corrupt=structuredClone(snapshot);corrupt.selectedStories.find(s=>s.id===3).placement='section';assert.throws(()=>validateEdition(payload,undefined,corrupt),/Stale Today/);
 const weak=structuredClone(snapshot);weak.selectedStories.find(s=>s.id===6).placement='section';assert.throws(()=>validateEdition(payload,undefined,weak),/Unqualified Today/);
 assert.throws(()=>validateEdition({...payload,stories:payload.stories.slice(0,-1)},undefined,snapshot),/every selected/);
 // Prior saved plans remain valid and are never reranked by current policy.
 const prior={...snapshot,selectionVersion:4,policyVersion:'hn-month-sections-v4'};delete prior.freshnessPolicyVersion;const old=validateEdition(payload,undefined,prior);assert.equal(old.freshnessPolicyVersion,undefined);
 console.log('PASS fresh section policy: engagement decay, no empty bonus, exact 7/30-day boundaries, preview qualification, sparse desks, 4-day inclusion, fresh repost own counts, lead alias, deterministic selection, v5 validation and v4 compatibility.');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
