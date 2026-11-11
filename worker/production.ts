import {assetResponse} from '../lib/asset-response';
import {secureResponse,RequestError} from '../lib/security';
import {withSubmissionAges} from '../lib/submission-age-document';
import {withFooterTimestamp} from '../lib/footer-timestamp';
import {createCommentsService} from '../lib/comments-core';
import type {ProductionEnv,Publication} from '../lib/production/types';
import {observeRun} from '../lib/production/run-log';
import {call,enabled,collect,runEdition} from '../lib/production/runner';
export {Newsroom} from '../lib/production/newsroom';
const comments=createCommentsService({readEdition:async(_req,bindings,date,version)=>{
 try{const p=await call(bindings as unknown as ProductionEnv,'edition',{...(date?{date}:{}),...(version?{version}:{})}) as Publication;return ((!version||version===p.version)&&(!date||date===p.edition.editionDate))?p.edition:null;}catch{return null;}
}});
const worker={
 async fetch(request:Request,env:ProductionEnv):Promise<Response>{
  try{
   const url=new URL(request.url),path=url.pathname;let response:Response;
   // Manual administration is removed, not replaced with weaker authentication.
   // Return before reading headers/body or touching the private namespace.
   let decodedPath=path;try{decodedPath=decodeURIComponent(path);}catch{/* Invalid paths are not admin routes. */}
   if(decodedPath==='/admin'||decodedPath.startsWith('/admin/'))return secureResponse(new Response(request.method==='HEAD'?null:'Not found',{status:404,headers:{'Cache-Control':'no-store'}}));
    if(!['GET','HEAD'].includes(request.method))throw new RequestError('Method not allowed',405);
    if(path==='/healthz')response=Response.json({mode:'production',publicationEnabled:env.PUBLICATION_ENABLED==='true',scheduleEnabled:env.SCHEDULE_ENABLED==='true'});
    else if(path==='/api/archive')response=Response.json(await call(env,'archive'));
    else if(path==='/'||path==='/api/edition'){
     const date=url.searchParams.get('date');if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new RequestError('Invalid date');
     const p=await call(env,'edition',date?{date}:{}) as Publication;
     response=path==='/'?new Response(withFooterTimestamp(withSubmissionAges(p.html,p.edition)),{headers:{'Content-Type':'text/html; charset=utf-8'}}):Response.json({...p.edition,publicationVersion:p.version,persisted:true});
     response.headers.set('X-Edition-Version',p.version);response.headers.set('Cache-Control','no-store');
    }else if(path==='/api/comments'){
     enabled(env.LIVE_FETCH_ENABLED,'Live comments');
     response=await comments(request,env as Cloudflare.Env);
    }else response=assetResponse(request)??new Response('Not found',{status:404});
   if(request.method==='HEAD')response=new Response(null,{status:response.status,headers:response.headers});
   return secureResponse(response);
  }catch(error){return secureResponse(Response.json({error:error instanceof RequestError?error.message:'Service unavailable; the prior edition has not been replaced'},{status:error instanceof RequestError?error.status:503}));}
 },
 async scheduled(event:ScheduledController,env:ProductionEnv,ctx:ExecutionContext){
  // All live switches default off. Without explicit automatic editorial opt-in,
  // this only pins a metadata batch. Completed stages survive interrupted runs.
  if(env.SCHEDULE_ENABLED!=='true'||env.MUTATIONS_ENABLED!=='true'||env.LIVE_FETCH_ENABLED!=='true')return;
  ctx.waitUntil(observeRun('cron',async()=>{
   const slot=String(Math.floor(event.scheduledTime/(30*60_000)));
   const claimed=await call(env,'schedule',{slot}) as {claimed:boolean};if(!claimed.claimed)return {checkpoint:'deduplicated'};
   if(env.AUTO_EDITORIAL_ENABLED==='true')return runEdition(env);
   const status=await call(env,'status') as {pending:string|null};if(status.pending)return {checkpoint:'pending',generatedAt:status.pending};
   const snapshot=await collect(env);return {checkpoint:'collected',generatedAt:snapshot.generatedAt};
  }));
 }
};
export default worker;
