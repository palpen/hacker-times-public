import {candidates,article,type OfficialItemHydrator} from '../reporting';
import {boundedBody,RequestError} from '../security';
import {chooseLead,pinSnapshot} from './selection';
import {digest} from './storage';
import type {Root,Snapshot,Source} from './types';
export async function collectSnapshot(root:Root,hydrate?:OfficialItemHydrator):Promise<Snapshot>{
 if(root.safetyStop)throw new RequestError('Explicit safety stop is active',409);
 // Pin the complete metadata selection before source retrieval/editorial work.
 const result=await candidates(root.ledger.active?.id,'month',async(pool,ids,at)=>chooseLead(root,pool,ids,at).audit.leadId!,true,'official-api',hydrate);
 return pinSnapshot(root,result);
}
export async function collectSource(s:Snapshot,id:number):Promise<Source>{
 const selected=s.selectedStories.find(x=>x.id===id);if(!selected)throw new RequestError('Article not selected');
 const url=new URL(selected.url);let source:Omit<Source,'fingerprint'>;
 if(url.origin==='https://news.ycombinator.com'&&url.pathname==='/item'&&url.searchParams.get('id')===String(id)){
  const response=await fetch('https://hacker-news.firebaseio.com/v0/item/'+id+'.json',{redirect:'manual',signal:AbortSignal.timeout(12_000)});
  if(!response.ok)throw new RequestError('HN source temporarily unavailable',502);
  const item=JSON.parse(await boundedBody(response,200_000));
  if(item.id!==id||!['story','poll'].includes(item.type)||item.url)throw new RequestError('HN source identity changed; review required',409);
  const excerpt=typeof item.text==='string'?item.text.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,8500):'';
  source={id,generatedAt:s.generatedAt,kind:excerpt?'hn_post':'unavailable',excerpt,description:'',url:selected.url,fetchedAt:new Date().toISOString(),status:excerpt?'hn_self_post':'source_unavailable'};
 }else{
  const result=await article(selected.url);
  // Transport failures remain retryable, not editorial unavailable assertions.
  if(result.articleStatus==='fetch_failed'||result.articleStatus==='unavailable_http_429'||/^unavailable_http_5/.test(result.articleStatus))throw new RequestError('Publisher source temporarily unavailable',502);
  source={id,generatedAt:s.generatedAt,kind:result.articleStatus==='fetched'?'article':'unavailable',excerpt:result.excerpt,description:('description' in result?result.description:'')||'',url:selected.url,fetchedAt:new Date().toISOString(),status:result.articleStatus};
 }
 return {...source,fingerprint:await digest(source)};
}
