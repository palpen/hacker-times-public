import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../scripts/publisher-diagnostic-worker.mjs';
test('temporary publisher inspection permits only fixed read operations and bounds model reviews',async()=>{
 const paths=[];
 const env={NEWSROOM:{idFromName:name=>{assert.equal(name,'production-v1');return name;},get:()=>({fetch:async request=>{
  const path=new URL(request.url).pathname,args=await request.json();paths.push({path,args});
  if(path==='/status')return Response.json(args.generatedAt?{missingIds:[1,2,3,4],selected:4,staged:0}:{pending:'2026-11-14T03:00:00.000Z'});
  assert.equal(path,'/model-review');return Response.json({state:'failed',attempt:3,details:{phase:'output'},draft:{shortSummary:'Fictional draft.'}});
 }})}};
 for(const [method,path] of [['POST','/status'],['GET','/publish'],['GET','/stage']])assert.equal((await worker.fetch(new Request('https://private.example'+path,{method}),env)).status,404);
 assert.equal(paths.length,0);
 const result=await (await worker.fetch(new Request('https://private.example/status'),env)).json();
 assert.equal(result.models.length,3);assert.equal(JSON.stringify(result).includes('Fictional draft.'),false);assert.deepEqual(paths.map(x=>x.path),['/status','/status','/model-review','/model-review','/model-review']);
});
