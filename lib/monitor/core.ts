export const INTERVAL_MS=300_000;
export type Check={name:'availability'|'freshness';ok:boolean;detail:string};
export type MonitorState={slot:number;failures:number;alerted:boolean;since?:string;checkedAt:string;checks:Check[];emailFailed?:boolean};
export const initialState=():MonitorState=>({slot:-1,failures:0,alerted:false,checkedAt:'',checks:[]});

export async function probe(fetcher:typeof fetch=fetch,now=Date.now()):Promise<Check[]>{
 return Promise.all((['availability','freshness'] as const).map(async name=>{
  try{
   const response=await fetcher('https://hackertimes.ca'+(name==='freshness'?'/readyz':'/'),{method:name==='freshness'?'GET':'HEAD',redirect:'manual',headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(10_000)});
   if(response.status!==200){await response.body?.cancel();return {name,ok:false,detail:'HTTP '+response.status};}
   if(name==='availability')return {name,ok:true,detail:'HTTP 200'};
   const data=await response.json() as {status?:string;generatedAt?:string;publicationVersion?:string};
   const age=now-Date.parse(data.generatedAt??'');
   const ok=data.status==='ready'&&/^e-[a-f0-9]{24}$/.test(data.publicationVersion??'')&&Number.isFinite(age)&&age>=-60_000&&age<=2_700_000;
   return {name,ok,detail:ok?'Fresh edition':'Invalid or stale readiness response'};
  }catch{return {name,ok:false,detail:'Request failed, timed out, or returned invalid JSON'};}
 }));
}

export function transition(previous:MonitorState,checks:Check[],slot:number,now:number){
 const healthy=checks.every(check=>check.ok);
 // A long monitoring gap must not turn two widely separated failures into confirmation.
 const consecutive=slot===previous.slot+1;
 const failures=healthy?0:Math.min(2,consecutive?previous.failures+1:1);
 const state:MonitorState={...previous,slot,failures,checkedAt:new Date(now).toISOString(),checks,emailFailed:false};
 if(!healthy&&!previous.since)state.since=state.checkedAt;
 let notification:'failure'|'recovery'|undefined;
 if(!healthy&&failures>=2&&!previous.alerted)notification='failure';
 if(healthy&&previous.alerted)notification='recovery';
 if(healthy&&!previous.alerted)delete state.since;
 return {state,notification};
}

export function alertMessage(kind:'failure'|'recovery',state:MonitorState){
 return {
  subject:kind==='failure'?'[Hacker Times] Website or refresh failure':'[Hacker Times] Recovered',
  text:[kind==='failure'?'Hacker Times failed two consecutive five-minute checks.':'Hacker Times is healthy again.',
   'Checked: '+state.checkedAt,'First failure: '+(state.since??'unknown'),
   ...state.checks.map(check=>check.name+': '+(check.ok?'OK':'FAILED')+' — '+check.detail),
   'Website: https://hackertimes.ca/','Freshness: https://hackertimes.ca/readyz',
   'Freshness limit: 45 minutes. This monitor runs separately from the publisher, on Cloudflare.'].join('\n'),
 };
}
