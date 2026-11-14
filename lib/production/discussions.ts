import type {Edition} from '../contracts';
import {HIGHLIGHT_LIMITS,TRENDING_HIGHLIGHT_POLICY,trendingStoryIds,validDiscussionSnapshot,type DiscussionSnapshot} from '../discussion-highlights';
import {normalizeArticleUrl} from '../lead-retirement';
import {RequestError} from '../security';

// Four threads need at most 24 upstream reads (parent + five comments each).
// Each batch gets its own alarm invocation, leaving room for storage calls below
// the Workers request limit. Completed batches survive retries and restarts.
export const DISCUSSION_BATCH_SIZE=4;
export function discussionBatchCount(edition:Edition){return Math.max(1,Math.ceil(trendingStoryIds(edition).length/DISCUSSION_BATCH_SIZE));}
export function discussionBatchEdition(edition:Edition,index:number):Edition{
 if(!Number.isInteger(index)||index<0||index>=discussionBatchCount(edition))throw new RequestError('Invalid discussion batch');
 const ids=trendingStoryIds(edition).slice(index*DISCUSSION_BATCH_SIZE,(index+1)*DISCUSSION_BATCH_SIZE);
 return {...edition,frontPageIds:ids,sourcePages:[{url:edition.sourcePages?.[0]?.url??'https://hacker-news.firebaseio.com/v0/topstories.json',ids}]};
}
export function checkDiscussionBatch(value:unknown,edition:Edition,base:string,index:number):asserts value is DiscussionSnapshot{
 const batch=discussionBatchEdition(edition,index),v=value as DiscussionSnapshot;
 const invalid=()=>{throw new RequestError('Invalid pinned discussion batch',409);};
 if(!v||v.policy!==TRENDING_HIGHLIGHT_POLICY||!Array.isArray(v.items)||!Array.isArray(v.sources)||v.items.length>DISCUSSION_BATCH_SIZE||v.sources.length!==v.items.length||!validDiscussionSnapshot({...v,items:[],sources:[]},batch,base)||new TextEncoder().encode(JSON.stringify(v)).byteLength>HIGHLIGHT_LIMITS.snapshotBytes)invalid();
 // Keep duplicate authors/URLs until the final ordered merge. Dropping them
 // within a batch could discard a later usable thread after a cross-batch tie.
 let previous=-1;const comments=new Set<number>();
 for(let i=0;i<v.items.length;i++){
  const item=v.items[i],source=v.sources![i],position=v.storyIds.indexOf(item?.storyId);
  if(!item||!source||position<=previous||source.id!==item.storyId||source.hnPosition!==position+1||v.unavailableStoryIds.includes(item.storyId)||comments.has(item.commentId))invalid();
  const single={...batch,sourcePages:[{url:batch.sourcePages![0].url,ids:[item.storyId]}]};
  if(!validDiscussionSnapshot({...v,storyIds:[item.storyId],items:[item],sources:[{...source,hnPosition:1}],status:'complete',unavailableStoryIds:[]},single,base))invalid();
  previous=position;comments.add(item.commentId);
 }
}
export function combineDiscussionBatches(edition:Edition,base:string,batches:DiscussionSnapshot[]):DiscussionSnapshot{
 if(batches.length!==discussionBatchCount(edition))throw new RequestError('Discussion collection is incomplete',409);
 batches.forEach((batch,index)=>checkDiscussionBatch(batch,edition,base,index));
 const ids=trendingStoryIds(edition),failed=new Set(batches.flatMap(batch=>batch.unavailableStoryIds));
 const unavailableStoryIds=ids.filter(id=>failed.has(id));
 const result:DiscussionSnapshot={policy:TRENDING_HIGHLIGHT_POLICY,sourceGeneratedAt:edition.generatedAt,basePublicationVersion:base,storyIds:ids,
  collectedAt:batches.map(batch=>batch.collectedAt).sort().at(-1)!,status:failed.size?(failed.size===ids.length?'unavailable':'partial'):'complete',unavailableStoryIds,sources:[],items:[]};
 const articles=new Set<string>(),authors=new Set<string>(),comments=new Set<number>();
 for(const batch of batches)for(const item of batch.items){
  const source=batch.sources!.find(source=>source.id===item.storyId)!;
  const key=normalizeArticleUrl(source.url);
  if(articles.has(key)||authors.has(item.author)||comments.has(item.commentId)||result.items.length===HIGHLIGHT_LIMITS.items)continue;
  articles.add(key);authors.add(item.author);comments.add(item.commentId);
  result.items.push(item);result.sources!.push({...source,hnPosition:ids.indexOf(source.id)+1});
 }
 while(new TextEncoder().encode(JSON.stringify(result)).byteLength>HIGHLIGHT_LIMITS.snapshotBytes&&result.items.length){result.items.pop();result.sources!.pop();}
 if(!validDiscussionSnapshot(result,edition,base))throw new RequestError('Invalid combined discussion snapshot',409);
 return result;
}
