import {categories} from './contracts';
import {classifyTopicV4,monthPolicyConfig,freshSectionScore,unifiedSectionPolicyConfig} from './policy';
import {boundedBody} from './security';
import {CollectionError,collectionFailure} from './collection-error';

// Discovery is a bounded index sample, not an exhaustive archive. Only official
// Firebase item responses may supply the published scores and story metadata.
export const historyLimits={maxRequests:13,maxHitsPerRequest:100,maxDiscoveredIds:1300,maxHistoricalIds:164,maxOfficialItems:254,maxResponseBytes:250_000,requestTimeoutMs:15_000} as const;
const SEARCH_ORIGIN='https://hn.algolia.com';
const RETRIEVE=['objectID','title','url','points','num_comments','created_at_i'];
const queryPlan=[
 {kind:'engagement',endpoint:'search',query:''},
 {kind:'newest',endpoint:'search_by_date',query:''},
 {kind:'ai',endpoint:'search',query:'AI'},
 {kind:'llm',endpoint:'search',query:'LLM'},
 {kind:'games',endpoint:'search',query:'game'},
 {kind:'chess',endpoint:'search',query:'chess'},
 ...['science','physics','biology','history','music','business','economy'].map(query=>({kind:query,endpoint:'search' as const,query})),
] as const;
export type HistoryHit={id:number;title:string;url?:string;score:number;comments:number;time:number};
type HistoryWindow=ReturnType<typeof monthWindow>;
function fail(message:string):never {throw new CollectionError('Historical HN discovery '+message+'; keep the previous edition.',{phase:'history',reason:'payload',upstreamStatus:null});}
function object(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value);}
function nonnegative(value:unknown):value is number{return Number.isSafeInteger(value)&&Number(value)>=0;}

export function monthWindow(atMs:number){
 if(!Number.isSafeInteger(atMs)||atMs<=monthPolicyConfig.windowDays*86_400_000||!Number.isFinite(new Date(atMs).getTime()))fail('has an invalid cutoff');
 const startMs=atMs-monthPolicyConfig.windowDays*86_400_000;
 // HN timestamps are whole seconds. Ceil keeps the exact millisecond window
 // half-open, including the lower boundary and excluding the pinned upper one.
 return {windowStart:new Date(startMs).toISOString(),windowEnd:new Date(atMs).toISOString(),startSeconds:Math.ceil(startMs/1000),endSeconds:Math.ceil(atMs/1000)};
}

export function historyQueries(atMs:number){
 const window=monthWindow(atMs);
 return queryPlan.map(plan=>{
  const url=new URL('/api/v1/'+plan.endpoint,SEARCH_ORIGIN);
  url.search=new URLSearchParams({query:plan.query,tags:'(story,poll)',numericFilters:`created_at_i>=${window.startSeconds},created_at_i<${window.endSeconds}`,page:'0',hitsPerPage:String(historyLimits.maxHitsPerRequest),attributesToRetrieve:JSON.stringify(RETRIEVE),attributesToHighlight:'[]',attributesToSnippet:'[]',analytics:'false'}).toString();
  return {...plan,url:url.href};
 });
}

export function parseHistoryResponse(value:unknown,window:HistoryWindow):HistoryHit[]{
 if(!object(value)||!Array.isArray(value.hits)||value.page!==0||value.hitsPerPage!==historyLimits.maxHitsPerRequest||!nonnegative(value.nbHits)||!nonnegative(value.nbPages)||value.hits.length!==Math.min(value.nbHits,historyLimits.maxHitsPerRequest)||(value.nbHits>0&&value.nbPages<1))fail('returned an incomplete result');
 if(value.hits.length>historyLimits.maxHitsPerRequest)fail('exceeded its result limit');
 const seen=new Set<number>();
 return value.hits.map(hit=>{
  if(!object(hit)||typeof hit.objectID!=='string'||!/^\d+$/.test(hit.objectID))fail('returned an invalid item');
  const id=Number(hit.objectID);
  if(!Number.isSafeInteger(id)||id<=0||String(id)!==hit.objectID||seen.has(id)||typeof hit.title!=='string'||!hit.title.trim()||hit.title.length>4096||!nonnegative(hit.points)||!nonnegative(hit.num_comments)||!Number.isSafeInteger(hit.created_at_i)||Number(hit.created_at_i)<window.startSeconds||Number(hit.created_at_i)>=window.endSeconds)fail('returned an invalid item');
  if(hit.url!==undefined&&hit.url!==null&&(typeof hit.url!=='string'||hit.url.length>2500))fail('returned an invalid URL');
  seen.add(id);
  return {id,title:hit.title,...(typeof hit.url==='string'&&hit.url?{url:hit.url}:{}),score:hit.points,comments:hit.num_comments,time:Number(hit.created_at_i)};
 });
}

export function shortlistHistorical(hits:HistoryHit[],currentIds:readonly number[],atMs:number):HistoryHit[]{
 if(hits.length>historyLimits.maxDiscoveredIds)fail('exceeded its discovery limit');
 const current=new Set(currentIds),unique=new Map<number,HistoryHit>();
 // Fixed query order supplies deterministic deduplication even if the index
 // updates between requests. No indexed value survives official hydration.
 for(const hit of hits)if(!current.has(hit.id)&&!unique.has(hit.id))unique.set(hit.id,hit);
 const pool=[...unique.values()];
 const maxPoints=Math.max(1,...pool.map(s=>s.score)),maxComments=Math.max(1,...pool.map(s=>s.comments));
 const ordered=pool.map(s=>({story:s,weight:freshSectionScore(s,maxPoints,maxComments,atMs,false,1)})).sort((a,b)=>b.weight-a.weight||b.story.time-a.story.time||a.story.id-b.story.id).map(s=>s.story);
 const selected=new Map<number,HistoryHit>();
 const take=(stories:HistoryHit[])=>{for(const s of stories)if(selected.size<historyLimits.maxHistoricalIds&&!selected.has(s.id))selected.set(s.id,s);};
 // Reserve topical coverage before global popularity can consume the bound.
 for(const category of categories){
  const desk=ordered.filter(s=>classifyTopicV4(s.title,s.url&&/^https?:\/\//i.test(s.url)?safeIndexUrl(s.url):hnItemUrl(s.id))===category);
  take(desk.slice(0,20));
 }
 take([...pool].sort((a,b)=>b.time-a.time||a.id-b.id).slice(0,20));
 take(ordered);
 return [...selected.values()];
}
function hnItemUrl(id:number){return 'https://news.ycombinator.com/item?id='+id;}
// Classification reads a host only. Indexed URLs are never fetched here.
function safeIndexUrl(url:string){try{return new URL(url).href;}catch{return 'https://news.ycombinator.com/';}}

export async function discoverHistory(atMs:number,currentIds:readonly number[]){
 const window=monthWindow(atMs),queries=historyQueries(atMs);
 const responses=await Promise.all(queries.map(async plan=>{
  let response:Response|undefined;
  try{
   response=await fetch(plan.url,{redirect:'manual',headers:{accept:'application/json'},signal:AbortSignal.timeout(historyLimits.requestTimeoutMs)});
   if(response.status!==200||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||''))throw new CollectionError('Historical HN discovery is unavailable; keep the previous edition.',{phase:'history',reason:response.status!==200?'http':'content_type',upstreamStatus:response.status});
   const body=await boundedBody(response,historyLimits.maxResponseBytes,historyLimits.requestTimeoutMs);
   return parseHistoryResponse(JSON.parse(body),window);
  }catch(error){throw collectionFailure(error,'history','Historical HN discovery failed or exceeded a response limit; keep the previous edition.');}
  finally{void response?.body?.cancel().catch(()=>{});}
 }));
 const hits=responses.flat(),discoveredCount=new Set(hits.map(s=>s.id)).size;
 const shortlisted=shortlistHistorical(hits,currentIds,atMs);
 return {windowStart:window.windowStart,windowEnd:window.windowEnd,shortlisted,discovery:{provider:'hn-algolia',coverage:'sampled',windowDays:monthPolicyConfig.windowDays,requestCount:queries.length,discoveredCount,shortlistedCount:shortlisted.length,queries:queries.map((q,i)=>({kind:q.kind,query:q.query,endpoint:q.endpoint,hitCount:responses[i].length})),limits:{...historyLimits}}};
}
