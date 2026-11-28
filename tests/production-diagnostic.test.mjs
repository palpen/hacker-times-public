import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import yaml from 'js-yaml';
import worker from '../scripts/publisher-diagnostic-worker.mjs';
test('temporary publisher inspection permits only fixed read operations and bounds model reviews',async()=>{
 const paths=[];
 const env={NEWSROOM:{idFromName:name=>{assert.equal(name,'production-v1');return name;},get:()=>({fetch:async request=>{
  const path=new URL(request.url).pathname,args=await request.json();paths.push({path,args});
  if(path==='/status')return Response.json(args.generatedAt?{missingIds:[1,2,3,4],selected:4,staged:0}:{pending:'2026-11-14T03:00:00.000Z'});
  assert.equal(path,'/model-review');return Response.json({state:'failed',attempt:3,details:{phase:'output'},hasDraft:true,draft:{shortSummary:'Fictional draft.'}});
 }})}};
 for(const [method,path] of [['POST','/status'],['GET','/publish'],['GET','/stage']])assert.equal((await worker.fetch(new Request('https://private.example'+path,{method}),env)).status,404);
 assert.equal(paths.length,0);
 const result=await (await worker.fetch(new Request('https://private.example/status'),env)).json();
 assert.equal(result.models.length,3);assert.equal(result.models[0].hasDraft,true);assert.equal(JSON.stringify(result).includes('Fictional draft.'),false);assert.deepEqual(paths.map(x=>x.path),['/status','/status','/model-review','/model-review','/model-review']);
});

test('temporary inspection includes fixed read-only Developing News diagnostics',async()=>{
 const paths=[];
 const env={NEWSROOM:{idFromName:x=>x,get:()=>({fetch:async()=>Response.json({pending:null})})},DEVELOPING_NEWS:{idFromName:x=>{assert.equal(x,'developing-v1');return x;},get:()=>({fetch:async req=>{paths.push({url:req.url,method:req.method});return Response.json({enabled:true,lastRun:{outcome:'assessment_unavailable'}});}})}};
 const result=await (await worker.fetch(new Request('https://private.example/status'),env)).json();
 assert.equal(result.developing.lastRun.outcome,'assessment_unavailable');assert.deepEqual(paths,[{url:'https://developing.internal/status',method:'GET'}]);
});

test('temporary recovery preview forwards only the exact dispatch configured by the owner',async()=>{
 const args={generatedAt:'2026-11-14T03:00:00.000Z',basePublicationVersion:'empty',baseRevision:0,githubRun:'12345/1'};
 const calls=[];
 const env={NEWSROOM:{idFromName:x=>x,get:()=>({fetch:async request=>{
  calls.push([new URL(request.url).pathname,await request.json()]);
  return Response.json({recorded:true});
 }})}};
 const url='https://private.example/recover-expired';
 assert.equal((await worker.fetch(new Request(url,{method:'POST'}),env)).status,404);
 env.EXPIRED_BATCH_RECOVERY=JSON.stringify(args);
 for(const request of [new Request(url),new Request(url+'?generatedAt=other',{method:'POST'}),
  new Request(url,{method:'POST',body:'{"baseRevision":99}'}),new Request('https://private.example/publish',{method:'POST'})]){
  assert.equal((await worker.fetch(request,env)).status,404);
 }
 assert.deepEqual(calls,[]);
 assert.equal((await worker.fetch(new Request(url,{method:'POST'}),env)).status,200);
 assert.deepEqual(calls,[['/recover-expired-batch',args]]);
});

test('phone recovery discovers the current candidate and submits its exact identity without user input',async()=>{
 const generatedAt='2026-11-14T03:00:00.000Z',basePublicationVersion='e-'+'a'.repeat(24),baseRevision=9;
 const candidate={generatedAt,basePublicationVersion,baseRevision,ignored:'never forward unrelated fields'};
 const calls=[];
 let status={candidate:null,safetyHoldAt:null},recoverStatus=200;
 const env={CURRENT_BATCH_RECOVERY:'349/1',NEWSROOM:{idFromName:x=>x,get:()=>({fetch:async request=>{
  const path=new URL(request.url).pathname;
  calls.push([path,await request.json()]);
  return path==='/publisher-recovery-status'?Response.json(status):Response.json({private:'not exposed'},{status:recoverStatus});
 }})}};
 const url='https://private.example/recover-expired';
 const recover=()=>worker.fetch(new Request(url,{method:'POST'}),env);
 assert.equal((await worker.fetch(new Request(url,{method:'POST',body:'{"baseRevision":5}'}),env)).status,404);
 assert.deepEqual(await (await recover()).json(),{outcome:'no_candidate'});
 assert.deepEqual(calls,[['/publisher-recovery-status',{}]]);
 status={candidate,safetyHoldAt:generatedAt};
 assert.equal((await recover()).status,409);
 assert.equal(calls.length,2,'no mutation during a safety hold');
 status={candidate,safetyHoldAt:null};recoverStatus=409;
 const blocked=await recover();
 assert.equal(blocked.status,409);assert.deepEqual(await blocked.json(),{outcome:'blocked'});
 recoverStatus=200;
 assert.deepEqual(await (await recover()).json(),{outcome:'queued'});
 assert.deepEqual(calls.at(-1),['/recover-expired-batch',{generatedAt,basePublicationVersion,baseRevision,githubRun:'349/1'}]);
});

test('phone workflow has no inputs and is manual, main-only and production-gated',()=>{
 const workflow=yaml.load(readFileSync('.github/workflows/recover-expired-edition.yml','utf8'));
 assert.deepEqual(workflow.on,{workflow_dispatch:null});
 assert.deepEqual(workflow.permissions,{contents:'read'});
 assert.deepEqual(workflow.concurrency,{group:'hacker-times-production','cancel-in-progress':false});
 const job=workflow.jobs.recover;
 assert.equal(job.environment,'production');
 assert.equal(job.if,"github.event_name == 'workflow_dispatch' && github.repository == 'palpen/hacker-times-public' && github.ref == 'refs/heads/main'");
 assert.equal(job.steps.at(-1).run,'node scripts/inspect-publisher.mjs --recover-current');
 assert.equal(job.steps.filter(step=>step.env?.CLOUDFLARE_API_TOKEN).length,1);
});
