import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'hn-month-history-'));
await build({entryPoints:['lib/history.ts'],bundle:true,platform:'node',format:'esm',outfile:path.join(temp,'history.mjs')});
const {monthWindow,historyQueries,parseHistoryResponse,shortlistHistorical,discoverHistory,historyLimits}=await import(pathToFileURL(path.join(temp,'history.mjs')));
const at=Date.parse('2026-11-03T15:00:00.123Z'),window=monthWindow(at);
const raw=(id,extra={})=>({objectID:String(id),title:'Hardware '+id,url:'https://example.org/'+id,points:100,num_comments:10,created_at_i:window.endSeconds-100,...extra});
const envelope=hits=>({hits,hitsPerPage:100,nbHits:hits.length,nbPages:hits.length?1:0,page:0});
const indexed=(id,title,extra={})=>({id,title,url:'https://example.org/'+id,score:100,comments:10,time:window.endSeconds-100,...extra});
const oldFetch=globalThis.fetch;
try{
 assert.equal(window.windowStart,'2026-10-04T15:00:00.123Z');
 assert.equal(window.windowEnd,'2026-11-03T15:00:00.123Z');
 assert.equal(window.startSeconds,Math.ceil((at-30*86400000)/1000));
 assert.equal(window.endSeconds,Math.ceil(at/1000));
 for(const bad of [NaN,Infinity,0,at+.5])assert.throws(()=>monthWindow(bad));
 const queries=historyQueries(at);
 assert.equal(queries.length,13);
 assert.deepEqual(queries.map(q=>q.query),['','','AI','LLM','game','chess','science','physics','biology','history','music','business','economy']);
 for(const [i,q] of queries.entries()){
  const url=new URL(q.url),p=url.searchParams;
  assert.equal(url.origin,'https://hn.algolia.com');assert.equal(url.pathname,'/api/v1/'+(i===1?'search_by_date':'search'));
  assert.equal(p.get('tags'),'(story,poll)');assert.equal(p.get('numericFilters'),`created_at_i>=${window.startSeconds},created_at_i<${window.endSeconds}`);
  assert.equal(p.get('page'),'0');assert.equal(p.get('hitsPerPage'),'100');assert.equal(p.get('analytics'),'false');
  assert.deepEqual(JSON.parse(p.get('attributesToRetrieve')),['objectID','title','url','points','num_comments','created_at_i']);
  assert.equal(p.get('attributesToHighlight'),'[]');assert.equal(p.get('attributesToSnippet'),'[]');
 }
 assert.deepEqual(parseHistoryResponse(envelope([]),window),[]);
 assert.equal(parseHistoryResponse(envelope([raw(1,{url:null})]),window)[0].url,undefined);
 assert.equal(parseHistoryResponse(envelope([raw(1,{url:undefined})]),window)[0].url,undefined);
 assert.equal(parseHistoryResponse(envelope([raw(1,{created_at_i:window.startSeconds})]),window)[0].time,window.startSeconds);
 for(const bad of [null,[],{}, {hits:[]}, {...envelope([]),page:1},{...envelope([]),hitsPerPage:101},{...envelope([]),nbHits:1},{...envelope([raw(1)]),nbPages:0},envelope([raw(1),raw(1)]),envelope(Array.from({length:101},(_,i)=>raw(i+1)))])assert.throws(()=>parseHistoryResponse(bad,window));
 for(const changes of [{objectID:'0'},{objectID:'01'},{objectID:'1.1'},{objectID:1},{objectID:'9007199254740992'},{title:undefined},{title:''},{title:'x'.repeat(4097)},{points:undefined},{points:null},{points:-1},{points:1.1},{num_comments:null},{num_comments:-1},{created_at_i:window.startSeconds-1},{created_at_i:window.endSeconds},{created_at_i:1.1},{url:4},{url:'x'.repeat(2501)}])assert.throws(()=>parseHistoryResponse(envelope([raw(1,changes)]),window),JSON.stringify(changes));
 const topics=['Hardware','AI neural network','Programming compiler','Astronomy telescope','History book','Business revenue','Chess game'];
 const pool=topics.flatMap((title,c)=>Array.from({length:70},(_,n)=>indexed(c*1000+n+1,title,{score:c===0?100000-n:50-n,comments:c===0?1000:10,time:window.endSeconds-10000-c*100-n})));
 // Newest rows remain eligible for a dedicated chronological slice even when
 // they have no engagement and all other sample rows have higher scores.
 const newest=Array.from({length:20},(_,n)=>indexed(9000+n,'Hardware new',{score:0,comments:0,time:window.endSeconds-n-1}));
 const shortlist=shortlistHistorical([...pool,...newest,pool[0]],[],at);
 assert.ok(shortlist.length<=164);assert.equal(new Set(shortlist.map(s=>s.id)).size,shortlist.length);
 for(const row of newest)assert.ok(shortlist.some(s=>s.id===row.id));
 for(const [category,title] of topics.entries())assert.ok(shortlist.filter(s=>s.title===title).length>=20,`topic ${category}`);
 assert.deepEqual(shortlistHistorical([...pool,...newest],[],at),shortlist);
 assert.ok(!shortlistHistorical(pool,[1,1001],at).some(s=>[1,1001].includes(s.id)));
 assert.throws(()=>shortlistHistorical(Array.from({length:1301},(_,i)=>indexed(i+1,'Hardware')),[],at));
 const older=topics.flatMap((title,c)=>Array.from({length:8},(_,n)=>indexed(20000+c*100+n,title,{score:50,comments:10,time:window.endSeconds-(8+n)*86400})));
 const reserved=shortlistHistorical([...pool,...newest,...older],[],at);
 assert.ok(reserved.length<=164);assert.equal(new Set(reserved.map(s=>s.id)).size,reserved.length);
 for(const title of topics){assert.ok(reserved.filter(s=>s.title===title&&at-s.time*1000<7*86400000).length>=20,'recency-ranked discovery coverage: '+title);}
 for(const row of newest)assert.ok(reserved.some(s=>s.id===row.id));
 let calls=[];
 globalThis.fetch=async (input,options)=>{calls.push(String(input));assert.equal(options.redirect,'manual');assert.ok(options.signal instanceof AbortSignal);return Response.json(envelope([raw(1),raw(2,{url:null})]));};
 const discovered=await discoverHistory(at,[1]);assert.equal(calls.length,13);assert.deepEqual(discovered.shortlisted.map(s=>s.id),[2]);
 assert.equal(discovered.discovery.coverage,'sampled');assert.equal(discovered.discovery.discoveredCount,2);assert.equal(discovered.discovery.shortlistedCount,1);assert.equal(discovered.discovery.limits.maxOfficialItems,254);
 assert.deepEqual(discovered.discovery.queries.map(q=>q.hitCount),Array(13).fill(2));
 // Simulate slow responses: request deadlines should not run while waiting
 // behind more fetches than the Worker can open. Preserve all 13 query results.
 let active=0,peak=0,total=0;
 globalThis.fetch=async()=>{active++;total++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,3));active--;return Response.json(envelope([raw(1)]));};
 const bounded=await discoverHistory(at,[]);
 assert.equal(total,13);assert.equal(peak,4);assert.equal(active,0);
 assert.deepEqual(bounded.discovery.queries.map(q=>q.kind),queries.map(q=>q.kind));
 globalThis.fetch=async()=>Response.json(envelope([raw(1)]),{status:503});await assert.rejects(()=>discoverHistory(at,[]),/Historical HN discovery/);
 globalThis.fetch=async()=>Response.json(envelope([raw(1)]),{status:206});await assert.rejects(()=>discoverHistory(at,[]),/Historical HN discovery/);
 globalThis.fetch=async()=>new Response('not JSON',{headers:{'content-type':'application/json'}});await assert.rejects(()=>discoverHistory(at,[]),/failed/);
 globalThis.fetch=async()=>new Response('{}',{headers:{'content-type':'text/html'}});await assert.rejects(()=>discoverHistory(at,[]),/unavailable/);
 globalThis.fetch=async()=>new Response(' '.repeat(historyLimits.maxResponseBytes+1),{headers:{'content-type':'application/json'}});await assert.rejects(()=>discoverHistory(at,[]),/response limit/);
 globalThis.fetch=async()=>new Response('{}',{headers:{'content-type':'application/json','content-length':String(historyLimits.maxResponseBytes+1)}});await assert.rejects(()=>discoverHistory(at,[]),/response limit/);
 globalThis.fetch=async input=>new URL(String(input)).searchParams.get('query')==='chess'?Response.json(envelope([]),{status:503}):Response.json(envelope([raw(1)]));await assert.rejects(()=>discoverHistory(at,[]),/Historical HN discovery/);
 console.log('PASS: pinned exact 30-day bounds; 13 fixed projected queries; strict partial/malformed/body-size rejection; deduplication, topical and chronological coverage; shortlist and fetch bounds; required discovery fails closed.');
}finally{globalThis.fetch=oldFetch;fs.rmSync(temp,{recursive:true,force:true});}
