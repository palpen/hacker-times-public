import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import FrontPage from '../app/front-page';
import {selectStories,type Candidate,type Edition} from '../lib/news';
import {legacyCategories as categories} from '../lib/contracts';
import {editionUpdateTime} from '../lib/edition-time';
const pool:Candidate[]=Array.from({length:90},(_,i)=>({id:i+1,title:'Original story '+i,url:'https://example.org/'+i,score:1000-i,comments:200-i,time:1700000000,hnRank:i+1,hnPage:Math.floor(i/30)+1,category:categories[i%5],editorialScore:0}));
const selected=selectStories(pool,pool.slice(0,30).map(s=>s.id));
const edition:Edition={generatedAt:new Date().toISOString(),sourceMode:'hn-multi-page',algorithmVersion:2,candidateCount:90,ranking:'Test',stories:selected.map(s=>({...s,headline:'Headline '+s.id,summary:'A brief verified summary.',publisher:'Original source',image:null}))};
const markup=renderToStaticMarkup(<FrontPage initialEdition={edition}/>);
assert.ok(markup.includes('Last update: <time dateTime="'+edition.generatedAt+'">'+editionUpdateTime(edition.generatedAt).label+'</time>'));
assert.ok(!markup.slice(markup.indexOf('<header'),markup.indexOf('</header>')).includes('Last update:'));
assert.ok(markup.slice(markup.indexOf('<footer>')).includes('Last update:'));
const ids=[...markup.matchAll(/<article[^>]*data-story-id="(\d+)"/g)].map(m=>Number(m[1]));
assert.equal((markup.match(/class="discussion-link"/g)||[]).length,34);assert.equal(ids.length,34);assert.equal(new Set(ids).size,34);assert.deepEqual([...ids].sort((a,b)=>a-b),selected.map(s=>s.id).sort((a,b)=>a-b));
for(const c of categories)assert.ok(markup.includes('id="desk-'+c.toLowerCase()+'"'));
assert.equal((markup.match(/class="topic-desk"/g)||[]).length,5);assert.equal((markup.match(/class="rail-card"/g)||[]).length,6);assert.ok(markup.includes('<h1>Hacker Times</h1>'));assert.ok(markup.includes('The conversation'));assert.ok(markup.includes('Scroll stories right'));
const small={...edition,stories:edition.stories.slice(0,8)};const compact=renderToStaticMarkup(<FrontPage initialEdition={small}/>);assert.ok(!compact.includes('class="topic-desk"'));assert.ok(!compact.includes('class="rail-card"'));
console.log('PASS: server-rendered 34 unique articles, five nonempty desks, six distinct conversation cards, correct masthead, no empty desks/rail. Interactive browser QA is separate.');
// The retained React path and lightweight publication renderer share summary semantics.
import {renderEdition} from '../lib/render-edition';
const summaries=(html:string)=>Object.fromEntries([...html.matchAll(/<article\b[\s\S]*?<\/article>/g)].map(m=>[m[0].match(/data-story-id="(\d+)"/)![1],m[0].match(/<p class="deck">([\s\S]*?)<\/p>/)?.[1]]));
assert.deepEqual(summaries(markup),summaries(renderEdition(edition,'test')));
for(const layoutVersion of [1,2]){
 const stories=Array.from({length:layoutVersion===1?34:42},(_,i)=>({...edition.stories[0],id:i+1,title:'Title '+i,headline:'Headline '+i,placement:i===0?'lead' as const:i<8?'top' as const:i<14?'discussion' as const:'section' as const,category:['Technology','AI','Software','Science','Culture','Business','Games'][layoutVersion===1?[0,2,3,4,5][i%5]:i%7],summarySource:'article' as const,summary:'Verified full copy '+i+'.',shortSummary:'Verified compact copy '+i+'.'}));
 const reviewed={...edition,layoutVersion,summaryPolicyVersion:1 as const,stories};const react=renderToStaticMarkup(<FrontPage initialEdition={reviewed}/>),staticHTML=renderEdition(reviewed,'test');assert.deepEqual(summaries(react),summaries(staticHTML));assert.equal(Object.values(summaries(react)).filter(Boolean).length,stories.length);
 const unavailable={...reviewed,stories:stories.map(s=>({...s,headline:s.title,summarySource:'unavailable' as const,summary:'',shortSummary:''}))};const un=renderToStaticMarkup(<FrontPage initialEdition={unavailable}/>);assert.ok(Object.values(summaries(un)).every(s=>s==='Summary unavailable'));assert.deepEqual(summaries(un),summaries(renderEdition(unavailable,'test')));
}
console.log('PASS: React/static summary parity in both layouts, all available and unavailable slots, and unchanged legacy omissions.');
const discussionIds=edition.stories.filter(s=>s.placement==='discussion').map(s=>s.id),retrievedAt=new Date().toISOString();
const highlighted:Edition={...edition,discussionHighlights:{policy:'hn-top-level-display-order-v1',sourceGeneratedAt:edition.generatedAt,basePublicationVersion:'e-000000000000000000000000',storyIds:discussionIds,collectedAt:retrievedAt,status:'complete',unavailableStoryIds:[],items:discussionIds.map((id,i)=>({storyId:id,commentId:900000+i,author:'Reader'+i,commentTime:1,hnPosition:1,excerpt:'A short exact comment excerpt about this article from the fixture discussion.',truncated:true,retrievedAt}))}};
const compatibility=renderToStaticMarkup(<FrontPage initialEdition={highlighted}/>),prebuilt=renderEdition(highlighted,'test');
const highlightBlock=(html:string)=>html.match(/<section class="more-stories discussion-highlights"[\s\S]*?<\/section>/)?.[0];
assert.equal(highlightBlock(compatibility),highlightBlock(prebuilt));assert.ok(!compatibility.includes('The conversation'));assert.equal((compatibility.match(/data-highlight-slide/g)||[]).length,discussionIds.length);
console.log('PASS: prebuilt/React discussion markup parity, source links and bounded highlights replace the same rail.');
