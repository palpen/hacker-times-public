import type {Candidate,Story} from '../contracts';
import {normalizeArticleUrl} from '../lead-retirement';
import {RequestError} from '../security';
import {DEFAULT_EDITORIAL_MODEL,EDITORIAL_REQUEST_POLICY,editorialEvidence,readValidatedUsage,reviewEditorialDraft,type EditorialModelResult} from './editorial-model';
import {digest,type Store} from './storage';
import type {ProductionEnv,Source} from './types';

export const unresolvedEditorialStatus='editorial_outcome_unknown';

export function editorialRequestKey(env:ProductionEnv|undefined, selected:Candidate, source:Source){
 return digest({policy:EDITORIAL_REQUEST_POLICY,model:env?.EDITORIAL_MODEL||DEFAULT_EDITORIAL_MODEL,maxOutputTokens:Number(env?.MODEL_MAX_OUTPUT_TOKENS||1024),id:selected.id,title:selected.title,url:selected.url,kind:source.kind,excerpt:source.excerpt,description:source.description});
}

// Across snapshots, the same article and actual model evidence retain their
// resolution even if transport settings or engagement counts change.
export function editorialResolutionKey(selected:Candidate,source:Source){
 return digest({url:normalizeArticleUrl(selected.url),title:selected.title,evidence:editorialEvidence(source)});
}

export async function leadEvidenceIdentity(story:Story,source:Source|null){
 if(!source||!story.summarySource||story.summarySource==='unavailable')return undefined;
 const evidence=editorialEvidence(source);
 const text=story.summarySource==='archived_summary'&&source.archive
  ? [source.archive.headline,source.archive.shortSummary]
  : evidence&&story.summarySource===evidence.provenance?evidence.text:null;
 if(!text)return undefined;
 return digest({title:story.title,provenance:story.summarySource,text});
}

export type Reservation = {
 state:string;cost:number;day:string;month:string;createdAt:string;attempt?:number;
 settledCost?:number;unknownResolvedAt?:string;result?:unknown;receipt?:{result:EditorialModelResult;actualCost:number};
};

export async function settleModel(store:Store,key:string,prior:Reservation,result:unknown,actualCost:number){
 if(!Number.isSafeInteger(actualCost)||actualCost<0||actualCost>prior.cost)throw new RequestError('Provider usage cannot be settled within reservation',409);
 for(const budgetKey of ['budget/day/'+prior.day,'budget/month/'+prior.month]){
  const total=await store.get<number>(budgetKey);if(total===undefined||total<prior.cost)throw new RequestError('Budget accounting mismatch',503);
  await store.put(budgetKey,total-prior.cost+actualCost);
 }
 await store.put('model/'+key,{...prior,state:'completed',settledCost:actualCost,result});
}

export function verifiedEditorialReceipt(input:unknown,source:Source,selected:Candidate,env:ProductionEnv|undefined){
 const result=input as EditorialModelResult|undefined;
 const usage=readValidatedUsage(result?.usage,Number(env?.MODEL_MAX_OUTPUT_TOKENS||1024));
 const inputPrice=Number(env?.MODEL_INPUT_USD_PER_MILLION),outputPrice=Number(env?.MODEL_OUTPUT_USD_PER_MILLION);
 if(!usage||result?.requested!==true||!result.story||!Number.isFinite(inputPrice)||inputPrice<=0||!Number.isFinite(outputPrice)||outputPrice<=0)throw new RequestError('Verified editorial receipt and model rates required',409);
 const {headline,summary,shortSummary,summarySource}=result.story;
 const checked=reviewEditorialDraft(source,selected,{headline,summary,shortSummary,summarySource});
 return {result:{...checked,usage,requested:true},actualCost:Math.ceil(usage.inputTokens*inputPrice+usage.outputTokens*outputPrice)};
}
