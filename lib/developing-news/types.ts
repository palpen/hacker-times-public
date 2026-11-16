export type Evidence = {id:string; url:string; title:string; publisher:string; publishedAt?:string; submittedAt?:string; articlePublishedAt?:string|null; retrievedAt:string; text:string; hash:string};
export type Update = {id:string; at:string; summary:string; source:{url:string;title:string;publisher:string;hnId?:number;publishedAt?:string|null}; sourceHash:string};
export type Thread = {
 id:string; title:string; question:string; summary:string; terms:string[];
 status:'candidate'|'active'|'quiet'; published:boolean; followingSince?:string|null; activatedAt:string|null;
 lastMaterialAt:string; nextEvent:{at:string;evidenceId:string}|null;
 evidence:Evidence[]; updates:Update[]; pinned:boolean; excluded:boolean;
};
export type PublicThread = Pick<Thread,'id'|'title'|'question'|'summary'|'status'|'lastMaterialAt'|'updates'>&{followingSince:string|null};
export type PublicNews = {active:PublicThread[]; quiet:PublicThread[]; nextCursor:string|null};
export type Article = {id:number;title:string;url:string;time:number;score:number};
export type Roster = {revision:number;initialized:boolean;lastPromotionAt:string|null;lastRunAt:string|null};
export type Answer = {name:string;type:string;[key:string]:unknown};
export type Assessment = {thread:Thread; answers:Answer[]; checkedAt:string; material:boolean; resolved:boolean; evidence:Evidence; summary:string};
export type Work = {article:Article; threadId?:string; evidence?:Evidence; matches?:Thread[]; assessmentAt?:string};
export type Run = {id:string;asOf:string;baseRevision:number;queue:Work[];results:Assessment[];failed:string[];processed:number[];discoveryOk:boolean;budgetAvailable?:boolean};
// publishedAt on legacy Evidence was HN submission time, never publisher metadata.
export const submittedAt=(e:Evidence)=>e.submittedAt??e.publishedAt??e.retrievedAt;
export const firstFollowedAt=(t:Thread)=>t.followingSince??(t.published?[...t.updates].map(u=>u.at).sort()[0]??null:null);
export function publicThread(t:Thread):PublicThread {
 return {id:t.id,title:t.title,question:t.question,summary:t.summary,status:t.status,followingSince:firstFollowedAt(t),lastMaterialAt:t.lastMaterialAt,updates:t.updates.map(u=>{
  const evidence=t.evidence.find(e=>e.hash===u.sourceHash&&e.url===u.source.url);
  const id=evidence&&/^\d+$/.test(evidence.id)?Number(evidence.id):undefined;
  return {...u,source:{...u.source,publishedAt:u.source.publishedAt??evidence?.articlePublishedAt??null,...(!u.source.hnId&&Number.isSafeInteger(id)&&id!>0?{hnId:id}:{})}};
 })};
}
