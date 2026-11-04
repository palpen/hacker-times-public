import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {build} from 'esbuild';import {pathToFileURL} from 'node:url';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ht-summary-'));
try{
 async function mod(file){const out=path.join(tmp,file.replaceAll('/','-')+'.mjs');await build({entryPoints:[file+'.ts'],bundle:true,platform:'node',format:'esm',outfile:out});return import(pathToFileURL(out));}
 const {validateEdition}=await mod('lib/news');const {summaryText}=await mod('lib/summary');const {articleMarkup}=await mod('lib/markup');const {renderEdition}=await mod('lib/render-edition');
 const generatedAt=new Date().toISOString();
 const source={id:1,title:'Original HN title',url:'https://example.org/article',score:100,comments:20,time:Math.floor(Date.now()/1000)-100,category:'Technology',editorialScore:100,placement:'lead',hnRank:1,hnPage:1};
 const snapshot={schemaVersion:1,summaryPolicyVersion:1,selectionVersion:1,layoutVersion:1,policyVersion:'hn-balanced-v2',basePublicationVersion:'base',generatedAt,frontPageIds:[1],sourcePages:[],algorithmVersion:2,candidateCount:1,fetchedCount:1,rankedStories:[source],selectedStories:[source]};
 const story={...source,headline:'Faithful headline',summary:'The author reports a qualified result, based on an initial test.',shortSummary:'The author reports an initial, qualified result.',summarySource:'article',publisher:'Example',image:null};
 const validate=(s=story,snap=snapshot,prev)=>validateEdition({generatedAt,stories:[s]},prev,snap);
 for(const summarySource of ['article','page_description','hn_post']){const result=validate({...story,summarySource});assert.equal(result.summaryPolicyVersion,1);assert.equal(result.stories[0].summarySource,summarySource);assert.equal(result.stories[0].shortSummary,story.shortSummary);}
 for(const patch of [{summarySource:undefined},{shortSummary:undefined},{summarySource:'guessed'},{shortSummary:'a'.repeat(281)},{summary:'a'.repeat(901)},{shortSummary:' '},{summary:''},{summarySource:'unavailable'},{summarySource:'unavailable',summary:'',shortSummary:''}])assert.throws(()=>validate({...story,...patch}));
 const unavailable={...story,headline:source.title,summary:'',shortSummary:'',summarySource:'unavailable'};
 assert.equal(validate(unavailable).stories[0].headline,source.title);assert.equal(summaryText(unavailable),'Summary unavailable');assert.equal(summaryText(unavailable,true),'Summary unavailable');
 assert.throws(()=>validate({...unavailable,title:'Forged title',headline:'Forged title'}));
 const previous={generatedAt,stories:[story]};assert.throws(()=>validate(unavailable,snapshot,previous),/incumbent conflicts/);
 assert.equal(validate(story,snapshot,previous).stories[0].headline,story.headline);
 assert.equal(validate(unavailable,snapshot,{...previous,stories:[{...story,headline:source.title}]}).stories[0].headline,source.title);
 const legacy={...story};delete legacy.summarySource;delete legacy.shortSummary;const old={...snapshot};delete old.summaryPolicyVersion;
 assert.throws(()=>validate({...legacy,shortSummary:'Unattributed copy.'},old));assert.throws(()=>validateEdition({generatedAt,stories:[{...legacy,shortSummary:'Unattributed copy.'}]}));assert.equal(validate(legacy,old).stories[0].summarySource,undefined);assert.equal(validate(legacy,old).summaryPolicyVersion,undefined);assert.equal(summaryText(legacy),legacy.summary);assert.equal(summaryText(legacy,true),undefined);
 assert.throws(()=>validate(legacy,{...old,summaryPolicyVersion:2}));
 const oldLimitation={...legacy,summary:'The full article was unavailable; this old editorial note is preserved.',articleStatus:'unavailable_http_403'};
 assert.equal(summaryText(oldLimitation),oldLimitation.summary);assert.ok(!articleMarkup(oldLimitation,{deck:false}).includes('class="deck"'));assert.ok(articleMarkup(oldLimitation).includes(oldLimitation.summary));
 assert.ok(articleMarkup(story,{deck:false}).includes(story.shortSummary));assert.ok(!articleMarkup(story,{deck:false}).includes(story.summary));assert.ok(articleMarkup(story).includes(story.summary));
 for(const deck of [true,false])assert.ok(articleMarkup(unavailable,{deck}).includes('<p class="deck">Summary unavailable</p>'));
 const evil='</p><script>alert("x")</script><img src=x onerror=x>';
 for(const deck of [true,false]){const html=articleMarkup({...story,summary:evil,shortSummary:evil},{deck});assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));}
 for(const layoutVersion of [1,2]){
  const stories=Array.from({length:layoutVersion===1?34:42},(_,i)=>({...story,id:i+1,title:'Title '+i,headline:'Headline '+i,placement:i===0?'lead':i<8?'top':i<14?'discussion':'section',category:['Technology','AI','Software','Science','Culture','Business','Games'][layoutVersion===1?[0,2,3,4,5][i%5]:i%7],shortSummary:'Compact verified sentence '+i+'.'}));
  const edition={generatedAt,layoutVersion,stories,candidateCount:stories.length,ranking:'Pinned test'};const html=renderEdition(edition,'test');const articles=[...html.matchAll(/<article\b[\s\S]*?<\/article>/g)].map(m=>m[0]);assert.equal(articles.length,stories.length);assert.ok(articles.every(a=>a.includes('class="deck"')));assert.ok(articles.filter(a=>a.includes('rail-card')).every(a=>a.includes('Compact verified sentence')));
  const bad=renderEdition({...edition,stories:stories.map(s=>({...s,summary:evil,shortSummary:evil}))},'test');assert.ok(!bad.includes('<script>alert'));assert.ok(bad.includes('\\u003c/script\\u003e'));
 }
 console.log('PASS: summary contracts, source modes, bounds, unavailable title, incumbent conflict, legacy snapshots/omissions, all compact slots and XSS escaping. Source quality remains editorial review, not automatic semantic proof.');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
