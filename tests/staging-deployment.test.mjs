import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {load} from 'js-yaml';
import {validateDispatchContext, validateStagingConfig} from '../scripts/validate-staging-config.mjs';

const config = JSON.parse(readFileSync(new URL('../wrangler.production.jsonc', import.meta.url), 'utf8'));
const workflowText = readFileSync(new URL('../.github/workflows/deploy-cloudflare-staging.yml', import.meta.url), 'utf8');
const workflow = load(workflowText);
const mutate = fn => {const changed = structuredClone(config); fn(changed); return changed;};
const rejects = fn => assert.throws(() => validateStagingConfig(mutate(fn)), /reviewed default-off policy/);

test('staging configuration pins the approved account, Worker, storage and spending bounds', () => {
  assert.doesNotThrow(() => validateStagingConfig(config));
  assert.equal(config.vars.MODEL_DAILY_LIMIT_MICRO_USD, '1000000');
  assert.equal(config.vars.MODEL_MONTHLY_LIMIT_MICRO_USD, '5000000');
  assert.equal(config.vars.MODEL_INPUT_USD_PER_MILLION, '0.125');
  assert.equal(config.vars.MODEL_OUTPUT_USD_PER_MILLION, '0.50');
});

test('every live flag must be explicitly the string false', () => {
  const flags = ['MUTATIONS_ENABLED', 'LIVE_FETCH_ENABLED', 'PUBLICATION_ENABLED',
    'SCHEDULE_ENABLED', 'AUTO_EDITORIAL_ENABLED', 'MODEL_API_ENABLED'];
  for (const flag of flags) {
    for (const value of ['true', true, false, '', null, undefined]) {
      rejects(c => {c.vars[flag] = value;});
    }
    rejects(c => {delete c.vars[flag];});
  }
});

test('changed identity, alternate storage, routes, environments and secrets fail closed', () => {
  for (const change of [
    c => {c.name = 'another-worker';},
    c => {c.account_id = '0'.repeat(32);},
    c => {delete c.account_id;},
    c => {c.main = 'worker/index.ts';},
    c => {c.workers_dev = false;},
    c => {c.triggers.crons = ['*/30 * * * *'];},
    c => {delete c.triggers;},
    c => {c.durable_objects.bindings[0].name = 'OTHER';},
    c => {c.durable_objects.bindings[0].class_name = 'Other';},
    c => {c.durable_objects.bindings[0].script_name = 'another-worker';},
    c => {c.durable_objects.bindings.push({name: 'EXTRA', class_name: 'Newsroom'});},
    c => {c.migrations[0].tag = 'reset';},
    c => {c.migrations[0].new_sqlite_classes = ['Other'];},
    c => {c.env = {production: {vars: {PUBLICATION_ENABLED: 'true'}}};},
    c => {c.routes = ['fictional.example/*'];},
    c => {c.build = {command: 'fictional-build-hook'};},
    c => {c.vars.OPENAI_API_KEY = 'fictional-secret-must-not-appear';},
    c => {c.vars.CLOUDFLARE_API_TOKEN = 'fictional-secret-must-not-appear';},
    c => {c.vars.MODEL_DAILY_LIMIT_MICRO_USD = '0';},
    c => {c.vars.MODEL_MONTHLY_LIMIT_MICRO_USD = '5000001';},
    c => {c.vars.MODEL_INPUT_USD_PER_MILLION = '0.10';},
    c => {c.vars.MODEL_OUTPUT_USD_PER_MILLION = '0.49';},
    c => {c.vars.EDITORIAL_MODEL = 'another-model';},
    c => {c.vars.MODEL_MAX_OUTPUT_TOKENS = '4096';},
  ]) rejects(change);
  assert.throws(() => validateStagingConfig({secret: 'fictional-secret-must-not-appear'}), error =>
    !error.message.includes('fictional-secret-must-not-appear'));
});

test('only manual dispatches from the exact repository and migration branch are accepted', () => {
  const context = {GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REPOSITORY: 'palpen/hacker-times-public',
    GITHUB_REF: 'refs/heads/migration/cloudflare-owned', GITHUB_SHA: 'a'.repeat(40)};
  assert.doesNotThrow(() => validateDispatchContext(context));
  for (const [key, values] of Object.entries({
    GITHUB_EVENT_NAME: ['push', 'pull_request', 'pull_request_target', 'schedule', 'workflow_call', 'workflow_run'],
    GITHUB_REPOSITORY: ['fictional-fork/hacker-times-public', 'palpen/another-repo'],
    GITHUB_REF: ['refs/heads/main', 'refs/heads/other', 'refs/tags/migration/cloudflare-owned'],
    GITHUB_SHA: ['', 'a'.repeat(39), '$(fictional-command)'],
  })) {
    for (const value of [...values, undefined]) {
      assert.throws(() => validateDispatchContext({...context, [key]: value}), /manual dispatch/);
    }
  }
});

test('workflow is manual-only, least-privilege, environment-gated and serial', () => {
  assert.deepEqual(workflow.on, {workflow_dispatch: null});
  assert.deepEqual(workflow.permissions, {contents: 'read'});
  assert.deepEqual(workflow.concurrency, {group: 'cloudflare-staging-hacker-times-production', 'cancel-in-progress': false});
  assert.deepEqual(Object.keys(workflow.jobs), ['validate', 'deploy']);
  assert.equal(workflow.jobs.validate.environment, undefined);
  assert.equal(workflow.jobs.validate['timeout-minutes'], 20);
  assert.equal(workflow.jobs.deploy.environment, 'cloudflare-staging');
  assert.equal(workflow.jobs.deploy['timeout-minutes'], 10);
  assert.equal(workflow.jobs.deploy.needs, 'validate');
  for (const job of Object.values(workflow.jobs)) {
    assert.equal(job['runs-on'], 'ubuntu-24.04');
    assert.equal(job.if, "github.event_name == 'workflow_dispatch' && github.repository == 'palpen/hacker-times-public' && github.ref == 'refs/heads/migration/cloudflare-owned'");
    assert.deepEqual(job.env, {CI: 'true', WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_CF_FETCH_ENABLED: 'false'});
    assert.equal(job.permissions, undefined);
  }
});

test('workflow pins official actions and checks out the exact SHA without persisted credentials', () => {
  for (const job of Object.values(workflow.jobs)) {
    const actions = job.steps.filter(step => step.uses);
    assert.deepEqual(actions.map(step => step.uses), [
      'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683',
      'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
    ]);
    assert.deepEqual(actions[0].with, {ref: '${{ github.sha }}', 'persist-credentials': false, 'fetch-depth': 1});
    assert.deepEqual(actions[1].with, {'node-version': '24.22.1'});
  }
});

test('only final deploy receives the token, after locked install, tests, typecheck, lint and dry-run', () => {
  const steps = workflow.jobs.deploy.steps;
  const final = steps.at(-1);
  assert.deepEqual(final.env, {CLOUDFLARE_API_TOKEN: '${{ secrets.CLOUDFLARE_API_TOKEN }}',
    CLOUDFLARE_ACCOUNT_ID: 'dc81a3cb74492ea63c9f3e14f13711a2'});
  assert.equal(final.run, 'test -n "$CLOUDFLARE_API_TOKEN"\nnode node_modules/wrangler/bin/wrangler.js deploy --config wrangler.production.jsonc\n');
  assert.equal(workflowText.match(/secrets\./g)?.length, 1);
  assert.equal(workflowText.includes('OPENAI_API_KEY'), false);
  assert.equal(workflow.env, undefined);
  for (const step of [...workflow.jobs.validate.steps, ...steps.slice(0, -1)]) {
    assert.equal(step.env, undefined);
    assert.equal(step['continue-on-error'], undefined);
    assert.equal(step.if, undefined);
  }
  const install = 'npm ci --ignore-scripts --workspaces=false --include=dev --include=optional --no-audit --no-fund';
  const deployCommands = steps.filter(step => step.run).map(step => step.run);
  assert.equal(deployCommands.length, 3);
  assert.equal(deployCommands[0], install);
  assert.match(deployCommands[1], /validate-staging-config\.mjs --github/);
  assert.match(deployCommands[1], /git diff --exit-code/);
  assert.match(deployCommands[1], /git ls-files --others --exclude-standard/);
  assert.equal(deployCommands.some(command => /--test|eslint|typescript|--dry-run/.test(command)), false);
  const commands = workflow.jobs.validate.steps.filter(step => step.run).map(step => step.run);
  assert.match(commands[0], /validate-staging-config\.mjs --github/);
  assert.equal(commands[1], install);
  assert.equal(commands[2], 'node --test tests/*.test.mjs');
  assert.equal(commands[3], 'node node_modules/typescript/bin/tsc --noEmit --incremental false');
  assert.match(commands[4], /eslint\.js lib\/production/);
  assert.equal(commands[5], 'node node_modules/wrangler/bin/wrangler.js deploy --dry-run --config wrangler.production.jsonc --outdir dist/cloudflare-staging');
  assert.match(commands[6], /validate-staging-config\.mjs --github/);
  assert.match(commands[6], /git diff --exit-code/);
  assert.match(commands[6], /git ls-files --others --exclude-standard/);
  assert.equal(commands.length, 7);
  assert.equal([...commands, ...deployCommands].some(command => /\bcurl\b|\bwget\b|--keep-vars|secret put|secret bulk|--env\b/.test(command)), false);
});
