import {selectBalancedLead,currentLeadScoringVersion} from '../lead-policy';
import {selectUnifiedMonthlyStories,unifiedSectionPolicyVersion} from '../policy';
import {normalizeArticleUrl} from '../lead-retirement';
import type {Candidate,SourceSnapshot} from '../contracts';
import {RequestError} from '../security';
import {assertPermittedSelection} from './safety';
import type {Root,Ledger,Snapshot} from './types';
export function chooseLead(root:Root,pool:Candidate[],frontPageIds:number[],at:number) {
  const ledger=root.ledger, active=ledger.active;
  if(active){const same=pool.find(s=>s.id===active.id);if(same&&normalizeArticleUrl(same.url)!==active.key)throw new RequestError('Current lead identity changed; review required',409);}
  const keys=new Map(pool.map(s=>[s.id,normalizeArticleUrl(s.url)]));
  const aliases=active?frontPageIds.filter(id=>keys.get(id)===active.key):[];
  const incumbentId=active?(aliases.includes(active.id)?active.id:aliases[0]??active.id):undefined;
  const audit=selectBalancedLead({candidates:pool,frontPageIds,at,incumbentId,observations:ledger.observations,retiredIds:new Set(ledger.retiredIds),retiredKeys:new Set(ledger.retiredKeys),candidateKeys:keys,suppressedIds:new Set(aliases.filter(id=>id!==incumbentId))},currentLeadScoringVersion);
  if(audit.status!=='selected')throw new RequestError('No eligible front-page lead; preserve the entire prior edition and timestamp',409);
  const lead=pool.find(s=>s.id===audit.leadId)!;
  const key=keys.get(lead.id)!;
  const retiredIds=[...ledger.retiredIds], retiredKeys=[...ledger.retiredKeys];
  if(active&&active.key!==key){retiredIds.push(...active.aliases);retiredKeys.push(active.key);}
  const observations=[...ledger.observations.filter(x=>at-x.observedAt<=150*60_000&&x.observedAt<at),...pool.map(s=>({id:s.id,score:s.score,comments:s.comments,observedAt:at}))];
  const nextLedger:Ledger={active:{id:lead.id,url:lead.url,key,aliases:active?.key===key?[...new Set([...active.aliases,lead.id])]:[lead.id]},retiredIds:[...new Set(retiredIds)],retiredKeys:[...new Set(retiredKeys)],observations};
  if(nextLedger.retiredIds.length>20_000||nextLedger.retiredKeys.length>20_000||observations.length>20_000)throw new RequestError('Lead ledger capacity reached; maintenance required without resetting history',409);
  return {audit,nextLedger};
}
export function pinSnapshot(root:Root,fetched:SourceSnapshot):Snapshot {
  assertPermittedSelection(fetched.selectedStories);
  const at=Date.parse(fetched.generatedAt);
  if(!Number.isFinite(at)||new Date(at).toISOString()!==fetched.generatedAt||at>Date.now()+300_000||at<Date.now()-48*3600_000||(root.generatedAt&&at<=Date.parse(root.generatedAt)))throw new RequestError('Invalid or non-advancing source timestamp',409);
  const {audit,nextLedger}=chooseLead(root,fetched.rankedStories,fetched.frontPageIds,Date.parse(fetched.generatedAt));
  if(fetched.selectionVersion!==6||fetched.layoutVersion!==3||fetched.policyVersion!==unifiedSectionPolicyVersion||fetched.sourcePages.length!==3)throw new RequestError('Unsupported complete collection contract',409);
  const expected=selectUnifiedMonthlyStories(fetched.rankedStories,fetched.frontPageIds,root.ledger.active?.id,at,audit.leadId!,fetched.sourcePages.flatMap(x=>x.ids));
  if(JSON.stringify(expected)!==JSON.stringify(fetched.selectedStories))throw new RequestError('Complete server selection changed',409);
  if(fetched.selectedStories[0]?.id!==audit.leadId)throw new RequestError('Selection disagrees with balanced lead',409);
  return {...fetched,schemaVersion:1,summaryPolicyVersion:1,leadPolicyVersion:currentLeadScoringVersion,basePublicationVersion:root.version,baseRevision:root.revision,nextLedger,leadAudit:audit};
}
