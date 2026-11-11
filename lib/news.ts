import {normalizeArticleUrl} from './lead-retirement';
import {categories,legacyV2Ranking,type Story,type Edition,type SourceSnapshot} from './contracts';
import {layoutCapacity,layoutContract} from './layout';
import {rankByPoints,ranking,isRecentSectionStory,qualifiesForTodayPreview} from './policy';
// Compatibility exports keep existing callers stable while policy has one home.
export * from './contracts';
export {rankByPoints,ranking,classifyTopic,selectStories} from './policy';
export function sourceSnapshotKey(timestamp:string){return 'source-snapshots/'+new Date(timestamp).toISOString()+'.json';}
export function publicUrl(value: unknown):value is string {
 if(typeof value!=='string'||value.length>2500||value.trim()!==value||/[\x00-\x20\x7f\\]/.test(value))return false;
 try{const u=new URL(value),h=u.hostname.toLowerCase();return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&(!u.port||['80','443'].includes(u.port))&&h.length<=253&&h.includes('.')&&!/^[\d.]+$/.test(h)&&h.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))&&!/(^|\.)(localhost|local|internal|test|invalid|lan|home|corp|localdomain|onion|arpa|svc)$/.test(h);}catch{return false;}
}
export function validateEdition(input:unknown,previous?:Edition,snapshot?:SourceSnapshot,independentLeadVerified=false):Edition{
 const d=input as Edition;
 const contract=layoutContract(snapshot?.layoutVersion??1),capacity=contract.capacity;
 if(!d||typeof d!=='object'||Array.isArray(d)||!Array.isArray(d.stories)||d.stories.length<1||d.stories.length>capacity.total)throw Error('Expected 1–'+capacity.total+' editorial stories.');
 if(typeof d.generatedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(d.generatedAt))throw Error('Expected an exact ISO source timestamp.');
 const stamp=Date.parse(d.generatedAt);if(!Number.isFinite(stamp)||new Date(stamp).toISOString()!==d.generatedAt||stamp>Date.now()+300000||stamp<Date.now()-48*3600000)throw Error('Edition must carry a recent valid source timestamp.');
 if(snapshot?.summaryPolicyVersion!==undefined&&snapshot.summaryPolicyVersion!==1)throw Error('Unsupported summary policy.');
 const ids=new Set<number>();let stories:Story[]=d.stories.map(s=>{
  if(!s||typeof s!=='object'||!Number.isSafeInteger(s.id)||s.id<=0||ids.has(s.id)||!publicUrl(s.url))throw Error('Invalid or duplicate story.');ids.add(s.id);
  for(const key of ['title','headline','summary','publisher','category'] as const)if(typeof s[key]!=='string'||s[key].length>(key==='summary'?900:240))throw Error('Invalid story text.');
  if(!s.headline.trim()||!s.publisher.trim()||!Number.isSafeInteger(s.score)||!Number.isSafeInteger(s.comments)||!Number.isSafeInteger(s.time)||s.score<0||s.comments<0||s.time<=0||s.time*1000>stamp+300000)throw Error('Invalid score or submission time.');
  const source=s.summarySource,short=s.shortSummary;
  if(source!==undefined&&!['article','page_description','hn_post','unavailable'].includes(source))throw Error('Invalid summary source.');
  if(short!==undefined&&source===undefined)throw Error('Short summary requires an explicit source.');
  if(short!==undefined&&(typeof short!=='string'||short.length>280))throw Error('Invalid short summary.');
  if(snapshot?.summaryPolicyVersion===1&&(source===undefined||short===undefined))throw Error('Summary policy requires source and short summary.');
  if(source==='unavailable'&&(s.summary!==''||short!==''))throw Error('Unavailable summaries must be empty.');
  if(source!==undefined&&source!=='unavailable'&&(!s.summary.trim()||typeof short!=='string'||!short.trim()))throw Error('Available summaries require source-backed full and short copy.');
  if(s.image&&!publicUrl(s.image))throw Error('Invalid image URL.');
  if(s.image!==undefined&&s.image!==null&&typeof s.image!=='string')throw Error('Invalid image URL.');
  for(const key of ['imageAlt','imageCredit','articleStatus'] as const)if(s[key]!==undefined&&typeof s[key]!=='string')throw Error('Invalid image or source metadata.');
  return {id:s.id,title:s.title,headline:s.headline,summary:s.summary,...(source!==undefined?{summarySource:source}:{}),...(short!==undefined?{shortSummary:short}:{}),url:s.url,publisher:s.publisher,score:s.score,comments:s.comments,time:s.time,category:s.category,image:s.image||null,imageAlt:String(s.imageAlt||'').slice(0,400),imageCredit:String(s.imageCredit||'').slice(0,240),articleStatus:String(s.articleStatus||'').slice(0,180)};
 });
 if(snapshot){
  if((snapshot.schemaVersion!==undefined&&snapshot.schemaVersion!==1)||(!snapshot.schemaVersion&&snapshot.algorithmVersion!==2)||Date.parse(snapshot.generatedAt)!==stamp)throw Error('Edition does not match a current expanded source snapshot.');
  // Both current and legacy v2 snapshots already contain their authoritative plan.
  // Never rerun today's policy over an in-flight draft.
  const expected=snapshot.selectedStories;
  if(!Array.isArray(expected)||!expected.length||expected.length>capacity.total||new Set(expected.map(s=>s.id)).size!==expected.length)throw Error('Invalid pinned selection.');
  if(snapshot.schemaVersion===1&&(!((snapshot.selectionVersion===1&&snapshot.layoutVersion===1)||(snapshot.selectionVersion===2&&snapshot.layoutVersion===2)||([3,4,5,6].includes(snapshot.selectionVersion??0)&&((snapshot.selectionVersion===3&&[1,2].includes(snapshot.layoutVersion??0))||([4,5,6].includes(snapshot.selectionVersion??0)&&snapshot.layoutVersion===3))&&['hn-balanced-lead-v1','hn-balanced-lead-v2'].includes(snapshot.leadPolicyVersion??'')&&(snapshot.leadPlan||independentLeadVerified)))||!snapshot.policyVersion||!snapshot.basePublicationVersion))throw Error('Unsupported selection contract.');
  if(expected[0].placement!=='lead'||expected.filter(s=>s.placement==='lead').length!==1||!snapshot.frontPageIds.includes(expected[0].id)||expected.filter(s=>s.placement==='top').length>capacity.top||expected.some(s=>!['lead','top','discussion','section',...(snapshot.layoutVersion===3?['section-only']:[])].includes(s.placement||'')||!contract.categories.some(c=>c===s.category)))throw Error('Selection does not fit its saved reader layout.');
  if(snapshot.selectionVersion===2||([3,4,5,6].includes(snapshot.selectionVersion??0)&&[2,3].includes(snapshot.layoutVersion??0))){
   const start=Date.parse(snapshot.windowStart||''),end=Date.parse(snapshot.windowEnd||'');
   if(snapshot.sourceMode!=='hn-month-sample'||end!==stamp||start!==end-30*86_400_000||snapshot.algorithmVersion!==3||!snapshot.discovery||snapshot.discovery.coverage!=='sampled')throw Error('Invalid monthly source provenance.');
   if(expected.slice(1).some(s=>s.time*1000<start||s.time*1000>=end))throw Error('Secondary story outside the pinned month.');
  }
  if([4,5,6].includes(snapshot.selectionVersion??0)&&(expected.filter(s=>s.placement!=='section-only').length>42||expected.filter(s=>s.placement==='discussion').length>6||categories.some(c=>expected.filter(s=>s.category===c).length>16||expected.filter(s=>s.category===c&&s.placement==='section').length>4)||new Set(expected.map(s=>normalizeArticleUrl(s.url))).size!==expected.length))throw Error('Invalid independent section plan');
  if(snapshot.selectionVersion===5||snapshot.selectionVersion===6){
   if(snapshot.freshnessPolicyVersion!==1||snapshot.policyVersion!==(snapshot.selectionVersion===6?'hn-month-unified-sections-v6':'hn-month-fresh-sections-v5'))throw Error('Invalid freshness policy contract');
   const currentIds=new Set(snapshot.sourcePages.flatMap(p=>p.ids));
   if(expected.slice(1).some(s=>s.placement!=='section-only'&&!isRecentSectionStory(s,stamp)))throw Error('Stale Today placement');
   if(expected.some(s=>['section','discussion'].includes(s.placement||'')&&!qualifiesForTodayPreview(s,currentIds)))throw Error('Unqualified Today preview');
   if(expected.some(s=>s.placement==='top'&&!snapshot.frontPageIds.includes(s.id)))throw Error('Top story outside current first page');
  }else if(snapshot.freshnessPolicyVersion!==undefined)throw Error('Unexpected freshness policy');
  const sources=new Map(snapshot.rankedStories.map(s=>[s.id,s]));
  for(const selected of expected){const source=sources.get(selected.id);if(!source||['title','url','score','comments','time','hnRank','hnPage','category'].some(key=>selected[key as keyof typeof selected]!==source[key as keyof typeof source]))throw Error('Selection does not match source snapshot.');}
  if(expected.length!==stories.length)throw Error('Submit every selected story exactly once.');
  const byId=new Map(stories.map(s=>[s.id,s]));
  stories=expected.map(source=>{const actual=byId.get(source.id);if(!actual||actual.score!==source.score||actual.comments!==source.comments||actual.time!==source.time||(snapshot.leadPolicyVersion!==undefined&&actual.url!==source.url))throw Error('Stories must match the authoritative expanded snapshot.');return {...actual,title:source.title,category:source.category,...(source.topics?{topics:source.topics}:{}),...(source.discoverySource?{discoverySource:source.discoverySource}:{}),hnRank:source.hnRank,hnPage:source.hnPage,editorialScore:source.editorialScore,placement:source.placement};});
 }else stories=rankByPoints(stories,previous?.stories[0]?.id); // Legacy saved editions remain readable; the writer always supplies a snapshot.
 for(const s of stories)if(s.summarySource==='unavailable'&&s.headline!==s.title)throw Error('Unavailable story must use its original HN title.');
 if(previous?.stories[0]?.id===stories[0]?.id){
  if(stories[0].summarySource==='unavailable'&&previous.stories[0].headline!==stories[0].title)throw Error('Unavailable incumbent conflicts with preserved headline; reuse accurate verified copy or stop for review.');
  stories[0].headline=previous.stories[0].headline;
 }
 return {schemaVersion:1,...(snapshot?.freshnessPolicyVersion?{freshnessPolicyVersion:snapshot.freshnessPolicyVersion}:{}),...(snapshot?.selectionVersion?{selectionVersion:snapshot.selectionVersion}:{}),...(snapshot?.summaryPolicyVersion?{summaryPolicyVersion:snapshot.summaryPolicyVersion}:{}),...(snapshot?.leadPolicyVersion?{leadPolicyVersion:snapshot.leadPolicyVersion}:{}),layoutVersion:snapshot?snapshot.layoutVersion??1:undefined,policyVersion:snapshot?.policyVersion||(snapshot?'hn-balanced-v2':undefined),policyConfig:snapshot?.policyConfig,generatedAt:d.generatedAt,frontPageIds:snapshot?.frontPageIds||d.frontPageIds,frontPageUrl:'https://news.ycombinator.com/',sourcePages:snapshot?.sourcePages,...(snapshot?.windowStart?{windowStart:snapshot.windowStart,windowEnd:snapshot.windowEnd,discovery:snapshot.discovery}:{}),algorithmVersion:snapshot?.algorithmVersion,sourceMode:snapshot?.sourceMode||(snapshot?'hn-multi-page':'hn-front-page'),editionDate:new Date(stamp).toISOString().slice(0,10),candidateCount:snapshot?.candidateCount??(Number.isFinite(d.candidateCount)?d.candidateCount:stories.length),fetchedCount:snapshot?.fetchedCount??d.fetchedCount,ranking:snapshot?.ranking||(snapshot?legacyV2Ranking:ranking),stories};
}
