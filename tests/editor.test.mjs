import assert from'node:assert/strict';import fs from'node:fs';import os from'node:os';import path from'node:path';import{build}from'esbuild';import{pathToFileURL}from'node:url';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ht-editor-'));
try{
 async function mod(name){const f=path.join(tmp,name+'.mjs');await build({entryPoints:['lib/'+name+'.ts'],bundle:true,platform:'node',format:'esm',loader:{'.md':'text','.html':'text'},outfile:f});return import(pathToFileURL(f));}
 const {mcpResponse}=await mod('mcp');const {newsApi}=await mod('api');const {requireOwner}=await mod('editor');let reads=0,writes=0;
 const env={HACKER_TIMES_OWNER_EMAIL:'owner@example.com',HACKER_TIMES_EDITOR_MUTATIONS_ENABLED:'false',BUCKET:{get:async()=>{reads++;return null},put:async()=>{writes++}}};
 const owner={'oai-authenticated-user-id':'site-scoped-id','oai-authenticated-user-email':'owner@example.com'};
 const req=(method,params={},headers={})=>new Request('https://site.example/mcp',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
 assert.throws(()=>requireOwner(new Request('https://site.example'),env));assert.throws(()=>requireOwner(new Request('https://site.example',{headers:{...owner,'oai-authenticated-user-email':'viewer@example.com'}}),env));assert.throws(()=>requireOwner(new Request('https://site.example',{headers:owner}),{}));
 assert.equal((await mcpResponse(req('server/discover'),env)).status,200);const list=await (await mcpResponse(req('tools/list'),env)).json();const names=list.result.tools.map(t=>t.name);assert.equal(new Set(names).size,names.length);for(const name of ['get_editor_status','get_workflow','get_edition','get_archive','fetch_candidates','publish_edition','rebuild_edition','get_editorial_status','stage_article','record_editorial_failure','validate_staged_edition','publish_staged_edition'])assert.ok(names.includes(name));
 for(const headers of [{},{'OAI-Sites-Authorization':'Bearer test-only'},{'oai-authenticated-user-email':'owner@example.com'},{...owner,'oai-authenticated-user-email':'viewer@example.com'}]){const r=await mcpResponse(req('tools/call',{name:'get_editor_status'},headers),env);assert.equal(r.status,403);}
 let r=await mcpResponse(req('tools/call',{name:'get_editor_status'},owner),env);let data=await r.json();assert.equal(data.result.structuredContent.authorized,true);assert.equal(data.result.structuredContent.mutationsEnabled,false);
 for(const name of ['fetch_candidates','publish_edition','rebuild_edition','stage_article','record_editorial_failure','validate_staged_edition','publish_staged_edition']){data=await(await mcpResponse(req('tools/call',{name},owner),env)).json();assert.equal(data.result.isError,true);}assert.equal(writes,0);assert.equal(reads,0);
 r=await mcpResponse(req('tools/call',{name:'get_editor_status'},{...owner,Origin:'https://evil.example'}),env);assert.equal(r.status,403);
 r=await mcpResponse(req('tools/call',{name:'get_editor_status',arguments:{extra:true}},owner),env);assert.equal(r.status,400);
 for(const url of ['/api/edition','/api/rebuild','/api/candidates'])for(const method of ['POST','PUT','DELETE','PATCH'])assert.equal((await newsApi(new Request('https://site.example'+url,{method,headers:owner}),env)).status,405);
 for(const url of ['/api/workflow','/api/candidates','/api/rebuild'])assert.equal((await newsApi(new Request('https://site.example'+url,{headers:owner}),env)).status,404);
 assert.equal(writes,0);assert.equal(reads,0);
 // These unit identities emulate the managed dispatch contract; live spoof checks are separate.
 console.log('PASS: owner allowlist/site-scoped identity, no token-only/anonymous/viewer authority, mutations fail closed before storage, strict tool arguments/Origin, all old web writers and candidate/workflow endpoints disabled.');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
