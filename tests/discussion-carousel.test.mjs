import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ht-highlights-'));
const pointerCapture=new Map(),pendingPointerCapture=new Map();
class Node{
 constructor(selector=''){this.selector=selector;this.children=[];this.listeners={};this.dataset={};this.attrs={};this.hidden=false;this.isConnected=true;this.textContent='';this.style={};this.tabIndex=0;this.width=600;this.inert=false;}
 append(node){this.children.push(node);node.parentElement=this;return node;}
 appendChild(node){return this.append(node);}
 remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(node=>node!==this);this.parentElement=null;}
 cloneNode(deep){const node=new Node(this.selector);Object.assign(node,{dataset:{...this.dataset},attrs:{...this.attrs},style:{...this.style},width:this.width,layoutWidth:this.layoutWidth,height:this.height,hidden:this.hidden});if(deep)this.children.forEach(child=>node.append(child.cloneNode(true)));return node;}
 querySelectorAll(selector){return this.children.flatMap(node=>[...(node.selector===selector?[node]:[]),...node.querySelectorAll(selector)]);}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 closest(selector){return selector.split(',').some(part=>part==='[hidden]'?this.hidden:this.selector===part)?this:this.parentElement?.closest(selector)||null;}
 contains(node){return node===this||this.children.some(child=>child.contains(node));}
 addEventListener(type,fn,capture){(this.listeners[type]??=[]).push({fn,capture});}
 removeEventListener(type,fn){this.listeners[type]=(this.listeners[type]||[]).filter(item=>item.fn!==fn);}
 emit(type,extra={}){
  const event={target:this,currentTarget:null,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},stopImmediatePropagation(){this.stopped=true;},...extra},path=[this];
  if(event.bubbles)for(let parent=this.parentElement;parent;parent=parent.parentElement)path.push(parent);
  for(const capture of [true,false])for(const node of capture?[...path].reverse():path){
   event.currentTarget=node;
   for(const listener of [...(node.listeners[type]||[])])if(!!listener.capture===capture){listener.fn(event);if(event.stopped)return event;}
  }
  event.currentTarget=null;return event;
 }
 setAttribute(name,value){this.attrs[name]=value;}removeAttribute(name){delete this.attrs[name];if(name==='tabindex')this.tabIndex=0;if(name==='data-highlight-page'&&this.selector==='[data-highlight-page]')this.selector='clone';}
 focus(){document.activeElement=this;}
 setPointerCapture(id){pendingPointerCapture.set(id,this);}hasPointerCapture(id){return pendingPointerCapture.get(id)===this;}releasePointerCapture(id){if(this.hasPointerCapture(id))pendingPointerCapture.delete(id);}
 animate(frames,options){const animation=new Animation(this,frames,options);animations.push(animation);return animation;}
 get offsetHeight(){return this.height||120;}
 get offsetWidth(){return this.layoutWidth||this.width;}
 getBoundingClientRect(){return {width:this.width,height:this.hidden?0:this.height||120};}
}
const animations=[];
class Animation{
 constructor(node,frames,options){this.node=node;this.frames=frames;this.options=options;this.finished=new Promise((resolve,reject)=>{this.resolve=resolve;this.reject=reject;});}
 finish(){if(!this.done){this.done=true;this.resolve();}}
 cancel(){if(!this.done){this.done=true;this.cancelled=true;this.reject(Error('cancelled'));}}
}
const complete=async()=>{animations.forEach(animation=>animation.finish());for(let i=0;i<4;i++)await Promise.resolve();};
const mutations=[],resizes=[],motions=[];
globalThis.matchMedia=()=>{const motion=new Node();motion.matches=false;motions.push(motion);return motion;};
globalThis.MutationObserver=class{constructor(fn){this.fn=fn;mutations.push(this);}observe(){}disconnect(){this.disconnected=true;}};
globalThis.ResizeObserver=class{constructor(fn){this.fn=fn;resizes.push(this);}observe(){}disconnect(){this.disconnected=true;}};
globalThis.window=new Node();globalThis.document=new Node();document.hidden=false;document.getElementById=()=>null;document.activeElement=null;
function fixture(count=3){
 const parent=document.append(new Node()),root=parent.append(new Node());
 const viewport=root.append(new Node('.highlight-slides'));
 const pages=Array.from({length:count},(_,i)=>{
  const page=viewport.append(new Node('[data-highlight-page]'));page.width=500;page.height=380+i*30;page.dataset.highlightTitle='Stories '+i;
  for(let j=0;j<2;j++){const slide=page.append(new Node('[data-highlight-slide]'));slide.append(new Node('a'));slide.append(new Node('p')).append(new Node('span'));}
  return page;
 });
 const controls=root.append(new Node('[data-highlight-controls]'));controls.hidden=true;
 const dots=Array.from({length:count},()=>controls.append(new Node('[data-highlight-dot]')));
 const status=root.append(new Node('[data-highlight-status]'));
 return {parent,root,viewport,pages,controls,status,dots};
}
const active=f=>f.dots.findIndex(dot=>dot.attrs['aria-current']==='true');
const idle=f=>{const current=active(f),next=(current+1)%f.pages.length;assert.deepEqual(f.pages.map(page=>page.hidden),f.pages.map((_,i)=>i!==current&&i!==next));assert.ok(f.pages.every((page,i)=>page.inert===(i!==current)));assert.ok(f.pages.every((page,i)=>page.attrs['aria-hidden']===(i===current?undefined:'true')));assert.deepEqual(f.pages.map(page=>page.style.transform),f.pages.map((_,i)=>i===current?'translateX(0%)':i===next?'translateX(100%)':''));assert.equal(f.viewport.children.length,f.pages.length,'visual wrap copies are removed at rest');};
let pointer=0,now=0;
// Touch captures its hit target implicitly. Capture changes take effect before
// the next pointer event, with lostpointercapture bubbling from the old target.
// This models event ordering, not native touchscreen/scroll arbitration.
function processCapture(id){
 const previous=pointerCapture.get(id);
 if(previous!==pendingPointerCapture.get(id))previous?.emit('lostpointercapture',{bubbles:true,pointerId:id});
 const next=pendingPointerCapture.get(id);
 if(next!==previous)next?.emit('gotpointercapture',{bubbles:true,pointerId:id});
 if(next)pointerCapture.set(id,next);else pointerCapture.delete(id);
}
function down(f,x=0,y=50,target=f.pages[active(f)].querySelector('a'),pointerType='touch'){
 const id=++pointer;now+=1000;
 if(pointerType==='touch')target.setPointerCapture(id);
 target.emit('pointerdown',{bubbles:true,isPrimary:true,button:0,pointerType,pointerId:id,clientX:x,clientY:y,timeStamp:now});return id;
}
function pointerEvent(type,id,x,y=50,dt=16){
 now+=dt;processCapture(id);
 const event=(pointerCapture.get(id)||document).emit(type,{bubbles:true,pointerId:id,clientX:x,clientY:y,timeStamp:now});
 if(type==='pointerup'||type==='pointercancel'){pendingPointerCapture.delete(id);processCapture(id);}
 return event;
}
const move=(id,x,y=50,dt=16)=>pointerEvent('pointermove',id,x,y,dt);
const up=(id,x,y=50,dt=16)=>pointerEvent('pointerup',id,x,y,dt);
const originalTimeout=globalThis.setTimeout;
let timerCalls=0;
try{
 const out=path.join(temp,'carousel.mjs'),markup=path.join(temp,'markup.mjs');
 await build({entryPoints:['web/discussion-carousel.ts'],bundle:true,platform:'node',format:'esm',outfile:out});
 await build({entryPoints:['lib/discussion-markup.ts'],bundle:true,platform:'node',format:'esm',outfile:markup});
 const {installDiscussionCarousel:install}=await import(pathToFileURL(out));
 const {groupDiscussionHighlights:group}=await import(pathToFileURL(markup));
 for(const counts of [[6],[15],[16],[18],[3,1,1,1],[5,2,1],[2,2,2],[10,3,2]]){
  // Single-array cases exercise many distinct stories; other cases repeat a
  // story count to prove pairing also works for older or imbalanced snapshots.
  const items=counts.length===1?Array.from({length:counts[0]},(_,i)=>({storyId:i,commentId:i})):
   counts.flatMap((count,storyId)=>Array.from({length:count},(_,i)=>({storyId,commentId:storyId*100+i})));
  const before=JSON.stringify(items),pages=group(items);
  assert.equal(pages.flat().length,items.length,'no saved comment dropped');
  assert.deepEqual(pages.flat().map(h=>h.commentId).sort((a,b)=>a-b),items.map(h=>h.commentId).sort((a,b)=>a-b),'no repeated or invented comment');
  assert.ok(pages.every(page=>page.length===1||page.length===2&&page[0].storyId!==page[1].storyId),'paired articles always differ');
  assert.equal(pages.length,Math.max(Math.ceil(items.length/2),counts.length===1?1:Math.max(...counts)),'no avoidable single-comment pages');
  assert.equal(JSON.stringify(items),before,'grouping does not mutate the snapshot');
  assert.deepEqual(group(items),pages,'deterministic grouping');
 }
 assert.deepEqual(group([]),[]);assert.deepEqual(group([{storyId:1},{storyId:1}]),[[{storyId:1}],[{storyId:1}]]);
 // Manual-only enhancement must never schedule autoplay, in either motion mode.
 globalThis.setTimeout=()=>{timerCalls++;throw Error('Manual discussion navigation must not start a timer');};
 assert.equal(typeof install(null),'function');
 for(const count of [0,1]){const f=fixture(count);install(f.root)();assert.equal(f.controls.hidden,true);assert.ok(f.pages.every(page=>!page.hidden));}
 const invalid=fixture();invalid.dots.pop().selector='unmatched';install(invalid.root)();assert.equal(invalid.controls.hidden,true);assert.ok(invalid.pages.every(page=>!page.hidden),'incomplete controls leave readable static content');
 const f=fixture();let destroy=install(f.root);
 assert.equal(f.viewport.style.minHeight,'440px','reserve tallest pair without CSS zoom double scaling');
 idle(f);assert.equal(f.controls.hidden,false);assert.deepEqual(f.dots.map(dot=>dot.tabIndex),[0,-1,-1]);assert.equal(f.status.textContent,'');
 f.dots[2].focus();f.dots[2].emit('click');assert.equal(active(f),2);assert.equal(document.activeElement,f.dots[2]);assert.match(f.status.textContent,/Discussion page 3 of 3: Stories 2/);
 assert.equal(animations.at(-1).options.duration,280,'dots animate without autoplay');assert.ok(f.pages[0].inert,'outgoing page immediately leaves keyboard/AX interaction');await complete();idle(f);
 let key=f.root.emit('keydown',{target:f.dots[2],key:'ArrowRight'});assert.ok(key.defaultPrevented);assert.equal(active(f),0);assert.equal(document.activeElement,f.dots[0]);await complete();idle(f);
 f.root.emit('keydown',{target:f.dots[0],key:'ArrowLeft'});assert.equal(active(f),2);assert.equal(document.activeElement,f.dots[2]);await complete();
 f.root.emit('keydown',{target:f.dots[2],key:'Home'});assert.equal(active(f),0);await complete();
 f.root.emit('keydown',{target:f.dots[0],key:'End'});assert.equal(active(f),2);await complete();
 key=f.root.emit('keydown',{target:f.dots[2],key:'ArrowRight',ctrlKey:true});assert.equal(key.defaultPrevented,false);assert.equal(active(f),2);
 for(const selector of ['input','textarea','select','[contenteditable]']){key=f.root.emit('keydown',{target:new Node(selector),key:'Home'});assert.equal(key.defaultPrevented,false);assert.equal(active(f),2);}
 const link=f.pages[2].querySelector('a');document.activeElement=link;
 key=f.root.emit('keydown',{target:link,key:'ArrowRight'});assert.ok(key.defaultPrevented);assert.equal(document.activeElement,f.dots[0],'focus leaves outgoing content before it becomes inert');await complete();idle(f);
 // Mobile regression: horizontal lock transfers implicit capture from the
 // touched comment/link to the viewport. Its bubbled loss must not cancel drag.
 for(const start of ['body','nested text','second comment','source link','inert peek'])for(const direction of [-1,1]){
  const before=active(f),page=f.pages[before],target=start==='inert peek'?f.viewport:start==='source link'?page.querySelector('a'):start==='nested text'?page.querySelector('span'):page.querySelectorAll('p')[start==='second comment'?1:0],losses=[];
  const onLoss=event=>losses.push({target:event.target,currentTarget:event.currentTarget});
  f.viewport.addEventListener('lostpointercapture',onLoss);
  const id=down(f,0,50,target);assert.equal(target.hasPointerCapture(id),true,'touch implicitly captures its hit target');
  move(id,direction*24,50,30);assert.equal(f.viewport.hasPointerCapture(id),true,'horizontal lock requests viewport capture');
  move(id,direction*40,50,30);
  assert.equal(f.root.dataset.dragging,'true',`${start}: descendant capture transfer must keep the gesture alive`);
  assert.equal(f.pages[before].style.transform,`translateX(${direction*8}%)`,`${start}: continued movement follows the finger`);
  assert.deepEqual(losses,start==='inert peek'?[]:[{target,currentTarget:f.viewport}],'only descendant starts transfer capture through the viewport listener');
  up(id,direction*40,50,20);assert.equal(active(f),(before+(direction<0?1:2))%3,`${start}: touch flick advances once`);
  assert.equal(f.viewport.hasPointerCapture(id),false);f.viewport.removeEventListener('lostpointercapture',onLoss);
  assert.ok(f.root.emit('click',{target,detail:1}).defaultPrevented,'completed touch drag cannot activate its source link');
  await complete();idle(f);
 }
 // Natural flicks work in both directions without requiring half a page.
 for(const direction of [-1,1])for(const pointerType of ['touch','mouse']){
  const before=active(f),dx=direction*32,id=down(f,0,50,undefined,pointerType);
  move(id,dx,50,45);assert.equal(f.pages[before].style.transform,`translateX(${dx/5}%)`,'page follows physical drag fraction');
  assert.equal(f.viewport.hasPointerCapture(id),true);
  up(id,dx,50,20);assert.equal(active(f),(before+(direction<0?1:2))%3,'short fresh directional flick advances');
  assert.equal(animations.at(-1).options.duration,280);assert.equal(f.viewport.hasPointerCapture(id),false);
  assert.ok(f.root.emit('click',{target:link,detail:1}).defaultPrevented,'drag compatibility click is suppressed');
  await complete();idle(f);
 }
 // A pause before movement is not a pause before release. Small pre-lock
 // samples preserve a fresh flick, even after resting a finger on the page.
 {const before=active(f),id=down(f);move(id,-4,50,500);move(id,-32,50,35);up(id,-32,50,20);assert.equal(active(f),(before+1)%3);await complete();idle(f);}
 // Realistic deceleration at release still advances for a sustained short flick.
 {const before=active(f),id=down(f);move(id,-15,50,20);move(id,-35,50,25);move(id,-39,50,20);up(id,-40,50,10);assert.equal(active(f),(before+1)%3);await complete();idle(f);}
 // Slow small moves, tiny fast jitter, and a flick held before release return.
 for(const [dx,travel,pause] of [[32,500,20],[19,15,10],[70,50,300]]){
  const before=active(f),id=down(f);move(id,-dx,50,travel);up(id,-dx,50,pause);
  assert.equal(active(f),before);assert.equal(animations.at(-1).options.duration,220);
  assert.ok(f.root.emit('click',{target:link,detail:1}).defaultPrevented);await complete();idle(f);
 }
 // Slow drags use20% of the page, capped at96CSSpx on wide screens.
 for(const direction of [-1,1])for(const dx of [95,96]){
  const before=active(f),id=down(f);move(id,direction*dx,50,700);up(id,direction*dx,50,200);
  assert.equal(active(f),dx===96?(before+(direction<0?1:2))%3:before);await complete();idle(f);
 }
 let before=active(f),id=down(f);move(id,-250);move(id,120);up(id,120);assert.equal(active(f),(before+2)%3,'full reversal uses final displacement');await complete();idle(f);
 before=active(f);id=down(f);move(id,-70,50,40);move(id,-30,50,30);up(id,-30,50,20);assert.equal(active(f),before,'reversed recent velocity cannot fling in the old direction');await complete();
 before=active(f);id=down(f);move(id,-1800);assert.equal(f.pages[before].style.transform,'translateX(-100%)','drag offset is bounded to one page');up(id,-1800);assert.equal(active(f),(before+1)%3,'long drag advances exactly once');await complete();
 for(const [x,y] of [[3,130],[35,90],[40,85]]){
  before=active(f);id=down(f);assert.equal(move(id,x,y).defaultPrevented,false,'vertical or near-diagonal gesture remains native');move(id,-500,150);up(id,-500,150);assert.equal(active(f),before,'vertical pan never becomes horizontal later');idle(f);
 }
 before=active(f);id=down(f);move(id,-400);pointerEvent('pointercancel',id,-400);up(id,-500);assert.equal(active(f),before,'pointercancel returns to current page');await complete();idle(f);
 id=down(f);move(id,-400);move(id,-420);assert.equal(pointerCapture.get(id),f.viewport);f.viewport.releasePointerCapture(id);processCapture(id);up(id,-500);assert.equal(active(f),before,'genuine viewport capture loss returns to current page');await complete();idle(f);
 id=down(f);move(id,-400);up(id+100,-500);assert.equal(active(f),before,'unrelated pointer cannot end drag');up(id,-400);await complete();
 // Inert neighbor/gap hits target the viewport, so its visible edge is draggable.
 before=active(f);id=down(f,0,50,f.viewport);move(id,-40);up(id,-40);assert.equal(active(f),(before+1)%3);await complete();idle(f);
 // Resize, filtering, visibility and page suspension cancel pending interaction.
 for(const interrupt of [()=>{f.viewport.width+=1;window.emit('resize');},()=>{f.parent.hidden=true;mutations.at(-1).fn();f.parent.hidden=false;mutations.at(-1).fn();},()=>{document.hidden=true;document.emit('visibilitychange');document.hidden=false;},()=>window.emit('pagehide'),()=>window.emit('blur')]){
  before=active(f);id=down(f);move(id,-400);interrupt();up(id,-500);assert.equal(active(f),before);idle(f);assert.ok(f.root.emit('click',{target:link}).defaultPrevented,'interrupted drag cannot click through');
 }
 // Ordinary link taps and tiny pointer movements are not suppressed.
 id=down(f);move(id,3);up(id,3);assert.equal(f.root.emit('click',{target:link}).defaultPrevented,false);
 assert.ok(f.root.emit('dragstart',{target:link}).defaultPrevented,'native link drag does not steal mouse gestures');
 id=down(f);move(id,-40);up(id,-40);await complete();id=down(f);up(id,0);assert.equal(f.root.emit('click',{target:f.pages[active(f)].querySelector('a'),detail:1}).defaultPrevented,false,'a fresh intentional source-link tap survives earlier drag suppression');

 // Pointer coordinates, page width, distance, slop and velocity all respect CSS zoom.
 f.pages.forEach(page=>{page.width=1000;page.layoutWidth=500;});before=active(f);id=down(f);move(id,-160,50,700);assert.equal(f.pages[before].style.transform,'translateX(-16%)');up(id,-160,50,200);assert.equal(active(f),before);await complete();
 id=down(f);move(id,-192,50,700);up(id,-192,50,200);assert.equal(active(f),(before+1)%3,'zoom2 capped distance scales to192physical pixels');await complete();
 before=active(f);id=down(f);move(id,-64,50,45);up(id,-64,50,20);assert.equal(active(f),(before+1)%3,'zoom2 short flick matches the unzoomed gesture');await complete();
 f.pages.forEach(page=>{page.width=500;page.layoutWidth=500;});
 // Narrow pages retain a proportional threshold rather than requiring96px.
 f.pages.forEach(page=>{page.width=240;page.layoutWidth=240;});before=active(f);id=down(f);move(id,-47,50,500);up(id,-47,50,200);assert.equal(active(f),before);await complete();
 id=down(f);move(id,-48,50,500);up(id,-48,50,200);assert.equal(active(f),(before+1)%3);await complete();f.pages.forEach(page=>{page.width=500;page.layoutWidth=500;});
 // Reduced motion retains direct finger tracking, but settling is instantaneous.
 motions.at(-1).matches=true;motions.at(-1).emit('change');before=active(f);const animationCount=animations.length;
 id=down(f);move(id,-32,50,500);assert.equal(f.pages[before].style.transform,'translateX(-6.4%)');up(id,-32,50,200);assert.equal(active(f),before);idle(f);
 id=down(f);move(id,-400);up(id,-400);assert.equal(active(f),(before+1)%3);idle(f);assert.equal(animations.length,animationCount);
 f.dots[0].emit('click');idle(f);assert.equal(animations.length,animationCount);motions.at(-1).matches=false;
 // New input safely interrupts an unfinished settle without duplicate movement.
 f.dots[1].emit('click');const interrupted=animations.slice(-3);id=down(f);assert.ok(interrupted.every(animation=>animation.cancelled));move(id,-400);up(id,-400);assert.equal(active(f),2);await complete();idle(f);
 f.dots[0].emit('click');f.dots[1].emit('click');f.root.emit('keydown',{target:f.dots[1],key:'ArrowRight'});assert.equal(active(f),2);await complete();idle(f);
 // A new intentional tap or keyboard click is not the compatibility click
 // from the preceding drag, even inside its short suppression window.
 id=down(f);move(id,-400);up(id,-400);await complete();
 f.root.emit('pointerdown',{target:f.dots[1],isPrimary:true,button:0,pointerId:++pointer,clientX:0,clientY:0});
 assert.equal(f.root.emit('click',{target:f.dots[1],detail:1}).defaultPrevented,false,'fresh dot tap survives prior drag suppression');f.dots[1].emit('click');assert.equal(active(f),1);await complete();
 id=down(f);move(id,-400);up(id,-400);await complete();
 assert.equal(f.root.emit('click',{target:f.dots[0],detail:0}).defaultPrevented,false,'keyboard activation survives prior drag suppression');f.dots[0].emit('click');assert.equal(active(f),0);await complete();
 f.dots[2].emit('click');await complete();
 f.pages[2].height=500;window.emit('resize');assert.equal(f.viewport.style.minHeight,'500px');idle(f);
 f.parent.hidden=true;f.pages[2].height=560;mutations.at(-1).fn();assert.equal(f.viewport.style.minHeight,'500px');f.parent.hidden=false;mutations.at(-1).fn();assert.equal(f.viewport.style.minHeight,'560px');
 f.viewport.width=390;f.pages[2].height=600;resizes.at(-1).fn();assert.equal(f.viewport.style.minHeight,'600px');
 f.dots[2].focus();destroy();assert.equal(document.activeElement,f.pages[2].querySelector('a'));assert.equal(f.viewport.style.minHeight,'');assert.ok(f.pages.every(page=>!page.hidden&&!page.inert));assert.equal(f.controls.hidden,true);assert.ok(resizes.at(-1).disconnected);assert.ok(mutations.at(-1).disconnected);assert.ok(Object.values(f.root.listeners).every(list=>!list.length));
 document.activeElement=null;destroy=install(f.root);const firstObserver=resizes.at(-1),oldDestroy=destroy;destroy=install(f.root);assert.ok(firstObserver.disconnected);oldDestroy();assert.equal(f.controls.hidden,false);firstObserver.fn();f.dots[1].emit('click');f.root.emit('keydown',{target:f.dots[1],key:'ArrowRight'});assert.equal(active(f),2,'repeated setup never duplicates handlers');await complete();destroy();
 const focused=fixture();document.activeElement=focused.pages[1].querySelector('a');destroy=install(focused.root);assert.equal(active(focused),1);assert.equal(document.activeElement,focused.pages[1].querySelector('a'));destroy();document.activeElement=null;
 // With two pages, wrapping temporarily needs an inert visual copy at an edge.
 const pair=fixture(2);destroy=install(pair.root);
 for(const direction of [-1,1,-1,1]){
  const current=active(pair);id=down(pair,0,50,pair.viewport);move(id,direction*70);
  const copy=pair.viewport.children.find(page=>!pair.pages.includes(page));assert.ok(copy,'two-page drag has a visual wrap copy');assert.ok(copy.inert);assert.equal(copy.attrs['aria-hidden'],'true');assert.equal(pair.root.querySelectorAll('[data-highlight-page]').length,2);
  up(id,direction*70);assert.equal(active(pair),1-current);await complete();idle(pair);
 }
 destroy();assert.equal(pair.viewport.children.length,2);
 const SavedResize=globalThis.ResizeObserver,SavedMutation=globalThis.MutationObserver;delete globalThis.ResizeObserver;delete globalThis.MutationObserver;
 const basic=fixture(2);basic.pages.forEach(page=>page.animate=undefined);destroy=install(basic.root);basic.dots[1].emit('click');assert.equal(active(basic),1);idle(basic);destroy();globalThis.ResizeObserver=SavedResize;globalThis.MutationObserver=SavedMutation;
 await complete();
 assert.equal(timerCalls,0);
 const css=fs.readFileSync('app/globals.css','utf8');assert.match(css,/\.highlight-slide a:focus-visible\{outline-offset:-2px\}/,'contained source-link focus ring cannot be clipped by the moving viewport');assert.match(css,/\.highlight-dot\{[^}]*width:28px;[^}]*height:44px/,'28×44px dots fit eight on a 320px screen and exceed the WCAG 24px minimum');assert.ok(!css.includes('[data-highlight-toggle]'));assert.match(css,/\.topic-desk\{border-top:2px solid var\(--ink\)/);assert.match(css,/\.more-stories\{border-top:2px solid var\(--ink\)/);assert.match(css,/#discussion-highlights\{[^}]*border-bottom:0/);assert.match(css,/\.highlight-page:last-child \.highlight-slide:last-child\{border-bottom:0\}/,'no-JS last comment leaves just the next desk divider');
 assert.match(css,/width:83\.333333%;padding-right:24px/,'roughly one-fifth of next page peeks at rest');assert.match(css,/\.highlight-page\[inert\]\{pointer-events:none\}/,'inert peek routes pointer starts to viewport');assert.match(css,/--highlight-paper:#faf9f6/);assert.match(css,/--highlight-paper:#1b1b19/);
 console.log('PASS: pairing; no autoplay; bubbling implicit touch-capture transfers from comment bodies/nested text/links versus viewport peek; genuine capture loss; finger tracking; short touch/mouse flicks and capped/proportional slow drags; held/reversed flick rejection; vertical/diagonal lock; wrap/peek including two-page copies; cancellation, zoom2, interrupted settling, reduced motion, focus/AX safety, links/dots/keyboard, no-JS and teardown.');
}finally{globalThis.setTimeout=originalTimeout;fs.rmSync(temp,{recursive:true,force:true});}
