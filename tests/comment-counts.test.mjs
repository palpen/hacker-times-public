import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';import {build} from 'esbuild';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ht-comment-counts-'));
try{
 const out=path.join(dir,'counts.mjs');await build({entryPoints:['web/comment-counts.ts'],outfile:out,bundle:true,platform:'node',format:'esm'});
 const {parseDiscussionCount,refreshDiscussionCounts}=await import(pathToFileURL(out));
 const at='2026-11-16T02:00:00.000Z',payload=(id,count)=>({storyId:id,commentCount:count,commentCountAt:at});
 for(const count of [-1,1.5,'123',null,undefined,Number.MAX_SAFE_INTEGER+1])assert.equal(parseDiscussionCount(payload(1,count),1),null);
 assert.equal(parseDiscussionCount(payload(2,12),1),null);assert.equal(parseDiscussionCount({...payload(1,12),commentCountAt:'bad'},1),null);
 assert.deepEqual(parseDiscussionCount({...payload(1,0),untrusted:'extra'},1),payload(1,0));
 const anchor=id=>({href:'https://news.ycombinator.com/item?id='+id,textContent:'Comments',title:'',closest:()=>({dataset:{storyId:String(id)}})});
 const links=[anchor(1),anchor(1),anchor(2),anchor(3),anchor(4)];globalThis.document={querySelectorAll:()=>links};
 let active=0,peak=0;const calls=[];const thread='s-aaaaaaaaaaaaaaaaaaaa';
 await refreshDiscussionCounts([1,1,2,3,4,5].map(id=>({id})),thread,async(input,options)=>{
  const query=new URL(input,'https://preview.example').searchParams;const id=Number(query.get('storyId'));calls.push(id);
  assert.equal(query.get('countOnly'),'1');assert.equal(query.get('developingStory'),thread);assert.equal(options.credentials,'same-origin');
  active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,1));active--;
  if(id===3)throw Error('offline');if(id===4)return Response.json(payload(id,null));
  return Response.json(payload(id,id===1?127:0));
 });
 assert.deepEqual(calls,[1,2,3,4]);assert.equal(peak,2);assert.equal(links[0].textContent,'127 comments');assert.equal(links[1].textContent,'127 comments');assert.equal(links[2].textContent,'0 comments');assert.equal(links[3].textContent,'Comments');assert.equal(links[4].textContent,'Comments');assert.match(links[0].title,/Comment count from Hacker News as of/);
 console.log('PASS: bounded root count hydration, deduplication, saved timestamp, valid zero, unknown/error fallback, strict response validation.');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
