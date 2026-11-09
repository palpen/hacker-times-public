import {normalizeArticleUrl} from './lead-retirement';
import {categories,legacyCategories,type Category,type Placement,type Candidate} from './contracts';
export const policyVersion='hn-balanced-v2';
export const policyConfig={sourcePages:3,weights:{points:60,comments:25,rank:15},topCount:7,discussionCount:6,perDesk:4,maxStories:34} as const;
export const ranking = 'Lead: highest total points on the first Hacker News page, with a tied incumbent retained. Other placements: 60% points, 25% comments, 15% HN rank across three pages; topic desks and a discussion row use distinct stories.';
export function rankByPoints<T extends {id:number;score:number}>(stories:T[],incumbentId?:number):T[]{return [...stories].sort((a,b)=>b.score-a.score||(a.id===incumbentId?-1:b.id===incumbentId?1:0));}
// Topic matching uses only the original HN title and source host, never invented article facts.
// Strong subject phrases precede source-domain hints; unmatched stories enter Technology.
export function classifyTopic(title:string,url:string):Category{
 const t=title.toLowerCase();const host=new URL(url).hostname;
 if(/\b(parliament|scenic routes|restrooms)\b/.test(t))return 'Culture';
 if(/\b(backdoor|cve|use-after-free)\b/.test(t))return 'Software';
 if(/\b(privacy|fingerprint|encrypted|air-gap|leaking secrets|chatgpt accounts|binance hack|surveillance)\b/.test(t))return 'Technology';
 const rules:[Category,RegExp][]=[
  ['Business',/\b(econom(?:y|ic|ist)|financial|revenue|investment|investor|workers|labor|capital|saas|startup|bootstrapp|bank|lawyers|court|lawsuit|antitrust|companies|business|profit|markets?\b|tariff|tax|regulat)/],
  ['Science',/\b(mathematic|math|theorem|proof|physic|einstein|quantum|astronom|telescope|hubble|nasa|mars|martian|geolog|glacier|ice|seeds?|botan|biology|chemical|thermal|researchers|scientists|scientific|brain|platonic|jepa|health|cancer|obesity|fossil|radiation)\w*/],
  ['Culture',/\b(books?|picard|star trek|tv|television|funeral|history|historical|women|she-wolves|poe|writer|novel|music|techno|atkins|leeson|doctor who|film|cinema|graduate|art|museum|map|stone age|civilization|parliament|serbia|portal|f-stop|game)\b/],
  ['Software',/\b(programming|language|javascript|typescript|rust|python|postgres|sql|database|particledb|jepsen|git|difftool|omnidiff|fuzz|afl|code|compiler|kernel|linux|tcp|cve|use-after-free|compression|nibnib|software|webassembly|wasm|debug|api|react|emulator)\b/]
 ];
 for(const [category,pattern] of rules)if(pattern.test(t))return category;
 if(/smithsonian|sciencedaily|sciencenorway|pnas\.org|arxiv\.org|terrytao/.test(host))return 'Science';
 if(/newyorker|historytoday|lareviewofbooks|vox\.com|slate\.com/.test(host))return 'Culture';
 if(/fortune|economist|ft\.com/.test(host))return 'Business';
 if(/github\.com|gist\.github|nullprogram|nolanlawson|tibleiz|jepsen/.test(host))return 'Software';
 return 'Technology';
}
export function selectStories(pool:Candidate[],frontIds:number[],incumbentId?:number,selectedLeadId?:number):Candidate[]{
 const first=new Set(frontIds);const lead=selectedLeadId!==undefined?pool.find(s=>s.id===selectedLeadId&&first.has(s.id)):rankByPoints(pool.filter(s=>first.has(s.id)).sort((a,b)=>(a.hnRank??91)-(b.hnRank??91)),incumbentId)[0];
 if(!lead)throw Error('No eligible front-page lead; keep the previous edition.');
 const maxPoints=Math.max(1,...pool.map(s=>s.score)),maxComments=Math.max(1,...pool.map(s=>s.comments)),lastRank=Math.max(2,...pool.map(s=>s.hnRank??91));
 const ranked=pool.map(s=>({...s,editorialScore:Math.round((policyConfig.weights.points*Math.log1p(s.score)/Math.log1p(maxPoints)+policyConfig.weights.comments*Math.log1p(s.comments)/Math.log1p(maxComments)+policyConfig.weights.rank*(lastRank-(s.hnRank??91))/(lastRank-1))*10000)/10000})).sort((a,b)=>b.editorialScore-a.editorialScore||(a.hnRank??91)-(b.hnRank??91)||a.id-b.id);
 const selected:Candidate[]=[];const used=new Set<number>();
 const take=(s:Candidate,placement:Placement)=>{if(!used.has(s.id)&&selected.length<policyConfig.maxStories){used.add(s.id);selected.push({...s,placement});}};
 take(ranked.find(s=>s.id===lead.id)!,'lead');
 for(const s of ranked.filter(s=>!used.has(s.id)).slice(0,policyConfig.topCount))take(s,'top');
 const discussion=[...ranked].filter(s=>!used.has(s.id)&&s.comments>0).sort((a,b)=>b.comments-a.comments||b.editorialScore-a.editorialScore||(a.hnRank??91)-(b.hnRank??91));
 for(const s of discussion.slice(0,policyConfig.discussionCount))take(s,'discussion');
 for(const category of legacyCategories)for(const s of ranked.filter(s=>!used.has(s.id)&&s.category===category).slice(0,policyConfig.perDesk))take(s,'section');
 for(const s of ranked)if(selected.length<policyConfig.maxStories)take(s,'section');
 return selected;
}


// Opt-in policy: legacy callers and in-flight snapshots keep their original plan.
export const monthPolicyVersion='hn-month-v3.2';
export const monthPolicyConfig={sourcePages:3,windowDays:30,recencyHalfLifeDays:7,weights:{points:60,comments:25,recency:15},discussionWeights:{points:25,comments:60,recency:15},topCount:7,discussionCount:6,perDesk:4,maxStories:42,historyShortlist:164,coverage:'sampled',topEligibility:'current-hn-page-one',topOrder:'hn-rank-and-freshness',topWeights:{rank:70,freshness:30},topFreshnessHalfLifeHours:24} as const;
export const monthRanking='Lead: highest total points on the current first Hacker News page, with a tied incumbent retained. Other top stories (up to seven) must be on the current first HN page and rank by 70% actual HN rank plus 30% freshness (24-hour half-life); shortages are not backfilled. Lower discussion and desk stories come from a bounded sample of the past 30 days: 60% logarithmic points, 25% logarithmic comments and 15% recency (7-day half-life). The conversation swaps the points/comments weights. Topic desks use distinct stories. Search discovery is sampled, not an exhaustive archive.';
export function topicTags(title:string,url:string):Category[]{
 const t=title.toLowerCase();const tags:Category[]=[];
 if(/\b(ai|artificial intelligence|machine learning|deep learning|neural networks?|llms?|language models?|chatgpt|claude|anthropic|openai|mistral|deepseek|qwen|gemini|jepas?|agentic|diffusion models?)\b|\bgpt(?:[- .]?\d[\w.-]*)?\b|\b(?:coding|ai|llm) agents?\b/.test(t))tags.push('AI');
 const game=/\b(games?|gaming|gamedev|minesweeper|tetris|pac-man|chess|puzzles?|wordle|crosswords?|sudoku|playstation|xbox|nintendo|minecraft|doom|quake|steam deck|gameboy|game boy|roguelike)\b/.test(t);
 const figurative=/\b(game theory|game[- ]changer|game[- ]changing|blame game|end game)\b/.test(t);
 if(game&&(!figurative||/\b(minesweeper|tetris|pac-man|chess|puzzles?|wordle|crosswords?|sudoku|playstation|xbox|nintendo|minecraft|doom|quake|gamedev)\b/.test(t)))tags.push('Games');
 return tags;
}
export function classifyTopicV3(title:string,url:string):Category{
 // Do not confuse the uppercase US agency acronym with the scientific ice keyword.
 // Require explicit agency context, preserving natural ice and ambiguous acronyms.
 // This changes only new month plans; legacy and already-pinned plans stay intact.
 const agencyContext=/\bICE(?:['’]s)?\s+(?:immigration|customs|deport(?:ation|ations|ed|s|ing)?|detain(?:ed|s|ing)?|detention|spying|surveillance|raids?)\b/i.test(title)
  ||/\b(?:spying|surveillance)\s+(?:operations?\s+)?(?:by|from)\s+ICE\b/i.test(title)
  ||/\bICE\s+(?:is|was|has been)\s+spying\b/i.test(title);
 const subjectTitle=agencyContext?title.replace(/\bICE\b/g,'immigration enforcement'):title;
 const base=classifyTopic(subjectTitle,url),tags=topicTags(title,url);
 if(tags.includes('Games'))return 'Games';
 if(tags.includes('AI')&&base!=='Business')return 'AI';
 return base;
}
export function monthScore(story:Pick<Candidate,'score'|'comments'|'time'>,maxPoints:number,maxComments:number,at:number,discussion=false){
 const ageDays=Math.max(0,(at-story.time*1000)/86_400_000),recency=2**(-ageDays/monthPolicyConfig.recencyHalfLifeDays);
 const w=discussion?monthPolicyConfig.discussionWeights:monthPolicyConfig.weights;
 return Math.round((w.points*Math.log1p(story.score)/Math.log1p(Math.max(1,maxPoints))+w.comments*Math.log1p(story.comments)/Math.log1p(Math.max(1,maxComments))+w.recency*recency)*10000)/10000;
}
export function frontPageScore(story:Pick<Candidate,'time'>,rank:number,pageSize:number,at:number){
 const rankFraction=pageSize<=1?1:(pageSize-rank)/(pageSize-1);
 const ageHours=Math.max(0,(at-story.time*1000)/3_600_000);
 return monthPolicyConfig.topWeights.rank*rankFraction+monthPolicyConfig.topWeights.freshness*2**(-ageHours/monthPolicyConfig.topFreshnessHalfLifeHours);
}
export function selectMonthlyStories(pool:Candidate[],frontIds:number[],incumbentId:number|undefined,at:number,selectedLeadId?:number,expandSections=false):Candidate[]{
 if(!Number.isFinite(at)||new Set(pool.map(s=>s.id)).size!==pool.length)throw Error('Invalid monthly candidate pool');
 const front=new Set(frontIds),first=pool.filter(s=>front.has(s.id)).sort((a,b)=>frontIds.indexOf(a.id)-frontIds.indexOf(b.id));
 const lead=selectedLeadId!==undefined?first.find(s=>s.id===selectedLeadId):rankByPoints(first,incumbentId)[0];if(!lead)throw Error('No eligible front-page lead; keep the previous edition.');
 const cutoff=at-monthPolicyConfig.windowDays*86_400_000;
 const eligible=pool.filter(s=>s.id===lead.id||(s.time*1000>=cutoff&&s.time*1000<at));
 const maxPoints=Math.max(1,...eligible.map(s=>s.score)),maxComments=Math.max(1,...eligible.map(s=>s.comments));
 const ordered=eligible.map(s=>({...s,editorialScore:monthScore(s,maxPoints,maxComments,at)})).sort((a,b)=>b.editorialScore-a.editorialScore||b.time-a.time||a.id-b.id);
 const selected:Candidate[]=[],used=new Set<number>(),identities=new Set<string>();
 const available=(s:Candidate)=>!used.has(s.id)&&(!expandSections||!identities.has(normalizeArticleUrl(s.url)));
 const take=(s:Candidate,placement:Placement)=>{if(available(s)&&selected.length<(expandSections?sectionPolicyConfig.maxStories:monthPolicyConfig.maxStories)){used.add(s.id);identities.add(normalizeArticleUrl(s.url));selected.push({...s,placement});}};
 take(ordered.find(s=>s.id===lead.id)!,'lead');
 // Actual sampled page order is authoritative, not historical popularity or optional metadata.
 const frontOrder=new Map(frontIds.map((id,index)=>[id,index]));
 const topScore=(s:Candidate)=>frontPageScore(s,frontOrder.get(s.id)!+1,frontIds.length,at);
 const top=ordered.filter(s=>!used.has(s.id)&&front.has(s.id)).sort((a,b)=>topScore(b)-topScore(a)||frontOrder.get(a.id)!-frontOrder.get(b.id)!||a.id-b.id);
 for(const s of top)if(selected.filter(x=>x.placement==='top').length<monthPolicyConfig.topCount)take(s,'top');
 const discussion=ordered.filter(s=>!used.has(s.id)&&s.comments>0).sort((a,b)=>monthScore(b,maxPoints,maxComments,at,true)-monthScore(a,maxPoints,maxComments,at,true)||b.editorialScore-a.editorialScore||b.time-a.time||a.id-b.id);
 for(const s of discussion)if(selected.filter(x=>x.placement==='discussion').length<monthPolicyConfig.discussionCount)take(s,'discussion');
 for(const category of categories)for(const s of ordered.filter(s=>s.category===category))if(selected.filter(x=>x.placement==='section'&&x.category===category).length<monthPolicyConfig.perDesk&&(!expandSections||selected.filter(x=>x.category===category).length<sectionPolicyConfig.sectionCount))take(s,'section');
 if(expandSections){
  // Full section collections have their own allowance, independent of Today.
  // Selection uses primary desks; AI/Games topic views may overlap across desks.
  for(const category of categories)for(const s of ordered.filter(s=>s.category===category))if(selected.filter(x=>x.category===category).length<sectionPolicyConfig.sectionCount)take(s,'section-only');
 }else for(const s of ordered)take(s,'section');
 return selected;
}

// A new pinned contract: old snapshots keep their saved layouts and allocations.
export const sectionPolicyVersion='hn-month-sections-v4';
export const sectionPolicyConfig={...monthPolicyConfig,maxStories:126,todayMaxStories:42,sectionCount:16,sectionCoverage:'independent',deduplication:'normalized-linked-url'} as const;
export const sectionRanking=monthRanking+' Today previews up to four remaining top-ranked stories per desk. Independent section collections include up to 16 eligible articles per primary desk, including featured articles, ranked by the same month score. Additional stories do not enlarge Today. Normalized linked-URL reposts appear only once. Fewer articles are shown when the sample has fewer qualified matches.';
export function classifyTopicV4(title:string,url:string):Category{
 // Specific subject evidence precedes incidental phrases such as “in history”.
 const t=title.toLowerCase();
 if(topicTags(title,url).includes('Games'))return 'Games';
 if(/\b(cyberattacks?|cybersecurity|ransomware)\b/.test(t))return 'Technology';
 if(/\b(linux|kernel|memory allocator|borrow checker)\b/.test(t))return 'Software';
 if(/\b(patrick stewart|actors?|actresses?|obituary)\b/.test(t))return 'Culture';
 if(/\b(hacks?|hacked|stolen|breaches?)\b/.test(t)&&/\b(binance|cryptocurrency|security|network|accounts?|data)\b/.test(t))return 'Technology';
 if(/\b(outsell|outsells|outselling|sales|market share|earnings|ipo|acquisitions?|mergers?|fundraising|layoffs?|bankrupt(?:cy)?|venture capital)\b/.test(t))return 'Business';
 if(/\b(root shell|privilege escalation|remote code execution)\b/.test(t))return 'Software';
 if(/\b(cross-request|kv cache exposure)\b|\bexposes?\b.*\bsecrets\b/.test(t))return 'Technology';
 if(/\bphysical intelligence\b/.test(t))return 'AI';
 if(/\bphysical force\b/.test(t)&&/\b(schools?|teachers?|students?)\b/.test(t))return 'Culture';
 if(/\bphysical world\b/.test(t)&&/\b(program|programming|machines?|robots?)\b/.test(t))return 'Technology';
 if(/\b404(?: not found)?\b/.test(t))return 'Software';
 const technical=/\b(programming|compiler|kernel|database|postgres|javascript|typescript|linux|git|debugging|software|source code|computers?|network stack|norton commander|pipe operator|gridftp|file transfer|vi|vim|just-in-time|jit|pdp[- ]?\d*|operating systems?)\b/.test(t);
 if(technical&&/\b(history|historical|art|novel|game)\b/.test(t)&&!topicTags(title,url).length)return 'Software';
 return classifyTopicV3(title,url);
}

// Version 5 is a new plan, never a reranking of an existing snapshot. A story's
// own official HN submission age and engagement apply, including fresh reposts.
export const freshSectionPolicyVersion='hn-month-fresh-sections-v5';
export const freshSectionPolicyConfig={...sectionPolicyConfig,recencyHalfLifeDays:2,engagementDecayHalfLifeDays:2,weights:{points:60,comments:25},discussionWeights:{points:25,comments:60},freshnessPolicyVersion:1,recentWindowDays:7,preferredAgeDays:3,previewQualification:{points:20,comments:5,currentPageExposure:true},earlierPerDesk:4,sectionOrder:'recent-with-earlier-reserve',repostEngagement:'own-submission-only'} as const;
export const freshSectionRanking='Lead: selected separately by the balanced current-page lead policy. Other top stories remain current-first-page only, with the existing rank/freshness order, and must be younger than seven days. Today desk previews and discussion placements must also be younger than seven days. Their score is logarithmic engagement (60 points / 25 comments; swapped for discussion) multiplied by 2^(-ageDays/2), with no additive freshness bonus. This naturally favors the last 72 hours without a hard 72-hour cutoff. A Today desk preview needs at least 20 official HN points, 5 comments, or actual presence on one of the three sampled current HN pages. This adjustable editorial qualification is not a momentum measurement. Do not fill shortages with weaker or older stories. Independent primary sections retain up to 16 stories, reserving up to four places for qualified sampled stories from 7–30 days and using the rest for recent stories. Unused older capacity returns to recent stories. The default section view shows submissions younger than seven days; 7–30-day selections are separate under Earlier this month. Reposts compete using their own HN submission time and engagement, never transferred or combined counts; one normalized linked URL per edition, with the chosen lead preserved. Permanent lead retirement remains unchanged. Discovery is a bounded sample, not an exhaustive archive.';
export function freshSectionScore(story:Pick<Candidate,'score'|'comments'|'time'>,maxPoints:number,maxComments:number,at:number,discussion=false,halfLifeDays:number=freshSectionPolicyConfig.engagementDecayHalfLifeDays){
 const ageDays=Math.max(0,(at-story.time*1000)/86_400_000),w=discussion?freshSectionPolicyConfig.discussionWeights:freshSectionPolicyConfig.weights;
 const engagement=w.points*Math.log1p(story.score)/Math.log1p(Math.max(1,maxPoints))+w.comments*Math.log1p(story.comments)/Math.log1p(Math.max(1,maxComments));
 return Math.round(engagement*2**(-ageDays/halfLifeDays)*10000)/10000;
}
export function isRecentSectionStory(story:Pick<Candidate,'time'>,at:number){return story.time*1000<at&&story.time*1000>at-freshSectionPolicyConfig.recentWindowDays*86_400_000;}
export function qualifiesForTodayPreview(story:Pick<Candidate,'id'|'score'|'comments'>,currentPageIds:ReadonlySet<number>){return story.score>=freshSectionPolicyConfig.previewQualification.points||story.comments>=freshSectionPolicyConfig.previewQualification.comments||currentPageIds.has(story.id);}
export function selectFreshMonthlyStories(pool:Candidate[],frontIds:number[],incumbentId:number|undefined,at:number,selectedLeadId?:number,currentPageIds:readonly number[]=frontIds):Candidate[]{
 if(!Number.isFinite(at)||new Set(pool.map(s=>s.id)).size!==pool.length)throw Error('Invalid monthly candidate pool');
 const front=new Set(frontIds),first=pool.filter(s=>front.has(s.id)).sort((a,b)=>frontIds.indexOf(a.id)-frontIds.indexOf(b.id));
 const lead=selectedLeadId!==undefined?first.find(s=>s.id===selectedLeadId):rankByPoints(first,incumbentId)[0];
 if(!lead)throw Error('No eligible front-page lead; keep the previous edition.');
 const eligible=pool.filter(s=>s.id===lead.id||(s.time*1000>=at-30*86_400_000&&s.time*1000<at));
 const maxPoints=Math.max(1,...eligible.map(s=>s.score)),maxComments=Math.max(1,...eligible.map(s=>s.comments));
 const compare=(a:Candidate,b:Candidate)=>b.editorialScore-a.editorialScore||b.time-a.time||a.id-b.id;
 const ordered=eligible.map(s=>({...s,editorialScore:freshSectionScore(s,maxPoints,maxComments,at)})).sort(compare);
 const recent=ordered.filter(s=>isRecentSectionStory(s,at)),earlier=ordered.filter(s=>!isRecentSectionStory(s,at)&&s.id!==lead.id),current=new Set(currentPageIds);
 const leadIdentity=normalizeArticleUrl(lead.url);
 // Reserve only distinct identities not represented by a recent submission.
 const recentIdentities=new Set(recent.map(s=>normalizeArticleUrl(s.url)));
 const earlierReserved=new Map(categories.map(category=>{
  const seen=new Set<string>();
  const available=earlier.filter(s=>{const key=normalizeArticleUrl(s.url);if(s.category!==category||key===leadIdentity||recentIdentities.has(key)||seen.has(key))return false;seen.add(key);return true;});
  return [category,available.slice(0,freshSectionPolicyConfig.earlierPerDesk)] as const;
 }));
 const recentLimit=(category:Category)=>freshSectionPolicyConfig.sectionCount-(earlierReserved.get(category)?.length??0);
 const selected:Candidate[]=[],used=new Set<number>(),identities=new Set<string>();
 const take=(s:Candidate,placement:Placement)=>{const identity=normalizeArticleUrl(s.url);if(!used.has(s.id)&&!identities.has(identity)&&selected.length<freshSectionPolicyConfig.maxStories){used.add(s.id);identities.add(identity);selected.push({...s,placement});}};
 take(ordered.find(s=>s.id===lead.id)!,'lead');
 const frontOrder=new Map(frontIds.map((id,index)=>[id,index]));
 const topScore=(s:Candidate)=>frontPageScore(s,frontOrder.get(s.id)!+1,frontIds.length,at);
 for(const s of recent.filter(s=>front.has(s.id)).sort((a,b)=>topScore(b)-topScore(a)||frontOrder.get(a.id)!-frontOrder.get(b.id)!||a.id-b.id))if(selected.filter(x=>x.placement==='top').length<freshSectionPolicyConfig.topCount)take(s,'top');
 for(const category of categories)for(const s of recent.filter(s=>s.category===category&&qualifiesForTodayPreview(s,current)))if(selected.filter(x=>x.placement==='section'&&x.category===category).length<freshSectionPolicyConfig.perDesk&&selected.filter(x=>x.category===category).length<recentLimit(category))take(s,'section');
 for(const s of recent.filter(s=>s.comments>0&&qualifiesForTodayPreview(s,current)).sort((a,b)=>freshSectionScore(b,maxPoints,maxComments,at,true)-freshSectionScore(a,maxPoints,maxComments,at,true)||compare(a,b)))if(selected.filter(x=>x.placement==='discussion').length<freshSectionPolicyConfig.discussionCount&&selected.filter(x=>x.category===s.category).length<recentLimit(s.category))take(s,'discussion');
 // Recent browsing is independent of preview qualification. Older collection
 // capacity is bounded and separate; no old item can backfill Today.
 for(const category of categories){
  for(const s of recent.filter(s=>s.category===category))if(selected.filter(x=>x.category===category).length<recentLimit(category))take(s,'section-only');
  for(const s of earlierReserved.get(category)??[])if(selected.filter(x=>x.category===category).length<freshSectionPolicyConfig.sectionCount)take(s,'section-only');
  for(const s of [...recent,...earlier].filter(s=>s.category===category))if(selected.filter(x=>x.category===category).length<freshSectionPolicyConfig.sectionCount)take(s,'section-only');
 }
 return selected;
}

// Version 6 keeps immutable v5 plans valid, but new sections use one list.
export const unifiedSectionPolicyVersion='hn-month-unified-sections-v6';
export const unifiedSectionPolicyConfig={...freshSectionPolicyConfig,recencyHalfLifeDays:1,engagementDecayHalfLifeDays:1,earlierPerDesk:0,sectionOrder:'unified-recency-weighted',sectionQualification:'preview-threshold'} as const;
export const unifiedSectionRanking='Lead: selected separately by the balanced current-page lead policy. Other top stories remain current-first-page only and younger than seven days. Today desk previews and discussion placements are also younger than seven days. Logarithmic engagement (60 points / 25 comments; swapped for discussion) is multiplied by 2^(-ageDays), a 24-hour half-life with no additive freshness bonus. Independent sections contain up to 16 qualified stories in one ranked list across the sampled 30-day window, with no reserved older slots or seven-day section cutoff. Older stories can stay when their own meaningful engagement overcomes the stronger age penalty. Qualification requires 20 official HN points, 5 comments, or actual sampled current-page presence. Show fewer stories rather than weak filler. Fresh reposts compete using only their own submission age and counts; one normalized linked URL per edition. Permanent lead retirement is unchanged. Discovery is bounded, not exhaustive.';
export function selectUnifiedMonthlyStories(pool:Candidate[],frontIds:number[],incumbentId:number|undefined,at:number,selectedLeadId?:number,currentPageIds:readonly number[]=frontIds):Candidate[]{
 if(!Number.isFinite(at)||new Set(pool.map(s=>s.id)).size!==pool.length)throw Error('Invalid monthly candidate pool');
 const front=new Set(frontIds),first=pool.filter(s=>front.has(s.id)).sort((a,b)=>frontIds.indexOf(a.id)-frontIds.indexOf(b.id));
 const lead=selectedLeadId!==undefined?first.find(s=>s.id===selectedLeadId):rankByPoints(first,incumbentId)[0];
 if(!lead)throw Error('No eligible front-page lead; keep the previous edition.');
 const eligible=pool.filter(s=>s.id===lead.id||(s.time*1000>=at-30*86_400_000&&s.time*1000<at));
 const maxPoints=Math.max(1,...eligible.map(s=>s.score)),maxComments=Math.max(1,...eligible.map(s=>s.comments));
 const compare=(a:Candidate,b:Candidate)=>b.editorialScore-a.editorialScore||b.time-a.time||a.id-b.id;
 const ordered=eligible.map(s=>({...s,editorialScore:freshSectionScore(s,maxPoints,maxComments,at,false,1)})).sort(compare);
 const recent=ordered.filter(s=>isRecentSectionStory(s,at)),current=new Set(currentPageIds);
 const recentLimit=(_category:Category)=>unifiedSectionPolicyConfig.sectionCount;
 const selected:Candidate[]=[],used=new Set<number>(),identities=new Set<string>();
 const take=(s:Candidate,placement:Placement)=>{const identity=normalizeArticleUrl(s.url);if(!used.has(s.id)&&!identities.has(identity)&&selected.length<unifiedSectionPolicyConfig.maxStories){used.add(s.id);identities.add(identity);selected.push({...s,placement});}};
 take(ordered.find(s=>s.id===lead.id)!,'lead');
 const frontOrder=new Map(frontIds.map((id,index)=>[id,index]));
 const topScore=(s:Candidate)=>frontPageScore(s,frontOrder.get(s.id)!+1,frontIds.length,at);
 for(const s of recent.filter(s=>front.has(s.id)).sort((a,b)=>topScore(b)-topScore(a)||frontOrder.get(a.id)!-frontOrder.get(b.id)!||a.id-b.id))if(selected.filter(x=>x.placement==='top').length<unifiedSectionPolicyConfig.topCount)take(s,'top');
 for(const category of categories)for(const s of recent.filter(s=>s.category===category&&qualifiesForTodayPreview(s,current)))if(selected.filter(x=>x.placement==='section'&&x.category===category).length<unifiedSectionPolicyConfig.perDesk&&selected.filter(x=>x.category===category).length<recentLimit(category))take(s,'section');
 for(const s of recent.filter(s=>s.comments>0&&qualifiesForTodayPreview(s,current)).sort((a,b)=>freshSectionScore(b,maxPoints,maxComments,at,true,1)-freshSectionScore(a,maxPoints,maxComments,at,true,1)||compare(a,b)))if(selected.filter(x=>x.placement==='discussion').length<unifiedSectionPolicyConfig.discussionCount&&selected.filter(x=>x.category===s.category).length<recentLimit(s.category))take(s,'discussion');
 // All ages compete for the same bounded collection. No reserved old slots.
 // Outside Today, meaningful engagement is required, rather than weak filler.
 for(const category of categories){
  for(const s of ordered.filter(s=>s.category===category&&qualifiesForTodayPreview(s,current)))if(selected.filter(x=>x.category===category).length<unifiedSectionPolicyConfig.sectionCount)take(s,'section-only');
 }
 return selected;
}
