import type {Story} from './contracts';
// Explicit provenance only: never guess availability from legacy prose or fetch status.
export function summaryText(s:Story,compact?:boolean){return s.summarySource==='unavailable'?'Summary unavailable':compact?s.shortSummary:s.summary;}
