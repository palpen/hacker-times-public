import test from 'node:test';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';import {build} from 'esbuild';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ht-production-'));
const entry=path.join(dir,'entry.ts'),out=path.join(dir,'entry.mjs');
fs.writeFileSync(entry,`export {observeRun,runLogEvent} from '${process.cwd()}/lib/production/run-log';export {Newsroom} from '${process.cwd()}/lib/production/newsroom';export {pinSnapshot,chooseLead} from '${process.cwd()}/lib/production/selection';export {digest} from '${process.cwd()}/lib/production/storage';export {selectUnifiedMonthlyStories,unifiedSectionPolicyVersion,unifiedSectionPolicyConfig} from '${process.cwd()}/lib/policy';export {default as worker} from '${process.cwd()}/worker/production';export {runEdition} from '${process.cwd()}/lib/production/runner';`);
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
async function setup(env){
 const storage=new MemoryStorage();let ready;const state={storage,blockConcurrencyWhile:fn=>ready=fn()};const newsroom=new api.Newsroom(state,env);await ready;
 const request=(op,args={})=>newsroom.fetch(new Request('https://internal/'+op,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args)}));
 const call=async(op,args={})=>{const r=await request(op,args),body=await r.json();if(!r.ok)throw Error(body.error);return body;};
 return {storage,request,call,newsroom};
}
function pool(at,offset=0){return Array.from({length:25},(_,i)=>({id:101+offset+i,title:'Fictional system '+i,url:'https://fictional.example/article/'+(101+offset+i),score:300-i*4,comments:50-i,time:Math.floor(at/1000)-3600-i,hnPage:1,hnRank:i+1,category:['Technology','AI','Software','Science','Culture','Business','Games'][i%7],topics:['Technology'],discoverySource:'current',editorialScore:0}));}
function snapshot(root,at=Date.now()-120_000,items=pool(at)){
 const ids=items.map(s=>s.id),audit=api.chooseLead(root,items,ids,at).audit;
 const selected=api.selectUnifiedMonthlyStories(items,ids,root.ledger.active?.id,at,audit.leadId,ids);
 return api.pinSnapshot(root,{schemaVersion:1,selectionVersion:6,layoutVersion:3,freshnessPolicyVersion:1,algorithmVersion:3,policyVersion:api.unifiedSectionPolicyVersion,policyConfig:api.unifiedSectionPolicyConfig,generatedAt:new Date(at).toISOString(),windowStart:new Date(at-30*86400_000).toISOString(),windowEnd:new Date(at).toISOString(),sourceMode:'hn-month-sample',discovery:{coverage:'sampled'},frontPageIds:ids,sourcePages:[{url:'https://news.ycombinator.com/',ids},{url:'https://news.ycombinator.com/?p=2',ids:[]},{url:'https://news.ycombinator.com/?p=3',ids:[]}],candidateCount:items.length,fetchedCount:items.length,rankedStories:items,selectedStories:selected,ranking:'Fictional policy fixture'});
}
async function author(s,fixture,selected,extra={}){
 const source={id:selected.id,generatedAt:fixture.generatedAt,kind:'article',excerpt:'A wholly fictional test system demonstrates a synthetic operation.',description:'Fictional system demonstration.',url:selected.url,fetchedAt:new Date().toISOString(),status:'fetched'};
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
  assert.deepEqual((await restoredCall('status',{generatedAt:pending.generatedAt})).body,checkpoint);
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
 assert.equal((await s.call('run-release',{_runToken:old})).released,false);assert.equal(s.storage.alarm,watchdog);
 assert.equal((await s.call('status',{generatedAt:f.generatedAt})).cursor,f.selectedStories[0].id);
 await s.call('run-release',{_runToken:newer.token});
});
test('bounded automatic runs resume checkpoints and progress past unknown model outcomes without replay',async()=>{
 const s=await setup(),f=snapshot(await s.call('root'));await s.call('snapshot',{snapshot:f});
 const first=f.selectedStories[0];await author(s,f,first);
 const source=await s.call('get-source',{generatedAt:f.generatedAt,id:first.id});
 const key=await api.digest({policy:'editorial-v1',model:'gpt-6-luna',maxOutputTokens:1024,id:first.id,title:first.title,url:first.url,kind:source.kind,excerpt:source.excerpt,description:source.description});
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
 const s=await setup(),f=snapshot(await s.call('root'));await s.call('snapshot',{snapshot:f});
 for(const row of f.selectedStories){const source={id:row.id,generatedAt:f.generatedAt,kind:'unavailable',excerpt:'',description:'',url:row.url,fetchedAt:new Date().toISOString(),status:'source_unavailable'};source.fingerprint=await api.digest(source);await s.call('source',{generatedAt:f.generatedAt,source});}
 const realNow=Date.now;let clock=realNow(),advance=true;Date.now=()=>clock;
 const env={NEWSROOM:{idFromName:()=>0,get:()=>({fetch:async req=>{const op=new URL(req.url).pathname.slice(1),response=await s.request(op,await req.json());if(op==='stage'&&advance)clock+=90_001;return response;}})},AUTO_EDITORIAL_ENABLED:'true',MUTATIONS_ENABLED:'true',LIVE_FETCH_ENABLED:'true',PUBLICATION_ENABLED:'true'};
 try{
  const partial=await api.runEdition(env);assert.equal(partial.attempted,1);assert.equal(partial.published,false);
  advance=false;let result;
  for(let i=0;i<Math.ceil(f.selectedStories.length/3)+1;i++){result=await api.runEdition(env);if(result.publication)break;}
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
 for(let i=0;i<Math.ceil(f.selectedStories.length/3);i++){if((await s.call('status')).pending)await s.newsroom.alarm();}
 assert.equal(s.storage.alarm,null);assert.equal((await s.call('edition')).edition.stories.length,f.selectedStories.length);
 env.SCHEDULE_ENABLED='false';await s.newsroom.alarm();assert.equal((await s.call('status')).pending,null);
});
test('real workerd alarms finish bounded chunks through the private namespace',async()=>{
 const file=path.join(dir,'alarm-worker.mjs');await build({entryPoints:['worker/production.ts'],outfile:file,bundle:true,format:'esm',platform:'browser'});
 const mf=new Miniflare(convertV4MiniflareOptions({rootPath:dir,modules:true,scriptPath:file,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],durableObjects:{NEWSROOM:{className:'Newsroom',useSQLite:true}},bindings:{MUTATIONS_ENABLED:'true',LIVE_FETCH_ENABLED:'true',PUBLICATION_ENABLED:'true',SCHEDULE_ENABLED:'true',AUTO_EDITORIAL_ENABLED:'true',MODEL_API_ENABLED:'false'}}));
 try{
  const ns=await mf.getDurableObjectNamespace('NEWSROOM'),stub=ns.get(ns.idFromName('production-v1'));
  const call=async(op,args={})=>{const r=await stub.fetch('https://internal/'+op,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args)});const b=await r.json();if(!r.ok)throw Error(b.error);return b;};
  const f=snapshot(await call('root'));await call('snapshot',{snapshot:f});
  for(const row of f.selectedStories){const source={id:row.id,generatedAt:f.generatedAt,kind:'unavailable',excerpt:'',description:'',url:row.url,fetchedAt:new Date().toISOString(),status:'source_unavailable'};source.fingerprint=await api.digest(source);await call('source',{generatedAt:f.generatedAt,source});}
  const lease=await call('run-claim');await call('run-release',{_runToken:lease.token,continuationDelayMs:1000});
  const deadline=Date.now()+20_000;let status;
  do{await new Promise(resolve=>setTimeout(resolve,250));status=await call('status');}while(status.pending&&Date.now()<deadline);
  assert.equal(status.pending,null,'actual durable alarms should continue without another cron tick');
  assert.equal((await call('edition')).edition.stories.length,f.selectedStories.length);
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
 const success=api.runLogEvent('alarm',{publication:{published:true,version:'e-'+'a'.repeat(24)},generatedAt:'2026-11-11T00:00:00.000Z'});assert.equal(success.outcome,'published');assert.equal(success.publicationVersion,'e-'+'a'.repeat(24));
 assert.equal(api.runLogEvent('cron',{checkpoint:'deduplicated'}).outcome,'skipped');
});
