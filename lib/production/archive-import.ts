import type {Edition} from '../contracts';
import {renderEdition} from '../render-edition';
import {RequestError} from '../security';
import {digest,readBlob,writeBlob,type Store} from './storage';
import type {Root,Publication} from './types';

// The caller supplies a code-reviewed manifest, never a request-supplied one.
// This copies previously public history; it cannot publish a new front page.
export async function importArchive(store:Store,root:Root,raw:unknown,manifest:Readonly<Record<string,string>>){
 if(!raw||typeof raw!=='object')throw new RequestError('Archived edition required');
 const edition=raw as Edition&{publicationVersion:string},date=edition.editionDate,version=edition.publicationVersion;
 if(!date||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^e-[a-f0-9]{24}$/.test(version)||manifest[date]!==await digest(raw))throw new RequestError('Archive does not match the approved migration manifest',409);
 if(!root.generatedAt||date>root.generatedAt.slice(0,10))throw new RequestError('Archive cannot be newer than the current publication',409);
 const key='version/'+version,prior=await readBlob<Publication>(store,key);
 if(prior&&await digest(prior.edition)!==await digest(edition))throw new RequestError('Archived version collision',409);
 if(!prior)await writeBlob(store,key,{version,edition,html:renderEdition(edition,version)} satisfies Publication);
 // Existing daily editions, the current pointer, revision, lease, budgets and
 // editorial ledger remain authoritative. Repeated imports are idempotent.
 const indexed=!root.archives[date];
 if(indexed)await writeBlob(store,'root',{...root,archives:{...root.archives,[date]:version}});
 return {imported:!prior,indexed,version,date};
}
