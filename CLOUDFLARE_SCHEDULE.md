# Cloudflare migration and half-hour refresh

The owner requested the entire site move to their Cloudflare account, with
ChatGPT Sites retired after the replacement is verified. The intended reader is
`https://hackertimes.ca`; the independent Worker is
`https://hacker-times-production.pspenano.workers.dev`.

## Scheduled deployment

`wrangler.scheduled.jsonc` enables the existing guarded publisher and installs
one Cloudflare cron, `*/30 * * * *` (every hour at :00 and :30 UTC). Durable Object
alarms continue a selected edition between ticks. This is a refresh attempt
cadence, not a guarantee that an incomplete or blocked edition will publish.

The account, Worker, `Newsroom` binding, `production-v1` singleton and migration
history are unchanged. Complete-selection validation,
durable holds, lead history, model reservations and atomic publication remain in
force. API spending remains capped internally at USD 1/day and USD 5/month;
Cloudflare charges are separate. The existing remote `OPENAI_API_KEY` is preserved.

The manual `Deploy Cloudflare scheduled publisher` GitHub workflow accepts only
`migration/cloudflare-owned`. It shares deployment concurrency and the existing
branch-restricted credential environment with the staging workflow, validates
without credentials, then deploys from a clean runner at the exact tested SHA.
The environment is still named `cloudflare-staging`; it grants access to this
same Worker. The scheduled validator rejects changed budgets/storage, extra
routes, alternate environments and plaintext secrets.

Deploy locally after the full checks and a pushed commit:

```
node scripts/validate-scheduled-config.mjs
npx wrangler deploy --config wrangler.scheduled.jsonc
```

To stop automatic publishing, deploy the existing `wrangler.production.jsonc`
configuration through `Deploy Cloudflare staging`. It explicitly disables all
six live flags and removes cron. Do not roll back or delete the Durable Object.
After domain cutover, first reconcile routes with both configs so a pause does
not accidentally alter the reader's domain binding.

## Cutover gate

On November 12, 2026 UTC, an initial metadata-only selection failed the old
hardcoded story-ID blocklist. The owner subsequently requested removal of that
list. The blocklist and its enforcement calls have been removed; model refusals,
durable safety holds and complete-edition validation remain in force. No stored
authority or history is reset. DNS remains on the working site until the
independent backend produces and verifies a complete edition.

Before moving the domain, verify a successful scheduled publication; matching
HTML/API versions and complete story counts; archives, reader assets and
comments; and operational recovery for the existing namespace. Images and old
managed archives are not imported by this implementation. Automatic articles
currently omit images pending a visual verification workflow.

The existing Sites attachment is `appgdom_6ae92d1a8b788191aa85663de11d466f` for
project `appgprj_6ae7d39bcfd0819185d3d4352e087cf3`. Preserve it until the Cloudflare
replacement is ready. Then configure and verify the Cloudflare custom domain,
remove the old attachment and retire the old publisher. Do not treat a successful
Worker deployment or enabled health flag as proof that a news edition published.
