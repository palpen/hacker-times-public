import test from 'node:test';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';import {build} from 'esbuild';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ht-production-'));
const entry=path.join(dir,'entry.ts'),out=path.join(dir,'entry.mjs');
fs.writeFileSync(entry,`export {processImage} from '${process.cwd()}/lib/production/image-runner';export {imageReviewKey,imageUrl,hashImage,encodeImage,IMAGE_POLICY} from '${process.cwd()}/lib/production/images';export {importArchive} from '${process.cwd()}/lib/production/archive-import';export {readBlob,writeBlob} from '${process.cwd()}/lib/production/storage';export {CollectionError} from '${process.cwd()}/lib/collection-error';export {observeRun,runLogEvent} from '${process.cwd()}/lib/production/run-log';export {Newsroom} from '${process.cwd()}/lib/production/newsroom';export {pinSnapshot,chooseLead} from '${process.cwd()}/lib/production/selection';export {digest} from '${process.cwd()}/lib/production/storage';export {selectUnifiedMonthlyStories,unifiedSectionPolicyVersion,unifiedSectionPolicyConfig} from '${process.cwd()}/lib/policy';export {default as worker} from '${process.cwd()}/worker/production';export {collectSource} from '${process.cwd()}/lib/production/collect';export {EDITORIAL_REQUEST_POLICY} from '${process.cwd()}/lib/production/editorial-model';export {summarize,runEdition,collect as collectMetadata} from '${process.cwd()}/lib/production/runner';`);
const built=await build({entryPoints:[entry],outfile:out,bundle:true,platform:'node',format:'esm',metafile:true});
assert.ok(!Object.keys(built.metafile.inputs).some(x=>x.endsWith('lib/production/auth.ts')),'removed auth module must not enter production bundle');
assert.ok(!Object.keys(built.metafile.inputs).some(x=>/data\/|lib\/(publication|editor|editorial-staging|lead-state)\.ts/.test(x)),'independent backend must not bundle old data/managed writer');
const api=await import(pathToFileURL(out));
globalThis.fetch=async()=>{throw Error('Live network forbidden in synthetic tests');};
class MemoryStorage {
 data=new Map();tail=Promise.resolve();alarm=null;
 async setAlarm(at){this.alarm=at;}
 async deleteAlarm(){this.alarm=null;}
 async get(k){return structuredClone(this.data.get(k));}
 async put(k,v){this.data.set(k,structuredClone(v));}
 async delete(k){return this.data.delete(k);}
 async transaction(fn){const run=this.tail.then(async()=>{const tx=new MemoryStorage();tx.data=structuredClone(this.data);tx.alarm=this.alarm;const result=await fn(tx);this.data=tx.data;this.alarm=tx.alarm;return result;});this.tail=run.catch(()=>{});return run;}
}
function imageFixture(marker=0){const b=new Uint8Array(45),d=new DataView(b.buffer);b.set([137,80,78,71,13,10,26,10]);d.setUint32(8,13);d.setUint32(12,0x49484452);d.setUint32(16,640);d.setUint32(20,360);b[32]=marker;d.setUint32(37,0x49454e44);return b;}
async function setup(env,storage=new MemoryStorage()){
 let ready;const state={storage,blockConcurrencyWhile:fn=>ready=fn()};const newsroom=new api.Newsroom(state,env);await ready;
 const request=(op,args={})=>newsroom.fetch(new Request('https://internal/'+op,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args)}));
 const call=async(op,args={})=>{const r=await request(op,args),body=await r.json();if(!r.ok)throw Object.assign(Error(body.error),{status:r.status});return body;};
 return {storage,request,call,newsroom};
}
function pool(at,offset=0){return Array.from({length:25},(_,i)=>({id:101+offset+i,title:'Fictional system '+i,url:'https://fictional.example/article/'+(101+offset+i),score:300-i*4,comments:50-i,time:Math.floor(at/1000)-3600-i,hnPage:1,hnRank:i+1,category:['Technology','AI','Software','Science','Culture','Business','Games'][i%7],topics:['Technology'],discoverySource:'current',editorialScore:0}));}
function snapshot(root,at=Date.now()-120_000,items=pool(at)){
 const ids=items.map(s=>s.id),audit=api.chooseLead(root,items,ids,at).audit;
 const selected=api.selectUnifiedMonthlyStories(items,ids,root.ledger.active?.id,at,audit.leadId,ids);
 return api.pinSnapshot(root,{schemaVersion:1,selectionVersion:6,layoutVersion:3,freshnessPolicyVersion:1,algorithmVersion:3,policyVersion:api.unifiedSectionPolicyVersion,policyConfig:api.unifiedSectionPolicyConfig,generatedAt:new Date(at).toISOString(),windowStart:new Date(at-30*86400_000).toISOString(),windowEnd:new Date(at).toISOString(),sourceMode:'hn-month-sample',discovery:{coverage:'sampled'},frontPageIds:ids,sourcePages:[{url:'https://news.ycombinator.com/',ids},{url:'https://news.ycombinator.com/?p=2',ids:[]},{url:'https://news.ycombinator.com/?p=3',ids:[]}],candidateCount:items.length,fetchedCount:items.length,rankedStories:items,selectedStories:selected,ranking:'Fictional policy fixture'});
}
async function author(s,fixture,selected,extra={},sourceExtra={}){
 const source={id:selected.id,generatedAt:fixture.generatedAt,kind:'article',excerpt:'A wholly fictional test system demonstrates a synthetic operation.',description:'Fictional system demonstration.',url:selected.url,fetchedAt:new Date().toISOString(),status:'fetched',...sourceExtra};
 source.fingerprint=await api.digest(source);
 await s.call('source',{generatedAt:fixture.generatedAt,source});
 const story={...selected,headline:selected.title,summary:'A fictional system demonstrates a synthetic operation.',shortSummary:'A fictional system demonstrates a synthetic operation.',summarySource:'article',publisher:'Fictional publisher',articleStatus:'fetched',image:null,imageAlt:'',imageCredit:'',...extra};
 return {story,sourceFingerprint:source.fingerprint,generatedAt:fixture.generatedAt};
}
test('synthetic complete staging, validation, atomic commit, archive and stale base',async()=>{
 const s=await setup(),base=await s.call('root'),fixture=snapshot(base);
 assert.equal(base.version,'empty');await assert.rejects(()=>s.call('edition'),/No published/);
 await s.call('snapshot',{snapshot:fixture});
 await assert.rejects(()=>s.call('publish',{generatedAt:fixture.generatedAt}),/Incomplete/);
 for(const selected of fixture.selectedStories){const args=await author(s,fixture,selected);const first=await s.call('stage',args);assert.equal(first.revision,1);assert.equal((await s.call('stage',args)).unchanged,true);}
 const status=await s.call('status',{generatedAt:fixture.generatedAt});assert.equal(status.staged,fixture.selectedStories.length);assert.deepEqual(status.missingIds,[]);
 await assert.rejects(()=>s.call('publish',{generatedAt:fixture.generatedAt}),/validated/);
 assert.equal((await s.call('validate',{generatedAt:fixture.generatedAt})).valid,true);
 assert.equal((await s.call('root')).version,'empty');
 await s.storage.setAlarm(Date.now()+1000);const published=await s.call('publish',{generatedAt:fixture.generatedAt});assert.equal(s.storage.alarm,null);const persisted=await s.call('edition');assert.equal(persisted.version,published.version);assert.equal(persisted.edition.generatedAt,fixture.generatedAt);assert.deepEqual(persisted.edition.stories.map(x=>x.id),fixture.selectedStories.map(x=>x.id));assert.equal(new Set(persisted.edition.stories.map(x=>x.id)).size,persisted.edition.stories.length);
 assert.equal((await s.call('edition',{date:fixture.generatedAt.slice(0,10)})).version,published.version);
 assert.match(persisted.html,/Manufacturing|Hacker Times/);assert.match(persisted.html,new RegExp(published.version));
 await assert.rejects(()=>s.call('validate',{generatedAt:fixture.generatedAt}),/base changed/);
});
test('formerly blocked story IDs can complete the normal publication workflow',async()=>{
 const s=await setup(),root=await s.call('root'),at=Date.now()-100_000,items=pool(at);
 // Regression IDs only: all titles, URLs and authored content remain fictional.
 const ids=[50414427,50414234,50414155,50414215,50366902,50373004,50347552];
 ids.forEach((id,i)=>{items[i].id=id;items[i].url='https://fictional.example/article/'+id;});
 const fixture=snapshot(root,at,items);
 for(const id of ids)assert.ok(fixture.selectedStories.some(story=>story.id===id));
 await s.call('snapshot',{snapshot:fixture});
 for(const selected of fixture.selectedStories)await s.call('stage',await author(s,fixture,selected));
 assert.equal((await s.call('validate',{generatedAt:fixture.generatedAt})).valid,true);
 const published=await s.call('publish',{generatedAt:fixture.generatedAt});
 const persisted=await s.call('edition');
 assert.equal(persisted.version,published.version);
 for(const id of ids)assert.ok(persisted.edition.stories.some(story=>story.id===id));
});
test('source, provenance, pinned metrics, images and replacement conflicts fail closed',async()=>{
 const s=await setup(),fixture=snapshot(await s.call('root'));await s.call('snapshot',{snapshot:fixture});
 const args=await author(s,fixture,fixture.selectedStories[0]);
 await assert.rejects(()=>s.call('stage',{...args,story:{...args.story,score:999}}),/Authoritative/);
 await assert.rejects(()=>s.call('stage',{...args,sourceFingerprint:'wrong'}),/evidence/);
 await assert.rejects(()=>s.call('stage',{...args,story:{...args.story,image:'https://fictional.example/image.jpg'}}),/visual/);
 await assert.rejects(()=>s.call('stage',{...args,story:{...args.story,summarySource:'hn_post'}}),/provenance/);
 const races=await Promise.allSettled([s.call('stage',args),s.call('stage',{...args,story:{...args.story,summary:'Another fictional summary.'}})]);assert.equal(races.filter(x=>x.status==='fulfilled').length,1);
 await assert.rejects(()=>s.call('stage',{...args,story:{...args.story,summary:'Changed fictional summary.'}}),/Revision/);
 assert.equal((await s.call('stage',{...args,expectedRevision:1,story:{...args.story,summary:'Changed fictional summary.'}})).revision,2);
});
test('durable safety stop cannot be replaced with source unavailable or a new snapshot',async()=>{
 const s=await setup(),fixture=snapshot(await s.call('root'));await s.call('snapshot',{snapshot:fixture});
 await s.storage.setAlarm(Date.now()+1000);await s.call('failure',{generatedAt:fixture.generatedAt,kind:'safety_stop'});assert.equal(s.storage.alarm,null);
 const state=await s.call('status',{generatedAt:fixture.generatedAt});assert.equal(state.safetyStop.kind,'safety_stop');
 for(const op of ['validate','publish','selection'])await assert.rejects(()=>s.call(op,{generatedAt:fixture.generatedAt}),/safety stop/);
 await assert.rejects(()=>s.call('failure',{generatedAt:fixture.generatedAt,kind:'source_unavailable'}),/safety stop/);
 await assert.rejects(()=>s.call('snapshot',{snapshot:fixture}),/safety stop/);
 assert.equal((await s.call('root')).version,'empty');
});
test('public worker denies forged identity, default-off writes, unknown routes and exposes edition version',async()=>{
 const s=await setup();const env={NEWSROOM:{idFromName:x=>x,get:()=>({fetch:req=>s.request(new URL(req.url).pathname.slice(1),{})})}};
 const spoof=await api.worker.fetch(new Request('https://reader.example/admin/status',{method:'POST',headers:{'oai-authenticated-user-email':'owner@example.com'}}),env);assert.equal(spoof.status,404);
 assert.equal((await api.worker.fetch(new Request('https://reader.example/mcp'),env)).status,404);
 let scheduled=false;await api.worker.scheduled({scheduledTime:Date.now()},env,{waitUntil:()=>scheduled=true});assert.equal(scheduled,false);
 const fixture=snapshot(await s.call('root'));await s.call('snapshot',{snapshot:fixture});for(const row of fixture.selectedStories)await s.call('stage',await author(s,fixture,row));await s.call('validate',{generatedAt:fixture.generatedAt});const result=await s.call('publish',{generatedAt:fixture.generatedAt});
 const response=await api.worker.fetch(new Request('https://reader.example/?refresh=1'),env);assert.equal(response.status,200);assert.equal(response.headers.get('X-Edition-Version'),result.version);assert.equal(response.headers.get('Cache-Control'),'no-store');
});
test('readiness checks current publication freshness without exposing failures or changing state',async()=>{
 const now=Date.now(),originalNow=Date.now;
 Date.now=()=>now;
 let result,failed=false;
 const env={NEWSROOM:{idFromName:name=>{assert.equal(name,'production-v1');return name;},get:()=>({fetch:async request=>{
  assert.equal(new URL(request.url).pathname,'/edition');
  assert.deepEqual(await request.json(),{});
  if(failed)throw Error('private diagnostic must not escape');
  return Response.json(result);
 }})}};
 try{
  for(const [age,status,label] of [[0,200,'ready'],[2700000,200,'ready'],[2700001,503,'stale'],[-1,503,'invalid_timestamp']]){
   result={version:'e-fictional',edition:{generatedAt:new Date(now-age).toISOString()}};
   const response=await api.worker.fetch(new Request('https://reader.example/readyz?date=2000-01-01'),env);
   assert.equal(response.status,status);assert.equal(response.headers.get('Cache-Control'),'no-store');
   const body=await response.json();assert.equal(body.status,label);assert.equal(body.maxAgeSeconds,2700);
  }
  for(const generatedAt of [undefined,null,'not-a-date']){
   result={version:'e-fictional',edition:{generatedAt}};
   assert.equal((await api.worker.fetch(new Request('https://reader.example/readyz'),env)).status,503);
  }
  failed=true;
  const failure=await api.worker.fetch(new Request('https://reader.example/readyz'),env);
  assert.equal(failure.status,503);assert.equal(failure.headers.get('Cache-Control'),'no-store');
  assert.deepEqual(await failure.json(),{status:'unavailable',maxAgeSeconds:2700});
  const head=await api.worker.fetch(new Request('https://reader.example/readyz',{method:'HEAD'}),env);
  assert.equal(head.status,503);assert.equal(await head.text(),'');
  const empty=await setup();
  const emptyEnv={NEWSROOM:{idFromName:x=>x,get:()=>({fetch:req=>empty.request(new URL(req.url).pathname.slice(1),{})})}};
  assert.equal((await api.worker.fetch(new Request('https://reader.example/readyz'),emptyEnv)).status,503);
  assert.equal((await empty.call('root')).version,'empty');
 }finally{Date.now=originalNow;}
});
test('storage corruption never silently initializes fresh history',async()=>{
 const s=await setup();await s.storage.delete('root/count');let ready;new api.Newsroom({storage:s.storage,blockConcurrencyWhile:fn=>ready=fn()});await assert.rejects(()=>ready,/authority missing/);
});
test.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
test('future editions preserve incumbent headline and retire replaced article/repost permanently',async()=>{
 const s=await setup(),at=Date.now()-240_000;
 async function publish(f,headline){await s.call('snapshot',{snapshot:f});for(const row of f.selectedStories)await s.call('stage',await author(s,f,row,row.placement==='lead'&&headline?{headline}:{}));await s.call('validate',{generatedAt:f.generatedAt});return s.call('publish',{generatedAt:f.generatedAt});}
 const one=snapshot(await s.call('root'),at);await publish(one,'A verified fictional headline');
 const two=snapshot(await s.call('root'),at+30_000,pool(at));await publish(two,'A changed fictional headline');
 assert.equal((await s.call('edition')).edition.stories[0].headline,'A verified fictional headline');
 const three=snapshot(await s.call('root'),at+60_000,pool(at+60_000,100));await publish(three);
 const root=await s.call('root');assert.ok(root.ledger.retiredIds.includes(one.selectedStories[0].id));assert.ok(root.ledger.retiredKeys.includes(one.selectedStories[0].url));
 const items=pool(at+90_000,200);items[0]={...items[0],url:one.selectedStories[0].url,score:10000,comments:10000};
 const four=snapshot(root,at+90_000,items);assert.notEqual(four.selectedStories[0].id,items[0].id);
});
test('unavailable incumbent and its repost publish the original title without blocking or changing the lead plan',async()=>{
 for(const repost of [false,true]){
  const s=await setup(),at=Date.now()-120_000,items=pool(at);
  const first=snapshot(await s.call('root'),at,items);
  await s.call('snapshot',{snapshot:first});
  for(const row of first.selectedStories)await s.call('stage',await author(s,first,row,row.placement==='lead'?{headline:'A previously verified fictional headline'}:{}));
  await s.call('validate',{generatedAt:first.generatedAt});await s.call('publish',{generatedAt:first.generatedAt});
  const prior=await s.call('edition'),root=await s.call('root');
  const nextItems=structuredClone(items);
  if(repost)nextItems[0]={...nextItems[0],id:999,title:'A fictional repost title'};
  const next=snapshot(root,at+30_000,nextItems);
  assert.equal(next.nextLedger.active.key,root.ledger.active.key);
  assert.equal(next.selectedStories[0].id,nextItems[0].id);
  await s.call('snapshot',{snapshot:next});
  for(const row of next.selectedStories)await s.call('stage',await author(s,next,row,row.placement==='lead'?{summarySource:'unavailable',summary:'',shortSummary:'',articleStatus:'insufficient_source_text'}:{},row.placement==='lead'?{excerpt:'',description:'',status:'insufficient_source_text'}:{}));
  assert.equal((await s.call('validate',{generatedAt:next.generatedAt})).valid,true);
  await s.call('publish',{generatedAt:next.generatedAt});
  const saved=await s.call('edition'),lead=saved.edition.stories[0];
  assert.equal(lead.headline,nextItems[0].title);assert.equal(lead.summarySource,'unavailable');assert.equal(lead.summary,'');assert.equal(lead.shortSummary,'');
  assert.deepEqual(saved.edition.stories.map(row=>row.id),next.selectedStories.map(row=>row.id));
  assert.deepEqual((await s.call('root')).ledger,next.nextLedger);
  assert.equal((await s.call('status')).pending,null);
  assert.deepEqual(await s.call('edition',{version:prior.version}),prior);
 }
});
test('HN edits to the active lead URL publish fresh evidence and retire every former URL',async()=>{
 const s=await setup(),at=Date.now()-240_000,items=pool(at),originalUrl=items[0].url;
 async function publish(f,unavailable=false){await s.call('snapshot',{snapshot:f});for(const row of f.selectedStories)await s.call('stage',await author(s,f,row,unavailable&&row.placement==='lead'?{summarySource:'unavailable',summary:'',shortSummary:''}:{}));await s.call('validate',{generatedAt:f.generatedAt});return s.call('publish',{generatedAt:f.generatedAt});}
 const first=snapshot(await s.call('root'),at,items);await publish(first);
 const originalVersion=(await s.call('edition')).version;
 for(const [index,url] of ['https://corrected.example/launch','https://corrected.example/launch-final'].entries()){
  const root=await s.call('root'),before=structuredClone(root);
  items[0]={...items[0],url,title:'Corrected fictional title '+index};
  // Even a high-scoring repost of the prior URL must not undo the correction.
  const corrected=[...items,{...items[0],id:999+index,url:root.ledger.active.url,score:100000,comments:100000}];
  const next=snapshot(root,at+(index+1)*30_000,corrected);
  assert.deepEqual(root,before,'collection must not mutate the published ledger');
  assert.equal(next.selectedStories[0].id,items[0].id);
  await publish(next,true);
  const saved=await s.call('edition'),updated=await s.call('root');
  assert.equal(saved.edition.stories[0].url,url);assert.equal(saved.edition.generatedAt,next.generatedAt);
  assert.equal(saved.edition.stories[0].headline,items[0].title);
  assert.equal(saved.edition.stories[0].summarySource,'unavailable');
  assert.ok(updated.ledger.retiredKeys.includes(root.ledger.active.key));
  assert.ok(!updated.ledger.retiredIds.includes(items[0].id));
  assert.equal((await s.call('edition',{version:originalVersion})).edition.stories[0].url,originalUrl);
 }
 await publish(snapshot(await s.call('root'),at+90_000,pool(at+90_000,100)));
 const root=await s.call('root');assert.ok(root.ledger.retiredIds.includes(items[0].id));
 for(const url of [originalUrl,'https://corrected.example/launch','https://corrected.example/launch-final']){
  assert.ok(root.ledger.retiredKeys.includes(url));
  const reposts=pool(at+120_000,200);reposts[0]={...reposts[0],url,score:100000,comments:100000};
  assert.notEqual(snapshot(root,at+120_000,reposts).selectedStories[0].id,reposts[0].id);
 }
});
test('an edited lead URL cannot revive a retired destination or erase history when replaced',async()=>{
 const at=Date.now()-120_000,items=pool(at),old=items[0].url,newUrl='https://corrected.example/retired';
 const root={schema:1,revision:1,version:'e-fictional',archives:{},ledger:{active:{id:items[0].id,url:old,key:old,aliases:[items[0].id]},retiredIds:[900],retiredKeys:[newUrl],observations:[]}};
 items[0]={...items[0],url:newUrl};
 const chosen=api.chooseLead(root,items,items.map(x=>x.id),at);
 assert.notEqual(chosen.audit.leadId,items[0].id);
 assert.ok(chosen.nextLedger.retiredIds.includes(items[0].id));
 assert.ok(chosen.nextLedger.retiredIds.includes(900));
 assert.ok(chosen.nextLedger.retiredKeys.includes(old));
 assert.ok(chosen.nextLedger.retiredKeys.includes(newUrl));
});
test('source failure alone is not staged; validation is invalidated by intentional replacement',async()=>{
 const s=await setup(),f=snapshot(await s.call('root'));await s.call('snapshot',{snapshot:f});await s.call('failure',{generatedAt:f.generatedAt,kind:'source_unavailable',storyId:f.selectedStories[0].id});
 assert.equal((await s.call('status',{generatedAt:f.generatedAt})).staged,0);
 let first;for(const row of f.selectedStories){const args=await author(s,f,row);if(!first)first=args;await s.call('stage',args);}
 await s.call('validate',{generatedAt:f.generatedAt});await s.call('stage',{...first,expectedRevision:1,story:{...first.story,summary:'A replacement fictional summary.'}});
 await assert.rejects(()=>s.call('publish',{generatedAt:f.generatedAt}),/validated/);
});

test('real local workerd SQLite commits, restarts and restores an isolated cold backup',async()=>{
 const workerPath=path.join(dir,'runtime-worker.mjs');
 await build({entryPoints:['worker/production.ts'],outfile:workerPath,bundle:true,format:'esm',platform:'browser'});
 const persist=path.join(dir,'persist');
 const options={rootPath:dir,modules:true,scriptPath:workerPath,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],durableObjects:{NEWSROOM:{className:'Newsroom',useSQLite:true}},resourcePersistencePath:persist,bindings:{MUTATIONS_ENABLED:'false',LIVE_FETCH_ENABLED:'false',PUBLICATION_ENABLED:'false',SCHEDULE_ENABLED:'false'}};
 let mf=new Miniflare(convertV4MiniflareOptions(options));
 try{
  const ns=await mf.getDurableObjectNamespace('NEWSROOM'),stub=ns.get(ns.idFromName('production-v1'));
  const s={call:async(op,args={})=>{const response=await stub.fetch('https://internal/'+op,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args)});const value=await response.json();if(!response.ok)throw Error(value.error);return value;}};
  const f=snapshot(await s.call('root'));await s.call('snapshot',{snapshot:f});for(const row of f.selectedStories)await s.call('stage',await author(s,f,row));await s.call('validate',{generatedAt:f.generatedAt});const saved=await s.call('publish',{generatedAt:f.generatedAt});
  const response=await mf.dispatchFetch('https://reader.example/');assert.equal(response.status,200);assert.equal(response.headers.get('X-Edition-Version'),saved.version);
  const pending=snapshot(await s.call('root'),Date.parse(f.generatedAt)+1);await s.call('snapshot',{snapshot:pending});await s.call('stage',await author(s,pending,pending.selectedStories[0]));
  const unknownKey='9'.repeat(64);await s.call('model-reserve',{key:unknownKey,cost:100,dailyLimit:200,monthlyLimit:400});
  await s.call('failure',{generatedAt:pending.generatedAt,kind:'safety_stop'});
  const authority=await s.call('root'),checkpoint=await s.call('status',{generatedAt:pending.generatedAt});
  // Local cold-copy drill only. Never copy a running SQLite database/WAL, and
  // never treat this local Miniflare directory as a Cloudflare import format.
  await mf.dispose();const backup=path.join(dir,'cold-backup'),recovery=path.join(dir,'isolated-recovery');fs.cpSync(persist,backup,{recursive:true});fs.cpSync(backup,recovery,{recursive:true});
  mf=new Miniflare(convertV4MiniflareOptions(options));
  const restarted=await mf.dispatchFetch('https://reader.example/api/edition');assert.equal((await restarted.json()).publicationVersion,saved.version);
  await mf.dispose();mf=new Miniflare(convertV4MiniflareOptions({...options,resourcePersistencePath:recovery}));
  const restored=await mf.dispatchFetch('https://reader.example/api/edition');assert.equal(restored.status,200);assert.equal((await restored.json()).publicationVersion,saved.version);
  const recoveredNs=await mf.getDurableObjectNamespace('NEWSROOM'),recovered=recoveredNs.get(recoveredNs.idFromName('production-v1'));
  const restoredCall=async(op,args={})=>{const r=await recovered.fetch('https://internal/'+op,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args)});return {status:r.status,body:await r.json()};};
  assert.deepEqual((await restoredCall('root')).body,authority);
  const {ageMs,...restoredCheckpoint}=(await restoredCall('status',{generatedAt:pending.generatedAt})).body;
  const {ageMs:originalAge,...savedCheckpoint}=checkpoint;
  assert.ok(ageMs>=originalAge);
  assert.deepEqual(restoredCheckpoint,savedCheckpoint);
  assert.equal((await restoredCall('status')).body.modelBudget.dailyReservedMicroUsd,100);
  assert.equal((await restoredCall('model-reserve',{key:unknownKey,cost:100,dailyLimit:200,monthlyLimit:400})).status,409);
  assert.equal((await restoredCall('publish',{generatedAt:pending.generatedAt})).status,409);
 }finally{await mf.dispose();}
});
test('durable conservative model reservations cap spending and never replay uncertain calls',async()=>{
 const s=await setup(),one='a'.repeat(64),two='b'.repeat(64),three='c'.repeat(64);
 const args={key:one,cost:100,dailyLimit:200,monthlyLimit:400};
 assert.equal((await s.call('model-reserve',args)).created,true);
 const retry=await s.call('model-reserve',args);assert.equal(retry.state,'reserved');assert.equal(retry.created,undefined);
 await s.call('model-reserve',{...args,key:two});
 await assert.rejects(()=>s.call('model-reserve',{...args,key:three}),/budget limit/);
 await s.call('model-complete',{key:one,actualCost:100,result:{story:{headline:'Fictional cached copy'},usage:{inputTokens:1,outputTokens:1,totalTokens:2}}});
 assert.equal((await s.call('model-reserve',args)).state,'completed');
 await assert.rejects(()=>s.call('model-reserve',{...args,key:three}),/budget limit/);
});
test('confirmed model usage settles reservation atomically without refunding unknown calls',async()=>{
 const s=await setup(),a='d'.repeat(64),b='e'.repeat(64),c='f'.repeat(64);
 const args={cost:100,dailyLimit:200,monthlyLimit:400};
 await s.call('model-reserve',{...args,key:a});await s.call('model-reserve',{...args,key:b});
 await assert.rejects(()=>s.call('model-complete',{key:a,actualCost:101,result:{fictional:true}}),/within reservation/);
 await s.call('model-complete',{key:a,actualCost:0,result:{fictional:true}});
 assert.equal((await s.call('model-reserve',{...args,key:c})).created,true);
 await assert.rejects(()=>s.call('model-complete',{key:a,actualCost:0,result:{fictional:true}}),/already resolved/);
 assert.equal((await s.call('model-reserve',{...args,key:b})).state,'reserved');
});
test('superseded snapshots cannot stage or publish and preserve newer pending checkpoint',async()=>{
 const s=await setup(),root=await s.call('root'),a=snapshot(root);await s.call('snapshot',{snapshot:a});
 for(const row of a.selectedStories)await s.call('stage',await author(s,a,row));await s.call('validate',{generatedAt:a.generatedAt});
 const b=snapshot(root,Date.parse(a.generatedAt)+1);await s.call('snapshot',{snapshot:b});
 await assert.rejects(()=>s.call('publish',{generatedAt:a.generatedAt}),/pending batch/);
 assert.equal((await s.call('status')).pending,b.generatedAt);
});
test('durable runner leases fence concurrency and stale continuations after interruption',async()=>{
 const s=await setup({SCHEDULE_ENABLED:'true',AUTO_EDITORIAL_ENABLED:'true',MUTATIONS_ENABLED:'true',LIVE_FETCH_ENABLED:'true'}),f=snapshot(await s.call('root'));await s.call('snapshot',{snapshot:f});
 const claims=await Promise.all([s.call('run-claim'),s.call('run-claim')]);assert.equal(claims.filter(x=>x.claimed).length,1);
 const old=claims.find(x=>x.claimed).token;
 await assert.rejects(()=>s.call('run-progress',{generatedAt:f.generatedAt,id:f.selectedStories[0].id}),/owns editorial writes/);
 await s.call('run-progress',{generatedAt:f.generatedAt,id:f.selectedStories[0].id,_runToken:old});
 const lease=await s.storage.get('run/lease');await s.storage.put('run/lease',{...lease,expiresAt:0});
 const newer=await s.call('run-claim');assert.equal(newer.claimed,true);
 await assert.rejects(()=>s.call('run-progress',{generatedAt:f.generatedAt,id:f.selectedStories[1].id,_runToken:old}),/superseded/);
 const watchdog=s.storage.alarm;assert.equal(watchdog,newer.expiresAt+1000);
 assert.equal((await s.call('run-release',{_runToken:old,collectionFailure:{httpStatus:502,details:{phase:'items',reason:'http',upstreamStatus:503}}})).released,false);assert.equal(s.storage.alarm,watchdog);
 assert.equal((await s.call('status')).runner.collectionFailure,null,'stale owners cannot replace recovery diagnostics or alarms');
 assert.equal((await s.call('status',{generatedAt:f.generatedAt})).cursor,f.selectedStories[0].id);
 await s.call('run-release',{_runToken:newer.token});
});
test('bounded automatic runs resume checkpoints and progress past unknown model outcomes without replay',async()=>{
 const s=await setup(),f=snapshot(await s.call('root'));await s.call('snapshot',{snapshot:f});
 const first=f.selectedStories[0];await author(s,f,first);
 const source=await s.call('get-source',{generatedAt:f.generatedAt,id:first.id});
 const key=await api.digest({policy:'editorial-v3-normalized-copy',model:'gpt-6-luna',maxOutputTokens:1024,id:first.id,title:first.title,url:first.url,kind:source.kind,excerpt:source.excerpt,description:source.description});
 await s.call('model-reserve',{key,cost:66560,dailyLimit:1_000_000,monthlyLimit:1_000_000});
 for(const row of f.selectedStories.slice(1)){
  const unavailable={id:row.id,generatedAt:f.generatedAt,kind:'unavailable',excerpt:'',description:'',url:row.url,fetchedAt:new Date().toISOString(),status:'source_unavailable'};
  unavailable.fingerprint=await api.digest(unavailable);await s.call('source',{generatedAt:f.generatedAt,source:unavailable});
 }
 const env={NEWSROOM:{idFromName:()=>0,get:()=>({fetch:async req=>{const args=await req.json();return s.request(new URL(req.url).pathname.slice(1),args);}})},AUTO_EDITORIAL_ENABLED:'true',MUTATIONS_ENABLED:'true',LIVE_FETCH_ENABLED:'true',MODEL_API_ENABLED:'true',OPENAI_API_KEY:'fictional',MODEL_INPUT_USD_PER_MILLION:'1',MODEL_OUTPUT_USD_PER_MILLION:'1',MODEL_DAILY_LIMIT_MICRO_USD:'1000000',MODEL_MONTHLY_LIMIT_MICRO_USD:'1000000'};
 const firstRun=await api.runEdition(env);assert.equal(firstRun.attempted,3);assert.deepEqual(firstRun.blockedIds,[first.id]);
 for(let i=0;i<Math.ceil(f.selectedStories.length/3);i++){const result=await api.runEdition(env);assert.ok(result.attempted<=3);assert.equal(result.published,false);}
 const status=await s.call('status',{generatedAt:f.generatedAt});assert.deepEqual(status.missingIds,[first.id]);assert.equal(status.staged,f.selectedStories.length-1);
 assert.equal((await s.storage.get('model/'+key)).state,'reserved');await assert.rejects(()=>s.call('edition'),/No published/);
});
test('automatic runner honors time deadline then resumes complete synthetic publication',async()=>{
 const s=await setup({MUTATIONS_ENABLED:'true',LIVE_FETCH_ENABLED:'true'}),f=snapshot(await s.call('root'));await s.call('snapshot',{snapshot:f});
 for(const row of f.selectedStories){const source={id:row.id,generatedAt:f.generatedAt,kind:'unavailable',excerpt:'',description:'',url:row.url,fetchedAt:new Date().toISOString(),status:'source_unavailable'};source.fingerprint=await api.digest(source);await s.call('source',{generatedAt:f.generatedAt,source});}
 const realNow=Date.now;let clock=realNow(),advance=true;Date.now=()=>clock;
 const env={NEWSROOM:{idFromName:()=>0,get:()=>({fetch:async req=>{const op=new URL(req.url).pathname.slice(1),response=await s.request(op,await req.json());if(op==='stage'&&advance)clock+=90_001;return response;}})},AUTO_EDITORIAL_ENABLED:'true',MUTATIONS_ENABLED:'true',LIVE_FETCH_ENABLED:'true',PUBLICATION_ENABLED:'true'};
 try{
  const partial=await api.runEdition(env);assert.equal(partial.attempted,1);assert.equal(partial.published,false);
  advance=false;let result;
  for(let i=0;i<Math.ceil(f.selectedStories.length/3)+7;i++){result=await api.runEdition(env);if(result.publication)break;}
  assert.equal(result.publication.published,true);assert.equal(result.verifiedVersion,result.publication.version);
  assert.equal((await s.call('edition')).edition.stories.length,f.selectedStories.length);
 }finally{Date.now=realNow;}
});
test('durable alarms continue healthy chunks promptly and back off blocked batches',async()=>{
 const env={AUTO_EDITORIAL_ENABLED:'true',SCHEDULE_ENABLED:'true',MUTATIONS_ENABLED:'true',LIVE_FETCH_ENABLED:'true',PUBLICATION_ENABLED:'true'};
 const s=await setup(env);env.NEWSROOM={idFromName:()=>0,get:()=>({fetch:async req=>s.request(new URL(req.url).pathname.slice(1),await req.json())})};
 const f=snapshot(await s.call('root'));await s.call('snapshot',{snapshot:f});
 for(const row of f.selectedStories){const source={id:row.id,generatedAt:f.generatedAt,kind:'unavailable',excerpt:'',description:'',url:row.url,fetchedAt:new Date().toISOString(),status:'source_unavailable'};source.fingerprint=await api.digest(source);await s.call('source',{generatedAt:f.generatedAt,source});}
 const claim=await s.call('run-claim');assert.ok(s.storage.alarm>=Date.now()+299_000);
 await s.call('run-release',{_runToken:claim.token});assert.ok(s.storage.alarm>=Date.now()+1799_000);
 await s.newsroom.alarm();assert.ok(s.storage.alarm<=Date.now()+1_000);assert.equal((await s.call('status',{generatedAt:f.generatedAt})).staged,3);
 for(let i=0;i<Math.ceil(f.selectedStories.length/3)+6;i++){if((await s.call('status')).pending)await s.newsroom.alarm();}
 assert.equal(s.storage.alarm,null);assert.equal((await s.call('edition')).edition.stories.length,f.selectedStories.length);
 env.SCHEDULE_ENABLED='false';await s.newsroom.alarm();assert.equal((await s.call('status')).pending,null);
});
test('transient metadata failures retain a bounded recovery alarm before any snapshot exists',async()=>{
 const env={AUTO_EDITORIAL_ENABLED:'true',SCHEDULE_ENABLED:'true',MUTATIONS_ENABLED:'true',LIVE_FETCH_ENABLED:'true'},s=await setup(env),original=globalThis.fetch;
 const realNow=Date.now;let clock=realNow();Date.now=()=>clock;
 env.NEWSROOM={idFromName:()=>0,get:()=>({fetch:async req=>s.request(new URL(req.url).pathname.slice(1),await req.json())})};
 let requests=0;globalThis.fetch=async()=>{requests++;return new Response('fictional upstream failure',{status:503});};
 try{
  const scheduledTime=Date.now(),slot=String(Math.floor(scheduledTime/1800_000)),work=[];
  await api.worker.scheduled({scheduledTime},env,{waitUntil:p=>work.push(p)});await Promise.allSettled(work);
  for(let attempt=1;attempt<=3;attempt++){
   const status=await s.call('status'),failure=status.runner.collectionFailure;
   assert.equal(status.pending,null);assert.equal(status.publicationVersion,'empty');assert.equal(status.runner.leaseExpiresAt,null);
   if(attempt<3)assert.ok(s.storage.alarm!==null,'transient collection failure must not delete its recovery alarm');
   assert.ok(failure,'pre-snapshot failure must survive for private diagnosis');assert.equal(failure.attempts,attempt);assert.equal(failure.scheduleSlot,slot);
   assert.deepEqual(failure.details,{phase:'current_list',reason:'http',upstreamStatus:503});assert.equal(failure.httpStatus,502);
   if(attempt===3){assert.equal(s.storage.alarm,null);assert.equal(failure.retryAt,null);break;}
   assert.ok(s.storage.alarm>=Date.now()+59_000&&s.storage.alarm<=Date.now()+60_000);assert.equal(failure.retryAt,new Date(s.storage.alarm).toISOString());
   const alarm=s.storage.alarm,duplicate=[];await api.worker.scheduled({scheduledTime},env,{waitUntil:p=>duplicate.push(p)});await Promise.all(duplicate);assert.equal(s.storage.alarm,alarm);
   s.storage.alarm=null;await s.newsroom.alarm();assert.equal(requests,attempt,'early platform retries respect the durable backoff');assert.equal(s.storage.alarm,alarm,'an early delivered alarm must restore the planned retry');
   clock=alarm;
   await assert.rejects(()=>s.newsroom.alarm(),/background run failed/);
  }
  await s.newsroom.alarm();
  assert.equal(requests,3,'two metadata retries only; no source or model requests');
  await s.call('schedule',{slot:String(Number(slot)+1)});await assert.rejects(()=>api.runEdition(env));
  assert.equal((await s.call('status')).runner.collectionFailure.attempts,1,'a new scheduled slot gets a fresh bounded attempt budget');
 }finally{globalThis.fetch=original;Date.now=realNow;}
});
test('metadata retry collects a fresh snapshot and completes normal fictional publication',async()=>{
 const env={AUTO_EDITORIAL_ENABLED:'true',SCHEDULE_ENABLED:'true',MUTATIONS_ENABLED:'true',LIVE_FETCH_ENABLED:'true',PUBLICATION_ENABLED:'true'},s=await setup(env),original=globalThis.fetch,realNow=Date.now;
 let clock=realNow(),fail=true;Date.now=()=>clock;
 env.NEWSROOM={idFromName:()=>0,get:()=>({fetch:async req=>s.request(new URL(req.url).pathname.slice(1),await req.json())})};
 const ids=Array.from({length:90},(_,i)=>7000+i);
 globalThis.fetch=async input=>{
  if(fail)throw TypeError('fictional transport interruption');
  const url=String(input);if(url.endsWith('/topstories.json'))return Response.json(ids);
  if(url.startsWith('https://hn.algolia.com/'))return Response.json({hits:[],hitsPerPage:100,nbHits:0,nbPages:0,page:0});
  const match=url.match(/^https:\/\/hacker-news\.firebaseio\.com\/v0\/item\/(\d+)\.json$/);assert.ok(match,'only fictional HN metadata requests, no model calls');
  const id=Number(match[1]);return Response.json({id,type:'story',title:'Fictional compiler '+id,url:'https://fictional.example/'+id,score:200,descendants:20,time:Math.floor(clock/1000)-3600});
 };
 try{
  await s.call('schedule',{slot:String(Math.floor(clock/1800_000))});await assert.rejects(()=>api.runEdition(env));
  clock=s.storage.alarm;fail=false;
  const result=await api.runEdition(env);assert.equal(result.checkpoint,'collected');assert.equal(result.generatedAt,new Date(clock).toISOString());
  const status=await s.call('status');assert.equal(status.generatedAt,null,'collecting metadata must not falsely refresh the publication');
  assert.ok(status.runner.collectionFailure.recoveredAt);assert.equal(status.runner.collectionFailure.retryAt,null);assert.equal(status.runner.collectionFailure.attempts,1);
  const f=await s.call('selection',{generatedAt:result.generatedAt});
  for(const row of f.selectedStories){const source={id:row.id,generatedAt:f.generatedAt,kind:'unavailable',excerpt:'',description:'',url:row.url,fetchedAt:new Date(clock).toISOString(),status:'source_unavailable'};source.fingerprint=await api.digest(source);await s.call('source',{generatedAt:f.generatedAt,source});}
  for(let i=0;i<Math.ceil(f.selectedStories.length/3)+7;i++){if((await s.call('status')).pending)await s.newsroom.alarm();}
  assert.equal((await s.call('edition')).edition.generatedAt,result.generatedAt);assert.equal((await s.call('status')).pending,null);assert.equal(s.storage.alarm,null);
  assert.equal((await s.call('status')).modelBudget.dailyReservedMicroUsd,0);
 }finally{globalThis.fetch=original;Date.now=realNow;}
});
test('metadata recovery fails closed for invalid payloads, request limits, authorization and safety holds',async()=>{
 const original=globalThis.fetch;
 try{
  for(const [fetcher,reason] of [
   [async()=>Response.json([]),'payload'],
   [async()=>new Response('fictional',{status:403}),'http'],
   [async()=>new Response('fictional',{headers:{'content-type':'text/plain'}}),'content_type'],
   [async()=>{throw Error('Too many subrequests');},'request_limit'],
  ]){
   const env={AUTO_EDITORIAL_ENABLED:'true',SCHEDULE_ENABLED:'true',MUTATIONS_ENABLED:'true',LIVE_FETCH_ENABLED:'true'},s=await setup(env);let requests=0;
   env.NEWSROOM={idFromName:()=>0,get:()=>({fetch:async req=>s.request(new URL(req.url).pathname.slice(1),await req.json())})};
   globalThis.fetch=async(...args)=>{requests++;return fetcher(...args);};
   await assert.rejects(()=>api.runEdition(env));assert.equal(s.storage.alarm,null);assert.equal((await s.call('status')).runner.collectionFailure.details.reason,reason);
   await s.newsroom.alarm();assert.equal(requests,1,'duplicate alarm must not retry a non-transient failure');
  }
  for(const enabled of [true,false]){
   const env={AUTO_EDITORIAL_ENABLED:'true',SCHEDULE_ENABLED:enabled?'true':'false',MUTATIONS_ENABLED:'true',LIVE_FETCH_ENABLED:'true'},s=await setup(env);let requests=0;
   env.NEWSROOM={idFromName:()=>0,get:()=>({fetch:async req=>s.request(new URL(req.url).pathname.slice(1),await req.json())})};
   globalThis.fetch=async()=>{requests++;return new Response('fictional',{status:429});};
   await assert.rejects(()=>api.runEdition(env));assert.equal(s.storage.alarm!==null,enabled);
   const root=await s.call('root');await api.writeBlob(s.storage,'root',{...root,safetyStop:{kind:'safety_stop',at:new Date().toISOString()}});
   await assert.rejects(()=>api.runEdition(env),/safety stop/);assert.equal(requests,1);
  }
 }finally{globalThis.fetch=original;}
});
test('private metadata failure diagnostics strip arbitrary fields and cannot bypass retry policy',async()=>{
 const s=await setup({AUTO_EDITORIAL_ENABLED:'true',SCHEDULE_ENABLED:'true',MUTATIONS_ENABLED:'true',LIVE_FETCH_ENABLED:'true'}),lease=await s.call('run-claim');
 await s.call('run-release',{_runToken:lease.token,collectionFailure:{httpStatus:409,details:{phase:'invalid',reason:'transport',upstreamStatus:null,message:'FICTIONAL_SECRET'},body:'FICTIONAL_SECRET',retryAt:'2099-01-01T00:00:00.000Z'}});
 const status=await s.call('status');assert.equal(status.runner.collectionFailure.details,null);assert.equal(status.runner.collectionFailure.httpStatus,409);assert.equal(s.storage.alarm,null);assert.ok(!JSON.stringify(status).includes('FICTIONAL_SECRET'));
 assert.equal((await s.call('run-release',{collectionFailure:{httpStatus:502,details:{phase:'items',reason:'http',upstreamStatus:503}}})).released,false);
 assert.deepEqual((await s.call('status')).runner.collectionFailure,status.runner.collectionFailure,'release without a lease cannot invent retries');
});
test('real workerd alarms finish bounded chunks through the private namespace',async()=>{
 const file=path.join(dir,'alarm-worker.mjs');await build({entryPoints:['worker/production.ts'],outfile:file,bundle:true,format:'esm',platform:'browser'});
 const mf=new Miniflare(convertV4MiniflareOptions({rootPath:dir,workers:[{name:'editorial',outboundService:'provider',modules:true,scriptPath:file,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],durableObjects:{NEWSROOM:{className:'Newsroom',useSQLite:true}},bindings:{MUTATIONS_ENABLED:'true',LIVE_FETCH_ENABLED:'true',PUBLICATION_ENABLED:'true',SCHEDULE_ENABLED:'true',AUTO_EDITORIAL_ENABLED:'true',MODEL_API_ENABLED:'true',OPENAI_API_KEY:'fictional',EDITORIAL_MODEL:'gpt-6-luna',MODEL_MAX_OUTPUT_TOKENS:'1024',MODEL_INPUT_USD_PER_MILLION:'0.125',MODEL_OUTPUT_USD_PER_MILLION:'0.50',MODEL_DAILY_LIMIT_MICRO_USD:'1000000',MODEL_MONTHLY_LIMIT_MICRO_USD:'5000000'}},{name:'provider',modules:true,compatibilityDate:'2026-05-15',script:`const attempts=new Map();export default {async fetch(request){
 if(request.method==='GET')return Response.json(null);
 const input=await request.json();const data=JSON.parse(input.input[0].content[0].text);const attempt=attempts.get(data.originalTitle)||0;attempts.set(data.originalTitle,attempt+1);
 return Response.json({status:'completed',usage:{input_tokens:700,output_tokens:150,total_tokens:850},output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({headline:data.originalTitle,summary:'A fictional system demonstrates a synthetic operation.',shortSummary:data.originalTitle==='Fictional system 0'&&attempt===0?'a'.repeat(281):'A fictional system demonstrates a synthetic operation.',summarySource:'article'})}]}]});
 }};`}]}));
 try{
  const ns=await mf.getDurableObjectNamespace('NEWSROOM'),stub=ns.get(ns.idFromName('production-v1'));
  const call=async(op,args={})=>{const r=await stub.fetch('https://internal/'+op,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args)});const b=await r.json();if(!r.ok)throw Error(b.error);return b;};
  const f=snapshot(await call('root'));await call('snapshot',{snapshot:f});
  for(const row of f.selectedStories){const source={id:row.id,generatedAt:f.generatedAt,kind:'article',excerpt:'A fictional system demonstrates a synthetic operation.',description:'',url:row.url,fetchedAt:new Date().toISOString(),status:'fetched'};source.fingerprint=await api.digest(source);await call('source',{generatedAt:f.generatedAt,source});}
  const lease=await call('run-claim');await call('run-release',{_runToken:lease.token,continuationDelayMs:1000});
  const deadline=Date.now()+35_000;let status;
  do{await new Promise(resolve=>setTimeout(resolve,250));status=await call('status');}while(status.pending&&Date.now()<deadline);
  assert.equal(status.pending,null,'actual durable alarms should continue without another cron tick');
  assert.equal((await call('edition')).edition.stories.length,f.selectedStories.length);
  assert.equal((await call('status',{generatedAt:f.generatedAt})).failure.details.code,'copy_schema','one deliberately overlength response was recovered automatically');
 }finally{await mf.dispose();}
});
test('entire public admin surface is404 without auth, body parsing or namespace access',async()=>{
 const env=new Proxy({}, {get(){throw Error('Removed admin route must not inspect credentials, switches or bindings');}});
 const paths=['/admin','/admin/','/admin/status','/admin/run','/admin/collect','/admin/source','/admin/summarize','/admin/stage','/admin/failure','/admin/validate','/admin/publish','/admin/unknown','/%61dmin/status','/admin%2fstatus','/x/../admin/status'];
 for(const path of paths)for(const method of ['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS']){
  const request=new Request('https://reader.example'+path,{method,headers:{Authorization:'Bearer '+ 'A'.repeat(64),'oai-authenticated-user-email':'owner@example.com','Content-Type':'application/json'},...(!['GET','HEAD'].includes(method)?{body:'invalid-json'}:{})});
  const response=await api.worker.fetch(request,env);assert.equal(response.status,404,method+' '+path);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(request.bodyUsed,false);assert.equal(await response.text(),method==='HEAD'?'':'Not found');
 }
});
test('internal scheduled entry still stages a bounded fictional batch without public administration',async()=>{
 const s=await setup(),f=snapshot(await s.call('root'));await s.call('snapshot',{snapshot:f});
 for(const row of f.selectedStories){const source={id:row.id,generatedAt:f.generatedAt,kind:'unavailable',excerpt:'',description:'',url:row.url,fetchedAt:new Date().toISOString(),status:'source_unavailable'};source.fingerprint=await api.digest(source);await s.call('source',{generatedAt:f.generatedAt,source});}
 const env={NEWSROOM:{idFromName:()=>0,get:()=>({fetch:async req=>s.request(new URL(req.url).pathname.slice(1),await req.json())})},AUTO_EDITORIAL_ENABLED:'true',SCHEDULE_ENABLED:'true',MUTATIONS_ENABLED:'true',LIVE_FETCH_ENABLED:'true',PUBLICATION_ENABLED:'false'};
 const work=[];await api.worker.scheduled({scheduledTime:Date.now()},env,{waitUntil:p=>work.push(p)});await Promise.all(work);
 assert.equal((await s.call('status',{generatedAt:f.generatedAt})).staged,3);assert.equal((await s.call('status')).publicationVersion,'empty');
 const duplicate=[];await api.worker.scheduled({scheduledTime:Date.now()},env,{waitUntil:p=>duplicate.push(p)});await Promise.all(duplicate);
 assert.equal((await s.call('status',{generatedAt:f.generatedAt})).staged,3);
});
test('background logs allow only fixed outcomes and bounded metadata, never secrets or raw errors',async()=>{
 const secret='FICTIONAL_SECRET_MUST_NOT_LOG',lines=[];
 await api.observeRun('cron',async()=>({checkpoint:'staged',attempted:3,missingIds:[secret],blockedIds:[secret],generatedAt:secret,verifiedVersion:secret,headers:{authorization:secret},story:{summary:secret},provider:{body:secret}}),line=>lines.push(line));
 assert.equal(lines.length,1);assert.ok(!lines[0].includes(secret));const event=JSON.parse(lines[0]);assert.equal(event.outcome,'blocked');assert.equal(event.blocked,1);assert.equal(event.remaining,1);assert.equal(event.generatedAt,null);assert.equal(event.publicationVersion,null);
 await assert.rejects(()=>api.observeRun('alarm',async()=>{throw Error(secret);},line=>lines.push(line)),error=>error.message==='Hacker Times background run failed; inspect private stored state.'&&!error.cause);
 assert.ok(!lines.join('').includes(secret));assert.equal(JSON.parse(lines[1]).httpStatus,500);
 await assert.rejects(()=>api.observeRun('cron',async()=>{throw new api.CollectionError(secret,{phase:'items',reason:'http',upstreamStatus:429});},line=>lines.push(line)));
 assert.deepEqual(JSON.parse(lines[2]).collection,{phase:'items',reason:'http',upstreamStatus:429});assert.ok(!lines.join('').includes(secret));
 const success=api.runLogEvent('alarm',{publication:{published:true,version:'e-'+'a'.repeat(24)},generatedAt:'2026-11-11T00:00:00.000Z'});assert.equal(success.outcome,'published');assert.equal(success.publicationVersion,'e-'+'a'.repeat(24));
 assert.equal(api.runLogEvent('cron',{checkpoint:'deduplicated'}).outcome,'skipped');
});

test('production collection hydrates the complete pool in private batches below the request limit',async()=>{
 const original=globalThis.fetch,env={LIVE_FETCH_ENABLED:'true',MUTATIONS_ENABLED:'true'},s=await setup(env);
 const ids=Array.from({length:90},(_,i)=>7000+i),batches=[];let external=0,inTransaction=false;
 const transaction=s.storage.transaction.bind(s.storage);
 s.storage.transaction=fn=>transaction(async tx=>{inTransaction=true;try{return await fn(tx);}finally{inTransaction=false;}});
 env.NEWSROOM={idFromName:x=>x,get:()=>({fetch:async request=>{
  const op=new URL(request.url).pathname.slice(1),args=await request.json();
  if(op==='collect-items')batches.push(args.ids.length);
  return s.request(op,args);
 }})};
 globalThis.fetch=async input=>{
  assert.equal(inTransaction,false,'source reads must run outside storage transactions');external++;
  const u=String(input);
  if(u.endsWith('/topstories.json'))return Response.json(ids);
  if(u.startsWith('https://hn.algolia.com/'))return Response.json({hits:[],hitsPerPage:100,nbHits:0,nbPages:0,page:0});
  const match=u.match(/\/item\/(\d+)\.json$/);assert.ok(match,'no HTML scraping or model call');
  const id=Number(match[1]);return Response.json({id,type:'story',title:'Fictional compiler '+id,url:'https://fictional.example/'+id,score:200,descendants:20,time:Math.floor(Date.now()/1000)-3600});
 };
 try{
  const snapshot=await api.collectMetadata(env);
  assert.deepEqual(batches,[32,32,26]);assert.equal(external,107); // topstories + 16 index queries + 90 official items
  assert.equal(snapshot.rankedStories.length,90);assert.equal(snapshot.discovery.currentSource,'hn-topstories-api');
  assert.equal((await s.call('status')).pending,snapshot.generatedAt);
  const before=external;
  assert.equal((await s.request('collect-items',{ids:ids.slice(0,33),at:Date.now()})).status,400);
  assert.equal(external,before);
  await s.call('failure',{generatedAt:snapshot.generatedAt,kind:'safety_stop'});
  assert.equal((await s.request('collect-items',{ids:[ids[0]],at:Date.now()})).status,409);
  assert.equal(external,before);
 }finally{globalThis.fetch=original;}
});

test('private failure status retains bounded diagnostics and strips arbitrary provider fields',async()=>{
 const s=await setup(),f=snapshot(await s.call('root'));await s.call('snapshot',{snapshot:f});
 await s.call('failure',{generatedAt:f.generatedAt,storyId:f.selectedStories[0].id,kind:'transient',details:{phase:'http',httpStatus:429,code:'insufficient_quota',message:'synthetic-secret',body:'synthetic-source'}});
 const status=await s.call('status',{generatedAt:f.generatedAt});
 assert.deepEqual(status.failure.details,{phase:'http',httpStatus:429,code:'insufficient_quota'});
 assert.ok(!JSON.stringify(status).includes('synthetic-secret'));
 assert.ok(!JSON.stringify(status).includes('synthetic-source'));
});

test('alarm storage operations stay in-object rather than re-entering its namespace',async()=>{
 const env={AUTO_EDITORIAL_ENABLED:'true',SCHEDULE_ENABLED:'true',MUTATIONS_ENABLED:'true',LIVE_FETCH_ENABLED:'true',PUBLICATION_ENABLED:'true',NEWSROOM:{idFromName(){throw Error('Alarm must not make a self subrequest for storage');}}};
 const s=await setup(env),f=snapshot(await s.call('root'));await s.call('snapshot',{snapshot:f});
 for(const row of f.selectedStories){const source={id:row.id,generatedAt:f.generatedAt,kind:'unavailable',excerpt:'',description:'',url:row.url,fetchedAt:new Date().toISOString(),status:'source_unavailable'};source.fingerprint=await api.digest(source);await s.call('source',{generatedAt:f.generatedAt,source});}
 await s.newsroom.alarm();assert.equal((await s.call('status',{generatedAt:f.generatedAt})).staged,3);
 assert.equal((await s.call('status')).runner.leaseExpiresAt,null);
 assert.ok(s.storage.alarm<=Date.now()+1000);
});

test('confirmed output failures get bounded budgeted retries; unknown calls and unrelated keys stay blocked',async()=>{
 const s=await setup(),f=snapshot(await s.call('root'));await s.call('snapshot',{snapshot:f});
 const row=f.selectedStories[0];await author(s,f,row);const source=await s.call('get-source',{generatedAt:f.generatedAt,id:row.id});
 const key=await api.digest({policy:'editorial-v3-normalized-copy',model:'gpt-6-luna',maxOutputTokens:1024,id:row.id,title:row.title,url:row.url,kind:source.kind,excerpt:source.excerpt,description:source.description});
 const args={key,cost:100,dailyLimit:300,monthlyLimit:500},failed={key,generatedAt:f.generatedAt,storyId:row.id,actualCost:30};
 await s.call('model-reserve',args);
 await s.call('failure',{generatedAt:f.generatedAt,storyId:row.id,kind:'transient',details:{phase:'timeout'}});
 await assert.rejects(()=>s.call('model-failed',failed),/Confirmed output/);
 await s.call('failure',{generatedAt:f.generatedAt,storyId:row.id,kind:'validation',details:{phase:'output',code:'copy_text'}});
 await assert.rejects(()=>s.call('model-failed',{...failed,key:'a'.repeat(64)}),/pinned source/);
 assert.equal((await s.call('model-failed',failed)).retryable,true);
 assert.equal((await s.call('status')).modelBudget.dailyReservedMicroUsd,30);
 const retry=await s.call('model-reserve',args);assert.equal(retry.created,true);assert.equal(retry.attempt,2);
 assert.equal((await s.call('status')).modelBudget.dailyReservedMicroUsd,130);
 assert.equal((await s.call('model-failed',{...failed,actualCost:20})).retryable,true);
 assert.equal((await s.call('status')).modelBudget.dailyReservedMicroUsd,50);
 assert.equal((await s.call('model-reserve',args)).attempt,3);
 assert.equal((await s.call('model-failed',{...failed,actualCost:20})).retryable,false);
 assert.equal((await s.call('status')).modelBudget.dailyReservedMicroUsd,70);
 assert.equal((await s.call('model-reserve',args)).created,undefined);
 assert.equal((await s.call('model-reserve',args)).state,'failed');
});

test('historical output recovery retains its full reservation and checks retry spending limits',async()=>{
 const s=await setup(),f=snapshot(await s.call('root'));await s.call('snapshot',{snapshot:f});const row=f.selectedStories[0];await author(s,f,row);
 const source=await s.call('get-source',{generatedAt:f.generatedAt,id:row.id});
 const key=await api.digest({policy:'editorial-v3-normalized-copy',model:'gpt-6-luna',maxOutputTokens:1024,id:row.id,title:row.title,url:row.url,kind:source.kind,excerpt:source.excerpt,description:source.description});
 const args={key,cost:100,dailyLimit:150,monthlyLimit:500};await s.call('model-reserve',args);
 await s.call('failure',{generatedAt:f.generatedAt,storyId:row.id,kind:'validation',details:{phase:'output'}});
 await s.call('model-failed',{key,generatedAt:f.generatedAt,storyId:row.id,retainReservation:true});
 assert.equal((await s.call('status')).modelBudget.dailyReservedMicroUsd,100);
 await assert.rejects(()=>s.call('model-reserve',args),/budget limit/);
 assert.equal((await s.call('model-reserve',{...args,dailyLimit:200})).attempt,2);
 assert.equal((await s.call('status')).modelBudget.dailyReservedMicroUsd,200);
});


test('rate-limited publishers preserve selected links without invented summaries',async()=>{
 const old=globalThis.fetch;const s=await setup(),f=snapshot(await s.call('root')),row=f.selectedStories[0];let calls=0;
 try{globalThis.fetch=async()=>{calls++;return new Response('Rate limited',{status:429,headers:{'Retry-After':'1800'}});};
  const source=await api.collectSource(f,row.id);assert.equal(source.kind,'unavailable');assert.equal(source.status,'temporarily_rate_limited');assert.equal(source.excerpt,'');assert.equal(source.url,row.url);assert.equal(calls,1);
 }finally{globalThis.fetch=old;}
});

test('automatic publisher uses the exact feed entry and pins provenance across retries',async()=>{
 const env={LIVE_FETCH_ENABLED:'true',MODEL_API_ENABLED:'true',OPENAI_API_KEY:'fictional',MODEL_INPUT_USD_PER_MILLION:'0.125',MODEL_OUTPUT_USD_PER_MILLION:'0.5',MODEL_DAILY_LIMIT_MICRO_USD:'1000000',MODEL_MONTHLY_LIMIT_MICRO_USD:'5000000'};
 const s=await setup(env),f=snapshot(await s.call('root'));await s.call('snapshot',{snapshot:f});
 const selected=f.selectedStories[0],args={generatedAt:f.generatedAt,id:selected.id};
 env.NEWSROOM={idFromName:x=>x,get:()=>({fetch:req=>s.newsroom.fetch(req)})};
 const evidence='The fictional archive now groups paper by color to speed up filing.';
 const old=globalThis.fetch;let modelCalls=0,feedCalls=0;
 try{
  globalThis.fetch=async(url,opts)=>{
   if(url===selected.url)return new Response('<head><link rel="alternate" type="application/rss+xml" href="/news.rss"></head><main><h1>Archive</h1></main>',{headers:{'content-type':'text/html'}});
   if(url==='https://fictional.example/news.rss'){
    feedCalls++;
    return new Response('<rss><channel><item><link>'+selected.url+'</link><pubDate>'+f.generatedAt+'</pubDate><description>'+evidence+'</description></item></channel></rss>');
   }
   assert.equal(url,'https://api.openai.com/v1/responses');modelCalls++;
   const input=JSON.parse(JSON.parse(opts.body).input[0].content[0].text);
   assert.deepEqual(input,{originalTitle:selected.title,evidenceKind:'publisher_feed',sourceText:evidence});
   return Response.json({status:'completed',usage:{input_tokens:50,output_tokens:30,total_tokens:80},output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({headline:selected.title,summary:evidence,shortSummary:evidence,summarySource:'publisher_feed'})}]}]});
  };
  await api.summarize(env,args);await api.summarize(env,args);
  const record=await s.storage.get('stage/'+f.generatedAt+'/'+selected.id),source=await s.call('get-source',args);
  assert.equal(record.story.summarySource,'publisher_feed');assert.equal(record.story.url,selected.url);
  assert.equal(source.status,'insufficient_source_text');assert.equal(source.feedUrl,'https://fictional.example/news.rss');
  assert.equal(record.sourceFingerprint,source.fingerprint);assert.equal(feedCalls,1);assert.equal(modelCalls,1);
 }finally{globalThis.fetch=old;}
});

test('published tutorial copy survives a later failed fetch without a paid call or stale metrics',async()=>{
 const s=await setup(),t=Date.now()-3600000,items=pool(t);
 items[1].title='Understanding fictional paper sorting';
 const old=snapshot(await s.call('root'),t,items);await s.call('snapshot',{snapshot:old});
 for(const row of old.selectedStories)await s.call('stage',await author(s,old,row));
 await s.call('validate',{generatedAt:old.generatedAt});const pub=await s.call('publish',{generatedAt:old.generatedAt});
 items[1].score+=1;
 const fresh=snapshot(await s.call('root'),t+30000,items);await s.call('snapshot',{snapshot:fresh});
 const selected=fresh.selectedStories.find(row=>row.title===items[1].title),args={id:selected.id,generatedAt:fresh.generatedAt};
 const source={...args,kind:'unavailable',excerpt:'',description:'',url:selected.url,fetchedAt:fresh.generatedAt,status:'unavailable_http_403'};
 source.fingerprint=await api.digest(source);await s.call('source',{source,generatedAt:fresh.generatedAt});
 const env={LIVE_FETCH_ENABLED:'true',NEWSROOM:{idFromName:x=>x,get:()=>({fetch:req=>s.newsroom.fetch(req)})}};
 const budget=(await s.call('status')).modelBudget;
 await api.summarize(env,args);await api.summarize(env,args);
 const record=await s.storage.get('stage/'+fresh.generatedAt+'/'+selected.id),pinned=await s.call('get-source',args);
 assert.equal(record.story.summarySource,'archived_summary');assert.equal(pinned.archive.version,pub.version);
 assert.equal(pinned.archive.generatedAt,old.generatedAt);assert.equal(record.story.score,selected.score);
 assert.equal(record.story.summary,'A fictional system demonstrates a synthetic operation.');
 assert.deepEqual((await s.call('status')).modelBudget,budget);
});

test('corrected validation reuses a retained draft without another model charge or request',async()=>{
 const s=await setup(),f=snapshot(await s.call('root'));await s.call('snapshot',{snapshot:f});const row=f.selectedStories[0];await author(s,f,row);
 const source=await s.call('get-source',{generatedAt:f.generatedAt,id:row.id});
 const key=await api.digest({policy:'editorial-v3-normalized-copy',model:'gpt-6-luna',maxOutputTokens:1024,id:row.id,title:row.title,url:row.url,kind:source.kind,excerpt:source.excerpt,description:source.description});
 await s.call('model-reserve',{key,cost:100,dailyLimit:1000,monthlyLimit:2000});
 const prior=await s.storage.get('model/'+key),draft={headline:row.title,summary:'A fictional system sorts paper.',shortSummary:'A fictional system sorts paper. It uses color',summarySource:'article'};
 await s.storage.put('model/'+key,{...prior,state:'failed',attempt:3,retryable:true,draft});
 for(const other of f.selectedStories.slice(1)){const value={id:other.id,generatedAt:f.generatedAt,kind:'unavailable',excerpt:'',description:'',url:other.url,fetchedAt:new Date().toISOString(),status:'source_unavailable'};value.fingerprint=await api.digest(value);await s.call('source',{generatedAt:f.generatedAt,source:value});}
 const env={NEWSROOM:{idFromName:()=>0,get:()=>({fetch:async req=>s.request(new URL(req.url).pathname.slice(1),await req.json())})},AUTO_EDITORIAL_ENABLED:'true',MUTATIONS_ENABLED:'true',LIVE_FETCH_ENABLED:'true',MODEL_API_ENABLED:'true',OPENAI_API_KEY:'fictional',MODEL_INPUT_USD_PER_MILLION:'0.125',MODEL_OUTPUT_USD_PER_MILLION:'0.50',MODEL_DAILY_LIMIT_MICRO_USD:'1000000',MODEL_MONTHLY_LIMIT_MICRO_USD:'5000000'};
 const before=(await s.call('status')).modelBudget.dailyReservedMicroUsd;const result=await api.runEdition(env);assert.equal(result.blockedIds.length,0);
 const staged=await s.storage.get('stage/'+f.generatedAt+'/'+row.id);assert.equal(staged.story.shortSummary,draft.shortSummary);
 assert.equal((await s.call('status')).modelBudget.dailyReservedMicroUsd,before);
});


test('historical archive import preserves current authority and rejects changed content',async()=>{
 const s=await setup(),root={...(await s.call('root')),version:'e-'+ 'a'.repeat(24),generatedAt:'2026-11-12T05:30:00.000Z',revision:7,archives:{'2026-11-12':'e-'+ 'a'.repeat(24)}};
 await api.writeBlob(s.storage,'root',root);
 const edition={generatedAt:'2026-11-02T12:00:00.000Z',editionDate:'2026-11-02',publicationVersion:'e-'+ 'b'.repeat(24),stories:[],candidateCount:0,ranking:'Synthetic archive'};
 const manifest={'2026-11-02':await api.digest(edition)};
 await s.storage.put('pending','unchanged-snapshot');await s.storage.put('budget/day/test',123);
 const first=await api.importArchive(s.storage,root,edition,manifest);assert.equal(first.imported,true);assert.equal(first.indexed,true);
 const after=await api.readBlob(s.storage,'root');assert.deepEqual(after,{...root,archives:{...root.archives,'2026-11-02':edition.publicationVersion}});
 assert.equal(await s.storage.get('pending'),'unchanged-snapshot');assert.equal(await s.storage.get('budget/day/test'),123);
 const publication=await api.readBlob(s.storage,'version/'+edition.publicationVersion);assert.deepEqual(publication.edition,edition);assert.match(publication.html,/Hacker Times/);
 assert.deepEqual(await api.importArchive(s.storage,after,edition,manifest),{imported:false,indexed:false,version:edition.publicationVersion,date:edition.editionDate});
 await assert.rejects(()=>api.importArchive(s.storage,after,{...edition,ranking:'Changed'},manifest),/approved migration manifest/);
 await assert.rejects(()=>api.importArchive(s.storage,{...root,generatedAt:'2026-11-01T00:00:00.000Z'},edition,manifest),/newer than/);
 const existing={...root,archives:{...root.archives,'2026-11-02':'e-'+ 'c'.repeat(24)}};
 await api.writeBlob(s.storage,'root',existing);await api.importArchive(s.storage,existing,edition,manifest);
 assert.deepEqual(await api.readBlob(s.storage,'root'),existing);
 assert.equal((await s.request('import-archive',{edition})).status,503);
});


test('cached copy drops old front-page rank when the current selection omits it',async()=>{
 const env={LIVE_FETCH_ENABLED:'true',MODEL_API_ENABLED:'true',OPENAI_API_KEY:'fictional-key',EDITORIAL_MODEL:'gpt-6-luna',MODEL_MAX_OUTPUT_TOKENS:'1024',MODEL_INPUT_USD_PER_MILLION:'0.125',MODEL_OUTPUT_USD_PER_MILLION:'0.50',MODEL_DAILY_LIMIT_MICRO_USD:'1000000',MODEL_MONTHLY_LIMIT_MICRO_USD:'5000000'};
 const s=await setup(env),at=Date.now()-120000,items=pool(at);delete items[10].hnPage;delete items[10].hnRank;
 const fixture=snapshot(await s.call('root'),at,items);await s.call('snapshot',{snapshot:fixture});
 const selected=fixture.selectedStories.find(x=>x.id===items[10].id);assert.ok(selected);
 const args=await author(s,fixture,selected),source=await s.call('get-source',{generatedAt:fixture.generatedAt,id:selected.id});
 const key=await api.digest({policy:api.EDITORIAL_REQUEST_POLICY,model:env.EDITORIAL_MODEL,maxOutputTokens:1024,id:selected.id,title:selected.title,url:selected.url,kind:source.kind,excerpt:source.excerpt,description:source.description});
 await s.call('model-reserve',{key,cost:100,dailyLimit:1000000,monthlyLimit:5000000});
 await s.call('model-complete',{key,actualCost:50,result:{story:{...args.story,hnPage:1,hnRank:3},usage:{inputTokens:1,outputTokens:1,totalTokens:2},requested:true}});
 const before=(await s.call('status')).modelBudget;
 const runEnv={...env,NEWSROOM:{idFromName:x=>x,get:()=>({fetch:req=>s.newsroom.fetch(req)})}};
 const staged=await api.summarize(runEnv,{generatedAt:fixture.generatedAt,id:selected.id});assert.equal(staged.revision,1);
 const record=await s.storage.get('stage/'+fixture.generatedAt+'/'+selected.id);assert.equal(record.story.hnPage,undefined);assert.equal(record.story.hnRank,undefined);assert.equal(record.story.summary,args.story.summary);
 assert.deepEqual((await s.call('status')).modelBudget,before);
});


test('publisher outages preserve every selected story and allow complete publication',async()=>{
 const old=globalThis.fetch;
 try{
  for(const failure of [500,502,503,504,520,'transport']){
   const s=await setup({MUTATIONS_ENABLED:'true',LIVE_FETCH_ENABLED:'true'}),f=snapshot(await s.call('root'));await s.call('snapshot',{snapshot:f});
   let calls=0;globalThis.fetch=async()=>{calls++;if(failure==='transport')throw new TypeError('network failed');return new Response('upstream failure',{status:failure});};
   const env={NEWSROOM:{idFromName:()=>0,get:()=>({fetch:async req=>s.request(new URL(req.url).pathname.slice(1),await req.json())})},AUTO_EDITORIAL_ENABLED:'true',MUTATIONS_ENABLED:'true',LIVE_FETCH_ENABLED:'true',PUBLICATION_ENABLED:'true'};
   for(let i=0;i<Math.ceil(f.selectedStories.length/3)+6;i++)await api.runEdition(env);
   const published=await s.call('edition');assert.equal(published.edition.stories.length,f.selectedStories.length);
   assert.equal(calls,f.selectedStories.length+24);
   assert.equal(published.edition.discussionHighlights.status,'unavailable');
   for(const selected of f.selectedStories){
    const story=published.edition.stories.find(x=>x.id===selected.id);
    assert.equal(story.url,selected.url);assert.equal(story.headline,selected.title);
    assert.equal(story.summarySource,'unavailable');assert.equal(story.summary,'');assert.equal(story.shortSummary,'');
    const source=await s.storage.get('source/'+f.generatedAt+'/'+selected.id);
    assert.equal(source.status,failure==='transport'?'fetch_network_error':'unavailable_http_'+failure);
   }
   assert.equal((await s.call('status')).pending,null);
  }
 }finally{globalThis.fetch=old;}
});


test('automatic publication freezes Sites-style highlights in resumable request-bounded batches',async()=>{
 const old=globalThis.fetch,env={MUTATIONS_ENABLED:'true',LIVE_FETCH_ENABLED:'true',AUTO_EDITORIAL_ENABLED:'true',PUBLICATION_ENABLED:'true'};
 const s=await setup(env),f=snapshot(await s.call('root'));await s.call('snapshot',{snapshot:f});
 for(const row of f.selectedStories)await s.call('stage',await author(s,f,row));
 env.NEWSROOM={idFromName:x=>x,get:()=>({fetch:req=>s.newsroom.fetch(req)})};
 const ids=f.sourcePages.flatMap(p=>p.ids).slice(0,24),calls=[];
 let insideTransaction=false;const transaction=s.storage.transaction.bind(s.storage);
 s.storage.transaction=fn=>transaction(async tx=>{insideTransaction=true;try{return await fn(tx);}finally{insideTransaction=false;}});
 globalThis.fetch=async(url,options)=>{
  assert.equal(insideTransaction,false,'HN reads must not hold a storage transaction');
  assert.equal(options.credentials,'omit');assert.equal(options.redirect,'manual');
  const id=Number(String(url).match(/item\/(\d+)\.json$/)[1]);calls.push(id);
  if(ids.includes(id))return Response.json({id,type:'story',title:'Fictional discussion '+id,url:'https://fictional.example/thread/'+id,time:Math.floor(Date.now()/1000)-3600,kids:Array.from({length:5},(_,i)=>id*100+i),descendants:20});
  const parent=Math.floor(id/100);return Response.json({id,type:'comment',parent,by:'reader'+parent,time:Math.floor(Date.now()/1000)-60,text:'This fictional discussion explains why clear boundaries and careful testing help people understand a complicated system before changing how its parts work together.'});
 };
 try{
  let result;
  for(let i=0;i<6;i++){
   const before=calls.length;result=await api.runEdition(env);assert.equal(calls.length-before,24);
   if(i<5){assert.equal(result.checkpoint,'discussions');assert.equal((await s.call('root')).version,'empty');}
   if(i===0){let ready;const restored=new api.Newsroom({storage:s.storage,blockConcurrencyWhile:fn=>ready=fn()},env);await ready;env.NEWSROOM.get=()=>({fetch:req=>restored.fetch(req)});}
  }
  assert.equal(new Set(calls).size,144,'restarts must reuse the completed checkpoint');
  assert.equal(result.publication.published,true);
  const p=await s.call('edition'),h=p.edition.discussionHighlights;
  assert.equal(h.policy,'hn-trending-comments-v4');assert.equal(h.basePublicationVersion,'empty');assert.equal(h.status,'complete');assert.equal(h.items.length,16);
  assert.deepEqual(h.storyIds,ids);assert.deepEqual(h.items.map(x=>x.storyId),ids.slice(0,16));
  assert.equal((p.html.match(/data-highlight-page data-highlight-title/g)||[]).length,8);
  assert.match(p.html,/What People Are Talking About/);assert.doesNotMatch(p.html,/id="more-heading"/);
  assert.match(p.html,/news.ycombinator.com\/item\?id=10100/);assert.match(p.html,/reader101/);
  const before=calls.length;
  const archived=await s.call('edition',{date:f.generatedAt.slice(0,10)});assert.deepEqual(archived.edition.discussionHighlights,h);
  await api.worker.fetch(new Request('https://reader.example/'),env);await api.worker.fetch(new Request('https://reader.example/api/archive'),env);
  assert.equal(calls.length,before,'reading and archive browsing never recollect highlights');
  assert.equal((await s.call('status')).modelBudget.dailyReservedMicroUsd,0);
 }finally{globalThis.fetch=old;}
});

test('partial discussion failures stay explicit and a safety hold prevents checkpoint activation',async()=>{
 const old=globalThis.fetch,env={MUTATIONS_ENABLED:'true',LIVE_FETCH_ENABLED:'true'};
 const s=await setup(env),f=snapshot(await s.call('root'));await s.call('snapshot',{snapshot:f});
 for(const row of f.selectedStories)await s.call('stage',await author(s,f,row));
 let calls=0;globalThis.fetch=async()=>{calls++;return new Response('Unavailable',{status:503});};
 try{
  const first=await s.call('prepare-discussions',{generatedAt:f.generatedAt});assert.equal(first.complete,false);assert.equal(calls,4);
  const saved=await s.storage.get('discussion/'+f.generatedAt+'/batch/0');assert.equal(saved.status,'unavailable');assert.deepEqual(saved.items,[]);
  const invalid={...saved,sourceGeneratedAt:'2020-01-01T00:00:00.000Z'};
  await assert.rejects(()=>s.call('save-discussion-batch',{generatedAt:f.generatedAt,index:1,snapshot:invalid}),/Invalid pinned/);
  let stopped=false;globalThis.fetch=async()=>{if(!stopped){stopped=true;await s.call('failure',{generatedAt:f.generatedAt,kind:'safety_stop'});}return Response.json(null);};
  await assert.rejects(()=>s.call('prepare-discussions',{generatedAt:f.generatedAt}),/safety stop/);
  assert.equal(await s.storage.get('discussion/'+f.generatedAt+'/batch/1'),undefined);
  assert.equal((await s.call('root')).version,'empty');
 }finally{globalThis.fetch=old;}
});

test('pinned publisher metadata and authored compact decks survive model-cache reuse without spending',async()=>{
 const env={MUTATIONS_ENABLED:'true',LIVE_FETCH_ENABLED:'true',MODEL_API_ENABLED:'true',OPENAI_API_KEY:'fictional',MODEL_INPUT_USD_PER_MILLION:'0.125',MODEL_OUTPUT_USD_PER_MILLION:'0.50',MODEL_DAILY_LIMIT_MICRO_USD:'1000000',MODEL_MONTHLY_LIMIT_MICRO_USD:'5000000'};
 const s=await setup(env),f=snapshot(await s.call('root')),selected=f.selectedStories[0];await s.call('snapshot',{snapshot:f});
 const source={id:selected.id,generatedAt:f.generatedAt,kind:'article',excerpt:'The Fictional Gazette describes a synthetic paper sorting system.',description:'',publisher:'The Fictional Gazette',url:selected.url,fetchedAt:new Date().toISOString(),status:'fetched'};source.fingerprint=await api.digest(source);await s.call('source',{generatedAt:f.generatedAt,source});
 const key=await api.digest({policy:'editorial-v3-normalized-copy',model:'gpt-6-luna',maxOutputTokens:1024,id:selected.id,title:selected.title,url:selected.url,kind:source.kind,excerpt:source.excerpt,description:source.description});
 const short='A fictional system sorts paper by color.';
 await s.call('model-reserve',{key,cost:100,dailyLimit:1000,monthlyLimit:2000});
 await s.call('model-complete',{key,actualCost:50,result:{story:{...selected,headline:selected.title,summary:'A longer previously generated summary that should not expand the newspaper card.',shortSummary:short,summarySource:'article',publisher:'fictional.example',articleStatus:'fetched',image:null,imageAlt:'',imageCredit:''},usage:{inputTokens:1,outputTokens:1,totalTokens:2},requested:true}});
 const before=(await s.call('status')).modelBudget;
 env.NEWSROOM={idFromName:x=>x,get:()=>({fetch:req=>s.newsroom.fetch(req)})};await api.summarize(env,{generatedAt:f.generatedAt,id:selected.id});
 const {story}=await s.storage.get('stage/'+f.generatedAt+'/'+selected.id);
 assert.equal(story.publisher,'The Fictional Gazette');assert.equal(story.summary,short);assert.equal(story.shortSummary,short);assert.deepEqual((await s.call('status')).modelBudget,before);
});

test('reviewed images publish immutable bytes, share text spending, and reuse cache across editions',async()=>{
 const env={MUTATIONS_ENABLED:'true',LIVE_FETCH_ENABLED:'true',MODEL_API_ENABLED:'true',OPENAI_API_KEY:'fictional',EDITORIAL_MODEL:'gpt-6-luna',MODEL_INPUT_USD_PER_MILLION:'0.125',MODEL_OUTPUT_USD_PER_MILLION:'0.50',MODEL_DAILY_LIMIT_MICRO_USD:'1000000',MODEL_MONTHLY_LIMIT_MICRO_USD:'5000000'};
 const s=await setup(env),old=globalThis.fetch;let requests=0,bytes=imageFixture(),approved=true;
 env.NEWSROOM={idFromName:()=>0,get:()=>({fetch:async req=>s.request(new URL(req.url).pathname.slice(1),await req.json())})};
 globalThis.fetch=async(url,options)=>{
  if(url==='https://fictional.example/photo.png')return new Response(bytes,{headers:{'Content-Type':'image/png'}});
  assert.equal(url,'https://api.openai.com/v1/responses');requests++;assert.equal(JSON.parse(options.body).input[0].content[1].detail,'low');
  return Response.json({status:'completed',usage:{input_tokens:500,output_tokens:100,total_tokens:600},output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({approved,alt:approved?'Colored trays in a fictional sorting machine.':''})}]}]});
 };
 const seed=async(offset)=>{
  const f=snapshot(await s.call('root'),Date.now()-120_000+offset);await s.call('snapshot',{snapshot:f});
  for(let i=0;i<f.selectedStories.length;i++)await s.call('stage',await author(s,f,f.selectedStories[i],{},i===0?{imageCandidate:'https://fictional.example/photo.png'}:{}));
  return f;
 };
 try{
  // A text reservation and image review must debit the very same ledger.
  await s.call('model-reserve',{key:'f'.repeat(64),cost:500,dailyLimit:1_000_000,monthlyLimit:5_000_000});await s.call('model-complete',{key:'f'.repeat(64),actualCost:200,result:{synthetic:true}});
  let f=await seed(0),plan=await s.call('image-next',{generatedAt:f.generatedAt});
  const op=(path,args)=>s.call(path,args);await api.processImage(env,plan,op);assert.equal(requests,1);
  const staged=await s.storage.get('stage/'+f.generatedAt+'/'+plan.id),hash=await api.hashImage(bytes);
  assert.equal(staged.story.image,api.imageUrl(hash));assert.match(staged.story.imageAlt,/Colored trays/);assert.equal(staged.story.imageCredit,'Fictional publisher');
  await assert.rejects(()=>s.call('image',{hash}),/not found/,'unpublished images must remain private');
  assert.equal((await s.call('image-next',{generatedAt:f.generatedAt})).complete,true);
  const spent=(await s.call('status')).modelBudget.monthlyReservedMicroUsd;assert.equal(spent,313);
  await s.call('validate',{generatedAt:f.generatedAt});await s.call('publish',{generatedAt:f.generatedAt});
  const image=await api.worker.fetch(new Request(api.imageUrl(hash)),env);assert.equal(image.status,200);assert.equal(image.headers.get('Content-Type'),'image/png');assert.match(image.headers.get('Cache-Control'),/immutable/);assert.deepEqual(new Uint8Array(await image.arrayBuffer()),bytes);
  const cached=await api.worker.fetch(new Request(api.imageUrl(hash),{headers:{'If-None-Match':'"'+hash+'"'}}),env);assert.equal(cached.status,304);
  // Same article/image pair in a subsequent snapshot reuses approval and spending.
  f=await seed(1000);plan=await s.call('image-next',{generatedAt:f.generatedAt});await api.processImage(env,plan,op);assert.equal(requests,1);assert.equal((await s.call('status')).modelBudget.monthlyReservedMicroUsd,spent);
  await s.call('validate',{generatedAt:f.generatedAt});await s.call('publish',{generatedAt:f.generatedAt});
  // Changed bytes at the same URL require a new review; rejections are cached too.
  bytes=imageFixture(1);approved=false;f=await seed(2000);plan=await s.call('image-next',{generatedAt:f.generatedAt});await api.processImage(env,plan,op);assert.equal(requests,2);await api.processImage(env,plan,op);assert.equal(requests,2);
  assert.equal((await s.storage.get('stage/'+f.generatedAt+'/'+plan.id)).story.image,null);
  await s.call('validate',{generatedAt:f.generatedAt});assert.equal((await s.call('publish',{generatedAt:f.generatedAt})).published,true);
  assert.equal((await api.worker.fetch(new Request(api.imageUrl(hash)),env)).status,200,'old published bytes remain available');
 }finally{globalThis.fetch=old;}
});

test('image review cannot bypass the total cap or retry an uncertain request, and cannot forge approval',async()=>{
 for(const mode of ['budget','uncertain','refusal']){
  const env={MUTATIONS_ENABLED:'true',LIVE_FETCH_ENABLED:'true',MODEL_API_ENABLED:'true',OPENAI_API_KEY:'fictional',EDITORIAL_MODEL:'gpt-6-luna',MODEL_INPUT_USD_PER_MILLION:'0.125',MODEL_OUTPUT_USD_PER_MILLION:'0.50',MODEL_DAILY_LIMIT_MICRO_USD:'1000000',MODEL_MONTHLY_LIMIT_MICRO_USD:'5000000'};
  const s=await setup(env),f=snapshot(await s.call('root')),old=globalThis.fetch,bytes=imageFixture();let requests=0;await s.call('snapshot',{snapshot:f});
  for(let i=0;i<f.selectedStories.length;i++)await s.call('stage',await author(s,f,f.selectedStories[i],{},i===0?{imageCandidate:'https://fictional.example/photo.png'}:{}));
  const plan=await s.call('image-next',{generatedAt:f.generatedAt}),key=await api.imageReviewKey(plan.source,env.EDITORIAL_MODEL,await api.hashImage(bytes));
  await assert.rejects(async()=>s.call('image-done',{generatedAt:f.generatedAt,id:plan.id,key,asset:{hash:await api.hashImage(bytes),base64:api.encodeImage(bytes),mime:'image/png',width:640,height:360}}),/Approved visual/);
  await assert.rejects(()=>s.call('model-reserve',{key:'b'.repeat(64),cost:10,dailyLimit:1_000_000,monthlyLimit:5_000_001}),/total cap/);
  if(mode==='budget')await s.storage.put('budget/month/'+new Date().toISOString().slice(0,7),4_999_999);
  if(mode==='uncertain')await s.call('model-reserve',{key,cost:9000,dailyLimit:1_000_000,monthlyLimit:5_000_000});
  globalThis.fetch=async(url)=>{if(url==='https://fictional.example/photo.png')return new Response(bytes,{headers:{'Content-Type':'image/png'}});requests++;return Response.json({status:'completed',usage:{input_tokens:500,output_tokens:100,total_tokens:600},output:[{type:'message',role:'assistant',status:'completed',content:[{type:'refusal',refusal:'Fictional refusal'}]}]});};
  try{
   await api.processImage(env,plan,(path,args)=>s.call(path,args));assert.equal(requests,mode==='refusal'?1:0);
   assert.equal((await s.storage.get('stage/'+f.generatedAt+'/'+plan.id)).story.image,null);
   assert.equal((await s.call('status')).safetyStop,null);
   if(mode==='uncertain')assert.equal((await s.call('model-reserve',{key,cost:9000,dailyLimit:1_000_000,monthlyLimit:5_000_000})).created,undefined);
   await s.call('validate',{generatedAt:f.generatedAt});assert.equal((await s.call('publish',{generatedAt:f.generatedAt})).published,true);
  }finally{globalThis.fetch=old;}
 }
});

test('production comments use published developing timelines independently of today',async()=>{
 const old=globalThis.fetch;let reads=0,allowed=true;const threadId='s-aaaaaaaaaaaaaaaaaaaa';
 try{
  globalThis.fetch=async url=>{reads++;assert.equal(url,'https://hacker-news.firebaseio.com/v0/item/876543.json');return Response.json({id:876543,type:'story',kids:[]});};
  const {worker}=await import(pathToFileURL(out)+'?developing-comments');
  const env={LIVE_FETCH_ENABLED:'true',NEWSROOM:{idFromName:()=>{throw Error('Must not read today');}},DEVELOPING_NEWS:{idFromName:x=>x,get:()=>({fetch:async request=>{const url=new URL(request.url);assert.equal(url.pathname,'/comments-context');assert.equal(url.searchParams.get('threadId'),threadId);assert.equal(url.searchParams.get('storyId'),'876543');return allowed?Response.json({stories:[{id:876543}]}):new Response('Not found',{status:404});}})}};
  const request=()=>new Request('https://paper.example/api/comments?storyId=876543&developingStory='+threadId);
  const result=await worker.fetch(request(),env);assert.equal(result.status,200);assert.equal((await result.json()).storyId,876543);assert.equal(reads,1);
  allowed=false;assert.equal((await worker.fetch(request(),env)).status,404);assert.equal(reads,1,'authorization is checked even for cached comments');
  assert.equal((await worker.fetch(new Request('https://paper.example/comments-context?threadId='+threadId+'&storyId=876543'),env)).status,404,'private context route is not public');
 }finally{globalThis.fetch=old;}
});

test('parsed HTTP403 recovery retains charges, binds pinned source, rejects stale failures and caps attempts',async()=>{
 const s=await setup(),f=snapshot(await s.call('root'));await s.call('snapshot',{snapshot:f});const row=f.selectedStories[0];await author(s,f,row);
 const source=await s.call('get-source',{generatedAt:f.generatedAt,id:row.id});
 const key=await api.digest({policy:'editorial-v3-normalized-copy',model:'gpt-6-luna',maxOutputTokens:1024,id:row.id,title:row.title,url:row.url,kind:source.kind,excerpt:source.excerpt,description:source.description});
 const args={key,cost:100,dailyLimit:400,monthlyLimit:500},recover={key,generatedAt:f.generatedAt,storyId:row.id};
 await s.call('model-reserve',args);
 for(const details of [{phase:'timeout'},{phase:'transport'},{phase:'payload',httpStatus:403},{phase:'http',httpStatus:500},{phase:'output'}]){
  await s.call('failure',{generatedAt:f.generatedAt,storyId:row.id,kind:'validation',details});
  assert.equal((await s.call('model-rejected',recover)).recovered,false);
 }
 for(let attempt=1;attempt<=3;attempt++){
  await new Promise(resolve=>setTimeout(resolve,2));
  await s.call('failure',{generatedAt:f.generatedAt,storyId:row.id,kind:'validation',details:{phase:'http',httpStatus:403}});
  await assert.rejects(()=>s.call('model-rejected',{...recover,key:'a'.repeat(64)}),/pinned source/);
  const result=await s.call('model-rejected',recover);assert.equal(result.recovered,true);assert.equal(result.retryable,attempt<3);
  assert.equal((await s.call('status')).modelBudget.dailyReservedMicroUsd,100*attempt,'no rejected-request charge refunded');
  const next=await s.call('model-reserve',args);
  if(attempt<3){
   assert.equal(next.attempt,attempt+1);assert.equal(next.created,true);
   // Even equal timestamps cannot reuse an already-consumed rejection.
   const prior=await s.storage.get('model/'+key);await s.storage.put('model/'+key,{...prior,createdAt:prior.rejectedFailureAt});
   assert.equal((await s.call('model-rejected',recover)).recovered,false);
   await s.call('failure',{generatedAt:f.generatedAt,storyId:row.id,kind:'transient',details:{phase:'timeout'}});
   assert.equal((await s.call('model-rejected',recover)).recovered,false);
  }else{assert.equal(next.created,undefined);assert.equal(next.state,'failed');}
 }
 assert.equal((await s.call('status')).modelBudget.dailyReservedMicroUsd,300);
});

test('runner recovers stored HTTP403 once without refund and rejects a later safety stop',async()=>{
 for(const safety of [false,true]){
  const env={LIVE_FETCH_ENABLED:'true',MODEL_API_ENABLED:'true',OPENAI_API_KEY:'fictional',MODEL_INPUT_USD_PER_MILLION:'0.125',MODEL_OUTPUT_USD_PER_MILLION:'0.5',MODEL_DAILY_LIMIT_MICRO_USD:'1000000',MODEL_MONTHLY_LIMIT_MICRO_USD:'5000000'};
  const s=await setup(env),f=snapshot(await s.call('root'));await s.call('snapshot',{snapshot:f});const row=f.selectedStories[0];await author(s,f,row);
  const source=await s.call('get-source',{generatedAt:f.generatedAt,id:row.id});
  const key=await api.digest({policy:api.EDITORIAL_REQUEST_POLICY,model:'gpt-6-luna',maxOutputTokens:1024,id:row.id,title:row.title,url:row.url,kind:source.kind,excerpt:source.excerpt,description:source.description});
  await s.call('model-reserve',{key,cost:8704,dailyLimit:1000000,monthlyLimit:5000000});
  await s.call('failure',{generatedAt:f.generatedAt,storyId:row.id,kind:'validation',details:{phase:'http',httpStatus:403}});
  const runEnv={...env,NEWSROOM:{idFromName:x=>x,get:()=>({fetch:req=>s.newsroom.fetch(req)})}};
  const old=globalThis.fetch;let calls=0;
  try{
   globalThis.fetch=async(url)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');calls++;
    if(safety)return Response.json({error:{code:'content_policy_violation'}},{status:403});
    return Response.json({status:'completed',usage:{input_tokens:50,output_tokens:30,total_tokens:80},output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({headline:row.title,summary:source.excerpt,shortSummary:source.excerpt,summarySource:'article'})}]}]});
   };
   if(safety){await assert.rejects(()=>api.summarize(runEnv,{generatedAt:f.generatedAt,id:row.id}),/safety stop/);assert.ok((await s.call('status')).safetyStop);await assert.rejects(()=>s.call('model-rejected',{key,generatedAt:f.generatedAt,storyId:row.id}),/safety stop/i);}
   else{await api.summarize(runEnv,{generatedAt:f.generatedAt,id:row.id});assert.equal((await s.call('status',{generatedAt:f.generatedAt})).staged,1);assert.equal((await s.call('status')).modelBudget.dailyReservedMicroUsd,8704+22);}
   assert.equal(calls,1);
  }finally{globalThis.fetch=old;}
 }
});

test('parsed HTTP503 overload recovery retains charges, binds pinned source, rejects stale failures and caps attempts',async()=>{
 const s=await setup(),f=snapshot(await s.call('root'));await s.call('snapshot',{snapshot:f});const row=f.selectedStories[0];await author(s,f,row);
 const source=await s.call('get-source',{generatedAt:f.generatedAt,id:row.id});
 const key=await api.digest({policy:'editorial-v3-normalized-copy',model:'gpt-6-luna',maxOutputTokens:1024,id:row.id,title:row.title,url:row.url,kind:source.kind,excerpt:source.excerpt,description:source.description});
 const args={key,cost:100,dailyLimit:400,monthlyLimit:500},recover={key,generatedAt:f.generatedAt,storyId:row.id};
 await s.call('model-reserve',args);
 for(const details of [{phase:'timeout',httpStatus:503,code:'server_is_overloaded'},{phase:'transport'},{phase:'payload',httpStatus:503,code:'server_is_overloaded'},{phase:'http',httpStatus:500,code:'server_is_overloaded'},{phase:'http',httpStatus:503,code:'server_error'},{phase:'http',httpStatus:503},{phase:'output'}]){
  await s.call('failure',{generatedAt:f.generatedAt,storyId:row.id,kind:'transient',details});
  assert.equal((await s.call('model-rejected',recover)).recovered,false);
 }
 for(let attempt=1;attempt<=3;attempt++){
  await new Promise(resolve=>setTimeout(resolve,2));
  await s.call('failure',{generatedAt:f.generatedAt,storyId:row.id,kind:'transient',details:{phase:'http',httpStatus:503,code:'server_is_overloaded'}});
  await assert.rejects(()=>s.call('model-rejected',{...recover,key:'a'.repeat(64)}),/pinned source/);
  const result=await s.call('model-rejected',recover);assert.equal(result.recovered,true);assert.equal(result.retryable,attempt<3);
  assert.equal((await s.call('status')).modelBudget.dailyReservedMicroUsd,100*attempt,'no rejected-request charge refunded');
  const held=await s.call('model-reserve',args);assert.equal(held.created,undefined,'durable backoff blocks immediate/manual/cron retry');
  assert.equal(held.retryAt-Date.parse(held.rejectedFailureAt),30_000*2**(attempt-1));
  await s.storage.put('model/'+key,{...held,retryAt:Date.now()-1});
  const next=await s.call('model-reserve',args);
  if(attempt<3){
   assert.equal(next.attempt,attempt+1);assert.equal(next.created,true);
   // Even equal timestamps cannot reuse an already-consumed rejection.
   const prior=await s.storage.get('model/'+key);await s.storage.put('model/'+key,{...prior,createdAt:prior.rejectedFailureAt});
   assert.equal((await s.call('model-rejected',recover)).recovered,false);
   await s.call('failure',{generatedAt:f.generatedAt,storyId:row.id,kind:'transient',details:{phase:'timeout'}});
   assert.equal((await s.call('model-rejected',recover)).recovered,false);
  }else{assert.equal(next.created,undefined);assert.equal(next.state,'failed');}
 }
 assert.equal((await s.call('status')).modelBudget.dailyReservedMicroUsd,300);
});


test('runner recovers stored HTTP503 overload once without refund and rejects a later safety stop',async()=>{
 for(const safety of [false,true]){
  const env={LIVE_FETCH_ENABLED:'true',MODEL_API_ENABLED:'true',OPENAI_API_KEY:'fictional',MODEL_INPUT_USD_PER_MILLION:'0.125',MODEL_OUTPUT_USD_PER_MILLION:'0.5',MODEL_DAILY_LIMIT_MICRO_USD:'1000000',MODEL_MONTHLY_LIMIT_MICRO_USD:'5000000'};
  const s=await setup(env),f=snapshot(await s.call('root'));await s.call('snapshot',{snapshot:f});const row=f.selectedStories[0];await author(s,f,row);
  const source=await s.call('get-source',{generatedAt:f.generatedAt,id:row.id});
  const key=await api.digest({policy:api.EDITORIAL_REQUEST_POLICY,model:'gpt-6-luna',maxOutputTokens:1024,id:row.id,title:row.title,url:row.url,kind:source.kind,excerpt:source.excerpt,description:source.description});
  await s.call('model-reserve',{key,cost:8704,dailyLimit:1000000,monthlyLimit:5000000});
  await s.call('failure',{generatedAt:f.generatedAt,storyId:row.id,kind:'transient',details:{phase:'http',httpStatus:503,code:'server_is_overloaded'}});
  const oldAt=new Date(Date.now()-120_000).toISOString();
  const prior=await s.storage.get('model/'+key);await s.storage.put('model/'+key,{...prior,createdAt:oldAt});
  const failureKey='failure/'+f.generatedAt+'/'+row.id;const failure=await s.storage.get(failureKey);await s.storage.put(failureKey,{...failure,recordedAt:oldAt});
  const runEnv={...env,NEWSROOM:{idFromName:x=>x,get:()=>({fetch:req=>s.newsroom.fetch(req)})}};
  const old=globalThis.fetch;let calls=0;
  try{
   globalThis.fetch=async(url)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');calls++;
    if(safety)return Response.json({error:{code:'content_policy_violation'}},{status:403});
    return Response.json({status:'completed',usage:{input_tokens:50,output_tokens:30,total_tokens:80},output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({headline:row.title,summary:source.excerpt,shortSummary:source.excerpt,summarySource:'article'})}]}]});
   };
   if(safety){await assert.rejects(()=>api.summarize(runEnv,{generatedAt:f.generatedAt,id:row.id}),/safety stop/);assert.ok((await s.call('status')).safetyStop);await assert.rejects(()=>s.call('model-rejected',{key,generatedAt:f.generatedAt,storyId:row.id}),/safety stop/i);}
   else{await api.summarize(runEnv,{generatedAt:f.generatedAt,id:row.id});assert.equal((await s.call('status',{generatedAt:f.generatedAt})).staged,1);assert.equal((await s.call('status')).modelBudget.dailyReservedMicroUsd,8704+22);}
   assert.equal(calls,1);
  }finally{globalThis.fetch=old;}
 }
});

test('lead corrections update both headline and deck for the same link and for a repost while prior editions stay pinned',async()=>{
 const s=await setup(),at=Date.now()-240_000,items=pool(at),firstTime=at-24*3600_000;
 for(const item of items)item.time-=24*3600;
 async function publish(time,rows,headline,evidence){
  const fixture=snapshot(await s.call('root'),time,rows);
  await s.call('snapshot',{snapshot:fixture});
  for(const row of fixture.selectedStories){
   const lead=row.placement==='lead';
   await s.call('stage',await author(s,fixture,row,lead?{headline,summary:evidence,shortSummary:evidence}:{},lead?{excerpt:evidence}:{}));
  }
  await s.call('validate',{generatedAt:fixture.generatedAt});
  const {version}=await s.call('publish',{generatedAt:fixture.generatedAt});
  return s.call('edition',{version});
 }
 const first=await publish(firstTime,items,'Fictional archive chooses blue','The fictional archive chooses blue.');
 const corrected=await publish(at+1000,items,'Fictional archive chooses red','The fictional archive chooses red.');
 const aliasItems=[{...items[0],id:999},...items.slice(1)];
 const alias=await publish(at+2000,aliasItems,'Fictional archive chooses gold','The fictional archive chooses gold.');
 const votes=await publish(at+3000,[{...aliasItems[0],score:1000,comments:100},...aliasItems.slice(1)],'An equivalent new headline','The fictional archive chooses gold.');
 for(const [publication,id,headline,deck] of [
  [corrected,items[0].id,'Fictional archive chooses red','The fictional archive chooses red.'],
  [alias,999,'Fictional archive chooses gold','The fictional archive chooses gold.'],
  [votes,999,'Fictional archive chooses gold','The fictional archive chooses gold.'],
 ]){
  const lead=publication.edition.stories[0];
  assert.equal(lead.id,id);
  assert.equal(lead.headline,headline);
  assert.equal(lead.shortSummary,deck);
 }
 assert.equal(votes.edition.stories[0].score,1000);
 assert.equal(votes.leadEvidence,alias.leadEvidence);
 const archived=await s.call('edition',{date:first.edition.editionDate});
 assert.deepEqual(archived,first);
 assert.match(archived.html,/Fictional archive chooses blue/);

 const {leadEvidence:_,...legacy}=votes;
 assert.ok(_);
 await api.writeBlob(s.storage,'version/'+legacy.version,legacy);
 const next=await publish(at+4000,aliasItems,'New copy after a legacy edition','The fictional archive chooses gold.');
 assert.equal(next.edition.stories[0].headline,'New copy after a legacy edition');
});

const recoveryTestEnv=()=>({
 AUTO_EDITORIAL_ENABLED:'true',SCHEDULE_ENABLED:'true',MUTATIONS_ENABLED:'true',LIVE_FETCH_ENABLED:'true',PUBLICATION_ENABLED:'true',
 MODEL_API_ENABLED:'true',OPENAI_API_KEY:'fictional',MODEL_INPUT_USD_PER_MILLION:'0.125',MODEL_OUTPUT_USD_PER_MILLION:'0.50',
 MODEL_DAILY_LIMIT_MICRO_USD:'1000000',MODEL_MONTHLY_LIMIT_MICRO_USD:'5000000',
});
const sortingProse='The fictional Finch Archive introduced a sorting system that groups its paper collection by color, reducing the work required to organize each box.';
function copyResponse(provenance){
 const draft={headline:'Fictional archive sorts paper by color',summary:sortingProse,shortSummary:sortingProse,summarySource:provenance};
 return Response.json({status:'completed',usage:{input_tokens:50,output_tokens:30,total_tokens:80},
  output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(draft)}]}]});
}
function fictionalNews(ids,items){
 return input=>{
  const url=String(input);
  if(url.endsWith('/topstories.json'))return Response.json(ids);
  if(url.startsWith('https://hn.algolia.com/'))return Response.json({hits:[],hitsPerPage:100,nbHits:0,nbPages:0,page:0});
  const match=/^https:\/\/hacker-news\.firebaseio\.com\/v0\/item\/(\d+)\.json$/.exec(url);
  if(!match)return null;
  const id=Number(match[1]);
  return Response.json(items.get(id)??{id,type:'story',deleted:true});
 };
}

for(const scenario of ['lost-response','saved-receipt','safety-hold']){
 test('expired publisher recovery after '+scenario,async()=>{
  const originalFetch=globalThis.fetch,originalNow=Date.now,env=recoveryTestEnv();
  let system=await setup(env),clock=originalNow(),interruptSettlement=scenario==='saved-receipt',sends=0;
  Date.now=()=>clock;
  env.NEWSROOM={idFromName:()=>0,get:()=>({fetch:async request=>{
   const op=new URL(request.url).pathname.slice(1),args=await request.json();
   if(op==='model-editorial-settle'&&interruptSettlement)return Response.json({error:'fictional interrupted settlement'},{status:503});
   return system.request(op,args);
  }})};
  const ids=Array.from({length:90},(_,index)=>7000+index);
  const leadUrl='https://fictional.example/sorting';
  const items=new Map(ids.slice(0,4).map((id,index)=>[id,{id,type:'story',title:'Fictional report '+id,url:index===0?leadUrl:'https://fictional.example/'+id,score:300-index*10,descendants:0,time:Math.floor(clock/1000)-3600}]));
  const hn=fictionalNews(ids,items);
  globalThis.fetch=async input=>{
   if(input==='https://api.openai.com/v1/responses'){
    sends++;
    if(scenario!=='saved-receipt')throw new TypeError('fictional provider accepted the request and lost the response');
    return copyResponse('article');
   }
   if(input===leadUrl)return new Response('<html><article><p>'+sortingProse+'</p></article></html>',{headers:{'Content-Type':'text/html'}});
   return hn(input)??new Response(null,{status:404});
  };
  try{
   const collected=await api.runEdition(env),at=collected.generatedAt;
   assert.equal(collected.checkpoint,'collected');
   const pinned=await system.call('selection',{generatedAt:at});
   const ownerArgs={generatedAt:at,basePublicationVersion:pinned.basePublicationVersion,baseRevision:pinned.baseRevision,githubRun:'12345/1'};
   assert.equal(pinned.selectedStories[0].id,ids[0]);
   await api.runEdition(env);
   assert.equal(sends,1);
   system=await setup(env,system.storage);
   for(let i=0;i<3;i++)await api.runEdition(env);
   const pending=await system.call('status',{generatedAt:at}),model=await system.call('model-review',{generatedAt:at,storyId:ids[0]});
   assert.deepEqual(pending.missingIds,[ids[0]],'independent articles finish after restart');
   assert.ok(pending.lastProgressAt);
   assert.equal(model.reason,scenario==='saved-receipt'?'receipt_pending':'model_outcome_uncertain');
   const reservationKey='model/'+model.reservationKey;
   const reservation=await system.storage.get(reservationKey);
   assert.equal(sends,1);
   await assert.rejects(system.call('recover-expired-batch',ownerArgs),/older than 48 hours/);
   const old=await system.call('run-claim');
   clock+=49*3600_000;
   if(scenario==='safety-hold'){
    await system.call('failure',{generatedAt:at,kind:'safety_stop'});
    await assert.rejects(system.call('recover-expired-batch',ownerArgs),/safety stop/);
    await assert.rejects(api.runEdition(env),/safety stop/);
    assert.equal((await system.call('status')).pending,at);
    assert.equal((await system.call('root')).version,'empty');
    assert.equal((await system.call('status')).lastRecovery,null);
    return;
   }
   assert.equal((await api.runEdition(env)).checkpoint,'expired');
   await assert.rejects(system.call('recover-expired-batch',{...ownerArgs,baseRevision:1}),/base changed/);
   const freshLease=await system.call('run-claim');
   await assert.rejects(system.call('recover-expired-batch',ownerArgs),/lease is active/);
   await system.call('run-release',{_runToken:freshLease.token});
   const recovered=await system.call('recover-expired-batch',ownerArgs);
   const outcome=scenario==='saved-receipt'?'receipt_settled':'charge_retained';
   assert.deepEqual(recovered.resolutions,[{storyId:ids[0],reservationKey:model.reservationKey,outcome}]);
   assert.deepEqual((await system.call('status')).lastRecovery,recovered);
   assert.equal((await system.call('recover-expired-batch',ownerArgs)).unchanged,true);
   assert.equal(system.storage.alarm,clock+1000);
   assert.deepEqual((await system.call('status',{generatedAt:at})).missingIds,[ids[0]]);
   await assert.rejects(system.call('publish',{generatedAt:at,_runToken:old.token}),/lease expired or superseded/);
   const retained=await system.storage.get(reservationKey);
   assert.equal(retained.state,scenario==='saved-receipt'?'completed':'reserved');
   const expectedCost=scenario==='saved-receipt'?22:reservation.cost;
   assert.equal(await system.storage.get('budget/day/'+reservation.day),expectedCost);
   assert.equal(await system.storage.get('budget/month/'+reservation.month),expectedCost);
   interruptSettlement=false;
   const replacement=await api.runEdition(env);
   assert.equal(replacement.checkpoint,'collected');
   assert.notEqual(replacement.generatedAt,at);
   for(let i=0;i<14&&(await system.call('status')).pending;i++)await api.runEdition(env);
   const current=await system.call('edition');
   assert.equal(current.edition.generatedAt,replacement.generatedAt);
   assert.equal(current.edition.stories.length,pinned.selectedStories.length);
   assert.equal(sends,1);
   const lead=current.edition.stories[0];
   assert.equal(lead.id,ids[0]);
   assert.equal(lead.summarySource,scenario==='saved-receipt'?'article':'unavailable');
   if(scenario==='lost-response'){
    assert.equal(lead.headline,items.get(ids[0]).title);
    assert.equal(lead.articleStatus,'editorial_outcome_unknown');
   }
  }finally{globalThis.fetch=originalFetch;Date.now=originalNow;}
 });
}

test('official discovery distinguishes a self-post from a rejected external link through publication',async()=>{
 const env=recoveryTestEnv(),s=await setup(env),originalFetch=globalThis.fetch;
 env.NEWSROOM={idFromName:()=>0,get:()=>({fetch:async request=>s.request(new URL(request.url).pathname.slice(1),await request.json())})};
 const ids=Array.from({length:90},(_,index)=>8000+index);
 const item=(id,title)=>({id,type:'story',title,score:300,descendants:0,time:Math.floor(Date.now()/1000)-3600});
 const items=new Map([[ids[0],{...item(ids[0],'A fictional self-post'),text:sortingProse}],[ids[1],{...item(ids[1],'A fictional link'),url:'http://127.0.0.1/fake'}]]);
 const hn=fictionalNews(ids,items),modelInputs=[];
 globalThis.fetch=async(input,options)=>{
  if(input==='https://api.openai.com/v1/responses'){
   modelInputs.push(JSON.parse(JSON.parse(options.body).input[0].content[0].text));
   return copyResponse('hn_post');
  }
  return hn(input)??assert.fail('Unexpected publisher fetch: '+input);
 };
 try{
  const {generatedAt}=await api.runEdition(env);
  const selection=await s.call('selection',{generatedAt});
  assert.equal(selection.selectedStories.find(row=>row.id===ids[0]).sourceKind,'hn_post');
  assert.equal(selection.selectedStories.find(row=>row.id===ids[1]).sourceKind,'rejected_external');
  items.set(ids[0],{...items.get(ids[0]),url:'https://example.com/replaced'});
  await assert.rejects(api.summarize(env,{generatedAt,id:ids[0]}),/identity changed/);
  delete items.get(ids[0]).url;
  for(let i=0;i<10&&(await s.call('status')).pending;i++)await api.runEdition(env);
  const publication=await s.call('edition');
  const self=publication.edition.stories.find(row=>row.id===ids[0]),rejected=publication.edition.stories.find(row=>row.id===ids[1]);
  assert.equal(self.summarySource,'hn_post');
  assert.equal(rejected.summarySource,'unavailable');
  assert.equal(rejected.articleStatus,'fetch_url_rejected');
  assert.equal(rejected.url,'https://news.ycombinator.com/item?id='+ids[1]);
  assert.deepEqual(modelInputs.map(input=>input.evidenceKind),['hn_post']);
 }finally{globalThis.fetch=originalFetch;}
});
