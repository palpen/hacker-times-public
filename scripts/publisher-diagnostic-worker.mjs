// Used only in an authenticated, temporary Wrangler preview. No production route.
// A recovery preview carries one reviewed action in its deployment bindings.
// The request supplies neither recovery arguments nor a generic operation.
const worker = {
  async fetch(request, env) {
    const url=new URL(request.url);
    const recover=request.method==='POST'&&url.pathname==='/recover-expired'&&!url.search&&request.body===null&&
      (env.EXPIRED_BATCH_RECOVERY||env.CURRENT_BATCH_RECOVERY);
    const inspect=request.method==='GET'&&url.pathname==='/status';
    if(!recover&&!inspect)return new Response('Not found',{status:404});
    const stub=env.NEWSROOM.get(env.NEWSROOM.idFromName('production-v1'));
    const send=(path,args)=>stub.fetch(new Request('https://newsroom.internal/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args)}));
    const read=async(path,args={})=>{
      const response=await send(path,args);
      if(!response.ok)throw new Error('Private '+path+' read failed: '+response.status);
      return response.json();
    };
    if(recover){
      if(env.EXPIRED_BATCH_RECOVERY)return send('recover-expired-batch',JSON.parse(env.EXPIRED_BATCH_RECOVERY));
      const {candidate,safetyHoldAt}=await read('publisher-recovery-status');
      if(safetyHoldAt)return Response.json({outcome:'safety_hold'},{status:409});
      if(!candidate)return Response.json({outcome:'no_candidate'});
      const {generatedAt,basePublicationVersion,baseRevision}=candidate;
      const result=await send('recover-expired-batch',{generatedAt,basePublicationVersion,baseRevision,githubRun:env.CURRENT_BATCH_RECOVERY});
      return Response.json({outcome:result.ok?'queued':'blocked'},{status:result.status});
    }
    const state=await read('status');
    let developing=null;
    if(env.DEVELOPING_NEWS){
      const response=await env.DEVELOPING_NEWS.get(env.DEVELOPING_NEWS.idFromName('developing-v1')).fetch(new Request('https://developing.internal/status'));
      developing=response.ok?await response.json():{unavailable:response.status};
    }
    if(!state.pending)return Response.json({state,developing});
    const pending=await read('status',{generatedAt:state.pending});
    const blockReason=pending.safetyStop?'safety_stop':pending.expired?'snapshot_expired':null;
    const models=[];
    for(const storyId of pending.missingIds.slice(0,3)){
      const model=await read('model-review',{generatedAt:state.pending,storyId});
      models.push({storyId,reservationKey:model?.reservationKey??null,state:model?.state??null,attempt:model?.attempt??null,
        cost:model?.cost??null,createdAt:model?.createdAt??null,reason:model?.reason??null,details:model?.details??null,hasReceipt:!!model?.hasReceipt,hasDraft:!!model?.hasDraft});
    }
    return Response.json({state,pending:{...pending,blockReason},models,developing});
  },
};
export default worker;
