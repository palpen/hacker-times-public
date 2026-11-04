import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ht-freshness-'));
try {
 await build({entryPoints:['lib/policy.ts','lib/layout.ts','lib/news.ts'],bundle:true,platform:'node',format:'esm',outdir:tmp});
 const {selectMonthlyStories:select,monthRanking,frontPageScore}=await import(pathToFileURL(path.join(tmp,'policy.js')));
 const {editionLayout}=await import(pathToFileURL(path.join(tmp,'layout.js')));
 assert.ok(monthRanking.slice(monthRanking.indexOf('Other')).includes('current first HN page'));
 const at=Date.parse('2026-11-04T13:00:00Z');
 const pool=Array.from({length:90},(_,i)=>({id:i+1,title:'Story '+i,url:'https://example.com/'+i,category:'Technology',time:at/1000-3600,score:i*1000,comments:i*100,editorialScore:0,hnPage:Math.floor(i/30)+1,hnRank:i+1}));
 assert.equal(frontPageScore({time:at/1000},1,30,at),100);
 assert.equal(frontPageScore({time:at/1000-86400},1,30,at),85);
 assert.equal(frontPageScore({time:at/1000-172800},30,30,at),7.5);
 assert.equal(frontPageScore({time:at/1000},1,1,at),100);
 const front=pool.slice(0,30).map(s=>s.id);
 const selected=select(pool,front,undefined,at,5);
 assert.deepEqual(selected.filter(s=>s.placement==='top').map(s=>s.id),[1,2,3,4,6,7,8]);
 assert.ok(selected.filter(s=>['lead','top'].includes(s.placement)).every(s=>front.includes(s.id)));
 assert.ok(selected.some(s=>s.id===90&&['discussion','section'].includes(s.placement)));
 assert.deepEqual(select([...pool].reverse(),front,undefined,at,5),selected);
 assert.deepEqual(select(pool.map(s=>({...s,score:100000-s.score,comments:100000-s.comments})),front,undefined,at,5).filter(s=>s.placement==='top').map(s=>s.id),selected.filter(s=>s.placement==='top').map(s=>s.id));
 for(let hours=0;hours<72;hours++)assert.ok(frontPageScore({time:at/1000-hours*3600},5,30,at)>frontPageScore({time:at/1000-(hours+1)*3600},5,30,at));
 assert.ok(frontPageScore({time:at/1000},8,30,at)>frontPageScore({time:at/1000-86400},7,30,at));
 // Page membership, not stale optional rank/page metadata, governs eligibility/order.
 assert.deepEqual(select(pool.map(s=>({...s,hnRank:100-s.id,hnPage:1})),[5,7,3],undefined,at,5).filter(s=>s.placement==='top').map(s=>s.id),[7,3]);
 for(const ids of [[5],[5,3]]) {
  const short=select(pool,ids,undefined,at,5);
  assert.equal(short.filter(s=>s.placement==='top').length,ids.length-1);
  assert.equal(short.length,42);assert.equal(new Set(short.map(s=>s.id)).size,42);
  assert.equal(editionLayout({schemaVersion:1,layoutVersion:2,stories:short}).features.length,ids.length);
 }
 const ages=pool.map(s=>s.id===7?{...s,time:at/1000-7*86400}:s);
 assert.ok(!select(ages,front,undefined,at,5).filter(s=>s.placement==='top').some(s=>s.id===7));
 assert.ok(select(ages,front,undefined,at,5).filter(s=>s.placement==='top').some(s=>s.id===9));
 assert.throws(()=>select(pool,[],undefined,at),/No eligible front-page lead/);
 assert.throws(()=>select(pool,front,undefined,at,90),/No eligible front-page lead/);
 console.log('PASS freshness: actual page-one eligibility/order, off-page high scores stay below, permutation determinism, shortage without backfill, layout capacity and missing lead fail closed.');
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
