import {Parser} from 'htmlparser2';

const TEXT_LIMIT=24_000;
const omitted=new Set(['head','script','style','nav','header','footer','noscript','aside','form','button','svg','iframe','template','select']);
const blocks=new Set(['article','main','section','div','p','br','li','ul','ol','blockquote','pre','h1','h2','h3','h4','h5','h6','table','tr','td']);
const chromeToken=/(?:^|[\s_-])(?:cookie|consent|social|share|sidebar|newsletter|advertisement|footer|menu)(?:$|[\s_-])/i;
const clean=(text:string)=>text.replace(/\s+/g,' ').trim();
type Text={text:string;prose:string};
type Frame={tag:string;skip:boolean;link:boolean;heading:boolean;title:boolean;main?:Text;article?:Text};
const bucket=():Text=>({text:'',prose:''});
function append(target:Text,text:string,prose:boolean,limit:number){
 text=text.replace(/\s+/g,' ');
 if(target.text.length<limit)target.text+=text.slice(0,limit-target.text.length);
 if(prose&&target.prose.length<limit)target.prose+=text.slice(0,limit-target.prose.length);
}
function substantive(text:string){
 const value=clean(text);
 return value.length>=80&&((value.match(/[\p{L}\p{N}]+/gu)?.length??0)>=12||/[\u3040-\u30ff\u3400-\u9fff]{20}/u.test(value));
}

// A generic site/product description is not evidence about a specific linked
// story. Require a subject word from the selected title before using metadata
// alone; semantic accuracy remains the editorial model's responsibility.
const titleStopWords=new Set('about after again also another before could from have into just more most news only other over should show some than that their them then there these they this those through today under using very what when where which while will with would your introducing introduction'.split(' '));
function words(text:string){return text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu)??[];}
function descriptionMatchesTitle(description:string,title:string){
 const subjects=words(title).filter(word=>word.length>=4&&!titleStopWords.has(word));
 if(!subjects.length)return false;
 const available=new Set(words(description));
 return subjects.some(word=>available.has(word));
}

/** Parse markup without executing scripts or treating attributes as article text. */
export function extractArticleHtml(html:string,options:{fullText?:boolean;originalTitle?:string}={}){
 const textLimit=options.fullText?html.length:TEXT_LIMIT;
 const body=bucket(),mains:Text[]=[],articles:Text[]=[],stack:Frame[]=[];
 const metadata=new Map<string,string>();let title='';
 const add=(text:string,frame:Frame)=>{
  append(body,text,!frame.link&&!frame.heading,textLimit);
  if(frame.main)append(frame.main,text,!frame.link&&!frame.heading,textLimit);
  if(frame.article)append(frame.article,text,!frame.link&&!frame.heading,textLimit);
 };
 const parser=new Parser({
  onopentag(name,attributes){
   const parent=stack.at(-1);
   if(name==='meta'){
    const key=(attributes.property||attributes.name||'').toLowerCase();
    if(['og:description','description','og:site_name','og:image','twitter:image','twitter:image:src'].includes(key)&&!metadata.has(key))metadata.set(key,clean(attributes.content||'').slice(0,2500));
   }
   const skip=!!parent?.skip||omitted.has(name)||'hidden' in attributes||attributes['aria-hidden']==='true'||
    ['navigation','banner','contentinfo','dialog'].includes(attributes.role)||chromeToken.test((attributes.id||'')+' '+(attributes.class||''));
   const frame:Frame={tag:name,skip,link:!!parent?.link||name==='a',heading:!!parent?.heading||/^h[1-6]$/.test(name),title:!!parent?.title||(name==='title'&&(!parent||stack.some(frame=>frame.tag==='head'))),main:parent?.main,article:parent?.article};
   if(!skip&&name==='main'&&mains.length<16){frame.main=bucket();mains.push(frame.main);}
   if(!skip&&name==='article'&&articles.length<32){frame.article=bucket();articles.push(frame.article);}
   stack.push(frame);
   if(!skip&&blocks.has(name))add(' ',frame);
  },
  ontext(text){
   const frame=stack.at(-1);
   if(frame?.title){title+=text.slice(0,Math.max(0,500-title.length));return;}
   if(!frame?.skip)add(text,frame??{tag:'',skip:false,link:false,heading:false,title:false});
  },
  onclosetag(name){
   const frame=stack.pop();
   if(frame&&!frame.skip&&blocks.has(name))add(' ',frame);
  },
 },{decodeEntities:true});
 parser.end(html);
 // Explicit article bodies can legitimately be short. Unstructured pages need
 // actual prose beyond linked navigation and headings before displacing metadata.
 const article=articles.filter(value=>clean(value.prose)).sort((a,b)=>b.prose.length-a.prose.length)[0];
 const main=mains.filter(value=>substantive(value.prose)).sort((a,b)=>b.prose.length-a.prose.length)[0];
 const selected=article??main??(substantive(body.prose)?body:undefined);
 const pageTitle=clean(title),text=clean(selected?.text??'');
 const excerpt=text!==pageTitle?(options.fullText?text:text.slice(0,8500)):'';
 // Site names and title-only metadata cannot support a separate summary.
 const description=(['og:description','description'].map(key=>metadata.get(key)||'').find(value=>value!==pageTitle&&value.length>=40&&(excerpt||!options.originalTitle||descriptionMatchesTitle(value,options.originalTitle)))||'').slice(0,700);
 return {excerpt,description,pageTitle,publisher:(metadata.get('og:site_name')||'').slice(0,240),
  image:metadata.get('og:image')||metadata.get('twitter:image')||metadata.get('twitter:image:src')||''};
}
