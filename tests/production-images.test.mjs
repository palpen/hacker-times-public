import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ht-images-')),file=path.join(dir,'images.mjs');
await build({entryPoints:['lib/production/images.ts'],outfile:file,bundle:true,platform:'node',format:'esm'});
const api=await import(pathToFileURL(file));
test.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
function png(width=640,height=360){const b=new Uint8Array(45),d=new DataView(b.buffer);b.set([137,80,78,71,13,10,26,10]);d.setUint32(8,13);d.setUint32(12,0x49484452);d.setUint32(16,width);d.setUint32(20,height);d.setUint32(37,0x49454e44);return b;}
const source={id:1,url:'https://fictional.example/story',kind:'article',excerpt:'A fictional paper sorting system uses colored trays.',description:'A fictional system.',imageCandidate:'https://fictional.example/photo.png'};
const config={apiKey:'fictional',model:'gpt-6-luna',maxOutputTokens:512};
const envelope=decision=>({status:'completed',usage:{input_tokens:1500,output_tokens:100,total_tokens:1600},output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(decision)}]}]});

test('image downloads validate every redirect, raster signature, dimensions, and actual byte count',async()=>{
 const bytes=png();let calls=0;
 const asset=await api.fetchImage(source.imageCandidate,async(_url,options)=>{calls++;assert.equal(options.redirect,'manual');assert.equal(options.credentials,'omit');assert.equal(options.headers.Authorization,undefined);return new Response(bytes,{headers:{'Content-Type':'image/png'}});});
 assert.equal(calls,1);assert.equal(asset.width,640);assert.ok(await api.validImageAsset(asset));
 assert.equal(await api.validImageAsset({...asset,hash:'0'.repeat(64)}),null);
 assert.equal(await api.validImageAsset({...asset,width:900}),null);
 for(const mime of ['text/html','image/svg+xml','image/gif'])await assert.rejects(()=>api.fetchImage(source.imageCandidate,async()=>new Response(bytes,{headers:{'Content-Type':mime}})));
 for(const body of [png(100,50),new Uint8Array(600001),new TextEncoder().encode('<html>not an image</html>')])await assert.rejects(()=>api.fetchImage(source.imageCandidate,async()=>new Response(body,{headers:{'Content-Type':'image/png'}})));
 for(const url of ['http://127.0.0.1/image','https://internal/image','https://private.chatgpt.site/image']){
  let count=0;await assert.rejects(()=>api.fetchImage(source.imageCandidate,async()=>{count++;return new Response(null,{status:302,headers:{Location:url}});}));assert.equal(count,1);
 }
});

test('visual review sends the actual bounded image and source evidence and accepts only a strict decision',async()=>{
 const asset={hash:await api.hashImage(png()),base64:api.encodeImage(png()),mime:'image/png',width:640,height:360};
 const reviewed=await api.reviewImage(source,asset,config,async(url,options)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');const body=JSON.parse(options.body);
  assert.equal(body.service_tier,'default');assert.equal(body.store,false);assert.equal(body.max_output_tokens,512);assert.equal(body.reasoning.effort,'none');
  assert.match(body.instructions,/untrusted data/);assert.match(body.instructions,/Reject logos/);
  assert.equal(body.input[0].content[1].image_url,'data:image/png;base64,'+asset.base64);assert.equal(body.input[0].content[1].detail,'low');
  return Response.json(envelope({approved:true,alt:'Colored trays in a fictional sorting machine.'}));
 });
 assert.equal(reviewed.result.approved,true);assert.equal(reviewed.result.hash,asset.hash);assert.equal(reviewed.usage.inputTokens,1500);
 for(const value of [{approved:true,alt:''},{approved:true,alt:'x'.repeat(281)},{approved:true,alt:'bad\u0000text'},{approved:false,alt:'Invented caption'},{approved:true,alt:'Good',url:'https://evil.example/'}]){
  await assert.rejects(()=>api.reviewImage(source,asset,config,async()=>Response.json(envelope(value))),error=>error.requested&&error.usage.inputTokens===1500);
 }
 assert.equal((await api.reviewImage(source,asset,config,async()=>Response.json(envelope({approved:false,alt:''})))).result.approved,false);
 await assert.rejects(()=>api.reviewImage(source,asset,config,async()=>Response.json({...envelope({approved:true,alt:'A machine.'}),usage:null})),error=>error.accountingUncertain&&error.usage===null);
 await assert.rejects(()=>api.reviewImage(source,asset,config,async()=>new Response(null,{status:302,headers:{Location:'https://fictional.example/'}})),error=>error.accountingUncertain);
});

test('cache identity changes with image bytes, article evidence, candidate URL, model or review policy',async()=>{
 const key=await api.imageReviewKey(source,config.model,'a'.repeat(64));
 assert.equal(await api.imageReviewKey({...source,generatedAt:'later'},config.model,'a'.repeat(64)),key);
 for(const [next,model,hash] of [[{...source,excerpt:'Changed article evidence'},config.model,'a'.repeat(64)],[{...source,imageCandidate:'https://fictional.example/other'},config.model,'a'.repeat(64)],[source,'other-model','a'.repeat(64)],[source,config.model,'b'.repeat(64)]])assert.notEqual(await api.imageReviewKey(next,model,hash),key);
});
