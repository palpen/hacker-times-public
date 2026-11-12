import type {Edition} from './news';
import {validateLeadState,verifyLeadState,readLeadBoundary,validatePublicationBoundary,type LeadState,type LeadPlan,type LeadBoundary} from './lead-state';
import {renderEdition} from './render-edition';
import {editionAssets} from './edition-assets';
import {withSubmissionAges} from './submission-age-document';
import {withFooterTimestamp} from './footer-timestamp';
import bundledEdition from '../data/published-seed.json';
import bundledHTML from '../data/prebuilt.html?raw';
import bundledVersion from '../data/prebuilt-version.json';
export const PUBLICATION_KEY='publication/current.json';
const BACKUP_KEY='publication/last-valid.json';const TTL=30_000;
export type DocumentRecord={version:string;edition:Edition;html:string};
export type Publication={schema:1;current:DocumentRecord;previous?:string;archives:Record<string,string>;editorialSafetyStop?:{kind:unknown;generatedAt:string;storyId?:unknown;recordedAt:string};leadState?:LeadState;leadBoundary?:LeadBoundary};
const fallback:Publication={schema:1,current:{version:bundledVersion.version,edition:bundledEdition as Edition,html:bundledHTML},archives:{}};
let memory:{value:Publication;until:number}|undefined;
function valid(p:unknown):p is Publication{const v=p as Publication;return !!v&&v.schema===1&&typeof v.current?.version==='string'&&v.current.version.length<150&&typeof v.current.html==='string'&&v.current.html.startsWith('<!doctype html>')&&v.current.html.includes(`content="${v.current.version}"`)&&Array.isArray(v.current.edition?.stories)&&v.current.edition.stories.length>0&&Number.isFinite(Date.parse(v.current.edition.generatedAt))&&typeof v.archives==='object';}
function cacheKey(request:Request){return new Request(new URL('/__private_publication_cache/v1',request.url).href);}
function edge(){try{return typeof caches!=='undefined'?(caches as CacheStorage&{default:Cache}).default:undefined;}catch{return undefined;}}
async function cachePublication(request:Request,p:Publication,verify=false){try{const c=edge();if(!c)return false;await c.put(cacheKey(request),new Response(JSON.stringify({until:Date.now()+TTL,value:p}),{headers:{'Content-Type':'application/json','Cache-Control':'public,max-age=30'}}));if(!verify)return true;const result=await c.match(cacheKey(request));const check=result?await result.json() as {value:Publication}:null;return check?.value.current.version===p.current.version;}catch{return false;}}
export async function readPublication(request:Request,env:Cloudflare.Env,fresh=false):Promise<{publication:Publication;source:string}>{
 if(!fresh&&memory&&memory.until>Date.now())return {publication:memory.value,source:'memory'};
 if(!fresh)try{const found=await edge()?.match(cacheKey(request));if(found){const e=await found.json() as {until:number;value:Publication};if(e.until>Date.now()&&valid(e.value)){memory={value:e.value,until:e.until};return {publication:e.value,source:'edge'};}}}catch{}
 try{const object=await env.BUCKET?.get(PUBLICATION_KEY);if(object){const p=await object.json<Publication>();if(!valid(p))throw Error('Invalid publication');memory={value:p,until:Date.now()+TTL};await cachePublication(request,p);return {publication:p,source:'storage'};}}catch{}
 // An unavailable/corrupt current object must not turn a good edition into a blank page.
 if(memory)return {publication:memory.value,source:'last-valid-memory'};
 try{const backup=await env.BUCKET?.get(BACKUP_KEY);if(backup){const p=await backup.json<Publication>();if(valid(p)){memory={value:p,until:Date.now()+TTL};return {publication:p,source:'last-valid-storage'};}}}catch{}
 return {publication:fallback,source:'bundled-fallback'};
}
// Writers never use the reader's availability fallbacks: a damaged root cannot
// reset retirements or promote a stale backup to authority.
export async function readPublicationForWrite(env:Cloudflare.Env):Promise<Publication>{
 if(!env.BUCKET)throw Error('Persistent storage unavailable');
 const object=await env.BUCKET.get(PUBLICATION_KEY);if(!object)throw Error('Current publication is missing; restore the verified publication before fetching candidates.');
 const publication=await object.json<Publication>();if(!valid(publication))throw Error('Current publication invalid; refusing to overwrite it.');
 const boundary=await readLeadBoundary(env.BUCKET);validatePublicationBoundary(publication,boundary);
 if(publication.leadState){if(!boundary)throw Error('Lead activation boundary is missing; restore required state.');await verifyLeadState(env.BUCKET,publication.leadState,publication.current.edition);}
 else if(boundary&&boundary.basePublicationVersion!==publication.current.version)throw Error('Lead policy state is missing after activation; restore required state.');
 return publication;
}
export async function currentEdition(request:Request,env:Cloudflare.Env):Promise<Edition>{
 const result=await readPublication(request,env,true);if(result.source!=='bundled-fallback')return result.publication.current.edition;
 const legacy=await env.BUCKET?.get('edition.json');return legacy?await legacy.json<Edition>():fallback.current.edition;
}
export async function publishEdition(request:Request,env:Cloudflare.Env,edition:Edition,expectedBaseVersion?:string,leadPlan?:LeadPlan){
 if(!env.BUCKET)throw Error('Persistent storage unavailable');
 edition={...edition};delete edition.persisted;
 const oldObject=await env.BUCKET.get(PUBLICATION_KEY);const old=oldObject?await oldObject.json<Publication>():undefined;
 if(old&&!valid(old))throw Error('Current publication invalid; refusing to overwrite it.');
 if(old?.editorialSafetyStop)throw Error('Publication is stopped for safety review; no alternate publication or rebuild is permitted.');
 const boundary=await readLeadBoundary(env.BUCKET);
 if(boundary&&!old)throw Error('Current publication is missing after lead activation; restore required state.');
 if(old)validatePublicationBoundary(old,boundary);
 if(old?.leadState){if(!boundary)throw Error('Lead activation boundary is missing; restore required state.');await verifyLeadState(env.BUCKET,old.leadState,old.current.edition);}
 if(boundary&&!old?.leadState&&boundary.basePublicationVersion!==old?.current.version)throw Error('Lead policy state is missing after activation; restore required state.');
 if((boundary||old?.leadBoundary)&&!leadPlan&&!old?.leadState)throw Error('Legacy draft is superseded by balanced lead activation; fetch candidates again.');
 const leadState=leadPlan?.nextState??old?.leadState;
 if(leadPlan){
  if(!old||!boundary||expectedBaseVersion!==leadPlan.basePublicationVersion)throw Error('Invalid pinned lead publication base.');
  validateLeadState(leadPlan.baseState);validateLeadState(leadPlan.nextState);
  if(leadPlan.baseRevision!==(leadPlan.baseState.revision)||leadPlan.nextState.revision!==leadPlan.baseRevision+1)throw Error('Invalid lead state revision.');
  await verifyLeadState(env.BUCKET,leadPlan.nextState,edition);
 }else if(old?.leadState){
  const canonical={...old.current.edition};delete canonical.persisted;
  if(JSON.stringify(edition)!==JSON.stringify(canonical))throw Error('Active lead policy requires a fresh pinned plan; fetch candidates again.');
 }
 
 if(old&&Date.parse(edition.generatedAt)<Date.parse(old.current.edition.generatedAt))throw Error('A newer edition is already published.');
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(edition)+(leadState?JSON.stringify(leadState):'')+renderEdition(edition,'content-version-placeholder')+JSON.stringify(editionAssets)));
 const version='e-'+Array.from(new Uint8Array(digest)).map(n=>n.toString(16).padStart(2,'0')).join('').slice(0,24);
 if(old?.current.version===version){memory={value:old,until:Date.now()+TTL};return {version,unchanged:true,edgeCacheVerified:await cachePublication(request,old,true)};}
 if(expectedBaseVersion&&expectedBaseVersion!==(old?.current.version||fallback.current.version))throw Error('Publication changed since this draft was prepared; fetch candidates again.');
 if(leadPlan&&old?.leadState&&JSON.stringify(old.leadState)!==JSON.stringify(leadPlan.baseState))throw Error('Lead state changed since this draft was prepared; fetch candidates again.');
 if(leadPlan&&!old?.leadState&&leadPlan.baseRevision!==0)throw Error('Invalid initial lead state revision.');
 const current:DocumentRecord={version,edition:{...edition,persisted:true},html:renderEdition(edition,version)};
 const archives={...(old?.archives||{}),[edition.editionDate||edition.generatedAt.slice(0,10)]:version};
 const trimmed=Object.fromEntries(Object.entries(archives).sort(([a],[b])=>b.localeCompare(a)).slice(0,31));
 const publication:Publication={schema:1,current,previous:old?.current.version,archives:trimmed,...(leadState?{leadState}:{}),...(old?.leadBoundary?{leadBoundary:old.leadBoundary}:{})};
 // All immutable data is complete before the single conditional publication commit.
 await env.BUCKET.put('publication/versions/'+version+'.json',JSON.stringify(current),{httpMetadata:{contentType:'application/json'}});
 if(old)await env.BUCKET.put(BACKUP_KEY,JSON.stringify(old),{httpMetadata:{contentType:'application/json'}});
 const committed=await env.BUCKET.put(PUBLICATION_KEY,JSON.stringify(publication),{onlyIf:oldObject?{etagMatches:oldObject.etag}:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}});
 if(!committed)throw Error('Publication changed concurrently; reread before retrying.');
 memory={value:publication,until:Date.now()+TTL};const edgeCacheVerified=await cachePublication(request,publication,true);
 return {version,unchanged:false,edgeCacheVerified};
}
export async function readArchive(request:Request,env:Cloudflare.Env,date:string):Promise<DocumentRecord|null>{
 const {publication}=await readPublication(request,env,true);const version=publication.archives[date];
 if(version===publication.current.version)return publication.current;
 if(version){const object=await env.BUCKET?.get('publication/versions/'+version+'.json');if(object)return object.json<DocumentRecord>();}
 const legacy=await env.BUCKET?.get('editions/'+date+'.json');if(!legacy)return null;const edition=await legacy.json<Edition>();return {version:'legacy-'+date,edition,html:renderEdition(edition,'legacy-'+date)};
}
export async function archiveDates(request:Request,env:Cloudflare.Env){const {publication}=await readPublication(request,env);const legacy=await env.BUCKET?.list({prefix:'editions/',limit:1000});return [...new Set([...Object.keys(publication.archives),...(legacy?.objects||[]).map(o=>o.key.slice(9,-5))])].filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse().slice(0,31);}
export async function documentResponse(request:Request,env:Cloudflare.Env):Promise<Response|null>{
 const url=new URL(request.url);if(url.pathname!=='/')return null;if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
 const start=performance.now();let record:DocumentRecord;let source:string;const date=url.searchParams.get('date');
 if(date){if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return new Response('Invalid date',{status:400,headers:{'Cache-Control':'private,no-store'}});const archived=await readArchive(request,env,date);if(!archived)return new Response('Edition not found',{status:404,headers:{'Cache-Control':'private,no-store'}});record=archived;source='archive';}
 else {const result=await readPublication(request,env,url.searchParams.get('refresh')==='1');record=result.publication.current;source=result.source;}
 return new Response(request.method==='HEAD'?null:withFooterTimestamp(withSubmissionAges(record.html,record.edition)),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Edition-Version':record.version,'X-Edition-Cache':source,'Server-Timing':`edition;dur=${Math.max(0,performance.now()-start).toFixed(2)};desc="document lookup, not network or browser paint"`}});
}
export function resetPublicationMemoryForTest(){memory=undefined;}
