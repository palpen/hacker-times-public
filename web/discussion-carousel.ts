// Manual-only progressive enhancement: direct manipulation, never autoplay.
const installed=new WeakMap<HTMLElement,()=>void>();
export function installDiscussionCarousel(root:HTMLElement|null=document.getElementById('discussion-highlights')){
 if(!root)return ()=>{};
 installed.get(root)?.();
 const pages=Array.from(root.querySelectorAll<HTMLElement>('[data-highlight-page]'));
 const dots=Array.from(root.querySelectorAll<HTMLButtonElement>('[data-highlight-dot]'));
 const controls=Array.from(root.querySelectorAll<HTMLElement>('[data-highlight-controls]'));
 const status=root.querySelector<HTMLElement>('[data-highlight-status]');
 const viewport=root.querySelector<HTMLElement>('.highlight-slides'),originalHeight=viewport?.style.minHeight;
 if(pages.length<2||dots.length!==pages.length||!controls.length||!viewport)return ()=>{};
 const cleanups:Array<()=>void>=[],motion=typeof matchMedia==='function'?matchMedia('(prefers-reduced-motion: reduce)'):undefined;
 let disposed=false,index=Math.max(0,pages.findIndex(page=>page.contains(document.activeElement))),measuredWidth=0,generation=0;
 let animations:Animation[]=[],suppressUntil=0,clone:HTMLElement|undefined,cloneIndex=-1;
 let swipe:{id:number;x:number;y:number;width:number;scale:number;dx:number;locked:boolean;samples:Array<[number,number]>}|undefined;
 const listen=(target:EventTarget,event:string,handler:EventListener,capture=false)=>{target.addEventListener(event,handler,capture);cleanups.push(()=>target.removeEventListener(event,handler,capture));};
 const wrap=(value:number)=>(value%pages.length+pages.length)%pages.length;
 const transform=(fraction:number)=>`translateX(${fraction*100}%)`;
 const removeClone=()=>{clone?.remove();clone=undefined;cloneIndex=-1;};
 function access(){pages.forEach((page,i)=>{page.inert=i!==index;if(i===index)page.removeAttribute('aria-hidden');else page.setAttribute('aria-hidden','true');});}
 function rest(){removeClone();pages.forEach((page,i)=>{page.hidden=i!==index&&i!==wrap(index+1);page.style.transform=page.hidden?'':transform(i===index?0:1);});access();delete root!.dataset.dragging;}
 function stopMotion(){generation++;animations.forEach(animation=>animation.cancel());animations=[];rest();}
 function release(){const id=swipe?.id;swipe=undefined;if(id!==undefined&&viewport!.hasPointerCapture?.(id))viewport!.releasePointerCapture(id);delete root!.dataset.dragging;}
 function abort(){if(swipe?.locked)suppressUntil=Date.now()+700;release();stopMotion();}
 function measure(){
  if(disposed)return;
  const width=viewport!.getBoundingClientRect().width;
  if(!width||root!.closest('[hidden]')){abort();return;}
  if(width!==measuredWidth)abort();measuredWidth=width;
  let height=0;
  pages.forEach(page=>{const hidden=page.hidden;page.hidden=false;height=Math.max(height,page.offsetHeight);page.hidden=hidden;});
  viewport!.style.minHeight=Math.ceil(height)+'px';
 }
 function select(next:number,manual=false){
  const moveFocus=next!==index&&pages[index].contains(document.activeElement);
  index=next;
  dots.forEach((dot,i)=>{dot.setAttribute('aria-current',i===index?'true':'false');dot.tabIndex=i===index?0:-1;});
  // Focus moves before the outgoing page becomes inert or hidden.
  if(moveFocus)dots[index].focus();
  access();
  if(manual&&status)status.textContent=`Discussion page ${index+1} of ${pages.length}${pages[index].dataset.highlightTitle?': '+pages[index].dataset.highlightTitle:''}`;
 }
 function position(from:number,to:number,direction:number,progress:number){
  const preview=wrap(direction>0?to+1:from+1);
  // Two-page wrapping can show the same pair at both edges. Its temporary
  // visual copy has no IDs, keyboard targets or accessibility-tree exposure.
  if(preview===from||preview===to){
   if(cloneIndex!==preview){removeClone();clone=pages[preview].cloneNode(true) as HTMLElement;cloneIndex=preview;
    clone.removeAttribute('id');clone.removeAttribute('data-highlight-page');clone.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
    clone.setAttribute('aria-hidden','true');clone.inert=true;viewport!.appendChild(clone);
   }
  }else removeClone();
  pages.forEach(page=>{page.hidden=true;page.style.transform='';});
  const shown=[{page:pages[from],start:progress},{page:pages[to],start:progress+direction},{page:clone||pages[preview],start:progress+(direction>0?2:1)}];
  shown.forEach(({page,start})=>{page.hidden=false;page.style.transform=transform(start);});
  return shown;
 }
 function settle(from:number,to:number,direction:number,advance:boolean,progress=0){
  const shown=position(from,to,direction,progress);
  if(advance)select(to,true);
  if(motion?.matches||!pages[from].animate){rest();return;}
  const token=++generation;
  try{
   animations=shown.map(({page,start})=>{
    const end=start-progress-(advance?direction:0);page.style.transform=transform(end);
    return page.animate([{transform:transform(start)},{transform:transform(end)}],{duration:advance?280:220,easing:'cubic-bezier(.22,.61,.36,1)'});
   });
   Promise.all(animations.map(animation=>animation.finished)).then(()=>{if(!disposed&&token===generation){animations=[];rest();}},()=>{});
  }catch{stopMotion();}
 }
 function navigate(value:number,direction?:number){
  if(disposed)return;
  abort();const next=wrap(value);if(next===index)return;
  settle(index,next,direction??(next>index?1:-1),true);
 }
 function drag(event:PointerEvent){
  if(!swipe||event.pointerId!==swipe.id)return;
  const dx=event.clientX-swipe.x,dy=event.clientY-swipe.y,slop=8*swipe.scale;
  swipe.samples.push([event.clientX,event.timeStamp]);
  while(swipe.samples.length>2&&swipe.samples[0][1]<event.timeStamp-100)swipe.samples.shift();
  if(!swipe.locked){
   if(Math.abs(dy)>slop&&Math.abs(dx)<=Math.abs(dy)*1.2){release();return;}
   if(Math.abs(dx)<=slop||Math.abs(dx)<=Math.abs(dy)*1.2)return;
   swipe.locked=true;root!.dataset.dragging='true';
   // Capture only a confirmed horizontal gesture. Native vertical panning and
   // ordinary taps remain available, including drags begun on the inert peek.
   try{viewport!.setPointerCapture?.(swipe.id);}catch{/* Pointer may already have ended. */}
  }
  swipe.dx=dx;event.preventDefault();
  const direction=dx<0?1:-1,progress=Math.max(-1,Math.min(1,dx/swipe.width));
  position(index,wrap(index+direction),direction,progress);
 }
 function finish(cancel=false){
  if(!swipe)return;
  const {dx,width,scale,locked,samples}=swipe;release();
  if(!locked)return;
  suppressUntil=Date.now()+700;
  const direction=dx<0?1:-1,progress=Math.max(-1,Math.min(1,dx/width)),last=samples[samples.length-1];
  const velocity=(last[0]-samples[0][0])/Math.max(1,last[1]-samples[0][1])/scale;
  // A deliberate short flick or a modest drag advances exactly one page.
  // Recent samples reject held/reversed flings; all thresholds respect zoom.
  const advance=Math.abs(dx)>=Math.min(width*.2,96*scale)||(Math.abs(dx)>=20*scale&&Math.abs(velocity)>=.35&&velocity*dx>0);
  settle(index,wrap(index+direction),direction,!cancel&&advance,progress);
 }
 controls.forEach(control=>control.hidden=false);
 root.dataset.enhanced='true';root.setAttribute('aria-roledescription','carousel');
 pages.forEach((page,i)=>{page.setAttribute('role','group');page.setAttribute('aria-roledescription','slide');page.setAttribute('aria-label',`${i+1} of ${pages.length}`);});
 dots.forEach((dot,i)=>listen(dot,'click',()=>navigate(i)));
 listen(root,'keydown',event=>{
  const e=event as KeyboardEvent,target=e.target as Element;
  if(e.altKey||e.ctrlKey||e.metaKey||e.shiftKey||target.closest('input,textarea,select,[contenteditable]'))return;
  let next:number,direction:number|undefined;
  if(e.key==='ArrowLeft'){next=index-1;direction=-1;}
  else if(e.key==='ArrowRight'){next=index+1;direction=1;}
  else if(e.key==='Home')next=0;
  else if(e.key==='End')next=pages.length-1;
  else return;
  e.preventDefault();navigate(next,direction);
  if(target.closest('[data-highlight-dot]'))dots[index].focus();
 });
 listen(root,'pointerdown',event=>{
  const e=event as PointerEvent;
  if(!e.isPrimary||e.button!==0)return;
  abort();suppressUntil=0;if(!viewport.contains(e.target as Node))return;
  const width=pages[index].getBoundingClientRect().width,scale=width/pages[index].offsetWidth;
  if(width&&scale)swipe={id:e.pointerId,x:e.clientX,y:e.clientY,width,scale,dx:0,locked:false,samples:[[e.clientX,e.timeStamp]]};
 });
 listen(document,'pointermove',event=>drag(event as PointerEvent));
 listen(document,'pointerup',event=>{const e=event as PointerEvent;if(swipe?.id!==e.pointerId)return;drag(e);finish();});
 listen(document,'pointercancel',event=>{if(swipe?.id===(event as PointerEvent).pointerId)finish(true);});
 // Implicit touch capture transfers from the touched descendant on lock.
 // Its lostpointercapture bubbles here; only loss by the viewport cancels.
 listen(viewport,'lostpointercapture',event=>{if(event.target===viewport&&swipe?.id===(event as PointerEvent).pointerId)finish(true);});
 listen(root,'dragstart',event=>{if(viewport.contains(event.target as Node))event.preventDefault();});
 listen(root,'selectstart',event=>{if(swipe)event.preventDefault();});
 listen(root,'click',event=>{if((event as MouseEvent).detail!==0&&Date.now()<suppressUntil){event.preventDefault();event.stopImmediatePropagation();suppressUntil=0;}},true);
 listen(window,'pagehide',abort);listen(window,'blur',abort);
 listen(document,'visibilitychange',()=>{if(document.hidden)abort();});
 listen(window,'resize',measure);
 if(motion)listen(motion,'change',()=>{if(motion.matches)abort();});
 const resize=typeof ResizeObserver!=='undefined'?new ResizeObserver(()=>{if(viewport.getBoundingClientRect().width!==measuredWidth)measure();}):undefined;resize?.observe(viewport);
 const mutation=typeof MutationObserver!=='undefined'?new MutationObserver(measure):undefined;
 for(let ancestor:HTMLElement|null=root;ancestor;ancestor=ancestor.parentElement)mutation?.observe(ancestor,{attributes:true,attributeFilter:['hidden','style','class']});
 select(index);rest();measure();document.fonts?.ready.then(measure);
 const destroy=()=>{
  if(disposed)return;disposed=true;abort();resize?.disconnect();mutation?.disconnect();cleanups.forEach(cleanup=>cleanup());
  viewport.style.minHeight=originalHeight||'';
  if(dots.some(dot=>dot===document.activeElement))pages[index].querySelector<HTMLElement>('a')?.focus();
  pages.forEach(page=>{page.hidden=false;page.inert=false;page.style.transform='';page.removeAttribute('aria-hidden');page.removeAttribute('role');page.removeAttribute('aria-roledescription');page.removeAttribute('aria-label');});
  controls.forEach(control=>control.hidden=true);
  dots.forEach(dot=>{dot.removeAttribute('aria-current');dot.removeAttribute('tabindex');});
  if(status)status.textContent='';delete root.dataset.enhanced;root.removeAttribute('aria-roledescription');installed.delete(root);
 };
 installed.set(root,destroy);return destroy;
}
