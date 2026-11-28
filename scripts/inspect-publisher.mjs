import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {unstable_dev} from 'wrangler';
import {validateDispatchContext} from './validate-staging-config.mjs';

const localRead=process.argv.length===3&&process.argv[2]==='--local-read'&&!process.env.GITHUB_ACTIONS;
if(!localRead)validateDispatchContext(process.env);
if(!process.env.CLOUDFLARE_API_TOKEN)throw new Error('Existing deployment credential required.');
const generatedAt=process.env.RECOVERY_GENERATED_AT,basePublicationVersion=process.env.RECOVERY_BASE_VERSION,revision=process.env.RECOVERY_BASE_REVISION;
const requested=Boolean(generatedAt||basePublicationVersion||revision);
if(localRead&&requested)throw new Error('Local inspection accepts no recovery inputs.');
if(requested&&(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(generatedAt??'')||
  !/^(empty|e-[a-f0-9]{24})$/.test(basePublicationVersion??'')||!/^\d+$/.test(revision??'')||!Number.isSafeInteger(Number(revision))))throw new Error('Supply the pending timestamp, base publication version and base revision together.');
const recovery=requested?{generatedAt,basePublicationVersion,baseRevision:Number(revision),githubRun:process.env.GITHUB_RUN_ID+'/'+process.env.GITHUB_RUN_ATTEMPT}:null;
if(recovery&&!/^\d{1,20}\/\d{1,8}$/.test(recovery.githubRun))throw new Error('GitHub dispatch identity required.');
const directory=mkdtempSync(join(tmpdir(),'hacker-times-inspect-'));
const config=join(directory,'wrangler.json');
writeFileSync(config,JSON.stringify({name:'hacker-times-production',account_id:'dc81a3cb74492ea63c9f3e14f13711a2',compatibility_date:'2026-05-15',workers_dev:false,...(recovery?{vars:{EXPIRED_BATCH_RECOVERY:JSON.stringify(recovery)}}:{}),durable_objects:{bindings:[{name:'NEWSROOM',class_name:'Newsroom',script_name:'hacker-times-production'},{name:'DEVELOPING_NEWS',class_name:'DevelopingNews',script_name:'hacker-times-production'}]}}));
const deadline=setTimeout(()=>{console.error('Private preview timed out. Check the private status before retrying.');process.exit(1);},90_000);
let worker;
try{
  worker=await unstable_dev(fileURLToPath(new URL('./publisher-diagnostic-worker.mjs',import.meta.url)),{config,local:false,ip:'127.0.0.1',port:0,logLevel:'error',experimental:{disableExperimentalWarning:true,showInteractiveDevSession:false,watch:false}});
  const response=recovery?await worker.fetch('/recover-expired',{method:'POST'}):await worker.fetch('/status');
  if(!response.ok)throw new Error('Private publisher operation failed ('+response.status+'). Run a local inspection for details.');
  if(localRead)console.log('Publisher diagnostic:',JSON.stringify(await response.json()));
  else console.log(recovery?'Recovery recorded. Use local inspection to read the audit.':'Publisher inspection passed. Use local inspection to read the results.');
}finally{
  await worker?.stop();
  clearTimeout(deadline);
  rmSync(directory,{recursive:true,force:true});
}
