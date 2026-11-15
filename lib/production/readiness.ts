import {call} from './runner';
import type {ProductionEnv,Publication} from './types';

export const MAX_EDITION_AGE_SECONDS=45*60;

/** Read the same current publication as the reader; never start or resume work. */
export async function readinessResponse(env:ProductionEnv):Promise<Response>{
 const headers={'Cache-Control':'no-store'};
 try{
  const publication=await call(env,'edition') as Publication;
  const generatedAt=publication.edition.generatedAt;
  const timestamp=typeof generatedAt==='string'?Date.parse(generatedAt):NaN;
  const ageMs=Date.now()-timestamp;
  const valid=Number.isFinite(ageMs)&&ageMs>=0;
  const fresh=valid&&ageMs<=MAX_EDITION_AGE_SECONDS*1000;
  return Response.json({
   status:fresh?'ready':valid?'stale':'invalid_timestamp',
   generatedAt:valid?generatedAt:null,
   ageSeconds:valid?Math.floor(ageMs/1000):null,
   maxAgeSeconds:MAX_EDITION_AGE_SECONDS,
   publicationVersion:publication.version,
  },{status:fresh?200:503,headers});
 }catch{
  return Response.json({status:'unavailable',maxAgeSeconds:MAX_EDITION_AGE_SECONDS},{status:503,headers});
 }
}
