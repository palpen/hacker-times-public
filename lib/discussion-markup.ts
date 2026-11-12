import type {Edition} from './contracts';
import {TRENDING_HIGHLIGHT_POLICY,validDiscussionSnapshot} from './discussion-highlights';
import {esc,link,submissionMarkup} from './markup';

/** Pair different stories without repeating or discarding saved comments. Taking
 * the two largest remaining queues avoids unnecessary single-comment pages. */
export function groupDiscussionHighlights<T extends {storyId:number}>(items:readonly T[]):T[][]{
 const byStory=new Map<number,{order:number;items:T[]}>();
 for(const item of items){
  let queue=byStory.get(item.storyId);
  if(!queue){queue={order:byStory.size,items:[]};byStory.set(item.storyId,queue);}
  queue.items.push(item);
 }
 const pages:T[][]=[];
 while(byStory.size){
  const queues=[...byStory.values()].sort((a,b)=>b.items.length-a.items.length||a.order-b.order);
  const page=queues.slice(0,2).map(queue=>queue.items.shift()!);
  for(const item of page)if(!byStory.get(item.storyId)!.items.length)byStory.delete(item.storyId);
  pages.push(page);
 }
 return pages;
}

/** One escaped text-only renderer is shared by prebuilt and compatibility pages.
 * Every saved comment and exact source link works without enhancement JavaScript. */
export function renderDiscussionHighlights(edition:Edition):string{
 const snapshot=edition.discussionHighlights;
 if(!validDiscussionSnapshot(snapshot,edition)||!snapshot.items.length)return '';
 const stories=new Map(edition.stories.map(s=>[s.id,{id:s.id,url:s.url,headline:s.headline,time:s.time}]));
 for(const source of snapshot.policy===TRENDING_HIGHLIGHT_POLICY?snapshot.sources??[]:[])stories.set(source.id,{id:source.id,url:source.url,headline:source.title,time:source.time});
 const pages=groupDiscussionHighlights(snapshot.items);
 const content=pages.map((page,index)=>`<div class="highlight-page" id="highlight-page-${index+1}" data-highlight-page data-highlight-title="${esc(page.map(h=>stories.get(h.storyId)!.headline).join('; '))}">${page.map(h=>{
  const s=stories.get(h.storyId)!;
  return `<article class="highlight-slide" data-highlight-slide data-story-id="${s.id}"><h3 class="highlight-story">${link(s.url,esc(s.headline))}</h3><p class="highlight-excerpt"><span aria-hidden="true">“</span>${esc(h.excerpt)}${h.truncated?'…':''}<span aria-hidden="true">”</span></p><div class="highlight-attribution"><span>${submissionMarkup(s.time)}${link('https://news.ycombinator.com/user?id='+encodeURIComponent(h.author),esc(h.author))} on Hacker News</span>${link('https://news.ycombinator.com/item?id='+h.commentId,'Read comment',`aria-label="Read ${esc(h.author)}’s comment on Hacker News"`)}</div></article>`;
 }).join('')}</div>`).join('');
 const dots=pages.map((_,index)=>`<button type="button" class="highlight-dot" data-highlight-dot aria-label="Show discussion page ${index+1} of ${pages.length}" aria-controls="highlight-page-${index+1}"><span aria-hidden="true"></span></button>`).join('');
 return `<section class="more-stories discussion-highlights" id="discussion-highlights" aria-labelledby="highlights-heading"><div class="highlight-heading"><h2 id="highlights-heading">What People Are Talking About</h2></div><div class="highlight-slides">${content}</div><div class="highlight-navigation" data-highlight-controls role="group" aria-label="Discussion pages" aria-describedby="highlight-navigation-help" hidden>${dots}<span id="highlight-navigation-help" class="sr-only">Use left and right arrow keys to change pages, Home for the first page, and End for the last page.</span></div><span data-highlight-status class="sr-only" role="status" aria-live="polite" aria-atomic="true"></span></section>`;
}
