import assert from 'node:assert/strict';
import {build} from 'esbuild';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'hacker-expanded-'));
for(const n of ['reporting','news'])await build({entryPoints:['lib/'+n+'.ts'],bundle:true,platform:'node',format:'esm',outfile:path.join(temp,n+'.mjs')});
const {frontPageIds,nextNewsPage,candidates}=await import(pathToFileURL(path.join(temp,'reporting.mjs')));
const {validateEdition,selectStories,classifyTopic}=await import(pathToFileURL(path.join(temp,'news.mjs')));
const ids=Array.from({length:90},(_,i)=>i+1);
const html=page=>'<html>'+ids.slice((page-1)*30,page*30).map(id=>`<tr class="athing submission" id="${id}">`).join('')+`<a class='morelink' href='?p=${page+1}'>More</a></html>`;
assert.deepEqual(frontPageIds(html(1)),ids.slice(0,30));assert.throws(()=>frontPageIds('<html>Blocked</html>'));
assert.equal(nextNewsPage(html(1),2),'https://news.ycombinator.com/?p=2');assert.throws(()=>nextNewsPage(`<a class='morelink' href='https://evil.example/news?p=2'>More</a>`,2));assert.throws(()=>nextNewsPage(html(1),3));
const originalFetch=globalThis.fetch;let pollScore=600,missing=false,calls=[];
const topics=['Fingerprint hardware','Programming compiler','Astronomy telescope','History book','Business revenue'];
globalThis.fetch=async (input,options)=>{
 if(options?.redirect==='error')throw new TypeError('Workers does not support redirect:error');
 const url=String(input);calls.push(url);
 if(/^https:\/\/news.ycombinator.com\/(\?p=[23])?$/.test(url))return new Response(html(Number(new URL(url).searchParams.get('p')||1)),{headers:{'content-type':'text/html'}});
 if(url.includes('/item/')){assert.equal(options.redirect,'manual');const id=Number(url.match(/item\/(\d+)/)[1]);if(missing&&id===85)return new Response(null,{status:503});
 return Response.json({id,type:id===3?'job':id===5?'poll':'story',dead:id===4,title:topics[id%5]+' '+id,time:1577836800,score:id===60?10000:id===5?pollScore:id===3||id===4?99999:id<=2?500:200-id,descendants:id===2?999:id%7*12,...(id!==1&&id!==5?{url:'https://example.org/story/'+id}:{text:'An HN self-post.'})});}
 if(url.startsWith('https://example.org/'))return new Response('<html><title>Source</title><article>Verified text.</article></html>',{headers:{'content-type':'text/html'}});throw Error('Unexpected '+url);
};
try{
 const result={...await candidates(1),basePublicationVersion:'test-base'};assert.equal(result.sourcePages.length,3);assert.equal(result.fetchedCount,90);assert.equal(result.candidateCount,88);assert.equal(result.stories.length,34);assert.deepEqual(result.frontPageIds,ids.slice(0,30));assert.equal(result.stories[0].id,5);assert.equal(result.stories[0].isSelfPost,true);assert.deepEqual(result.stories[0].imageCandidates,[]);assert.ok(result.stories.some(s=>s.id===60));assert.equal(result.stories.find(s=>s.id===60).placement,'top');assert.ok(!result.stories.some(s=>s.id===3||s.id===4));assert.ok(!calls.some(u=>u.includes('topstories')));assert.ok(!('windowStart'in result));
 assert.equal(new Set(result.stories.map(s=>s.id)).size,34);assert.equal(result.stories.filter(s=>s.placement==='top').length,7);assert.equal(result.stories.filter(s=>s.placement==='discussion').length,6);for(const c of ['Technology','Software','Science','Culture','Business'])assert.equal(result.stories.filter(s=>s.category===c&&s.placement==='section').length,4);
 const ready={...result,stories:result.stories.map(s=>({...s,headline:s.title,summary:'Verified summary.',publisher:'Source',category:'Wrong category',placement:'lead',image:null}))};const valid=validateEdition(ready,undefined,result);assert.equal(valid.sourceMode,'hn-multi-page');assert.equal(valid.algorithmVersion,2);assert.equal(valid.stories[0].time,1577836800);assert.equal(valid.stories[1].placement,'top');assert.ok(valid.stories.every(s=>s.category!=='Wrong category'));
 assert.throws(()=>validateEdition({...ready,stories:ready.stories.slice(1)},undefined,result));assert.throws(()=>validateEdition({...ready,stories:ready.stories.map((s,i)=>i?s:{...s,score:s.score+1})},undefined,result));assert.throws(()=>validateEdition(ready,undefined,{...result,schemaVersion:undefined,algorithmVersion:1}));
 pollScore=500;const tied={...await candidates(1),basePublicationVersion:'test-base'};assert.equal(tied.stories[0].id,1);const prev={...ready,stories:[{...ready.stories[0],id:1,headline:'Keep this headline'}]};const tiedReady={...tied,stories:tied.stories.map(s=>({...s,headline:s.title,summary:'',publisher:'HN'}))};assert.equal(validateEdition(tiedReady,prev,tied).stories[0].headline,'Keep this headline');
 missing=true;await assert.rejects(()=>candidates(1),/Incomplete HN/);
 const p=result.rankedStories;assert.deepEqual(selectStories(p,result.frontPageIds,1),selectStories([...p].reverse(),result.frontPageIds,1));
 const score=result.selectedStories.find(s=>s.id===60);const maxP=Math.max(...p.map(s=>s.score)),maxC=Math.max(...p.map(s=>s.comments));assert.equal(score.editorialScore,Math.round((60*Math.log1p(score.score)/Math.log1p(maxP)+25*Math.log1p(score.comments)/Math.log1p(maxC)+15*(90-score.hnRank)/89)*10000)/10000);
 assert.equal(classifyTopic('Postgres compiler update','https://example.org'),'Software');assert.equal(classifyTopic('NASA telescope','https://example.org'),'Science');assert.equal(classifyTopic('A new novel','https://example.org'),'Culture');assert.equal(classifyTopic('Revenue growth','https://example.org'),'Business');
 console.log('PASS: three actual pages, 90 API scores, first-page-only points lead, later-page outlier cannot lead, no age cutoff, selfposts, no duplicate placements, five desks, exact log formula, deterministic ties, authoritative category/placement, unchanged headline, snapshot integrity, fail-closed missing page-three item.');
}finally{globalThis.fetch=originalFetch;fs.rmSync(temp,{recursive:true,force:true});}
