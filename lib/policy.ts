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
export function selectMonthlyStories(pool:Candidate[],frontIds:number[],incumbentId:number|undefined,at:number,selectedLeadId?:number):Candidate[]{
 if(!Number.isFinite(at)||new Set(pool.map(s=>s.id)).size!==pool.length)throw Error('Invalid monthly candidate pool');
 const front=new Set(frontIds),first=pool.filter(s=>front.has(s.id)).sort((a,b)=>frontIds.indexOf(a.id)-frontIds.indexOf(b.id));
 const lead=selectedLeadId!==undefined?first.find(s=>s.id===selectedLeadId):rankByPoints(first,incumbentId)[0];if(!lead)throw Error('No eligible front-page lead; keep the previous edition.');
 const cutoff=at-monthPolicyConfig.windowDays*86_400_000;
 const eligible=pool.filter(s=>s.id===lead.id||(s.time*1000>=cutoff&&s.time*1000<at));
 const maxPoints=Math.max(1,...eligible.map(s=>s.score)),maxComments=Math.max(1,...eligible.map(s=>s.comments));
 const ordered=eligible.map(s=>({...s,editorialScore:monthScore(s,maxPoints,maxComments,at)})).sort((a,b)=>b.editorialScore-a.editorialScore||b.time-a.time||a.id-b.id);
 const selected:Candidate[]=[],used=new Set<number>();
 const take=(s:Candidate,placement:Placement)=>{if(!used.has(s.id)&&selected.length<monthPolicyConfig.maxStories){used.add(s.id);selected.push({...s,placement});}};
 take(ordered.find(s=>s.id===lead.id)!,'lead');
 // Actual sampled page order is authoritative, not historical popularity or optional metadata.
 const frontOrder=new Map(frontIds.map((id,index)=>[id,index]));
 const topScore=(s:Candidate)=>frontPageScore(s,frontOrder.get(s.id)!+1,frontIds.length,at);
 const top=ordered.filter(s=>!used.has(s.id)&&front.has(s.id)).sort((a,b)=>topScore(b)-topScore(a)||frontOrder.get(a.id)!-frontOrder.get(b.id)!||a.id-b.id);
 for(const s of top.slice(0,monthPolicyConfig.topCount))take(s,'top');
 const discussion=ordered.filter(s=>!used.has(s.id)&&s.comments>0).sort((a,b)=>monthScore(b,maxPoints,maxComments,at,true)-monthScore(a,maxPoints,maxComments,at,true)||b.editorialScore-a.editorialScore||b.time-a.time||a.id-b.id);
 for(const s of discussion.slice(0,monthPolicyConfig.discussionCount))take(s,'discussion');
 for(const category of categories)for(const s of ordered.filter(s=>!used.has(s.id)&&s.category===category).slice(0,monthPolicyConfig.perDesk))take(s,'section');
 for(const s of ordered)take(s,'section');
 return selected;
}
