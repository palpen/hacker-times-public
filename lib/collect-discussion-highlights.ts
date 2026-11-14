import type {Edition} from './contracts';
import {sanitizeCommentHTML,type SafeCommentToken} from './comments-core';
import {boundedBody} from './security';
import {HIGHLIGHT_POLICY,HIGHLIGHT_LIMITS,discussionStoryIds,validDiscussionSnapshot,type DiscussionHighlight,type DiscussionSnapshot} from './discussion-highlights';

const API='https://hacker-news.firebaseio.com/v0/item/';
type Item=Record<string,unknown>;
const validId=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0;
function textOf(nodes:SafeCommentToken[]):string{return nodes.map(node=>node.type==='text'?node.text:node.type==='br'?' ':['p','pre'].includes(node.type)?' '+textOf(node.children)+' ':textOf(node.children)).join('');}
/** The reader tokenizer intentionally discards blockquote tags. Find quote/code
 * boundaries before that loses provenance, using the same quoted-tag scanning.
 * Never remove a block and join the text on either side of it. */
function beforeQuotedMarkup(html:string):number|null{
 let cursor=0,boundary=html.length;
 while(cursor<html.length){
  const open=html.indexOf('<',cursor);if(open<0)break;
  if(html.startsWith('<!--',open)){const end=html.indexOf('-->',open+4);if(end<0)return null;cursor=end+3;continue;}
  let end=open+1,quote='';
  for(;end<html.length;end++){const char=html[end];if(quote){if(char===quote)quote='';}else if(char==='"'||char==="'")quote=char;else if(char==='>')break;}
  if(end===html.length)return null;
  const tag=/^\s*(\/?)\s*([a-z][a-z0-9]*)(?=\s|\/|$)/i.exec(html.slice(open+1,end));
  if(tag&&!tag[1]&&/^(?:blockquote|pre|code)$/i.test(tag[2]))boundary=Math.min(boundary,open);
  cursor=end+1;
 }
 return boundary;
}
function eligiblePrefix(nodes:SafeCommentToken[]):{text:string;stopped:boolean}{
 let text='',stopped=false,paragraphStart=true;
 function append(value:string){
  // Treat literal newlines and <br> conservatively as possible paragraph starts.
  for(const part of value.split(/(\r\n|\r|\n)/)){
   if(/^[\r\n]+$/.test(part)){text+=part;paragraphStart=true;continue;}
   const visible=part.trimStart();
   if(paragraphStart&&/^[>"“”'‘’«»「『`]/.test(visible)){stopped=true;return;}
   text+=part;if(visible)paragraphStart=false;
  }
 }
 function visit(tokens:SafeCommentToken[]){
  for(const node of tokens){
   if(stopped)return;
   if(node.type==='text')append(node.text);
   else if(node.type==='p'){text+=' ';paragraphStart=true;visit(node.children);if(!stopped){text+=' ';paragraphStart=true;}}
   else if(node.type==='br'){text+=' ';paragraphStart=true;}
   else if(node.type==='pre'||node.type==='code'||node.type==='em'&&paragraphStart)stopped=true;
   else visit(node.children);
  }
 }
 visit(nodes);return {text:text.replace(/\s+/g,' ').trim(),stopped};
}
/** A contiguous prefix, with only HTML/entity decoding and whitespace folding.
 * Never paraphrase a comment or silently remove interior material. Stop before
 * quote/code boundaries, or reject an insufficient prefix or parser truncation.
 * Applies only to new v3 collection; frozen v1/v2 excerpts are never rewritten. */
export function commentExcerpt(html:string):{excerpt:string;truncated:boolean}|null{
 if(/^\s*(?:<p\b[^>]*>\s*)*<(?:pre|code|blockquote|i|em)\b/i.test(html)||html.length>20_000||/<\s*(?:script|style|iframe|object|template|svg|math|textarea|title|noscript|xmp|plaintext)\b/i.test(html))return null;
 // The reader drops these controls; reject instead of joining across them.
 const controls=/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
 if(controls.test(html)||[...html.matchAll(/&#(x[0-9a-f]{1,8}|[0-9]{1,10});/gi)].some(([,n])=>{const hex=n[0].toLowerCase()==='x',code=Number.parseInt(hex?n.slice(1):n,hex?16:10);return code<32&&![9,10,13].includes(code)||code===127;}))return null;
 const parsed=sanitizeCommentHTML(html);if(parsed.truncated)return null;
 if(/[\u202a-\u202e\u2066-\u2069]/.test(textOf(parsed.content)))return null;
 const boundary=beforeQuotedMarkup(html);if(boundary===null)return null;
 const prefix=eligiblePrefix(boundary===html.length?parsed.content:sanitizeCommentHTML(html.slice(0,boundary)).content),text=prefix.text;
 if(/^(?:https?:\/\/|(?:yes|no|agreed|exactly|thanks|thank you)[.!\s]*$)/i.test(text))return null;
 const words=text.split(' ');if(words.length<12)return null;
 let excerpt='';for(const word of words.slice(0,HIGHLIGHT_LIMITS.words)){const next=excerpt?excerpt+' '+word:word;if(next.length>HIGHLIGHT_LIMITS.characters)break;excerpt=next;}
 if(excerpt.split(' ').length<8)return null;
 return {excerpt,truncated:prefix.stopped||boundary<html.length||excerpt.length<text.length};
}
export async function collectDiscussionHighlights(edition:Edition,basePublicationVersion:string,dependencies:{fetcher?:typeof fetch;now?:()=>number}={}):Promise<DiscussionSnapshot>{
 const fetcher=dependencies.fetcher??fetch,now=dependencies.now??Date.now,ids=discussionStoryIds(edition),started=Date.now();
 const controller=new AbortController();let expired=false;
 const timer=setTimeout(()=>{expired=true;controller.abort();},HIGHLIGHT_LIMITS.totalMs);
 const results=new Map<number,DiscussionHighlight>(),failed=new Set<number>();let requests=0;
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
  let parent:Item|null;
  try{parent=await item(storyId);}catch{failed.add(storyId);return;}
  if(!parent||parent.dead===true||parent.deleted===true)return;
  if(!['story','poll'].includes(String(parent.type))||parent.kids!==undefined&&(!Array.isArray(parent.kids)||!parent.kids.every(validId))){failed.add(storyId);return;}
  const kids=[...new Set((parent.kids as number[]|undefined)??[])].slice(0,HIGHLIGHT_LIMITS.children);
  for(let index=0;index<kids.length;index++){
   let comment:Item|null;try{comment=await item(kids[index]);}catch{failed.add(storyId);return;}
   if(!comment||comment.dead===true||comment.deleted===true)continue;
   if(comment.type!=='comment'||comment.parent!==storyId||typeof comment.by!=='string'||!/^[-\w]{1,50}$/.test(comment.by)||!validId(comment.time)||comment.time*1000>now()+300_000||typeof comment.text!=='string')continue;
   const excerpt=commentExcerpt(comment.text);if(!excerpt)continue;
   results.set(storyId,{storyId,commentId:kids[index],author:comment.by,commentTime:comment.time,hnPosition:index+1,...excerpt,retrievedAt:new Date(now()).toISOString()});break;
  }
 }
 // Fixed batches preserve candidate order independent of response timing. Stop
 // once the target is reached; never fetch extra articles just to fill a budget.
 try{for(let offset=0;offset<ids.length;offset+=HIGHLIGHT_LIMITS.concurrency){
  if(results.size>=HIGHLIGHT_LIMITS.items)break;
  const batch=ids.slice(offset,offset+HIGHLIGHT_LIMITS.concurrency);
  await Promise.all(batch.map(async id=>{if(expired){failed.add(id);return;}await story(id);}));
 }}finally{clearTimeout(timer);controller.abort();}
 const unavailableStoryIds=ids.filter(id=>failed.has(id));
 return {policy:HIGHLIGHT_POLICY,sourceGeneratedAt:edition.generatedAt,basePublicationVersion,storyIds:ids,collectedAt:new Date(now()).toISOString(),status:unavailableStoryIds.length?(unavailableStoryIds.length===ids.length?'unavailable':'partial'):'complete',unavailableStoryIds,items:ids.flatMap(id=>results.has(id)?[results.get(id)!]:[]).slice(0,HIGHLIGHT_LIMITS.items)};
}
export async function discussionSnapshotKey(edition:Edition,basePublicationVersion:string){
 const binding=JSON.stringify([HIGHLIGHT_POLICY,edition.generatedAt,basePublicationVersion,discussionStoryIds(edition)]);
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(binding));
 return 'discussion-snapshots/v3/'+Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('')+'.json';
}
/** Separate immutable side record is bound to the exact pinned source/base/IDs.
 * Concurrent drafts cannot overwrite it; replayed client data is never used.
 * Fetch failures freeze explicit partial/empty fallback rather than invent data.
 * The normal publication root CAS remains the only activation point. */
export async function prepareDiscussionHighlights(bucket:R2Bucket,edition:Edition,basePublicationVersion:string,collect=collectDiscussionHighlights):Promise<DiscussionSnapshot>{
 const key=await discussionSnapshotKey(edition,basePublicationVersion);
 async function read():Promise<DiscussionSnapshot|null>{const record=await bucket.get(key);if(!record)return null;if(record.size>HIGHLIGHT_LIMITS.snapshotBytes)throw Error('Discussion snapshot exceeds supported size.');const value:unknown=await record.json();if(!validDiscussionSnapshot(value,edition,basePublicationVersion)||value.policy!==HIGHLIGHT_POLICY)throw Error('Invalid saved discussion snapshot; refusing to replace its provenance.');return value;}
 const existing=await read();if(existing)return existing;
 const snapshot=await collect(edition,basePublicationVersion);
 if(!validDiscussionSnapshot(snapshot,edition,basePublicationVersion)||snapshot.policy!==HIGHLIGHT_POLICY)throw Error('Invalid collected discussion snapshot.');
 const serialized=JSON.stringify(snapshot);
 if(new TextEncoder().encode(serialized).byteLength>HIGHLIGHT_LIMITS.snapshotBytes)throw Error('Discussion snapshot exceeds supported size.');
 const saved=await bucket.put(key,serialized,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}});
 if(saved)return snapshot;
 const winner=await read();if(!winner)throw Error('Discussion snapshot could not be pinned.');return winner;
}
