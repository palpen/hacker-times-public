import type {Candidate, Edition, SourceSnapshot} from '../contracts';
import type {LeadObservation, BalancedLeadResult} from '../lead-policy';
export interface ProductionEnv {
  NEWSROOM: DurableObjectNamespace;
  MUTATIONS_ENABLED?: string;
  LIVE_FETCH_ENABLED?: string;
  PUBLICATION_ENABLED?: string;
  SCHEDULE_ENABLED?: string;
  EDITORIAL_MODEL?: string;
  MODEL_API_ENABLED?: string;
  AUTO_EDITORIAL_ENABLED?: string;
  OPENAI_API_KEY?: string;
  MODEL_MAX_OUTPUT_TOKENS?: string;
  MODEL_INPUT_USD_PER_MILLION?: string;
  MODEL_OUTPUT_USD_PER_MILLION?: string;
  MODEL_DAILY_LIMIT_MICRO_USD?: string;
  MODEL_MONTHLY_LIMIT_MICRO_USD?: string;
}
export type Active = {id:number; url:string; key:string; aliases:number[]};
export type Ledger = {active?:Active; retiredIds:number[]; retiredKeys:string[]; observations:LeadObservation[]};
export type Root = {
  schema:1; revision:number; version:string; generatedAt?:string; previous?:string;
  archives:Record<string,string>; ledger:Ledger;
  safetyStop?:{kind:'safety_stop'; generatedAt:string; storyId?:number; recordedAt:string};
};
export type Snapshot = SourceSnapshot & {baseRevision:number; nextLedger:Ledger; leadAudit:BalancedLeadResult};
export type Publication = {version:string; edition:Edition; html:string};
export type Source = {id:number; generatedAt:string; fingerprint:string; kind:'article'|'hn_post'|'unavailable'; excerpt:string; description:string; url:string; fetchedAt:string; status:string};
export type Staged = {revision:number; story:Edition['stories'][number]; sourceFingerprint:string};
export type CandidateBatch = {generatedAt:string; rankedStories:Candidate[]; selectedStories:Candidate[]};
