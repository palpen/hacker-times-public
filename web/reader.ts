import {installDiscussionCarousel} from './discussion-carousel';
import {articleMarkup} from '../lib/markup';
import {THEME_KEY,resolveTheme,nextTheme,type Theme} from '../lib/theme';
import {categories} from '../lib/contracts';
import type {Story} from '../lib/news';
export function filterStories(stories:Story[],section:string,query:string,ranked=false){const q=query.trim().toLowerCase();const result=stories.filter(s=>(section==='Today'||s.category===section||s.topics?.includes(section as typeof categories[number]))&&(!q||`${s.headline} ${s.summary} ${s.publisher}`.toLowerCase().includes(q)));return ranked?result.sort((a,b)=>(b.editorialScore??0)-(a.editorialScore??0)||b.time-a.time||a.id-b.id):result;}
export type SectionAge='recent'|'earlier';
// Snapshot-relative HN submission age, not publication age or the viewer's clock.
export function sectionStories(stories:Story[],section:string,query:string,generatedAt:string,age:SectionAge='recent'){
 const at=Date.parse(generatedAt)/1000;
 return filterStories(stories,section,query,true).filter(story=>{
  const elapsed=at-story.time;
  return elapsed>0&&elapsed<=30*86400;
 });
}
export function readerLocation(href:string){const u=new URL(href),params=u.searchParams;const requested=params.get('section')||u.hash.replace(/^#desk-/,'');const section=categories.find(c=>c.toLowerCase()===requested.toLowerCase())||'Today';return {section,query:params.get('q')||'',};}
export function readerURL(href:string,section:string,query:string,age:SectionAge='recent'){const u=new URL(href),params=u.searchParams;params.delete('refresh');for(const [key,value] of [['age',''],['section',section==='Today'?'':section],['q',query.trim()?query:'']])if(value)params.set(key,value);else params.delete(key);u.hash='';return u.pathname+u.search;}
function listen<K extends keyof WindowEventMap>(target:EventTarget,event:K,handler:(event:WindowEventMap[K])=>void,capture?:boolean){target.addEventListener(event,handler as EventListener,capture);}
const attribute=(element:Element,name:string,value:string)=>element.setAttribute(name,value);
const $=(id:string)=>document.getElementById(id)!;
const all=(selector:string)=>document.querySelectorAll(selector);
const action=(name:string)=>document.querySelector('[data-action="'+name+'"]')!;
type CommentModule=Pick<typeof import('./comments'),'createCommentsReader'>;
export function installCommentLinks(stories:Story[],assetURL?:string,archiveDate?:string,commentsCssAsset?:string,publicationVersion?:string,load:(url:string)=>Promise<CommentModule>=url=>import(/* @vite-ignore */ url)){
 // Only fetch the comments module after an ordinary discussion-link click.
 let commentsModule:Promise<Awaited<ReturnType<typeof import('./comments').createCommentsReader>>>|undefined,commentClick=0;
 listen(document,'click',async event=>{
  if(event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||!(event.target instanceof Element))return;
  const anchor=event.target.closest<HTMLAnchorElement>('a.discussion-link'),asset=assetURL;
  if(!anchor||!asset||!/^\/reader-assets\/comments-[a-f0-9]{16}\.js$/.test(asset)||typeof HTMLDialogElement==='undefined'||typeof HTMLDialogElement.prototype.showModal!=='function')return;
  const id=Number(anchor.closest<HTMLElement>('[data-story-id]')?.dataset.storyId);
  if(!stories.some(story=>story.id===id)||anchor.href!=='https://news.ycombinator.com/item?id='+id)return;
  event.preventDefault();const click=++commentClick,notice=$('notice');
  const fallback=document.createElement('a');fallback.href=anchor.href;fallback.target='_blank';fallback.rel='noopener noreferrer';fallback.textContent='Read on Hacker News ↗';
  const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';listen(cancel,'click',()=>{commentClick++;notice.hidden=true;anchor.focus();});
  const message=document.createElement('span');message.textContent='Opening discussion…';notice.replaceChildren(message,fallback,cancel);notice.hidden=false;
  try{
   commentsModule??=load(asset).then(module=>module.createCommentsReader(stories,archiveDate,commentsCssAsset,publicationVersion)).catch(error=>{commentsModule=undefined;throw error;});
   const comments=await commentsModule;if(click!==commentClick)return;notice.hidden=true;
   if(!comments.open(id,anchor))location.href=anchor.href;
  }catch{if(click!==commentClick)return;message.textContent='The discussion reader could not be opened.';cancel.textContent='Dismiss';}
 });
}
export function startReader(){
 installDiscussionCarousel();
 const data=JSON.parse($('edition-data').textContent||'{}') as {generatedAt:string;layoutVersion?:number;freshnessPolicyVersion?:number;stories:Story[];version:string;commentsAsset?:string;commentsCssAsset?:string};
 const search=$('search') as HTMLInputElement;
 const media=matchMedia('(prefers-color-scheme: dark)');let section='Today';let query='';let age:SectionAge='recent';let theme:Theme='light';
 const fresh=data.freshnessPolicyVersion===1,resultsNode=$('filtered-stories'),empty=$('empty-results');
 const panel=(id:string,open:boolean)=>{$(id).hidden=!open;const toggle=id==='search-box'?'search-toggle':id==='archive-box'?'archive-toggle':'about-toggle';attribute($(toggle),'aria-expanded',String(open));};
 function applyTheme(selected:Theme){theme=selected;document.documentElement.dataset.theme=selected;document.documentElement.style.colorScheme=selected;const button=$('theme-toggle'),dark=selected==='dark';attribute(button,'aria-label','Switch to '+(dark?'light':'dark')+' mode');attribute(button,'aria-pressed',String(dark));button.title=dark?'Light mode':'Dark mode';}
 function systemTheme(){let saved=null;try{saved=localStorage.getItem(THEME_KEY)}catch{}applyTheme(resolveTheme(saved,media.matches));}
 systemTheme();listen(media,'change',systemTheme);
 listen($('theme-toggle'),'click',()=>{const selected=nextTheme(theme);try{localStorage.setItem(THEME_KEY,selected)}catch{}applyTheme(selected);});
 listen($('reset-theme'),'click',()=>{try{localStorage.removeItem(THEME_KEY)}catch{}systemTheme();});
 function clearSearch(){query='';search.value='';panel('search-box',false);}
 function showResults(){
  const searching=!!query.trim(),filtered=section!=='Today'||searching;
  $('today-view').hidden=filtered;$('filtered-view').hidden=!filtered;
  all('.sections [data-section]').forEach(n=>{const active=(n as HTMLElement).dataset.section===section;n.classList.toggle('active',active);if(active)attribute(n,'aria-current','page');else n.removeAttribute('aria-current');});
  if(filtered){
   const results=fresh?sectionStories(data.stories,section,query,data.generatedAt,age):filterStories(data.stories,section,query,data.layoutVersion===3);
   $('filtered-heading').textContent=searching?(fresh&&section!=='Today'?section+' search results':'Search results'):section;
   resultsNode.innerHTML=results.map(s=>articleMarkup(s)).join('');empty.hidden=!!results.length;

  }else resultsNode.replaceChildren();
 }
 function saveLocation(push=false){const target=readerURL(location.href,section,query,age),url=new URL(location.href);if(target!==url.pathname+url.search+url.hash)history[push?'pushState':'replaceState'](null,'',target);}
 function restoreLocation(){const state=readerLocation(location.href);section=state.section;query=state.query;age='recent';search.value=query;panel('search-box',!!query);showResults();}
 listen(window,'popstate',restoreLocation);listen(window,'hashchange',restoreLocation);
 all('[data-section]').forEach(n=>listen(n,'click',e=>{e.preventDefault();section=(n as HTMLElement).dataset.section!;age='recent';clearSearch();saveLocation(true);showResults();if(n.closest('.topic-desk'))window.scrollTo({top:0,behavior:'auto'});}));
 listen($('search-toggle'),'click',()=>{const open=$('search-box').hidden;panel('search-box',open);if(open)search.focus();});
 listen($('search-box'),'submit',e=>e.preventDefault());listen(search,'input',e=>{query=(e.target as HTMLInputElement).value;saveLocation();showResults();});
 listen(action('search-close'),'click',()=>{clearSearch();saveLocation();showResults();$('search-toggle').focus();});
 listen($('about-toggle'),'click',()=>{panel('about-panel',$('about-panel').hidden);panel('archive-box',false);});
 let archiveLoaded=false;
 listen($('archive-toggle'),'click',async()=>{const open=$('archive-box').hidden;panel('archive-box',open);panel('about-panel',false);if(!open)return;window.scrollTo({top:0,behavior:'auto'});if(archiveLoaded)return;try{const r=await fetch('/api/archive');if(!r.ok)throw Error();const a=await r.json() as {dates:string[]};const links=$('archive-links');links.replaceChildren();for(const date of ['',...a.dates.filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d))]){const link=document.createElement('a');link.href=date?'/?date='+date:'/';link.textContent=date?new Date(date+'T12:00:00Z').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'UTC'}):'Latest edition';links.appendChild(link);}archiveLoaded=true;}catch{$('notice').textContent='Past editions are temporarily unavailable.';$('notice').hidden=false;}});
 for(const name of ['about','archive'])listen(action(name+'-close'),'click',()=>{panel(name==='about'?'about-panel':'archive-box',false);$(name+'-toggle').focus();});
 listen($('refresh-edition'),'click',()=>{location.href='/?refresh=1';});
 const url=new URL(location.href);if(url.searchParams.has('refresh')){url.searchParams.delete('refresh');history.replaceState(null,'',url.pathname+url.search+url.hash);}
 restoreLocation();
 const archived=/^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('date')||'');$('archive-label').hidden=!archived;$('stale-notice').hidden=archived||Date.now()-Date.parse(data.generatedAt)<=12*3600000;
 installCommentLinks(data.stories,data.commentsAsset,archived?url.searchParams.get('date')!:undefined,data.commentsCssAsset,data.version);
 const rail=$('story-rail');const scroll=(left:number)=>rail?.scrollBy({left,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
 all('[data-scroll]').forEach(n=>listen(n,'click',()=>scroll(+(n as HTMLElement).dataset.scroll!)));rail&&listen(rail,'keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();scroll(e.key==='ArrowRight'?300:-300);}});
 listen(document,'error',e=>{if(e.target instanceof HTMLImageElement)e.target.closest('figure')?.remove();},true);
}
if(typeof document!=='undefined')startReader();
