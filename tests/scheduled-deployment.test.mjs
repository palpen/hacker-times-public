import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {validateDispatchContext, validateReleaseContext} from '../scripts/validate-staging-config.mjs';
import {load} from 'js-yaml';
import {validateScheduledConfig} from '../scripts/validate-scheduled-config.mjs';
import {deployScheduledVersion, validateLiveTriggers, uploadedVersion, verifyDeployment, waitForUploadedVersion} from '../scripts/deploy-scheduled-version.mjs';

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
  const {PUBLISHING_REPAIR_VERSION,...stagingCredentials}=staging.jobs.deploy.steps.at(-1).env;
  assert.ok(PUBLISHING_REPAIR_VERSION);
  assert.deepEqual(steps.at(-1).env,stagingCredentials);
  assert.match(steps.at(-1).run, /node scripts\/deploy-scheduled-version\.mjs/);
  for (const step of [...workflow.jobs.validate.steps, ...steps.slice(0, -1)]) assert.equal(step.env, undefined);
  assert.match(steps.at(-2).run, /validate-scheduled-config\.mjs --github-release/);
  assert.match(steps.at(-2).run, /git diff --exit-code/);
  assert.match(workflow.jobs.validate.steps.find(s => /dry-run/.test(s.run)).run, /--config wrangler\.scheduled\.jsonc/);
});

const version = '12345678-1234-1234-1234-123456789abc';
const versionDetails = async id => ({id});
const triggers = () => ({readers:[...config.routes.map(route=>'https://'+route.pattern),'https://hacker-times-production.pspenano.workers.dev'].map(origin=>({origin,status:200,version:'e-'+'a'.repeat(24),headerVersion:'e-'+'a'.repeat(24),health:{mode:'production',publicationEnabled:true,scheduleEnabled:true}})),schedules:{schedules:[{cron:'*/30 * * * *'}]},subdomain:{enabled:true}});
test('code releases refuse changed domains, schedules and incomplete version activation', async () => {
  for (const mutate of [value=>value.readers.pop(), value=>value.readers[0].origin='https://other.example', value=>value.readers[0].version='e-'+'b'.repeat(24), value=>value.readers[0].health.publicationEnabled=false, value=>value.schedules.schedules.push({cron:'* * * * *'}), value=>value.subdomain.enabled=false]) {
    const changed=triggers();mutate(changed);assert.throws(()=>validateLiveTriggers(config,changed));
    let calls=0;
    await assert.rejects(deployScheduledVersion({readMigrationTag:async()=>'developing-news-v1',config,readVersion:versionDetails,sha:'a'.repeat(40),readTriggers:async()=>changed,runWrangler:()=>{calls++;}}));
    assert.equal(calls,0);
  }
  assert.throws(()=>uploadedVersion('No upload confirmation'));
  assert.throws(()=>verifyDeployment({versions:[{version_id:version,percentage:50}]},version));
  assert.throws(()=>verifyDeployment({versions:[{version_id:'wrong',percentage:100}]},version));
  const calls=[];let reads=0;
  const result=await deployScheduledVersion({readMigrationTag:async()=>'developing-news-v1',config,readVersion:versionDetails,sha:'a'.repeat(40),readTriggers:async()=>{reads++;return triggers();},runWrangler:args=>{
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

function controlFixture(operation){
  const target=operation==='pause'?pausedConfig:config,active=operation==='resume',sha='a'.repeat(40);
  const sourceVersion='22345678-1234-1234-1234-123456789abc';
  let serving=sourceVersion,scheduled=!active,uploadTag;
  const events=[];
  const readTriggers=async()=>{
    const state=(serving===version?active:!active)?triggers():pausedTriggers();
    state.schedules.schedules=scheduled?[{cron:'*/30 * * * *'}]:[];
    return state;
  };
  const options={config:target,operation,sha,readTriggers,readMigrationTag:async()=>'developing-news-v1',
    readVersion:async id=>({id,annotations:{'workers/tag':id===version?uploadTag:'b'.repeat(40)}}),
    runWrangler:args=>{
      if(args[0]==='deployments')return JSON.stringify({versions:[{version_id:serving,percentage:100}]});
      events.push(args.slice(0,2).join(' '));
      if(args[1]==='upload'){
        assert.equal(args[args.indexOf('--config')+1],operation==='pause'?'wrangler.production.jsonc':'wrangler.scheduled.jsonc');
        uploadTag=args[args.indexOf('--tag')+1];
        assert.equal(uploadTag,sha+'-'+operation);
        return 'Worker Version ID: '+version;
      }
      assert.equal(args[2],version+'@100');
      serving=version;
      return '';
    },
    setSchedules:async schedules=>{
      events.push('schedule');
      verifyDeployment({versions:[{version_id:serving,percentage:100}]},version);
      assert.deepEqual(schedules,active?[{cron:'*/30 * * * *'}]:[]);
      scheduled=active;
    },
  };
  return {options,events,active};
}

for(const operation of ['pause','resume']){
  test(operation+' retries a failed schedule write and a lost success response without another upload',async()=>{
    for(const applied of [false,true]){
      const {options,events}=controlFixture(operation);
      const write=options.setSchedules;
      options.setSchedules=async schedules=>{
        if(applied)await write(schedules);else events.push('schedule failed');
        throw new Error('fictional schedules response lost');
      };
      await assert.rejects(deployScheduledVersion(options),/response lost/);
      options.setSchedules=write;
      const result=await deployScheduledVersion(options);
      assert.equal(result.version,version);
      assert.equal(result.operation,operation);
      assert.deepEqual(events,applied?['versions upload','versions deploy','schedule']:['versions upload','versions deploy','schedule failed','schedule']);
      await deployScheduledVersion(options);
      assert.equal(events.filter(event=>event==='schedule').length,1);
    }
  });

  test(operation+' schedule-only repair verifies the exact active version even when readers fail',async()=>{
    const {options,events}=controlFixture(operation),write=options.setSchedules;
    options.setSchedules=async()=>{throw new Error('fictional schedule write failed');};
    await assert.rejects(deployScheduledVersion(options),/write failed/);
    const readTriggers=options.readTriggers;
    const readControlState=async()=>({...await readTriggers(),domains:options.config.routes.map(route=>({hostname:route.pattern,service:options.config.name,environment:'production',enabled:true}))});
    Object.assign(options,{repairVersion:version,readControlState,readTriggers:async()=>assert.fail('reader must not gate schedule-only repair'),setSchedules:write});
    await assert.rejects(deployScheduledVersion({...options,repairVersion:'22345678-1234-1234-1234-123456789abc'}),/not serving 100%/);
    await assert.rejects(deployScheduledVersion({...options,sha:'c'.repeat(40)}),/version tag/);
    await assert.rejects(deployScheduledVersion({...options,readMigrationTag:async()=>'production-v1'}),/Unreviewed/);
    await assert.rejects(deployScheduledVersion({...options,readControlState:async()=>({...await readControlState(),domains:[]})}),/Custom domains/);
    assert.deepEqual(events,['versions upload','versions deploy']);
    assert.equal((await deployScheduledVersion(options)).scheduleOnly,true);
    assert.deepEqual(events,['versions upload','versions deploy','schedule']);
  });
}

test('publishing controls reject unexpected live state and verify the requested result', async () => {
  for(const operation of ['pause','resume']){
    const {options,events,active}=controlFixture(operation);
    const unexpected=active?pausedTriggers():triggers();
    unexpected.schedules.schedules=[{cron:'* * * * *'}];
    await assert.rejects(deployScheduledVersion({...options,readTriggers:async()=>unexpected}),/do not match/);
    const wrongDirection=active?pausedTriggers():triggers();
    wrongDirection.schedules.schedules=active?[{cron:'*/30 * * * *'}]:[];
    await assert.rejects(deployScheduledVersion({...options,readTriggers:async()=>wrongDirection}),/do not match/);
    const targetReaders=active?triggers():pausedTriggers();
    targetReaders.schedules.schedules=active?[]:[{cron:'*/30 * * * *'}];
    await assert.rejects(deployScheduledVersion({...options,readTriggers:async()=>targetReaders}),/version tag/);
    assert.deepEqual(events,[]);
    const readTriggers=options.readTriggers;let reads=0;
    await assert.rejects(deployScheduledVersion({...options,readTriggers:async()=>++reads===1?readTriggers():wrongDirection}),/do not match/);
  }
  await assert.rejects(deployScheduledVersion({readMigrationTag:async()=>'developing-news-v1',config,readVersion:versionDetails,sha:'a'.repeat(40),
    readTriggers:async()=>pausedTriggers(),runWrangler:()=>assert.fail('must not deploy')}),/do not match/);
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
    if(operation==='deploy')assert.deepEqual(control.on,{push:{branches:['main']},workflow_dispatch:null});
    else {
      assert.deepEqual(Object.keys(control.on),['workflow_dispatch']);
      assert.equal(control.on.workflow_dispatch.inputs.repair_version.type,'string');
      assert.equal(control.jobs.deploy.steps.at(-1).env.PUBLISHING_REPAIR_VERSION,'${{ inputs.repair_version }}');
    }
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

test('uploaded version visibility is read back with bounded retries for Cloudflare 100146 only', async () => {
  const visibilityError = () => Object.assign(new Error('not visible'), {codes:[100146]});
  let reads = 0; const waits = [];
  await waitForUploadedVersion(version, {
    readVersion:async id=>{assert.equal(id,version);if (++reads < 3) throw visibilityError();return {id};},
    pause:async ms=>{waits.push(ms);},
  });
  assert.equal(reads, 3);
  assert.deepEqual(waits, [1000,2000]);
  reads=0; waits.length=0;
  await assert.rejects(waitForUploadedVersion(version, {
    readVersion:async()=>{reads++;throw visibilityError();}, pause:async ms=>{waits.push(ms);},
  }), /not visible/);
  assert.equal(reads,6);
  assert.deepEqual(waits,[1000,2000,4000,8000,16000]);
  for (const error of [new Error('network failure'),Object.assign(new Error('auth'),{codes:[10000]}),Object.assign(new Error('mixed'),{codes:[100146,10000]})]) {
    reads=0;
    await assert.rejects(waitForUploadedVersion(version, {readVersion:async()=>{reads++;throw error;}, pause:async()=>assert.fail('unexpected retry')}), value=>value===error);
    assert.equal(reads,1);
  }
  await assert.rejects(waitForUploadedVersion(version, {readVersion:async()=>({id:'wrong'}),pause:async()=>assert.fail('unexpected retry')}), /did not match/);
});

test('a failed uploaded-version readback cannot activate a version or change schedules', async () => {
  const calls=[];
  await assert.rejects(deployScheduledVersion({readMigrationTag:async()=>'developing-news-v1',config, sha:'a'.repeat(40),
    readTriggers:async()=>triggers(),
    readVersion:async()=>{throw new Error('readback failed');},
    runWrangler:args=>{calls.push(args);return 'Worker Version ID: '+version;},
    setSchedules:async()=>assert.fail('schedule must not change'),
  }), /readback failed/);
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].slice(0,2),['versions','upload']);
});


test('first Developing News release applies only the reviewed additive migration',async()=>{
 const calls=[];let tag='production-v1';
 const result=await deployScheduledVersion({config,sha:'a'.repeat(40),readVersion:versionDetails,readMigrationTag:async()=>tag,readTriggers:async()=>triggers(),runWrangler:args=>{
  calls.push(args);if(args[0]==='deploy'){tag='developing-news-v1';return 'Current Version ID: '+version;}
  return JSON.stringify({versions:[{version_id:version,percentage:100}],id:'migrated-release'});
 }});
 assert.equal(result.version,version);assert.equal(calls[0][0],'deploy');assert.equal(calls.some(args=>args.includes('upload')),false);
 for(const remoteTag of [undefined,'unknown','future-migration']){
  await assert.rejects(deployScheduledVersion({config,sha:'a'.repeat(40),readVersion:versionDetails,readMigrationTag:async()=>remoteTag,readTriggers:async()=>triggers(),runWrangler:()=>assert.fail('must not deploy')}),/Unreviewed/);
 }
 await assert.rejects(deployScheduledVersion({config:pausedConfig,operation:'pause',sha:'a'.repeat(40),readVersion:versionDetails,readMigrationTag:async()=> 'production-v1',readTriggers:async()=>triggers(),setSchedules:async()=>{},runWrangler:()=>assert.fail('must not migrate on pause')}),/Unreviewed/);
 let attempts=0;
 await assert.rejects(deployScheduledVersion({config,sha:'a'.repeat(40),readVersion:versionDetails,readMigrationTag:async()=> 'production-v1',readTriggers:async()=>triggers(),runWrangler:()=>{attempts++;return 'Current Version ID: '+version;}}),/migration readback/);
 assert.equal(attempts,1,'uncertain migration is never retried automatically');
});
