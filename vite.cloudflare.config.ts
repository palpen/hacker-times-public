import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';

// Separate synthetic-only graph. No managed app routes or production bindings.
export default defineConfig({
  publicDir: false,
  plugins: [cloudflare({
    inspectorPort: false,
    config: {
      name: 'hacker-times-migration-preview',
      main: './worker/independent.ts',
      compatibility_date: '2026-05-15',
      compatibility_flags: ['nodejs_compat'],
    },
  })],
});
