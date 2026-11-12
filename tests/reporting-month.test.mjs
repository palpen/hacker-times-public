import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'hn-month-reporting-'));
await build({entryPoints:['lib/reporting.ts'],bundle:true,platform:'node',format:'esm',outfile:path.join(temp,'reporting.mjs')});
const {candidates}=await import(pathToFileURL(path.join(temp,'reporting.mjs')));
const oldFetch=globalThis.fetch,oldNow=Date.now;
const at=Date.parse('2026-11-03T15:00:00.123Z'),seconds=Math.floor(at/1000),cutoff=Math.ceil((at-30*86400000)/1000);
const current=Array.from({length:90},(_,i)=>i+1),history=Array.from({length:100},(_,i)=>i+101);
const titles=['Hardware','AI neural network','Programming compiler','Astronomy telescope','History book','Business revenue','Chess game'];
const html=page=>'<html>'+current.slice((page-1)*30,page*30).map(id=>`<tr class="athing submission" id="${id}">`).join('')+`<a class='morelink' href='?p=${page+1}'>More</a></html>`;
const item=id=>({id,type:id===5?'poll':'story',title:titles[id%7]+' '+id,time:id===1||id===2?cutoff-1:seconds-1000-id,score:id===1?10000:id===2?9999:id===60?99999:200-id,descendants:id%7*12,...(id===1||id===101?{text:'An HN self-post.'}:{url:'https://example.org/story/'+id})});
const indexed=id=>({objectID:String(id),title:'Indexed wrong topic '+id,url:'https://index.example/'+id,points:50000-id,num_comments:999,created_at_i:seconds-1000-id});
let mode='normal',calls=[],officialActive=0,maxOfficial=0,articleActive=0,maxArticle=0;
const tick=()=>new Promise(resolve=>setTimeout(resolve,1));
globalThis.fetch=async (input,options)=>{
 const url=String(input);calls.push(url);
 if(url==='https://hacker-news.firebaseio.com/v0/topstories.json'){
  assert.equal(options.redirect,'manual');
  if(mode==='api-http')return Response.json({},{status:503});
  if(mode==='api-request-limit')throw new Error('Too many subrequests.');
  if(mode==='api-content')return new Response(JSON.stringify(current),{headers:{'content-type':'text/html'}});
  if(mode==='api-duplicate')return Response.json([...current.slice(0,89),1]);
  if(mode==='api-short')return Response.json(current.slice(0,89));
  if(mode==='api-invalid')return Response.json([...current.slice(0,89),'90']);
  if(mode==='api-huge')return Response.json(Array.from({length:501},(_,i)=>i+1));
  return Response.json([...current].reverse());
 }

 if(/^https:\/\/news.ycombinator.com\/(\?p=[23])?$/.test(url))return new Response(html(Number(new URL(url).searchParams.get('p')||1)),{headers:{'content-type':'text/html'}});
 if(url.startsWith('https://hn.algolia.com/')){
  if(mode==='discovery-fail'&&new URL(url).searchParams.get('query')==='chess')return Response.json({},{status:503});
  assert.equal(new URL(url).searchParams.get('numericFilters'),`created_at_i>=${cutoff},created_at_i<${Math.ceil(at/1000)}`);
  return Response.json({hits:history.map(indexed),hitsPerPage:100,nbHits:100,nbPages:1,page:0});
 }
 if(url.includes('/item/')){
  const id=Number(url.match(/item\/(\d+)/)[1]);officialActive++;maxOfficial=Math.max(maxOfficial,officialActive);await tick();officialActive--;
  assert.equal(options.redirect,'manual');
  if(mode==='missing'&&id===101)return Response.json(null);
  if(mode==='http-fail'&&id===101)return Response.json({},{status:503});
  if(mode==='http-partial'&&id===101)return Response.json(item(id),{status:206});
  if(mode==='null-comments'&&id===101)return Response.json({...item(id),descendants:null});
  if(mode==='invalid-time'&&id===101)return Response.json({...item(id),time:Number.MAX_SAFE_INTEGER});
  if(mode==='wrong-content-type'&&id===101)return new Response(JSON.stringify(item(id)),{headers:{'content-type':'text/html'}});
  if(mode==='wrong-id'&&id===101)return Response.json({...item(id),id:999});
  if(mode==='partial'&&id===101)return Response.json({id,type:'story',title:'Incomplete'});
  if(mode==='deleted'&&id===101)return Response.json({id,deleted:true});
  if(mode==='deleted'&&id===102)return Response.json({id,dead:true});
  if(mode==='deleted'&&id===103)return Response.json({id,type:'job'});
  if(mode==='stale-history'&&id===101)return Response.json({...item(id),time:cutoff-1,score:500000});
  if(mode==='boundary'&&id===101)return Response.json({...item(id),time:cutoff,score:500000});
  if(mode==='future-history'&&id===101)return Response.json({...item(id),time:Math.ceil(at/1000),score:500000});
  return Response.json(item(id));
 }
 if(url.startsWith('https://example.org/')){articleActive++;maxArticle=Math.max(maxArticle,articleActive);await tick();articleActive--;return new Response('<html><title>Source</title><article>Verified text.</article></html>',{headers:{'content-type':'text/html'}});}
 throw Error('Unexpected URL '+url);
};
Date.now=()=>at;
try{
 const month=await candidates(1,'month');
 assert.equal(month.schemaVersion,1);assert.equal(month.selectionVersion,6);assert.equal(month.layoutVersion,3);assert.equal(month.algorithmVersion,3);assert.equal(month.policyVersion,'hn-month-unified-sections-v6');assert.equal(month.sourceMode,'hn-month-sample');
 assert.equal(month.generatedAt,new Date(at).toISOString());assert.equal(month.windowEnd,month.generatedAt);assert.equal(month.windowStart,new Date(at-30*86400000).toISOString());
 assert.equal(month.discovery.coverage,'sampled');assert.equal(month.discovery.requestCount,13);assert.equal(month.discovery.discoveredCount,100);assert.ok(month.fetchedCount<=254);assert.equal(month.fetchedCount,90+month.discovery.shortlistedCount);assert.equal(month.discovery.historyFetchedCount,month.discovery.shortlistedCount);
 assert.ok(month.stories.length>42&&month.stories.length<=126);assert.equal(new Set(month.stories.map(s=>s.id)).size,month.stories.length);assert.equal(month.stories[0].id,1);assert.equal(month.stories[0].time,cutoff-1);assert.ok(!month.stories.some(s=>s.id===2));assert.ok(month.stories.slice(1).every(s=>s.time*1000>=at-30*86400000&&s.time*1000<at));
 assert.ok(['discussion','section'].includes(month.stories.find(s=>s.id===60).placement));assert.deepEqual(month.stories.filter(s=>s.placement==='top').map(s=>s.id),[3,4,5,6,7,8,9]);assert.ok(month.stories[0].isSelfPost);assert.equal(month.stories[0].articleStatus,'hn_self_post');
 assert.ok(month.rankedStories.filter(s=>s.id>90).every(s=>!('hnPage' in s)&&!('hnRank' in s)&&s.discoverySource==='history'));
 assert.ok(month.rankedStories.filter(s=>s.id<=90).every(s=>Number.isInteger(s.hnPage)&&Number.isInteger(s.hnRank)&&s.discoverySource==='current'));
 assert.ok(month.rankedStories.every(s=>s.title===item(s.id).title&&s.score===item(s.id).score&&s.comments===item(s.id).descendants));
 assert.ok(month.rankedStories.some(s=>s.category==='AI'&&s.topics.includes('AI')));assert.ok(month.rankedStories.some(s=>s.category==='Games'&&s.topics.includes('Games')));
 assert.equal(maxOfficial,8);assert.equal(maxArticle,4);assert.equal(calls.filter(u=>u.includes('/item/')).length,month.fetchedCount);assert.ok(!calls.some(u=>u.startsWith('https://index.example/')));
 // Exercise the real editor/reporting composition, with only external reads and storage mocked.
 const editorOut=path.join(temp,'editor.mjs');
 await build({stdin:{contents:`export {editorCall} from '${process.cwd()}/lib/editor.ts';export {mcpResponse} from '${process.cwd()}/lib/mcp.ts';export {editionLimits} from '${process.cwd()}/lib/contracts.ts';export {publishEdition} from '${process.cwd()}/lib/publication.ts';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',loader:{'.md':'text','.html':'text'},outfile:editorOut,plugins:[{name:'no-production-migration-records',setup(b){b.onLoad({filter:/verified-lead-seeds\.json$/},()=>({contents:'{"schema":1,"stories":[]}',loader:'json'}));}}]});
 const {editorCall,publishEdition,mcpResponse,editionLimits}=await import(pathToFileURL(editorOut));
 let seq=0;const store=new Map();const env={HACKER_TIMES_OWNER_EMAIL:'owner@example.com',HACKER_TIMES_EDITOR_MUTATIONS_ENABLED:'true',BUCKET:{get:async key=>{const o=store.get(key);return o?{etag:o.etag,size:Buffer.byteLength(o.text),text:async()=>o.text,json:async()=>JSON.parse(o.text)}:null;},put:async(key,text,opts={})=>{const old=store.get(key);if(opts.onlyIf&&(opts.onlyIf.etagMatches&&opts.onlyIf.etagMatches!==old?.etag||opts.onlyIf.etagDoesNotMatch==='*'&&old))return null;const o={text,etag:String(++seq)};store.set(key,o);return o;},list:async()=>({objects:[]})}};
 const request=new Request('https://fixture.example/mcp',{headers:{'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.com'}});
 const seed=JSON.parse(fs.readFileSync('data/published-seed.json'));seed.generatedAt=new Date(at-3600_000).toISOString();seed.frontPageIds=[9999];seed.stories=[{...seed.stories[0],id:9999,url:'https://example.org/previous-lead',placement:'lead'}];
 await publishEdition(request,env,seed);
 const draft=await editorCall('fetch_candidates',{strategy:'month'},request,env);
 assert.equal((await editorCall('get_editor_status',{},request,env)).workflowVersion,9);
 assert.equal(draft.leadPolicyVersion,'hn-balanced-lead-v2');assert.equal(draft.leadPolicyConfig.weights.freshness,30);assert.equal(draft.leadAudit.policyVersion,'hn-balanced-lead-v2');
 assert.equal(draft.policyVersion,'hn-month-unified-sections-v6');assert.equal(draft.selectionVersion,6);
 assert.ok(draft.ranking.includes('Other top stories remain current-first-page only'));
 assert.ok(draft.ranking.includes('Today desk previews and discussion placements'));
 assert.ok(draft.instructions.includes('All additional top placements use only the current HN first page'));
 assert.ok(draft.instructions.includes('Secondary Today placements must be younger than seven days'));
 const pinned=JSON.parse(store.get('source-snapshots/'+draft.generatedAt+'.json').text);
 assert.equal(pinned.ranking,draft.ranking);assert.equal(pinned.policyVersion,'hn-month-unified-sections-v6');
 assert.ok(pinned.selectedStories.filter(s=>s.placement==='top').every(s=>pinned.frontPageIds.includes(s.id)));
 // Full owner publication includes section-only stories, then immutable-version comments and archives.
 const payload={generatedAt:draft.generatedAt,stories:draft.stories.map(s=>({...s,headline:s.title,summary:'Verified text.',shortSummary:'Verified text.',summarySource:s.isSelfPost?'hn_post':'article',publisher:'Fixture',image:null}))};
 // Maximum permitted authored field lengths, using six-byte JSON escapes,
 // exercise the real MCP envelope, validator, render and R2 serialization.
 const wide='\u0001';for(const s of payload.stories)Object.assign(s,{title:wide.repeat(240),headline:wide.repeat(240),summary:wide.repeat(900),shortSummary:wide.repeat(280),publisher:wide.repeat(240),category:wide.repeat(240),image:'https://example.org/'+ 'x'.repeat(2480),imageAlt:wide.repeat(400),imageCredit:wide.repeat(240),articleStatus:wide.repeat(180)});
 const wire=JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'publish_edition',arguments:{edition:payload}}});
 assert.ok(Buffer.byteLength(JSON.stringify(payload))>160000);assert.ok(Buffer.byteLength(JSON.stringify(payload))<editionLimits.payloadBytes);assert.ok(Buffer.byteLength(wire)<editionLimits.mcpBytes);
 const largeResponse=await mcpResponse(new Request(request.url,{method:'POST',headers:{...Object.fromEntries(request.headers),'Content-Type':'application/json'},body:wire}),env);const rpc=await largeResponse.json();assert.equal(rpc.result?.isError,undefined,JSON.stringify(rpc));const published=rpc.result.structuredContent;
 console.log('SIZE fixture',JSON.stringify({payloadBytes:Buffer.byteLength(JSON.stringify(payload)),mcpBytes:Buffer.byteLength(wire),snapshotBytes:Buffer.byteLength(store.get('source-snapshots/'+draft.generatedAt+'.json').text),publicationBytes:Buffer.byteLength(store.get('publication/current.json').text)}));
 assert.equal(published.ok,true);const saved=await editorCall('get_edition',{},request,env);
 assert.equal(saved.stories.length,draft.stories.length);assert.equal(saved.layoutVersion,3);assert.equal(saved.selectionVersion,6);
 assert.ok(saved.stories.filter(s=>s.placement==='section-only').length>40);
 assert.equal((await editorCall('get_edition',{date:draft.generatedAt.slice(0,10)},request,env)).publicationVersion,published.version);
 const rebuilt=await editorCall('rebuild_edition',{},request,env);assert.equal(rebuilt.generatedAt,draft.generatedAt);
 const commentOut=path.join(temp,'comments.mjs');await build({entryPoints:['lib/comments.ts'],bundle:true,platform:'node',format:'esm',loader:{'.html':'text'},outfile:commentOut});
 const {createCommentsService}=await import(pathToFileURL(commentOut));
 const only=saved.stories.find(s=>s.placement==='section-only');
 const service=createCommentsService({fetcher:async()=>Response.json({id:only.id,type:'story',kids:[]})});
 const commentResponse=await service(new Request('https://fixture.example/api/comments?storyId='+only.id+'&version='+published.version),env);
 assert.equal(commentResponse.status,200);assert.equal((await commentResponse.json()).storyId,only.id);
 await assert.rejects(()=>editorCall('publish_edition',{edition:{...payload,stories:payload.stories.filter(s=>s.id!==only.id)}},request,env));

 // Independent production uses the supported API even when HTML is inaccessible.
 mode='normal';calls=[];
 const api=await candidates(undefined,'month',undefined,true,'official-api');
 assert.deepEqual(api.frontPageIds,[...current].reverse().slice(0,30));
 assert.deepEqual(api.sourcePages.flatMap(p=>p.ids),[...current].reverse());
 assert.ok(api.sourcePages.every(p=>p.url==='https://hacker-news.firebaseio.com/v0/topstories.json'));
 assert.equal(api.discovery.currentSource,'hn-topstories-api');assert.equal(api.discovery.currentRankCount,90);
 assert.equal(api.rankedStories.find(s=>s.id===90).hnRank,1);assert.equal(api.rankedStories.find(s=>s.id===1).hnPage,3);
 assert.match(api.ranking,/API ranks 1–30/);assert.equal(api.stories.length,0);
 assert.ok(!calls.some(u=>u.startsWith('https://news.ycombinator.com/')||u.startsWith('https://example.org/')));
 for(const failure of ['api-http','api-content','api-duplicate','api-short','api-invalid','api-huge']){
  mode=failure;calls=[];await assert.rejects(()=>candidates(undefined,'month',undefined,true,'official-api'),/keep the previous edition/);
  assert.equal(calls.length,1,'invalid list must stop before hydration or HTML fallback');
 }
 mode='api-request-limit';
 await assert.rejects(()=>candidates(undefined,'month',undefined,true,'official-api'),error=>error.status===502&&error.details.phase==='current_list'&&error.details.reason==='request_limit');
 mode='api-http';
 await assert.rejects(()=>candidates(undefined,'month',undefined,true,'official-api'),error=>error.details.upstreamStatus===503&&error.details.reason==='http');
 mode='normal';
 // Default strategy stays legacy and does not contact the historical index.
 calls=[];const legacy=await candidates(1);assert.equal(legacy.algorithmVersion,2);assert.equal(legacy.selectionVersion,1);assert.equal(legacy.layoutVersion,1);assert.equal(legacy.sourceMode,'hn-multi-page');assert.equal(legacy.fetchedCount,90);assert.equal(legacy.stories.length,34);assert.ok(!('windowStart' in legacy));assert.ok(!('discovery' in legacy));assert.ok(!calls.some(u=>u.startsWith('https://hn.algolia.com/')));
 mode='deleted';const dropped=await candidates(1,'month');assert.ok(!dropped.rankedStories.some(s=>[101,102,103].includes(s.id)));assert.equal(dropped.fetchedCount-dropped.candidateCount,3);
 mode='boundary';assert.ok((await candidates(1,'month')).rankedStories.some(s=>s.id===101));
 for(const value of ['stale-history','future-history']){mode=value;assert.ok(!(await candidates(1,'month')).stories.some(s=>s.id===101));}
 for(const value of ['missing','http-fail','http-partial','wrong-id','partial','discovery-fail','null-comments','invalid-time','wrong-content-type']){mode=value;calls=[];await assert.rejects(()=>candidates(1,'month'),/keep the previous edition/);await new Promise(resolve=>setTimeout(resolve,60));assert.ok(!calls.some(u=>u.startsWith('https://example.org/')));}
 await assert.rejects(()=>candidates(1,'invalid'),/Unsupported/);
 console.log('PASS: month snapshot contract; unchanged legacy default; official metric authority; old first-page lead exempt from cutoff; secondary cutoff enforcement; absent historical ranks; self-post handling; 8 official/4 source concurrency; deleted/dead/jobs dropped; missing/malformed/failed required reads fail closed.');
}finally{globalThis.fetch=oldFetch;Date.now=oldNow;fs.rmSync(temp,{recursive:true,force:true});}
