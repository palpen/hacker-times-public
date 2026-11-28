import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ht-monitor-'));
await build({entryPoints:['lib/monitor/core.ts','worker/monitor.ts'],outdir:dir,bundle:true,platform:'node',format:'esm',outExtension:{'.js':'.mjs'}});
const core=await import(pathToFileURL(path.join(dir,'lib/monitor/core.mjs')));
const {SiteMonitor,default:worker}=await import(pathToFileURL(path.join(dir,'worker/monitor.mjs')));
const healthy=[{name:'availability',ok:true,detail:'HTTP 200'},{name:'freshness',ok:true,detail:'Fresh edition'}];
const failed=[healthy[0],{name:'freshness',ok:false,detail:'HTTP 503'}];
test('two adjacent failures alert once, recovery alerts once, and gaps reset confirmation',()=>{
 let state=core.initialState();
 let result=core.transition(state,failed,10,Date.now());assert.equal(result.notification,undefined);state=result.state;
 result=core.transition(state,failed,11,Date.now());assert.equal(result.notification,'failure');state={...result.state,alerted:true};
 result=core.transition(state,failed,12,Date.now());assert.equal(result.notification,undefined);
 result=core.transition(result.state,healthy,13,Date.now());assert.equal(result.notification,'recovery');
 assert.equal(core.transition({...result.state,alerted:false},healthy,14,Date.now()).notification,undefined);
 assert.equal(core.transition(core.transition(core.initialState(),failed,10,Date.now()).state,failed,20,Date.now()).notification,undefined);
});
test('probes reject redirects, stale 200s, malformed JSON, and transport errors',async()=>{
 const now=Date.now();
 const valid={status:'ready',generatedAt:new Date(now).toISOString(),publicationVersion:'e-'+'a'.repeat(24)};
 const run=body=>core.probe(async(url,options)=>{
  assert.equal(options.redirect,'manual');assert.ok(options.signal);
  return url.endsWith('/readyz')?Response.json(body):new Response(null,{status:200});
 },now);
 assert.ok((await run(valid)).every(c=>c.ok));
 assert.equal((await run({...valid,generatedAt:new Date(now-2700001).toISOString()}))[1].ok,false);
 assert.equal((await run({...valid,generatedAt:'invalid'}))[1].ok,false);
 assert.equal((await run({...valid,generatedAt:new Date(now+120000).toISOString()}))[1].ok,false);
 assert.ok((await core.probe(async()=>new Response(null,{status:302}))).every(c=>!c.ok));
 assert.ok((await core.probe(async()=>{throw Error('private upstream details');})).every(c=>!c.ok&&!c.detail.includes('private')));
 assert.equal((await core.probe(async()=>new Response('not json')))[1].ok,false);
});
test('persisted monitor retries failed emails, deduplicates ticks, and survives object recreation',async()=>{
 const data=new Map(),emails=[];let failMail=false,down=true;
 const storage={get:async key=>structuredClone(data.get(key)),put:async(key,value)=>data.set(key,structuredClone(value))};
 const env={ALERT_TO:'ops@example.com',ALERT_FROM:'alerts@example.com',EMAIL:{send:async message=>{if(failMail)throw Error('mail unavailable');emails.push(message);}}};
 const originalFetch=globalThis.fetch,originalNow=Date.now;
 let now=Math.floor(Date.now()/300000)*300000;
 Date.now=()=>now;
 globalThis.fetch=async url=>url.endsWith('/readyz')?(down?new Response(null,{status:503}):Response.json({status:'ready',generatedAt:new Date(now).toISOString(),publicationVersion:'e-'+'b'.repeat(24)})):new Response(null,{status:200});
 let monitor=new SiteMonitor({storage},env);
 const tick=()=>monitor.fetch(new Request('https://internal/tick',{method:'POST',body:JSON.stringify({scheduledTime:now})}));
 try{
  await tick();assert.equal(emails.length,0);
  now+=300000;failMail=true;await assert.rejects(tick,/Monitor email failed/);assert.equal(data.get('state').emailFailed,true);assert.equal(data.get('state').alerted,false);
  now+=300000;failMail=false;monitor=new SiteMonitor({storage},env);await Promise.all([tick(),tick()]);assert.equal(emails.length,1);assert.match(emails[0].subject,/failure/);
  now+=300000;await tick();assert.equal(emails.length,1);
  now+=300000;down=false;failMail=true;await assert.rejects(tick);assert.equal(data.get('state').alerted,true);
  now+=300000;failMail=false;await tick();assert.equal(emails.length,2);assert.match(emails[1].subject,/Recovered/);
  now+=300000;await tick();assert.equal(emails.length,2);assert.equal(data.get('state').alerted,false);
  assert.equal(worker.fetch(new Request('https://public/tick')).status,404);
 }finally{globalThis.fetch=originalFetch;Date.now=originalNow;}
});
test('monitor has isolated SQLite state, no public route, a read-only observer and five-minute cron',()=>{
 const config=JSON.parse(fs.readFileSync('wrangler.monitor.jsonc','utf8'));
 assert.equal(config.name,'hacker-times-monitor');assert.equal(config.workers_dev,false);assert.equal(config.preview_urls,false);
 assert.deepEqual(config.triggers.crons,['2-57/5 * * * *']);assert.equal(config.routes,undefined);
 assert.deepEqual(config.durable_objects.bindings,[{name:'MONITOR',class_name:'SiteMonitor'}]);
 assert.deepEqual(config.services,[{binding:'PUBLISHER_RECOVERY',service:'hacker-times-production',entrypoint:'PublisherRecoveryObserver'}]);
 assert.deepEqual(config.migrations,[{tag:'monitor-v1',new_sqlite_classes:['SiteMonitor']}]);
 assert.equal(config.vars.ALERT_TO,undefined,'recipient must not be in public source');
});

test('publisher recovery emails retry on delivery errors and confirm only a fresh replacement visible on the homepage',async()=>{
 const data=new Map(),emails=[],storage={get:async key=>structuredClone(data.get(key)),put:async(key,value)=>data.set(key,structuredClone(value))};
 const originalFetch=globalThis.fetch,originalNow=Date.now;
 let now=Math.floor(Date.now()/300000)*300000,mailFails=false,ready=false;
 const at=new Date(now-49*3600_000).toISOString(),base='e-'+'a'.repeat(24),replacement='e-'+'b'.repeat(24);
 let homepage=base,readinessVersion=base,generatedAt=new Date(now-49*3600_000).toISOString();
 let status={candidate:null,safetyHoldAt:null,recovery:null};
 const env={ALERT_TO:'ops@example.com',ALERT_FROM:'alerts@example.com',PUBLISHER_RECOVERY:{read:async()=>status},EMAIL:{send:async message=>{
  if(mailFails)throw Error('fictional temporary delivery failure');
  emails.push(message);
 }}};
 let monitor=new SiteMonitor({storage},env);
 const tick=()=>monitor.fetch(new Request('https://internal/tick',{method:'POST',body:JSON.stringify({scheduledTime:now})}));
 const advance=()=>{now+=300_000;return tick();};
 Date.now=()=>now;
 globalThis.fetch=async url=>url.endsWith('/readyz')?(ready?Response.json({status:'ready',generatedAt,publicationVersion:readinessVersion}):new Response(null,{status:503})):
  new Response(null,{status:200,headers:{'X-Edition-Version':homepage}});
 try{
  await tick();assert.equal(emails.length,0);
  status={...status,candidate:{generatedAt:at,basePublicationVersion:base,baseRevision:8}};
  mailFails=true;await assert.rejects(advance,/Monitor email failed/);
  assert.equal(data.get('state').publisherMail,undefined);
  mailFails=false;monitor=new SiteMonitor({storage},env);await advance();await advance();
  assert.equal(emails.length,1);
  assert.match(emails[0].subject,/Action needed: recover/);
  assert.match(emails[0].html,/href="https:\/\/github\.com\/palpen\/hacker-times-public\/actions\/workflows\/recover-expired-edition\.yml"/);
  assert.match(emails[0].text,/Run workflow/);
  assert.ok(!emails[0].text.includes(at));assert.ok(!emails[0].html.includes(base));
  status={...status,candidate:null,recovery:{id:at,replacement:null}};
  await advance();assert.equal(emails.length,1,'queueing recovery does not confirm publication');
  generatedAt=new Date(now).toISOString();
  status={...status,recovery:{id:at,replacement:{version:replacement,generatedAt}}};
  ready=true;readinessVersion=replacement;
  await advance();assert.equal(emails.length,1,'a fresh readiness response alone does not prove the homepage serves the replacement');
  homepage=replacement;mailFails=true;
  await assert.rejects(advance,/Monitor email failed/);
  mailFails=false;monitor=new SiteMonitor({storage},env);await advance();await advance();
  assert.equal(emails.length,2);
  assert.match(emails[1].subject,/a fresh edition is live/);
  assert.match(emails[1].text,/https:\/\/hackertimes\.ca\//);
  assert.equal(data.get('state').publisherMail.replacement,at);
  assert.equal(data.get('state').publisherRecoveryConnected,true);
 }finally{globalThis.fetch=originalFetch;Date.now=originalNow;}
});

test('publisher safety hold sends one review email and withholds the recovery link',async()=>{
 const data=new Map(),emails=[],storage={get:async key=>structuredClone(data.get(key)),put:async(key,value)=>data.set(key,structuredClone(value))};
 const originalFetch=globalThis.fetch,originalNow=Date.now;
 let now=Math.floor(Date.now()/300000)*300000;
 const hold=new Date(now).toISOString(),version='e-'+'b'.repeat(24);
 const env={ALERT_TO:'ops@example.com',ALERT_FROM:'alerts@example.com',PUBLISHER_RECOVERY:{read:async()=>({candidate:null,safetyHoldAt:hold,recovery:null})},EMAIL:{send:async message=>emails.push(message)}};
 const monitor=new SiteMonitor({storage},env);
 Date.now=()=>now;
 globalThis.fetch=async url=>url.endsWith('/readyz')?Response.json({status:'ready',generatedAt:new Date(now).toISOString(),publicationVersion:version}):new Response(null,{status:200});
 try{
  for(let i=0;i<3;i++){
   await monitor.fetch(new Request('https://internal/tick',{method:'POST',body:JSON.stringify({scheduledTime:now})}));
   now+=300_000;
  }
  assert.equal(emails.length,1);
  assert.match(emails[0].subject,/Action needed: publisher safety hold/);
  assert.ok(!emails[0].text.includes('recover-expired-edition.yml'));
 }finally{globalThis.fetch=originalFetch;Date.now=originalNow;}
});
