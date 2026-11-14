import type {Edition} from './contracts';
import {normalizeArticleUrl} from './lead-retirement';

/** Persisted at publication time, never computed by visitors. HN exposes display
 * order for top-level kids, not comment vote counts. No score is stored. */
export const LEGACY_HIGHLIGHT_POLICY = 'hn-top-level-display-order-v1' as const;
export const V2_HIGHLIGHT_POLICY = 'hn-top-level-display-order-v2' as const;
export const TRENDING_HIGHLIGHT_POLICY = 'hn-trending-comments-v4' as const;
export type HighlightSource = {id:number;title:string;url:string;time:number;hnPosition:number;comments:number};
export const HIGHLIGHT_POLICY = 'hn-top-level-display-order-v3' as const;
export const HIGHLIGHT_LIMITS = Object.freeze({stories:42, items:16, requests:144, children:5, concurrency:4, itemBytes:100_000, itemMs:3_000, totalMs:18_000, words:25, characters:240, snapshotBytes:24_000});
export type DiscussionHighlight = {
 storyId:number;commentId:number;author:string;commentTime:number;
 hnPosition:number;excerpt:string;truncated:boolean;retrievedAt:string;
};
export type DiscussionSnapshot = {
 sources?:HighlightSource[];
 policy:typeof TRENDING_HIGHLIGHT_POLICY|typeof HIGHLIGHT_POLICY|typeof V2_HIGHLIGHT_POLICY|typeof LEGACY_HIGHLIGHT_POLICY;sourceGeneratedAt:string;basePublicationVersion:string;
 storyIds:number[];collectedAt:string;status:'complete'|'partial'|'unavailable';
 unavailableStoryIds:number[];items:DiscussionHighlight[];
};
/** Only already-selected articles are eligible. The original six discussion
 * placements lead, followed by other articles in saved edition order. This does
 * not change article selection, ranking, placements or the lead ledger. */
export function discussionStoryIds(edition:Pick<Edition,'stories'>,policy:DiscussionSnapshot['policy']=HIGHLIGHT_POLICY){
 const discussion=edition.stories.filter(s=>s.placement==='discussion');
 if(policy===LEGACY_HIGHLIGHT_POLICY)return discussion.slice(0,6).map(s=>s.id);
 const stories=[...discussion,...edition.stories.filter(s=>s.placement!=='discussion'&&s.comments>0)];
 const seenIds=new Set<number>(),seenArticles=new Set<string>(),ids:number[]=[];
 for(const story of stories){
  let article:string;try{article=normalizeArticleUrl(story.url);}catch{continue;}
  if(seenIds.has(story.id)||seenArticles.has(article))continue;
  seenIds.add(story.id);seenArticles.add(article);ids.push(story.id);
  if(ids.length===HIGHLIGHT_LIMITS.stories)break;
 }
 return ids;
}
const id=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>0;
const iso=(s:unknown):s is string=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString()===s;
export function validDiscussionSnapshot(value:unknown,edition:Pick<Edition,'stories'|'generatedAt'|'sourcePages'|'frontPageIds'>,basePublicationVersion?:string):value is DiscussionSnapshot{
 const v=value as DiscussionSnapshot;
 if(v?.policy===TRENDING_HIGHLIGHT_POLICY)return validTrendingSnapshot(v,edition,basePublicationVersion);
 if(!v||typeof v!=='object'||![HIGHLIGHT_POLICY,V2_HIGHLIGHT_POLICY,LEGACY_HIGHLIGHT_POLICY].includes(v.policy))return false;
 const ids=discussionStoryIds(edition,v.policy),limit=v.policy===LEGACY_HIGHLIGHT_POLICY?6:HIGHLIGHT_LIMITS.items;
 if(v.sourceGeneratedAt!==edition.generatedAt||!iso(v.sourceGeneratedAt)||!iso(v.collectedAt)||Date.parse(v.collectedAt)<Date.parse(v.sourceGeneratedAt)||typeof v.basePublicationVersion!=='string'||!/^(?:empty|e-[a-f0-9]{24}|bundled-[a-f0-9]{16})$/.test(v.basePublicationVersion)||(basePublicationVersion!==undefined&&v.basePublicationVersion!==basePublicationVersion)||!Array.isArray(v.storyIds)||JSON.stringify(v.storyIds)!==JSON.stringify(ids)||!Array.isArray(v.items)||v.items.length>Math.min(ids.length,limit)||!['complete','partial','unavailable'].includes(v.status)||!Array.isArray(v.unavailableStoryIds)||new Set(v.unavailableStoryIds).size!==v.unavailableStoryIds.length||!v.unavailableStoryIds.every(n=>ids.includes(n)))return false;
 if(v.status!==(v.unavailableStoryIds.length?(v.unavailableStoryIds.length===ids.length?'unavailable':'partial'):'complete'))return false;
 const stories=new Set<number>(),comments=new Set<number>();let position=-1;
 return v.items.every(h=>{
  if(!h||!id(h.storyId)||!id(h.commentId)||h.commentId===h.storyId||!ids.includes(h.storyId)||v.unavailableStoryIds.includes(h.storyId)||stories.has(h.storyId)||comments.has(h.commentId)||ids.indexOf(h.storyId)<=position||typeof h.author!=='string'||!/^[-\w]{1,50}$/.test(h.author)||!id(h.commentTime)||h.commentTime*1000>Date.parse(h.retrievedAt)+300_000||!Number.isSafeInteger(h.hnPosition)||h.hnPosition<1||h.hnPosition>HIGHLIGHT_LIMITS.children||typeof h.excerpt!=='string'||!h.excerpt.trim()||h.excerpt.length>HIGHLIGHT_LIMITS.characters||h.excerpt.split(/\s+/).length>HIGHLIGHT_LIMITS.words||/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(h.excerpt)||typeof h.truncated!=='boolean'||!iso(h.retrievedAt)||Date.parse(h.retrievedAt)<Date.parse(v.sourceGeneratedAt)||Date.parse(h.retrievedAt)>Date.parse(v.collectedAt)||'score' in h)return false;
  stories.add(h.storyId);comments.add(h.commentId);position=ids.indexOf(h.storyId);return true;
 });
}

/** The first 24 entries of the pinned current HN pages, not selected articles.
 * This is a bounded current-trending sample, never a daily vote leaderboard. */
export function trendingStoryIds(edition:Pick<Edition,'sourcePages'|'frontPageIds'>):number[]{
 return [...new Set((edition.sourcePages?.flatMap(p=>p.ids)??edition.frontPageIds??[]).filter(id))].slice(0,24);
}
function validTrendingSnapshot(v:DiscussionSnapshot,edition:Pick<Edition,'stories'|'generatedAt'|'sourcePages'|'frontPageIds'>,base?:string):boolean{
 const ids=trendingStoryIds(edition),sources=v.sources;
 if(!Array.isArray(sources)||sources.length>24||!Array.isArray(v.storyIds)||JSON.stringify(v.storyIds)!==JSON.stringify(ids))return false;
 const seen=new Set<number>(),urls=new Set<string>();
 for(const s of sources){
  if(!s||!id(s.id)||!ids.includes(s.id)||seen.has(s.id)||!id(s.time)||s.time*1000>Date.parse(v.collectedAt)+300000||!Number.isSafeInteger(s.comments)||s.comments<0||s.hnPosition!==ids.indexOf(s.id)+1||typeof s.title!=='string'||!s.title.trim()||s.title.length>500||/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(s.title)||typeof s.url!=='string'||s.url.length>2048)return false;
  let url:string;try{url=normalizeArticleUrl(s.url);}catch{return false;}
  if(urls.has(url))return false;seen.add(s.id);urls.add(url);
 }
 // Reuse the strict legacy attribution/timestamp/quote checks with a synthetic
 // source list. The independent candidate binding above is authoritative.
 const synthetic={generatedAt:edition.generatedAt,stories:ids.map(n=>({id:n,url:'https://news.ycombinator.com/item?id='+n,comments:1}))} as Pick<Edition,'stories'|'generatedAt'>;
 const legacy={...v,policy:HIGHLIGHT_POLICY};
 if(!validDiscussionSnapshot(legacy,synthetic,base))return false;
 return sources.length===v.items.length&&new Set(v.items.map(h=>h.author)).size===v.items.length&&v.items.every(h=>seen.has(h.storyId)&&h.commentTime*1000>=Date.parse(v.sourceGeneratedAt)-86400000);
}
