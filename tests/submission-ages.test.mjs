import assert from 'node:assert/strict';import{build}from'esbuild';import fs from'node:fs';import os from'node:os';import path from'node:path';import{pathToFileURL}from'node:url';import{gzipSync}from'node:zlib';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ht-ages-'));
async function bundle(file){const out=path.join(tmp,path.basename(file)+'.mjs');await build({entryPoints:[file],bundle:true,platform:'node',format:'esm',outfile:out});return import(pathToFileURL(out));}
const realNow=Date.now,originalObserver=globalThis.MutationObserver;
try{
 const time=await bundle('lib/submission-time.ts');const{installSubmissionAges}=await bundle('web/submission-ages.ts');const{meta}=await bundle('lib/markup.ts');const{renderEdition}=await bundle('lib/render-edition.ts');const{withSubmissionAges}=await bundle('lib/submission-age-document.ts');
 const now=Date.parse('2026-11-05T17:30:00Z'),submitted=now/1000-7*3600;
 assert.equal(time.submissionAge(submitted,now),'7h ago');assert.equal(time.submissionAge(now/1000,now),'just now');
 for(const[seconds,label]of [[59,'just now'],[60,'1m ago'],[3599,'59m ago'],[3600,'1h ago'],[86399,'23h ago'],[86400,'1d ago'],[365*86400,'1y ago']])assert.equal(time.submissionAge(now/1000-seconds,now),label);
 for(const value of[undefined,null,NaN,Infinity,0,-1,'1790000000',1.5,Number.MAX_SAFE_INTEGER])assert.equal(time.submissionAge(value,now),null);
 assert.equal(time.submissionAge(now/1000+1,now),null);assert.equal(time.submissionAge(submitted,NaN),null);
 assert.equal(time.submissionTime(submitted).iso,'2026-11-05T10:30:00.000Z');assert.match(time.submissionTime(submitted).title,/10:30:00 UTC/);
 // UTC arithmetic across North American DST fallback, independent of locale.
 assert.equal(time.submissionAge(Date.parse('2026-11-01T01:30:00-04:00')/1000,Date.parse('2026-11-01T01:30:00-05:00')),'1h ago');
 const seed=JSON.parse(fs.readFileSync('data/published-seed.json'));seed.stories[0].time=submitted;
 const byline=meta(seed.stories[0]);assert.ok(byline.includes('datetime="2026-11-05T10:30:00.000Z"'));assert.ok(byline.includes(seed.stories[0].publisher));assert.ok(byline.includes('discussion-link'));assert.ok(!meta({...seed.stories[0],time:NaN}).includes('story-age'));
 const html=renderEdition(seed,'unchanged-version');assert.equal((html.match(/class="story-age"/g)||[]).length,34);assert.equal(renderEdition(seed,'unchanged-version'),html);
 const oldHTML=html.replace(/<script data-submission-ages[^>]*><\/script>/,'');const oldSnapshot=JSON.stringify(seed);const enhanced=withSubmissionAges(oldHTML,seed);
 assert.equal(withSubmissionAges(enhanced,seed),enhanced);assert.ok(enhanced.includes('content="unchanged-version"'));assert.equal(JSON.stringify(seed),oldSnapshot);assert.equal(enhanced.replace(/<script id="hn-submission-times"[^>]*>[\s\S]*?<\/script><script data-submission-ages[^>]*><\/script>/,''),oldHTML);
 class Element{
  constructor(tag='div'){this.tag=tag;this.dataset={};this.attrs={};this.style={};this.children=[];this.hidden=false;this.textContent='';this.className='';}
  setAttribute(k,v){this.attrs[k]=v;}get firstChild(){return this.children[0]||null;}insertBefore(node,before){if(before===null)this.children.push(node);else this.children.splice(this.children.indexOf(before),0,node);}closest(){return{dataset:{storyId:String(this.storyId)}};}matches(s){return s==='.'+this.className;}
  querySelector(s){if(s==='span')return this.children.find(n=>n.tag==='span');if(s==='time.story-age')return this.children.find(n=>n.className==='story-age');if(s==='[data-age-separator]')return this.children.find(n=>'ageSeparator'in n.dataset);return null;}
 }
 const makeMeta=id=>{const m=new Element();m.storyId=id;m.className='story-meta';m.children.push(Object.assign(new Element('a'),{textContent:'Original publisher'}));return m;};
 const normal=makeMeta(1),future=makeMeta(2),invalid=makeMeta(3),highlight=new Element();highlight.storyId=4;highlight.className='highlight-attribution';highlight.children.push(Object.assign(new Element('span'),{textContent:'Original comment author on Hacker News'}));
 const metas=[normal,future,invalid,highlight],events={},windowEvents={};let callback,timers=0,disconnected=false,observed;
 globalThis.MutationObserver=class{constructor(fn){this.fn=fn;callback=fn;}observe(node,options){observed=options;}disconnect(){disconnected=true;}};
 const doc={documentElement:{dataset:{}},hidden:false,getElementById:id=>id==='edition-data'?{textContent:JSON.stringify({generatedAt:'1990-01-01T00:00:00Z',stories:[{id:1,time:submitted},{id:2,time:now/1000+60},{id:3,time:null}],submissionTimes:[{id:4,time:now/1000-3*3600,commentTime:now/1000-60}]})}:id==='filtered-stories'?{}:null,querySelectorAll:()=>metas,createElement:tag=>new Element(tag),addEventListener:(k,v)=>events[k]=v,removeEventListener:k=>delete events[k]};
 const win={setInterval:(fn,ms)=>{assert.equal(ms,60000);timers++;win.tick=fn;return 1;},clearInterval:()=>timers--,addEventListener:(k,v)=>windowEvents[k]=v,removeEventListener:k=>delete windowEvents[k]};
 let clock=now;Date.now=()=>clock;
 const cleanup=installSubmissionAges(doc,win);assert.equal(timers,1);assert.deepEqual(observed,{childList:true});assert.equal(normal.querySelector('time.story-age').textContent,'7h ago');assert.equal(highlight.children[0].querySelector('time.story-age').textContent,'3h ago');assert.equal(future.querySelector('time.story-age'),undefined);assert.equal(invalid.querySelector('time.story-age'),undefined);
 assert.ok(normal.querySelector('time.story-age').attrs['aria-label'].includes('Submitted to Hacker News'));assert.equal(normal.children.at(-1).textContent,'Original publisher');
 installSubmissionAges(doc,win);assert.equal(timers,1);clock+=3600000;win.tick();assert.equal(normal.querySelector('time.story-age').textContent,'8h ago');assert.equal(future.querySelector('time.story-age').textContent,'59m ago');assert.equal(normal.children.filter(n=>n.className==='story-age').length,1);
 const filtered=makeMeta(1);metas.push(filtered);callback();assert.equal(filtered.querySelector('time.story-age').textContent,'8h ago');
 doc.hidden=true;clock+=3600000;win.tick();assert.equal(normal.querySelector('time.story-age').textContent,'8h ago');doc.hidden=false;events.visibilitychange();assert.equal(normal.querySelector('time.story-age').textContent,'9h ago');clock+=3600000;windowEvents.pageshow();assert.equal(normal.querySelector('time.story-age').textContent,'10h ago');
 cleanup();assert.equal(timers,0);assert.equal(disconnected,true);
 const assets=JSON.parse(fs.readFileSync('lib/edition-assets.ts','utf8').match(/editionAssets=(.*);/)[1]);const js=fs.readFileSync('public/edition-assets/'+path.basename(assets.ages));assert.ok(js.length<3500);assert.ok(gzipSync(js).length<1600);assert.ok(!js.includes('fetch('));console.log('PASS submission ages: HN seconds, UTC/DST boundaries, invalid/future handling, bylines, unchanged archive records, deterministic rendering, section/search observer, off-edition highlight story times, minute/visibility/BFCache updates, no duplicate timers or data requests.');console.log(JSON.stringify({ageJS:js.length,ageGzip:gzipSync(js).length}));
}finally{Date.now=realNow;globalThis.MutationObserver=originalObserver;fs.rmSync(tmp,{recursive:true,force:true});}
