import {article,publicFetchUrl} from '../reporting';
import {boundedBody} from '../security';
import {digest} from '../production/storage';
import type {Article,Evidence} from './types';

// Full extracted text or an explicit failure. Never silently shorten evidence.
export async function collectEvidence(story:Article):Promise<Evidence> {
 if(!publicFetchUrl(story.url))throw Error('Source URL unavailable');
 const result=await article(story.url,{fullText:true});
 if(result.articleStatus!=='fetched'||!result.excerpt.trim())throw Error('Complete source unavailable');
 return {id:String(story.id),url:story.url,title:story.title,publisher:('publisher' in result&&result.publisher)||new URL(story.url).hostname,
  submittedAt:new Date(story.time*1000).toISOString(),articlePublishedAt:result.articlePublishedAt??null,retrievedAt:new Date().toISOString(),text:result.excerpt,hash:await digest(result.excerpt)};
}

// Discovery is deliberately bounded. Dates and URLs must be corroborated by
// official HN metadata before an article becomes model evidence.
export async function discoverFollowup(terms:string[],since:string):Promise<Article|null> {
 const query=terms.slice(0,3).join(' ');if(!query)return null;
 const url=new URL('https://hn.algolia.com/api/v1/search_by_date');
 url.searchParams.set('query',query);url.searchParams.set('tags','story');url.searchParams.set('hitsPerPage','5');
 url.searchParams.set('numericFilters','created_at_i>'+Math.floor(Date.parse(since)/1000));
 const r=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(12_000)});
 if(!r.ok)throw Error('Discovery unavailable');
 const data=JSON.parse(await boundedBody(r,100_000));if(!Array.isArray(data.hits))throw Error('Invalid discovery');
 for(const hit of data.hits){
  const id=Number(hit.objectID);if(!Number.isSafeInteger(id)||id<=0)continue;
  const itemResponse=await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`,{redirect:'manual',signal:AbortSignal.timeout(12_000)});
  if(!itemResponse.ok)throw Error('Discovery verification unavailable');
  const item=JSON.parse(await boundedBody(itemResponse,200_000));
  if(item.id===id&&item.type==='story'&&!item.dead&&!item.deleted&&typeof item.title==='string'&&typeof item.url==='string'&&publicFetchUrl(item.url)&&Number.isSafeInteger(item.time)&&item.time*1000>Date.parse(since)&&item.time*1000<=Date.now())
   return {id,title:item.title,url:item.url,time:item.time,score:Number(item.score)||0};
 }
 return null;
}
