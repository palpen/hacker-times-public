import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {unstable_dev} from 'wrangler';
import {validateDispatchContext} from './validate-staging-config.mjs';

validateDispatchContext(process.env);
if(!process.env.CLOUDFLARE_API_TOKEN)throw new Error('Existing deployment credential required.');
const directory=mkdtempSync(join(tmpdir(),'hacker-times-inspect-'));
const config=join(directory,'wrangler.json');
writeFileSync(config,JSON.stringify({name:'hacker-times-private-inspection',account_id:'dc81a3cb74492ea63c9f3e14f13711a2',compatibility_date:'2026-05-15',workers_dev:false,durable_objects:{bindings:[{name:'NEWSROOM',class_name:'Newsroom',script_name:'hacker-times-production'}]}}));
let worker;
try{
  worker=await unstable_dev(fileURLToPath(new URL('./publisher-diagnostic-worker.mjs',import.meta.url)),{config,local:false,ip:'127.0.0.1',port:0,logLevel:'error',experimental:{disableExperimentalWarning:true,showInteractiveDevSession:false,watch:false}});
  const response=await worker.fetch('/status');
  if(!response.ok)throw new Error('Private publisher inspection failed: '+response.status);
  console.log('Publisher diagnostic:',JSON.stringify(await response.json()));
}finally{
  await worker?.stop();
  rmSync(directory,{recursive:true,force:true});
}
