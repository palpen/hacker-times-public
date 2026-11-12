import {RequestError} from './security';

const phases=['current_list','history','items'] as const;
const reasons=['http','content_type','payload','transport','request_limit'] as const;
export type CollectionDetails={phase:typeof phases[number];reason:typeof reasons[number];upstreamStatus:number|null};

export function parseCollectionDetails(value:unknown):CollectionDetails|null{
 if(!value||typeof value!=='object')return null;
 const d=value as CollectionDetails;
 if(!phases.includes(d.phase)||!reasons.includes(d.reason)||!(d.upstreamStatus===null||Number.isInteger(d.upstreamStatus)&&d.upstreamStatus>=100&&d.upstreamStatus<=599))return null;
 return {phase:d.phase,reason:d.reason,upstreamStatus:d.upstreamStatus};
}

/** Fixed diagnostic fields only: never log URLs, response bodies or credentials. */
export class CollectionError extends RequestError{
 constructor(message:string,public details:CollectionDetails){super(message,502);}
}
export function collectionFailure(error:unknown,phase:CollectionDetails['phase'],message:string):CollectionError{
 if(error instanceof CollectionError)return error;
 const reason=error instanceof Error&&/too many subrequests/i.test(error.message)?'request_limit':
  error instanceof SyntaxError||error instanceof RequestError&&error.status===413?'payload':'transport';
 return new CollectionError(message,{phase,reason,upstreamStatus:null});
}
