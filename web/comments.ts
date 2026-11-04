import type {Story} from '../lib/news';

const PAGE_SIZE=12, CACHE_LIMIT=24, CACHE_TTL=60_000;
type Token={type:string;text?:string;href?:string;children?:Token[]};
type Comment={id:number;parentId:number;by:string|null;time:number|null;deleted:boolean;dead:boolean;unavailable:boolean;content:Token[];contentTruncated:boolean;replyCount:number;repliesAvailable:boolean};
type Page={storyId:number;parentId:number;depth:number;comments:Comment[];page:{offset:number;limit:number;total:number;nextOffset:number|null;truncated:boolean;partial:boolean};fetchedAt:string};
const integer=(value:unknown,min=0):value is number=>Number.isSafeInteger(value)&&Number(value)>=min;
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const hnUrl=(id:number)=>'https://news.ycombinator.com/item?id='+id;
export function safeCommentHref(value:unknown){
 if(typeof value!=='string'||value.length>2500||/[\u0000-\u0020\u007f\\]/.test(value))return null;
 try{const url=new URL(value);return (url.protocol==='https:'||url.protocol==='http:')&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
function tokens(input:unknown,budget={nodes:0,chars:0},depth=0):Token[]{
 if(!Array.isArray(input)||depth>16)throw Error('Invalid comment content');
 return input.map(value=>{
  if(!record(value)||++budget.nodes>2400)throw Error('Invalid comment content');
  if(value.type==='text'){
   if(typeof value.text!=='string'||(budget.chars+=value.text.length)>40000)throw Error('Invalid comment content');
   return {type:'text',text:value.text};
  }
  if(value.type==='br')return {type:'br'};
  if(typeof value.type==='string'&&['p','em','strong','code','pre','a'].includes(value.type))return {type:value.type,children:tokens(value.children,budget,depth+1),...(value.type==='a'?{href:safeCommentHref(value.href)||undefined}:{})};
  throw Error('Invalid comment content');
 });
}
export function validateCommentPage(input:unknown,storyId:number,parentId:number,offset:number):Page{
 if(!record(input)||input.storyId!==storyId||input.parentId!==parentId||!integer(input.depth)||input.depth>7||!Array.isArray(input.comments)||input.comments.length>PAGE_SIZE||!record(input.page))throw Error('Invalid discussion response');
 const p=input.page;
 if(p.offset!==offset||p.limit!==PAGE_SIZE||!integer(p.total)||p.total>1_000_000||p.total<offset+input.comments.length||typeof p.partial!=='boolean'||typeof p.truncated!=='boolean'||(p.nextOffset!==null&&(!integer(p.nextOffset)||p.nextOffset!==offset+PAGE_SIZE||p.nextOffset>=600||p.nextOffset>=p.total)))throw Error('Invalid discussion pagination');
 const ids=new Set<number>();
 const comments=input.comments.map(value=>{
  if(!record(value)||!integer(value.id,1)||ids.has(value.id)||value.parentId!==parentId||!(value.by===null||typeof value.by==='string'&&value.by.length<=128)||!(value.time===null||integer(value.time)&&value.time<=8_640_000_000_000)||!integer(value.replyCount)||['deleted','dead','unavailable','contentTruncated','repliesAvailable'].some(key=>typeof value[key]!=='boolean'))throw Error('Invalid comment');
  ids.add(value.id);
  return {id:value.id,parentId,by:value.by,time:value.time,deleted:value.deleted,dead:value.dead,unavailable:value.unavailable,content:tokens(value.content),contentTruncated:value.contentTruncated,replyCount:value.replyCount,repliesAvailable:value.repliesAvailable} as Comment;
 });
 return {storyId,parentId,depth:input.depth,comments,page:{offset,limit:PAGE_SIZE,total:p.total,nextOffset:p.nextOffset as number|null,truncated:p.truncated,partial:p.partial},fetchedAt:typeof input.fetchedAt==='string'?input.fetchedAt:''};
}
export function appendCommentContent(parent:HTMLElement,content:Token[]){
 for(const token of content){
  if(token.type==='text'){parent.appendChild(document.createTextNode(token.text||''));continue;}
  if(!['br','p','em','strong','code','pre','a'].includes(token.type))continue;
  const href=token.type==='a'?safeCommentHref(token.href):null;
  const node=document.createElement(token.type==='a'&&!href?'span':token.type);
  if(href){node.setAttribute('href',href);node.setAttribute('target','_blank');node.setAttribute('rel','noopener noreferrer nofollow');}
  if(token.type!=='br')appendCommentContent(node,token.children||[]);
  parent.appendChild(node);
 }
}
function element<K extends keyof HTMLElementTagNameMap>(tag:K,className='',text=''){
 const node=document.createElement(tag);if(className)node.className=className;if(text)node.textContent=text;return node;
}
function append(parent:HTMLElement,...children:HTMLElement[]){for(const child of children)parent.appendChild(child);}
function sourceLink(id:number,text:string){const link=element('a','comment-source-link',text);link.href=hnUrl(id);link.target='_blank';link.rel='noopener noreferrer';return link;}

let stylesheet:{url:string;promise:Promise<void>}|undefined;
export function loadCommentsStyles(url:string|undefined):Promise<void>{
 if(!url||!/^\/reader-assets\/comments-[a-f0-9]{16}\.css$/.test(url))return Promise.reject(Error('Invalid discussion stylesheet'));
 if(stylesheet?.url===url)return stylesheet.promise;
 const link=document.createElement('link');link.rel='stylesheet';link.href=url;
 const promise=new Promise<void>((resolve,reject)=>{
  const timeout=setTimeout(()=>{link.remove();reject(Error('Discussion stylesheet timed out'));},15000);
  link.addEventListener('load',()=>{clearTimeout(timeout);resolve();},{once:true});
  link.addEventListener('error',()=>{clearTimeout(timeout);link.remove();reject(Error('Discussion stylesheet unavailable'));},{once:true});
  document.head.appendChild(link);
 });
 stylesheet={url,promise};
 void promise.catch(()=>{if(stylesheet?.promise===promise)stylesheet=undefined;});
 return promise;
}

/** Progressive enhancement only: unsupported dialog browsers retain the original HN links. */
export async function createCommentsReader(stories:Story[],date?:string,commentsCssAsset?:string,publicationVersion?:string){
 const version=publicationVersion?.startsWith('legacy-')?undefined:publicationVersion;
 if(publicationVersion?.startsWith('legacy-')&&!/^legacy-\d{4}-\d{2}-\d{2}$/.test(publicationVersion)||version!==undefined&&!/^(e-[a-f0-9]{24}|bundled-[a-f0-9]{16})$/.test(version))throw Error('Invalid publication version');
 await loadCommentsStyles(commentsCssAsset);
 const byId=new Map(stories.map(story=>[story.id,story]));
 const cache=new Map<string,{expires:number;value:Page}>();
 const pending=new Map<string,{controller:AbortController;promise:Promise<Page>}>();
 let dialog:HTMLDialogElement|null=null,heading:HTMLElement,count:HTMLElement,storyTitle:HTMLElement,original:HTMLAnchorElement,body:HTMLElement,close:HTMLButtonElement;
 let generation=0,activeId=0,lastId=0,opener:HTMLElement|null=null,scrollX=0,scrollY=0;
 const historyOwner='comments-'+Date.now()+'-'+Math.random().toString(36).slice(2);
 let awaitingBack=false,queuedOpen:{story:Story;trigger:HTMLElement}|null=null;
 const ownHistory=()=>typeof history!=='undefined'&&history.state?.htDiscussion?.owner===historyOwner;
 function recordHistory(storyId:number){
  if(typeof history==='undefined'||typeof history.pushState!=='function')return;
  try{const state={...(record(history.state)?history.state:{}),htDiscussion:{owner:historyOwner,storyId}};if(ownHistory())history.replaceState(state,'');else history.pushState(state,'');}catch{}
 }
 function abort(){for(const request of pending.values())request.controller.abort();pending.clear();}
 function dismiss(updateHistory=true){
  if(updateHistory)queuedOpen=null;
  if(!activeId)return;
  generation++;activeId=0;abort();document.documentElement.classList.remove('comments-open');
  if(dialog?.open)dialog.close();
  body?.replaceChildren();
  const target=opener?.isConnected&&!opener.closest('[hidden]')?opener:document.getElementById('news');
  if(target){if(target.id==='news')target.setAttribute('tabindex','-1');target.focus({preventScroll:true});}
  window.scrollTo({left:scrollX,top:scrollY,behavior:'instant'});
  if(updateHistory&&ownHistory()){awaitingBack=true;try{history.back();}catch{awaitingBack=false;}}
 }
 function ensureDialog(){
  if(dialog)return true;
  const candidate=element('dialog','comments-dialog');
  if(typeof candidate.showModal!=='function')return false;
  dialog=candidate;dialog.setAttribute('aria-labelledby','comments-heading comments-story-title');
  const shell=element('div','comments-shell'),header=element('header','comments-header');
  const top=element('div','comments-topline');top.appendChild(element('p','comments-kicker','Hacker Times'));
  close=element('button','comments-close','Close');close.type='button';close.setAttribute('aria-label','Close discussion');close.addEventListener('click',()=>dismiss());top.appendChild(close);
  heading=element('h2','comments-heading');heading.id='comments-heading';
  count=element('strong','comments-count');count.title='Comment count at publication';heading.appendChild(count);
  const snapshot=element('span','comments-snapshot','Comment count at publication');snapshot.id='comments-snapshot';
  storyTitle=element('p','comments-story-title');storyTitle.id='comments-story-title';dialog.setAttribute('aria-describedby',snapshot.id);
  const summary=element('div','comments-summary');append(summary,heading,snapshot);
  original=sourceLink(1,'Post your comments, open the discussion on Hacker News');original.classList.add('comments-original');
  append(header,top,summary,storyTitle,original);body=element('div','comments-scroll');append(shell,header,body);dialog.appendChild(shell);
  dialog.addEventListener('cancel',event=>{event.preventDefault();dismiss();});dialog.addEventListener('close',()=>{if(activeId&&!dialog?.open)dismiss();});
  // A click must both begin and end outside the sheet, so drags cannot dismiss it.
  let outside=false;
  const isOutside=(event:MouseEvent)=>{const box=dialog!.getBoundingClientRect();return event.target===dialog&&(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom);};
  dialog.addEventListener('pointerdown',event=>{outside=isOutside(event);});
  dialog.addEventListener('click',event=>{if(outside&&isOutside(event))dismiss();outside=false;});
  dialog.addEventListener('keydown',event=>{
   if(event.key!=='Tab')return;
   const controls=Array.from(dialog!.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,[tabindex]')).filter(node=>node.tabIndex>=0&&!node.closest('[hidden]')&&!('disabled' in node&&(node as HTMLButtonElement).disabled)&&node.getClientRects().length>0);
   const first=controls[0],last=controls.at(-1);if(!first||!last){event.preventDefault();close.focus();return;}
   const outside=!dialog!.contains(document.activeElement);
   if(event.shiftKey&&(document.activeElement===first||outside)){event.preventDefault();last.focus();}
   else if(!event.shiftKey&&(document.activeElement===last||outside)){event.preventDefault();first.focus();}
  });
  document.body.appendChild(dialog);return true;
 }
 async function request(storyId:number,parentId:number,offset:number):Promise<Page>{
  const query=new URLSearchParams({storyId:String(storyId),offset:String(offset)});
  if(parentId!==storyId)query.set('parentId',String(parentId));if(date)query.set('date',date);if(version)query.set('version',version);
  const key=query.toString(),saved=cache.get(key);
  if(saved&&saved.expires>Date.now()){cache.delete(key);cache.set(key,saved);return saved.value;}
  cache.delete(key);const inflight=pending.get(key);if(inflight)return inflight.promise;
  const controller=new AbortController();
  let timer:ReturnType<typeof setTimeout>|undefined;
  const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{reject(Error('Discussion request timed out'));controller.abort();},25_000);});
  const work=(async()=>{
   const response=await fetch('/api/comments?'+key,{signal:controller.signal,credentials:'same-origin',headers:{Accept:'application/json'}});
   if(!response.ok)throw Error('Discussion is unavailable');
   const value=validateCommentPage(await response.json(),storyId,parentId,offset);
   if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');
   cache.set(key,{expires:Date.now()+CACHE_TTL,value});while(cache.size>CACHE_LIMIT)cache.delete(cache.keys().next().value!);
   return value;
  })();
  const promise=Promise.race([work,deadline]);pending.set(key,{controller,promise});
  try{return await promise;}finally{clearTimeout(timer);if(pending.get(key)?.promise===promise)pending.delete(key);}
 }
 function threadPage(storyId:number,parentId:number,root:boolean,epoch:number){
  const section=element('section','comment-page'),status=element('p','comments-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.setAttribute('aria-atomic','true');
  const list=element('ol','comment-list'),note=element('p','comments-note'),more=element('button','comments-load','Load more');more.type='button';more.hidden=true;
  note.hidden=true;append(section,status,list,note,more);
  let nextOffset:number|null=0,busy=false,shown=0,partial=false,started=false;
  const seen=new Set<number>();
  async function load(){
   if(busy||nextOffset===null||epoch!==generation)return;
   started=true;busy=true;more.disabled=true;section.setAttribute('aria-busy','true');
   const offset=nextOffset;status.textContent=offset?'Loading more comments…':root?'Loading discussion…':'Loading replies…';
   try{
    const page=await request(storyId,parentId,offset);if(epoch!==generation||activeId!==storyId)return;
    let first:HTMLElement|null=null;
    for(const comment of page.comments){if(seen.has(comment.id))continue;seen.add(comment.id);const item=renderComment(comment,storyId,epoch);list.appendChild(item);first??=item;shown++;}
    partial||=page.page.partial;nextOffset=page.page.nextOffset;
    status.textContent=shown?`Showing ${shown.toLocaleString('en-US')} of ${page.page.total.toLocaleString('en-US')} ${root?'top-level comments':'replies'}.`:root?'No comments yet. Check the original discussion for the latest.':'No replies are available.';
    note.textContent=[partial?'Some comments are unavailable. The original discussion may have more.':'',page.page.truncated?'This view is limited to the first 600 comments in this thread. Continue on Hacker News for the rest.':''].filter(Boolean).join(' ');note.hidden=!note.textContent;
    more.textContent=root?'Load more comments':'Load more replies';more.hidden=nextOffset===null;
    if(offset&&document.activeElement===more&&first){first.tabIndex=-1;first.focus({preventScroll:true});}
   }catch(error){
    if(epoch!==generation||activeId!==storyId||(error instanceof DOMException&&error.name==='AbortError'))return;
    status.textContent='Comments could not be loaded. Try again, or read the discussion on Hacker News.';more.textContent='Try again';more.hidden=false;
   }finally{busy=false;if(epoch===generation){more.disabled=false;section.setAttribute('aria-busy','false');}}
  }
  more.addEventListener('click',()=>void load());
  return {section,load,started:()=>started};
 }
 function renderComment(comment:Comment,storyId:number,epoch:number){
  const item=element('li','comment-node'),article=element('article','comment'),metadata=element('header','comment-meta');article.setAttribute('aria-label',comment.by?`Comment by ${comment.by}`:'Comment');
  const author=element('span','comment-author',comment.by||'Unknown author');metadata.appendChild(author);
  const permalink=sourceLink(comment.id,'View comment');
  if(comment.time!==null){const date=new Date(comment.time*1000);if(Number.isFinite(date.getTime())){const time=element('time','',date.toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}));time.dateTime=date.toISOString();permalink.replaceChildren(time);}}
  metadata.appendChild(permalink);
  const collapse=element('button','comment-collapse','Collapse thread');collapse.type='button';collapse.setAttribute('aria-expanded','true');
  const content=element('div','comment-content');content.id=`comment-${epoch}-${comment.id}`;collapse.setAttribute('aria-controls',content.id);collapse.addEventListener('click',()=>{content.hidden=!content.hidden;collapse.setAttribute('aria-expanded',String(!content.hidden));collapse.textContent=content.hidden?'Expand thread':'Collapse thread';});
  metadata.appendChild(collapse);append(article,metadata,content);
  const text=element('div','comment-text');
  if(comment.unavailable||comment.deleted||comment.dead)text.appendChild(element('p','comment-unavailable',comment.unavailable?'This comment is unavailable.':comment.deleted?'This comment was deleted.':'This comment is no longer visible on Hacker News.'));
  else if(comment.content.length)appendCommentContent(text,comment.content);else text.appendChild(element('p','comment-unavailable','This comment has no text.'));
  content.appendChild(text);
  if(comment.contentTruncated)content.appendChild(sourceLink(comment.id,'Comment shortened. Read the full comment ↗'));
  if(comment.replyCount){
   if(comment.repliesAvailable){
    const replies=threadPage(storyId,comment.id,false,epoch);replies.section.hidden=true;replies.section.id=`replies-${epoch}-${comment.id}`;
    const toggle=element('button','comment-replies-toggle',`Show ${comment.replyCount.toLocaleString('en-US')} ${comment.replyCount===1?'reply':'replies'}`);toggle.type='button';toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-controls',replies.section.id);
    toggle.addEventListener('click',()=>{const open=replies.section.hidden;replies.section.hidden=!open;toggle.setAttribute('aria-expanded',String(open));toggle.textContent=open?'Hide replies':`Show ${comment.replyCount.toLocaleString('en-US')} ${comment.replyCount===1?'reply':'replies'}`;if(open&&!replies.started())void replies.load();});
    append(content,toggle,replies.section);
   }else content.appendChild(sourceLink(comment.id,`Continue ${comment.replyCount.toLocaleString('en-US')} ${comment.replyCount===1?'reply':'replies'} on Hacker News ↗`));
  }
  item.appendChild(article);return item;
 }
 function open(story:Story,trigger:HTMLElement){
  if(awaitingBack){queuedOpen={story,trigger};return;}
  if(activeId===story.id&&dialog?.open){close.focus();return;}
  const alreadyOpen=!!dialog?.open;
  generation++;abort();activeId=story.id;lastId=story.id;opener=trigger;recordHistory(story.id);
  if(!alreadyOpen){scrollX=window.scrollX;scrollY=window.scrollY;}
  // Story.comments is the saved edition's HN descendants total, not a live thread-page total.
  count.textContent=`${story.comments.toLocaleString('en-US')} ${story.comments===1?'comment':'comments'}`;
  storyTitle.textContent=story.headline;original.href=hnUrl(story.id);
  const page=threadPage(story.id,story.id,true,generation);body.replaceChildren(page.section);body.scrollTop=0;
  document.documentElement.classList.add('comments-open');
  if(!alreadyOpen)dialog!.showModal();close.focus({preventScroll:true});void page.load();
 }
 window.addEventListener?.('popstate',()=>{
  awaitingBack=false;
  if(ownHistory()){
   const story=byId.get(history.state.htDiscussion.storyId);if(!story)return;
   const trigger=story.id===lastId&&opener?.isConnected?opener:document.querySelector<HTMLElement>(`[data-story-id="${story.id}"] .discussion-link`)||document.getElementById('news');
   if(trigger)open(story,trigger);
  }else{const next=queuedOpen;queuedOpen=null;dismiss(false);if(next)open(next.story,next.trigger);}
 });
 return {open:(storyId:number,trigger:HTMLElement)=>{const story=byId.get(storyId);if(!story||!ensureDialog())return false;open(story,trigger);return true;},close:dismiss,cacheSize:()=>cache.size,pendingCount:()=>pending.size};
}
