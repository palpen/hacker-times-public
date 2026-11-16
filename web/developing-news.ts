import {refreshDiscussionCounts} from './comment-counts';
import {installCommentLinks} from './comment-links';
import type {DiscussionStory} from './comments';
const node=document.getElementById('developing-discussion-data');
if(node){
 const data=JSON.parse(node.textContent||'{}') as {threadId:string;stories:DiscussionStory[];commentsAsset:string;commentsCssAsset:string};
 void refreshDiscussionCounts(data.stories,data.threadId);
 installCommentLinks(data.stories,data.commentsAsset,undefined,data.commentsCssAsset,undefined,undefined,{developingStory:data.threadId});
}
