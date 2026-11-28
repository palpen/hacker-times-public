import {alertMessage,initialState,INTERVAL_MS,probe,transition,type MonitorState} from '../lib/monitor/core';
import {publisherNotice} from '../lib/monitor/publisher';
import type {PublisherRecoveryStatus} from '../lib/publisher-recovery';
interface MonitorEnv {MONITOR:DurableObjectNamespace;EMAIL:SendEmail;ALERT_TO:string;ALERT_FROM:string;PUBLISHER_RECOVERY?:{read():Promise<PublisherRecoveryStatus>};}
export class SiteMonitor {
 private tail:Promise<unknown>=Promise.resolve();
 constructor(private ctx:DurableObjectState,private env:MonitorEnv){}
 async fetch(request:Request):Promise<Response>{
  const path=new URL(request.url).pathname;
  if(request.method==='GET'&&path==='/status')return Response.json(await this.ctx.storage.get('state')??initialState());
  if(request.method!=='POST'||path!=='/tick')return new Response('Not found',{status:404});
  const {scheduledTime}=await request.json() as {scheduledTime:number};
  if(!Number.isSafeInteger(scheduledTime)||Math.abs(Date.now()-scheduledTime)>INTERVAL_MS)return new Response('Invalid tick',{status:400});
  const run=this.tail.then(()=>this.tick(Math.floor(scheduledTime/INTERVAL_MS)));
  this.tail=run.catch(()=>{});
  return run;
 }
 private async tick(slot:number){
  const previous=await this.ctx.storage.get<MonitorState>('state')??initialState();
  if(slot<=previous.slot)return Response.json({skipped:true});
  const [checks,publisher]=await Promise.all([probe(),Promise.resolve().then(()=>this.env.PUBLISHER_RECOVERY?.read()).catch(()=>null)]);
  const {state,notification}=transition(previous,checks,slot,Date.now());
  state.publisherRecoveryConnected=!!publisher;
  const notice=publisherNotice(publisher??null,checks,previous.publisherMail);
  // For a recorded replacement, wait for matching public versions before
  // confirming recovery. The two public probes may straddle publication.
  const awaitingReplacement=publisher?.recovery?.replacement&&previous.publisherMail?.replacement!==publisher.recovery.id;
  const publicNotice=notification==='recovery'&&awaitingReplacement?undefined:notification;
  const message=notice?.message??(publicNotice?alertMessage(publicNotice,state):null);
  // Persist the observation before attempting mail. Failed sends are retried on the next tick.
  await this.ctx.storage.put('state',state);
  if(message){
   try{
    if(!this.env.ALERT_TO||!this.env.ALERT_FROM)throw Error('Email configuration missing');
    await this.env.EMAIL.send({from:this.env.ALERT_FROM,to:this.env.ALERT_TO,...message});
    if(notice)state.publisherMail={...state.publisherMail,[notice.kind]:notice.id};
    if(notification==='failure'&&(!notice||checks.find(check=>check.name==='availability')?.ok))state.alerted=true;
    if(notification==='recovery'&&(!notice||notice.kind==='replacement')){
     state.alerted=false;delete state.since;
    }
    await this.ctx.storage.put('state',state);
   }catch{
    state.emailFailed=true;await this.ctx.storage.put('state',state);
    console.error(JSON.stringify({event:'hacker_times.monitor',outcome:'email_failed',notification:notice?.kind??publicNotice}));
    throw Error('Monitor email failed; inspect configuration and delivery status');
   }
  }
  console.info(JSON.stringify({event:'hacker_times.monitor',outcome:checks.every(c=>c.ok)?'healthy':'unhealthy',notification:notice?.kind??publicNotice??null,failures:state.failures,publisherRecoveryConnected:state.publisherRecoveryConnected}));
  return Response.json({checked:true});
 }
}
const worker={
 fetch(){return new Response('Not found',{status:404});},
 async scheduled(event:ScheduledController,env:MonitorEnv,ctx:ExecutionContext){
  ctx.waitUntil((async()=>{
   const response=await env.MONITOR.get(env.MONITOR.idFromName('hacker-times-v1')).fetch(new Request('https://monitor.internal/tick',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scheduledTime:event.scheduledTime})}));
   if(!response.ok)throw Error('Monitor tick failed');
  })());
 }
};

export default worker;
