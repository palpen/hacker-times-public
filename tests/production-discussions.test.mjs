import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ht-production-discussions-'));
const out=path.join(dir,'module.mjs');
await build({entryPoints:['lib/production/discussions.ts'],bundle:true,platform:'node',format:'esm',outfile:out});
const {combineDiscussionBatches,checkDiscussionBatch}=await import(pathToFileURL(out));
test.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
const generatedAt=new Date(Date.now()-60_000).toISOString(),collectedAt=new Date().toISOString(),time=Math.floor(Date.now()/1000)-120;
const edition={generatedAt,sourcePages:[{url:'https://hacker-news.firebaseio.com/v0/topstories.json',ids:[1,2,3,4,5,6,7,8]}],stories:[]};
function batch(ids){return {policy:'hn-trending-comments-v4',sourceGeneratedAt:generatedAt,basePublicationVersion:'empty',storyIds:ids,collectedAt,status:'complete',unavailableStoryIds:[],sources:ids.map((id,i)=>({id,title:'Fictional thread '+id,url:'https://fictional.example/'+id,time,comments:10,hnPosition:i+1})),items:ids.map(id=>({storyId:id,commentId:id+100,author:'reader'+id,commentTime:time,hnPosition:1,excerpt:'A fictional comment describes a careful test of a simple system with several parts.',truncated:false,retrievedAt:collectedAt}))};}
test('deduplication happens across the complete ordered pool, after batching',()=>{
 const first=batch([1,2,3,4]),second=batch([5,6,7,8]);
 second.items[0].author=first.items[0].author;
 second.sources[1].url=second.sources[0].url;
 checkDiscussionBatch(second,edition,'empty',1);
 const merged=combineDiscussionBatches(edition,'empty',[first,second]);
 assert.deepEqual(merged.items.map(x=>x.storyId),[1,2,3,4,6,7,8]);
 assert.equal(merged.sources.find(x=>x.id===6).hnPosition,6);
 assert.equal(merged.status,'complete');
});
test('snapshot identity, attribution, order, timestamp and failed-thread membership are checked',()=>{
 const original=batch([1,2,3,4]);
 for(const change of [
  x=>x.basePublicationVersion='e-'+'f'.repeat(24),
  x=>x.storyIds.reverse(),
  x=>x.items[0].author='invalid author',
  x=>x.items.reverse(),
  x=>x.sources[0].hnPosition=2,
  x=>x.items[0].retrievedAt='2000-01-01T00:00:00.000Z',
  x=>x.sources[0].url='javascript:alert(1)',
  x=>{x.status='partial';x.unavailableStoryIds=[1];},
  x=>x.items[0].commentTime=time-86400,
 ]){const value=structuredClone(original);change(value);assert.throws(()=>checkDiscussionBatch(value,edition,'empty',0),/Invalid pinned/);}
 assert.throws(()=>combineDiscussionBatches(edition,'empty',[original]),/incomplete/);
 const second=batch([5,6,7,8]);second.items=[];second.sources=[];second.status='unavailable';second.unavailableStoryIds=second.storyIds;
 const result=combineDiscussionBatches(edition,'empty',[original,second]);assert.equal(result.status,'partial');assert.deepEqual(result.unavailableStoryIds,[5,6,7,8]);
});
