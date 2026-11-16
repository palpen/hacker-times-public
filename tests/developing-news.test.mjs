import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {demoScenario,exampleSnapshot,exampleStory,syntheticEvaluation} from './fixtures/developing-news-v2/demo.mjs';
import * as reference from './fixtures/developing-news-v2/decision-policy.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ht-developing-'));
const entry=path.join(dir,'entry.ts'),file=path.join(dir,'entry.mjs');
const root=process.cwd();
fs.writeFileSync(entry,`export {assessmentDue} from '${root}/lib/developing-news/tracker';export * from '${root}/lib/developing-news/types';export * from '${root}/lib/developing-news/policy.mjs';export * from '${root}/lib/developing-news/lifecycle';export * from '${root}/lib/developing-news/model';export * from '${root}/lib/developing-news/render';export * from '${root}/lib/developing-news/routes';export {extractPublicationDate,publicationDate} from '${root}/lib/article-publication';export {collectEvidence} from '${root}/lib/developing-news/source';export {article} from '${root}/lib/reporting';`);
await build({entryPoints:[entry],outfile:file,bundle:true,format:'esm',platform:'node'});
const api=await import(pathToFileURL(file));
const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw Error('Live network forbidden');};
test.after(()=>{globalThis.fetch=originalFetch;fs.rmSync(dir,{recursive:true,force:true});});
const at='2026-11-15T12:00:00.000Z';
function thread(id='s-aaaaaaaaaaaaaaaaaaaa',overrides={}){return {id,title:'Finch investigation',question:'What caused the Finch outage?',summary:'Finch says an investigation is underway.',terms:['Finch','outage'],status:'candidate',published:false,activatedAt:null,lastMaterialAt:at,nextEvent:null,pinned:false,excluded:false,evidence:[],updates:[],...overrides};}
function evidence(id='123'){return {id,url:'https://fictional.example/'+id,title:'Finch investigation',publisher:'Fictional News',publishedAt:at,retrievedAt:at,text:'Finch says an investigation is underway.',hash:'a'.repeat(64)};}
function assessment(t,judgments={}){const s=exampleStory(t.id,{status:t.status,activated_at:t.activatedAt});const snap=exampleSnapshot([s],{as_of:at,initialized:t.status==='active',last_promotion_at:null});return {thread:t,answers:syntheticEvaluation(snap,{[t.id]:{latest_development:'material',...judgments}}).response.answers,checkedAt:at,material:true,resolved:false,evidence:evidence(),summary:'Finch says an investigation is underway.'};}
const roster={revision:0,initialized:false,lastPromotionAt:null,lastRunAt:null};
const run=results=>({id:'test',asOf:at,baseRevision:0,queue:[],results,failed:[],processed:[],discoveryOk:true});

test('hourly production policy keeps frozen v2 editorial thresholds, questions and reference outcomes',async()=>{
 assert.deepEqual(api.policy,{...reference.policy,schedule:{...reference.policy.schedule,assess_every_hours:1}});assert.deepEqual(api.questionTemplates,reference.questionTemplates);
 const fixtures=[demoScenario(),...['open','resolved','uncertain'].map(question_status=>{const snapshot=exampleSnapshot([exampleStory('x')]);return {snapshot,evaluation:syntheticEvaluation(snapshot,{x:{question_status}})};})];
 for(const {snapshot,evaluation} of fixtures){assert.equal(await api.fingerprint(api.buildRequest(snapshot)),reference.fingerprint(reference.buildRequest(snapshot)));const actual=await api.proposeRoster(snapshot,evaluation),expected=reference.proposeRoster(snapshot,evaluation);assert.equal(actual.policy_hash,await api.fingerprint({policy:api.policy,questionTemplates:api.questionTemplates}));assert.notEqual(actual.evaluation_id,expected.evaluation_id);assert.deepEqual({...actual,policy_hash:expected.policy_hash,evaluation_id:expected.evaluation_id},expected);}
});
test('hourly selection runs at the next clock hour without drifting to ninety minutes',()=>{
 assert.equal(api.assessmentDue(null,Date.parse('2026-11-16T10:00:00Z')),true);
 assert.equal(api.assessmentDue('2026-11-16T10:03:00Z',Date.parse('2026-11-16T10:30:00Z')),false);
 assert.equal(api.assessmentDue('2026-11-16T10:03:00Z',Date.parse('2026-11-16T11:00:00Z')),true);
 assert.equal(api.assessmentDue('2026-11-15T23:59:00Z',Date.parse('2026-11-16T00:00:00Z')),true);
});
test('bootstrap publishes three sourced pages and timeline updates deduplicate',async()=>{
 const results=['a','b','c','d','e'].map(x=>assessment(thread('s-'+x.repeat(20))));
 const next=await api.rotate(roster,[],run(results));assert.equal(next.threads.filter(t=>t.status==='active').length,3);
 const t=next.threads.find(t=>t.status==='active');assert.equal(t.updates.length,1);assert.equal(t.updates[0].source.url,evidence().url);assert.equal(t.updates[0].source.hnId,123);
 const again=await api.rotate(next.roster,next.threads.filter(t=>t.status==='active'),run([assessment(t)]));assert.equal(again.threads.find(x=>x.id===t.id).updates.length,1);
});
test('unavailable sources preserve an active story after thirty quiet days',async()=>{
 const t=thread(undefined,{status:'active',published:true,activatedAt:'2026-08-01T00:00:00.000Z',lastMaterialAt:'2026-08-01T00:00:00.000Z',evidence:[evidence()]});
 const next=await api.rotate({...roster,initialized:true},[t],run([]));assert.equal(next.threads[0].status,'active');assert.equal(next.plan.decisions[0].reason,'collection_unavailable_or_stale');
});
test('resolution quiets early, preserves page and publishes the sourced outcome',async()=>{
 const t=thread(undefined,{status:'active',published:true,activatedAt:at,evidence:[evidence()]});
 const a=assessment(t,{question_status:'resolved',priority:'refusal'});a.resolved=true;
 const next=await api.rotate({...roster,initialized:true},[t],run([a]));assert.equal(next.threads[0].status,'quiet');assert.equal(next.threads[0].published,true);assert.equal(next.threads[0].updates.length,1);
});
test('quiet stories revive on their original URL, while repetition cannot revive',async()=>{
 const t=thread(undefined,{status:'quiet',published:true,activatedAt:'2026-05-01T00:00:00.000Z',lastMaterialAt:'2026-05-01T00:00:00.000Z',evidence:[{...evidence(),hash:'b'.repeat(64)}]});
 const next=await api.rotate({...roster,initialized:true},[],run([assessment(t)]));assert.equal(next.threads[0].id,t.id);assert.equal(next.threads[0].status,'active');
 const a=assessment(t,{latest_development:'repetition'});a.material=false;assert.equal((await api.rotate({...roster,initialized:true},[],run([a]))).threads[0].status,'quiet');
});
test('full source collection retains content beyond the old excerpt limit',async()=>{
 const text='A source paragraph. '.repeat(700)+'THE COMPLETE END';
 globalThis.fetch=async()=>new Response('<article>'+text+'</article>',{headers:{'content-type':'text/html'}});
 try{const full=await api.article('https://fictional.example/a',{fullText:true}),short=await api.article('https://fictional.example/a');assert.ok(full.excerpt.endsWith('THE COMPLETE END'));assert.equal(short.excerpt.length,8500);}finally{globalThis.fetch=async()=>{throw Error('Live network forbidden');};}
});
test('paid calls reserve first, cache success, never replay uncertain requests, and reject oversized input',async()=>{
 const reservations=new Map();let requests=0;
 const env={MODEL_API_ENABLED:'true',OPENAI_API_KEY:'fictional-test-key',MODEL_INPUT_USD_PER_MILLION:'0.125',MODEL_OUTPUT_USD_PER_MILLION:'0.50',MODEL_DAILY_LIMIT_MICRO_USD:'1000000',MODEL_MONTHLY_LIMIT_MICRO_USD:'5000000',NEWSROOM:{idFromName:x=>x,get:()=>({fetch:async req=>{const body=await req.json();if(new URL(req.url).pathname==='/model-reserve'){const prior=reservations.get(body.key);if(prior)return Response.json(prior);reservations.set(body.key,{state:'reserved'});return Response.json({state:'reserved',created:true});}reservations.set(body.key,{state:'completed',result:body.result});return Response.json({saved:true});}})}};
 globalThis.fetch=async()=>{requests++;assert.equal(reservations.size,1);return Response.json({model:'gpt-6-luna',usage:{input_tokens:10,output_tokens:0},answers:[]});};
 try{const request={model:'gpt-6-luna',input:'sample'};await api.paidRequest(env,'decisions',request,()=>{});await api.paidRequest(env,'decisions',request,()=>{});assert.equal(requests,1);
  globalThis.fetch=async()=>{requests++;throw Error('Connection lost');};await assert.rejects(()=>api.paidRequest(env,'decisions',{input:'different'},()=>{}));await assert.rejects(()=>api.paidRequest(env,'decisions',{input:'different'},()=>{}),/replay/);assert.equal(requests,2);
  await assert.rejects(()=>api.paidRequest(env,'decisions',{input:'x'.repeat(200001)},()=>{}),/no truncation/);assert.equal(requests,2);
 }finally{globalThis.fetch=async()=>{throw Error('Live network forbidden');};}
});
test('reader copy escapes untrusted strings, links permanent pages and hides private evidence',()=>{
 const t=thread(undefined,{status:'active',published:true,title:'<script>alert(1)</script>',summary:'An attributed report.',updates:[]});
 const html=api.renderDevelopingIndex({active:[t],quiet:[],nextCursor:null});assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('/developing-news/'+t.id));assert.ok(!html.includes('choice_probability'));assert.ok(!html.includes('source_sha'));
 const transformed=api.withDevelopingNews('<head></head><nav></nav><div id="today-view"><section class="more-stories">Other news</section></div>',{active:[t],quiet:[],nextCursor:null});assert.equal((api.withDevelopingNews(transformed,null).match(/id="developing-news"/g)||[]).length,1);
});

test('real SQLite keeps six-month archives searchable, history paginated and private state off public API',async()=>{
 const harness=path.join(dir,'store.ts'),out=path.join(dir,'store-worker.mjs');
 fs.writeFileSync(harness,`import {DevelopingStore} from '${root}/lib/developing-news/store';import {DevelopingNews} from '${root}/lib/developing-news/tracker';export class Registry extends DevelopingNews{constructor(state,env){super(state,env);this.db=new DevelopingStore(state.storage.sql);}async fetch(req){const p=new URL(req.url).pathname;if(p==='/seed'){this.db.save(await req.json());return Response.json({saved:true});}if(p==='/match')return Response.json(this.db.matches('Finch outage investigation','https://other.example/new'));return super.fetch(req);}}export default {fetch:(r,e)=>e.REGISTRY.get(e.REGISTRY.idFromName('test')).fetch(r)};`);
 await build({entryPoints:[harness],outfile:out,bundle:true,format:'esm',platform:'browser'});
 const options={rootPath:dir,modules:true,scriptPath:out,compatibilityDate:'2026-05-15',durableObjects:{REGISTRY:{className:'Registry',useSQLite:true}},resourcePersistencePath:path.join(dir,'persist')};
 let mf=new Miniflare(convertV4MiniflareOptions(options));
 const archived=thread(undefined,{status:'quiet',published:true,lastMaterialAt:'2026-05-01T00:00:00.000Z',evidence:[evidence()],updates:Array.from({length:60},(_,i)=>({id:String(i),at:new Date(Date.parse(at)-i*86400000).toISOString(),summary:'Fictional update '+i,source:{url:evidence().url,title:'Fictional report',publisher:'Fictional News',hnId:i===59?987:undefined},sourceHash:'a'.repeat(64)}))});
 try{
  await mf.dispatchFetch('https://test/seed',{method:'POST',body:JSON.stringify(archived)});
  let response=await mf.dispatchFetch('https://test/list'),body=await response.json();assert.equal(body.quiet[0].id,archived.id);assert.equal(body.quiet[0].evidence,undefined);assert.equal(body.quiet[0].terms,undefined);
  response=await mf.dispatchFetch('https://test/story/'+archived.id);body=await response.json();assert.equal(body.updates.length,50);assert.ok(body.nextCursor);assert.equal(body.followingSince,archived.updates[59].at);
  const olderPage=await (await mf.dispatchFetch('https://test/story/'+archived.id+'?before='+encodeURIComponent(body.nextCursor))).json();assert.equal(olderPage.followingSince,archived.updates[59].at);
  assert.equal((await (await mf.dispatchFetch('https://test/story/'+archived.id+'?before='+encodeURIComponent(body.nextCursor))).json()).updates.length,10);
  const discussion=id=>'https://test/comments-context?threadId='+archived.id+'&storyId='+id;
  assert.equal((await mf.dispatchFetch(discussion(987))).status,200,'discussion beyond the first 50 archived updates remains readable');
  assert.equal((await mf.dispatchFetch(discussion(123))).status,200,'legacy source requires retained evidence');
  assert.equal((await mf.dispatchFetch(discussion(999))).status,404,'unrelated HN story is not authorized');
  await mf.dispatchFetch('https://test/seed',{method:'POST',body:JSON.stringify({...archived,published:false})});
  assert.equal((await mf.dispatchFetch(discussion(987))).status,404,'private candidate does not authorize comments');
  await mf.dispatchFetch('https://test/seed',{method:'POST',body:JSON.stringify(archived)});
  await mf.dispose();mf=new Miniflare(convertV4MiniflareOptions(options));
  assert.equal((await (await mf.dispatchFetch('https://test/match')).json())[0].id,archived.id);
  assert.equal((await mf.dispatchFetch('https://test/last-plan')).status,404);
  const diagnostics=await (await mf.dispatchFetch('https://test/status')).json();assert.equal(diagnostics.storage.threads.length,1);assert.equal(diagnostics.storage.requests.length,0);
 }finally{await mf.dispose();}
});

test('the production tracker runs full-source drafting, Decisions and atomic publication in workerd',async()=>{
 const source=path.join(dir,'pipeline.ts'),bundle=path.join(dir,'pipeline.mjs');
 fs.writeFileSync(source,`import {DevelopingNews} from '${root}/lib/developing-news/tracker';
 export class Tracker extends DevelopingNews{async fetch(r){if(new URL(r.url).pathname==='/test-step'){await this.alarm();return super.fetch(new Request('https://internal/list'));}return super.fetch(r);}}
 export class Budget{constructor(s){this.s=s;}async fetch(r){const p=new URL(r.url).pathname,a=await r.json();if(p==='/edition')return Response.json({version:'test',edition:{generatedAt:new Date().toISOString(),stories:[{id:7001,title:'Finch investigation',url:'https://fictional.example/7001',score:500,time:Math.floor(Date.now()/1000)-60}]}});if(p==='/status')return Response.json({safetyStop:null,runner:{leaseExpiresAt:null}});if(p==='/model-reserve'){const old=await this.s.storage.get(a.key);if(old)return Response.json(old);await this.s.storage.put(a.key,{state:'reserved'});return Response.json({state:'reserved',created:true});}if(p==='/model-complete'){await this.s.storage.put(a.key,{state:'completed',result:a.result});return Response.json({saved:true});}return new Response('Unexpected request',{status:500});}}
 export default {fetch:(r,e)=>e.DEVELOPING_NEWS.get(e.DEVELOPING_NEWS.idFromName('developing-v1')).fetch(r)};`);
 await build({entryPoints:[source],outfile:bundle,bundle:true,format:'esm',platform:'browser'});
 const provider=`export default {async fetch(r,env){const u=new URL(r.url);if(u.hostname==='fictional.example'&&env.UNAVAILABLE)return new Response('Unavailable',{status:403});if(u.hostname==='fictional.example')return new Response('<article>'+('A fictional background paragraph. '.repeat(500))+'Finch says an investigation is underway. COMPLETE SOURCE END</article>',{headers:{'content-type':'text/html'}});const q=await r.json();const input=JSON.parse(q.input);if(u.pathname==='/v1/responses'){if(!input.source.text.endsWith('COMPLETE SOURCE END'))throw Error('Full text missing');return Response.json({status:'completed',usage:{input_tokens:5000,output_tokens:200},output:[{content:[{type:'output_text',text:JSON.stringify({matchId:'new',matchConfidence:1,title:'Finch investigation',question:'What caused the Finch outage?',summary:'Finch says an investigation is underway.',supportingQuote:'Finch says an investigation is underway.',terms:['Finch','outage'],nextEventAt:null,nextEventQuote:null})}]}]});}if(u.pathname==='/v1/decisions'){if(!input.evidence[0].summary.endsWith('COMPLETE SOURCE END'))throw Error('Full decision source missing');return Response.json({model:'gpt-6-luna',usage:{input_tokens:5000,output_tokens:0},answers:q.questions.map(x=>{if(x.type==='predicate')return {name:x.name,type:x.type,probability:0.95};if(x.type==='score')return {name:x.name,type:x.type,score:3,confidence:1,probabilities:x.levels.map((v,i)=>({label:v.label,value:i,probability:i===3?1:0}))};const choice={evidence:'sufficient',question_status:'open',latest_development:'material'}[x.name];return {name:x.name,type:x.type,choice,confidence:0.96,probabilities:x.choices.map(c=>({value:c.value,probability:c.value===choice?0.96:0.02}))};})});}throw Error('Unexpected network');}};`;
 const env={DEVELOPING_NEWS_ENABLED:'true',MUTATIONS_ENABLED:'true',LIVE_FETCH_ENABLED:'true',MODEL_API_ENABLED:'true',SCHEDULE_ENABLED:'true',PUBLICATION_ENABLED:'true',OPENAI_API_KEY:'fictional',MODEL_INPUT_USD_PER_MILLION:'0.125',MODEL_OUTPUT_USD_PER_MILLION:'0.5',MODEL_DAILY_LIMIT_MICRO_USD:'1000000',MODEL_MONTHLY_LIMIT_MICRO_USD:'5000000'};
 for(const unavailable of [false,true]){
 const mf=new Miniflare(convertV4MiniflareOptions({rootPath:dir,workers:[{name:'pipeline',modules:true,scriptPath:bundle,compatibilityDate:'2026-05-15',durableObjects:{DEVELOPING_NEWS:{className:'Tracker',useSQLite:true},NEWSROOM:{className:'Budget',useSQLite:true}},bindings:env,outboundService:'provider'},{name:'provider',modules:true,script:provider,bindings:{UNAVAILABLE:unavailable},compatibilityDate:'2026-05-15'}]}));
 try{
  let result;for(let i=0;i<3;i++){result=await (await mf.dispatchFetch('https://test/test-step')).json();if(result.active.length)break;}
  const status=await (await mf.dispatchFetch('https://test/status')).json();
  if(unavailable){assert.equal(result.active.length,0);assert.equal(status.lastRun.outcome,'assessment_unavailable');assert.equal(status.lastRun.failures[0].reason,'source_unavailable');assert.equal(status.nextCheckDue,false);continue;}
  assert.equal(status.lastRun.outcome,'completed');
  assert.equal(result.active.length,1,'a valid full-source assessment must populate the real tracker');assert.equal(result.active[0].updates.length,1);assert.equal(result.active[0].updates[0].source.url,'https://fictional.example/7001');
  const again=await (await mf.dispatchFetch('https://test/test-step')).json();assert.deepEqual(again,result,'the next tick in the same hour must not repeat publication');
 }finally{await mf.dispose();}
 }
});

test('a budget stop preserves the roster even after earlier successful assessments',async()=>{
 const t=thread(undefined,{status:'active',published:true,activatedAt:at,evidence:[evidence()]});const a=assessment(t,{question_status:'resolved'});a.resolved=true;
 const batch={...run([a,assessment(thread('s-bbbbbbbbbbbbbbbbbbbb'))]),budgetAvailable:false};
 const result=await api.rotate({...roster,initialized:true},[t],batch);assert.deepEqual(result.plan.next_active_ids,[t.id]);assert.equal(result.threads[0].updates.length,0);assert.ok(result.plan.decisions.every(d=>d.reason==='budget_unavailable'));
});
test('event protection requires an exact supporting passage and explicit date',()=>{
 const quote='Answers are due December 7, 2026.';const date='2026-12-07T00:00:00.000Z';assert.equal(api.verifiedEventAt(date,quote,quote,at),date);
 assert.equal(api.verifiedEventAt(date,'A hearing may happen soon.','A hearing may happen soon.',at),null);
 assert.equal(api.verifiedEventAt(date,quote,'A different article.',at),null);
 assert.equal(api.verifiedEventAt('2026-12-08T00:00:00.000Z',quote,quote,at),null);
});


test('story pages link each original HN discussion and show the latest summary once',async()=>{
 const next=await api.rotate(roster,[],run([assessment(thread())]));
 const t=next.threads[0];
 t.updates.push({...t.updates[0],id:'older',summary:'An earlier development.',source:{...t.updates[0].source,hnId:456}});
 const html=api.renderDevelopingStory(api.publicThread(t));
 assert.ok(html.includes('href="https://news.ycombinator.com/item?id=123"'));
 assert.ok(html.includes('href="https://news.ycombinator.com/item?id=456"'));
 assert.equal(html.split(t.summary).length-1,1);
 assert.equal((html.match(/class="discussion-link"/g)||[]).length,2);assert.ok(html.includes('aria-haspopup="dialog"'));
 const data=JSON.parse(html.match(/id="developing-discussion-data" type="application\/json">([^<]+)</)[1]);assert.equal(data.threadId,t.id);assert.deepEqual(data.stories.map(s=>s.id),[123,456]);assert.match(data.commentsAsset,/^\/reader-assets\/comments-[a-f0-9]{16}\.js$/);
 assert.ok(!html.includes('Back to today’s edition'));
 const index=api.renderDevelopingIndex({active:[api.publicThread(t)],quiet:[],nextCursor:null});
 assert.ok(!index.includes('Follow the story'));assert.ok(!index.includes('All coverage'));
 assert.equal(index.split('href="/developing-news/'+t.id+'"').length-1,1);
});

test('legacy discussion references require matching stored evidence; missing or invalid IDs are omitted',()=>{
 const e=evidence(),u={id:e.hash,at,summary:'A report.',source:{url:e.url,title:e.title,publisher:e.publisher},sourceHash:e.hash};
 const legacy=api.publicThread(thread(undefined,{evidence:[e],updates:[u]}));
 assert.equal(legacy.updates[0].source.hnId,123);
 const absent=api.publicThread(thread(undefined,{evidence:[],updates:[u]}));
 assert.ok(!api.renderDevelopingStory(absent).includes('news.ycombinator.com/item'));
 for(const bad of [0,-1,1.5,'123',Infinity]){
  assert.ok(!api.renderDevelopingStory({...absent,updates:[{...u,source:{...u.source,hnId:bad}}]}).includes('news.ycombinator.com/item'));
 }
});


test('publisher dates require explicit publication metadata and preserve calendar precision',()=>{
 const url='https://publisher.example/report',now=Date.parse(at);
 const extract=html=>api.extractPublicationDate(html,url,now);
 assert.equal(extract('<head><meta property="article:published_time" content="2026-11-09T14:09:24-08:00"></head>'),'2026-11-09T14:09:24-08:00');
 assert.equal(extract('<head><meta name="datePublished" content="2026-11-09"></head>'),'2026-11-09');
 assert.equal(extract('<head><meta property="article:modified_time" content="2026-11-14"></head><time>Nov 14, 2026</time>'),null);
 const schema=value=>'<script type="application/ld+json">'+JSON.stringify(value)+'</script>';
 assert.equal(extract(schema({'@graph':[{'@type':'Organization',datePublished:'1999-01-01'},{'@type':'NewsArticle',url,datePublished:'2026-11-09',dateModified:'2026-11-14'}]})),'2026-11-09');
 assert.equal(extract(schema([{'@type':'NewsArticle',url:'https://publisher.example/other',datePublished:'2026-11-10'},{'@type':'NewsArticle',url,datePublished:'2026-11-09'}])),'2026-11-09');
 assert.equal(extract(schema({'@type':'NewsArticle',url:'https://publisher.example/other',datePublished:'2026-11-10'})),null);
 assert.equal(extract(schema([{'@type':'Article',datePublished:'2026-11-10'},{'@type':'Article',datePublished:'2026-11-09'}])),null);
 assert.equal(extract('<!-- <meta property="article:published_time" content="2020-01-01"> -->'),null);
 for(const invalid of ['2026-02-30','2026-13-01','2026-11-09T25:00:00Z','2027-01-01','yesterday',null])assert.equal(api.publicationDate(invalid,now),null);
 assert.equal(api.publicationDate('2026-11-09T12:30:00',now),'2026-11-09','timezone-free metadata retains its calendar date');
});

test('following date survives reactivation and source dates remain distinct from HN submission',async()=>{
 const next=await api.rotate(roster,[],run([assessment(thread())]));assert.equal(next.threads[0].followingSince,at);
 const started='2026-05-01T12:00:00.000Z';
 const old=thread(undefined,{status:'quiet',published:true,followingSince:started,activatedAt:started,evidence:[{...evidence(),hash:'b'.repeat(64)}]});
 const a=assessment(old);a.evidence.articlePublishedAt='2026-11-09';
 const revived=(await api.rotate({...roster,initialized:true},[],run([a]))).threads[0];
 assert.equal(revived.followingSince,started);assert.equal(revived.activatedAt,at);assert.equal(revived.updates[0].source.publishedAt,'2026-11-09');assert.equal(revived.updates[0].at,at);
 const html=api.renderDevelopingStory(api.publicThread(revived));assert.match(html,/Following since <time[^>]+>May 1, 2026/);assert.match(html,/Article published <time[^>]+>Nov 9, 2026/);
 const legacy=api.publicThread(thread(undefined,{published:true,evidence:[evidence()],updates:[{id:'legacy',at,summary:'Earlier coverage',source:{url:evidence().url,title:'Source',publisher:'Publisher'},sourceHash:evidence().hash}]}));
 assert.equal(legacy.updates[0].source.publishedAt,null,'legacy publishedAt was HN time and must not become an article date');assert.match(api.renderDevelopingStory(legacy),/Article publication date unavailable/);
 const collectedFetch=globalThis.fetch;
 try{
  globalThis.fetch=async()=>new Response('<head><meta property="article:published_time" content="2026-11-09"></head><article>Verified report.</article>',{headers:{'content-type':'text/html'}});
  const collected=await api.collectEvidence({id:123,title:'Report',url:'https://fictional.example/report',time:Date.parse(at)/1000,score:1});
  assert.equal(collected.submittedAt,at);assert.equal(collected.articlePublishedAt,'2026-11-09');assert.equal(collected.publishedAt,undefined);
 }finally{globalThis.fetch=collectedFetch;}
});

test('public reader routes do not forward internal tracker diagnostics',async()=>{
 for(const path of ['/status','/api/developing-news/status','/developing-news/status'])assert.equal(await api.developingRoute(new Request('https://fictional.example'+path),{}),null);
});
