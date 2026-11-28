import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {validateDispatchContext} from './validate-staging-config.mjs';

validateDispatchContext(process.env);
const recipient=process.env.MONITOR_ALERT_TO;
if(!recipient||!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(recipient))throw Error('Verified MONITOR_ALERT_TO secret required.');
const config=JSON.parse(readFileSync('wrangler.monitor.jsonc','utf8'));
if(config.name!=='hacker-times-monitor'||config.account_id!=='dc81a3cb74492ea63c9f3e14f13711a2'||config.workers_dev!==false||config.preview_urls!==false||config.routes||JSON.stringify(config.triggers)!==JSON.stringify({crons:['2-57/5 * * * *']}))throw Error('Unexpected monitor deployment target.');
if(JSON.stringify(config.services)!==JSON.stringify([{binding:'PUBLISHER_RECOVERY',service:'hacker-times-production',entrypoint:'PublisherRecoveryObserver'}]))throw Error('Expected the read-only publisher recovery binding.');
config.main=resolve(config.main);
config.vars={...config.vars,ALERT_TO:recipient};
config.send_email=[{name:'EMAIL',destination_address:recipient}];
const directory=mkdtempSync(join(tmpdir(),'hacker-times-monitor-'));
try{
 const file=join(directory,'wrangler.json');writeFileSync(file,JSON.stringify(config),{mode:0o600});
 const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--config',file],{stdio:'inherit'});
 if(result.status!==0)throw Error('Monitor deployment failed');
}finally{rmSync(directory,{recursive:true,force:true});}
