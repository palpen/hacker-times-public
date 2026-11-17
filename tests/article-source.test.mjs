import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ht-article-source-'));
const output=path.join(directory,'source.mjs');
await build({stdin:{contents:`export {ArchiveCopies} from './lib/production/archived-copy';export {writeBlob} from './lib/production/storage';export {readPublisherFeed,matchPublisherFeed,publisherFeedUrl} from './lib/production/publisher-feed';export {safeFetch,article,MAX_ARTICLE_HTML_BYTES} from './lib/reporting';export {collectionFailure} from './lib/collection-error';export {collectSource} from './lib/production/collect';export {generateEditorialCopy} from './lib/production/editorial-model';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:output});
const {ArchiveCopies,writeBlob,readPublisherFeed,matchPublisherFeed,publisherFeedUrl,safeFetch,article,MAX_ARTICLE_HTML_BYTES,collectSource,generateEditorialCopy,collectionFailure}=await import(pathToFileURL(output));
const originalFetch=globalThis.fetch;
test.after(()=>{globalThis.fetch=originalFetch;fs.rmSync(directory,{recursive:true,force:true});});
const url='https://fictional.example/story';
const htmlResponse=(html,headers={})=>new Response(html,{headers:{'content-type':'text/html; charset=utf-8',...headers}});
const prose='The fictional Finch Archive introduced a sorting system that groups its paper collection by color, reducing the work required to organize each box.';
const selected={id:7001,title:'Fictional archive introduces paper sorting',url,score:30,comments:12,time:1794268800,category:'Technology',editorialScore:10,placement:'section'};
const snapshot={generatedAt:'2026-11-15T23:00:00.000Z',selectedStories:[selected]};

test('script-heavy two-megabyte pages yield clean, bounded article text',async()=>{
 const html=`<html><head><title>Finch Archive</title><script>${'x'.repeat(2_000_000)}</script></head><body><nav>Navigation must not enter evidence</nav><article><button onclick="value > 3 ? alert('leak') : null">Copy link</button><div class="social-share">Share this story</div><p>${prose}</p><p>Caf&eacute; &amp; archive <em>notes</em>.</p><svg><title>Decorative logo</title></svg><aside>Unrelated recommendations</aside></article></body></html>`;
 globalThis.fetch=async()=>htmlResponse(html,{'content-length':'420000','content-encoding':'br'});
 const source=await article(url);
 assert.equal(source.articleStatus,'fetched');assert.equal(source.pageTitle,'Finch Archive');
 assert.equal(source.excerpt,prose+' Café & archive notes.');
 globalThis.fetch=async()=>htmlResponse('<article>'+prose.repeat(100)+'</article>');
 assert.equal((await article(url)).excerpt.length,8500);
});

test('full-text callers retain all article text and explicit publication dates',async()=>{
 const content=prose.repeat(400)+' THE COMPLETE END';
 globalThis.fetch=async()=>htmlResponse(`<head><meta property="article:published_time" content="2026-11-12T10:00:00Z"></head><article>${content}</article>`);
 const full=await article(url,{fullText:true}),compact=await article(url);
 assert.equal(full.excerpt,content);assert.ok(full.excerpt.length>24_000);
 assert.equal(compact.excerpt.length,8500);
 for(const source of [full,compact])assert.equal(source.articlePublishedAt,'2026-11-12T10:00:00Z');
});

test('streamed decoded bytes, not compressed Content-Length, enforce the hard cap',async()=>{
 let cancelled=false;
 globalThis.fetch=async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(MAX_ARTICLE_HTML_BYTES));controller.enqueue(new Uint8Array(1));},cancel(){cancelled=true;}}),{headers:{'content-type':'text/html','content-length':'100'}});
 assert.equal((await article(url)).articleStatus,'fetch_body_too_large');assert.equal(cancelled,true);
 cancelled=false;
 globalThis.fetch=async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-type':'text/html','content-length':String(MAX_ARTICLE_HTML_BYTES+1)}});
 assert.equal((await article(url)).articleStatus,'fetch_body_too_large');assert.equal(cancelled,true);
});

test('navigation and title-only shells use descriptive metadata with correct model provenance',async()=>{
 const description='The fictional Finch Archive demonstrates how its new paper sorting system groups test documents by color.';
 globalThis.fetch=async()=>htmlResponse(`<head><title>Finch</title><meta name="description" content="Generic site metadata"><meta property="og:description" content="${description}"></head><body><main><h1>Finch</h1><a href="/about">About</a><a href="/terms">Terms</a></main></body>`);
 const source=await collectSource(snapshot,selected.id);
 assert.equal(source.kind,'article');assert.equal(source.excerpt,'');assert.equal(source.description,description);
 let calls=0;
 const copy={headline:selected.title,summary:description,shortSummary:description,summarySource:'page_description'};
 const result=await generateEditorialCopy(source,selected,{apiKey:'fictional',model:'gpt-6-luna',maxOutputTokens:1024},async(_url,options)=>{
  calls++;const request=JSON.parse(options.body);
  assert.deepEqual(JSON.parse(request.input[0].content[0].text),{originalTitle:selected.title,evidenceKind:'page_description',sourceText:description});
  return Response.json({status:'completed',usage:{input_tokens:100,output_tokens:40,total_tokens:140},output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(copy)}]}]});
 });
 assert.equal(calls,1);assert.equal(result.story.summarySource,'page_description');
});

test('generic product metadata cannot stand in for a specifically named article',async()=>{
 const description='Finch offers a comprehensive collection of sorting tools, document processing and archive management features.';
 const candidate={...selected,title:'Finch4-Max'};
 globalThis.fetch=async()=>htmlResponse(`<head><title>Finch</title><meta property="og:description" content="${description}"></head><body><h1>Finch</h1></body>`);
 const source=await collectSource({...snapshot,selectedStories:[candidate]},candidate.id);
 assert.equal(source.status,'insufficient_source_text');assert.equal(source.kind,'unavailable');assert.equal(source.description,'');
 const result=await generateEditorialCopy(source,candidate,undefined,async()=>assert.fail('No model call for generic metadata'));
 assert.equal(result.story.headline,candidate.title);assert.equal(result.story.summarySource,'unavailable');
 globalThis.fetch=async()=>htmlResponse('<head><title>Finch</title><meta property="og:description" content="Finch4-Max introduces color-based sorting for the fictional archive collection."></head><body><h1>Finch</h1></body>');
 const matching=await collectSource({...snapshot,selectedStories:[candidate]},candidate.id);
 assert.equal(matching.kind,'article');assert.match(matching.description,/Finch4-Max/);
});

test('empty app and repository shells preserve the title without a model request',async()=>{
 for(const html of ['<head><title>Finch</title></head><body><h1>Finch</h1><script>bootApp()</script></body>', '<head><title>Finch project</title><meta name="description" content="CodeHost.com"></head><main><h1>Project information</h1>Project ID: 123 <a>README</a><a>License</a><a>Changelog</a>Created on November 12, 2026</main>']){
  globalThis.fetch=async()=>htmlResponse(html);
  const source=await collectSource(snapshot,selected.id);assert.equal(source.status,'insufficient_source_text');assert.equal(source.kind,'unavailable');
  const result=await generateEditorialCopy(source,selected,undefined,async()=>{assert.fail('No model call without source evidence');});
  assert.equal(result.story.headline,selected.title);assert.equal(result.story.summary,'');assert.equal(result.requested,false);
 }
});

test('article bodies outrank related cards and exclude discussion and signup text',async()=>{
 const articleText=prose.repeat(3);
 globalThis.fetch=async()=>htmlResponse('<main><p>'+articleText+'</p><article><a><h3>Other headline</h3></a>Yesterday</article><article><a>Elsewhere</a>Tuesday</article></main>');
 assert.equal((await article(url)).excerpt,articleText);
 globalThis.fetch=async()=>htmlResponse('<article class="typography newsletter-post post"><p>'+articleText+'</p><div class="newsletter-signup">Subscribe to another publication</div></article><section id="discussion"><article>'+prose.repeat(8)+'</article></section>');
 assert.equal((await article(url)).excerpt,articleText);
 globalThis.fetch=async()=>htmlResponse('<main><article>'+prose+'</article><article>'+prose+' More teaser copy.</article></main>');
 assert.equal((await article(url)).excerpt,'');
});
test('exact feed links preserve article identity, date, publisher origin and ambiguity checks',()=>{
 const when='2026-11-17T12:00:00Z',key='https://fictional.example/article?id=15';
 const atom=(link,text,date=when)=>'<entry><link rel="self" href="https://example.org/api/entry"/><link rel="alternate" href="'+link+'"/><updated>'+date+'</updated><summary>'+text+'</summary></entry>';
 const feed=(entries)=>readPublisherFeed('<feed>'+entries+'</feed>');
 const exact=atom(key+'&amp;utm_source=feed',prose);
 assert.equal(matchPublisherFeed(feed(exact),key,when),prose);
 assert.equal(matchPublisherFeed(feed(exact),key.replace('15','16'),when),undefined);
 assert.equal(matchPublisherFeed(feed(atom(key,prose,'2026-11-18T00:00:00Z')),key,when),undefined);
 assert.equal(matchPublisherFeed(feed(exact+atom(key,prose+' Different conclusion.')),key,when),undefined);
 assert.equal(publisherFeedUrl(key,'https://elsewhere.example/rss'),undefined);
 assert.equal(publisherFeedUrl(key,'/feed'),'https://fictional.example/feed');
 assert.equal(publisherFeedUrl('https://www.nytimes.com/2026/11/17/upshot/example.html'),'https://rss.nytimes.com/services/xml/rss/nyt/Upshot.xml');
});

test('generic Open Graph metadata does not hide a descriptive standard meta tag',async()=>{
 globalThis.fetch=async()=>htmlResponse(`<head><title>Finch</title><meta property="og:description" content="Finch"><meta name="description" content="${prose}"></head><body><h1>Finch</h1></body>`);
 const source=await article(url);assert.equal(source.excerpt,'');assert.equal(source.description,prose);
});

test('normal article prose takes precedence over descriptions and excludes hidden boilerplate',async()=>{
 globalThis.fetch=async()=>htmlResponse(`<head><meta name="description" content="An unrelated site description should not displace the actual article text."></head><main><div hidden>Hidden bait</div><div aria-hidden="true">Decorative text</div><section><p>${prose}</p></section></main>`);
 const source=await collectSource(snapshot,selected.id);assert.equal(source.excerpt,prose);assert.equal(source.kind,'article');
});

test('invalid optional image metadata does not discard usable source text',async()=>{
 globalThis.fetch=async()=>htmlResponse(`<meta property="og:image" content="http://[invalid"><article>${prose}</article>`);
 const source=await article(url);assert.equal(source.articleStatus,'fetched');assert.equal(source.excerpt,prose);assert.deepEqual(source.imageCandidates,[]);
});

test('source failures retain fixed diagnostic reasons without leaking exception details',async()=>{
 const secret='private-provider-detail';
 for(const [error,expected] of [[new TypeError(secret),'fetch_network_error'],[new DOMException(secret,'TimeoutError'),'fetch_timeout'],[new Error('Too many subrequests. '+secret),'fetch_request_limit']]){
  globalThis.fetch=async()=>{throw error;};const source=await collectSource(snapshot,selected.id);
  assert.equal(source.status,expected);assert.equal(source.kind,'unavailable');assert.ok(!JSON.stringify(source).includes(secret));
 }
 for(const [response,expected] of [[()=>htmlResponse('broken',{'content-type':'text/html; charset=not-a-charset'}),'fetch_decode_failed'],[()=>htmlResponse(new Uint8Array([0xff]),{'content-type':'text/html; charset=utf-8'}),'fetch_decode_failed'],[()=>new Response(null,{status:302}),'fetch_redirect_missing'],[()=>new Response(null,{status:302,headers:{location:url}}),'fetch_redirect_limit'],[()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}}),'fetch_url_rejected']]){
  let calls=0;globalThis.fetch=async()=>{calls++;return response();};const source=await article(url);
  assert.equal(source.articleStatus,expected);assert.ok(calls<=4);if(expected==='fetch_url_rejected')assert.equal(calls,1);
 }
 globalThis.fetch=async()=>{assert.fail('Invalid URLs must not be fetched');};
 assert.equal((await article('http://localhost/private')).articleStatus,'fetch_url_rejected');
});

test('shared HN fetches keep the platform request-limit diagnostic',async()=>{
 globalThis.fetch=async()=>{throw Error('Too many subrequests.');};
 await assert.rejects(()=>safeFetch(url),error=>collectionFailure(error,'current_list','Collection failed').details.reason==='request_limit');
});

test('body read errors are separate from fetch and decoding failures',async()=>{
 globalThis.fetch=async()=>new Response(new ReadableStream({start(controller){controller.error(new TypeError('private stream error'));}}),{headers:{'content-type':'text/html'}});
 assert.equal((await article(url)).articleStatus,'fetch_body_error');
});

test('stalled body reads time out and cancel the stream',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let cancelled=false;
 globalThis.fetch=async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-type':'text/html'}});
 const result=article(url);await new Promise(resolve=>setImmediate(resolve));t.mock.timers.tick(15_001);
 assert.equal((await result).articleStatus,'fetch_body_timeout');assert.equal(cancelled,true);
});

test('publisher restrictions and unsupported formats stay explicit without retries',async()=>{
 for(const status of [401,403,429,503]){
  let calls=0;globalThis.fetch=async()=>{calls++;return new Response('Access restricted',{status});};
  const source=await collectSource(snapshot,selected.id);
  assert.equal(source.status,status===429?'temporarily_rate_limited':'unavailable_http_'+status);assert.equal(source.kind,'unavailable');assert.equal(calls,1);
 }
 for(const type of ['application/pdf','text/plain','text/html-invalid']){
  globalThis.fetch=async()=>new Response('Unsupported',{headers:{'content-type':type}});
  assert.equal((await article(url)).articleStatus,'non_html');
 }
});

test('archive reuse expires at the original verification time and requires matching identity',async()=>{
 const index=new ArchiveCopies(),map=new Map(),store={get:async k=>map.get(k),put:async(k,v)=>map.set(k,v)};
 const candidate={...selected,title:'Understanding paper sorting',url:'https://fictional.example/tutorial/paper-sorting'};
 const copy={version:'first',generatedAt:'2026-11-13T12:00:00.000Z',headline:candidate.title,shortSummary:prose,summary:prose,publisher:'Fictional archive'};
 const edition={generatedAt:'2026-11-15T12:00:00.000Z',stories:[{...candidate,...copy,summarySource:'archived_summary'}]};
 await writeBlob(store,'version/reused',{edition});
 await store.put('source/'+edition.generatedAt+'/'+candidate.id,{archive:copy});
 const root={version:'reused',archives:{'2026-11-15':'reused'}};
 assert.deepEqual(await index.find(store,root,candidate,'2026-11-16T11:59:00.000Z'),copy);
 assert.equal(await index.find(store,root,candidate,'2026-11-16T12:01:00.000Z'),undefined);
 for(const change of [{url:candidate.url+'-other'},{title:'Understanding a different project'},{title:'Understanding today’s outage'}]){
  assert.equal(await index.find(store,root,{...candidate,...change},'2026-11-16T11:59:00.000Z'),undefined);
 }
});
