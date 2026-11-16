// Read only explicit publisher publication metadata. Never substitute modification,
// crawl, HN submission, URL-path or unrelated recommended-article dates.
function decode(value:string){return value.replace(/&quot;/gi,'"').replace(/&apos;|&#39;/gi,"'").replace(/&amp;/gi,'&').replace(/&#(\d+);/g,(_,n)=>Number(n)<=0x10ffff?String.fromCodePoint(Number(n)):'');}
function attr(tag:string,name:string){const m=tag.match(new RegExp('(?:^|\\s)'+name+'\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))','i'));return decode(m?.[1]??m?.[2]??m?.[3]??'');}
export function publicationDate(value:unknown,now=Date.now()):string|null {
 if(typeof value!=='string')return null;const text=value.trim();
 if(!/^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(text))return null;
 const day=text.slice(0,10),dayStamp=Date.parse(day+'T00:00:00Z');
 if(!Number.isFinite(dayStamp)||new Date(dayStamp).toISOString().slice(0,10)!==day)return null;
 const dated=text.length===10||!/(Z|[+-]\d{2}:?\d{2})$/.test(text)?day:text;
 if(dated!==day&&!Number.isFinite(Date.parse(dated)))return null;
 // A date without a timezone describes the publisher's calendar day.
 if(day>new Date(now+14*3600_000).toISOString().slice(0,10)||dated!==day&&Date.parse(dated)>now)return null;
 return dated;
}
export function extractPublicationDate(html:string,pageUrl:string,now=Date.now()):string|null {
 const clean=html.replace(/<!--[\s\S]*?-->/g,'');
 const head=clean.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1]??'';
 const metadata=head.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
 const metaDates=(metadata.match(/<meta\s[^>]*>/gi)??[]).filter(tag=>['article:published_time','datepublished'].includes((attr(tag,'property')||attr(tag,'name')||attr(tag,'itemprop')).toLowerCase())).map(tag=>publicationDate(attr(tag,'content'),now)).filter((v):v is string=>v!==null);
 if(metaDates.length){const days=new Set(metaDates.map(d=>d.slice(0,10)));return days.size===1?metaDates[0]:null;}
 const canonical=(head.match(/<link\s[^>]*>/gi)??[]).find(tag=>attr(tag,'rel').toLowerCase()==='canonical');
 const normalize=(url:string)=>{try{const u=new URL(url,pageUrl);u.hash='';return u.href.replace(/\/$/,'');}catch{return '';}};
 const accepted=new Set([normalize(pageUrl),...(canonical?[normalize(attr(canonical,'href'))]:[])]);
 const candidates:{date:string;matched:boolean}[]=[];
 function inspect(value:unknown,depth=0){
  if(depth>8||!value||typeof value!=='object')return;
  if(Array.isArray(value)){for(const item of value)inspect(item,depth+1);return;}
  const node=value as Record<string,unknown>,types=Array.isArray(node['@type'])?node['@type']:[node['@type']];
  if(types.some(t=>typeof t==='string'&&/^(?:Article|NewsArticle|BlogPosting|ReportageNewsArticle|AnalysisNewsArticle|TechArticle|ScholarlyArticle)$/.test(t))){
   const date=publicationDate(node.datePublished,now),main=node.mainEntityOfPage;
   const urls=[node.url,typeof main==='object'&&main?(main as Record<string,unknown>)['@id']:main,node['@id']].filter((v):v is string=>typeof v==='string');
   const matched=urls.some(url=>accepted.has(normalize(url)));
   if(date&&(!urls.length||matched))candidates.push({date,matched});
  }
  inspect(node['@graph'],depth+1);inspect(node.mainEntity,depth+1);
 }
 for(const match of clean.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))if(attr(' '+match[1],'type').toLowerCase()==='application/ld+json'){
  try{inspect(JSON.parse(match[2]));}catch{/* Invalid publisher metadata is not a date. */}
 }
 const matched=candidates.filter(c=>c.matched),chosen=matched.length?matched:candidates;
 return chosen.length===1?chosen[0].date:null;
}
