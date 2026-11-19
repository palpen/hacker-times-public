import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ht-games-'));
try{
 await build({entryPoints:['lib/games-topic.ts','lib/policy.ts','web/reader.ts','lib/news.ts','lib/render-edition.ts'],bundle:true,platform:'node',format:'esm',outdir:dir});
 const games=await import(pathToFileURL(path.join(dir,'lib/games-topic.js')));
 const policy=await import(pathToFileURL(path.join(dir,'lib/policy.js')));
 const reader=await import(pathToFileURL(path.join(dir,'web/reader.js')));
 const news=await import(pathToFileURL(path.join(dir,'lib/news.js')));
 const {renderEdition}=await import(pathToFileURL(path.join(dir,'lib/render-edition.js')));
 const positives=[
  ['Unreal Tournament 2004 in the Browser','https://ut2004.dev/'],
  ['Show HN: Type Fighter 2','https://typefighter2.com/',{text:'A browser typing game. Play against another player and score points.'}],
  ['GTA6-like as a 942Kb UEFI bootable image','https://github.com/eklavya-raj/gta6-uefi'],
  ['GTA 6 Review: It Is a Masterpiece','https://bloomberg.com/review'],
  ['Foldlet – A daily four dimensional puzzle inspired by The Three-Body Problem','https://foldlet.net/'],
  ['A Perfect SimCity','https://www.jeffquast.com/post/a-perfect-simcity/'],
  ['Game theory illustrated by an animated cartoon game','https://example.com/'],
  ['Show HN: An unfamiliar title','https://example.com/',{text:'A playable puzzle game built with canvas.'}],
  ['Porting Doom to a tiny microcontroller','https://example.com/'],
 ];
 for(const input of positives)assert.equal(games.isGamesStory(...input),true,input[0]);
 for(const title of ['Show HN: GTA 6 is out, so I built an agent to do my job in Chrome','Multiplayer database for collaborative applications','Gameplay metaphors for enterprise software','Game theory in economics','Game theory and the stock market','A game-changing database','Gaming the search algorithm','Stock ticker GAME rises','A business game plan','Doom and gloom in financial markets','A new processor for data centers','Show HN: Type Fighter 2'])assert.equal(games.isGamesStory(title,'https://example.com/'),false,title);
 assert.equal(games.isGamesStory('A new compiler','https://example.com/',{text:'This compiler optimizes C. We used Minecraft as one of the examples.'}),false,'incidental body game mention');
 assert.equal(games.isGamesStory('General database release','https://example.com/games/chess'),false,'URL alone does not assign Games');
 const at=Date.now();
 const mk=(id,category='Software',extra={})=>({id,title:'Ordinary compiler '+id,url:'https://example.com/'+id,score:100,comments:10,time:Math.floor(at/1000)-3600,category,editorialScore:0,...extra});
 const baseline=[mk(1,'Technology'),...Array.from({length:22},(_,i)=>mk(i+2))];
 const before=policy.selectUnifiedMonthlyStories(baseline,[1],1,at,1,[1]);
 const marked=baseline.map(s=>games.withGamesTopic(s));
 // An already-published Today story is cross-listed without primary reallocation.
 marked[1]=games.withGamesTopic({...marked[1],title:'GTA6-like as a 942Kb UEFI bootable image'});
 const added=games.withGamesTopic(mk(100,'Software',{title:'Unreal Tournament 2004 in the Browser',gamesOnly:true,score:999999,comments:999999}));
 const low=games.withGamesTopic(mk(101,'Software',{title:'A new puzzle game',gamesOnly:true,score:1,comments:0}));
 const duplicate=games.withGamesTopic(mk(102,'Software',{title:'SimCity remake',gamesOnly:true,url:marked[1].url}));
 const old=games.withGamesTopic(mk(103,'Software',{title:'SimCity remake',gamesOnly:true,time:Math.floor(at/1000)-31*86400}));
 const selected=policy.selectUnifiedMonthlyStories([...marked,added,low,duplicate,old],[1],1,at,1,[1]);
 assert.deepEqual(selected.filter(s=>s.placement!=='section-only').map(s=>[s.id,s.category,s.placement,s.editorialScore]),before.filter(s=>s.placement!=='section-only').map(s=>[s.id,s.category,s.placement,s.editorialScore]),'discovery-only engagement does not change Today selection or score normalization');
 assert.ok(selected.find(s=>s.id===2)?.topics.includes('Games'));
 assert.equal(selected.find(s=>s.id===100)?.placement,'section-only');
 assert.ok(!selected.some(s=>[101,102,103].includes(s.id)),'qualification, normalized URL deduplication and 30-day cutoff retained');
 assert.equal(reader.filterStories(selected,'Software','').length,16,'Games additions do not expand the original Software desk');
 assert.equal(reader.filterStories(selected,'Games','').length,2);
 assert.ok(!reader.filterStories(selected,'Today','').some(s=>s.id===100));
 const extra=Array.from({length:30},(_,i)=>games.withGamesTopic(mk(i+200,'Technology',{title:'A new browser game '+i,gamesOnly:true})));
 const bounded=policy.selectUnifiedMonthlyStories([...marked,...extra],[1],1,at,1,[1]);
 assert.equal(reader.filterStories(bounded,'Games','').length,16);
 const oldGames=Array.from({length:16},(_,i)=>games.withGamesTopic(mk(400+i,'Games',{title:'A puzzle game '+i,time:Math.floor(at/1000)-10*86400})));
 const competed=policy.selectUnifiedMonthlyStories([games.withGamesTopic(mk(1,'Technology')),...oldGames,added],[1],1,at,1,[1]);
 assert.equal(reader.filterStories(competed,'Games','').length,16);
 assert.ok(reader.filterStories(competed,'Games','').some(s=>s.id===100),'newer discoveries compete even when 16 old Games seats are filled');
 assert.ok(bounded.length<=126);
 assert.equal(new Set(bounded.map(s=>s.url)).size,bounded.length);
 // A cross-tagged original candidate outside the full primary desk gets a
 // Games-only publication slot without changing its primary classification.
 marked[22]=games.withGamesTopic({...marked[22],title:'A Perfect SimCity'});
 const cross=policy.selectUnifiedMonthlyStories(marked,[1],1,at,1,[1]);
 assert.equal(cross.find(s=>s.id===23)?.gamesOnly,true);
 assert.equal(cross.find(s=>s.id===23)?.category,'Software');
 assert.deepEqual(policy.selectUnifiedMonthlyStories(baseline,[1],1,at,1,[1]),before,'unmarked in-flight legacy selection is unchanged');
 const stamp=new Date(at).toISOString();
 const snapshot={schemaVersion:1,selectionVersion:6,layoutVersion:3,freshnessPolicyVersion:1,policyVersion:policy.unifiedSectionPolicyVersion,basePublicationVersion:'base',leadPolicyVersion:'hn-balanced-lead-v2',generatedAt:stamp,windowStart:new Date(at-30*864e5).toISOString(),windowEnd:stamp,sourceMode:'hn-month-sample',algorithmVersion:3,discovery:{coverage:'sampled'},frontPageIds:[1],sourcePages:[{url:'https://news.ycombinator.com/',ids:[1]}],rankedStories:[...marked,added,low,duplicate,old],selectedStories:selected,candidateCount:28,fetchedCount:28};
 const edition=news.validateEdition({generatedAt:stamp,stories:selected.map(s=>({...s,headline:s.title,summary:'',shortSummary:'',summarySource:'unavailable',publisher:'Example'}))},undefined,snapshot,true);
 assert.equal(edition.stories.find(s=>s.id===100)?.gamesOnly,true,'authoritative scope survives publication');
 const html=renderEdition(edition,'test');
 const softwareFallback=html.match(/<summary>Software[^]*?<\/details>/)?.[0];
 const gamesFallback=html.match(/<summary>Games[^]*?<\/details>/)?.[0];
 assert.ok(!softwareFallback.includes('Unreal Tournament'));
 assert.ok(gamesFallback.includes('Unreal Tournament'),'no-script view matches reader');
 console.log('PASS Games evidence, exclusions, independent supplementation, Today invariance, bounds, snapshot and reader/SSR parity');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
