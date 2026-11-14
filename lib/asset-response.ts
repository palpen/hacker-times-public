import {inlineAssets} from './inline-assets';
const bodies=new Map<string,string|ArrayBuffer>();
// These routes are generic, content-addressed code/style/font assets, never edition HTML.
// The same owner-private Sites dispatch gate runs before this Worker on all paths.
export function assetResponse(request:Request):Response|null{
 const path=new URL(request.url).pathname,hashed=path.startsWith('/reader-assets/');if(!hashed&&path!=='/favicon.svg'&&path!=='/fonts/OFL-ManufacturingConsent.txt')return null;
 const asset=inlineAssets[path];if(!asset)return new Response('Not found',{status:404,headers:{'Cache-Control':'private,no-store'}});
 if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{'Cache-Control':'private,no-store'}});
 const headers={'Content-Type':asset.type,'Cache-Control':hashed?'private, max-age=31536000, immutable':'private, max-age=3600','ETag':'"'+asset.etag+'"','X-Content-Type-Options':'nosniff'};
 if(request.headers.get('if-none-match')===headers.ETag)return new Response(null,{status:304,headers});
 if(!bodies.has(path))bodies.set(path,asset.text??Uint8Array.from(atob(asset.base64!),c=>c.charCodeAt(0)).buffer);
 return new Response(request.method==='HEAD'?null:bodies.get(path),{headers});
}
