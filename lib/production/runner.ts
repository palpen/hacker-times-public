import {RequestError} from '../security';
import {digest} from './storage';
import {generateEditorialCopy,EditorialModelError,MAX_RESERVED_INPUT_TOKENS} from './editorial-model';
import {collectSnapshot,collectSource} from './collect';
import type {ProductionEnv,Root,Snapshot,Publication,Source} from './types';
type RunEnv=ProductionEnv & {_runToken?:string};
export async function call(env:RunEnv,path:string,args:Record<string,unknown>={}){
 const response=await env.NEWSROOM.get(env.NEWSROOM.idFromName('production-v1')).fetch(new Request('https://newsroom.internal/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...args,...(env._runToken?{_runToken:env._runToken}:{})})}));
 if(!response.ok){const failure=await response.json() as {error:string};throw new RequestError(failure.error,response.status);}
 return response.json();
}
export function enabled(value:string|undefined,name:string){if(value!=='true')throw new RequestError(name+' is disabled pending launch authorization',503);}
export async function collect(env:ProductionEnv){
 enabled(env.MUTATIONS_ENABLED,'Mutations');enabled(env.LIVE_FETCH_ENABLED,'Live collection');
 const root=await call(env,'root') as Root;const snapshot=await collectSnapshot(root);
 await call(env,'snapshot',{snapshot});return snapshot;
}
export async function sourceFor(env:ProductionEnv,generatedAt:unknown,id:unknown){
 enabled(env.LIVE_FETCH_ENABLED,'Live source collection');
 const snapshot=await call(env,'selection',{generatedAt}) as Snapshot;
 const existing=await call(env,'get-source',{generatedAt,id}) as Source|null;
 const source=existing??await call(env,'source',{generatedAt,source:await collectSource(snapshot,Number(id))}) as Source;
 return {source,snapshot};
}
function positiveConfig(value:string|undefined,name:string,integer=false){
 const n=Number(value);if(!value||!Number.isFinite(n)||n<=0||(integer&&!Number.isSafeInteger(n)))throw new RequestError(name+' must be explicitly configured',503);return n;
}
export async function summarize(env:RunEnv,args:Record<string,unknown>){
 const {source,snapshot}=await sourceFor(env,args.generatedAt,args.id);
 const selected=snapshot.selectedStories.find(x=>x.id===source.id)!;
 const status=await call(env,'status',{generatedAt:source.generatedAt}) as {articles:{id:number;revision:number}[]};
 const staged=status.articles.find(x=>x.id===selected.id);if(staged)return {id:selected.id,revision:staged.revision,unchanged:true};
 const model=env.EDITORIAL_MODEL||'gpt-6-luna';
 const maxOutputTokens=env.MODEL_MAX_OUTPUT_TOKENS?positiveConfig(env.MODEL_MAX_OUTPUT_TOKENS,'Output token bound',true):1024;
 if(maxOutputTokens>4096)throw new RequestError('Output token bound exceeds policy',503);
 let result:Awaited<ReturnType<typeof generateEditorialCopy>>;
 if(source.kind==='unavailable')result=await generateEditorialCopy(source,selected,{apiKey:'',model,maxOutputTokens});
 else{
  enabled(env.MODEL_API_ENABLED,'Model API');if(!env.OPENAI_API_KEY)throw new RequestError('OpenAI credential is not configured',503);
  const inputPrice=positiveConfig(env.MODEL_INPUT_USD_PER_MILLION,'Verified input price'),outputPrice=positiveConfig(env.MODEL_OUTPUT_USD_PER_MILLION,'Verified output price');
  const dailyLimit=positiveConfig(env.MODEL_DAILY_LIMIT_MICRO_USD,'Approved daily model spending limit',true),monthlyLimit=positiveConfig(env.MODEL_MONTHLY_LIMIT_MICRO_USD,'Approved monthly model spending limit',true);
  const cost=Math.ceil(MAX_RESERVED_INPUT_TOKENS*inputPrice+maxOutputTokens*outputPrice);
  const key=await digest({policy:'editorial-v1',model,maxOutputTokens,id:selected.id,title:selected.title,url:selected.url,kind:source.kind,excerpt:source.excerpt,description:source.description});
  const reservation=await call(env,'model-reserve',{key,cost,dailyLimit,monthlyLimit}) as {state:string;created?:boolean;result?:Awaited<ReturnType<typeof generateEditorialCopy>>};
  if(reservation.state==='completed'&&reservation.result){
   result={...reservation.result,story:{...reservation.result.story,...selected}};
  }else{
   if(!reservation.created)throw new RequestError('Prior model call has an uncertain outcome; review usage before any retry',409);
   try{result=await generateEditorialCopy(source,selected,{apiKey:env.OPENAI_API_KEY,model,maxOutputTokens});}
   catch(error){
    await call(env,'failure',{generatedAt:source.generatedAt,storyId:selected.id,kind:error instanceof EditorialModelError?error.kind:'transient'});
    throw new RequestError(error instanceof EditorialModelError&&error.kind==='safety_stop'?'Editorial safety stop recorded; no retry or fallback':'Editorial generation failed; reservation retained for review',503);
   }
   await call(env,'model-complete',{key,result,actualCost:Math.ceil(result.usage.inputTokens*inputPrice+result.usage.outputTokens*outputPrice)});
  }
 }
 return call(env,'stage',{generatedAt:source.generatedAt,story:result.story,sourceFingerprint:source.fingerprint});
}
// Hard article count plus a soft deadline leave ample room below cron's wall limit.
// A source request can take 40s and a model request 25s; no new article after 90s.
export async function runEdition(env:ProductionEnv){
 enabled(env.AUTO_EDITORIAL_ENABLED,'Automatic editorial workflow');
 enabled(env.MUTATIONS_ENABLED,'Mutations');
 const claim=await call(env,'run-claim') as {claimed:boolean;token:string};
 if(!claim.claimed)return {published:false,busy:true};
 const scoped:RunEnv={...env,_runToken:claim.token},started=Date.now();let continuationDelayMs=30*60_000;
 try{
  const status=await call(scoped,'status') as {pending:string|null};
  // Collection is its own checkpoint: never combine it with an editorial batch.
  if(!status.pending){const snapshot=await collect(scoped);continuationDelayMs=1_000;return {published:false,generatedAt:snapshot.generatedAt,checkpoint:'collected'};}
  const snapshot=await call(scoped,'selection',{generatedAt:status.pending}) as Snapshot;
  const before=await call(scoped,'status',{generatedAt:snapshot.generatedAt}) as {missingIds:number[];cursor:number|null};
  const allIds=snapshot.selectedStories.map(x=>x.id),cursor=before.cursor===null?-1:allIds.indexOf(before.cursor);
  const ordered=[...allIds.slice(cursor+1),...allIds.slice(0,cursor+1)].filter(id=>before.missingIds.includes(id));
  const blockedIds:number[]=[];let attempted=0;
  for(const id of ordered){
   if(attempted>=3||Date.now()-started>=90_000)break;
   attempted++;
   await call(scoped,'run-progress',{generatedAt:snapshot.generatedAt,id});
   try{await summarize(scoped,{generatedAt:snapshot.generatedAt,id});}
   catch(error){
    const check=await call(scoped,'status',{generatedAt:snapshot.generatedAt}) as {safetyStop:unknown};
    if(check.safetyStop)throw error;
    // Keep every required article. Independent missing articles may progress,
    // but unknown reservations are never retried and prevent complete publication.
    if(error instanceof RequestError&&(error.status===409||error.status===502||error.status===503)){blockedIds.push(id);continue;}
    throw error;
   }
  }
  const after=await call(scoped,'status',{generatedAt:snapshot.generatedAt}) as {missingIds:number[]};
  if(after.missingIds.length<before.missingIds.length)continuationDelayMs=1_000;
  if(after.missingIds.length)return {published:false,generatedAt:snapshot.generatedAt,attempted,blockedIds,missingIds:after.missingIds,checkpoint:'staged'};
  const validation=await call(scoped,'validate',{generatedAt:snapshot.generatedAt});
  if(env.PUBLICATION_ENABLED!=='true')return {validation,published:false};
  const publication=await call(scoped,'publish',{generatedAt:snapshot.generatedAt});
  const persisted=await call(scoped,'edition') as Publication;
  return {publication,verifiedVersion:persisted.version,generatedAt:persisted.edition.generatedAt};
 }finally{await call(scoped,'run-release',{continuationDelayMs});}
}
