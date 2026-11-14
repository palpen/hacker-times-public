import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateScheduledConfig} from './validate-scheduled-config.mjs';
import {validateDispatchContext} from './validate-staging-config.mjs';

export function validateLiveTriggers(config, {readers, schedules, subdomain}) {
  const expected = [...config.routes.map(route => 'https://'+route.pattern), 'https://hacker-times-production.pspenano.workers.dev'].sort();
  if (!Array.isArray(readers) || JSON.stringify(readers.map(reader=>reader.origin).sort()) !== JSON.stringify(expected) ||
      readers.some(reader=>reader.status!==200 || reader.health?.mode!=='production' || reader.health.publicationEnabled!==true || reader.health.scheduleEnabled!==true || !/^e-[a-f0-9]{24}$/.test(reader.version) || reader.headerVersion!==reader.version) ||
      new Set(readers.map(reader=>reader.version)).size!==1 ||
      !Array.isArray(schedules?.schedules) || JSON.stringify(schedules.schedules.map(schedule => schedule.cron).sort()) !== JSON.stringify(config.triggers.crons) ||
      subdomain?.enabled !== true) {
    throw new Error('Public readers, workers.dev access or schedule do not match the reviewed configuration; no trigger changes were attempted.');
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

export async function deployScheduledVersion({config, sha, readTriggers, runWrangler}) {
  validateScheduledConfig(config);
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Exact reviewed commit SHA required.');
  validateLiveTriggers(config, await readTriggers());
  const version = uploadedVersion(runWrangler(['versions', 'upload', '--config', 'wrangler.scheduled.jsonc', '--tag', sha, '--message', 'Reviewed commit '+sha]));
  runWrangler(['versions', 'deploy', version+'@100', '--config', 'wrangler.scheduled.jsonc', '--yes', '--message', 'Reviewed commit '+sha]);
  const deployment = JSON.parse(runWrangler(['deployments', 'status', '--config', 'wrangler.scheduled.jsonc', '--json']));
  verifyDeployment(deployment, version);
  validateLiveTriggers(config, await readTriggers());
  return {version, deploymentId:deployment.id, createdAt:deployment.created_on, commit:sha};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    validateDispatchContext(process.env);
    const config = JSON.parse(readFileSync(new URL('../wrangler.scheduled.jsonc', import.meta.url), 'utf8'));
    validateScheduledConfig(config);
    const token = process.env.CLOUDFLARE_API_TOKEN;
    if (!token) throw new Error('Cloudflare deployment credential required.');
    const root = 'https://api.cloudflare.com/client/v4/accounts/'+config.account_id;
    const read = async path => {
      const response = await fetch(root+path, {headers:{Authorization:'Bearer '+token}, signal:AbortSignal.timeout(30_000)});
      const value = await response.json();
      if (!response.ok || !value.success) throw new Error('Cloudflare read '+path+' failed ('+response.status+'); codes: '+(value.errors??[]).map(error=>error.code).join(','));
      return value.result;
    };
    const result = await deployScheduledVersion({config, sha:process.env.GITHUB_SHA,
      readTriggers:async()=>{
        // A code-only release never changes domains. Check their actual public
        // responses without requiring the deployment token to read DNS/zone data.
        const [readers,schedules,subdomain] = await Promise.all([
          Promise.all([...config.routes.map(route=>'https://'+route.pattern),'https://hacker-times-production.pspenano.workers.dev'].map(async origin=>{
            const [edition,health]=await Promise.all(['/api/edition','/healthz'].map(path=>fetch(origin+path,{signal:AbortSignal.timeout(30_000)})));
            if (!health.ok) throw new Error('Public reader health check failed: '+origin);
            const body=await edition.json();
            return {origin,status:edition.status,version:body.publicationVersion,headerVersion:edition.headers.get('x-edition-version'),health:await health.json()};
          })),
          read('/workers/scripts/'+config.name+'/schedules'),
          read('/workers/services/'+config.name+'/environments/production/subdomain'),
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
    console.log('Verified release:', JSON.stringify(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
