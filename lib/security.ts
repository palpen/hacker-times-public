import {themeInitScript} from './theme';
export class RequestError extends Error { constructor(message:string,public status=400){super(message);} }
// Enforce byte and time limits before JSON.parse; Content-Length is only an early hint.
export async function boundedBytes(message:Request|Response,limit:number,timeout=15_000):Promise<Uint8Array>{
 const length=message.headers.get('content-length');if(length&&(!/^\d+$/.test(length)||Number(length)>limit))throw new RequestError('Request body too large',413);
 const reader=message.body?.getReader();if(!reader)return new Uint8Array();
 const chunks:Uint8Array[]=[];let size=0;let timer:ReturnType<typeof setTimeout>|undefined;
 const expired=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{reject(new RequestError('Body read timed out',408));void reader.cancel().catch(()=>{});},timeout);});
 try{while(true){const {done,value}=await Promise.race([reader.read(),expired]);if(done)break;size+=value.byteLength;if(size>limit)throw new RequestError('Request body too large',413);chunks.push(value);}const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}return bytes;}
 finally{clearTimeout(timer);void reader.cancel().catch(()=>{});}
}
export async function boundedBody(message:Request|Response,limit:number,timeout=15_000):Promise<string>{return new TextDecoder('utf-8',{fatal:true}).decode(await boundedBytes(message,limit,timeout));}
export async function jsonBody(request:Request,limit=160_000):Promise<Record<string,unknown>>{
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))throw new RequestError('Expected application/json',415);
 let value:unknown;try{value=JSON.parse(await boundedBody(request,limit));}catch(e){if(e instanceof RequestError)throw e;throw new RequestError('Invalid JSON');}
 if(!value||typeof value!=='object'||Array.isArray(value))throw new RequestError('Expected a JSON object');return value as Record<string,unknown>;
}
export function sameOriginOperation(request:Request){const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)throw new RequestError('Cross-origin operation not allowed',403);if(request.headers.get('sec-fetch-site')==='cross-site')throw new RequestError('Cross-site operation not allowed',403);}
let hash:Promise<string>|undefined;
async function themeHash(){return hash??=crypto.subtle.digest('SHA-256',new TextEncoder().encode(themeInitScript)).then(d=>btoa(String.fromCharCode(...new Uint8Array(d))));}
export async function secureResponse(response:Response):Promise<Response>{
 const headers=new Headers(response.headers);
 headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer');
 headers.set('Strict-Transport-Security','max-age=31536000');
 headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=(), usb=()');
 if(headers.get('content-type')?.includes('text/html'))headers.set('Content-Security-Policy',`default-src 'none'; script-src 'self' 'sha256-${await themeHash()}'; script-src-attr 'none'; style-src 'self'; style-src-attr 'none'; img-src 'self' https:; font-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com; upgrade-insecure-requests`);
 if(!headers.has('cache-control'))headers.set('Cache-Control','private, no-store');
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
