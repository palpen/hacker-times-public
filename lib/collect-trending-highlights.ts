import type {Edition} from './contracts';
import {boundedBody} from './security';
import {normalizeArticleUrl} from './lead-retirement';
import {commentExcerpt} from './collect-discussion-highlights';
import {HIGHLIGHT_LIMITS,TRENDING_HIGHLIGHT_POLICY,trendingStoryIds,validDiscussionSnapshot,type DiscussionHighlight,type DiscussionSnapshot,type HighlightSource} from './discussion-highlights';
const API='https://hacker-news.firebaseio.com/v0/item/';
type Item=Record<string,unknown>;
const validId=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0;
/** HN ranked top-level order (70%) and comment freshness (30%, six-hour half
 * life) are explicit relevance proxies, not inferred votes or semantic review.
 * A rolling 24-hour comment window includes today's active older discussions. */
export function commentRelevance(position:number,time:number,sourceTime:number){return 70*(5-position)/4+30*Math.pow(2,-Math.max(0,sourceTime-time*1000)/21600000);}
export async function collectTrendingHighlights(edition:Edition,basePublicationVersion:string,dependencies:{fetcher?:typeof fetch;now?:()=>number}={}):Promise<DiscussionSnapshot>{
 const fetcher=dependencies.fetcher??fetch,now=dependencies.now??Date.now,ids=trendingStoryIds(edition),started=Date.now(),sourceTime=Date.parse(edition.generatedAt);
 const controller=new AbortController();let expired=false;
 const timer=setTimeout(()=>{expired=true;controller.abort();},HIGHLIGHT_LIMITS.totalMs);
 const results=new Map<number,DiscussionHighlight>(),sourceMap=new Map<number,HighlightSource>(),failed=new Set<number>();let requests=0;
 async function item(id:number):Promise<Item|null>{
  if(expired||Date.now()-started>=HIGHLIGHT_LIMITS.totalMs)throw Error('Highlight deadline');
  if(requests>=HIGHLIGHT_LIMITS.requests)throw Error('Highlight request budget');
  requests++;
  const timeout=Math.max(1,Math.min(HIGHLIGHT_LIMITS.itemMs,HIGHLIGHT_LIMITS.totalMs-(Date.now()-started))),local=new AbortController();
  const abort=()=>local.abort();controller.signal.addEventListener('abort',abort,{once:true});
  let response:Response|undefined,handle:ReturnType<typeof setTimeout>|undefined;
  const deadline=new Promise<never>((_,reject)=>{handle=setTimeout(()=>{local.abort();void response?.body?.cancel().catch(()=>{});reject(Error('Highlight item timeout'));},timeout);});
  try{return await Promise.race([(async()=>{
   response=await fetcher(API+id+'.json',{method:'GET',redirect:'manual',credentials:'omit',headers:{Accept:'application/json'},signal:local.signal});
   if(local.signal.aborted)throw Error('Highlight item timeout');
   if(!response.ok||response.redirected||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??''))throw Error('Highlight source unavailable');
   const value:unknown=JSON.parse(await boundedBody(response,HIGHLIGHT_LIMITS.itemBytes,timeout));
   if(value===null)return null;
   if(!value||typeof value!=='object'||Array.isArray(value)||(value as Item).id!==id)throw Error('Invalid highlight source');
   return value as Item;
  })(),deadline]);}finally{clearTimeout(handle);local.abort();controller.signal.removeEventListener('abort',abort);void response?.body?.cancel().catch(()=>{});}
 }

 async function story(storyId:number){
  let parent:Item|null;try{parent=await item(storyId);}catch{failed.add(storyId);return;}
  if(!parent||parent.dead===true||parent.deleted===true)return;
  if(!['story','poll'].includes(String(parent.type))||!validId(parent.time)||parent.time*1000>now()+300000||typeof parent.title!=='string'||!parent.title.trim()||parent.title.length>500||/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(parent.title)||parent.kids!==undefined&&(!Array.isArray(parent.kids)||!parent.kids.every(validId))){failed.add(storyId);return;}
  const url=typeof parent.url==='string'&&parent.url?parent.url:'https://news.ycombinator.com/item?id='+storyId;
  try{if(url.length>2048)throw Error('URL length');normalizeArticleUrl(url);}catch{failed.add(storyId);return;}
  const candidates:DiscussionHighlight[]=[];
  const kids=[...new Set((parent.kids as number[]|undefined)??[])].slice(0,HIGHLIGHT_LIMITS.children);
  for(let index=0;index<kids.length;index++){
   let comment:Item|null;try{comment=await item(kids[index]);}catch{failed.add(storyId);return;}
   if(!comment||comment.dead===true||comment.deleted===true)continue;
   if(comment.type!=='comment'||comment.parent!==storyId||typeof comment.by!=='string'||!/^[-\w]{1,50}$/.test(comment.by)||!validId(comment.time)||comment.time*1000>now()+300000||comment.time*1000<sourceTime-86400000||typeof comment.text!=='string')continue;
   const excerpt=commentExcerpt(comment.text);if(!excerpt)continue;
   candidates.push({storyId,commentId:kids[index],author:comment.by,commentTime:comment.time,hnPosition:index+1,...excerpt,retrievedAt:new Date(now()).toISOString()});
  }
  candidates.sort((a,b)=>commentRelevance(b.hnPosition,b.commentTime,sourceTime)-commentRelevance(a.hnPosition,a.commentTime,sourceTime)||a.hnPosition-b.hnPosition||a.commentId-b.commentId);
  if(candidates[0]){
   results.set(storyId,candidates[0]);sourceMap.set(storyId,{id:storyId,title:parent.title,url,time:parent.time,hnPosition:ids.indexOf(storyId)+1,comments:Number.isSafeInteger(parent.descendants)&&Number(parent.descendants)>=0?Number(parent.descendants):0});
  }
 }
 // All 24 candidates get the same bounded five-comment review. Completion
 // order cannot influence source ordering, deduplication or the selected quote.
 try{for(let offset=0;offset<ids.length;offset+=HIGHLIGHT_LIMITS.concurrency){
  await Promise.all(ids.slice(offset,offset+HIGHLIGHT_LIMITS.concurrency).map(async id=>{if(expired){failed.add(id);return;}await story(id);}));
 }}finally{clearTimeout(timer);controller.abort();}
 const articles=new Set<string>(),authors=new Set<string>(),comments=new Set<number>(),items:DiscussionHighlight[]=[],sources:HighlightSource[]=[];
 for(const id of ids){const h=results.get(id),s=sourceMap.get(id);if(!h||!s)continue;const identity=normalizeArticleUrl(s.url);if(articles.has(identity)||authors.has(h.author)||comments.has(h.commentId))continue;articles.add(identity);authors.add(h.author);comments.add(h.commentId);items.push(h);sources.push(s);if(items.length===16)break;}
 const unavailableStoryIds=ids.filter(id=>failed.has(id));
 const snapshot:DiscussionSnapshot={policy:TRENDING_HIGHLIGHT_POLICY,sourceGeneratedAt:edition.generatedAt,basePublicationVersion,storyIds:ids,sources,collectedAt:new Date(now()).toISOString(),status:unavailableStoryIds.length?(unavailableStoryIds.length===ids.length?'unavailable':'partial'):'complete',unavailableStoryIds,items};
 // Long source URLs/titles must never prevent publishing an otherwise valid
 // edition. Drop lowest-ranked whole pairs, never truncate attribution or URL.
 while(new TextEncoder().encode(JSON.stringify(snapshot)).byteLength>HIGHLIGHT_LIMITS.snapshotBytes&&snapshot.items.length){snapshot.items.pop();snapshot.sources!.pop();}
 return snapshot;
}
export async function trendingSnapshotKey(edition:Edition,base:string){
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([TRENDING_HIGHLIGHT_POLICY,edition.generatedAt,base,trendingStoryIds(edition)])));
 return 'discussion-snapshots/v4/'+Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('')+'.json';
}
export async function prepareTrendingHighlights(bucket:R2Bucket,edition:Edition,base:string,collect=collectTrendingHighlights):Promise<DiscussionSnapshot>{
 const key=await trendingSnapshotKey(edition,base);
 async function read():Promise<DiscussionSnapshot|null>{const record=await bucket.get(key);if(!record)return null;if(record.size>HIGHLIGHT_LIMITS.snapshotBytes)throw Error('Discussion snapshot exceeds supported size.');const value:unknown=await record.json();if(!validDiscussionSnapshot(value,edition,base)||value.policy!==TRENDING_HIGHLIGHT_POLICY)throw Error('Invalid saved trending snapshot.');return value;}
 const existing=await read();if(existing)return existing;
 const snapshot=await collect(edition,base);if(!validDiscussionSnapshot(snapshot,edition,base)||snapshot.policy!==TRENDING_HIGHLIGHT_POLICY)throw Error('Invalid collected trending snapshot.');
 const serialized=JSON.stringify(snapshot);if(new TextEncoder().encode(serialized).byteLength>HIGHLIGHT_LIMITS.snapshotBytes)throw Error('Discussion snapshot exceeds supported size.');
 const saved=await bucket.put(key,serialized,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}});if(saved)return snapshot;
 const winner=await read();if(!winner)throw Error('Discussion snapshot could not be pinned.');return winner;
}
