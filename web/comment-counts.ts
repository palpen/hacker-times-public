export type DiscussionCount={storyId:number;commentCount:number;commentCountAt:string};
export function parseDiscussionCount(input:unknown,storyId:number):DiscussionCount|null {
 if(!input||typeof input!=='object')return null;
 const value=input as Partial<DiscussionCount>;
 return value.storyId===storyId&&Number.isSafeInteger(value.commentCount)&&value.commentCount!>=0&&typeof value.commentCountAt==='string'&&Number.isFinite(Date.parse(value.commentCountAt))?{storyId,commentCount:value.commentCount!,commentCountAt:value.commentCountAt}:null;
}
export const commentCountLabel=(count:number)=>`${count.toLocaleString('en-US')} ${count===1?'comment':'comments'}`;
export const commentCountDescription=(at:string)=>'Comment count from Hacker News as of '+new Date(at).toLocaleString('en-US');
export function updateDiscussionLinks(value:DiscussionCount){
 for(const anchor of document.querySelectorAll<HTMLAnchorElement>('a.discussion-link')){
  if(Number(anchor.closest<HTMLElement>('[data-story-id]')?.dataset.storyId)!==value.storyId||anchor.href!=='https://news.ycombinator.com/item?id='+value.storyId)continue;
  anchor.textContent=commentCountLabel(value.commentCount);anchor.title=commentCountDescription(value.commentCountAt);
 }
}
// Only hydrate the articles on this timeline; two root-item requests at a time.
// Failure leaves the usable Comments link intact, never a made-up zero.
export async function refreshDiscussionCounts(stories:{id:number}[],developingStory?:string,fetcher:typeof fetch=fetch){
 const visible=new Set(Array.from(document.querySelectorAll<HTMLAnchorElement>('a.discussion-link')).map(a=>Number(a.closest<HTMLElement>('[data-story-id]')?.dataset.storyId)));
 const ids=[...new Set(stories.map(s=>s.id))].filter(id=>visible.has(id));let cursor=0;
 await Promise.all(Array.from({length:Math.min(2,ids.length)},async()=>{
  while(cursor<ids.length){
   const id=ids[cursor++],query=new URLSearchParams({storyId:String(id),countOnly:'1'});
   if(developingStory)query.set('developingStory',developingStory);
   try{
    const response=await fetcher('/api/comments?'+query,{credentials:'same-origin',headers:{Accept:'application/json'},signal:AbortSignal.timeout(10_000)});
    if(!response.ok)continue;const value=parseDiscussionCount(await response.json(),id);if(value)updateDiscussionLinks(value);
   }catch{/* The discussion itself remains available through its ordinary link. */}
  }
 }));
}
