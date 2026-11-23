// Use the existing masthead links so the picker stays in sync with the edition.
const mobileSectionsMedia='(max-width: 680px)';
function installMobileSections(){
 const top=document.querySelector<HTMLElement>('nav.sections'),footer=document.querySelector<HTMLElement>('main.paper > footer');
 if(!top||!footer||typeof IntersectionObserver==='undefined'||typeof MutationObserver==='undefined'||typeof HTMLDialogElement==='undefined'||typeof HTMLDialogElement.prototype.showModal!=='function')return;
 const media=matchMedia(mobileSectionsMedia);
 let trigger:HTMLButtonElement|undefined,sheet:HTMLDialogElement|undefined,end:HTMLElement|undefined,observer:IntersectionObserver|undefined;
 let topVisible=true,endVisible=false;
 const active=new MutationObserver(mark);
 function showTrigger(){if(trigger)trigger.hidden=!media.matches||topVisible||endVisible;}
 function mark(){
  const current=top!.querySelector<HTMLElement>('[aria-current=page]')?.dataset.section||'Today';
  for(const el of [sheet,end])el?.querySelectorAll<HTMLElement>('[data-mobile-section]').forEach(a=>{
   if(a.dataset.mobileSection===current)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
  });
 }
 function addLinks(list:Element){
  for(const source of top!.querySelectorAll<HTMLAnchorElement>('a[href]')){
   const item=document.createElement('a'),section=source.dataset.section;
   item.href=source.href;item.textContent=source.textContent;
   if(section)item.dataset.mobileSection=section;
   item.addEventListener('click',event=>{
    if(event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
    if(section){
     event.preventDefault();sheet?.close();
     // Route through the original link so the edition reader owns URL, search,
     // current section, history and Back/Forward behavior.
     source.click();
     const destination=document.querySelector<HTMLElement>(section==='Today'?'.masthead .brand':'#filtered-heading');
     if(destination){if(section!=='Today')destination.tabIndex=-1;destination.focus({preventScroll:true});}
     window.scrollTo({top:0,behavior:'instant'});
    }
    else sheet?.close(); // Developing News retains its real route.
   });
   list.appendChild(item);
  }
 }
 function sync(){
  if(!media.matches){sheet?.close();observer?.disconnect();active.disconnect();trigger?.remove();sheet?.remove();end?.remove();trigger=sheet=end=observer=undefined;return;}
  if(trigger)return;
  topVisible=top!.getBoundingClientRect().bottom>0;endVisible=false;
  trigger=document.createElement('button');trigger.type='button';trigger.className='mobile-sections-trigger';trigger.hidden=true;
  trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-controls','mobile-sections-sheet');
  trigger.innerHTML='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M5 6h14M5 12h14M5 18h14"/></svg> Sections';
  sheet=document.createElement('dialog');sheet.id='mobile-sections-sheet';sheet.className='mobile-sections-sheet';
  sheet.setAttribute('aria-labelledby','mobile-sections-title');
  sheet.innerHTML='<div class="mobile-sections-handle" aria-hidden="true"></div><div class="mobile-sections-heading"><h2 id="mobile-sections-title">Sections</h2><button type="button" class="mobile-sections-close" aria-label="Close sections" autofocus>×</button></div><nav class="mobile-sections-links" aria-label="Choose a section"></nav>';
  end=document.createElement('nav');end.className='mobile-sections-index';end.setAttribute('aria-labelledby','mobile-sections-index-title');
  end.innerHTML='<h2 id="mobile-sections-index-title">Explore sections</h2><div class="mobile-sections-links"></div>';
  addLinks(sheet.querySelector('nav')!);addLinks(end.querySelector('.mobile-sections-links')!);
  footer!.insertBefore(end,footer!.firstChild);document.body.appendChild(trigger);document.body.appendChild(sheet);
  trigger.addEventListener('click',()=>{if(!sheet?.open)sheet?.showModal();});
  sheet.querySelector('button')!.addEventListener('click',()=>sheet?.close());
  sheet.addEventListener('click',event=>{if(event.target===sheet&&event.clientY<sheet.getBoundingClientRect().top)sheet.close();});
  observer=new IntersectionObserver(entries=>{
   for(const entry of entries){
    if(entry.target===top)topVisible=entry.isIntersecting||entry.boundingClientRect.top>=0;
    if(entry.target===end)endVisible=entry.isIntersecting;
   }
   showTrigger();
  });
  observer.observe(top!);observer.observe(end);
  active.observe(top!,{subtree:true,attributes:true,attributeFilter:['aria-current']});
  mark();
 }
 media.addEventListener('change',sync);sync();
}
if(typeof document!=='undefined')installMobileSections();
