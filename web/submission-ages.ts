import {submissionAge,submissionTime} from '../lib/submission-time';

// Works with retained archive readers as well as the current prebuilt reader.
// Uses embedded publication data only: no news, comments or edition requests.
export function installSubmissionAges(doc:Document=document,win:Window=window){
 if(doc.documentElement.dataset.submissionAges)return;
 const raw=doc.getElementById('edition-data')?.textContent;if(!raw)return;
 let data:{stories?:{id:number;time?:number}[];submissionTimes?:{id:number;time:number}[]};try{data=JSON.parse(raw);}catch{return;}
 if(!Array.isArray(data.stories))return;
 doc.documentElement.dataset.submissionAges='ready';
 const times=new Map(data.stories.map(s=>[s.id,s.time]));
 let extra=data.submissionTimes;try{extra??=JSON.parse(doc.getElementById('hn-submission-times')?.textContent||'[]');}catch{}
 if(Array.isArray(extra))for(const s of extra)if(!times.has(s.id))times.set(s.id,s.time);
 function update(){
  const now=Date.now();
  for(const byline of doc.querySelectorAll<HTMLElement>('.story-meta, .highlight-attribution')){
   const value=times.get(Number(byline.closest<HTMLElement>('[data-story-id]')?.dataset.storyId));
   const meta=byline.matches('.highlight-attribution')?byline.querySelector<HTMLElement>('span'):byline;if(!meta)continue;
   const info=submissionTime(value),age=submissionAge(value,now);
   let time=meta.querySelector<HTMLTimeElement>('time.story-age'),separator=meta.querySelector<HTMLElement>('[data-age-separator]');
   if(!info||age===null){if(time)time.hidden=true;if(separator)separator.hidden=true;continue;}
   if(!time){
    time=doc.createElement('time');time.className='story-age';
    separator=doc.createElement('span');separator.dataset.ageSeparator='';separator.setAttribute('aria-hidden','true');separator.textContent=' · ';
    meta.insertBefore(separator,meta.firstChild);meta.insertBefore(time,separator);
   }
   time.hidden=false;if(separator)separator.hidden=false;
   time.dateTime=info.iso;time.title=info.title;time.setAttribute('aria-label',age+'. '+info.title);time.style.whiteSpace='nowrap';
   if(time.textContent!==age)time.textContent=age;
  }
 }
 update();
 const timer=win.setInterval(()=>{if(!doc.hidden)update();},60_000);
 const visible=()=>{if(!doc.hidden)update();};doc.addEventListener('visibilitychange',visible);win.addEventListener('pageshow',visible);
 // Section/search navigation replaces this container's direct children. No
 // subtree observer, so our own time-text updates cannot create an update loop.
 const filtered=doc.getElementById('filtered-stories');
 const observer=filtered?new MutationObserver(update):null;observer?.observe(filtered!,{childList:true});
 return ()=>{win.clearInterval(timer);doc.removeEventListener('visibilitychange',visible);win.removeEventListener('pageshow',visible);observer?.disconnect();delete doc.documentElement.dataset.submissionAges;};
}
if(typeof document!=='undefined')installSubmissionAges();
