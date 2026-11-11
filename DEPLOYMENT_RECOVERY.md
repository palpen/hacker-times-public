# Current local change: manual administration removed

The current local revision returns 404 for all `/admin` and `/admin/*` methods.
The prior staging-admin credential instructions below are historical and must NOT
be used for new setup. No new admin credentials/origins are needed. Cloudflare
deployment credentials remain necessary for authorized source deployment. Remote
secret cleanup and this source deployment have not been performed by this revision.
Internal scheduled workflow and its safety guards remain unchanged and default-off.
See PRODUCTION_BACKEND.md for lost manual capabilities and operational consequences.

---

# Staging deployment, credentials and recovery

Prepared 2026-11-11. This is a runbook, not evidence of an account connection,
remote deployment, credential creation, provider test or completed production backup.
All live switches in `wrangler.production.jsonc` remain false. No DNS change is needed
for a temporary workers.dev address. No model key is needed for the initial default-off deployment.

## Minimum staging prerequisites

1. Verify the intended Cloudflare account, account ID, existing plan and permission
   to create the new `hacker-times-production` Worker and SQLite `Newsroom` namespace.
   SQLite Durable Objects are available on Workers Free; do not silently upgrade.
   Free quotas fail closed when exhausted. Confirm current account limits first.
2. For an existing Worker, prefer an account-owned token with Editor scoped only to
   that Worker. Durable Object permissions inherit the implementing Worker. Such
   a token cannot create the initial Worker: initial creation requires authorized
   creation access, then narrow deployment access afterward. No DNS/zone permission
   belongs in the initial workers.dev deployment token.
3. Use the authorized secure credential/login handoff. Never paste a token/password
   into chat, a repository, a URL, an automation prompt or shell command history.
   Granular Wrangler access uses `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID` supplied securely to the deployment process; OAuth login
   does not provide the same granular account-owned-token permissions.
4. After confirming the account and approval scope, deploy the existing checked
   configuration unchanged: all model, fetch, mutation, publication and scheduling
   flags false, no cron. Verify `/healthz`, unauthenticated admin rejection and the
   expected empty reader state. Record exact URL, deployment version, account,
   namespace, class, singleton object name `production-v1`, and commit.
5. Do not change namespace IDs, class/migration history or singleton name to clear
   a failure. Do not import the old managed edition or its restricted content.

## Secure application credentials

There are three separate credentials; never reuse one for another purpose.

- Cloudflare deployment token: short-lived/scoped deployment access, not a Worker
  runtime secret. Keep it in the approved deployment environment's secret store.
- Independent administration token: at least 32 cryptographically random bytes,
  generated only in an authorized secure workflow. Keep the original in an approved
  password/secret manager. Compute its SHA-256 digest without echoing the original;
  only `ADMIN_TOKEN_SHA256` is configured on the Worker. Set
  `ADMIN_ALLOWED_ORIGINS` to the exact verified HTTPS workers.dev origin, without
  trailing slash, path or wildcard. Browser requests must also be same-origin.
- OpenAI runtime key: use a dedicated project and minimally permitted project key
  for Responses creation, not an organization Admin key. Project keys are managed
  in Organization settings → project → API Keys. Use Restricted permissions where
  available. Service-account key permissions may need editing after creation.
  Store the value as a Cloudflare Worker secret named `OPENAI_API_KEY`, never a
  plain Wrangler variable, frontend value, source file or log. A secure interactive
  `wrangler secret put OPENAI_API_KEY --config wrangler.production.jsonc` is an
  option only inside an approved authenticated terminal/credential flow; do not
  put its value on the command line. Secret changes are live remote actions.

Before enabling model calls, verify `gpt-6-luna` access and current input/output
prices, get explicit USD daily/monthly limits, configure both internal limits and
provider controls, and check account billing. Current OpenAI documentation describes
separate alerts and an optional project “Enforce a hard limit” setting: verify the
actual project's control rather than assuming an alert stops requests. Do not turn
on billing, top-ups, payment methods or spending from this runbook alone.

## Integration gates, in order

1. Local fictional suites/typecheck/lint/build. All external model calls mocked.
2. Authorized remote staging with every live switch off. No model key required.
3. Separate disposable staging recovery drill using fictional records only. Exercise
   remote PITR and undo; this cannot be validated with local Miniflare.
4. Only after explicit spending authorization, a tiny fictional Responses request
   with the selected model and structured schema. Verify refusal/usage/error behavior,
   usage accounting and project limits. Do not use restricted stories as a probe.
5. Authorized metadata-only HN collection; inspect the entire pinned selection against
   the permanent restricted-ID boundary before any article sourcing or summary work.
   Any overlap stops the whole batch. Do not filter required stories or substitute.
6. Source/provenance, complete stage/validate, rendered publication/version, archive
   and comments checks. No automatic publication before its explicit launch gate.
7. Enable one approved cron only after verification; durable alarms continue bounded
   chunks between ticks. DNS cutover and retirement of another publisher are separate.

## Recovery: what is and is not a backup

Cloudflare SQLite Durable Objects offer rolling 30-day point-in-time recovery of
both SQL and KV state. `getCurrentBookmark()` captures a recovery point;
`getBookmarkForTime(timestamp)` locates approximately that time. A bookmark is NOT
an independent downloadable copy and is not protection beyond that retention window
or against loss of the account. The documented DO REST API is namespace/object
inventory; do not assume D1 export/Time Travel commands apply to Durable Objects.

No general reset or restore HTTP endpoint is implemented. Recovery is an exceptional,
authorized operation, not routine retry logic. Longer-retention independent encrypted
export/import remains an unimplemented production launch requirement if desired.

### Mandatory recovery safeguards

- Stop writes, model requests, cron and alarm execution using the existing switches.
  Verify no active runner remains. Record last publication/version, root revision,
  ledger, safety holds, pending/staged state, model reservations and spend counters.
- Preserve newest safety and accounting state outside the target before any rollback.
  Restoring an old database must NEVER erase a later safety stop, re-enable a retired
  lead/repost, replay an uncertain model call or refund unverified spending. If the
  post-bookmark authoritative changes cannot be reconstructed from trusted metadata,
  keep all processing off and escalate; do not resume from stale authority.
- Record a fresh current bookmark externally together with object identity, exact
  UTC capture time and code/schema commit. Never record it only inside the object
  that will be rolled back. Do not log authored content or secrets.
- An authorized remote recovery procedure calls
  `onNextSessionRestoreBookmark(targetBookmark)` and durably records its returned
  undo bookmark outside the object BEFORE invoking `ctx.abort()` to restart.
  Abort raises an uncatchable runtime error; an interrupted response is not proof
  that restoration failed. Inspect state before any retry. Alarms may retry after
  interruption; keep the schedule switch off during recovery.
- Verify publication HTML/API version, full counts/IDs/allocations, archives, ledger,
  restrictions and model accounting. Reapply/merge any verified later safety/ledger/
  accounting metadata without replaying article generation. Only then consider an
  explicitly authorized restart of writes. If merge tooling is absent, stay paused.

### Verified local drill and remaining remote gap

`tests/production-backend.test.mjs` cold-copies the local SQLite persistence directory
ONLY after disposing workerd. It restores into a different isolated directory and
checks exact published version, complete root/lead authority, a pending staged
checkpoint, an explicit safety hold and an unknown charged model reservation.
The restored hold still prevents publication/model processing. The original local
store separately passes restart/readback. This uses wholly fictional data.

This proves local storage-copy fidelity, not Cloudflare PITR or an importable remote
backup format. Never copy a running SQLite/WAL directory. A real remote staging
PITR restore-and-undo drill, authenticated bookmark capture, and an independent
export/restore feature remain unverified/unimplemented respectively.

## Official references verified during preparation

- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/workers/authorization/workers/
- https://developers.cloudflare.com/workers/authorization/durable-objects/
- https://developers.cloudflare.com/workers/authorization/#use-granular-permissions-with-wrangler
- https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/
- https://developers.cloudflare.com/fundamentals/api/get-started/create-token/
- https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#pitr-point-in-time-recovery-api
- https://developers.cloudflare.com/durable-objects/api/state/#abort
- https://developers.cloudflare.com/api/resources/durable_objects/subresources/namespaces/methods/list/
- https://help.openai.com/en/articles/9186755-managing-projects-in-the-api-platform
- https://developers.openai.com/api/docs/models/gpt-6-luna
