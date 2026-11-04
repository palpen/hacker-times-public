import {build}from'esbuild';import fs from'node:fs';import os from'node:os';import path from'node:path';import{pathToFileURL}from'node:url';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ht-render-'));const out=path.join(tmp,'test.cjs');
try{await build({entryPoints:['tests/render-entry.tsx'],bundle:true,platform:'node',format:'cjs',jsx:'automatic',outfile:out});await import(pathToFileURL(out));}finally{fs.rmSync(tmp,{recursive:true,force:true})}
