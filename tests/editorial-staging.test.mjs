import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';import {build} from 'esbuild';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ht-staging-test-'));
try {
 const out=path.join(tmp,'entry.mjs');const entry=path.join(tmp,'entry.ts');
 fs.writeFileSync(entry,`export {editorCall} from '${process.cwd()}/lib/editor.ts';export {publishEdition,resetPublicationMemoryForTest,PUBLICATION_KEY} from '${process.cwd()}/lib/publication.ts';`);
 await build({entryPoints:[entry],outfile:out,bundle:true,platform:'node',format:'esm',loader:{'.md':'text','.html':'text'}});
 const api=await import(pathToFileURL(out));globalThis.fetch=async()=>{throw Error('Network forbidden in synthetic staging tests')};
 const ownerHeaders={'oai-authenticated-user-id':'fixture-owner','oai-authenticated-user-email':'owner@example.com'};
 const request=new Request('https://fixture.example/mcp',{headers:ownerHeaders});
 const generatedAt=new Date(Date.now()-30_000).toISOString();
 const candidates=[1,2,3].map((id,i)=>({id,title:'Synthetic title '+id,url:'https://publisher.example/story/'+id,score:100-id,comments:20-id,time:Math.floor((Date.now()-3600_000)/1000),category:'Technology',placement:i?'section':'lead',hnRank:id,hnPage:1,editorialScore:100-id}));
 const authored=s=>({...s,headline:s.title,summary:'A synthetic source-backed summary.',shortSummary:'A compact synthetic summary.',summarySource:'article',publisher:'Synthetic publisher',image:null,imageAlt:'',imageCredit:'',articleStatus:'fetched'});
 async function setup(){
  api.resetPublicationMemoryForTest();let seq=0;const data=new Map();const controls={conflict:false};
  const bucket={get:async key=>{const o=data.get(key);return o?{etag:o.etag,size:Buffer.byteLength(o.text),text:async()=>o.text,json:async()=>JSON.parse(o.text)}:null},put:async(key,text,options={})=>{const old=data.get(key);if(options.onlyIf&&(controls.conflict||options.onlyIf.etagMatches&&options.onlyIf.etagMatches!==old?.etag||options.onlyIf.etagDoesNotMatch==='*'&&old))return null;const o={text,etag:String(++seq)};data.set(key,o);return o;},list:async()=>({objects:[]})};
  const env={BUCKET:bucket,HACKER_TIMES_OWNER_EMAIL:'owner@example.com',HACKER_TIMES_EDITOR_MUTATIONS_ENABLED:'true'};
  const baseline={schemaVersion:1,generatedAt:new Date(Date.now()-3600_000).toISOString(),frontPageIds:[1,2,3],sourcePages:[{url:'https://news.ycombinator.com/',ids:[1,2,3]}],stories:candidates.map(authored)};
  await api.publishEdition(request,env,baseline);const before=JSON.parse(data.get(api.PUBLICATION_KEY).text);
  const snapshot={schemaVersion:1,summaryPolicyVersion:1,selectionVersion:1,layoutVersion:1,policyVersion:'fixture-pinned',generatedAt,basePublicationVersion:before.current.version,frontPageIds:[1,2,3],sourcePages:baseline.sourcePages,rankedStories:candidates,selectedStories:candidates};
  await bucket.put('source-snapshots/'+generatedAt+'.json',JSON.stringify(snapshot));
  const call=(name,args={})=>api.editorCall(name,{generatedAt,...args},request,env);
  return {data,controls,bucket,env,before,snapshot,call};
 }
 const s=await setup();
 const initial=await s.call('get_editorial_status');
 assert.equal(initial.staged,0);assert.deepEqual(initial.missingIds,[1,2,3]);assert.equal(initial.readyForValidation,false);
 await assert.rejects(()=>s.call('publish_staged_edition'),/incomplete|missing|ready|staged/i);
 assert.equal(JSON.parse(s.data.get(api.PUBLICATION_KEY).text).current.version,s.before.current.version);
 // Unknown selection, altered authoritative metrics, malformed/provenance-free copy are rejected.
 for(const story of [{...authored(candidates[0]),id:999},{...authored(candidates[0]),score:999},{...authored(candidates[0]),shortSummary:undefined},{...authored(candidates[0]),summarySource:'unavailable'}])await assert.rejects(()=>s.call('stage_article',{story}));
 const first=await s.call('stage_article',{story:authored(candidates[0])});assert.equal(first.revision,1);assert.equal(first.published,false);
 const retry=await s.call('stage_article',{story:authored(candidates[0])});assert.equal(retry.unchanged,true);assert.equal(retry.revision,1);
 const changed={...authored(candidates[0]),summary:'Changed but still synthetic source-backed copy.'};
 await assert.rejects(()=>s.call('stage_article',{story:changed,expectedRevision:0}),/revision changed/);
 s.controls.conflict=true;await assert.rejects(()=>s.call('stage_article',{story:changed,expectedRevision:1}),/Concurrent/);s.controls.conflict=false;
 const updated=await s.call('stage_article',{story:changed,expectedRevision:1});assert.equal(updated.revision,2);
 // Ordinary source-unavailable records remain legitimate and do not impose a safety hold.
 await s.call('record_editorial_failure',{kind:'source_unavailable',storyId:2});
 const unavailable={...authored(candidates[1]),summary:'',shortSummary:'',summarySource:'unavailable',articleStatus:'unavailable'};
 await s.call('stage_article',{story:unavailable});await s.call('stage_article',{story:authored(candidates[2])});
 const ready=await s.call('get_editorial_status');assert.equal(ready.complete,true);assert.equal(ready.readyForValidation,true);assert.equal(ready.safetyStop,null);assert.equal(ready.lastFailure.kind,'source_unavailable');
 assert.ok(!JSON.stringify(ready).includes('source-backed'));assert.equal(ready.articles.find(a=>a.id===1).revision,2);
 const beforeValidation=s.data.get(api.PUBLICATION_KEY).text;const valid=await s.call('validate_staged_edition');assert.equal(valid.ok,true);assert.equal(s.data.get(api.PUBLICATION_KEY).text,beforeValidation);
 const result=await s.call('publish_staged_edition');assert.equal(result.ok,true);const published=JSON.parse(s.data.get(api.PUBLICATION_KEY).text);assert.equal(published.current.edition.generatedAt,generatedAt);assert.deepEqual(published.current.edition.stories.map(x=>x.id),[1,2,3]);assert.equal(published.current.edition.stories[1].summarySource,'unavailable');
 // A changed base cannot be edited, validated or silently rebased.
 await assert.rejects(()=>s.call('stage_article',{story:changed,expectedRevision:2}),/base changed/i);
 await assert.rejects(()=>s.call('validate_staged_edition'),/base changed/i);
 // Concurrent creates cannot silently overwrite one another.
 const concurrent=await setup();const race=await Promise.allSettled([concurrent.call('stage_article',{story:authored(candidates[0])}),concurrent.call('stage_article',{story:{...authored(candidates[0]),summary:'Different concurrent synthetic summary.'}})]);assert.equal(race.filter(x=>x.status==='fulfilled').length,1);assert.equal(race.filter(x=>x.status==='rejected').length,1);assert.equal((await concurrent.call('get_editorial_status')).articles[0].revision,1);
 // Safety stop is durable, blocks direct and staged routes, and cannot be cleared by logging a lesser failure.
 const held=await setup();await held.call('stage_article',{story:authored(candidates[0])});
 const frozen=held.before.current;await held.call('record_editorial_failure',{kind:'safety_stop'});await held.call('record_editorial_failure',{kind:'transient'});
 const status=await held.call('get_editorial_status');assert.equal(status.safetyStop.kind,'safety_stop');assert.equal(status.readyForValidation,false);
 for(const [name,args] of [['stage_article',{story:unavailable}],['validate_staged_edition',{}],['publish_staged_edition',{}],['publish_edition',{edition:{generatedAt,stories:candidates.map(authored)}}],['fetch_candidates',{strategy:'month'}]])await assert.rejects(()=>held.call(name,args),/safety/i);
 assert.deepEqual(JSON.parse(held.data.get(api.PUBLICATION_KEY).text).current,frozen);
 // All new tools remain owner-only and all mutation entrypoints honor the existing flag.
 const mutating=['stage_article','record_editorial_failure','validate_staged_edition','publish_staged_edition'];
 for(const name of [...mutating,'get_editorial_status'])await assert.rejects(()=>api.editorCall(name,{generatedAt},new Request('https://fixture.example/mcp'),held.env),/Owner authorization/);
 const disabled={...held.env,HACKER_TIMES_EDITOR_MUTATIONS_ENABLED:'false'};for(const name of mutating)await assert.rejects(()=>api.editorCall(name,{generatedAt},request,disabled),/mutations are disabled/);
 console.log('PASS: synthetic durable staging, revision/CAS conflicts, provenance validation, unavailable vs safety holds, complete-only atomic publication, stale bases, owner access and disabled mutations. No external content or network.');
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
