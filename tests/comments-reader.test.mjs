import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ht-comments-ui-'));
try{
 const out=path.join(dir,'comments.mjs');await build({entryPoints:['web/comments.ts'],bundle:true,platform:'node',format:'esm',outfile:out});
 const {createCommentsReader,safeCommentHref,validateCommentPage,appendCommentContent,loadCommentsStyles}=await import(pathToFileURL(out));
 for(const url of ['javascript:alert(1)','data:text/html,bad','vbscript:bad','//example.com','https://user:pass@example.com','https://example.com/\nfoo','https:\\example.com','file:///etc/passwd',null])assert.equal(safeCommentHref(url),null);
 assert.equal(safeCommentHref('https://example.com/a?q=b#c'),'https://example.com/a?q=b#c');assert.equal(safeCommentHref('http://example.com'),'http://example.com/');
 class Node{
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.parentElement=null;this.attrs={};this.listeners={};this.hidden=false;this.disabled=false;this.open=false;this.tabIndex=['a','button','input','select','textarea'].includes(tag)?0:-1;this.dataset={};this._text='';this._classes=new Set();this.classList={add:(...names)=>names.forEach(n=>this._classes.add(n)),remove:(...names)=>names.forEach(n=>this._classes.delete(n)),contains:n=>this._classes.has(n)};}
  set className(value){this._classes=new Set(value.split(' ').filter(Boolean));}get className(){return [...this._classes].join(' ');}
  set textContent(value){this._text=String(value);this.children=[];}get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  get isConnected(){return this===document.body||!!this.parentElement?.isConnected;}
  appendChild(child){child.parentElement=this;this.children.push(child);return child;}
  remove(){if(this.parentElement){this.parentElement.children=this.parentElement.children.filter(node=>node!==this);this.parentElement=null;}}
  replaceChildren(...children){this.children.forEach(child=>child.parentElement=null);this.children=[];this._text='';children.forEach(child=>this.appendChild(child));}
  setAttribute(name,value){this.attrs[name]=String(value);}getAttribute(name){return this.attrs[name];}
  addEventListener(name,handler){(this.listeners[name]??=[]).push(handler);}
  dispatch(name,extra={}){const event={target:this,preventDefault(){this.defaultPrevented=true;},defaultPrevented:false,...extra};for(const handler of this.listeners[name]||[])handler(event);return event;}
  focus(options){document.activeElement=this;this.focusOptions=options;}
  closest(selector){if(selector==='[hidden]')return this.hidden?this:this.parentElement?.closest(selector)||null;return null;}
  showModal(){this.open=true;this.showCount=(this.showCount||0)+1;}
  close(){this.open=false;}
  querySelectorAll(){return all(this).filter(node=>node!==this&&(['A','BUTTON','INPUT','SELECT','TEXTAREA'].includes(node.tagName)||node.tabIndex>=0));}
  getClientRects(){return this.hidden?[]:[this.getBoundingClientRect()];}
  contains(node){return node===this||this.children.some(child=>child.contains(node));}
  getBoundingClientRect(){return {left:300,top:0,right:1000,bottom:900};}
 }
 globalThis.document={head:new Node('head'),body:new Node('body'),documentElement:new Node('html'),activeElement:null,createElement:tag=>new Node(tag),createTextNode:text=>{const node=new Node('#text');node.textContent=text;return node;},getElementById:id=>all(document.body).find(n=>n.id===id)};
 let scroll;
 globalThis.window={scrollX:4,scrollY:360,scrollTo:value=>{scroll=value;}};
 function all(node){return [node,...node.children.flatMap(all)];}
 const find=(node,className)=>all(node).find(n=>n.classList.contains(className));
 const findAll=(node,className)=>all(node).filter(n=>n.classList.contains(className));
 const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
 const queue=[];let calls=0,expectedVersion='e-0123456789abcdef01234567';
 globalThis.fetch=(url,options)=>{assert.equal(new URL(url,'https://example.com').searchParams.get('version'),expectedVersion);calls++;return new Promise((resolve,reject)=>queue.push({url,options,resolve,reject}));};
 const reply=(request,value,status=200)=>request.resolve({ok:status===200,status,json:async()=>value});
 const comment=(id,parentId=1,extra={})=>({id,parentId,by:'author_'+id,time:1762090000,deleted:false,dead:false,unavailable:false,content:[{type:'p',children:[{type:'text',text:'Text '+id}]}],contentTruncated:false,replyCount:0,repliesAvailable:false,...extra});
 const page=(storyId=1,parentId=storyId,comments=[comment(storyId+100,parentId)],extra={})=>({storyId,parentId,depth:parentId===storyId?0:1,comments,page:{offset:0,limit:12,total:comments.length,nextOffset:null,partial:false,truncated:false,...extra},fetchedAt:'2026-11-03T00:00:00.000Z'});
 const trigger=new Node('a');document.body.appendChild(trigger);const news=new Node('div');news.id='news';document.body.appendChild(news);
 const stories=Array.from({length:40},(_,i)=>({id:i+1,headline:'Story '+(i+1),comments:i===0?0:i===1?1:12345}));
 const css='/reader-assets/comments-0123456789abcdef.css';const ready=createCommentsReader(stories,'2026-11-02',css,'e-0123456789abcdef01234567');assert.equal(calls,0);assert.equal(document.body.children.length,2,'no unstyled dialog before stylesheet load');document.head.children[0].dispatch('load');const reader=await ready;assert.equal(calls,0,'no boot comment fetch');assert.equal(reader.open(999,trigger),false);
 assert.equal(reader.open(1,trigger),true);const dialog=find(document.body,'comments-dialog');assert.equal(dialog.open,true);assert.equal(document.documentElement.classList.contains('comments-open'),true);assert.equal(document.activeElement,find(dialog,'comments-close'));
 const header=find(dialog,'comments-header');
 assert.equal(find(header,'comments-kicker').textContent,'Hacker Times');
 assert.equal(find(header,'comments-count').tagName,'STRONG');assert.equal(find(header,'comments-heading').textContent,'0 comments');assert.equal(find(header,'comments-story-title').textContent,'Story 1');
 assert.equal(dialog.attrs['aria-labelledby'],'comments-heading comments-story-title');assert.equal(dialog.attrs['aria-describedby'],'comments-snapshot');assert.equal(document.getElementById('comments-snapshot').textContent,'Comment count at publication');assert.equal(find(header,'comments-count').title,'Comment count at publication');
 const assertHeaderLink=id=>{const link=find(dialog,'comments-original');assert.equal(link.textContent,'Post your comments, open the discussion on Hacker News');assert.equal(link.href,'https://news.ycombinator.com/item?id='+id);assert.equal(link.target,'_blank');assert.equal(link.rel,'noopener noreferrer');};assertHeaderLink(1);
 assert.equal(all(header).filter(n=>n.tagName==='A').length,1);assert.equal(all(dialog).some(n=>['INPUT','TEXTAREA'].includes(n.tagName)),false);
 for(const old of ['The conversation','Live comments from Hacker News','Reader Picks','All'])assert.equal(all(header).some(n=>n.textContent===old||n.textContent.startsWith(old)),false);
 const closeControl=find(dialog,'comments-close'),originalControl=find(dialog,'comments-original');closeControl.focus();assert.equal(dialog.dispatch('keydown',{key:'Tab',shiftKey:true}).defaultPrevented,true);assert.equal(document.activeElement,originalControl,'Shift+Tab wraps from Close to last visible control');assert.equal(dialog.dispatch('keydown',{key:'Tab'}).defaultPrevented,true);assert.equal(document.activeElement,closeControl,'Tab wraps to Close');
 assert.equal(calls,1);reader.open(1,trigger);assert.equal(calls,1,'repeated click dedupes');assert.ok(queue[0].url.includes('date=2026-11-02'));assert.equal(queue[0].options.credentials,'same-origin');assert.equal(queue[0].options.headers.Accept,'application/json');
 const unsafe=comment(101,1,{content:[{type:'p',children:[{type:'text',text:'<img src=x onerror=alert(1)>'},{type:'a',href:'javascript:alert(1)',children:[{type:'text',text:'unsafe link'}]},{type:'a',href:'https://example.com/safe',children:[{type:'em',children:[{type:'text',text:'safe link'}]}]}]},{type:'pre',children:[{type:'code',children:[{type:'text',text:'<script>unsafe()</script>'}]}]}],replyCount:2,repliesAvailable:true,contentTruncated:true});
 const initial=[unsafe,comment(102,1,{deleted:true}),comment(103,1,{unavailable:true,by:null,time:null}),...Array.from({length:9},(_,i)=>comment(i+104))];
 reply(queue.shift(),page(1,1,initial,{total:14,nextOffset:12,partial:true,truncated:true}));await tick();
 assert.equal(find(header,'comments-heading').textContent,'0 comments','live top-level count does not overwrite saved total');
 assert.equal(findAll(dialog,'comment-node').length,12);assert.ok(dialog.textContent.includes('<img src=x onerror=alert(1)>'));assert.ok(dialog.textContent.includes('unsafe link'));assert.equal(all(dialog).some(n=>['IMG','SCRIPT','IFRAME'].includes(n.tagName)),false);
 const safeLink=all(dialog).find(n=>n.attrs.href==='https://example.com/safe');assert.equal(safeLink.tagName,'A');assert.equal(safeLink.attrs.rel,'noopener noreferrer nofollow');assert.equal(all(dialog).some(n=>n.attrs.href?.startsWith('javascript:')),false);
 assert.ok(dialog.textContent.includes('This comment was deleted.'));assert.ok(dialog.textContent.includes('This comment is unavailable.'));assert.ok(dialog.textContent.includes('Some comments are unavailable.'));assert.ok(dialog.textContent.includes('first 600 comments'));assert.ok(dialog.textContent.includes('Comment shortened.'));
 const replies=find(dialog,'comment-replies-toggle');replies.dispatch('click');replies.dispatch('click');assert.equal(queue.length,1,'replies lazy and request deduped');assert.ok(queue[0].url.includes('parentId=101'));reply(queue.shift(),page(1,101,[comment(202,101),comment(201,101)]));await tick();
 replies.dispatch('click');assert.equal(queue.length,0,'show/hide retains loaded replies');assert.deepEqual(findAll(findAll(dialog,'comment-page')[1],'comment-author').map(n=>n.textContent),['author_202','author_201'],'HN kids order preserved');
 const collapse=find(dialog,'comment-collapse');collapse.dispatch('click');assert.equal(collapse.attrs['aria-expanded'],'false');assert.equal(find(dialog,'comment-content').hidden,true);collapse.dispatch('click');assert.equal(collapse.attrs['aria-expanded'],'true');
 const more=find(dialog,'comment-page').children.at(-1);more.focus();more.dispatch('click');assert.equal(more.disabled,true);reply(queue.shift(),{},503);await tick();assert.equal(more.textContent,'Try again');assert.equal(more.disabled,false);assert.ok(dialog.textContent.includes('Comments could not be loaded'));assert.equal(findAll(dialog,'comment-node').length,14,'loaded content survives failed pagination');
 more.dispatch('click');const request=queue.shift();assert.ok(request.url.includes('offset=12'));reply(request,page(1,1,[comment(113),comment(114)],{offset:12,total:14}));await tick();assert.equal(more.hidden,true);assert.equal(document.activeElement.tagName,'LI','pagination focus stays within discussion');
 const cancel=dialog.dispatch('cancel');assert.equal(cancel.defaultPrevented,true);assert.equal(dialog.open,false);assert.equal(document.activeElement,trigger);assert.deepEqual(scroll,{left:4,top:360,behavior:'instant'});assert.equal(document.documentElement.classList.contains('comments-open'),false);
 const before=calls;reader.open(1,trigger);await tick();assert.equal(calls,before,'reopen uses bounded short-lived cache');assert.equal(dialog.open,true);
 // A delayed native close event must never close a newly reopened dialog.
 dialog.dispatch('close');assert.equal(dialog.open,true);
 dialog.dispatch('pointerdown',{clientX:500,clientY:100});dialog.dispatch('click',{clientX:200,clientY:100});assert.equal(dialog.open,true,'drag from sheet is not a backdrop click');
 dialog.dispatch('pointerdown',{clientX:200,clientY:100});dialog.dispatch('click',{clientX:200,clientY:100});assert.equal(dialog.open,false,'backdrop closes');assert.equal(document.activeElement,trigger);
 reader.open(2,trigger);assert.equal(find(header,'comments-heading').textContent,'1 comment');assertHeaderLink(2);const old=queue.shift();stories[2].headline='A very long article headline '+ 'unbrokenword'.repeat(35);reader.open(3,trigger);assert.equal(find(header,'comments-heading').textContent,'12,345 comments');assert.equal(find(header,'comments-story-title').textContent,stories[2].headline);assertHeaderLink(3);assert.equal(old.options.signal.aborted,true,'switch cancels old request');const current=queue.shift();reply(current,page(3));await tick();reply(old,page(2));await tick();assert.ok(dialog.textContent.includes(stories[2].headline));assertHeaderLink(3);assert.ok(!dialog.textContent.includes('Text 102'),'late response cannot overwrite newer story');
 reader.open(4,trigger);const closing=queue.shift();reader.close();assert.equal(closing.options.signal.aborted,true);reply(closing,page(4));await tick();assert.equal(dialog.open,false);assert.equal(find(dialog,'comments-scroll').children.length,0,'close clears content even with late responses');assert.equal(reader.pendingCount(),0);
 reader.open(5,trigger);reply(queue.shift(),{bad:true});await tick();assert.ok(dialog.textContent.includes('Comments could not be loaded'));assert.equal(find(dialog,'comments-load').textContent,'Try again');const retryControl=find(dialog,'comments-load');retryControl.focus();assert.equal(dialog.dispatch('keydown',{key:'Tab'}).defaultPrevented,true);assert.equal(document.activeElement,find(dialog,'comments-close'),'error-state Tab stays in modal');find(dialog,'comments-close').focus();dialog.dispatch('keydown',{key:'Tab',shiftKey:true});assert.equal(document.activeElement,retryControl,'error-state Shift+Tab reaches Retry');reader.close();
 // Cached objects are normalized, not a route for arbitrary response data or executable markup.
 const valid=page();assert.equal(validateCommentPage(valid,1,1,0).comments.length,1);assert.throws(()=>validateCommentPage({...valid,storyId:2},1,1,0));assert.throws(()=>validateCommentPage(page(1,1,[comment(111,99)]),1,1,0));assert.throws(()=>validateCommentPage(page(1,1,[comment(111,1,{content:[{type:'script',children:[]}]})]),1,1,0));assert.throws(()=>validateCommentPage(page(1,1,[comment(111)],{nextOffset:3,total:99}),1,1,0));
 const unknown=new Node();appendCommentContent(unknown,[{type:'iframe',children:[]}]);assert.equal(unknown.children.length,0);
 for(let id=6;id<=35;id++){reader.open(id,trigger);reply(queue.shift(),page(id));await tick();reader.close();}assert.equal(reader.cacheSize(),24,'cache bounded to 24 pages');

 await assert.rejects(createCommentsReader(stories,undefined,css,'e-invalid'));
 await assert.rejects(createCommentsReader(stories,undefined,css,'legacy-../bad'));
 expectedVersion='bundled-0123456789abcdef';const bundled=await createCommentsReader(stories,undefined,css,expectedVersion);bundled.open(1,trigger);reply(queue.shift(),page());await tick();bundled.close();
 expectedVersion=null;const legacy=await createCommentsReader(stories,'2026-10-03',css,'legacy-2026-10-03');legacy.open(1,trigger);const legacyRequest=queue.shift();assert.ok(legacyRequest.url.includes('date=2026-10-03'));reply(legacyRequest,page());await tick();legacy.close();

 // A hung network is bounded even if fetch ignores abort, and loaded pages survive retry.
 const nativeTimeout=globalThis.setTimeout,nativeClearTimeout=globalThis.clearTimeout;const timers=new Map();let timerId=0;
 globalThis.setTimeout=(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});return id;};globalThis.clearTimeout=id=>timers.delete(id);
 try{
  const timed=await createCommentsReader(stories,undefined,css);timed.open(1,trigger);assert.equal([...timers.values()][0].delay,25000);reply(queue.shift(),page(1,1,initial,{total:14,nextOffset:12}));await tick();assert.equal(timers.size,0,'successful request clears deadline');
  const timedDialog=document.body.children.at(-1),loadMore=find(timedDialog,'comment-page').children.at(-1);loadMore.dispatch('click');const hanging=queue.shift();assert.equal(timers.size,1);[...timers.values()][0].callback();await tick();assert.equal(hanging.options.signal.aborted,true);assert.equal(loadMore.textContent,'Try again');assert.equal(findAll(timedDialog,'comment-node').length,12,'timeout preserves earlier page');assert.equal(timers.size,0);assert.equal(timed.pendingCount(),0);
  loadMore.dispatch('click');reply(queue.shift(),page(1,1,[comment(113),comment(114)],{offset:12,total:14}));await tick();assert.equal(loadMore.hidden,true);assert.equal(findAll(timedDialog,'comment-node').length,14);reply(hanging,page(1,1,[comment(999)],{offset:12,total:14}));await tick();assert.equal(findAll(timedDialog,'comment-node').length,14,'timed-out response cannot append late');timed.close();assert.equal(timers.size,0);
 }finally{globalThis.setTimeout=nativeTimeout;globalThis.clearTimeout=nativeClearTimeout;}

 // Modal history is same-URL: Back dismisses, Forward reopens, Close consumes its entry.
 const originalHistory=globalThis.history,originalListen=window.addEventListener;const popListeners=[],navigation=[];let historyIndex=0;const historyStack=[{reader:'preserved'}];
 window.addEventListener=(name,callback)=>{if(name==='popstate')popListeners.push(callback);};
 globalThis.history={get state(){return historyStack[historyIndex];},pushState(state,title,url){assert.equal(url,undefined,'modal never changes URL');historyStack.splice(historyIndex+1);historyStack.push(state);historyIndex++;},replaceState(state,title,url){assert.equal(url,undefined);historyStack[historyIndex]=state;},back(){navigation.push(-1);},forward(){navigation.push(1);}};
 const navigate=()=>{const direction=navigation.shift();assert.ok(direction);historyIndex+=direction;for(const callback of popListeners)callback({state:history.state});};
 try{
  const historic=await createCommentsReader(stories,undefined,css);historic.open(1,trigger);const historyDialog=document.body.children.at(-1);reply(queue.shift(),page());await tick();assert.equal(historyStack.length,2);assert.equal(history.state.htDiscussion.storyId,1);assert.equal(history.state.reader,'preserved');
  history.back();navigate();assert.equal(historyDialog.open,false);assert.equal(document.activeElement,trigger);assert.equal(historyIndex,0);assert.deepEqual(history.state,{reader:'preserved'});
  history.forward();navigate();await tick();assert.equal(historyDialog.open,true);assert.equal(historyStack.length,2,'Forward does not add another entry');assert.equal(queue.length,0,'Forward may reuse bounded cache');
  historic.open(2,trigger);reply(queue.shift(),page(2));await tick();assert.equal(historyStack.length,2,'switching stories replaces modal entry');assert.equal(history.state.htDiscussion.storyId,2);
  historic.close();assert.equal(historyDialog.open,false);assert.equal(navigation.length,1);historic.open(3,trigger);assert.equal(historyDialog.open,false,'rapid reopen waits for pending history cleanup');historyDialog.dispatch('close');navigate();assert.equal(historyDialog.open,true);assert.equal(history.state.htDiscussion.storyId,3);reply(queue.shift(),page(3));await tick();assert.equal(historyStack.length,2);historic.close();navigate();assert.equal(historyIndex,0);assert.equal(navigation.length,0);assert.equal(historyDialog.open,false);
 }finally{globalThis.history=originalHistory;window.addEventListener=originalListen;}
 // Native dialog unavailable: no interception/controller request is attempted.
 const originalCreate=document.createElement;document.createElement=tag=>{const n=originalCreate(tag);if(tag==='dialog')n.showModal=undefined;return n;};assert.equal((await createCommentsReader(stories,undefined,css)).open(1,trigger),false);assert.equal(queue.length,0);

 // Stylesheet loading is shared, validated and retryable. It never injects inline CSS.
 await assert.rejects(loadCommentsStyles('https://evil.example/styles.css'));
 const css2='/reader-assets/comments-fedcba9876543210.css';const failing=loadCommentsStyles(css2);const deduped=loadCommentsStyles(css2);assert.equal(failing,deduped);document.head.children.at(-1).dispatch('error');await assert.rejects(failing);await assert.rejects(deduped);
 const styleRetry=loadCommentsStyles(css2);document.head.children.at(-1).dispatch('load');await styleRetry;assert.equal(document.head.children.at(-1).tagName,'LINK');assert.equal(document.head.children.at(-1).rel,'stylesheet');
 console.log('PASS: safe token DOM renderer, URL allowlist, no boot fetch, modal focus cycle/escape/backdrop/history Back/Forward, dedupe/cache bounds, lazy ordered replies/collapse, pagination/retry, deleted/unavailable/truncated labels, malformed responses, stale/cancel/switch guards. Native browser focus trapping/layout requires browser QA.');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
