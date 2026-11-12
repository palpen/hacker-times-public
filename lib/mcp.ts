import {editionLimits} from './contracts';
import {editorCall,requireOwner} from './editor';
import {jsonBody,RequestError,sameOriginOperation} from './security';
const empty={type:'object',properties:{},additionalProperties:false};
const readonly={readOnlyHint:true,destructiveHint:false,openWorldHint:false};
export const editorTools=[
 {name:'get_editor_status',description:'Verify this caller is the Hacker Times owner and check whether publishing is enabled. Read-only.',inputSchema:empty,annotations:readonly},
 {name:'get_workflow',description:'Read the authoritative twice-hourly Hacker Times editorial/update instructions. Owner only.',inputSchema:empty,annotations:readonly},
 {name:'get_edition',description:'Read the persisted current Hacker Times edition and publication version, or a UTC date archive. Owner only.',inputSchema:{type:'object',properties:{date:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'}},additionalProperties:false},annotations:readonly},
 {name:'get_archive',description:'Read available Hacker Times archive dates. Owner only.',inputSchema:empty,annotations:readonly},
 {name:'fetch_candidates',description:'Sample current HN pages. Optional strategy month adds a bounded 30-day pool and selects independent sections (up to16 per primary desk, total bound126) and at most42 curated Today placements. New secondary Today stories are under seven days; sections are one qualified ranked list with no older-story reserve. Engagement decays with a 24-hour half-life. Omitted strategy preserves legacy34. Official HN metrics and saved selection are authoritative. Owner only; never publishes.',inputSchema:{type:'object',properties:{strategy:{type:'string',enum:['legacy','month']}},additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:true}},
 {name:'publish_edition',description:'Validate ALL selected articles against the saved source snapshot, then atomically publish a complete Hacker Times edition. Owner only. Preserve existing edition on any failure.',inputSchema:{type:'object',properties:{edition:{type:'object',properties:{generatedAt:{type:'string'},stories:{type:'array',minItems:1,maxItems:126,items:{type:'object'}}},required:['generatedAt','stories']}},required:['edition'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}},
 {name:'get_editorial_status',description:'Read owner-only staging readiness, per-article revision/provenance and safety hold. No source text is returned.',inputSchema:{type:'object',properties:{generatedAt:{type:'string'}},additionalProperties:false},annotations:readonly},
 {name:'stage_article',description:'Durably checkpoint one structured reviewed article for an immutable candidate snapshot. Never publishes. expectedRevision defaults to 0 for a new record; read status before editing. Safety stops cannot be bypassed.',inputSchema:{type:'object',properties:{generatedAt:{type:'string'},story:{type:'object'},expectedRevision:{type:'integer',minimum:0}},required:['generatedAt','story'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}},
 {name:'validate_staged_edition',description:'Validate complete staged copy against the existing authoritative edition validator without publishing or fetching sources.',inputSchema:{type:'object',properties:{generatedAt:{type:'string'}},required:['generatedAt'],additionalProperties:false},annotations:readonly},
 {name:'publish_staged_edition',description:'Assemble all staged selected articles, revalidate, then use the existing atomic publisher. Never bypass a safety stop. Read back an uncertain outcome before retrying.',inputSchema:{type:'object',properties:{generatedAt:{type:'string'}},required:['generatedAt'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}},
 {name:'record_editorial_failure',description:'Record a categorized failure without copying blocked content. safety_stop places a persistent global publication hold with no tool override. Ordinary unavailable-source handling never clears a hold.',inputSchema:{type:'object',properties:{generatedAt:{type:'string'},kind:{type:'string',enum:['source_unavailable','transient','validation','safety_stop']},storyId:{type:'integer',minimum:1}},required:['generatedAt','kind'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},
 {name:'rebuild_edition',description:'Rebuild HTML for the CURRENT verified edition after an authorized code/design deployment, without changing news content or timestamp. Not a news refresh. Owner only.',inputSchema:empty,annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}}
];
function reply(value:unknown,status=200){return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store'}});}
export async function mcpResponse(request:Request,env:Cloudflare.Env):Promise<Response|null>{
 if(new URL(request.url).pathname!=='/mcp')return null;
 if(request.method!=='POST')return reply({error:'Method not allowed'},405);
 let id:unknown=null;
 try{
  sameOriginOperation(request);const body=await jsonBody(request,editionLimits.mcpBytes);id=typeof body.id==='string'||typeof body.id==='number'?body.id:null;
  if(body.jsonrpc!=='2.0'||typeof body.method!=='string')throw new RequestError('Invalid JSON-RPC request');
  const done=(result:unknown)=>reply({jsonrpc:'2.0',id,result});
  // Discovery contains only public schemas, never owner data or credentials.
  if(body.method==='server/discover')return done({supportedVersions:['2026-07-28'],capabilities:{tools:{}}});
  if(body.method==='initialize')return done({protocolVersion:'2026-07-28',capabilities:{tools:{}},serverInfo:{name:'Hacker Times editor',version:'5.0.0'}});
  if(body.method==='notifications/initialized')return new Response(null,{status:204});
  if(body.method==='tools/list')return done({tools:editorTools});
  if(body.method!=='tools/call')return reply({jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found'}},404);
  requireOwner(request,env); // Authorization before interpreting operation arguments.
  const params=body.params as {name?:unknown;arguments?:unknown}|undefined;
  if(!params||typeof params.name!=='string')throw new RequestError('Invalid tool request');
  const tool=editorTools.find(t=>t.name===params.name);if(!tool)throw new RequestError('Unknown tool',404);
  const args=params.arguments??{};if(!args||typeof args!=='object'||Array.isArray(args))throw new RequestError('Expected object arguments');
  const allowed=Object.keys(tool.inputSchema.properties);if(Object.keys(args).some(k=>!allowed.includes(k)))throw new RequestError('Unexpected tool argument');
  try{const result=await editorCall(params.name,args as Record<string,unknown>,request,env);return done({content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result});}
  catch(e){return done({content:[{type:'text',text:e instanceof RequestError?e.message:'Operation failed; the previous edition is retained.'}],isError:true});}
 }catch(e){return reply({jsonrpc:'2.0',id,error:{code:e instanceof RequestError&&e.status===403?-32001:-32600,message:e instanceof RequestError?e.message:'Request failed'}},e instanceof RequestError?e.status:500);}
}
