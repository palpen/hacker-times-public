import assert from 'node:assert/strict';import {build} from 'esbuild';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ht-highlights-'));
try{
 const entry=path.join(tmp,'entry.ts');fs.writeFileSync(entry,['discussion-highlights','collect-discussion-highlights','discussion-markup','render-edition','editor','publication'].map(n=>`export * from '${process.cwd()}/lib/${n}.ts';`).join('\n'));
 const out=path.join(tmp,'test.mjs');await build({entryPoints:[entry],bundle:true,platform:'node',format:'esm',loader:{'.html':'text','.md':'text'},outfile:out});const api=await import(pathToFileURL(out));
 const seed=JSON.parse(fs.readFileSync('data/published-seed.json')),at=Date.now(),edition={...seed,generatedAt:new Date(at).toISOString()},ids=api.discussionStoryIds(edition),base='e-123456789012345678901234';
 const prose='Reliable software needs clear boundaries and useful tests so that people can safely change one part without breaking everything else. More context is available in this discussion.';
 assert.deepEqual(api.commentExcerpt('One &amp; two people can <em>share</em> an idea that makes a difficult technical problem much easier to understand.'),{excerpt:'One & two people can share an idea that makes a difficult technical problem much easier to understand.',truncated:false});
 assert.equal(api.commentExcerpt('Thanks!'),null);for(const opening of ['<blockquote>','<i>','<p><em>','<p class=quote><i>','<pre>','<p><code>'])assert.equal(api.commentExcerpt(opening+prose),null,'opening quoted/code markup is not attributed to the commenter');assert.equal(api.commentExcerpt('<script>alert(1)</script>'+prose),null);assert.equal(api.commentExcerpt('&gt; '+prose),null);assert.equal(api.commentExcerpt(prose+'\u202e'),null);
 const excerpt=api.commentExcerpt(prose);assert.ok(excerpt.excerpt.split(/\s+/).length<=25);assert.ok(prose.startsWith(excerpt.excerpt));assert.equal(excerpt.truncated,true);assert.equal(api.commentExcerpt('verylongword'.repeat(100)),null);
 // v3 fills the unchanged cap with exact next words instead of stopping early
 // at a substantial first sentence. No paraphrasing or joined omissions.
 assert.equal(api.HIGHLIGHT_POLICY,'hn-top-level-display-order-v3');
 assert.deepEqual(api.HIGHLIGHT_LIMITS,{stories:42,items:16,requests:144,children:5,concurrency:4,itemBytes:100_000,itemMs:3_000,totalMs:18_000,words:25,characters:240,snapshotBytes:24_000});
 const opening='The first twelve words provide enough context for this ordinary technical observation.';
 assert.equal(opening.split(' ').length,12);
 const continued=opening+' The next sentence supplies more original words without changing what the source actually says.';
 assert.deepEqual(api.commentExcerpt(continued),{excerpt:continued.split(' ').slice(0,25).join(' '),truncated:true});
 assert.deepEqual(api.commentExcerpt(opening),{excerpt:opening,truncated:false});
 const normalized='One & two people can share an idea that makes a difficult technical problem much easier to understand. Another paragraph preserves every original word.';
 const html='  One &amp; two\tpeople can <em>share</em> an idea that makes a difficult technical problem much easier to understand.<p>Another&nbsp;paragraph preserves every original word.';
 assert.deepEqual(api.commentExcerpt(html),{excerpt:normalized,truncated:false});
 for(const boundary of ['<blockquote>','< BLOCKQUOTE class="quote > text">','<pre>','<code>','<p><i>','<p><em>','<p><strong><em>','<p>&gt; ','<p>&quot;','<p>&#x201c;','<p>\'','<p>‘','<p>`','<p><strong>&gt;</strong> ','<br>&gt; ','\n\n> ']){
  assert.deepEqual(api.commentExcerpt(opening+' '+boundary+prose+'</blockquote></pre></code></em></i></strong><p>Do not join this later text.'),{excerpt:opening,truncated:true},'stop before interior quote/code boundary '+boundary);
  assert.equal(api.commentExcerpt('Too little context. '+boundary+prose),null,'reject insufficient prefix before '+boundary);
 }
 for(const boundary of ['<blockquote></blockquote>','<code></code>','<p><em></em>','<p>&gt;'])assert.deepEqual(api.commentExcerpt(opening+boundary),{excerpt:opening,truncated:true},'boundary still marks omitted material');
 for(const leading of ['<strong><em>','<p><b><i>','<p><strong>&gt;</strong> ','<p>&quot;','<p>&#34;','<p>`','<p>‘'])assert.equal(api.commentExcerpt(leading+prose),null,'nested/literal leading quote/code rejected');
 assert.deepEqual(api.commentExcerpt(opening+' <p>'+opening),{excerpt:opening+' '+opening,truncated:false},'ordinary paragraphs remain a contiguous prefix');
 assert.equal(api.commentExcerpt(opening+' <a title="unfinished'),null,'unterminated tags fail closed');
 assert.equal(api.commentExcerpt(opening+' <!-- unfinished'),null,'unterminated comments fail closed');
 for(const bad of ['\x01','&#1;','&#x7f;','<style>hidden</style>','<iframe>hidden</iframe>','<svg>hidden</svg>','<textarea>hidden</textarea>'])assert.equal(api.commentExcerpt(opening+bad+prose),null,'never join text across dropped material');
 assert.equal(api.commentExcerpt('<strong>'.repeat(20)+prose+'</strong>'.repeat(20)),null,'parser depth truncation rejected');
 assert.equal(api.commentExcerpt(prose+'<br>'.repeat(2001)),null,'parser token truncation rejected');
 assert.equal(api.commentExcerpt(prose+' '.repeat(20_001)),null,'input text bound unchanged');
 const longWords=Array.from({length:30},(_,i)=>'careful'+i.toString().padStart(8,'0')).join(' '),longExcerpt=api.commentExcerpt(longWords);
 assert.equal(longExcerpt.excerpt,longWords.split(' ').slice(0,15).join(' '));assert.equal(longExcerpt.excerpt.length,239);assert.equal(longExcerpt.truncated,true);
 const unicode=Array.from({length:30},()=> '界😀é').join(' '),unicodeExcerpt=api.commentExcerpt(unicode);
 assert.equal(unicodeExcerpt.excerpt,unicode.split(' ').slice(0,25).join(' '));assert.equal(unicodeExcerpt.truncated,true);assert.ok(Buffer.byteLength(unicodeExcerpt.excerpt)>unicodeExcerpt.excerpt.length);
 const beforeCollection=JSON.stringify(edition);const calls=[];let active=0,maximum=0;
 const fixture=new Map();ids.forEach((id,i)=>{fixture.set(id,{id,type:'story',title:'Fixture thread '+id,url:'https://example.com/'+id,time:Math.floor(at/1000)-100,descendants:10,kids:[100000+i*10,100001+i*10,100002+i*10,100003+i*10,100004+i*10,100005+i*10]});fixture.set(100000+i*10,{id:100000+i*10,type:'comment',parent:id,dead:true,text:prose});fixture.set(100001+i*10,{id:100001+i*10,type:'comment',parent:id+1,by:'WrongParent',time:1,text:prose});fixture.set(100002+i*10,{id:100002+i*10,type:'comment',parent:id,by:'Reader_'+i,time:Math.floor(at/1000)-20,text:prose,score:999999});});
 const fetcher=async(url,options)=>{calls.push(url);assert.match(url,/^https:\/\/hacker-news\.firebaseio\.com\/v0\/item\/[1-9]\d*\.json$/);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'manual');assert.deepEqual(options.headers,{Accept:'application/json'});active++;maximum=Math.max(maximum,active);await new Promise(r=>setTimeout(r,1));active--;return Response.json(fixture.get(Number(url.match(/(\d+)\.json$/)[1]))??null);};
 const snapshot=await api.collectDiscussionHighlights(edition,base,{fetcher,now:()=>at});assert.equal(snapshot.status,'complete');assert.equal(snapshot.items.length,16);assert.ok(maximum<=4);assert.equal(calls.length,64);assert.deepEqual(snapshot.items.map(x=>x.storyId),ids.slice(0,16));assert.ok(snapshot.items.every(x=>x.hnPosition===3&&!('score'in x)));assert.equal(api.validDiscussionSnapshot(snapshot,edition,base),true);
 assert.equal(api.validDiscussionSnapshot({...snapshot,basePublicationVersion:'wrong'},edition),false);assert.equal(api.validDiscussionSnapshot({...snapshot,status:'partial',unavailableStoryIds:[ids[0]]},edition,base),false);assert.equal(api.validDiscussionSnapshot({...snapshot,items:[{...snapshot.items[0],retrievedAt:new Date(at-1000).toISOString()}]},edition,base),false);assert.equal(api.validDiscussionSnapshot({...snapshot,collectedAt:new Date(at-1000).toISOString()},edition,base),false);assert.equal(api.validDiscussionSnapshot({...snapshot,items:[{...snapshot.items[0],score:1}]},edition,base),false);assert.equal(api.validDiscussionSnapshot({...snapshot,items:[{...snapshot.items[0],excerpt:'x\u202e'}]},edition,base),false);

 // Broadens only the comment pool: original discussion order leads, then existing
 // articles. At most42 candidate articles and16 different source articles.
 assert.equal(ids.length,Math.min(42,edition.stories.length));assert.deepEqual(ids.slice(0,6),edition.stories.filter(s=>s.placement==='discussion').map(s=>s.id));
 assert.equal(new Set(snapshot.items.map(x=>x.storyId)).size,16);
 const aliases={...edition,stories:[
  {id:1,url:'http://www.example.com/a/?utm_source=hn',placement:'discussion',comments:1},
  {id:2,url:'https://example.com/a#section',placement:'discussion',comments:1},
  {id:3,url:'https://example.com/a',placement:'discussion',comments:1},
  {id:4,url:'https://example.com/b',placement:'section',comments:1},
  {id:5,url:'https://other.example/a',placement:'section',comments:1},
  {id:6,url:'https://example.com/a?part=2',placement:'section',comments:1}
 ]};
 assert.deepEqual(api.discussionStoryIds(aliases),[1,4,5,6],'v3 retains deduplication without merging distinct paths/domains/meaningful queries');
 assert.deepEqual(api.discussionStoryIds(aliases,api.V2_HIGHLIGHT_POLICY),[1,4,5,6],'v2 article binding remains unchanged');
 assert.deepEqual(api.discussionStoryIds(aliases,api.LEGACY_HIGHLIGHT_POLICY),[1,2,3],'v1 record binding remains unchanged');
 const legacyIds=api.discussionStoryIds(edition,api.LEGACY_HIGHLIGHT_POLICY),legacy={...snapshot,policy:api.LEGACY_HIGHLIGHT_POLICY,storyIds:legacyIds,items:snapshot.items.slice(0,6)};
 assert.equal(api.validDiscussionSnapshot(legacy,edition,base),true,'v1 frozen editions remain supported');assert.equal((api.renderDiscussionHighlights({...edition,discussionHighlights:legacy}).match(/data-highlight-page /g)||[]).length,3,'v1 six-comment snapshot renders three distinct-article pages');
 const v2={...snapshot,policy:api.V2_HIGHLIGHT_POLICY,items:snapshot.items.map(h=>({...h,excerpt:opening,truncated:true}))};
 const frozenV1=JSON.stringify(legacy),frozenV2=JSON.stringify(v2);
 assert.equal(api.validDiscussionSnapshot(v2,edition,base),true,'v2 frozen editions remain supported');
 assert.equal((api.renderDiscussionHighlights({...edition,discussionHighlights:v2}).match(/data-highlight-page /g)||[]).length,8);
 assert.equal(JSON.stringify(legacy),frozenV1);assert.equal(JSON.stringify(v2),frozenV2,'rendering does not extend frozen v2 text');
 for(const frozen of [legacy,v2,snapshot]){
  assert.equal(api.validDiscussionSnapshot({...frozen,items:[{...frozen.items[0],excerpt:Array(26).fill('word').join(' ')}]},edition,base),false,'all policies retain the 25-word bound');
  assert.equal(api.validDiscussionSnapshot({...frozen,items:[{...frozen.items[0],excerpt:'x'.repeat(241)}]},edition,base),false,'all policies retain the 240-character bound');
 }
 assert.equal(api.validDiscussionSnapshot({...legacy,items:snapshot.items.slice(0,7)},edition,base),false,'v1 remains limited to six');
 assert.equal(api.validDiscussionSnapshot({...snapshot,policy:'unknown'},edition,base),false);
 assert.equal(api.validDiscussionSnapshot({...snapshot,items:[...snapshot.items,snapshot.items[0]]},edition,base),false);
 const fifteen=await api.collectDiscussionHighlights(edition,base,{fetcher:async(url,options)=>{const id=Number(url.match(/(\d+)\.json$/)[1]);return ids.indexOf(id)>=15?Response.json({id,type:'story',kids:[]}):fetcher(url,options);},now:()=>at});
 assert.equal(fifteen.status,'complete');assert.equal(fifteen.items.length,15,'do not invent a16th when only15 qualify');
 assert.equal(beforeCollection,JSON.stringify(edition),'selection is not mutated by collection');
 // An unavailable earlier ranked comment skips that story, never promotes a lower unknown rank.
 const partial=await api.collectDiscussionHighlights(edition,base,{fetcher:async(url,options)=>Number(url.match(/(\d+)\.json$/)[1])===100000?new Response('',{status:503}):fetcher(url,options),now:()=>at});assert.equal(partial.status,'partial');assert.equal(partial.items.length,16);assert.deepEqual(partial.unavailableStoryIds,[ids[0]]);
 const failed=await api.collectDiscussionHighlights(edition,base,{fetcher:async()=>{throw Error('offline');},now:()=>at});assert.equal(failed.status,'unavailable');assert.deepEqual(failed.items,[]);assert.equal(api.renderDiscussionHighlights({...edition,discussionHighlights:failed}),'');
 // All candidate comments are bounded even if none qualifies, and malicious source types/redirects are ignored.
 let bounded=0;await api.collectDiscussionHighlights(edition,base,{fetcher:async url=>{bounded++;const id=Number(url.match(/(\d+)\.json$/)[1]);return Response.json(ids.includes(id)?{id,type:'story',kids:Array.from({length:999},(_,i)=>id+1+i)}:{id,type:'comment',text:'Thanks'});}});assert.ok(bounded<=144);
 // All42 candidates are reachable; the global144 request cap wins even when
 // each parent has five rejected candidates. A late-only valid comment is kept.
 const large={...edition,stories:Array.from({length:42},(_,i)=>({...edition.stories[0],id:9000000+i,url:'https://example.org/article/'+i,placement:i<6?'discussion':'section',comments:10}))};
 let allReads=0;const largeIds=api.discussionStoryIds(large);
 const exhausted=await api.collectDiscussionHighlights(large,base,{fetcher:async url=>{allReads++;const id=Number(url.match(/(\d+)\.json$/)[1]);return Response.json(largeIds.includes(id)?{id,type:'story',kids:Array.from({length:5},(_,i)=>id*10+i)}:{id,type:'comment',text:'Thanks'});},now:()=>at});
 assert.equal(largeIds.length,42);assert.equal(allReads,144);assert.equal(exhausted.status,'partial');assert.equal(exhausted.items.length,0);assert.ok(exhausted.unavailableStoryIds.length>0);
 let lateReads=0;const late=largeIds[40];const lateSnapshot=await api.collectDiscussionHighlights(large,base,{fetcher:async url=>{lateReads++;const id=Number(url.match(/(\d+)\.json$/)[1]);return Response.json(largeIds.includes(id)?{id,type:'story',kids:id===late?[late*10]:[]}:{id,type:'comment',parent:late,by:'LateReader',time:Math.floor(at/1000)-20,text:prose});},now:()=>at});
 assert.equal(lateReads,43);assert.equal(lateSnapshot.status,'complete');assert.deepEqual(lateSnapshot.items.map(i=>i.storyId),[late]);
 const redirect=await api.collectDiscussionHighlights(edition,base,{fetcher:async()=>new Response('',{status:302,headers:{location:'https://evil.example/'}}),now:()=>at});assert.equal(redirect.status,'unavailable');
 const oversized=await api.collectDiscussionHighlights(edition,base,{fetcher:async()=>new Response('x'.repeat(100001),{headers:{'content-type':'application/json'}}),now:()=>at});assert.equal(oversized.status,'unavailable');
 // A hung upstream cannot outlive the bounded collection, even when it ignores abort.
 const oldSetTimeout=globalThis.setTimeout,oldClearTimeout=globalThis.clearTimeout,timers=new Map(),signals=[];let timerSequence=0;
 try{globalThis.setTimeout=(fn,delay)=>{const key=++timerSequence;timers.set(key,{fn,delay});return key;};globalThis.clearTimeout=key=>timers.delete(key);
  const hanging=api.collectDiscussionHighlights(edition,base,{fetcher:async(_url,options)=>{signals.push(options.signal);return new Promise(()=>{});},now:()=>at});
  await Promise.resolve();assert.equal(signals.length,4);assert.equal([...timers.values()].filter(x=>x.delay===18000).length,1);assert.ok([...timers.values()].every(x=>x.delay<=18000));
  const scheduled=[...timers.values()];scheduled.find(x=>x.delay===18000).fn();for(const timer of scheduled.filter(x=>x.delay!==18000))timer.fn();
  const timed=await hanging;assert.equal(timed.status,'unavailable');assert.equal(timed.items.length,0);assert.equal(signals.length,4,'no queued reads start after whole-collection deadline');assert.ok(signals.every(signal=>signal.aborted));assert.equal(timers.size,0);
 }finally{globalThis.setTimeout=oldSetTimeout;globalThis.clearTimeout=oldClearTimeout;}
 // Write-once cache: same source/base/IDs reuses exact provenance even when the upstream changes.
 let writes=0,collections=0;const store=new Map();const bucket={get:async k=>store.has(k)?{size:Buffer.byteLength(store.get(k)),json:async()=>JSON.parse(store.get(k))}:null,put:async(k,v,o)=>{assert.equal(o.onlyIf.etagDoesNotMatch,'*');if(store.has(k))return null;writes++;store.set(k,v);return {};}};
 const collect=async()=>{collections++;return snapshot;};assert.deepEqual(await api.prepareDiscussionHighlights(bucket,edition,base,collect),snapshot);assert.deepEqual(await api.prepareDiscussionHighlights(bucket,edition,base,async()=>{throw Error('must not collect again');}),snapshot);assert.equal(writes,1);assert.equal(collections,1);
 const key=await api.discussionSnapshotKey(edition,base);assert.match(key,/^discussion-snapshots\/v3\/[a-f0-9]{64}\.json$/);assert.notEqual(key,await api.discussionSnapshotKey(edition,base+'1'));assert.notEqual(key,await api.discussionSnapshotKey({...edition,stories:edition.stories.filter(s=>s.id!==ids[0])},base));
 // New policy pins a separate object, never reusing or replacing old side data.
 const priorKeys=[];
 for(const frozen of [legacy,v2]){
  const version=frozen.policy.endsWith('v1')?'v1':'v2',binding=JSON.stringify([frozen.policy,edition.generatedAt,base,frozen.storyIds]);
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(binding)),oldKey='discussion-snapshots/'+version+'/'+Buffer.from(digest).toString('hex')+'.json';
  priorKeys.push(oldKey);store.set(oldKey,JSON.stringify(frozen));assert.notEqual(oldKey,key);
 }
 store.delete(key);const priorWrites=writes;assert.deepEqual(await api.prepareDiscussionHighlights(bucket,edition,base,collect),snapshot);assert.equal(writes,priorWrites+1);
 assert.equal(store.get(priorKeys[0]),frozenV1);assert.equal(store.get(priorKeys[1]),frozenV2);
 store.set(key,JSON.stringify(v2));await assert.rejects(()=>api.prepareDiscussionHighlights(bucket,edition,base,collect),/Invalid saved/);store.set(key,JSON.stringify(snapshot));
 const corrupted=JSON.stringify({...snapshot,storyIds:[1]});store.set(key,corrupted);await assert.rejects(()=>api.prepareDiscussionHighlights(bucket,edition,base,collect),/Invalid saved/);store.set(key,JSON.stringify(snapshot));
 const winner={...snapshot,collectedAt:new Date(at+1000).toISOString()};let raced=false;const raceBucket={get:async()=>raced?{size:100,json:async()=>winner}:null,put:async()=>{raced=true;return null;}};assert.deepEqual(await api.prepareDiscussionHighlights(raceBucket,edition,base,collect),winner);
 let invalidWrites=0;const noWrite={get:async()=>null,put:async()=>{invalidWrites++;return {};}};
 await assert.rejects(()=>api.prepareDiscussionHighlights(noWrite,edition,base,async()=>({...snapshot,policy:'unknown'})),/Invalid collected/);
 await assert.rejects(()=>api.prepareDiscussionHighlights(noWrite,edition,base,async()=>v2),/Invalid collected/);
 // Extra fields are compatible with the validator, so guard serialized bytes
 // before put. Unicode can exceed 24KB while JS string length stays below it.
 const oversize={...snapshot,extra:'界'.repeat(8000)},oversizeJson=JSON.stringify(oversize);
 assert.equal(api.validDiscussionSnapshot(oversize,edition,base),true);assert.ok(oversizeJson.length<24_000);assert.ok(Buffer.byteLength(oversizeJson)>24_000);
 await assert.rejects(()=>api.prepareDiscussionHighlights(noWrite,edition,base,async()=>oversize),/exceeds supported size/);assert.equal(invalidWrites,0,'oversize and invalid snapshots never reach put');
 const padded={...snapshot,extra:''};padded.extra='x'.repeat(24_000-Buffer.byteLength(JSON.stringify(padded)));
 assert.equal(Buffer.byteLength(JSON.stringify(padded)),24_000);await api.prepareDiscussionHighlights(noWrite,edition,base,async()=>padded);assert.equal(invalidWrites,1,'exact byte bound accepted');
 padded.extra+='x';await assert.rejects(()=>api.prepareDiscussionHighlights(noWrite,edition,base,async()=>padded),/exceeds supported size/);assert.equal(invalidWrites,1,'one extra byte never reaches put');
 await assert.rejects(()=>api.prepareDiscussionHighlights({get:async()=>({size:24_001,json:async()=>{throw Error('must not parse oversized record');}})},edition,base,collect),/exceeds supported size/);
 let failedWrites=0;const transient={get:async()=>null,put:async()=>{failedWrites++;if(failedWrites===1)throw Error('Injected snapshot write failure');return {};}};
 await assert.rejects(()=>api.prepareDiscussionHighlights(transient,edition,base,collect),/Injected snapshot write failure/);assert.deepEqual(await api.prepareDiscussionHighlights(transient,edition,base,collect),snapshot);assert.equal(failedWrites,2);
 await assert.rejects(()=>api.prepareDiscussionHighlights({get:async()=>null,put:async()=>null},edition,base,collect),/could not be pinned/);
 // Exact links and escaping, no raw comment HTML or score claims. Legacy remains unchanged.
 const rendered=api.renderEdition({...edition,discussionHighlights:snapshot},'test');assert.ok(rendered.includes('What People Are Talking About'));assert.ok(!rendered.includes('The conversation'));assert.equal((rendered.match(/data-highlight-slide/g)||[]).length,16);for(const h of snapshot.items){assert.ok(rendered.includes('https://news.ycombinator.com/item?id='+h.commentId));assert.ok(rendered.includes('>'+h.author+'</a>'));}assert.equal((rendered.match(/data-highlight-page /g)||[]).length,8);assert.ok(!rendered.includes('Top-level comments selected'));assert.ok(!rendered.includes('data-highlight-toggle'));assert.ok(!rendered.includes('data-highlight-position'));assert.ok(!rendered.includes('999999'));assert.ok(rendered.indexOf('id="discussion-highlights"')<rendered.indexOf('class="topic-desk"'));assert.ok(api.renderEdition(edition,'test').includes('The conversation'));
 const escaped=api.renderDiscussionHighlights({...edition,stories:edition.stories.map(s=>({...s,headline:'<img src=x onerror=evil()> & title'})),discussionHighlights:{...snapshot,items:[{...snapshot.items[0],excerpt:'<img src=x onerror=evil()> A safely escaped test excerpt with enough words to render.'}]}});assert.ok(escaped.includes('&lt;img'));assert.ok(!escaped.includes('<img'));
 const one={...snapshot,items:snapshot.items.slice(0,1)};assert.equal((api.renderDiscussionHighlights({...edition,discussionHighlights:one}).match(/data-highlight-slide/g)||[]).length,1);
 // Real editor path ignores malicious client highlight data; freezes snapshots for retries/rebuilds/archives.
 let sequence=0,reads=0,failCommit=false;const objects=new Map();const env={HACKER_TIMES_OWNER_EMAIL:'owner@example.com',HACKER_TIMES_EDITOR_MUTATIONS_ENABLED:'true',BUCKET:{get:async k=>{const o=objects.get(k);return o?{etag:o.etag,size:Buffer.byteLength(o.text),json:async()=>JSON.parse(o.text)}:null},put:async(k,text,opts={})=>{if(failCommit&&k===api.PUBLICATION_KEY)throw Error('Injected root failure');const old=objects.get(k);if(opts.onlyIf&&(opts.onlyIf.etagMatches&&opts.onlyIf.etagMatches!==old?.etag||opts.onlyIf.etagDoesNotMatch==='*'&&old))return null;const o={text,etag:String(++sequence)};objects.set(k,o);return o;},list:async()=>({objects:[]})}};
 const request=new Request('https://site.example/mcp',{headers:{'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.com'}});const before=await api.editorCall('get_edition',{},request,env);
 const source={schemaVersion:1,selectionVersion:1,layoutVersion:1,policyVersion:'hn-balanced-v2',basePublicationVersion:before.publicationVersion,generatedAt:edition.generatedAt,frontPageIds:seed.frontPageIds,sourcePages:seed.sourcePages,algorithmVersion:2,candidateCount:seed.stories.length,fetchedCount:seed.stories.length,rankedStories:seed.stories,selectedStories:seed.stories};await env.BUCKET.put('source-snapshots/'+edition.generatedAt+'.json',JSON.stringify(source));
 globalThis.fetch=async(...args)=>{reads++;return fetcher(...args);};const malicious={...edition,discussionHighlights:{...snapshot,items:[{...snapshot.items[0],excerpt:'This fabricated comment must never be accepted from a client.'}]}};
 failCommit=true;await assert.rejects(()=>api.editorCall('publish_edition',{edition:malicious},request,env),/Injected root/);const afterFailureReads=reads;failCommit=false;
 const result=await api.editorCall('publish_edition',{edition:malicious},request,env);assert.equal(reads,afterFailureReads,'failed root retry reuses frozen side snapshot');const published=await api.editorCall('get_edition',{},request,env);assert.equal(published.discussionHighlights.policy,'hn-trending-comments-v4');assert.ok(published.discussionHighlights.items.length>0,'real editor publication includes verified independent v4 highlights');assert.ok(published.discussionHighlights.items.every(h=>prose.startsWith(h.excerpt)));assert.ok(!JSON.stringify(published).includes('fabricated'));const retry=await api.editorCall('publish_edition',{edition:malicious},request,env);assert.equal(retry.unchanged,true);assert.equal(retry.version,result.version);assert.equal(reads,afterFailureReads);
 await api.editorCall('rebuild_edition',{},request,env);const rebuilt=await api.editorCall('get_edition',{},request,env);assert.deepEqual(rebuilt.discussionHighlights,published.discussionHighlights);assert.equal(reads,afterFailureReads);const archived=await api.readArchive(request,env,edition.generatedAt.slice(0,10));assert.deepEqual(archived.edition.discussionHighlights,published.discussionHighlights);
 // Template-only rebuilds and archives must preserve both old policies exactly,
 // even where v3 would collect a longer prefix or stop at a new boundary.
 const v3Root=JSON.parse(objects.get(api.PUBLICATION_KEY).text),frozenSide=[...objects].filter(([k])=>k.startsWith('discussion-snapshots/'));
 for(const frozen of [legacy,v2]){
  const frozenRoot=structuredClone(v3Root);frozenRoot.current.edition.discussionHighlights=frozen;
  await env.BUCKET.put(api.PUBLICATION_KEY,JSON.stringify(frozenRoot));
  await api.editorCall('rebuild_edition',{},request,env);
  const historical=await api.editorCall('get_edition',{},request,env),historicalArchive=await api.readArchive(request,env,edition.generatedAt.slice(0,10));
  assert.deepEqual(historical.discussionHighlights,frozen);assert.deepEqual(historicalArchive.edition.discussionHighlights,frozen);assert.equal(reads,afterFailureReads,'old snapshots are not recollected');
 }
 assert.deepEqual([...objects].filter(([k])=>k.startsWith('discussion-snapshots/')),frozenSide,'rebuilds never alter immutable side records');
 console.log('PASS: v3 bounded exact source prefixes, interior quote/code stops, unchanged collection bounds, Unicode pre-write guard, v1/v2 immutable compatibility, provenance, partial/offline fallback, cache/races/retries, client tamper rejection, rebuild/archive and publishing preservation.');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
