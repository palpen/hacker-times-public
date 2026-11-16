import {firstFollowedAt,submittedAt} from './types';
import {policy,questionTemplates,buildRequest,fingerprint,proposeRoster} from './policy.mjs';
import type {Assessment,Roster,Thread,Run} from './types';
type Plan = {next_active_ids:string[];next_initialized:boolean;next_last_promotion_at:string|null;decisions:{story_id:string;outcome:string;reason:string}[]};
export async function rotate(roster:Roster,active:Thread[],run:Run):Promise<{roster:Roster;threads:Thread[];plan:Plan}> {
 const assessments=new Map<string,Assessment>();for(const a of run.results)assessments.set(a.thread.id,a);
 const threads=[...active,...run.results.map(r=>r.thread).filter(t=>!active.some(a=>a.id===t.id))];
 const snapshot={as_of:run.asOf,roster_revision:roster.revision,initialized:roster.initialized,last_promotion_at:roster.lastPromotionAt,discovery_ok:run.discoveryOk,budget_available:run.budgetAvailable!==false,
  stories:threads.map(t=>{
   const a=assessments.get(t.id),source=a?.evidence??t.evidence[0];
   // Compact metadata is solely for the deterministic policy validator. The
   // provider journal holds the exact full-source request and its response.
   const evidence=[source,...t.evidence].filter((e,i,all)=>e&&all.findIndex(x=>x?.id===e.id)===i).slice(0,6);
   return {id:t.id,title:t.title,central_question:t.question,known_facts:t.summary,status:t.status,pinned:t.pinned,excluded:t.excluded,activated_at:t.activatedAt,last_material_at:t.lastMaterialAt,
    next_expected_event:t.nextEvent&&evidence.some(e=>e.id===t.nextEvent?.evidenceId)?{at:t.nextEvent.at,evidence_id:t.nextEvent.evidenceId}:null,
    collection:{status:a?'complete':'failed',checked_at:run.asOf},new_evidence_ids:a?.material?[a.evidence.id]:[],
    evidence:evidence.map(e=>({id:e.id,url:e.url,provenance:'Full source is retained in the private request journal. The policy publication timestamp is HN submission time.',excerpt:'Full source SHA-256: '+e.hash,published_at:submittedAt(e),retrieved_at:e.retrievedAt}))};})};
 const request=buildRequest(snapshot);
 const answers=threads.flatMap(t=>assessments.get(t.id)?.answers??questionTemplates.map(q=>({name:t.id+'.'+q.name,type:'refusal'})));
 const plan=await proposeRoster(snapshot,{request_hash:await fingerprint(request),response:{model:'gpt-6-luna',answers}}) as Plan;
 const next=threads.map(t=>{
  const a=assessments.get(t.id),isActive=plan.next_active_ids.includes(t.id),status=isActive?'active':t.published?'quiet':'candidate';
  const publish=run.discoveryOk&&run.budgetAvailable!==false&&!t.excluded&&a&&(isActive||t.published)&&(a.material||a.resolved||isActive&&!t.published);
  const evidence=a?[a.evidence,...t.evidence.filter(e=>e.hash!==a.evidence.hash&&e.id!==a.evidence.id)].slice(0,policy.limits.maximum_evidence_items_per_story):t.evidence;
  const update=publish?{id:a.evidence.hash,at:run.asOf,summary:a.summary,source:{url:a.evidence.url,title:a.evidence.title,publisher:a.evidence.publisher,publishedAt:a.evidence.articlePublishedAt??null,...(/^\d+$/.test(a.evidence.id)&&Number.isSafeInteger(Number(a.evidence.id))&&Number(a.evidence.id)>0?{hnId:Number(a.evidence.id)}:{})},sourceHash:a.evidence.hash}:null;
  return {...t,status:status as Thread['status'],published:t.published||isActive,followingSince:firstFollowedAt(t)??(!t.published&&isActive?run.asOf:null),activatedAt:isActive&&t.status!=='active'?run.asOf:t.activatedAt,
   summary:publish?a.summary:t.summary,lastMaterialAt:publish?run.asOf:t.lastMaterialAt,evidence,nextEvent:a?.thread.nextEvent??t.nextEvent,
   updates:update?[update,...t.updates.filter(u=>u.id!==update.id)]:t.updates};
 });
 return {roster:{revision:roster.revision+1,initialized:plan.next_initialized,lastPromotionAt:plan.next_last_promotion_at,lastRunAt:run.asOf},threads:next,plan};
}
