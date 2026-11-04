import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ht-edition-time-'));
try{
 async function mod(name){const file=path.join(tmp,name+'.mjs');await build({entryPoints:['lib/'+name+'.ts'],bundle:true,platform:'node',format:'esm',loader:{'.html':'text','.md':'text'},outfile:file});return import(pathToFileURL(file));}
 const {editionUpdateTime}=await mod('edition-time');
 const winter='2026-11-02T14:08:10.852Z';
 assert.deepEqual(editionUpdateTime(winter),{dateTime:winter,label:'November 2, 2026 at 9:08 AM EST'});
 assert.equal(editionUpdateTime('2026-07-02T14:08:10.852Z').label,'July 2, 2026 at 10:08 AM EDT');
 assert.equal(editionUpdateTime('2026-01-01T00:05:00.000Z').label,'December 31, 2025 at 7:05 PM EST');
 assert.equal(editionUpdateTime('2026-11-01T05:30:00.000Z').label,'November 1, 2026 at 1:30 AM EDT');
 assert.equal(editionUpdateTime('2026-11-01T06:30:00.000Z').label,'November 1, 2026 at 1:30 AM EST');
 for(const value of ['', 'not-a-date'])assert.deepEqual(editionUpdateTime(value),{label:'Unavailable'});
 const formatter=Intl.DateTimeFormat;
 try{Intl.DateTimeFormat=function(){throw Error('Timezone data unavailable')};assert.deepEqual(editionUpdateTime(winter),{dateTime:winter,label:'Mon, 02 Nov 2026 14:08:10 UTC'});}finally{Intl.DateTimeFormat=formatter;}
 const {renderEdition}=await mod('render-edition');
 const seed=JSON.parse(fs.readFileSync('data/published-seed.json'));
 const edition={...seed,generatedAt:winter,editionDate:'2026-11-02'};
 const update=html=>html.match(/<span class="desktop-date edition-update"[^>]*>.*?<\/span>/)[0];
 const expected=update(renderEdition(edition,'before'));
 assert.ok(expected.includes('Last update: <time datetime="'+winter+'">November 2, 2026 at 9:08 AM EST</time>'));
 assert.equal((renderEdition(edition,'before').match(/class="desktop-date edition-update"/g)||[]).length,1);
 assert.ok(!expected.includes('hidden'));
 const html=renderEdition(edition,'before');assert.ok(html.indexOf(expected)>html.indexOf('<header'));assert.ok(html.indexOf(expected)<html.indexOf('</header>'));assert.ok(!html.slice(html.indexOf('<footer')).includes('Last update:'));
 assert.ok(!html.includes('<span class="desktop-date">'));
 const now=Date.now;
 try{Date.now=()=>Date.parse('2030-01-01T00:00:00Z');assert.equal(update(renderEdition(edition,'later-build')),expected);}finally{Date.now=now;}
 assert.ok(update(renderEdition({...edition,generatedAt:'invalid'},'invalid')).endsWith('Last update: Unavailable</span>'));
 const publication=await mod('publication');const {editorCall}=await mod('editor');
 const data=new Map();let fail=false,serial=0;
 const env={HACKER_TIMES_OWNER_EMAIL:'owner@example.com',HACKER_TIMES_EDITOR_MUTATIONS_ENABLED:'true',BUCKET:{get:async key=>{const v=data.get(key);return v?{etag:v.etag,json:async()=>JSON.parse(v.text)}:null},put:async(key,text,options={})=>{if(fail&&key===publication.PUBLICATION_KEY)throw Error('injected failed batch');const old=data.get(key);if(options.onlyIf&&(options.onlyIf.etagMatches&&options.onlyIf.etagMatches!==old?.etag||options.onlyIf.etagDoesNotMatch==='*'&&old))return null;const v={text,etag:String(++serial)};data.set(key,v);return v},list:async()=>({objects:[]})}};
 const request=new Request('https://site.example/mcp',{headers:{'oai-authenticated-user-id':'owner-site-id','oai-authenticated-user-email':'owner@example.com'}});
 await publication.publishEdition(request,env,edition);
 const later={...edition,generatedAt:'2026-11-03T16:21:00.000Z',editionDate:'2026-11-03'};
 fail=true;await assert.rejects(()=>publication.publishEdition(request,env,later),/failed batch/);fail=false;
 let current=(await publication.readPublication(request,env,true)).publication.current;
 assert.equal(current.edition.generatedAt,winter);assert.equal(update(current.html),expected);
 const rebuilt=await editorCall('rebuild_edition',{},request,env);
 assert.equal(rebuilt.generatedAt,winter);current=(await publication.readPublication(request,env,true)).publication.current;assert.equal(update(current.html),expected);
 await publication.publishEdition(request,env,later);
 const archive=await publication.readArchive(request,env,'2026-11-02');assert.equal(archive.edition.generatedAt,winter);assert.equal(update(archive.html),expected);
 current=(await publication.readPublication(request,env,true)).publication.current;assert.ok(update(current.html).includes('November 3, 2026 at 11:21 AM EST'));
 const css=fs.readFileSync('app/globals.css','utf8');assert.match(css,/\.edition-update\{[^}]*font-size:12px[^}]*color:var\(--muted\)[^}]*overflow-wrap:anywhere/);
 assert.match(css,/@media\(max-width:680px\)\{\.masthead\{display:grid;grid-template-columns:minmax\(0,1fr\);row-gap:8px/);
 assert.match(css,/\.masthead \.edition-update\{grid-row:2;max-width:none/);
 console.log('PASS: visible semantic edition timestamp; Toronto EST/EDT and date rollover; invalid/UTC fallback; visit/build/rebuild never advance freshness; failed batch retains timestamp; archives retain their own timestamp; single responsive masthead timestamp, no duplicate footer.');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
