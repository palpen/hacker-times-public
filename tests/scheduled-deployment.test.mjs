import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {load} from 'js-yaml';
import {validateScheduledConfig} from '../scripts/validate-scheduled-config.mjs';

const config = JSON.parse(readFileSync(new URL('../wrangler.scheduled.jsonc', import.meta.url), 'utf8'));
const readWorkflow = name => load(readFileSync(new URL('../.github/workflows/'+name, import.meta.url), 'utf8'));
const workflow = readWorkflow('deploy-cloudflare-scheduled.yml');
const staging = readWorkflow('deploy-cloudflare-staging.yml');

test('scheduled deployment preserves authority and caps while enabling one half-hour trigger', () => {
  assert.doesNotThrow(() => validateScheduledConfig(config));
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
  ]) {
    const changed = structuredClone(config);
    mutate(changed);
    assert.throws(() => validateScheduledConfig(changed));
  }
});

test('scheduled and pause deployments serialize against the same Worker with isolated credentials', () => {
  assert.deepEqual(workflow.on, {workflow_dispatch: null});
  assert.deepEqual(workflow.permissions, {contents: 'read'});
  assert.deepEqual(workflow.concurrency, staging.concurrency);
  assert.equal(workflow.jobs.validate.environment, undefined);
  assert.equal(workflow.jobs.deploy.environment, staging.jobs.deploy.environment);
  assert.equal(workflow.jobs.deploy.needs, 'validate');
  for (const [name, job] of Object.entries(workflow.jobs)) {
    assert.equal(job.if, staging.jobs[name].if);
    assert.deepEqual(job.steps.filter(s => s.uses), staging.jobs[name].steps.filter(s => s.uses));
    assert.equal(job.steps.some(s => s['continue-on-error']), false);
  }
  const steps = workflow.jobs.deploy.steps;
  assert.deepEqual(steps.at(-1).env, staging.jobs.deploy.steps.at(-1).env);
  assert.match(steps.at(-1).run, /deploy --config wrangler\.scheduled\.jsonc/);
  for (const step of [...workflow.jobs.validate.steps, ...steps.slice(0, -1)]) assert.equal(step.env, undefined);
  assert.match(steps.at(-2).run, /validate-scheduled-config\.mjs --github/);
  assert.match(steps.at(-2).run, /git diff --exit-code/);
  assert.match(workflow.jobs.validate.steps.find(s => /dry-run/.test(s.run)).run, /--config wrangler\.scheduled\.jsonc/);
});
