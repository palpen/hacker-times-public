import {commentsApi} from './comments';
import {readPublication,readArchive,archiveDates} from './publication';
const headers={'content-type':'application/json; charset=utf-8','cache-control':'private, no-store','x-content-type-options':'nosniff'};
function reply(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers});}
// Reader-only API. No identity header or Site service token can turn these routes
// into editors. All publication/source-fetch operations exist only at owner-only /mcp.
export async function newsApi(request:Request,env:Cloudflare.Env):Promise<Response|null>{
 const url=new URL(request.url);if(!url.pathname.startsWith('/api/'))return null;
 if(!['GET','HEAD'].includes(request.method))return reply({error:'Web API mutations are disabled'},405);
 if(url.pathname==='/api/comments')return commentsApi(request,env);
 if(!['/api/edition','/api/archive'].includes(url.pathname))return reply({error:'Not found'},404);
 try{
  if(url.pathname==='/api/edition'){
   const date=url.searchParams.get('date');if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))return reply({error:'Invalid edition date'},400);
   if(date){const record=await readArchive(request,env,date);return record?reply({...record.edition,publicationVersion:record.version,persisted:true}):reply({error:'Edition not found'},404);}
   const result=await readPublication(request,env,true);return reply({...result.publication.current.edition,publicationVersion:result.publication.current.version,persisted:result.source!=='bundled-fallback'});
  }
  return reply({dates:await archiveDates(request,env)});
 }catch{return reply({error:'Edition temporarily unavailable'},503);}
}
