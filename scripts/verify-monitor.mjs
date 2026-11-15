import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {unstable_dev} from 'wrangler';
import {validateDispatchContext} from './validate-staging-config.mjs';
validateDispatchContext(process.env);
const recipient=process.env.MONITOR_ALERT_TO;
if(!recipient)throw Error('Verified recipient required.');
const source=JSON.parse(readFileSync('wrangler.monitor.jsonc','utf8'));
const directory=mkdtempSync(join(tmpdir(),'ht-monitor-verify-'));
const config=join(directory,'wrangler.json');
writeFileSync(config,JSON.stringify({name:'hacker-times-monitor',account_id:source.account_id,compatibility_date:source.compatibility_date,workers_dev:false,vars:{...source.vars,ALERT_TO:recipient},send_email:[{name:'EMAIL',destination_address:recipient}],durable_objects:{bindings:[{name:'MONITOR',class_name:'SiteMonitor',script_name:'hacker-times-monitor'}]}}),{mode:0o600});
const deadline=setTimeout(()=>{console.error('Monitor verification timed out.');process.exit(1);},90_000);
let worker;
try{
 worker=await unstable_dev(resolve('scripts/monitor-diagnostic-worker.ts'),{config,local:false,ip:'127.0.0.1',port:0,logLevel:'error',experimental:{disableExperimentalWarning:true,showInteractiveDevSession:false,watch:false}});
 const check=await worker.fetch('/check',{method:'POST'});
 if(!check.ok)throw Error('Live monitor check failed: '+check.status);
 const response=await worker.fetch('/status');
 if(!response.ok)throw Error('Monitor status unavailable');
 const state=await response.json();
 console.log('Live monitor state:',JSON.stringify(state));
 if(!state.checkedAt||Date.now()-Date.parse(state.checkedAt)>600_000||state.emailFailed)throw Error('Monitor has not completed a recent check or mail delivery failed');
 if(process.env.MONITOR_TEST_EMAIL==='true'){
  const test=await worker.fetch('/test-mail',{method:'POST'});
  if(!test.ok)throw Error('Test mail failed: '+test.status);
  console.log('Test mail result:',JSON.stringify(await test.json()));
 }
}finally{await worker?.stop();clearTimeout(deadline);rmSync(directory,{recursive:true,force:true});}
