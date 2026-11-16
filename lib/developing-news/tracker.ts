import type {ProductionEnv,Publication} from '../production/types';
import {call} from '../production/runner';
import {RequestError} from '../security';
import {DevelopingStore} from './store';
import {collectEvidence,discoverFollowup} from './source';
import {assessArticle,ProviderFailure} from './model';
import {rotate} from './lifecycle';
import {publicThread,submittedAt,type Work} from './types';
import {policy} from './policy.mjs';

const INTERVAL=policy.schedule.assess_every_hours*3600_000;
export function assessmentDue(lastRunAt:string|null,now=Date.now()){
 return !lastRunAt||Math.floor(Date.parse(lastRunAt)/INTERVAL)<Math.floor(now/INTERVAL);
}

export class DevelopingNews {
 private store:DevelopingStore;
 private busy=false;
 constructor(private state:DurableObjectState,private env:ProductionEnv){this.store=new DevelopingStore(state.storage.sql);}
 private enabled(){return this.env.DEVELOPING_NEWS_ENABLED==='true'&&this.env.MUTATIONS_ENABLED==='true'&&this.env.LIVE_FETCH_ENABLED==='true'&&this.env.MODEL_API_ENABLED==='true'&&this.env.SCHEDULE_ENABLED==='true'&&this.env.PUBLICATION_ENABLED==='true';}
 async fetch(request:Request):Promise<Response>{
  const url=new URL(request.url);
  // Internal binding only: the reader router never forwards this endpoint.
  if(request.method==='GET'&&url.pathname==='/status')return Response.json({enabled:this.enabled(),roster:this.store.roster(),run:this.store.runSummary(),lastRun:this.store.get('last-run'),lastPlan:this.store.get('last-plan'),storage:this.store.diagnostics(),nextCheckDue:assessmentDue(this.store.roster().lastRunAt)});
  if(request.method==='GET'&&url.pathname==='/comments-context'){
   const threadId=url.searchParams.get('threadId')??'',storyId=Number(url.searchParams.get('storyId'));
   if(!/^s-[a-f0-9]{20}$/.test(threadId)||!Number.isSafeInteger(storyId)||storyId<=0)return new Response('Invalid query',{status:400});
   return this.store.hasDiscussion(threadId,storyId)?Response.json({stories:[{id:storyId}]}):new Response('Not found',{status:404});
  }
  if(request.method==='GET'&&url.pathname==='/list')return Response.json(this.store.publicList(url.searchParams.get('cursor')??undefined));
  if(request.method==='GET'&&/^\/story\/s-[a-f0-9]{20}$/.test(url.pathname)){
   const before=url.searchParams.get('before');if(before&&!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(before))return new Response('Invalid cursor',{status:400});
   const t=this.store.thread(url.pathname.slice(7),before??undefined);return t?.published?Response.json({...publicThread(t),nextCursor:t.updates.length===50?t.updates[49].at:null}):new Response('Not found',{status:404});
  }
  if(request.method==='POST'&&url.pathname==='/tick'){
   if(this.enabled()){
    await this.state.storage.setAlarm(Date.now()+1000);
    try{const p=await call(this.env,'edition') as Publication;
     if(p.version!==this.store.get('ingested-version')&&Date.now()-Date.parse(p.edition.generatedAt)<36*3600_000){
      this.state.storage.transactionSync(()=>{this.store.ingest(p.edition.stories,new Date().toISOString());this.store.set('ingested-version',p.version);});
     }
    }catch{/* The saved roster remains readable during an edition outage. */}
   }
   return Response.json({scheduled:this.enabled()});
  }
  return new Response('Not found',{status:404});
 }
 async alarm(){
  if(!this.enabled()||this.busy)return;this.busy=true;
  // Recover interrupted work. Paid calls are fenced by durable request hashes
  // and the shared budget ledger, independent of alarm retries.
  await this.state.storage.setAlarm(Date.now()+5*60_000);
  try{await this.step();}
  catch{console.log(JSON.stringify({event:'hacker_times.developing_news',outcome:'deferred'}));await this.state.storage.setAlarm(Date.now()+30*60_000);}
  finally{this.busy=false;}
 }
 private async step(){
  const roster=this.store.roster();let run=this.store.run();
  if(!run){
   if(!assessmentDue(roster.lastRunAt)){await this.state.storage.deleteAlarm();return;}
   const publication=await call(this.env,'edition') as Publication;
   if(Date.now()-Date.parse(publication.edition.generatedAt)>36*3600_000)throw Error('Stale discovery');
   const active=this.store.active(),asOf=new Date().toISOString();
   this.store.ingest(publication.edition.stories,asOf);
   const candidates=this.store.candidates();
   const queue:Work[]=active.map(t=>({threadId:t.id,article:{id:Number(t.evidence[0].id),title:t.evidence[0].title,url:t.evidence[0].url,time:Date.parse(submittedAt(t.evidence[0]))/1000,score:0}}));
   queue.push(...candidates.filter(s=>!queue.some(w=>w.article.url===s.url)).map(s=>({article:{id:s.id,title:s.title,url:s.url,time:s.time,score:s.score}})));
   run={id:crypto.randomUUID(),asOf,baseRevision:roster.revision,queue,results:[],failed:[],processed:[],discoveryOk:true};this.store.set('run',run);
  }
  const status=await call(this.env,'status') as {safetyStop?:unknown;runner?:{leaseExpiresAt:number|null}};
  if(status.safetyStop)throw Error('Editorial hold');
  // Give the front-page publisher priority. Do not consume the hourly shortlist
  // merely because its storage lease is busy for a few minutes.
  if(status.runner?.leaseExpiresAt&&status.runner.leaseExpiresAt>Date.now()){
   await this.state.storage.setAlarm(status.runner.leaseExpiresAt+1000);return;
  }
  if(run.queue.length){
   const work=run.queue[0];
   let phase='source';
   try{
    let article=work.article;
    const existing=work.threadId?this.store.thread(work.threadId):null;
    if(!work.evidence&&existing)article=await discoverFollowup(existing.terms,existing.lastMaterialAt)??article;
    const evidence=work.evidence??await collectEvidence(article);
    // Retrieval includes quiet stories of any age. At most five reach the model.
    const persisted=this.store.matches(article.title+' '+evidence.text,evidence.url);
    const inBatch=run.results.map(a=>({...a.thread,summary:a.summary,evidence:[a.evidence,...a.thread.evidence]}));
    const matches=work.matches??[...inBatch,...persisted].filter((t,i,all)=>all.findIndex(x=>x.id===t.id)===i).slice(0,5);
    if(existing&&!matches.some(m=>m.id===existing.id))matches.unshift(existing);
    // Pin the exact source, shortlist and clock before any paid request, so a
    // restart cannot change the request hash and replay an uncertain call.
    Object.assign(work,{article,evidence,matches:matches.slice(0,5),assessmentAt:work.assessmentAt??new Date().toISOString()});
    this.store.set('run',run);
    phase='assessment';
    const assessment=await assessArticle(this.env,evidence,work.matches!,work.assessmentAt!,(key,request,response)=>this.store.journal(key,request,response));
    // A follow-up about another event must not mark an active thread refreshed.
    // It may become one of the hourly new candidates instead.
    if(!run.results.some(r=>r.thread.id===assessment.thread.id)){run.results.push(assessment);run.processed.push(article.id);}
   }catch(error){
    if(error instanceof RequestError&&error.status===409&&error.message.startsWith('Another bounded runner')){await this.state.storage.setAlarm(Date.now()+60_000);return;}
    const failure={articleId:work.article.id,phase,reason:error instanceof RequestError&&error.status===429?'budget_unavailable':phase==='source'?'source_unavailable':'assessment_failed',...(error instanceof ProviderFailure?{provider:{endpoint:error.endpoint,kind:error.kind,httpStatus:error.httpStatus}}:{})};
    run.failures=[...(run.failures??[]),failure];
    console.log(JSON.stringify({event:'hacker_times.developing_news',outcome:'candidate_failed',...failure}));
    if(error instanceof RequestError&&error.status===429){run.budgetAvailable=false;run.queue=[];}
    else if(!work.threadId)this.store.defer(work.article.id);
    run.failed.push(work.threadId??String(work.article.id));
   }
   run.queue.shift();this.store.set('run',run);await this.state.storage.setAlarm(Date.now()+1000);return;
  }
  if(roster.revision!==run.baseRevision)throw Error('Roster changed');
  // All evidence timestamps precede the final evaluation timestamp.
  run.asOf=new Date().toISOString();
  // Active jobs can discover a new thread, but policy shortlist remains five.
  const active=this.store.active(),activeIds=new Set(active.map(t=>t.id));let candidates=0;
  run.results=run.results.filter(a=>activeIds.has(a.thread.id)||++candidates<=5);
  const summary={at:run.asOf,assessed:run.results.length,deferred:run.failed.length,failures:run.failures??[],budgetAvailable:run.budgetAvailable!==false};
  if(!active.length&&!run.results.length){
   const outcome=run.failed.length?'assessment_unavailable':'no_candidates';
   this.state.storage.transactionSync(()=>{this.store.set('last-run',{...summary,outcome});this.store.set('run',null);this.store.set('roster',{...roster,lastRunAt:run.asOf});this.store.prune(Date.now());});
   console.log(JSON.stringify({event:'hacker_times.developing_news',...summary,outcome,active:0}));
   await this.state.storage.deleteAlarm();return;
  }
  const next=await rotate(roster,active,run);
  this.state.storage.transactionSync(()=>{
   for(const t of next.threads)this.store.save(t);
   if(run.budgetAvailable!==false&&run.discoveryOk)for(const id of run.processed)this.store.markSeen(id,run!.asOf);
   this.store.set('roster',next.roster);this.store.set('last-plan',{at:run!.asOf,plan:next.plan,failed:run!.failed});this.store.set('run',null);this.store.prune(Date.now());
   this.store.set('last-run',{...summary,outcome:'completed'});
  });
  console.log(JSON.stringify({event:'hacker_times.developing_news',outcome:'completed',active:next.plan.next_active_ids.length,assessed:run.results.length,deferred:run.failed.length}));
  await this.state.storage.deleteAlarm();
 }
}
