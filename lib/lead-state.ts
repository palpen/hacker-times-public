import type {Candidate,Edition,SourceSnapshot} from './contracts';
import type {Publication} from './publication';
import {sourceSnapshotKey} from './news';
import {balancedLeadPolicyVersion,currentLeadScoringVersion,type LeadScoringVersion,selectBalancedLead,type BalancedLeadResult,type LeadObservation} from './lead-policy';
import {emptyIndex,storyIdentity,validateRetirementIndex,verifyRetirementIndex,readRetiredKeys,prepareRetirements,type RetirementIndex,type StoryIdentity} from './lead-retirement';
import seedManifest from '../data/verified-lead-seeds.json';

export const LEAD_BOUNDARY_KEY='publication/lead-policy-boundary-v1.json';
export const leadStateLimits={batches:8,itemsPerBatch:254,historyMs:150*60_000,activeAliases:32} as const;
type Batch={generatedAt:string;items:{id:number;score:number;comments:number}[]};
type ActiveLead=StoryIdentity&{id:number;url:string;aliasIdKeys:string[]};
export type LeadState={schema:1;policyVersion:typeof balancedLeadPolicyVersion;revision:number;active:ActiveLead;retirements:RetirementIndex;observations:Batch[]};
export type LeadPlan={schema:1;basePublicationVersion:string;baseRevision:number;baseState:LeadState;nextState:LeadState;audit:BalancedLeadResult};
export type LeadBoundary={schema:1;policyVersion:typeof balancedLeadPolicyVersion;basePublicationVersion:string};
const hash=/^[a-f0-9]{64}$/;const publicationVersion=/^e-[a-f0-9]{24}$/;
function fail(detail:string):never{throw Error('Lead policy state '+detail+'; preserve the current edition and fetch candidates again after repair.');}
function record(v:unknown):v is Record<string,unknown>{return !!v&&typeof v==='object'&&!Array.isArray(v);}
function integer(v:unknown,min=0):v is number{return Number.isSafeInteger(v)&&Number(v)>=min;}
function stamp(v:unknown):v is string{return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;}
function validateBatch(value:unknown):asserts value is Batch{
 if(!record(value)||!stamp(value.generatedAt)||!Array.isArray(value.items)||!value.items.length||value.items.length>leadStateLimits.itemsPerBatch)fail('has an invalid observation batch');
 const ids=new Set<number>();for(const item of value.items){if(!record(item)||!integer(item.id,1)||ids.has(item.id)||!integer(item.score)||!integer(item.comments))fail('has invalid observation counters');ids.add(item.id);}
}
export function validateLeadState(value:unknown):asserts value is LeadState{
 if(!record(value)||value.schema!==1||value.policyVersion!==balancedLeadPolicyVersion||!integer(value.revision)||!record(value.active)||!integer(value.active.id,1)||typeof value.active.url!=='string'||typeof value.active.idKey!=='string'||!hash.test(value.active.idKey)||typeof value.active.articleKey!=='string'||!hash.test(value.active.articleKey)||!Array.isArray(value.observations)||!value.observations.length||value.observations.length>leadStateLimits.batches)fail('is missing or malformed');
 if(!Array.isArray(value.active.aliasIdKeys)||!value.active.aliasIdKeys.length||value.active.aliasIdKeys.length>leadStateLimits.activeAliases||new Set(value.active.aliasIdKeys).size!==value.active.aliasIdKeys.length||!value.active.aliasIdKeys.includes(value.active.idKey)||value.active.aliasIdKeys.some(k=>typeof k!=='string'||!hash.test(k)))fail('has invalid active aliases');
 if(Object.keys(value).length!==6||Object.keys(value.active).length!==5||new TextEncoder().encode(JSON.stringify(value)).byteLength>300_000)fail('exceeds its bounded schema');
 validateRetirementIndex(value.retirements);
 let previous=-Infinity;for(const batch of value.observations){validateBatch(batch);const at=Date.parse(batch.generatedAt);if(at<=previous)fail('has duplicate or unordered observation batches');previous=at;}
 if(value.observations.length&&previous-Date.parse(value.observations[0].generatedAt)>leadStateLimits.historyMs)fail('has unbounded observation history');
}
export async function verifyLeadState(bucket:R2Bucket,state:LeadState,edition:Edition){
 validateLeadState(state);const lead=edition.stories[0];if(!lead||state.active.id!==lead.id||state.active.url!==lead.url)fail('does not match the published lead');
 const identity=await storyIdentity(state.active);if(identity.idKey!==state.active.idKey||identity.articleKey!==state.active.articleKey)fail('has an invalid current identity');
 await verifyRetirementIndex(bucket,state.retirements);
 if((await readRetiredKeys(bucket,state.retirements,[...state.active.aliasIdKeys,identity.articleKey])).size)fail('retires the active lead');
 if(state.observations.at(-1)?.generatedAt!==edition.generatedAt||state.observations.some(b=>Date.parse(b.generatedAt)>Date.parse(edition.generatedAt)))fail('does not match the published observation timestamp');
}
export async function readLeadBoundary(bucket:R2Bucket):Promise<LeadBoundary|undefined>{
 const object=await bucket.get(LEAD_BOUNDARY_KEY);if(!object)return undefined;const value=await object.json<LeadBoundary>();
 if(!record(value)||value.schema!==1||value.policyVersion!==balancedLeadPolicyVersion||typeof value.basePublicationVersion!=='string'||!publicationVersion.test(value.basePublicationVersion)||Object.keys(value).length!==3)fail('has an invalid activation boundary');return value;
}
export function validatePublicationBoundary(publication:Publication,boundary:LeadBoundary|undefined){
 const guard=publication.leadBoundary;
 if(guard&&(guard.schema!==1||guard.policyVersion!==balancedLeadPolicyVersion||!publicationVersion.test(guard.basePublicationVersion)||Object.keys(guard).length!==3))fail('has an invalid publication activation guard');
 if(boundary&&(!guard||JSON.stringify(guard)!==JSON.stringify(boundary)))fail('activation guard does not match its immutable boundary');
 if(publication.leadState&&publication.leadState.revision<1)fail('has an invalid published state revision');
 if(publication.leadState&&(!guard||!boundary))fail('lost its activation boundary');
 if(guard&&!publication.leadState&&guard.basePublicationVersion!==publication.current.version)fail('lost its activated state');
}
export async function ensureLeadBoundary(bucket:R2Bucket,publication:Publication){
 // The root guard is committed first with the same CAS used by publishers. It
 // changes no edition/version but invalidates in-flight legacy writer ETags.
 // A separate immutable marker then detects later root/state loss. A crash in
 // between can only resume this exact guarded preactivation publication.
 const object=await bucket.get('publication/current.json');if(!object)fail('lost its current publication');
 let current=await object.json<Publication>();if(current.current?.version!==publication.current.version)fail('publication changed during activation');
 let boundary=await readLeadBoundary(bucket);validatePublicationBoundary(current,boundary);
 if(!current.leadBoundary){
  const guard:LeadBoundary={schema:1,policyVersion:balancedLeadPolicyVersion,basePublicationVersion:current.current.version};
  const guarded={...current,leadBoundary:guard};
  const written=await bucket.put('publication/current.json',JSON.stringify(guarded),{onlyIf:{etagMatches:object.etag},httpMetadata:{contentType:'application/json'}});
  if(!written){const raced=await bucket.get('publication/current.json');if(!raced)fail('activation changed concurrently');current=await raced.json<Publication>();if(current.current?.version!==publication.current.version||JSON.stringify(current.leadBoundary)!==JSON.stringify(guard))fail('activation changed concurrently');}
  else current=guarded;
 }
 if(!boundary){
  const written=await bucket.put(LEAD_BOUNDARY_KEY,JSON.stringify(current.leadBoundary),{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}});
  if(!written){boundary=await readLeadBoundary(bucket);if(!boundary)fail('activation boundary is missing');}
  else boundary=current.leadBoundary;
 }
 validatePublicationBoundary(current,boundary);
}
function batchFor(generatedAt:string,pool:readonly Pick<Candidate,'id'|'score'|'comments'>[]):Batch{
 const batch={generatedAt,items:pool.map(s=>({id:s.id,score:s.score,comments:s.comments})).sort((a,b)=>a.id-b.id)};validateBatch(batch);return batch;
}
export function appendLeadObservation(batches:Batch[],generatedAt:string,pool:readonly Pick<Candidate,'id'|'score'|'comments'>[]):Batch[]{
 const batch=batchFor(generatedAt,pool),at=Date.parse(generatedAt);
 if(batches.some(b=>Date.parse(b.generatedAt)>at))fail('cannot move observations backwards');
 const prior=batches.filter(b=>at-Date.parse(b.generatedAt)<=leadStateLimits.historyMs);
 const same=prior.find(b=>b.generatedAt===generatedAt);
 if(same){if(JSON.stringify(same)!==JSON.stringify(batch))fail('has conflicting source measurements');return prior;}
 if(prior.length>=leadStateLimits.batches)fail('observation capacity reached; wait for old measurements to age out');
 return [...prior,batch];
}
function observations(state:LeadState):LeadObservation[]{return state.observations.flatMap(b=>b.items.map(s=>({...s,observedAt:Date.parse(b.generatedAt)})));}
async function publishedLead(bucket:R2Bucket,version:string){
 if(!publicationVersion.test(version))fail('has an invalid published version reference');
 const object=await bucket.get('publication/versions/'+version+'.json');if(!object)fail('is missing a required published migration record');const record=await object.json<{version:string;edition:Edition}>();
 if(record.version!==version||!record.edition?.stories?.[0]||!stamp(record.edition.generatedAt))fail('has a malformed published migration record');return record.edition.stories[0];
}
async function initialState(bucket:R2Bucket,publication:Publication):Promise<LeadState>{
 if(!publicationVersion.test(publication.current.version)||!record(publication.archives)||Object.keys(publication.archives).length>31||Object.entries(publication.archives).some(([date,version])=>!/^\d{4}-\d{2}-\d{2}$/.test(date)||!publicationVersion.test(version)))fail('has invalid official archive references');
 const current=publication.current,lead=current.edition.stories[0],identity=await storyIdentity(lead),active:ActiveLead={id:lead.id,url:lead.url,...identity,aliasIdKeys:[identity.idKey]};
 const seeds:{id:number;url:string}[]=[];
 for(const version of [...new Set(Object.values(publication.archives))])if(version!==current.version)seeds.push(await publishedLead(bucket,version));
 const backup=await bucket.get('publication/last-valid.json');if(backup){const p=await backup.json<Publication>();if(p.schema!==1||!p.current?.edition?.stories?.[0]||!publicationVersion.test(p.current.version))fail('has an invalid published backup');seeds.push(p.current.edition.stories[0]);}
 const manifest=seedManifest as {schema:number;stories:{id:number;url:string;publicationVersion?:string;proof?:string}[]};
 if(manifest.schema!==1||!Array.isArray(manifest.stories)||manifest.stories.length>128)fail('has an invalid verified migration manifest');
 for(const seed of manifest.stories){if(!record(seed)||!integer(seed.id,1)||typeof seed.url!=='string'||typeof seed.publicationVersion!=='string'||typeof seed.proof!=='string'||!seed.proof.trim()||seed.proof.length>2048)fail('has an unverified migration seed');const proven=await publishedLead(bucket,seed.publicationVersion);if(proven.id!==seed.id||proven.url!==seed.url)fail('migration seed does not match its published record');seeds.push(seed);}
 let retirements=emptyIndex();const keys:string[]=[];
 for(const seed of seeds){const identity=await storyIdentity(seed);if(identity.idKey===active.idKey||identity.articleKey===active.articleKey){active.aliasIdKeys=[...new Set([...active.aliasIdKeys,identity.idKey])].sort();if(active.aliasIdKeys.length>leadStateLimits.activeAliases)fail('active alias capacity reached');continue;}keys.push(identity.idKey,identity.articleKey);}
 for(let i=0;i<keys.length;i+=128)retirements=await prepareRetirements(bucket,retirements,keys.slice(i,i+128));
 const saved=await bucket.get(sourceSnapshotKey(current.edition.generatedAt));let pool:Pick<Candidate,'id'|'score'|'comments'>[]=current.edition.stories;
 if(saved){const source=await saved.json<SourceSnapshot>();if(source.generatedAt!==current.edition.generatedAt||!Array.isArray(source.rankedStories)||!Array.isArray(source.selectedStories)||source.selectedStories.length!==current.edition.stories.length||source.selectedStories.some((s,i)=>s.id!==current.edition.stories[i].id))fail('has a malformed published source snapshot');
  const byId=new Map(source.rankedStories.map(s=>[s.id,s]));if(current.edition.stories.some(s=>{const known=byId.get(s.id);return !known||known.score!==s.score||known.comments!==s.comments||known.time!==s.time||known.url!==s.url;}))fail('source snapshot does not match the published edition');pool=source.rankedStories;
 }
 return {schema:1,policyVersion:balancedLeadPolicyVersion,revision:0,active,retirements,observations:[batchFor(current.edition.generatedAt,pool)]};
}
export async function prepareLeadBase(bucket:R2Bucket,publication:Publication):Promise<LeadState>{
 await ensureLeadBoundary(bucket,publication);
 const state=publication.leadState??await initialState(bucket,publication);await verifyLeadState(bucket,state,publication.current.edition);return state;
}
export class LeadIdentityReviewRequired extends Error{constructor(){super('The current HN story changed its linked article identity; preserve the current edition and request owner review.');}}
export class LeadSelectionBlocked extends Error{constructor(public audit:BalancedLeadResult){super('No eligible front-page lead; retaining the entire last valid edition.');}}
export async function prepareLeadPlan(bucket:R2Bucket,publication:Publication,baseState:LeadState,pool:Candidate[],frontPageIds:number[],at:number,scoringVersion:LeadScoringVersion=currentLeadScoringVersion):Promise<LeadPlan>{
 const currentSource=pool.find(s=>s.id===baseState.active.id);if(currentSource&&(await storyIdentity(currentSource)).articleKey!==baseState.active.articleKey)throw new LeadIdentityReviewRequired();
 const identities=new Map<number,StoryIdentity>();for(const candidate of pool.filter(s=>frontPageIds.includes(s.id)))identities.set(candidate.id,await storyIdentity(candidate));
 const keys=[...identities.values()].flatMap(s=>[s.idKey,s.articleKey]);const retired=await readRetiredKeys(bucket,baseState.retirements,keys);
 const retiredIds=new Set([...identities].filter(([,s])=>retired.has(s.idKey)).map(([id])=>id));
 const candidateKeys=new Map([...identities].map(([id,s])=>[id,s.articleKey]));
 const aliases=frontPageIds.filter(id=>identities.get(id)?.articleKey===baseState.active.articleKey);
 const incumbentId=aliases.includes(baseState.active.id)?baseState.active.id:aliases[0]??baseState.active.id;
 const suppressedIds=new Set(aliases.filter(id=>id!==incumbentId));
 const audit=selectBalancedLead({candidates:pool,frontPageIds,at,incumbentId,observations:observations(baseState),retiredIds,retiredKeys:retired,candidateKeys,suppressedIds},scoringVersion);
 if(audit.status==='blocked')throw new LeadSelectionBlocked(audit);
 const lead=pool.find(s=>s.id===audit.leadId)!;const identity=identities.get(lead.id)!;const aliasIdKeys=identity.articleKey===baseState.active.articleKey?[...new Set([...baseState.active.aliasIdKeys,identity.idKey])].sort():[identity.idKey];if(aliasIdKeys.length>leadStateLimits.activeAliases)fail('active alias capacity reached');const active={id:lead.id,url:lead.url,...identity,aliasIdKeys};
 const retirements=active.articleKey===baseState.active.articleKey?baseState.retirements:await prepareRetirements(bucket,baseState.retirements,[...baseState.active.aliasIdKeys,baseState.active.articleKey]);
 const nextState:LeadState={schema:1,policyVersion:balancedLeadPolicyVersion,revision:baseState.revision+1,active,retirements,observations:appendLeadObservation(baseState.observations,new Date(at).toISOString(),pool)};
 return {schema:1,basePublicationVersion:publication.current.version,baseRevision:baseState.revision,baseState,nextState,audit};
}
export async function verifyLeadPlan(bucket:R2Bucket,publication:Publication,snapshot:SourceSnapshot){
 const plan=snapshot.leadPlan;if(!plan||plan.schema!==1||![balancedLeadPolicyVersion,currentLeadScoringVersion].includes(snapshot.leadPolicyVersion??'')||snapshot.leadPolicyVersion!==plan.audit?.policyVersion||![3,4,5,6].includes(snapshot.selectionVersion??0)||plan.basePublicationVersion!==snapshot.basePublicationVersion||plan.baseRevision!==plan.baseState?.revision)fail('has an invalid pinned plan');
 validateLeadState(plan.baseState);validateLeadState(plan.nextState);
 if(plan.nextState.revision!==plan.baseRevision+1||plan.audit?.status!=='selected'||plan.audit.leadId!==snapshot.selectedStories[0]?.id||plan.nextState.active.id!==snapshot.selectedStories[0]?.id)fail('has an inconsistent pinned plan');
 // Exact same-content retries may use the previous base; the publication digest
 // below still checks every authored field, template and the complete next state.
 const retry=publication.current.version!==plan.basePublicationVersion;
 if(retry&&JSON.stringify(publication.leadState)!==JSON.stringify(plan.nextState))fail('changed since this draft was prepared');
 const base=retry?plan.baseState:await prepareLeadBase(bucket,publication);if(JSON.stringify(base)!==JSON.stringify(plan.baseState))fail('changed since this draft was prepared');
 const pinnedPublication=retry?{...publication,current:{...publication.current,version:plan.basePublicationVersion}}:publication;
 const rebuilt=await prepareLeadPlan(bucket,pinnedPublication,base,snapshot.rankedStories,snapshot.frontPageIds,Date.parse(snapshot.generatedAt),snapshot.leadPolicyVersion as LeadScoringVersion);
 if(JSON.stringify(rebuilt)!==JSON.stringify(plan))fail('does not match its pinned source inputs');
}
export const balancedLeadRanking='Lead: 27.222…% logarithmic total points, 11.666…% logarithmic total comments, 23.333…% measured points/hour, 7.777…% measured comments/hour, and 30% freshness (24-hour half-life), normalized on current page one. Retain the incumbent until a challenger leads by at least 5 points. Replaced articles cannot return as lead.';
export const balancedLeadInstructions='The server pins the balanced lead with permanent article retirement and 5-point hysteresis. Use the selected lead exactly; preserve the current headline when the same article remains. Missing measured growth earns no rate bonus. A blocked result retains the entire last valid edition and timestamp. ';
