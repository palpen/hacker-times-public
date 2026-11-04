import {installDiscussionCarousel} from './discussion-carousel';
import {articleMarkup} from '../lib/markup';
import {THEME_KEY,resolveTheme,nextTheme,type Theme} from '../lib/theme';
import type {Story} from '../lib/news';
export function filterStories(stories:Story[],section:string,query:string){const q=query.trim().toLowerCase();return stories.filter(s=>(section==='Today'||s.category===section||s.topics?.some(topic=>topic===section))&&(!q||`${s.headline} ${s.summary} ${s.publisher}`.toLowerCase().includes(q)));}
const $=(id:string)=>document.getElementById(id)!;
const all=(selector:string)=>document.querySelectorAll(selector);
type CommentModule=Pick<typeof import('./comments'),'createCommentsReader'>;
export function installCommentLinks(stories:Story[],assetURL?:string,archiveDate?:string,commentsCssAsset?:string,publicationVersion?:string,load:(url:string)=>Promise<CommentModule>=url=>import(/* @vite-ignore */ url)){
 // Only fetch the comments module after an ordinary discussion-link click.
 let commentsModule:Promise<Awaited<ReturnType<typeof import('./comments').createCommentsReader>>>|undefined,commentClick=0;
 document.addEventListener('click',async event=>{
  if(event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||!(event.target instanceof Element))return;
  const anchor=event.target.closest<HTMLAnchorElement>('a.discussion-link'),asset=assetURL;
  if(!anchor||!asset||!/^\/reader-assets\/comments-[a-f0-9]{16}\.js$/.test(asset)||typeof HTMLDialogElement==='undefined'||typeof HTMLDialogElement.prototype.showModal!=='function')return;
  const id=Number(anchor.closest<HTMLElement>('[data-story-id]')?.dataset.storyId);
  if(!stories.some(story=>story.id===id)||anchor.href!=='https://news.ycombinator.com/item?id='+id)return;
  event.preventDefault();const click=++commentClick,notice=$('notice');
  const fallback=document.createElement('a');fallback.href=anchor.href;fallback.target='_blank';fallback.rel='noopener noreferrer';fallback.textContent='Read on Hacker News ↗';
  const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';cancel.addEventListener('click',()=>{commentClick++;notice.hidden=true;anchor.focus();});
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
 const data=JSON.parse($('edition-data').textContent||'{}') as {generatedAt:string;stories:Story[];version:string;commentsAsset?:string;commentsCssAsset?:string};
 const media=matchMedia('(prefers-color-scheme: dark)');let section='Today';let query='';let theme:Theme='light';
 const panel=(id:string,open:boolean)=>{$(id).hidden=!open;const toggle=id==='search-box'?'search-toggle':id==='archive-box'?'archive-toggle':'about-toggle';$(toggle).setAttribute('aria-expanded',String(open));};
 function applyTheme(selected:Theme){theme=selected;document.documentElement.dataset.theme=selected;document.documentElement.style.colorScheme=selected;const button=$('theme-toggle'),dark=selected==='dark';button.setAttribute('aria-label','Switch to '+(dark?'light':'dark')+' mode');button.setAttribute('aria-pressed',String(dark));button.title=dark?'Light mode':'Dark mode';}
 function systemTheme(){let saved=null;try{saved=localStorage.getItem(THEME_KEY)}catch{}applyTheme(resolveTheme(saved,media.matches));}
 systemTheme();media.addEventListener('change',systemTheme);
 $('theme-toggle').addEventListener('click',()=>{const selected=nextTheme(theme);try{localStorage.setItem(THEME_KEY,selected)}catch{}applyTheme(selected);});
 $('reset-theme').addEventListener('click',()=>{try{localStorage.removeItem(THEME_KEY)}catch{}systemTheme();});
 function showResults(){const filtered=section!=='Today'||!!query.trim();$('today-view').hidden=filtered;$('filtered-view').hidden=!filtered;all('.sections [data-section]').forEach(n=>{const active=(n as HTMLElement).dataset.section===section;n.classList.toggle('active',active);if(active)n.setAttribute('aria-current','page');else n.removeAttribute('aria-current');});if(filtered){const results=filterStories(data.stories,section,query);$('filtered-heading').textContent=query.trim()?'Search results':section;$('filtered-stories').innerHTML=results.map(s=>articleMarkup(s)).join('');$('empty-results').hidden=!!results.length;}else $('filtered-stories').replaceChildren();}
 all('[data-section]').forEach(n=>n.addEventListener('click',e=>{e.preventDefault();section=(n as HTMLElement).dataset.section!;query='';($('search') as HTMLInputElement).value='';showResults();if(n.closest('.topic-desk'))window.scrollTo({top:0,behavior:'auto'});}));
 $('search-toggle').addEventListener('click',()=>{const open=$('search-box').hidden;panel('search-box',open);if(open)$('search').focus();});
 $('search-box').addEventListener('submit',e=>e.preventDefault());$('search').addEventListener('input',e=>{query=(e.target as HTMLInputElement).value;showResults();});
 document.querySelector('[data-action="search-close"]')!.addEventListener('click',()=>{panel('search-box',false);query='';($('search') as HTMLInputElement).value='';showResults();$('search-toggle').focus();});
 $('about-toggle').addEventListener('click',()=>{panel('about-panel',$('about-panel').hidden);panel('archive-box',false);});document.querySelector('[data-action="about-close"]')!.addEventListener('click',()=>{panel('about-panel',false);$('about-toggle').focus();});
 let archiveLoaded=false;
 $('archive-toggle').addEventListener('click',async()=>{const open=$('archive-box').hidden;panel('archive-box',open);panel('about-panel',false);if(!open)return;window.scrollTo({top:0,behavior:'auto'});if(archiveLoaded)return;try{const r=await fetch('/api/archive');if(!r.ok)throw Error();const a=await r.json() as {dates:string[]};const links=$('archive-links');links.replaceChildren();for(const date of ['',...a.dates.filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d))]){const link=document.createElement('a');link.href=date?'/?date='+date:'/';link.textContent=date?new Date(date+'T12:00:00Z').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'UTC'}):'Latest edition';links.appendChild(link);}archiveLoaded=true;}catch{$('notice').textContent='Past editions are temporarily unavailable.';$('notice').hidden=false;}});
 document.querySelector('[data-action="archive-close"]')!.addEventListener('click',()=>{panel('archive-box',false);$('archive-toggle').focus();});
 $('refresh-edition').addEventListener('click',()=>{location.href='/?refresh=1';});
 const url=new URL(location.href);if(url.searchParams.has('refresh')){url.searchParams.delete('refresh');history.replaceState(null,'',url.pathname+url.search+url.hash);}
 const archived=/^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('date')||'');$('archive-label').hidden=!archived;$('stale-notice').hidden=archived||Date.now()-Date.parse(data.generatedAt)<=12*3600000;
 installCommentLinks(data.stories,data.commentsAsset,archived?url.searchParams.get('date')!:undefined,data.commentsCssAsset,data.version);
 const rail=$('story-rail');const scroll=(left:number)=>rail?.scrollBy({left,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
 all('[data-scroll]').forEach(n=>n.addEventListener('click',()=>scroll(Number((n as HTMLElement).dataset.scroll))));rail?.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();scroll(e.key==='ArrowRight'?300:-300);}});
 document.addEventListener('error',e=>{if(e.target instanceof HTMLImageElement)e.target.closest('figure')?.remove();},true);
}
if(typeof document!=='undefined')startReader();
