// Used only in an authenticated, temporary Wrangler preview. No production route.
// The caller cannot choose operations or pass a mutation through this handler.
const worker = {
  async fetch(request, env) {
    if (request.method !== 'GET' || new URL(request.url).pathname !== '/status') return new Response('Not found', {status:404});
    const stub=env.NEWSROOM.get(env.NEWSROOM.idFromName('production-v1'));
    const read=async(path,args={})=>{
      const response=await stub.fetch(new Request('https://newsroom.internal/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args)}));
      if(!response.ok)throw new Error('Private '+path+' read failed: '+response.status);
      return response.json();
    };
    const state=await read('status');
    if(!state.pending)return Response.json({state});
    const pending=await read('status',{generatedAt:state.pending});
    const models=[];
    for(const storyId of pending.missingIds.slice(0,3)){
      const model=await read('model-review',{generatedAt:state.pending,storyId});
      models.push({storyId,state:model?.state??null,attempt:model?.attempt??null,details:model?.details??null,hasDraft:!!model?.draft});
    }
    return Response.json({state,pending,models});
  },
};
export default worker;
