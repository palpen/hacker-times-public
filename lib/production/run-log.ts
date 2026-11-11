import {RequestError} from '../security';

type Trigger='cron'|'alarm';
const record=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const count=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
const size=(value:unknown)=>Array.isArray(value)?value.length:null;
const timestamp=(value:unknown)=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)?value:null;
const version=(value:unknown)=>typeof value==='string'&&/^e-[a-f0-9]{24}$/.test(value)?value:null;

/** Fixed allowlist: never serialize a result, error, source, header or provider body. */
export function runLogEvent(trigger:Trigger,value:unknown,errorStatus?:number){
 const result=record(value),publication=record(result.publication),validation=record(result.validation);
 const blocked=size(result.blockedIds),remaining=size(result.missingIds);
 const outcome=errorStatus!==undefined?'failed':publication.published===true?'published':result.busy===true?'busy':result.checkpoint==='collected'?'collected':result.checkpoint==='deduplicated'?'skipped':result.checkpoint==='pending'?'pending':result.checkpoint==='staged'?(blocked?'blocked':'progress'):validation.valid===true?'validated':'completed';
 return {event:'hacker_times.background_run',trigger,outcome,generatedAt:timestamp(result.generatedAt),publicationVersion:version(publication.version??result.verifiedVersion),attempted:count(result.attempted),remaining,blocked,httpStatus:errorStatus!==undefined&&Number.isInteger(errorStatus)&&errorStatus>=400&&errorStatus<=599?errorStatus:null};
}

export async function observeRun(trigger:Trigger,operation:()=>Promise<unknown>,write:(line:string)=>void=line=>console.info(line)){
 let result:unknown;
 try{result=await operation();}
 catch(error){
  write(JSON.stringify(runLogEvent(trigger,null,error instanceof RequestError?error.status:500)));
  // Cloudflare also logs uncaught errors. Do not let an upstream exception's
  // message/cause/stack include source text, credentials or provider payloads.
  throw new Error('Hacker Times background run failed; inspect private stored state.');
 }
 write(JSON.stringify(runLogEvent(trigger,result)));
}
