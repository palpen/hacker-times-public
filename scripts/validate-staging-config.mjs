import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';

// This deliberately accepts only the reviewed configuration. Unknown keys,
// alternate environments, routes, build hooks and plaintext secrets fail closed.
const expected = {
  $schema: 'node_modules/wrangler/config-schema.json',
  name: 'hacker-times-production',
  account_id: 'dc81a3cb74492ea63c9f3e14f13711a2',
  main: 'worker/production.ts',
  compatibility_date: '2026-05-15',
  compatibility_flags: ['nodejs_compat'],
  workers_dev: true,
  durable_objects: {bindings: [{name: 'NEWSROOM', class_name: 'Newsroom'}]},
  migrations: [{tag: 'production-v1', new_sqlite_classes: ['Newsroom']}],
  vars: {
    MUTATIONS_ENABLED: 'false',
    EDITORIAL_MODEL: 'gpt-6-luna',
    MODEL_API_ENABLED: 'false',
    AUTO_EDITORIAL_ENABLED: 'false',
    MODEL_MAX_OUTPUT_TOKENS: '1024',
    MODEL_INPUT_USD_PER_MILLION: '0.125',
    MODEL_OUTPUT_USD_PER_MILLION: '0.50',
    MODEL_DAILY_LIMIT_MICRO_USD: '1000000',
    MODEL_MONTHLY_LIMIT_MICRO_USD: '5000000',
    LIVE_FETCH_ENABLED: 'false',
    PUBLICATION_ENABLED: 'false',
    SCHEDULE_ENABLED: 'false',
  },
  triggers: {crons: []},
};

export function validateStagingConfig(config) {
  if (!isDeepStrictEqual(config, expected)) {
    // Never echo invalid configuration: it may accidentally contain a secret.
    throw new Error('Staging configuration does not match the reviewed default-off policy.');
  }
}

export function validateDispatchContext(env) {
  if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
      env.GITHUB_REPOSITORY !== 'palpen/hacker-times-public' ||
      env.GITHUB_REF !== 'refs/heads/migration/cloudflare-owned' ||
      !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '')) {
    throw new Error('Staging deployment requires a manual dispatch from the approved repository and branch.');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== '--github')) {
      throw new Error('Usage: node scripts/validate-staging-config.mjs [--github]');
    }
    if (process.argv[2] === '--github') validateDispatchContext(process.env);
    let config;
    try {
      // Keep this .jsonc file strict JSON so malformed/ambiguous input is rejected.
      config = JSON.parse(readFileSync(new URL('../wrangler.production.jsonc', import.meta.url), 'utf8'));
    } catch {
      throw new Error('Staging configuration must be readable strict JSON.');
    }
    validateStagingConfig(config);
    console.log('Reviewed staging configuration verified: six live flags off, no cron.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
