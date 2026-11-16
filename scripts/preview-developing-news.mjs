// Local reader preview with clearly labeled illustrative coverage. No provider,
// production database, or publishing credentials are loaded by this process.
import http from 'node:http';
import {Script} from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ht-developing-preview-'));
const entry=path.join(dir,'entry.ts'),bundle=path.join(dir,'preview.mjs');
const root=process.cwd();
fs.writeFileSync(entry,`export * from '${root}/lib/developing-news/render';export * from '${root}/lib/developing-news/routes';export {article} from '${root}/lib/reporting';export {renderEdition} from '${root}/lib/render-edition';export {assetResponse} from '${root}/lib/asset-response';export {createCommentsService} from '${root}/lib/comments-core';export {secureResponse} from '${root}/lib/security';`);
await build({entryPoints:[entry],outfile:bundle,bundle:true,format:'esm',platform:'node'});
const api=await import(pathToFileURL(bundle));
const datesPath=path.join(root,'outputs/developing-news-source-dates.json');
const sourceDates=fs.existsSync(datesPath)?JSON.parse(fs.readFileSync(datesPath,'utf8')):{};
const now='2026-11-15T12:00:00.000Z';
const stories=[
 {id:'s-aaaaaaaaaaaaaaaaaaaa',hnId:50503255,title:'The fight over license-plate surveillance',question:'Will an appeals court require warrants for the license-plate database searches at issue?',summary:'EFF and the ACLU have urged a federal appeals court to require warrants for searches that trace drivers’ movements through license-plate records.',publisher:'EFF',url:'https://www.eff.org/deeplinks/2026/11/were-asking-appeals-court-require-warrant-alpr-searches',sourceTitle:'We’re asking an appeals court to require a warrant for ALPR searches'},
 {id:'s-bbbbbbbbbbbbbbbbbbbb',hnId:50497009,title:'Meta challenges Italy’s privacy fine',question:'How will Meta’s appeal and changes to its photo-sharing feature unfold?',summary:'Italy’s privacy regulator has fined Meta over access to Android users’ photos and videos. Meta disputes the decision and says it will appeal.',publisher:'Reuters',url:'https://www.reuters.com/world/italy-fines-meta-887-million-over-android-users-data-access-2026-11-14/',sourceTitle:'Italy fines Meta $887 million over Android users’ data access'},
 {id:'s-cccccccccccccccccccc',hnId:50502988,title:'The DRAM price-fixing lawsuit moves forward',question:'Will the claims against Samsung, SK Hynix and Micron succeed as the case proceeds?',summary:'A judge has allowed a proposed class action over alleged restrictions on DRAM supply to proceed. The allegations have not been proved.',publisher:'LitNews',url:'https://litnews.ai/articles/garciaguirre-samsung-sk-hynix-micron-dram-conspiracy-suit-survives-dismissal',sourceTitle:'DRAM supply-conspiracy suit survives dismissal'},
].map(s=>({...s,status:'active',followingSince:now,lastMaterialAt:now,updates:[{id:s.id,at:now,summary:s.summary,source:{url:s.url,publisher:s.publisher,title:s.sourceTitle,hnId:s.hnId,publishedAt:sourceDates[s.hnId]?.publishedAt??null},sourceHash:'preview'}]}));
const news={active:stories,quiet:[],nextCursor:null};
const edition=JSON.parse(fs.readFileSync('data/edition.json','utf8'));
const banner='<aside class="notice" role="status">Design preview · Sample tracking dates, verified article dates. Not live coverage.</aside>';
const env={DEVELOPING_NEWS:{idFromName:x=>x,get:()=>({fetch:async req=>{const u=new URL(req.url);const id=u.pathname.slice(7);return u.pathname==='/list'?Response.json(news):stories.find(s=>s.id===id)?Response.json(stories.find(s=>s.id===id)):new Response('Not found',{status:404});}})}};
const commentsPath=path.join(root,'outputs/developing-news-comments.json');
if(process.argv[2]==='--refresh-dates'){
 for(const story of stories){
  const source=await api.article(story.url);
  sourceDates[story.hnId]={url:story.url,publishedAt:source.articlePublishedAt??null,checkedAt:new Date().toISOString(),status:source.articleStatus};
  console.log(story.hnId+': '+(source.articlePublishedAt??'Publication date unavailable')+' ('+source.articleStatus+')');
 }
 fs.mkdirSync(path.dirname(datesPath),{recursive:true});fs.writeFileSync(datesPath,JSON.stringify(sourceDates,null,2));fs.rmSync(dir,{recursive:true,force:true});process.exit();
}
if(process.argv[2]==='--refresh-counts'){
 const snapshot=JSON.parse(fs.readFileSync(commentsPath,'utf8'));
 const service=api.createCommentsService({readEdition:async()=>({stories:stories.map(s=>({id:s.hnId}))})});
 for(const story of stories){
  const response=await service(new Request('https://preview.example/api/comments?storyId='+story.hnId+'&countOnly=1'),{});
  if(!response.ok)throw Error('Comment count unavailable: '+response.status);
  const count=await response.json();if(count.commentCount===null)throw Error('HN omitted its comment total');
  for(const page of Object.values(snapshot.pages))if(page.storyId===story.hnId)Object.assign(page,count);
  console.log(story.hnId+': '+count.commentCount+' comments');
 }
 fs.writeFileSync(commentsPath,JSON.stringify(snapshot));fs.rmSync(dir,{recursive:true,force:true});process.exit();
}
if(process.argv[2]==='--refresh-comments'){
 let nextRead=0;
 const fetcher=async(...args)=>{const wait=Math.max(0,nextRead-Date.now());nextRead=Date.now()+wait+400;await new Promise(resolve=>setTimeout(resolve,wait));return fetch(...args);};
 const service=api.createCommentsService({fetcher,readEdition:async()=>({stories:stories.map(s=>({id:s.hnId}))})});
 const pages={},queue=stories.map(s=>({storyId:s.hnId,parentId:s.hnId,offset:0}));
 for(let index=0;index<queue.length;index++){
  if(index>=200)throw Error('Preview discussion snapshot exceeds page budget');
  const q=queue[index],key=[q.storyId,q.parentId,q.offset].join(':');if(pages[key])continue;
  const response=await service(new Request('https://preview.example/api/comments?'+new URLSearchParams(Object.entries(q).map(([k,v])=>[k,String(v)]))),{});
  if(!response.ok)throw Error('Discussion snapshot failed: '+response.status+' '+await response.text());
  const page=await response.json();
  // Save roots and their immediate replies. Deeper threads keep the standard HN continuation link.
  if(page.depth>=1)for(const comment of page.comments)comment.repliesAvailable=false;
  pages[key]=page;
  if(page.page.nextOffset!==null)queue.push({...q,offset:page.page.nextOffset});
  for(const comment of page.comments)if(comment.repliesAvailable&&comment.replyCount)queue.push({storyId:q.storyId,parentId:comment.id,offset:0});
 }
 fs.mkdirSync(path.dirname(commentsPath),{recursive:true});fs.writeFileSync(commentsPath,JSON.stringify({capturedAt:new Date().toISOString(),pages}));
 fs.rmSync(dir,{recursive:true,force:true});console.log('Saved '+Object.keys(pages).length+' sanitized discussion pages.');process.exit();
}
if(process.argv[2]==='--export'){
 const destination=path.resolve(process.argv[3]||'outputs/developing-news-preview.html');
 const body=html=>html.match(/<main[\s\S]*?<\/main>/)[0].replace(/<script[\s\S]*?<\/script>/g,'').replaceAll('href="/developing-news/','href="#/story/').replaceAll('href="/developing-news"','href="#/"').replaceAll('href="/"','href="https://hackertimes.ca/"').replaceAll('href="/?section=','href="https://hackertimes.ca/?section=');
 const pages={'/':body(api.renderDevelopingIndex(news)),...Object.fromEntries(stories.map(s=>['/story/'+s.id,body(api.renderDevelopingStory(s))]))};
 const css=fs.readFileSync('app/globals.css','utf8').replaceAll('/fonts/ManufacturingConsent-HackerTimes.woff2','data:font/woff2;base64,'+fs.readFileSync('public/fonts/ManufacturingConsent-HackerTimes.woff2').toString('base64'))+'\n'+fs.readFileSync('web/developing-news.css','utf8')+'\n'+fs.readFileSync('web/comments.css','utf8');
 const serialized=JSON.stringify(pages).replaceAll('<','\\u003c');
 const router=`const pages=${serialized};function show(){const t=document.createElement('template');t.innerHTML=pages[location.hash.slice(1)]||pages['/'];document.querySelector('main').replaceWith(t.content);const b=document.getElementById('developing-theme');b.addEventListener('click',()=>{document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark'});window.scrollTo(0,0)}window.addEventListener('hashchange',show);show();`;
 const snapshot=JSON.parse(fs.readFileSync(commentsPath,'utf8'));
 const previewClient=`import {installCommentLinks} from '${root}/web/comment-links';import {createCommentsReader} from '${root}/web/comments';import {refreshDiscussionCounts} from '${root}/web/comment-counts';
 const pages=${JSON.stringify(snapshot.pages).replaceAll('<','\\u003c')};
 const fetcher=async(input)=>{const q=new URL(String(input),'https://preview.example').searchParams;const id=q.get('storyId'),key=[id,q.get('parentId')||id,q.get('offset')||'0'].join(':');return pages[key]?Response.json(pages[key]):new Response('Not saved in this preview',{status:404});};
 const refresh=()=>void refreshDiscussionCounts(${JSON.stringify(stories.map(s=>({id:s.hnId})))},undefined,fetcher);window.addEventListener('hashchange',refresh);refresh();
 installCommentLinks(${JSON.stringify(stories.map(s=>({id:s.hnId,headline:s.sourceTitle})))},'/reader-assets/comments-0000000000000000.js',undefined,undefined,undefined,async()=>({createCommentsReader}),{stylesReady:true,fetcher});`;
 const previewJS=(await build({stdin:{contents:previewClient,resolveDir:root,loader:'ts'},bundle:true,write:false,minify:true,format:'iife',target:'es2020'})).outputFiles[0].text.replaceAll('</script','<\\/script');
 const previewBanner=banner.replace('Not live coverage.','Not live coverage. Comments are saved Hacker News discussions from '+snapshot.capturedAt.slice(0,10)+'.');
 const html=api.renderDevelopingIndex(news).replace(/<link[^>]+>/g,'').replace('<script src="/developing-news-theme.js" defer></script>','').replace('</head>',()=>'<style>'+css+'</style></head>').replace('<body>',()=>'<body>'+previewBanner).replace('</body>',()=>'<script>'+router+'</script><script>'+previewJS+'</script></body>');
 // Replacement callbacks preserve minifier identifiers such as $ followed by &&.
 for(const [,script] of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new Script(script);
 fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,html);fs.rmSync(dir,{recursive:true,force:true});console.log(destination);process.exit();
}
const savedComments=fs.existsSync(commentsPath)?JSON.parse(fs.readFileSync(commentsPath,'utf8')):null;
const server=http.createServer(async(req,res)=>{
 try{
  const request=new Request('http://127.0.0.1:8793'+req.url),url=new URL(request.url);
  let response=await api.developingRoute(request,env);
  if(!response&&url.pathname==='/')response=new Response(api.withDevelopingNews(api.renderEdition(edition,'design-preview'),news),{headers:{'Content-Type':'text/html; charset=utf-8'}});
  if(!response&&url.pathname==='/api/comments'){
   const q=url.searchParams,id=q.get('storyId'),key=[id,q.get('parentId')||id,q.get('offset')||'0'].join(':');
   const page=savedComments?.pages[key];response=page?Response.json(page):new Response('Discussion snapshot unavailable',{status:404});
  }
  if(!response&&url.pathname==='/api/edition')response=Response.json(edition);
  if(!response&&url.pathname==='/api/archive')response=Response.json({dates:[]});
  response??=api.assetResponse(request)??new Response('Not found',{status:404});
  if(response.headers.get('content-type')?.includes('text/html'))response=new Response((await response.text()).replace('<body>','<body>'+banner),{headers:response.headers});
  response=await api.secureResponse(response);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.writeHead(500);res.end('Preview unavailable');}
});
server.listen(8793,'127.0.0.1',()=>console.log('Developing News preview: http://127.0.0.1:8793/developing-news'));
const stop=()=>{server.close();fs.rmSync(dir,{recursive:true,force:true});process.exit();};process.on('SIGINT',stop);process.on('SIGTERM',stop);
