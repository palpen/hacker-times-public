import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import{build,transform}from'esbuild';import{pathToFileURL}from'node:url';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex').slice(0,16);
fs.mkdirSync('public/edition-assets',{recursive:true});
const js=(await build({entryPoints:['web/reader.ts'],charset:'utf8',bundle:true,write:false,minify:true,format:'iife',target:'es2020'})).outputFiles[0].contents;
const comments=(await build({entryPoints:['web/comments.ts'],bundle:true,write:false,minify:true,format:'esm',target:'es2020'})).outputFiles[0].contents;
const font=fs.readFileSync('public/fonts/ManufacturingConsent-HackerTimes.woff2');
const fontURL='/reader-assets/masthead-'+hash(font)+'.woff2';
const css=(await transform(fs.readFileSync('app/globals.css','utf8').replaceAll('/fonts/ManufacturingConsent-HackerTimes.woff2',fontURL),{loader:'css',minify:true,target:'es2020'})).code;
const commentsCss=(await transform(fs.readFileSync('web/comments.css','utf8'),{loader:'css',minify:true,target:'es2020'})).code;
const assets={css:'/reader-assets/paper-'+hash(css)+'.css',js:'/reader-assets/reader-'+hash(js)+'.js',font:fontURL,comments:'/reader-assets/comments-'+hash(comments)+'.js',commentsCss:'/reader-assets/comments-'+hash(commentsCss)+'.css'};
fs.writeFileSync('public/edition-assets/'+path.basename(assets.comments),comments);
fs.writeFileSync('public/edition-assets/'+path.basename(assets.commentsCss),commentsCss);
fs.writeFileSync('public/edition-assets/'+path.basename(assets.css),css);fs.writeFileSync('public/edition-assets/'+path.basename(assets.js),js);
fs.writeFileSync('lib/edition-assets.ts','// Generated deterministically. Preserve old hashed assets for archived editions.\nexport const editionAssets='+JSON.stringify(assets)+';\n');
const content={};
for(const name of fs.readdirSync('public/edition-assets'))if(/\.(js|css)$/.test(name)){const body=fs.readFileSync('public/edition-assets/'+name,'utf8');content['/reader-assets/'+name]={type:name.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8',text:body,etag:hash(body)};}
content[fontURL]={type:'font/woff2',base64:font.toString('base64'),etag:hash(font)};
fs.writeFileSync('lib/inline-assets.ts','// Generated generic assets only: no edition/user data. Served after the private Sites gate.\nexport const inlineAssets:Record<string,{type:string;text?:string;base64?:string;etag:string}>='+JSON.stringify(content)+';\n');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ht-prebuild-'));
try{const out=path.join(tmp,'renderer.mjs');await build({entryPoints:['lib/render-edition.ts'],bundle:true,platform:'node',format:'esm',outfile:out});const {renderEdition}=await import(pathToFileURL(out));const edition=JSON.parse(fs.readFileSync('data/published-seed.json'));const version='bundled-'+hash(JSON.stringify(edition)+renderEdition(edition,'content-version-placeholder')+JSON.stringify(assets));fs.writeFileSync('data/prebuilt.html',renderEdition(edition,version));fs.writeFileSync('data/prebuilt-version.json',JSON.stringify({version}));}finally{fs.rmSync(tmp,{recursive:true,force:true})}
// These assets contain no user-specific data. Authentication is still platform-owned.
fs.writeFileSync('public/_headers','/edition-assets/*\n  Cache-Control: public, max-age=31536000, immutable\n/fonts/ManufacturingConsent-HackerTimes.woff2\n  Cache-Control: public, max-age=31536000, immutable\n');
console.log(JSON.stringify({readerJSBytes:js.length,commentsJSBytes:comments.length,commentsCSSBytes:Buffer.byteLength(commentsCss),cssBytes:Buffer.byteLength(css),fontBytes:font.length,prebuiltHTMLBytes:fs.statSync('data/prebuilt.html').size,assets}));
