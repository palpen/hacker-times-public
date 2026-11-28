import type {Story} from '../contracts';
import {editionLimits} from '../contracts';
import {validateEdition} from '../news';
import {renderEdition} from '../render-edition';
import {RequestError,jsonBody} from '../security';
import {fetchOfficialItems} from '../reporting';
import {CollectionError,parseCollectionDetails,type CollectionDetails} from '../collection-error';
import {MAX_SNAPSHOT_AGE_MS,pinSnapshot} from './selection';
import {editorialRequestKey,editorialResolutionKey,leadEvidenceIdentity,settleModel,verifiedEditorialReceipt,type Reservation} from './editorial-checkpoints';
import {digest,readBlob,writeBlob,equivalent,type Store} from './storage';
import {isProviderOverload,parseModelFailureDetails,MAX_EDITORIAL_ATTEMPTS} from './editorial-model';
import {ArchiveCopies} from './archived-copy';
import {publisherFeedUrl} from './publisher-feed';
import {runEdition} from './runner';
import {observeRun} from './run-log';
import {importArchive} from './archive-import';
import {archiveMigrationManifest} from './archive-manifest';
import {collectTrendingHighlights} from '../collect-trending-highlights';
import {validDiscussionSnapshot,type DiscussionSnapshot} from '../discussion-highlights';
import {discussionBatchCount,discussionBatchEdition,checkDiscussionBatch,combineDiscussionBatches} from './discussions';
import type {Edition} from '../contracts';
import type {ProductionEnv,Root,Snapshot,Staged,Source,Publication} from './types';
import {publicFetchUrl} from '../reporting';
import {imageHash,imageUrl,imageReviewKey,validImageAsset,cleanImageAlt,IMAGE_POLICY,type ImageAsset,type ImageResult} from './images';
const empty=():Root=>({schema:1,revision:0,version:'empty',archives:{},ledger:{retiredIds:[],retiredKeys:[],observations:[]}});
type CollectionFailure={scheduleSlot:string|null;attempts:number;failedAt:string;httpStatus:number;details:CollectionDetails|null;retryAt:string|null;recoveredAt:string|null};
const collectionFailureKey='run/collection-failure';
function stamp(value:unknown):string {
 if(typeof value!=='string'||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)throw new RequestError('Exact source timestamp required');return value;
}
function snapshotKey(at:string){return 'snapshot/'+stamp(at);}
function stageKey(at:string,id:number){return 'stage/'+stamp(at)+'/'+id;}
function sourceKey(at:string,id:number){return 'source/'+stamp(at)+'/'+id;}
function discussionKey(at:string){return 'discussion/'+stamp(at);}
function expired(at:string){return Date.now()-Date.parse(at)>MAX_SNAPSHOT_AGE_MS;}
function progressKey(at:string){return 'run/last-progress/'+at;}
function recordProgress(store:Store,at:string){return store.put(progressKey(at),new Date(Date.now()).toISOString());}
function reservationCheckpoint(at:string,id:number){return 'run/editorial/'+at+'/'+id;}
type RecoveryAudit={
 generatedAt:string;basePublicationVersion:string;baseRevision:number;githubRun:string;recordedAt:string;
 resolutions:{storyId:number;reservationKey:string;outcome:'receipt_settled'|'charge_retained'}[];
};
async function pinnedEditorial(store:Store,s:Snapshot,id:unknown,env?:ProductionEnv){
 const selected=s.selectedStories.find(x=>x.id===id);
 const source=selected?await store.get<Source>(sourceKey(s.generatedAt,selected.id)):null;
 if(!selected||!source)return null;
 const checkpoint=await store.get<{key:string;sourceFingerprint:string}>(reservationCheckpoint(s.generatedAt,selected.id));
 const key=checkpoint?.sourceFingerprint===source.fingerprint?checkpoint.key:await editorialRequestKey(env,selected,source);
 return {selected,source,key};
}
function hold(root:Root){if(root.safetyStop)throw new RequestError('Explicit safety stop: no retry, reconstruction, fallback or alternate publisher',409);}
async function rootAt(store:Store):Promise<Root>{
 const root=await readBlob<Root>(store,'root');if(!root)throw new RequestError('Publication authority missing; recovery required',503);
 if(root.schema!==1||!Number.isSafeInteger(root.revision)||!root.ledger||!root.archives||typeof root.version!=='string')throw new RequestError('Publication authority invalid; recovery required',503);return root;
}
async function snapshotAt(store:Store,at:string,root:Root){
 const s=await readBlob<Snapshot>(store,snapshotKey(at));if(!s)throw new RequestError('Saved selection not found',404);
 hold(root);
 if(root.version!==s.basePublicationVersion||root.revision!==s.baseRevision)throw new RequestError('Pinned publication base changed; collect a new snapshot',409);
 if(await store.get('pending')!==at)throw new RequestError('Snapshot is no longer the pending batch',409);
 return s;
}
async function stageRecords(store:Store,s:Snapshot){
 const records:Staged[]=[],missing:number[]=[];
 for(const selected of s.selectedStories){const r=await store.get<Staged>(stageKey(s.generatedAt,selected.id));if(r)records.push(r);else missing.push(selected.id);}
 return {records,missing};
}
async function checkedEdition(store:Store,s:Snapshot,root:Root){
 const rebuilt=pinSnapshot(root,s);
 if(JSON.stringify(rebuilt.nextLedger)!==JSON.stringify(s.nextLedger)||!equivalent(rebuilt.leadAudit,s.leadAudit))throw new RequestError('Pinned lead plan invalid',409);
 const {records,missing}=await stageRecords(store,s);if(missing.length)throw new RequestError('Incomplete edition: '+missing.length+' selected articles missing',409);
 for(const record of records)if(record.story.image){
  const hash=imageHash(record.story.image),source=await store.get<Source>(sourceKey(s.generatedAt,record.story.id));
  const review=record.imageReviewKey?await store.get<{state:string;result?:ImageResult}>('model/'+record.imageReviewKey):null;
  if(!hash||!source||source.fingerprint!==record.sourceFingerprint||review?.state!=='completed'||review.result?.policy!==IMAGE_POLICY||review.result.hash!==hash||!review.result.approved||review.result.alt!==record.story.imageAlt||!await store.get('image-asset/'+hash+'/count'))throw new RequestError('Verified image evidence required',409);
 }
 const prior=root.version==='empty'?null:await readBlob<Publication>(store,'version/'+root.version);
 if(root.version!=='empty'&&!prior)throw new RequestError('Current edition missing; recovery required',503);
 const edition=validateEdition({generatedAt:s.generatedAt,stories:records.map(r=>r.story)},prior?.edition,s,true);
 const lead=edition.stories[0],leadRecord=records[0],source=await store.get<Source>(sourceKey(s.generatedAt,lead.id));
 const leadEvidence=await leadEvidenceIdentity(lead,source?.fingerprint===leadRecord.sourceFingerprint?source??null:null);
 if(leadEvidence&&prior?.leadEvidence===leadEvidence&&root.ledger.active?.key===s.nextLedger.active?.key){
  lead.headline=prior.edition.stories[0].headline;
 }
 const highlights=await store.get<DiscussionSnapshot>(discussionKey(s.generatedAt));
 if(highlights){
  if(!validDiscussionSnapshot(highlights,edition,s.basePublicationVersion))throw new RequestError('Saved discussions do not match this edition',409);
  edition.discussionHighlights=highlights;
 }
 return {edition,leadEvidence};
}
// Only reachable through the private namespace binding. Public requests never
// forward editorial operations; the scheduler and alarm workflow use them internally.
export class Newsroom {
 private archiveCopies=new ArchiveCopies();
 constructor(private state:DurableObjectState,private env?:ProductionEnv){
  state.blockConcurrencyWhile(async()=>{await state.storage.transaction(async tx=>{
   const exists=await tx.get('initialized');if(exists){await rootAt(tx);return;}
   if(await readBlob(tx,'root'))throw Error('Unrecognized root; refusing implicit reset');
   await writeBlob(tx,'root',empty());await tx.put('initialized',true);
  });});
 }
 private automatic(){return this.env?.SCHEDULE_ENABLED==='true'&&this.env?.AUTO_EDITORIAL_ENABLED==='true'&&this.env?.MUTATIONS_ENABLED==='true'&&this.env?.LIVE_FETCH_ENABLED==='true';}
 async alarm(){
  if(!this.automatic())return;
  // runEdition's fenced lease and reservation ledger make alarm retries safe.
  // An uncertain provider request is never sent a second time.
  await observeRun('alarm',()=>runEdition(this.env!,request=>this.fetch(request)));
 }
 async fetch(request:Request):Promise<Response>{
  try {
   const path=new URL(request.url).pathname;
   if(request.method!=='POST')return new Response('Method not allowed',{status:405});
   const args=await jsonBody(request,editionLimits.payloadBytes);
   const result=await this.state.storage.transaction(async tx=>{
    const root=await rootAt(tx);
    if(path==='/run-claim'){
     hold(root);const now=Date.now(),prior=await tx.get<{token:string;expiresAt:number}>('run/lease');
     if(prior&&prior.expiresAt>now)return {claimed:false};
     const scheduleSlot=await tx.get<string>('schedule/slot')??null,failure=await tx.get<CollectionFailure>(collectionFailureKey);
     // Alarm delivery is at least once, including platform retries after throws.
     // They must not bypass our backoff or restart an exhausted collection slot.
     if(!await tx.get('pending')&&failure&&!failure.recoveredAt&&failure.scheduleSlot===scheduleSlot&&(failure.retryAt===null||Date.parse(failure.retryAt)>now)){
      if(this.automatic()){
       if(failure.retryAt!==null)await tx.setAlarm(Date.parse(failure.retryAt));
       else await tx.deleteAlarm();
      }
      return {claimed:false,collectionDeferred:true};
     }
     const lease={token:crypto.randomUUID(),expiresAt:now+5*60_000,scheduleSlot};await tx.put('run/lease',lease);
     if(this.automatic())await tx.setAlarm(lease.expiresAt+1_000);
     return {claimed:true,...lease};
    }
    if(path==='/run-release'){
     const lease=await tx.get<{token:string;scheduleSlot?:string|null}>('run/lease');
     if(lease&&lease.token===args._runToken){
      await tx.delete('run/lease');
      const pending=await tx.get<string>('pending');let retryAt:number|null=null;
      if(args.collectionFailure&&typeof args.collectionFailure==='object'){
       const input=args.collectionFailure as {httpStatus?:unknown;details?:unknown},details=parseCollectionDetails(input.details);
       const httpStatus=typeof input.httpStatus==='number'&&Number.isInteger(input.httpStatus)&&input.httpStatus>=400&&input.httpStatus<=599?input.httpStatus:500;
       const prior=await tx.get<CollectionFailure>(collectionFailureKey),scheduleSlot=lease.scheduleSlot??null;
       const attempts=prior?.scheduleSlot===scheduleSlot&&!prior.recoveredAt?Math.min(prior.attempts+1,3):1;
       // Metadata GETs have no provider usage to replay. Only known transient
       // failures get two one-minute retries per cron slot, each in a fresh run.
       const transient=details?.reason==='transport'||details?.reason==='http'&&(details.upstreamStatus===408||details.upstreamStatus===429||Number(details.upstreamStatus)>=500);
       if(transient&&attempts<3&&this.automatic()&&!pending&&!root.safetyStop)retryAt=Date.now()+60_000;
       await tx.put(collectionFailureKey,{scheduleSlot,attempts,failedAt:new Date().toISOString(),httpStatus,details,retryAt:retryAt===null?null:new Date(retryAt).toISOString(),recoveredAt:null} satisfies CollectionFailure);
      }
      if(this.automatic()){
       if(pending&&!expired(pending)&&!root.safetyStop)await tx.setAlarm(Date.now()+(Number.isInteger(args.continuationDelayMs)&&Number(args.continuationDelayMs)>=1_000&&Number(args.continuationDelayMs)<=60_000?Number(args.continuationDelayMs):30*60_000));
       else if(retryAt!==null)await tx.setAlarm(retryAt);
       else await tx.deleteAlarm();
      }
     }
     return {released:!!lease&&lease.token===args._runToken};
    }
    // Fence all runner operations, including model reservation before an API call.
    // A safety report is the sole exception: an expired runner must still stop work.
    const safetyReport=path==='/failure'&&args.kind==='safety_stop';
    if(!safetyReport){
     const lease=await tx.get<{token:string;expiresAt:number}>('run/lease');
     if(args._runToken!==undefined&&(!lease||lease.token!==args._runToken||lease.expiresAt<=Date.now()))throw new RequestError('Runner lease expired or superseded',409);
     if(lease&&lease.expiresAt>Date.now()&&args._runToken!==lease.token&&['/collect-items','/snapshot','/source','/recover-archive','/recover-feed','/stage','/validate','/publish','/model-reserve','/model-editorial-receipt','/model-editorial-settle','/model-complete','/model-failed','/model-rejected','/run-progress','/prepare-discussions','/save-discussion-batch','/image-next','/image-done'].includes(path))throw new RequestError('Another bounded runner owns editorial writes',409);
    }
    if(path==='/collect-items'){
     hold(root);
     if(this.env?.LIVE_FETCH_ENABLED!=='true')throw new RequestError('Live collection is disabled',503);
     const ids=args.ids,at=args.at;
     if(!Array.isArray(ids)||!ids.length||ids.length>32||ids.some(id=>!Number.isSafeInteger(id)||id<=0)||new Set(ids).size!==ids.length||typeof at!=='number'||!Number.isSafeInteger(at)||at>Date.now()+300_000||at<Date.now()-48*3600_000)throw new RequestError('Invalid bounded collection batch');
     return {ids:ids as number[],at};
    }
    if(path==='/import-archive'){
     hold(root);
     if(this.env?.MUTATIONS_ENABLED!=='true')throw new RequestError('Archive import disabled',503);
     return importArchive(tx,root,args.edition,archiveMigrationManifest);
    }
    if(path==='/root')return root;
    if(path==='/edition'){
     const version=typeof args.version==='string'&&/^e-[a-f0-9]{24}$/.test(args.version)?args.version:typeof args.date==='string'?root.archives[args.date]:root.version;
     if(!version||version==='empty')throw new RequestError('No published edition',404);
     const p=await readBlob<Publication>(tx,'version/'+version);if(!p)throw new RequestError('Published edition missing',503);return p;
    }
    if(path==='/archive')return {dates:Object.keys(root.archives).sort().reverse(),publicationVersion:root.version};
    if(path==='/image'){
     const hash=String(args.hash);
     if(!/^[a-f0-9]{64}$/.test(hash)||!await tx.get('published-image/'+hash))throw new RequestError('Image not found',404);
     const asset=await readBlob<ImageAsset>(tx,'image-asset/'+hash);if(!asset)throw new RequestError('Image missing',503);return asset;
    }
    if(path==='/recover-expired-batch'){
     hold(root);
     if(this.env?.MUTATIONS_ENABLED!=='true')throw new RequestError('Publisher recovery is disabled',503);
     const at=stamp(args.generatedAt),base=args.basePublicationVersion,revision=args.baseRevision,githubRun=args.githubRun;
     if(typeof base!=='string'||!/^(empty|e-[a-f0-9]{24})$/.test(base)||typeof revision!=='number'||!Number.isSafeInteger(revision)||revision<0||
        typeof githubRun!=='string'||!/^\d{1,20}\/\d{1,8}$/.test(githubRun))throw new RequestError('Exact publication base and GitHub run required');
     const auditKey='recovery/'+at,prior=await tx.get<RecoveryAudit>(auditKey);
     if(prior&&prior.basePublicationVersion===base&&prior.baseRevision===revision)return {...prior,unchanged:true};
     if(root.version!==base||root.revision!==revision)throw new RequestError('Publication base changed; inspect before recovery',409);
     const snapshot=await snapshotAt(tx,at,root);
     if(!expired(at))throw new RequestError('Only a batch older than 48 hours can be superseded',409);
     const lease=await tx.get<{expiresAt:number}>('run/lease');
     if(lease&&lease.expiresAt>Date.now())throw new RequestError('Publisher lease is active; inspect again after expiry',409);
     const audit:RecoveryAudit={generatedAt:at,basePublicationVersion:base,baseRevision:revision,githubRun,recordedAt:new Date(Date.now()).toISOString(),resolutions:[]};
     const {missing}=await stageRecords(tx,snapshot);
     for(const id of missing){
      const pinned=await pinnedEditorial(tx,snapshot,id,this.env);
      if(!pinned)continue;
      const {selected,source,key}=pinned,modelKey='model/'+key;
      const reservation=await tx.get<Reservation>(modelKey);
      if(reservation?.state!=='reserved'||reservation.unknownResolvedAt)continue;
      if(reservation.receipt){
       await settleModel(tx,key,reservation,reservation.receipt.result,reservation.receipt.actualCost);
       audit.resolutions.push({storyId:id,reservationKey:key,outcome:'receipt_settled'});
      }else{
       await tx.put(modelKey,{...reservation,unknownResolvedAt:audit.recordedAt});
       await tx.put('editorial-resolution/'+await editorialResolutionKey(selected,source),{reservationKey:key,generatedAt:at});
       audit.resolutions.push({storyId:id,reservationKey:key,outcome:'charge_retained'});
      }
     }
     await tx.put(auditKey,audit);
     await tx.put('run/last-recovery',at);
     await tx.delete('pending');
     await tx.delete('run/lease');
     if(this.automatic())await tx.setAlarm(Date.now()+1_000);
     else await tx.deleteAlarm();
     return audit;
    }
    if(path==='/model-editorial-receipt'||path==='/model-editorial-settle'){
     const at=stamp(args.generatedAt),snapshot=await snapshotAt(tx,at,root);
     const pinned=await pinnedEditorial(tx,snapshot,args.storyId,this.env);
     if(!pinned||pinned.key!==args.key)throw new RequestError('Editorial reservation does not match pinned source',409);
     const {key,source,selected}=pinned,reservation=await tx.get<Reservation>('model/'+key);
     if(reservation?.state==='completed')return {saved:true};
     if(reservation?.state!=='reserved'||reservation.unknownResolvedAt)throw new RequestError('Unresolved editorial reservation required',409);
     if(path==='/model-editorial-receipt'){
      const receipt=verifiedEditorialReceipt(args.result,source,selected,this.env);
      if(receipt.actualCost>reservation.cost)throw new RequestError('Provider usage cannot be settled within reservation',409);
      if(reservation.receipt&&JSON.stringify(reservation.receipt)!==JSON.stringify(receipt))throw new RequestError('Editorial receipt already recorded',409);
      await tx.put('model/'+key,{...reservation,receipt});
     }else{
      if(!reservation.receipt)throw new RequestError('Verified provider receipt required',409);
      await settleModel(tx,key,reservation,reservation.receipt.result,reservation.receipt.actualCost);
     }
     return {saved:true,...(reservation.receipt?{result:reservation.receipt.result}:{})};
    }
    if(path==='/model-reserve'){
     hold(root);
     const key=String(args.key),cost=Number(args.cost),dailyLimit=Number(args.dailyLimit),monthlyLimit=Number(args.monthlyLimit);
     if(!/^[a-f0-9]{64}$/.test(key)||![cost,dailyLimit,monthlyLimit].every(x=>Number.isSafeInteger(x)&&x>0)||cost>dailyLimit||dailyLimit>monthlyLimit)throw new RequestError('Invalid approved model budget');
     // Every text and image request shares these counters and hard server caps.
     const approvedMonth=Math.min(5_000_000,Number(this.env?.MODEL_MONTHLY_LIMIT_MICRO_USD||5_000_000));
     const approvedDay=Math.min(1_000_000,Number(this.env?.MODEL_DAILY_LIMIT_MICRO_USD||1_000_000));
     if(!Number.isSafeInteger(approvedMonth)||!Number.isSafeInteger(approvedDay)||monthlyLimit>approvedMonth||dailyLimit>approvedDay)throw new RequestError('Model budget exceeds approved total cap',429);
     if(args.generatedAt!==undefined){
      const at=stamp(args.generatedAt),snapshot=await snapshotAt(tx,at,root);
      const pinned=await pinnedEditorial(tx,snapshot,args.storyId,this.env);
      if(!pinned||key!==pinned.key)throw new RequestError('Editorial reservation does not match pinned source',409);
      if(await tx.get('editorial-resolution/'+await editorialResolutionKey(pinned.selected,pinned.source)))return {state:'unknown_resolved'};
      await tx.put(reservationCheckpoint(at,pinned.selected.id),{key,sourceFingerprint:pinned.source.fingerprint});
     }
     const prior=await tx.get<Reservation&{retryable?:boolean;history?:unknown[];details?:unknown;rejectedFailureAt?:string;retryAt?:number}>('model/'+key);
     if(prior&&!(prior.state==='failed'&&prior.retryable&&(prior.attempt??1)<MAX_EDITORIAL_ATTEMPTS&&(!prior.retryAt||Date.now()>=prior.retryAt)))return prior;
     const now=new Date().toISOString(),day=now.slice(0,10),month=now.slice(0,7),daily=await tx.get<number>('budget/day/'+day)??0,monthly=await tx.get<number>('budget/month/'+month)??0;
     if(daily+cost>dailyLimit||monthly+cost>monthlyLimit)throw new RequestError('Model budget limit reached; no API call made',429);
     // Reserve before sending. Only validated provider usage may settle a charge.
     // Unknown calls stay reserved. Confirmed invalid output needs a fresh budgeted attempt.
     await tx.put('budget/day/'+day,daily+cost);await tx.put('budget/month/'+month,monthly+cost);
     const reservation={state:'reserved',cost,day,month,createdAt:now,attempt:prior?(prior.attempt??1)+1:1,...(prior?{...(prior.rejectedFailureAt?{rejectedFailureAt:prior.rejectedFailureAt}:{}),history:[...(prior.history??[]),{settledCost:prior.settledCost,details:prior.details}]}:{})};await tx.put('model/'+key,reservation);return {...reservation,created:true};
    }
    if(path==='/model-rejected'){
     hold(root);const key=String(args.key),at=stamp(args.generatedAt),snapshot=await snapshotAt(tx,at,root);
     const pinned=await pinnedEditorial(tx,snapshot,args.storyId,this.env);
     if(!pinned||key!==pinned.key)throw new RequestError('Failure reservation does not match pinned source',409);
     const {selected}=pinned;
     const prior=await tx.get<{state:string;cost:number;day:string;month:string;createdAt:string;attempt?:number;rejectedFailureAt?:string;unknownResolvedAt?:string;receipt?:unknown}>('model/'+key);
     const failure=await tx.get<{kind:string;storyId?:number;recordedAt:string;details?:unknown}>('failure/'+at+'/'+selected.id);
     const details=parseModelFailureDetails(failure?.details);
     // Only a parsed, explicit HTTP rejection, after safety checks, is eligible.
     // No refund: reserve another full charge within the unchanged attempt/cost caps.
     // A historical failure must never authorize replay of a later uncertain call.
     const overload=isProviderOverload(failure?.kind,details);
     if(!prior||prior.state!=='reserved'||prior.unknownResolvedAt||prior.receipt||!failure||(!(failure.kind==='validation'&&details?.phase==='http'&&details.httpStatus===403)&&!overload)||failure.storyId!==selected.id||
        !Number.isFinite(Date.parse(failure.recordedAt))||!Number.isFinite(Date.parse(prior.createdAt))||Date.parse(failure.recordedAt)<Date.parse(prior.createdAt)||failure.recordedAt===prior.rejectedFailureAt)return {recovered:false,retryable:false};
     await tx.put('model/'+key,{...prior,state:'failed',retryable:(prior.attempt??1)<MAX_EDITORIAL_ATTEMPTS,settledCost:prior.cost,details,rejectedFailureAt:failure.recordedAt,...(overload?{retryAt:Date.parse(failure.recordedAt)+30_000*2**((prior.attempt??1)-1)}:{})});
     return {recovered:true,retryable:(prior.attempt??1)<MAX_EDITORIAL_ATTEMPTS};
    }
    if(path==='/model-failed'){
     hold(root);const key=String(args.key),at=stamp(args.generatedAt);
     const snapshot=await snapshotAt(tx,at,root);
     const failure=await tx.get<{kind:string;storyId?:number;details?:unknown}>('failure/'+at+'/'+args.storyId)??await tx.get<{kind:string;storyId?:number;details?:unknown}>('failure/'+at);
     const details=parseModelFailureDetails(failure?.details);
     if(!snapshot.selectedStories.some(x=>x.id===args.storyId)||failure?.storyId!==args.storyId||failure?.kind!=='validation'||details?.phase!=='output')throw new RequestError('Confirmed output validation failure required',409);
     const pinned=await pinnedEditorial(tx,snapshot,args.storyId,this.env);
     if(!pinned||key!==pinned.key)throw new RequestError('Failure reservation does not match pinned source',409);
     const prior=await tx.get<Reservation>('model/'+key);
     if(!prior||prior.state!=='reserved'||prior.unknownResolvedAt||prior.receipt)throw new RequestError('Unresolved model reservation required',409);
     // Operator recovery can retain the full charge when historical token usage
     // was not recorded. It never refunds or retries an unknown transport call.
     const actualCost=args.retainReservation===true?prior.cost:Number(args.actualCost);
     if(!Number.isSafeInteger(actualCost)||actualCost<0||actualCost>prior.cost)throw new RequestError('Invalid failed model accounting');
     for(const budgetKey of ['budget/day/'+prior.day,'budget/month/'+prior.month]){
      const total=await tx.get<number>(budgetKey);if(total===undefined||total<prior.cost)throw new RequestError('Budget accounting mismatch',503);
      await tx.put(budgetKey,total-prior.cost+actualCost);
     }
     const draft=args.draft;
     const checkedDraft=draft&&typeof draft==='object'&&Object.keys(draft).length===4&&['headline','summary','shortSummary','summarySource'].every(k=>typeof (draft as Record<string,unknown>)[k]==='string')&&JSON.stringify(draft).length<=2500?draft:undefined;
     await tx.put('model/'+key,{...prior,state:'failed',retryable:true,settledCost:actualCost,details,...(checkedDraft?{draft:checkedDraft}:{})});return {retryable:(prior.attempt??1)<MAX_EDITORIAL_ATTEMPTS};
    }
    if(path==='/model-complete'){
     hold(root);const key=String(args.key),prior=await tx.get<Reservation>('model/'+key);
     if(!prior||prior.state!=='reserved'||prior.unknownResolvedAt||prior.receipt)throw new RequestError('Model reservation missing or already resolved',409);
     if(!args.result||new TextEncoder().encode(JSON.stringify(args.result)).length>24_000)throw new RequestError('Invalid bounded model result');
     await settleModel(tx,key,prior,args.result,Number(args.actualCost));return {saved:true};
    }
    if(path==='/schedule'){
     const slot=String(args.slot);if(!/^\d+$/.test(slot))throw new RequestError('Invalid schedule slot');
     const last=await tx.get<string>('schedule/slot');if(last&&Number(last)>=Number(slot))return {claimed:false};
     hold(root);await tx.put('schedule/slot',slot);return {claimed:true};
    }
    if(path==='/snapshot'){
     hold(root);const s=args.snapshot as Snapshot;
     if(!s||s.baseRevision!==root.revision||s.basePublicationVersion!==root.version)throw new RequestError('Publication changed during collection',409);
     const pinned=pinSnapshot(root,s);if(JSON.stringify({...pinned,leadAudit:undefined})!==JSON.stringify({...s,leadAudit:undefined})||!equivalent(pinned.leadAudit,s.leadAudit))throw new RequestError('Invalid server-pinned snapshot',409);
     const k=snapshotKey(s.generatedAt),old=await readBlob<Snapshot>(tx,k);
     if(old&&JSON.stringify(old)!==JSON.stringify(s))throw new RequestError('Snapshot timestamp collision',409);
     if(!old){await writeBlob(tx,k,s);await recordProgress(tx,s.generatedAt);}
     const failure=await tx.get<CollectionFailure>(collectionFailureKey);
     if(failure&&!failure.recoveredAt)await tx.put(collectionFailureKey,{...failure,retryAt:null,recoveredAt:new Date().toISOString()});
     await tx.put('pending',s.generatedAt);return {generatedAt:s.generatedAt,selected:s.selectedStories.length,baseVersion:root.version,published:false};
    }
    if(path==='/status'&&!args.generatedAt){
     const lastRecovery=await tx.get<string>('run/last-recovery');
     return {lastRecovery:lastRecovery?await tx.get('recovery/'+lastRecovery)??null:null,runner:{leaseExpiresAt:(await tx.get<{expiresAt:number}>('run/lease'))?.expiresAt??null,scheduleSlot:await tx.get('schedule/slot')??null,collectionFailure:await tx.get<CollectionFailure>(collectionFailureKey)??null},publicationVersion:root.version,publicationRevision:root.revision,generatedAt:root.generatedAt??null,safetyStop:root.safetyStop??null,pending:await tx.get('pending')??null,modelBudget:{dailyReservedMicroUsd:await tx.get('budget/day/'+new Date().toISOString().slice(0,10))??0,monthlyReservedMicroUsd:await tx.get('budget/month/'+new Date().toISOString().slice(0,7))??0}};
    }
    const at=stamp(args.generatedAt),s=await readBlob<Snapshot>(tx,snapshotKey(at));if(!s)throw new RequestError('Saved selection not found',404);
    if(path==='/status'){
     const {records,missing}=await stageRecords(tx,s);
     return {generatedAt:at,ageMs:Math.max(0,Date.now()-Date.parse(at)),expired:expired(at),lastProgressAt:await tx.get(progressKey(at))??null,
      basePublicationVersion:s.basePublicationVersion,baseRevision:s.baseRevision,recovery:await tx.get('recovery/'+at)??null,publicationVersion:root.version,baseCurrent:root.version===s.basePublicationVersion&&root.revision===s.baseRevision,safetyStop:root.safetyStop??null,selected:s.selectedStories.length,cursor:await tx.get('run/cursor/'+at)??null,staged:records.length,missingIds:missing,articles:records.map(x=>({id:x.story.id,revision:x.revision,summarySource:x.story.summarySource})),failure:await tx.get('failure/'+at)??null};
    }
    if(path==='/model-review'){
     const pinned=await pinnedEditorial(tx,s,args.storyId,this.env);
     if(!pinned)return null;
     const record=await tx.get<Reservation&{details?:unknown;draft?:unknown}>('model/'+pinned.key);
     const failure=await tx.get<{kind:string;details?:unknown}>('failure/'+at+'/'+pinned.selected.id);
     if(!record&&!failure)return null;
     return {reservationKey:record?pinned.key:null,state:record?.state??null,attempt:record?.attempt??null,
      cost:record?.cost??null,createdAt:record?.createdAt??null,hasReceipt:!!record?.receipt,
      reason:record?.unknownResolvedAt?'charge_retained':record?.state==='reserved'?(record.receipt?'receipt_pending':'model_outcome_uncertain'):failure?.kind??null,
      details:failure?.details??record?.details??null,hasDraft:!!record?.draft};
    }
    if(path==='/failure'){
     if(!['source_unavailable','transient','validation','safety_stop'].includes(String(args.kind)))throw new RequestError('Invalid failure kind');
     if(args.storyId!==undefined&&!s.selectedStories.some(x=>x.id===args.storyId))throw new RequestError('Failure is not in selected batch');
     const details=parseModelFailureDetails(args.details);
     const failure={kind:args.kind,...(details?{details}:{}),generatedAt:at,...(args.storyId!==undefined?{storyId:args.storyId as number}:{}),recordedAt:new Date().toISOString()};
     if(args.kind==='safety_stop'){
      if(!root.safetyStop){root.safetyStop={...failure,kind:'safety_stop'};root.revision++;await writeBlob(tx,'root',root);}
      await tx.deleteAlarm();return {recorded:true,safetyStop:root.safetyStop};
     }
     hold(root);await tx.put('failure/'+at,failure);if(args.storyId!==undefined)await tx.put('failure/'+at+'/'+args.storyId,failure);return {recorded:true,published:false};
    }
    await snapshotAt(tx,at,root);
    if(path==='/selection')return s;
    if(path==='/image-next'){
     hold(root);if(this.env?.MUTATIONS_ENABLED==='false')throw new RequestError('Image review is disabled',503);
     const {records,missing}=await stageRecords(tx,s);if(missing.length)throw new RequestError('Finish required articles before images',409);
     for(const record of records){
      const source=await tx.get<Source>(sourceKey(at,record.story.id));
      if(source?.kind==='article'&&source.imageCandidate&&(source.excerpt.trim()||source.description.trim())&&record.story.summarySource!=='unavailable'&&!await tx.get('image-done/'+at+'/'+record.story.id))return {complete:false,id:record.story.id,source};
     }
     return {complete:true};
    }
    if(path==='/image-done'){
     hold(root);const id=Number(args.id),record=await tx.get<Staged>(stageKey(at,id)),source=await tx.get<Source>(sourceKey(at,id));
     if(!s.selectedStories.some(row=>row.id===id)||!record||!source||source.fingerprint!==record.sourceFingerprint)throw new RequestError('Pinned image source required',409);
     const checkpoint='image-done/'+at+'/'+id;if(await tx.get(checkpoint))return {unchanged:true};
     if(args.asset||args.key){
      if(source.kind!=='article'||!source.imageCandidate||record.story.summarySource==='unavailable')throw new RequestError('Article image evidence required',409);
      const asset=await validImageAsset(args.asset);
      if(!asset||args.key!==await imageReviewKey(source,this.env?.EDITORIAL_MODEL||'gpt-6-luna',asset.hash))throw new RequestError('Image review identity mismatch',409);
      const review=await tx.get<{state:string;result?:ImageResult}>('model/'+args.key),result=review?.result;
      if(review?.state!=='completed'||result?.policy!==IMAGE_POLICY||result.hash!==asset.hash||!result.approved||!cleanImageAlt(result.alt))throw new RequestError('Approved visual verification required',409);
      const assetKey='image-asset/'+asset.hash;
      if(!await tx.get(assetKey+'/count'))await writeBlob(tx,assetKey,asset);
      await tx.put(stageKey(at,id),{...record,revision:record.revision+1,imageReviewKey:args.key,story:{...record.story,image:imageUrl(asset.hash),imageAlt:result.alt,imageCredit:record.story.publisher}});
      await tx.delete('validation/'+at);
     }
     await tx.put(checkpoint,true);await recordProgress(tx,at);return {saved:true};
    }
    if(path==='/prepare-discussions'||path==='/save-discussion-batch'){
     if(this.env?.LIVE_FETCH_ENABLED!=='true'||this.env?.MUTATIONS_ENABLED!=='true')throw new RequestError('Discussion collection is disabled',503);
     const {edition}=await checkedEdition(tx,s,root);
     if(edition.discussionHighlights)return {complete:true,items:edition.discussionHighlights.items.length};
     const count=discussionBatchCount(edition),batches:DiscussionSnapshot[]=[];
     for(let index=0;index<count;index++){
      const key=discussionKey(at)+'/batch/'+index,existing=await tx.get<DiscussionSnapshot>(key);
      if(existing){checkDiscussionBatch(existing,edition,s.basePublicationVersion!,index);batches.push(existing);continue;}
      if(path==='/prepare-discussions')return {complete:false,index,edition,base:s.basePublicationVersion};
      if(args.index!==index)throw new RequestError('Discussion checkpoint changed',409);
      checkDiscussionBatch(args.snapshot,edition,s.basePublicationVersion!,index);
      await tx.put(key,args.snapshot);await recordProgress(tx,at);batches.push(args.snapshot);
      if(index+1<count)return {complete:false,collected:index+1,total:count};
     }
     const combined=combineDiscussionBatches(edition,s.basePublicationVersion!,batches);
     await tx.put(discussionKey(at),combined);await tx.delete('validation/'+at);
     return {complete:true,items:combined.items.length,status:combined.status};
    }
    if(path==='/run-progress'){
     if(!s.selectedStories.some(x=>x.id===args.id))throw new RequestError('Invalid checkpoint article');
     await tx.put('run/cursor/'+at,args.id);return {saved:true};
    }
    if(path==='/source'){
     const source=args.source as Source;
     if(source?.archive!==undefined||source?.feedUrl!==undefined&&(typeof source.feedUrl!=='string'||publisherFeedUrl(source.url,source.feedUrl)!==source.feedUrl))throw new RequestError('Invalid source recovery metadata');
     if(source?.publisher!==undefined&&(typeof source.publisher!=='string'||source.publisher.length>240||/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(source.publisher)))throw new RequestError('Invalid source publisher');
     if(source?.imageCandidate!==undefined&&(source.kind!=='article'||!publicFetchUrl(source.imageCandidate)))throw new RequestError('Invalid publisher image candidate');
     if(!source||source.generatedAt!==at||!s.selectedStories.some(x=>x.id===source.id&&x.url===source.url)||!['article','hn_post','unavailable'].includes(source.kind)||source.excerpt.length>8500||source.description.length>700||source.fingerprint!==await digest({...source,fingerprint:undefined}))throw new RequestError('Invalid source record');
     const key=sourceKey(at,source.id),existing=await tx.get<Source>(key);
     if(existing&&existing.fingerprint!==source.fingerprint)throw new RequestError('Source already saved; use existing verified work',409);
     if(!existing)await tx.put(key,source);return existing??source;
    }
    if(path==='/recover-archive'||path==='/recover-feed'){
     const selected=s.selectedStories.find(row=>row.id===args.id);
     if(!selected)throw new RequestError('Article is not selected');
     const key=sourceKey(at,selected.id),original=await tx.get<Source>(key);
     if(!original)throw new RequestError('Pinned source required',409);
     if(original.kind==='publisher_feed'||original.kind==='archived_summary')return original;
     if(original.fingerprint!==args.sourceFingerprint||original.kind==='hn_post'||await tx.get(stageKey(at,selected.id)))throw new RequestError('Recovery source changed',409);
     let recovered:Omit<Source,'fingerprint'>;
     const base={id:selected.id,generatedAt:at,url:selected.url,fetchedAt:original.fetchedAt,status:original.status,excerpt:'',description:''};
     if(path==='/recover-archive'){
      const archive=await this.archiveCopies.find(tx,root,selected,at);
      if(!archive)return null;
      recovered={...base,kind:'archived_summary',archive,publisher:archive.publisher};
     }else{
      const feedUrl=publisherFeedUrl(selected.url,original.feedUrl);
      if(!feedUrl||args.feedUrl!==feedUrl||typeof args.description!=='string'||!args.description.trim()||args.description.length>700)throw new RequestError('Invalid publisher feed evidence');
      recovered={...base,kind:'publisher_feed',feedUrl,description:args.description,...(original.publisher?{publisher:original.publisher}:{})};
     }
     const pinned={...recovered,fingerprint:await digest(recovered)};
     await tx.put(key,pinned);return pinned;
    }
    if(path==='/get-source'){
     if(!s.selectedStories.some(x=>x.id===args.id))throw new RequestError('Article is not selected');
     return await tx.get(sourceKey(at,args.id as number))??null;
    }
    if(path==='/stage'){
     const story=args.story as Story,selected=s.selectedStories.find(x=>x.id===story?.id);if(!selected)throw new RequestError('Article is not selected');
     if(['title','url','score','comments','time','category','placement','topics','gamesTopicVersion','gamesOnly','editorialScore','hnPage','hnRank','discoverySource','sourceKind'].some(k=>JSON.stringify(story[k as keyof Story])!==JSON.stringify(selected[k as keyof typeof selected])))throw new RequestError('Authoritative selection fields changed');
     if(story.image)throw new RequestError('Images require a separate visual verification workflow; omit for now');
     const source=await tx.get<Source>(sourceKey(at,story.id));
     if(!source||source.fingerprint!==args.sourceFingerprint)throw new RequestError('Pinned source evidence required');
     if(story.summarySource!=='unavailable'){
      const provenance=story.summarySource;
      const matches=source.kind==='article'?(provenance==='article'&&source.excerpt.trim()||provenance==='page_description'&&source.description.trim()):source.kind===provenance;
      if(!matches)throw new RequestError('Summary provenance does not match source');
      if(provenance==='archived_summary'&&(!source.archive||story.headline!==source.archive.headline||story.summary!==source.archive.shortSummary||story.shortSummary!==source.archive.shortSummary))throw new RequestError('Archived copy differs from its publication');
     }
     validateEdition({generatedAt:at,stories:[story]});
     if(story.summarySource===undefined||story.shortSummary===undefined||new TextEncoder().encode(JSON.stringify(story)).length>24_000)throw new RequestError('Explicit bounded summary fields required');
     const key=stageKey(at,story.id),old=await tx.get<Staged>(key);
     if(old&&JSON.stringify(old.story)===JSON.stringify(story)&&old.sourceFingerprint===source.fingerprint)return {revision:old.revision,unchanged:true};
     const expected=args.expectedRevision??0;if(expected!==(old?.revision??0))throw new RequestError('Revision changed; read status before replacement',409);
     const record:Staged={story,revision:(old?.revision??0)+1,sourceFingerprint:source.fingerprint};await tx.put(key,record);await tx.delete('validation/'+at);await recordProgress(tx,at);return {revision:record.revision,published:false};
    }
    if(path==='/validate'||path==='/publish'){
     const {edition,leadEvidence}=await checkedEdition(tx,s,root);
     const fingerprint=await digest({edition,leadEvidence,ledger:s.nextLedger,baseRevision:root.revision});
     if(path==='/validate'){await tx.put('validation/'+at,fingerprint);return {valid:true,published:false,selected:edition.stories.length,fingerprint};}
     if(await tx.get('validation/'+at)!==fingerprint)throw new RequestError('Complete edition must be validated after its last change',409);
     const version='e-'+(await digest({edition,ledger:s.nextLedger,html:renderEdition(edition,'version-placeholder')})).slice(0,24);
     const publication:Publication={version,edition,html:renderEdition(edition,version),...(leadEvidence?{leadEvidence}:{})};
     await writeBlob(tx,'version/'+version,publication);
     for(const story of edition.stories)if(story.image)await tx.put('published-image/'+imageHash(story.image),true);
     const archives=Object.fromEntries(Object.entries({...root.archives,[edition.editionDate!]:version}).sort(([a],[b])=>b.localeCompare(a)).slice(0,31));
     const next:Root={...root,revision:root.revision+1,version,generatedAt:at,previous:root.version==='empty'?undefined:root.version,archives,ledger:s.nextLedger};
     await writeBlob(tx,'root',next);await tx.delete('pending');await tx.deleteAlarm();
     return {published:true,version,generatedAt:at,stories:edition.stories.length,leadId:edition.stories[0].id};
    }
    throw new RequestError('Unknown operation',404);
   });
   // External requests run after the transaction: storage retries must never
   // replay network calls, and slow sources must not hold a storage transaction.
   if(path==='/collect-items'){
    const batch=result as {ids:number[];at:number};
    return Response.json(await fetchOfficialItems(batch.ids,batch.at),{headers:{'Cache-Control':'no-store'}});
   }
   if(path==='/prepare-discussions'&&!(result as {complete:boolean}).complete){
    const plan=result as {index:number;edition:Edition;base:string};
    const snapshot=await collectTrendingHighlights(discussionBatchEdition(plan.edition,plan.index),plan.base,{preserveCandidates:true});
    // Re-enter only the local handler, after network collection, to recheck the
    // lease, safety hold and publication base before pinning this checkpoint.
    return this.fetch(new Request('https://newsroom.internal/save-discussion-batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({generatedAt:args.generatedAt,_runToken:args._runToken,index:plan.index,snapshot})}));
   }
   return Response.json(result,{headers:{'Cache-Control':'no-store'}});
  }catch(error){return Response.json({error:error instanceof RequestError?error.message:'Backend operation failed; preserve edition and inspect logs',...(error instanceof CollectionError?{collection:parseCollectionDetails(error.details)}:{})},{status:error instanceof RequestError?error.status:503,headers:{'Cache-Control':'no-store'}});}
 }
}
