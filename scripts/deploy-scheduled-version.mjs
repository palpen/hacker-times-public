import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateScheduledConfig} from './validate-scheduled-config.mjs';
import {validateDispatchContext, validateReleaseContext, validateStagingConfig} from './validate-staging-config.mjs';

export function validateLiveTriggers(config, {readers, schedules, subdomain}, {allowTransition = false} = {}) {
  const expected = [...config.routes.map(route => 'https://'+route.pattern), 'https://hacker-times-production.pspenano.workers.dev'].sort();
  const active = config.vars.SCHEDULE_ENABLED === 'true';
  const matches = enabled => Array.isArray(readers) && readers.every(reader =>
    reader.health?.mode === 'production' && reader.health.publicationEnabled === enabled && reader.health.scheduleEnabled === enabled) &&
    Array.isArray(schedules?.schedules) && JSON.stringify(schedules.schedules.map(schedule => schedule.cron).sort()) === JSON.stringify(enabled ? ['*/30 * * * *'] : []);
  if (!Array.isArray(readers) || JSON.stringify(readers.map(reader=>reader.origin).sort()) !== JSON.stringify(expected) ||
      readers.some(reader=>reader.status!==200 || !/^e-[a-f0-9]{24}$/.test(reader.version) || reader.headerVersion!==reader.version) ||
      new Set(readers.map(reader=>reader.version)).size!==1 ||
      !(matches(active) || (allowTransition && matches(!active))) || subdomain?.enabled !== true) {
    throw new Error('Public readers, workers.dev access or schedule do not match the reviewed active/paused configuration.');
  }
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

export async function deployScheduledVersion({config, sha, readTriggers, runWrangler, setSchedules, operation = 'deploy'}) {
  if (!['deploy', 'pause', 'resume'].includes(operation)) throw new Error('Expected deploy, pause or resume.');
  if (operation === 'pause') validateStagingConfig(config); else validateScheduledConfig(config);
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Exact reviewed commit SHA required.');
  if (operation !== 'deploy' && typeof setSchedules !== 'function') throw new Error('Schedule control required.');
  validateLiveTriggers(config, await readTriggers(), {allowTransition: operation !== 'deploy'});
  const configPath = operation === 'pause' ? 'wrangler.production.jsonc' : 'wrangler.scheduled.jsonc';
  const version = uploadedVersion(runWrangler(['versions', 'upload', '--config', configPath, '--tag', sha, '--message', 'Reviewed commit '+sha]));
  runWrangler(['versions', 'deploy', version+'@100', '--config', configPath, '--yes', '--message', 'Reviewed commit '+sha]);
  const deployment = JSON.parse(runWrangler(['deployments', 'status', '--config', configPath, '--json']));
  verifyDeployment(deployment, version);
  // Only explicit publishing controls change cron. Never rewrite domains or storage.
  if (operation !== 'deploy') await setSchedules(config.triggers.crons.map(cron => ({cron})));
  validateLiveTriggers(config, await readTriggers());
  return {version, deploymentId:deployment.id, createdAt:deployment.created_on, commit:sha, operation};
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
      if (!response.ok || !value.success) throw new Error('Cloudflare request '+path+' failed ('+response.status+'); codes: '+(value.errors??[]).map(error=>error.code).join(','));
      return value.result;
    };
    const result = await deployScheduledVersion({config, sha:process.env.GITHUB_SHA, operation,
      setSchedules:schedules=>api('/workers/scripts/'+config.name+'/schedules', schedules),
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
