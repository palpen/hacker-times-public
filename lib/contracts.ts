import type {LeadPlan} from './lead-state';
import type {DiscussionSnapshot} from './discussion-highlights';
// Bounded to accommodate every permitted text/URL field at the 126-story safety cap,
// including worst-case JSON escaping; normal editions are much smaller.
export const editionLimits={payloadBytes:3_200_000,mcpBytes:3_300_000} as const;
export const legacyCategories = ['Technology','Software','Science','Culture','Business'] as const;
export const categories = ['Technology','AI','Software','Science','Culture','Business','Games'] as const;
export type Category = typeof categories[number];
export type Placement = 'lead'|'top'|'discussion'|'section'|'section-only';
export type Story = {
 id:number;title:string;headline:string;summary:string;summarySource?:'article'|'page_description'|'hn_post'|'unavailable';shortSummary?:string;url:string;publisher:string;
 score:number;comments:number;time:number;category:string;
 hnRank?:number;hnPage?:number;editorialScore?:number;placement?:Placement;topics?:Category[];discoverySource?:'current'|'history';
 image?:string|null;imageAlt?:string;imageCredit?:string;articleStatus?:string;
};
export type Candidate = {id:number;title:string;url:string;score:number;comments:number;time:number;hnRank?:number;hnPage?:number;category:Category;editorialScore:number;placement?:Placement;topics?:Category[];discoverySource?:'current'|'history'};
export type Edition = {discussionHighlights?:DiscussionSnapshot;schemaVersion?:1;freshnessPolicyVersion?:1;selectionVersion?:1|2|3|4|5|6;summaryPolicyVersion?:1;leadPolicyVersion?:string;layoutVersion?:number;policyVersion?:string;policyConfig?:Record<string,unknown>;generatedAt:string;windowStart?:string;windowEnd?:string;discovery?:Record<string,unknown>;frontPageIds?:number[];frontPageUrl?:string;sourcePages?:{url:string;ids:number[]}[];sourceMode?:string;algorithmVersion?:number;stories:Story[];candidateCount:number;fetchedCount?:number;ranking:string;editionDate?:string;persisted?:boolean};
// Version the persisted selection separately from ranking code and reader layout.
export type SourceSnapshot = {schemaVersion?:1;summaryPolicyVersion?:1;freshnessPolicyVersion?:1;selectionVersion?:1|2|3|4|5|6;leadPolicyVersion?:string;leadPlan?:LeadPlan;layoutVersion?:1|2|3;policyVersion?:string;policyConfig?:Record<string,unknown>;ranking?:string;basePublicationVersion?:string;windowStart?:string;windowEnd?:string;sourceMode?:string;discovery?:Record<string,unknown>;generatedAt:string;frontPageIds:number[];sourcePages:{url:string;ids:number[]}[];algorithmVersion:number;candidateCount:number;fetchedCount:number;rankedStories:Candidate[];selectedStories:Candidate[]};
// Historical prose must not change when the active policy is updated.
export const legacyV2Ranking = 'Lead: highest total points on the first Hacker News page, with a tied incumbent retained. Other placements: 60% points, 25% comments, 15% HN rank across three pages; topic desks and a discussion row use distinct stories.';
