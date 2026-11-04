import assert from 'node:assert/strict';import{build}from'esbuild';import fs from'node:fs';import os from'node:os';import path from'node:path';import{pathToFileURL}from'node:url';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ht-comments-loader-'));
try{
 const out=path.join(dir,'reader.mjs');await build({entryPoints:['web/reader.ts'],bundle:true,platform:'node',format:'esm',outfile:out});
 const{installCommentLinks,filterStories}=await import(pathToFileURL(out));
 assert.equal(filterStories([{category:'Technology',topics:['AI','Games'],headline:'Test',summary:'',publisher:''}],'Games','').length,1);
 assert.equal(filterStories([{category:'Technology',headline:'Test',summary:'',publisher:''}],'AI','').length,0);
 class Element{
  constructor(tag='div'){this.tag=tag;this.children=[];this.listeners={};this.dataset={};this.hidden=true;this.textContent='';}
  addEventListener(name,fn){this.listeners[name]=fn;}replaceChildren(...nodes){this.children=nodes;}
  focus(){document.activeElement=this;}
  closest(selector){return selector==='a.discussion-link'?(this.tag==='a'?this:null):selector==='[data-story-id]'?this.story:null;}
 }
 globalThis.Element=Element;globalThis.HTMLDialogElement=class{showModal(){}};globalThis.location={href:'https://private.example/'};
 let clickHandler,notice;
 const setup=()=>{notice=new Element();globalThis.document={getElementById:()=>notice,createElement:tag=>new Element(tag),addEventListener:(name,handler)=>{if(name==='click')clickHandler=handler;}};};
 const anchor=id=>{const n=new Element('a');n.href='https://news.ycombinator.com/item?id='+id;n.story=new Element('article');n.story.dataset.storyId=String(id);return n;};
 const event=(target,extra={})=>({target,button:0,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},...extra});
 const asset='/reader-assets/comments-0123456789abcdef.js';const stories=[{id:1},{id:2}];let imports=0,resolveModule;const opened=[];
 setup();installCommentLinks(stories,asset,'2026-10-03','/reader-assets/comments-0123456789abcdef.css','e-0123456789abcdef01234567',url=>{imports++;assert.equal(url,asset);return new Promise(resolve=>resolveModule=resolve);});assert.equal(imports,0,'no module fetch on boot');
 const first=anchor(1),second=anchor(2);
 for(const extra of [{ctrlKey:true},{metaKey:true},{altKey:true},{shiftKey:true},{button:1},{defaultPrevented:true}]){const e=event(first,extra);await clickHandler(e);assert.equal(imports,0);}
 const invalid=anchor(3);await clickHandler(event(invalid));assert.equal(imports,0);
 const wrong=anchor(1);wrong.href='https://example.com/';await clickHandler(event(wrong));assert.equal(imports,0);
 const e1=event(first),e2=event(second);const one=clickHandler(e1),two=clickHandler(e2);assert.equal(e1.defaultPrevented,true);assert.equal(e2.defaultPrevented,true);assert.equal(imports,1,'repeated/filtered links share lazy import');
 assert.equal(notice.hidden,false);assert.equal(notice.children[1].href,second.href,'original discussion remains available while loading');
 resolveModule({createCommentsReader:(items,date,css,version)=>{assert.equal(version,'e-0123456789abcdef01234567');assert.equal(css,'/reader-assets/comments-0123456789abcdef.css');assert.deepEqual(items,stories);assert.equal(date,'2026-10-03');return{open:(id,trigger)=>{opened.push({id,trigger});return true;}};}});await Promise.all([one,two]);assert.equal(opened.length,1);assert.equal(opened[0].id,2,'newest clicked story wins');assert.equal(notice.hidden,true);
 await clickHandler(event(first));assert.equal(imports,1);assert.equal(opened.at(-1).id,1);
 setup();let resolveCancelled;let cancelledOpens=0;installCommentLinks(stories,asset,undefined,undefined,undefined,()=>new Promise(resolve=>resolveCancelled=resolve));const opening=clickHandler(event(first));notice.children[2].listeners.click();assert.equal(notice.hidden,true);assert.equal(document.activeElement,first);resolveCancelled({createCommentsReader:()=>({open:()=>{cancelledOpens++;return true;}})});await opening;assert.equal(cancelledOpens,0,'cancel prevents late module opening');
 setup();let cssReady,cssOpens=0;installCommentLinks(stories,asset,undefined,undefined,undefined,async()=>({createCommentsReader:()=>new Promise(resolve=>cssReady=resolve)}));const styling=clickHandler(event(first));await Promise.resolve();await Promise.resolve();notice.children[2].listeners.click();cssReady({open:()=>{cssOpens++;return true;}});await styling;assert.equal(cssOpens,0,'cancel during stylesheet load prevents an unstyled or late dialog');
 setup();let retries=0;installCommentLinks(stories,asset,undefined,undefined,undefined,async()=>{retries++;throw Error('offline');});await clickHandler(event(first));assert.equal(notice.hidden,false);assert.equal(notice.children[0].textContent,'The discussion reader could not be opened.');assert.equal(notice.children[1].href,first.href);assert.equal(notice.children[2].textContent,'Dismiss');await clickHandler(event(first));assert.equal(retries,2,'failed module import is retryable');
 for(const wrongAsset of ['https://evil.example/reader.js','//evil.example/script.js','/reader-assets/comments-bad.js',undefined]){setup();installCommentLinks(stories,wrongAsset,undefined,undefined,undefined,()=>{throw Error('must not load');});const e=event(first);await clickHandler(e);assert.equal(e.defaultPrevented,false,'bad module URL leaves real HN anchor alone');}
 setup();globalThis.HTMLDialogElement=undefined;installCommentLinks(stories,asset,undefined,undefined,undefined,()=>{throw Error('must not load');});const unsupported=event(first);await clickHandler(unsupported);assert.equal(unsupported.defaultPrevented,false);
 console.log('PASS: comments module stays out of initial reader; first-click import/dedupe, filtered-card delegation, latest-click/cancel guards, retry and HN fallback, safe same-origin assets, modified clicks/native unsupported fallback, cross-topic AI/Games filters.');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
