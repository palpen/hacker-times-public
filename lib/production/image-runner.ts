import {EditorialModelError,MAX_RESERVED_INPUT_TOKENS} from './editorial-model';
import {fetchImage,reviewImage,imageReviewKey,IMAGE_POLICY,IMAGE_OUTPUT_TOKENS,type ImageResult} from './images';
import type {ProductionEnv,Source} from './types';
type Operation=(path:string,args?:Record<string,unknown>)=>Promise<unknown>;
export type ImagePlan={complete:boolean;source?:Source;id?:number};

/** Optional imagery uses the same durable budget as text, with one attempt/key. */
export async function processImage(env:ProductionEnv,plan:ImagePlan,op:Operation){
 const source=plan.source!;
 const done=(args:Record<string,unknown>={})=>op('image-done',{generatedAt:source.generatedAt,id:plan.id,...args});
 if(env.MODEL_API_ENABLED!=='true'||!env.OPENAI_API_KEY)return done();
 let asset;try{asset=await fetchImage(source.imageCandidate!);}catch{return done();}
 const model=env.EDITORIAL_MODEL||'gpt-6-luna',key=await imageReviewKey(source,model,asset.hash);
 const inputPrice=Number(env.MODEL_INPUT_USD_PER_MILLION),outputPrice=Number(env.MODEL_OUTPUT_USD_PER_MILLION);
 const dailyLimit=Number(env.MODEL_DAILY_LIMIT_MICRO_USD),monthlyLimit=Number(env.MODEL_MONTHLY_LIMIT_MICRO_USD);
 if(![inputPrice,outputPrice,dailyLimit,monthlyLimit].every(x=>Number.isFinite(x)&&x>0))return done();
 const cost=Math.ceil(MAX_RESERVED_INPUT_TOKENS*inputPrice+IMAGE_OUTPUT_TOKENS*outputPrice);
 let reservation:{state:string;created?:boolean;result?:ImageResult};
 try{reservation=await op('model-reserve',{key,cost,dailyLimit,monthlyLimit}) as typeof reservation;}
 catch(error){if(error instanceof Error&&'status' in error&&error.status===429)return done();throw error;}
 let result=reservation.result;
 if(reservation.state!=='completed'){
  // A crash or timeout keeps its full reservation and is never sent again.
  if(!reservation.created)return done();
  let usage;
  try{const reviewed=await reviewImage(source,asset,{apiKey:env.OPENAI_API_KEY,model,maxOutputTokens:IMAGE_OUTPUT_TOKENS});result=reviewed.result;usage=reviewed.usage;}
  catch(error){
   if(!(error instanceof EditorialModelError)||!error.usage)return done();
   // Refused/invalid optional imagery is omitted. Text safety holds are unchanged.
   usage=error.usage;result={approved:false,alt:'',policy:IMAGE_POLICY,hash:asset.hash};
  }
  await op('model-complete',{key,result,actualCost:Math.ceil(usage.inputTokens*inputPrice+usage.outputTokens*outputPrice)});
 }
 return result?.approved?done({key,asset}):done();
}
