import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {validateDispatchContext, validateStagingConfig} from './validate-staging-config.mjs';

const flags = ['MUTATIONS_ENABLED', 'LIVE_FETCH_ENABLED', 'PUBLICATION_ENABLED',
  'SCHEDULE_ENABLED', 'AUTO_EDITORIAL_ENABLED', 'MODEL_API_ENABLED'];

export function validateScheduledConfig(config) {
  // Only activation and the half-hour cron differ from the existing reviewed
  // Worker. Preserve its namespace, budgets, model, rates and approved custom domains.
  if (!flags.every(key => config?.vars?.[key] === 'true') ||
      !isDeepStrictEqual(config?.triggers, {crons: ['*/30 * * * *']})) {
    throw new Error('Scheduled configuration requires six explicit live flags and one half-hour cron.');
  }
  const staging = structuredClone(config);
  for (const flag of flags) staging.vars[flag] = 'false';
  staging.triggers = {crons: []};
  validateStagingConfig(staging);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== '--github')) {
      throw new Error('Usage: node scripts/validate-scheduled-config.mjs [--github]');
    }
    if (process.argv[2] === '--github') validateDispatchContext(process.env);
    let config;
    try {
      config = JSON.parse(readFileSync(new URL('../wrangler.scheduled.jsonc', import.meta.url), 'utf8'));
    } catch {
      throw new Error('Scheduled configuration must be readable strict JSON.');
    }
    validateScheduledConfig(config);
    console.log('Scheduled configuration verified: half-hour cron, unchanged storage and spending limits.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
