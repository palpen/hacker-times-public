import {sourceSnapshotKey,validateEdition,type SourceSnapshot,type Story,type Edition} from './news';
import {RequestError} from './security';
import {readPublicationForWrite,PUBLICATION_KEY,type Publication} from './publication';
const PREFIX='editorial-staging/v1/';
export function stagingStamp(value:unknown):string{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)throw new RequestError('Invalid source timestamp');
 return value;
}
export async function stagingSnapshot(bucket:R2Bucket,value:unknown){
 const stamp=stagingStamp(value),obj=await bucket.get(sourceSnapshotKey(stamp));
 if(!obj)throw new RequestError('Saved candidate snapshot not found',409);
 const snapshot=await obj.json<SourceSnapshot>();
 if(snapshot.generatedAt!==stamp||!Array.isArray(snapshot.selectedStories)||snapshot.selectedStories.length<1||snapshot.selectedStories.length>126||new Set(snapshot.selectedStories.map(s=>s.id)).size!==snapshot.selectedStories.length)throw new RequestError('Invalid saved candidate snapshot',409);
 return snapshot;
}
export function assertNoEditorialHold(p:Publication){if(p.editorialSafetyStop)throw new RequestError('Publication is stopped for safety review. No retry, reconstruction, unavailable fallback or alternate publisher may bypass this hold.',409);}
function key(stamp:string,id:number){return PREFIX+stamp+'/articles/'+id+'.json';}
type RecordV1={schema:1;revision:number;generatedAt:string;basePublicationVersion?:string;story:Story;updatedAt:string};
export async function stageArticle(env:Cloudflare.Env,args:Record<string,unknown>){
 const snapshot=await stagingSnapshot(env.BUCKET!,args.generatedAt),p=await readPublicationForWrite(env);assertNoEditorialHold(p);
 if(snapshot.basePublicationVersion!==p.current.version)throw new RequestError('Publication base changed; fetch a fresh snapshot',409);
 const input=args.story as Story,selected=snapshot.selectedStories.find(s=>s.id===input?.id);
 if(!selected||['title','url','score','comments','time'].some(k=>input[k as keyof Story]!==selected[k as keyof typeof selected]))throw new RequestError('Article must match its pinned source selection');
 let story:Story;try{story=validateEdition({generatedAt:snapshot.generatedAt,stories:[input]}).stories[0];}catch{throw new RequestError('Invalid structured article fields');}
 if(snapshot.summaryPolicyVersion===1&&(story.summarySource===undefined||story.shortSummary===undefined))throw new RequestError('Explicit summary provenance and shortSummary are required');
 const text=JSON.stringify(story);if(new TextEncoder().encode(text).length>24_000)throw new RequestError('Staged article too large',413);
 const recordKey=key(snapshot.generatedAt,story.id),old=await env.BUCKET!.get(recordKey),prior=old?await old.json<RecordV1>():null;
 const expected=args.expectedRevision??0;if(!Number.isSafeInteger(expected)||Number(expected)<0)throw new RequestError('Invalid expected revision');
 if(prior&&JSON.stringify(prior.story)===text)return {ok:true,id:story.id,revision:prior.revision,unchanged:true};
 if(expected!==(prior?.revision??0))throw new RequestError('Staged article revision changed; read status before editing',409);
 const record:RecordV1={schema:1,revision:Number(expected)+1,generatedAt:snapshot.generatedAt,basePublicationVersion:snapshot.basePublicationVersion,story,updatedAt:new Date().toISOString()};
 const written=await env.BUCKET!.put(recordKey,JSON.stringify(record),{onlyIf:old?{etagMatches:old.etag}:{etagDoesNotMatch:'*'}});
 if(!written)throw new RequestError('Concurrent staged article update; read status before retrying',409);
 return {ok:true,id:story.id,revision:record.revision,published:false};
}
export async function stagedRecords(bucket:R2Bucket,snapshot:SourceSnapshot){
 const records:RecordV1[]=[];const missing:number[]=[];
 for(let i=0;i<snapshot.selectedStories.length;i+=8){await Promise.all(snapshot.selectedStories.slice(i,i+8).map(async s=>{const object=await bucket.get(key(snapshot.generatedAt,s.id));if(!object){missing.push(s.id);return;}const r=await object.json<RecordV1>();if(r.schema!==1||r.generatedAt!==snapshot.generatedAt||r.basePublicationVersion!==snapshot.basePublicationVersion||r.story?.id!==s.id||!Number.isSafeInteger(r.revision)||r.revision<1)throw new RequestError('Invalid persisted staging record',409);records.push(r);}));}
 return {records,missing};
}
export async function editorialStatus(env:Cloudflare.Env,args:Record<string,unknown>){
 const p=await readPublicationForWrite(env);const status={publicationVersion:p.current.version,publishedGeneratedAt:p.current.edition.generatedAt,safetyStop:p.editorialSafetyStop??null};
 if(args.generatedAt===undefined)return status;
 const s=await stagingSnapshot(env.BUCKET!,args.generatedAt),{records,missing}=await stagedRecords(env.BUCKET!,s);
 const failures=await env.BUCKET!.get(PREFIX+s.generatedAt+'/failure.json');
 return {...status,generatedAt:s.generatedAt,basePublicationVersion:s.basePublicationVersion,baseCurrent:s.basePublicationVersion===p.current.version,selected:s.selectedStories.length,staged:records.length,missingIds:missing,articles:records.map(r=>({id:r.story.id,revision:r.revision,summarySource:r.story.summarySource,updatedAt:r.updatedAt})),lastFailure:failures?await failures.json():null,complete:missing.length===0,readyForValidation:!p.editorialSafetyStop&&missing.length===0&&s.basePublicationVersion===p.current.version};
}
export async function stagedInput(env:Cloudflare.Env,args:Record<string,unknown>):Promise<Edition>{
 const s=await stagingSnapshot(env.BUCKET!,args.generatedAt),p=await readPublicationForWrite(env);assertNoEditorialHold(p);
 if(s.basePublicationVersion!==p.current.version)throw new RequestError('Publication base changed; fetch a fresh snapshot',409);
 const {records,missing}=await stagedRecords(env.BUCKET!,s);if(missing.length)throw new RequestError('Staged edition is incomplete; missing '+missing.length+' selected articles',409);
 return {generatedAt:s.generatedAt,stories:records.map(r=>r.story)} as Edition;
}
export async function recordEditorialFailure(env:Cloudflare.Env,args:Record<string,unknown>){
 const stamp=stagingStamp(args.generatedAt),kinds=['source_unavailable','transient','validation','safety_stop'];
 if(!kinds.includes(String(args.kind)))throw new RequestError('Invalid failure category');
 const s=await stagingSnapshot(env.BUCKET!,stamp);if(args.storyId!==undefined&&!s.selectedStories.some(x=>x.id===args.storyId))throw new RequestError('Failure story is not selected');
 const failure={kind:args.kind,generatedAt:stamp,...(args.storyId!==undefined?{storyId:args.storyId}:{}),recordedAt:new Date().toISOString()};
 if(args.kind==='safety_stop'){
  // Updating the same publication root invalidates any in-flight publication CAS.
  // No tool removes this hold. It contains identifiers only, never blocked copy.
  for(let attempt=0;attempt<3;attempt++){
   const p=await readPublicationForWrite(env);if(p.editorialSafetyStop)return {ok:true,retained:true,safetyStop:p.editorialSafetyStop};
   const root=await env.BUCKET!.get(PUBLICATION_KEY);if(!root)throw new RequestError('Publication unavailable',503);
   const fresh=await root.json<Publication>();if(fresh.current.version!==p.current.version)continue;
   if(fresh.editorialSafetyStop)return {ok:true,retained:true,safetyStop:fresh.editorialSafetyStop};
   const saved=await env.BUCKET!.put(PUBLICATION_KEY,JSON.stringify({...fresh,editorialSafetyStop:failure}),{onlyIf:{etagMatches:root.etag}});
   if(saved)return {ok:true,retained:true,safetyStop:failure};
  }
  throw new RequestError('Concurrent publication change; safety hold was not recorded. Stop processing and report.',409);
 }
 await env.BUCKET!.put(PREFIX+stamp+'/failure.json',JSON.stringify(failure));
 return {ok:true,recorded:true,published:false};
}
