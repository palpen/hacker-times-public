// Chunked JSON avoids the Durable Object KV 128 KiB per-value limit. Every call
// that changes a blob runs inside the same storage transaction as its root.
export type Store = Pick<DurableObjectStorage,'get'|'put'|'delete'>;
const CHUNK=12_000; // UTF-16 code units; even worst-case UTF-8 stays below 64 KiB.
export async function readBlob<T>(store:Store,key:string):Promise<T|null>{
 const count=await store.get<number>(key+'/count');if(count===undefined)return null;
 if(!Number.isInteger(count)||count<1||count>400)throw Error('Invalid stored object manifest');
 let text='';for(let i=0;i<count;i++){const part=await store.get<string>(key+'/'+i);if(typeof part!=='string')throw Error('Incomplete stored object');text+=part;}
 return JSON.parse(text) as T;
}
export async function writeBlob(store:Store,key:string,value:unknown){
 const text=JSON.stringify(value);if(text.length>4_800_000)throw Error('Stored object exceeds size bound');
 const previous=await store.get<number>(key+'/count')??0,count=Math.max(1,Math.ceil(text.length/CHUNK));
 for(let i=0;i<count;i++)await store.put(key+'/'+i,text.slice(i*CHUNK,(i+1)*CHUNK));
 for(let i=count;i<previous;i++)await store.delete(key+'/'+i);
 await store.put(key+'/count',count);
}
export async function digest(value:unknown){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');}

// Floating-point policy diagnostics may differ in the last bits across V8 builds.
// Compare audit-only diagnostics at 1e-9 precision, retaining original values. IDs,
// timestamps and engagement counts are integers and remain exact.
export function equivalent(a:unknown,b:unknown){
 const canonical=(v:unknown)=>JSON.stringify(v,(_key,x)=>typeof x==='number'&&!Number.isInteger(x)?Math.round(x*1e9)/1e9:x);
 return canonical(a)===canonical(b);
}
