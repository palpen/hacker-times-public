import type {Candidate} from '../contracts';
import {normalizeArticleUrl} from '../lead-retirement';
import {readBlob,type Store} from './storage';
import type {ArchivedCopy,Publication,Root,Source} from './types';

const educational=/\b(understanding|explained|explaining|tutorial|introduction to|guide to|how (?:does|do|to)|how .{1,60} works?)\b/i;
const changing=/\b(today|yesterday|tomorrow|now|currently|this (?:day|week|month|year)|last (?:night|week|month)|live|outage|down|breaking|updates?|latest|prices?|forecast|election|recall|advisory|withdrawn|correction)\b/i;
export function canReuseArchive(selected:Pick<Candidate,'title'|'url'>){
  const url=new URL(selected.url);
  return educational.test(selected.title)&&!changing.test(selected.title)&&!url.search&&!url.hash&&
    url.pathname.split('/').filter(Boolean).length>=2&&!/\/(?:live|status|dashboard|releases?|changelog|latest)(?:\/|$)/i.test(url.pathname);
}
type Entry={key:string;title:string;copy:ArchivedCopy};
export class ArchiveCopies {
  private versions=new Map<string,Entry[]>();
  async find(store:Store,root:Root,selected:Candidate,at:string):Promise<ArchivedCopy|undefined>{
    if(!canReuseArchive(selected))return;
    const cutoff=Date.parse(at),earliest=cutoff-72*3600_000,key=normalizeArticleUrl(selected.url);
    const days=Object.entries(root.archives).filter(([day])=>day>=new Date(earliest).toISOString().slice(0,10)&&day<=at.slice(0,10)).sort(([a],[b])=>b.localeCompare(a));
    const versions=new Set([root.version,root.previous,...days.map(([,version])=>version)]);
    for(const version of versions){
      if(!version||version==='empty')continue;
      let entries=this.versions.get(version);
      if(!entries){
        const prior=await readBlob<Publication>(store,'version/'+version);
        if(!prior)continue;
        entries=[];
        for(const story of prior.edition.stories){
          if(!story.shortSummary||!story.summary||!canReuseArchive(story))continue;
          let copy:ArchivedCopy|undefined;
          if(story.summarySource==='article'&&story.articleStatus==='fetched'){
            const {headline,summary,shortSummary,publisher}=story;
            copy={version,generatedAt:prior.edition.generatedAt,headline,summary,shortSummary,publisher};
          }else if(story.summarySource==='archived_summary'){
            // A recovered copy keeps its original verification date through later editions.
            copy=(await store.get<Source>('source/'+prior.edition.generatedAt+'/'+story.id))?.archive;
          }
          if(copy&&!changing.test([copy.headline,copy.summary,copy.shortSummary].join(' '))){
            entries.push({title:story.title,key:normalizeArticleUrl(story.url),copy});
          }
        }
        if(this.versions.size>=6)this.versions.delete(this.versions.keys().next().value!);
        this.versions.set(version,entries);
      }
      const match=entries.find(entry=>entry.key===key&&entry.title===selected.title);
      if(match){
        const age=cutoff-Date.parse(match.copy.generatedAt);
        if(age>0&&age<=72*3600_000)return match.copy;
      }
    }
  }
}
