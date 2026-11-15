import {alertMessage,initialState,transition,type Check} from '../lib/monitor/core';
interface Env {MONITOR:DurableObjectNamespace;EMAIL:SendEmail;ALERT_TO:string;ALERT_FROM:string;}
// Authenticated temporary preview only. Never bundled into the deployed monitor.
const worker={
 async fetch(request:Request,env:Env){
  const path=new URL(request.url).pathname;
  const stub=env.MONITOR.get(env.MONITOR.idFromName('hacker-times-v1'));
  if(request.method==='GET'&&path==='/status')return stub.fetch('https://monitor.internal/status');
  if(request.method==='POST'&&path==='/check')return stub.fetch(new Request('https://monitor.internal/tick',{method:'POST',body:JSON.stringify({scheduledTime:Date.now()})}));
  if(request.method==='POST'&&path==='/test-mail'){
   const now=Date.now(),bad:Check[]=[{name:'availability',ok:false,detail:'Simulated failure; production was not changed'},{name:'freshness',ok:true,detail:'Synthetic test'}];
   const first=transition(initialState(),bad,1,now);
   const second=transition(first.state,bad,2,now);
   const recovery=transition({...second.state,alerted:true},bad.map(check=>({...check,ok:true,detail:'Simulated recovery'})),3,now);
   for(const event of [second,recovery]){
    const message=alertMessage(event.notification!,event.state);
    await env.EMAIL.send({from:env.ALERT_FROM,to:env.ALERT_TO,...message,subject:'[TEST] '+message.subject,text:'This is a monitoring setup test. No production outage was caused.\n\n'+message.text});
   }
   return Response.json({testMessagesAccepted:2});
  }
  return new Response('Not found',{status:404});
 }
};
export default worker;
