import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {validateDispatchContext, validateReleaseContext} from '../scripts/validate-staging-config.mjs';
import {load} from 'js-yaml';
import {validateScheduledConfig} from '../scripts/validate-scheduled-config.mjs';
import {deployScheduledVersion, validateLiveTriggers, uploadedVersion, verifyDeployment} from '../scripts/deploy-scheduled-version.mjs';

const config = JSON.parse(readFileSync(new URL('../wrangler.scheduled.jsonc', import.meta.url), 'utf8'));
const readWorkflow = name => load(readFileSync(new URL('../.github/workflows/'+name, import.meta.url), 'utf8'));
const workflow = readWorkflow('deploy-production.yml');
const staging = readWorkflow('pause-publishing.yml');

test('scheduled deployment preserves authority and caps while enabling one half-hour trigger', () => {
  assert.doesNotThrow(() => validateScheduledConfig(config));
  assert.deepEqual(config.routes,[{pattern:'hackertimes.ca',custom_domain:true},{pattern:'www.hackertimes.ca',custom_domain:true}]);
  for (const mutate of [
    c => {c.name += '-reset';},
    c => {c.migrations[0].tag = 'reset';},
    c => {c.durable_objects.bindings[0].class_name = 'Other';},
    c => {c.triggers.crons.push('* * * * *');},
    c => {c.triggers.crons = ['* * * * *'];},
    c => {c.vars.MODEL_MONTHLY_LIMIT_MICRO_USD = '10000000';},
    c => {c.vars.MODEL_INPUT_USD_PER_MILLION = '0.01';},
    c => {c.vars.OPENAI_API_KEY = 'fictional-key';},
    c => {c.vars.SCHEDULE_ENABLED = true;},
    c => {c.vars.PUBLICATION_ENABLED = 'false';},
    c => {c.routes = [{pattern: 'fictional.example', custom_domain: true}];},
    c => {c.env = {production: {}};},
    c => {delete c.routes;},
  ]) {
    const changed = structuredClone(config);
    mutate(changed);
    assert.throws(() => validateScheduledConfig(changed));
  }
});

test('scheduled and pause deployments serialize against the same Worker with isolated credentials', () => {
  assert.deepEqual(workflow.on, {push:{branches:['main']}, workflow_dispatch: null});
  assert.deepEqual(workflow.permissions, {contents: 'read'});
  assert.deepEqual(workflow.concurrency, staging.concurrency);
  assert.equal(workflow.jobs.validate.environment, undefined);
  assert.equal(workflow.jobs.deploy.environment, staging.jobs.deploy.environment);
  assert.equal(workflow.jobs.deploy.needs, 'validate');
  for (const [name, job] of Object.entries(workflow.jobs)) {
    assert.equal(job.if, "(github.event_name == 'push' || github.event_name == 'workflow_dispatch') && github.repository == 'palpen/hacker-times-public' && github.ref == 'refs/heads/main'");
    assert.deepEqual(job.steps.filter(s => s.uses).map(({uses,with: options})=>({uses,with:options})), staging.jobs[name].steps.filter(s => s.uses).map(({uses,with: options})=>({uses,with:options})));
    assert.equal(job.steps.some(s => s['continue-on-error']), false);
  }
  const steps = workflow.jobs.deploy.steps;
  assert.deepEqual(steps.at(-1).env, staging.jobs.deploy.steps.at(-1).env);
  assert.match(steps.at(-1).run, /node scripts\/deploy-scheduled-version\.mjs/);
  for (const step of [...workflow.jobs.validate.steps, ...steps.slice(0, -1)]) assert.equal(step.env, undefined);
  assert.match(steps.at(-2).run, /validate-scheduled-config\.mjs --github-release/);
  assert.match(steps.at(-2).run, /git diff --exit-code/);
  assert.match(workflow.jobs.validate.steps.find(s => /dry-run/.test(s.run)).run, /--config wrangler\.scheduled\.jsonc/);
});

const version = '12345678-1234-1234-1234-123456789abc';
const triggers = () => ({readers:[...config.routes.map(route=>'https://'+route.pattern),'https://hacker-times-production.pspenano.workers.dev'].map(origin=>({origin,status:200,version:'e-'+'a'.repeat(24),headerVersion:'e-'+'a'.repeat(24),health:{mode:'production',publicationEnabled:true,scheduleEnabled:true}})),schedules:{schedules:[{cron:'*/30 * * * *'}]},subdomain:{enabled:true}});
test('code releases refuse changed domains, schedules and incomplete version activation', async () => {
  for (const mutate of [value=>value.readers.pop(), value=>value.readers[0].origin='https://other.example', value=>value.readers[0].version='e-'+'b'.repeat(24), value=>value.readers[0].health.publicationEnabled=false, value=>value.schedules.schedules.push({cron:'* * * * *'}), value=>value.subdomain.enabled=false]) {
    const changed=triggers();mutate(changed);assert.throws(()=>validateLiveTriggers(config,changed));
    let calls=0;
    await assert.rejects(deployScheduledVersion({config,sha:'a'.repeat(40),readTriggers:async()=>changed,runWrangler:()=>{calls++;}}));
    assert.equal(calls,0);
  }
  assert.throws(()=>uploadedVersion('No upload confirmation'));
  assert.throws(()=>verifyDeployment({versions:[{version_id:version,percentage:50}]},version));
  assert.throws(()=>verifyDeployment({versions:[{version_id:'wrong',percentage:100}]},version));
  const calls=[];let reads=0;
  const result=await deployScheduledVersion({config,sha:'a'.repeat(40),readTriggers:async()=>{reads++;return triggers();},runWrangler:args=>{
    calls.push(args);
    return args.includes('upload')?'Worker Version ID: '+version:args.includes('status')?JSON.stringify({versions:[{version_id:version,percentage:100}],id:'release-id'}):'';
  }});
  assert.equal(reads,2);assert.equal(result.version,version);
  assert.deepEqual(calls[1].slice(0,3),['versions','deploy',version+'@100']);
  assert.equal(calls.some(args=>args[0]==='triggers'||args[0]==='deploy'),false);
});

const pausedConfig = JSON.parse(readFileSync(new URL('../wrangler.production.jsonc', import.meta.url), 'utf8'));
const pausedTriggers = () => {
  const value = triggers();
  value.schedules.schedules = [];
  for (const reader of value.readers) reader.health = {mode:'production', publicationEnabled:false, scheduleEnabled:false};
  return value;
};

test('pause and resume change only the reviewed cron after activating the exact code version', async () => {
  for (const operation of ['pause', 'resume']) {
    const target = operation === 'pause' ? pausedConfig : config;
    const finalState = operation === 'pause' ? pausedTriggers : triggers;
    const initialState = operation === 'pause' ? triggers : pausedTriggers;
    for (const initial of [initialState, finalState]) {
      const events = []; let reads = 0;
      const result = await deployScheduledVersion({config:target, operation, sha:'a'.repeat(40),
        readTriggers:async()=>++reads === 1 ? initial() : finalState(),
        runWrangler:args=>{
          events.push(args);
          return args.includes('upload') ? 'Worker Version ID: '+version : args.includes('status') ? JSON.stringify({versions:[{version_id:version,percentage:100}]}) : '';
        },
        setSchedules:async schedules=>{events.push(schedules);},
      });
      assert.equal(result.operation, operation);
      assert.equal(reads, 2);
      assert.deepEqual(events.at(-1), operation === 'pause' ? [] : [{cron:'*/30 * * * *'}]);
      assert.equal(events[0][events[0].indexOf('--config')+1], operation === 'pause' ? 'wrangler.production.jsonc' : 'wrangler.scheduled.jsonc');
      assert.equal(events.some(args=>args[0] === 'deploy' || args[0] === 'triggers'), false);
    }
  }
});

test('publishing controls reject unexpected live state and verify the requested result', async () => {
  const unexpected = pausedTriggers();
  unexpected.schedules.schedules = [{cron:'* * * * *'}];
  let mutations = 0;
  const runWrangler = args => {
    mutations++;
    return args.includes('upload') ? 'Worker Version ID: '+version : args.includes('status') ? JSON.stringify({versions:[{version_id:version,percentage:100}]}) : '';
  };
  for (const operation of ['pause', 'resume']) {
    await assert.rejects(deployScheduledVersion({config:operation === 'pause' ? pausedConfig : config,
      operation, sha:'a'.repeat(40), readTriggers:async()=>unexpected, runWrangler, setSchedules:async()=>{mutations++;}}));
  }
  assert.equal(mutations, 0);
  await assert.rejects(deployScheduledVersion({config, operation:'resume', sha:'a'.repeat(40),
    readTriggers:async()=>pausedTriggers(), runWrangler, setSchedules:async()=>{}}), /do not match/);
  await assert.rejects(deployScheduledVersion({config, sha:'a'.repeat(40),
    readTriggers:async()=>pausedTriggers(), runWrangler}), /do not match/);
});

test('automatic checks have no deployment credentials or production mutations', () => {
  const check = readWorkflow('check-production.yml');
  assert.deepEqual(check.on, {pull_request:null, push:{branches:['main']}});
  assert.deepEqual(check.permissions, {contents:'read'});
  assert.deepEqual(Object.keys(check.jobs), ['validate']);
  const job = check.jobs.validate;
  assert.equal(job.environment, undefined);
  const text = JSON.stringify(job);
  assert.equal(/secrets\.|CLOUDFLARE_API_TOKEN|deploy-scheduled-version\.mjs (deploy|pause|resume)/.test(text), false);
  assert.match(text, /--dry-run/);
  assert.match(text, /node --test tests\/\*\.test\.mjs/);
});

test('automatic releases and manual controls share main-only restrictions and serialization', () => {
  for (const [file, name, operation] of [
    ['deploy-production.yml', 'Deploy production', 'deploy'],
    ['pause-publishing.yml', 'Pause automatic publishing', 'pause'],
    ['resume-publishing.yml', 'Resume automatic publishing', 'resume'],
  ]) {
    const control = readWorkflow(file);
    assert.equal(control.name, name);
    assert.deepEqual(control.on, operation === 'deploy' ? {push:{branches:['main']}, workflow_dispatch:null} : {workflow_dispatch:null});
    assert.deepEqual(control.concurrency, {group:'hacker-times-production', 'cancel-in-progress':false});
    assert.equal(control.jobs.deploy.environment, 'production');
    assert.equal(control.jobs.deploy.needs, 'validate');
    for (const job of Object.values(control.jobs)) {
      const event = operation === 'deploy' ? "(github.event_name == 'push' || github.event_name == 'workflow_dispatch')" : "github.event_name == 'workflow_dispatch'";
      assert.equal(job.if, event + " && github.repository == 'palpen/hacker-times-public' && github.ref == 'refs/heads/main'");
    }
    assert.match(control.jobs.deploy.steps.at(-1).run, new RegExp('deploy-scheduled-version\\.mjs '+operation));
  }
});

const releaseContext = event => ({GITHUB_EVENT_NAME:event, GITHUB_REPOSITORY:'palpen/hacker-times-public', GITHUB_REF:'refs/heads/main', GITHUB_SHA:'a'.repeat(40)});

test('only main pushes and manual main releases can deploy; publishing controls remain manual', () => {
  for (const event of ['push', 'workflow_dispatch']) {
    const context = releaseContext(event);
    assert.doesNotThrow(()=>validateReleaseContext(context));
    for (const change of [
      {GITHUB_REPOSITORY:'fictional-fork/hacker-times-public'},
      {GITHUB_REF:'refs/heads/feature'}, {GITHUB_REF:'refs/pull/1/merge'},
      {GITHUB_REF:'refs/tags/main'}, {GITHUB_REF:undefined},
      {GITHUB_SHA:undefined}, {GITHUB_SHA:'a'.repeat(39)},
    ]) assert.throws(()=>validateReleaseContext({...context,...change}), /approved repository main/);
  }
  for (const event of ['pull_request', 'pull_request_target', 'workflow_run', 'workflow_call', 'schedule', undefined]) {
    assert.throws(()=>validateReleaseContext(releaseContext(event)), /push or manual dispatch/);
  }
  assert.throws(()=>validateDispatchContext(releaseContext('push')), /manual dispatch/);
  assert.doesNotThrow(()=>validateDispatchContext(releaseContext('workflow_dispatch')));
});

test('CLI permits automatic release validation without permitting automatic pause or resume', () => {
  const env = {...process.env,...releaseContext('push'),CLOUDFLARE_API_TOKEN:''};
  const run = args => spawnSync(process.execPath, args, {env,encoding:'utf8'});
  assert.equal(run(['scripts/validate-scheduled-config.mjs','--github-release']).status, 0);
  assert.equal(run(['scripts/validate-scheduled-config.mjs','--github']).status, 1);
  const deploy = run(['scripts/deploy-scheduled-version.mjs','deploy']);
  assert.equal(deploy.status, 1);
  assert.match(deploy.stderr, /Cloudflare deployment credential required/);
  for (const operation of ['pause','resume']) {
    const result = run(['scripts/deploy-scheduled-version.mjs',operation]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /manual dispatch/);
  }
});
