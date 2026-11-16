import type {DiscussionStory,CommentsReaderOptions} from './comments';
type CommentModule=Pick<typeof import('./comments'),'createCommentsReader'>;
export function installCommentLinks(stories:DiscussionStory[],assetURL?:string,archiveDate?:string,commentsCssAsset?:string,publicationVersion?:string,load:(url:string)=>Promise<CommentModule>=url=>import(/* @vite-ignore */ url),options:CommentsReaderOptions={}){
 // Only fetch the comments module after an ordinary discussion-link click.
 let commentsModule:Promise<Awaited<ReturnType<typeof import('./comments').createCommentsReader>>>|undefined,commentClick=0;
 document.addEventListener('click',async event=>{
  if(event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||!(event.target instanceof Element))return;
  const anchor=event.target.closest<HTMLAnchorElement>('a.discussion-link'),asset=assetURL;
  if(!anchor||!asset||!/^\/reader-assets\/comments-[a-f0-9]{16}\.js$/.test(asset)||typeof HTMLDialogElement==='undefined'||typeof HTMLDialogElement.prototype.showModal!=='function')return;
  const id=Number(anchor.closest<HTMLElement>('[data-story-id]')?.dataset.storyId);
  if(!stories.some(story=>story.id===id)||anchor.href!=='https://news.ycombinator.com/item?id='+id)return;
  event.preventDefault();const click=++commentClick,notice=document.getElementById('notice')!;
  const fallback=document.createElement('a');fallback.href=anchor.href;fallback.target='_blank';fallback.rel='noopener noreferrer';fallback.textContent='Read on Hacker News ↗';
  const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';cancel.addEventListener('click',()=>{commentClick++;notice.hidden=true;anchor.focus();});
  const message=document.createElement('span');message.textContent='Opening discussion…';notice.replaceChildren(message,fallback,cancel);notice.hidden=false;
  try{
   commentsModule??=load(asset).then(module=>module.createCommentsReader(stories,archiveDate,commentsCssAsset,publicationVersion,options)).catch(error=>{commentsModule=undefined;throw error;});
   const comments=await commentsModule;if(click!==commentClick)return;notice.hidden=true;
   if(!comments.open(id,anchor))location.href=anchor.href;
  }catch{if(click!==commentClick)return;message.textContent='The discussion reader could not be opened.';cancel.textContent='Dismiss';}
 });
}
