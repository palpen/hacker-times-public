import {Parser} from 'htmlparser2';
import {normalizeArticleUrl} from '../lead-retirement';
import {publicFetchUrl} from '../reporting';
import {boundedBody} from '../security';

const feeds:Record<string,string>={
  'openai.com':'https://openai.com/news/rss.xml',
  'theatlantic.com':'https://www.theatlantic.com/feed/all/',
  'ft.com':'https://www.ft.com/technology?format=rss',
  'scmp.com':'https://www.scmp.com/rss/36/feed/',
  'wsj.com':'https://feeds.content.dowjones.io/public/rss/RSSWSJD',
};
export function publisherFeedUrl(article:string,declared?:string):string|undefined {
  const url=new URL(article),host=url.hostname.replace(/^www\./,'');
  if(declared){
    try{
      const feed=new URL(declared,url);
      if(feed.protocol==='https:'&&feed.origin===url.origin&&publicFetchUrl(feed.href))return feed.href;
    }catch{/* Try the publisher's known feed. */}
  }
  if(host==='nytimes.com'){
    const section=url.pathname.split('/')[4];
    const desk=({upshot:'Upshot',technology:'Technology',business:'Business',world:'World',us:'US'} as Record<string,string>)[section];
    if(desk)return 'https://rss.nytimes.com/services/xml/rss/nyt/'+desk+'.xml';
  }
  return feeds[host];
}

function articleKey(value:string):string {
  try{
    const url=new URL(value),host=url.hostname.replace(/^www\./,'');
    if(url.pathname==='/'||url.hash.startsWith('#/')||url.hash.startsWith('#!'))return '';
    if(host==='wsj.com')url.searchParams.delete('mod');
    if(host==='ft.com')for(const key of Array.from(url.searchParams.keys()))if(/^syn-[a-z0-9]+$/i.test(key))url.searchParams.delete(key);
    return normalizeArticleUrl(url.href);
  }catch{return '';}
}
function plainText(html:string):string {
  let text='',skip=0;
  const parser=new Parser({
    onopentag(tag){if(tag==='script'||tag==='style')skip++;if(!skip&&['p','div','br','li'].includes(tag))text+=' ';},
    onclosetag(tag){if(tag==='script'||tag==='style')skip--;},
    ontext(value){if(!skip)text+=value;},
  });
  parser.end(html.slice(0,12_000));
  return text.replace(/\s+/g,' ').trim();
}
type FeedItem={key:string; text:string; time:number};
export function readPublisherFeed(xml:string):FeedItem[] {
  const items:FeedItem[]=[],stack:string[]=[];
  let fields:Record<string,string>|undefined,depth=0,count=0,atom=false;
  const names=new Set(['title','link','summary','description','content','content:encoded','updated','published','pubDate','dc:date']);
  const parser=new Parser({
    onopentag(name,attrs){
      stack.push(name);
      if(stack.length===1){
        atom=name==='feed';
        if(!atom&&name!=='rss'&&name!=='rdf:RDF')parser.pause();
      }
      const parent=stack.at(-2);
      if(!fields&&(atom?name==='entry'&&parent==='feed':name==='item'&&(parent==='channel'||parent==='rdf:RDF'))){
        fields={};depth=stack.length;
      }else if(fields&&stack.length===depth+1&&atom&&name==='link'&&(!attrs.rel||attrs.rel==='alternate')&&attrs.href){
        fields.link??=attrs.href;
      }
    },
    ontext(value){
      if(!fields)return;
      const name=stack[depth];
      if(!names.has(name))return;
      fields[name]=(fields[name]||'')+value.slice(0,Math.max(0,12000-(fields[name]?.length??0)));
    },
    onclosetag(){
      if(fields&&stack.length===depth){
        const key=articleKey(fields.link?.trim()||'');
        const text=plainText(fields.summary||fields.description||fields.content||fields['content:encoded']||'').slice(0,700);
        const boilerplate=/^(?:sign in|log in|subscribe (?:now|to (?:read|continue))|access denied|enable javascript)\b/i.test(text);
        const dates=[fields.updated,fields.published,fields.pubDate,fields['dc:date']].filter(Boolean).map(Date.parse);
        if(key&&!boilerplate&&text.length>=40&&text.toLowerCase()!==plainText(fields.title||'').toLowerCase()&&dates.length&&dates.every(Number.isFinite)){
          items.push({key,text,time:Math.max(...dates)});
        }
        fields=undefined;
        if(++count>=160)parser.pause();
      }
      stack.pop();
    },
  },{xmlMode:true});
  parser.end(xml);
  return items;
}
export function matchPublisherFeed(items:FeedItem[],article:string,at:string):string|undefined {
  const key=articleKey(article),cutoff=Date.parse(at);
  const matches=items.filter(item=>item.key===key&&item.time<=cutoff);
  if(!matches.length||matches.some(item=>item.text!==matches[0].text))return;
  return matches[0].text;
}
// Per-isolate cache holds compact parsed entries and short-lived misses. Requests
// have fixed per-feed byte/time bounds and never follow redirects to another origin.
const cache=new Map<string,{until:number; items:Promise<FeedItem[]>}>();
async function loadFeed(url:string):Promise<FeedItem[]> {
  try{
    let target=url;
    for(let redirects=0;redirects<=1;redirects++){
      const response=await fetch(target,{redirect:'manual',signal:AbortSignal.timeout(4500),headers:{accept:'application/rss+xml,application/atom+xml,application/xml,text/xml'}});
      if(response.ok)return readPublisherFeed(await boundedBody(response,1_600_000,4500));
      void response.body?.cancel().catch(()=>{});
      const next=response.headers.get('location');
      if(response.status<300||response.status>=400||!next)break;
      const location=new URL(next,target);
      if(location.origin!==new URL(url).origin||!publicFetchUrl(location.href))break;
      target=location.href;
    }
  }catch{/* An optional feed failure leaves the original source status intact. */}
  return [];
}
export async function recoverFromFeed(article:string,at:string,declared?:string){
  const feedUrl=publisherFeedUrl(article,declared);
  if(!feedUrl)return;
  let hit=cache.get(feedUrl);
  if(!hit||hit.until<=Date.now()){
    cache.delete(feedUrl);
    if(cache.size>=12)cache.delete(cache.keys().next().value!);
    hit={until:Date.now()+5*60_000,items:loadFeed(feedUrl)};
    cache.set(feedUrl,hit);
  }
  const description=matchPublisherFeed(await hit.items,article,at);
  if(description)return {feedUrl,description};
}
