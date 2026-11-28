import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateScheduledConfig} from './validate-scheduled-config.mjs';
import {validateDispatchContext, validateReleaseContext, validateStagingConfig} from './validate-staging-config.mjs';

const halfHour = '*/30 * * * *';
const versionId = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const unexpectedLiveState = () => new Error('Public readers, workers.dev access or schedule do not match the reviewed active/paused configuration.');

function scheduleState({schedules,subdomain}) {
  if (subdomain?.enabled !== true || !Array.isArray(schedules?.schedules)) throw unexpectedLiveState();
  if (!schedules.schedules.length) return false;
  if (schedules.schedules.length === 1 && schedules.schedules[0]?.cron === halfHour) return true;
  throw unexpectedLiveState();
}

function readerState(config, readers) {
  const expected = [...config.routes.map(route => 'https://'+route.pattern), 'https://hacker-times-production.pspenano.workers.dev'].sort();
  if (!Array.isArray(readers) || JSON.stringify(readers.map(reader=>reader.origin).sort()) !== JSON.stringify(expected) ||
      readers.some(reader=>reader.status!==200 || !/^e-[a-f0-9]{24}$/.test(reader.version) || reader.headerVersion!==reader.version) ||
      new Set(readers.map(reader=>reader.version)).size!==1) throw unexpectedLiveState();
  for (const enabled of [true,false]) {
    if (readers.every(({health})=>health?.mode==='production'&&health.publicationEnabled===enabled&&health.scheduleEnabled===enabled)) return enabled;
  }
  throw unexpectedLiveState();
}

export function validateLiveTriggers(config, live) {
  const active = config.vars.SCHEDULE_ENABLED === 'true';
  if (readerState(config,live.readers)!==active || scheduleState(live)!==active) throw unexpectedLiveState();
}

function verifyDomains(config, domains) {
  const expected=config.routes.map(route=>route.pattern).sort();
  if (!Array.isArray(domains) || domains.some(domain=>domain.service!==config.name||domain.environment!=='production'||domain.enabled!==true) ||
      JSON.stringify(domains.map(domain=>domain.hostname).sort())!==JSON.stringify(expected)) throw new Error('Custom domains do not match the reviewed Worker configuration.');
}

export function uploadedVersion(output) {
  const matches = [...output.matchAll(/Worker Version ID:\s*([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})/g)];
  if (matches.length !== 1) throw new Error('Cannot identify the uploaded version; refusing to deploy a guessed version.');
  return matches[0][1];
}

export function verifyDeployment(value, version) {
  if (value?.versions?.length !== 1 || value.versions[0].version_id !== version || value.versions[0].percentage !== 100) {
    throw new Error('The uploaded Worker version is not serving 100% of traffic.');
  }
}

export async function waitForUploadedVersion(version, {readVersion, pause = ms => new Promise(resolve => setTimeout(resolve, ms))}) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const value = await readVersion(version);
      if (value?.id !== version) throw new Error('Uploaded version readback did not match the expected version.');
      return value;
    } catch (error) {
      // Retry only the known read-after-upload visibility error. This never
      // repeats an upload or activation, or masks authentication/transport errors.
      if (error?.codes?.length !== 1 || error.codes[0] !== 100146 || attempt === 5) throw error;
      await pause(1000 * 2 ** attempt);
    }
  }
}

export async function deployScheduledVersion({config, sha, readTriggers, readVersion, readMigrationTag, runWrangler, setSchedules, operation = 'deploy', repairVersion, readControlState}) {
  if (!['deploy', 'pause', 'resume'].includes(operation)) throw new Error('Expected deploy, pause or resume.');
  if (operation === 'pause') validateStagingConfig(config); else validateScheduledConfig(config);
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Exact reviewed commit SHA required.');
  if (typeof readMigrationTag !== 'function') throw new Error('Remote migration state readback required.');
  if (typeof readVersion !== 'function') throw new Error('Uploaded version readback required.');
  if (operation !== 'deploy' && typeof setSchedules !== 'function') throw new Error('Schedule control required.');
  if (repairVersion !== undefined && (operation==='deploy'||!versionId.test(repairVersion)||typeof readControlState!=='function')) throw new Error('Schedule-only repair requires an exact Worker version and a pause or resume dispatch.');
  const configPath = operation === 'pause' ? 'wrangler.production.jsonc' : 'wrangler.scheduled.jsonc';
  const tag = operation==='deploy'?sha:sha+'-'+operation;
  const active = config.vars.SCHEDULE_ENABLED==='true';
  const readDeployment=()=>JSON.parse(runWrangler(['deployments','status','--config',configPath,'--json']));
  const readRepairState=async()=>{
    const state=await readControlState();
    verifyDomains(config,state.domains);
    return state;
  };
  const live=repairVersion?await readRepairState():await readTriggers();
  const scheduled=scheduleState(live);
  const serving=repairVersion?active:readerState(config,live.readers);
  if (operation==='deploy' && (!scheduled||!serving)) throw unexpectedLiveState();
  if (scheduled!==serving && serving!==active) throw unexpectedLiveState();
  const migrationTag=await readMigrationTag();
  const targetTag=config.migrations.at(-1).tag;
  const needsMigration=migrationTag!==targetTag;
  // The only reviewed migration adds an empty namespace during a code release.
  if(needsMigration&&(operation!=='deploy'||migrationTag!=='production-v1'||targetTag!=='developing-news-v1'))throw new Error('Unreviewed Durable Object migration state; no deployment attempted.');
  let version, deployment, reuse=false;
  if (operation!=='deploy'&&serving===active) {
    deployment=readDeployment();
    const activeId=deployment?.versions?.[0]?.version_id;
    if(!versionId.test(activeId??''))throw new Error('Active Worker version readback required.');
    verifyDeployment(deployment,repairVersion||activeId);
    const current=await readVersion(activeId);
    if(current?.id!==activeId)throw new Error('Active version readback did not match.');
    reuse=current.annotations?.['workers/tag']===tag;
    if(!reuse&&(repairVersion||scheduled!==serving))throw new Error('Active Worker version tag does not match the reviewed publishing control.');
    if(reuse)version=activeId;
  }
  if(needsMigration){
    const output=runWrangler(['deploy','--config',configPath,'--tag',tag,'--message','Reviewed commit '+sha]);
    const matches=[...output.matchAll(/Current Version ID:\s*([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})/g)];
    if(matches.length!==1)throw new Error('Cannot identify migrated deployment; inspect deployment before retrying.');
    version=matches[0][1];
    if(await readMigrationTag()!==targetTag)throw new Error('Durable Object migration readback did not match.');
    await waitForUploadedVersion(version,{readVersion});
  }else if(!reuse){
    version=uploadedVersion(runWrangler(['versions','upload','--config',configPath,'--tag',tag,'--message','Reviewed commit '+sha]));
    const uploaded=await waitForUploadedVersion(version,{readVersion});
    if(operation!=='deploy'&&uploaded.annotations?.['workers/tag']!==tag)throw new Error('Uploaded publishing control version tag did not match.');
    runWrangler(['versions','deploy',version+'@100','--config',configPath,'--yes','--message','Reviewed commit '+sha]);
  }
  if(!reuse)deployment=readDeployment();
  verifyDeployment(deployment, version);
  if(operation!=='deploy'&&scheduled!==active)await setSchedules(config.triggers.crons.map(cron=>({cron})));
  if(repairVersion){
    verifyDeployment(readDeployment(),version);
    if(await readMigrationTag()!==targetTag||scheduleState(await readRepairState())!==active)throw new Error('Schedule repair readback did not match.');
  }else validateLiveTriggers(config,await readTriggers());
  return {version,deploymentId:deployment.id,createdAt:deployment.created_on,commit:sha,operation,...(repairVersion?{scheduleOnly:true}:{})};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const operation = process.argv[2];
    if (process.argv.length !== 3 || !['deploy', 'pause', 'resume'].includes(operation)) throw new Error('Usage: node scripts/deploy-scheduled-version.mjs deploy|pause|resume');
    if (operation === 'deploy') validateReleaseContext(process.env); else validateDispatchContext(process.env);
    const configPath = operation === 'pause' ? '../wrangler.production.jsonc' : '../wrangler.scheduled.jsonc';
    const config = JSON.parse(readFileSync(new URL(configPath, import.meta.url), 'utf8'));
    if (operation === 'pause') validateStagingConfig(config); else validateScheduledConfig(config);
    const token = process.env.CLOUDFLARE_API_TOKEN;
    if (!token) throw new Error('Cloudflare deployment credential required.');
    const root = 'https://api.cloudflare.com/client/v4/accounts/'+config.account_id;
    const api = async (path, body) => {
      const response = await fetch(root+path, {method: body === undefined ? 'GET' : 'PUT',
        headers:{Authorization:'Bearer '+token, 'Content-Type':'application/json'},
        ...(body === undefined ? {} : {body:JSON.stringify(body)}), signal:AbortSignal.timeout(30_000)});
      const value = await response.json();
      if (!response.ok || !value.success) {
        const codes = (value.errors??[]).map(error=>error.code);
        throw Object.assign(new Error('Cloudflare request '+path+' failed ('+response.status+'); codes: '+codes.join(',')), {codes});
      }
      return value.result;
    };
    const result = await deployScheduledVersion({config, sha:process.env.GITHUB_SHA, operation,
      repairVersion:process.env.PUBLISHING_REPAIR_VERSION||undefined,
      readMigrationTag:async()=>(await api('/workers/services/'+config.name)).default_environment?.script?.migration_tag,
      readVersion:version=>api('/workers/scripts/'+config.name+'/versions/'+version),
      setSchedules:schedules=>api('/workers/scripts/'+config.name+'/schedules', schedules),
      readControlState:async()=>{
        const [schedules,subdomain,domains]=await Promise.all([
          api('/workers/scripts/'+config.name+'/schedules'),
          api('/workers/services/'+config.name+'/environments/production/subdomain'),
          api('/workers/domains?service='+config.name+'&environment=production'),
        ]);
        return {schedules,subdomain,domains};
      },
      readTriggers:async()=>{
        const [readers,schedules,subdomain] = await Promise.all([
          Promise.all([...config.routes.map(route=>'https://'+route.pattern),'https://hacker-times-production.pspenano.workers.dev'].map(async origin=>{
            const [edition,health]=await Promise.all(['/api/edition','/healthz'].map(path=>fetch(origin+path,{signal:AbortSignal.timeout(30_000)})));
            if (!health.ok) throw new Error('Public reader health check failed: '+origin);
            const body=await edition.json();
            return {origin,status:edition.status,version:body.publicationVersion,headerVersion:edition.headers.get('x-edition-version'),health:await health.json()};
          })),
          api('/workers/scripts/'+config.name+'/schedules'),
          api('/workers/services/'+config.name+'/environments/production/subdomain'),
        ]);
        return {readers,schedules,subdomain};
      },
      runWrangler:args=>{
        const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js',...args], {encoding:'utf8', maxBuffer:4*1024*1024});
        if (result.error) throw new Error('Could not start Wrangler.');
        if (result.status !== 0) {
          process.stdout.write((result.stdout??'').split(token).join('***'));
          process.stderr.write((result.stderr??'').split(token).join('***'));
          throw new Error('Wrangler failed; inspect the active deployment before retrying.');
        }
        if (!args.includes('--json')) process.stdout.write(result.stdout.split(token).join('***'));
        return result.stdout;
      },
    });
    console.log('Verified production operation:', JSON.stringify(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
