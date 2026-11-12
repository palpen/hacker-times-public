# Independent Cloudflare backend

This is an implementation for local verification and approved default-off staging,
**not an enabled live publisher**. The existing synthetic preview (`worker/independent.ts` and
`vite.cloudflare.config.ts`) is unchanged.

## Architecture

`worker/production.ts` is the sole public entry. It serves the pre-rendered reader
and immutable edition archives, exposes the bounded sanitized HN comments client,
and permanently rejects the removed public `/admin` and `/admin/*` routes with 404. It does not trust the
managed-Sites `oai-*` headers or forward them to a legacy writer. No legacy edition,
HTML fallback, lead-seed manifest, or managed editor is bundled.

A private SQLite-backed Durable Object named `production-v1` stores the fresh
publication authority, lead observations/retirements, pinned source snapshots,
source evidence, individual staged articles, validation fingerprints, and immutable
HTML/edition versions. Chunked JSON avoids the KV per-value size limit. Publication
and its ledger update occur in one storage transaction. No old state is imported.
Missing initialized authority fails closed; there is no reset endpoint.

Balanced lead scoring and complete month/section selection reuse existing pure
policy functions. Candidate collection pins the complete metadata selection before
source retrieval and editorial work. There is no hardcoded story-ID blocklist;
the owner requested its removal on November 12, 2026 UTC. Every selected story
still requires source evidence, staging and complete-edition validation.
Explicit new `safety_stop` records durably stop all editorial processing and
publication; no API clears them or downgrades them to source unavailability.

## Configuration (all live operations default OFF)

`wrangler.production.jsonc` defines the separate Worker, Durable Object and its
initial migration. It has no cron triggers and no configured credentials.

- `MUTATIONS_ENABLED`: gates scheduled/internal editorial writes.
- `LIVE_FETCH_ENABLED`: gates HN/publisher source collection and public comments.
- `PUBLICATION_ENABLED`: additionally gates publishing.
- `SCHEDULE_ENABLED`: additionally gates scheduled workflow execution.
- `AUTO_EDITORIAL_ENABLED`: opt in to complete source/summary/stage/validate workflow.
- `MODEL_API_ENABLED`: additionally permits calls to the configured OpenAI API.
- `EDITORIAL_MODEL`: user-selected `gpt-6-luna` by default; Responses structured JSON.
- `OPENAI_API_KEY`: approved credential, absent from this build.
- `MODEL_MAX_OUTPUT_TOKENS`: defaults to 1024, at most 4096.
- `MODEL_INPUT_USD_PER_MILLION`, `MODEL_OUTPUT_USD_PER_MILLION`: verified model rates,
  required before API calls. Rates have no assumed/default value. Requests explicitly
  set `service_tier: "default"` (Standard); the Responses API's `auto` default would
  otherwise inherit the project tier and could invalidate these cost assumptions.
  The [GPT-6 Luna pricing page](https://developers.openai.com/api/docs/models/gpt-6-luna)
  lists Standard base input at USD 0.10 per million tokens, cache writes at USD 0.125
  per million, and output at USD 0.50 per million. For conservative accounting,
  review USD 0.125/M as the input rate for **all** input tokens, not the lower base
  input rate, and USD 0.50/M for output. This covers cache-write pricing without
  assuming cache-hit discounts. The approved configuration now pins USD 0.125/M
  input and USD 0.50/M output; the API and all other live switches remain off.
  Reverify prices and the [Responses service-tier behavior](https://developers.openai.com/api/reference/resources/responses/methods/create)
  before approving or enabling live calls.
- `MODEL_DAILY_LIMIT_MICRO_USD`, `MODEL_MONTHLY_LIMIT_MICRO_USD`: explicitly approved
  positive integer spending limits in micro-US dollars (1 USD = 1,000,000). No
  default allowance. The approved configuration pins USD 1/day (`1000000`) and
  USD 5/month (`5000000`). Configuring these caps does not enable API calls.
  The per-call reservation charges 65,536 input tokens plus the
  configured output ceiling, conservatively. Confirmed valid usage settles that
  reservation atomically to the configured conservative token cost. Uncertain calls remain fully charged
  and cannot be automatically repeated.
  Verify current provider prices and billing terms before enabling. These internal
  reservations are not a substitute for provider billing alerts/limits.

## Removed public administration; retained internal workflow

The current local revision removes the complete manual public administration
surface. Every HTTP method on `/admin` and `/admin/*` returns 404 before examining
credentials, parsing a body or accessing a namespace. Managed identity headers or
a former valid bearer credential cannot revive it. No weaker replacement endpoint,
legacy publish route, direct database write, or alternate authentication path is
introduced. The production auth helper and its now-unused credential configuration have been removed.

The scheduled handler and Durable Object alarm path still call the existing private
workflow directly. They do not use HTTP admin authentication. All six activation
flags remain false and no cron is installed in source. Snapshot selection, per-story
staging, immutable evidence, budget reservations, no-replay behavior, complete-edition
validation, atomic publication and durable safety holds are unchanged.

Consequences:
- No manual HTTP status, collect, source, summarize, stage, failure, validate, publish
  or run action remains. Former admin credentials and allowed-origin configuration
  are unused by this revision.
- Public reader/archive/comments/health behavior remains unchanged. Health only
  exposes its existing mode/publication/schedule flags, not private operational state.
- Operators must use authorized Cloudflare configuration to keep/turn the existing
  schedule/live switches off. The new revision does not remove remote secrets or
  change Cloudflare security rules by itself; deployment and secret cleanup remain
  separate reviewed actions.
- A safety hold stays fail-closed; there is no reset endpoint. Unknown model calls
  remain charged and cannot be replayed. Incomplete/stale selections stay unpublished.
- Detailed private diagnosis, intentional editorial replacement, a stale-base new
  snapshot, and disaster recovery require a separately reviewed internal operator
  procedure. There is no new operator UI, alert pipeline or automated safety override.
  Removing the public controls reduces convenience, not the publication validators.

Background cron/alarm runs emit `hacker_times.background_run` JSON logs with a
fixed allowlist: trigger, outcome, exact timestamp/version, attempted/remaining/
blocked counts and a generic HTTP status on failure. They never serialize request
headers, credentials, source URLs/text, provider payloads or exception messages.
Uncaught background failures are replaced with a fixed message, without a raw
cause. Logging does not enable a provider logging plan, create alerts or expose
private state over HTTP; account log visibility/retention still needs verification.

The scheduler deduplicates 30-minute collection slots. With all separately approved
switches and credentials configured it uses bounded chunks and durable alarm
continuations. The current switches remain off. Without automatic-editorial opt-in
it only pins metadata and cannot complete publication. Deployment is limited to the
reviewed default-off staging workflow below. This change does not retry or bypass the prior
Cloudflare 1010 access denial.

## Remaining launch decisions / integration

- GPT-6 Luna is selected, with a mocked/tested Responses API adapter. The approved
  USD 1/day and USD 5/month caps are configured. Reverify current input/output prices
  and runtime credentials before separately enabling API calls. No real model API
  calls or paid usage occurred in local verification.
- The operator must read actual source evidence and write faithful one-sentence
  compact copy. The schema verifies provenance consistency, not truth. Source text
  is untrusted data, never instructions. No fallback fabricates summaries.
- Choose a production Cloudflare account/plan and approved credential setup. The
  exact cost/quota fit and production URL are not verified by a local build.
- Run local runtime tests, then deploy to a temporary address only after approval.
  Establish backups/export and restore drills for the Durable Object namespace
  before enabling production. Deleting that namespace loses authority/history;
  do not recreate it as a reset. Storage intentionally retains audit objects and
  versions; set a reviewed retention/backup plan before long-running operation.
- Verify an independent permitted complete snapshot before real publication.
- Enable one approved schedule, verify rendered version/archives/comments, and
  authorize domain cutover; retire the old publisher only after verified cutover.
- Image visual verification and a disaster-recovery operator UI are not implemented.
  Images remain omitted. Model provider billing/availability and live HN/publisher
  integration have not been tested against real content in this build.

## Manual default-off staging deployment

`.github/workflows/deploy-cloudflare-staging.yml` accepts only `workflow_dispatch`
from `palpen/hacker-times-public` at `refs/heads/migration/cloudflare-owned`.
There are no push, pull-request, fork, reusable-workflow or scheduled triggers.
The deploy job uses the `cloudflare-staging` GitHub environment, which must restrict
deployment branches to that exact branch before its scoped token is installed.

GitHub requires the workflow file on the default branch to expose manual dispatch.
Publish the identical workflow file on `main`, but keep backend changes on the
migration branch. Select `migration/cloudflare-owned` when dispatching. A dispatch
from `main` is skipped. Both jobs check out the immutable event SHA, not a moving
branch head, and do not persist GitHub credentials. Both official actions are pinned
to verified full commit SHAs. GitHub permissions are limited to `contents: read`.

A validation job without an environment or secrets installs the exact npm lockfile
with lifecycle scripts disabled, runs all fictional Node tests, checks types, lints
the backend/guards and builds the exact Worker with a Wrangler dry-run. It then
verifies the configuration again and rejects source changes or untracked files.
After success, the protected deploy job uses a fresh runner, rechecks out the same
SHA and installs locked tools with `--ignore-scripts`. Test/build processes and
modified dependencies cannot persist from validation into deployment. No tests run
in the deploy job. Wrangler and its locked runtime dependencies remain trusted.

`scripts/validate-staging-config.mjs` allows only the reviewed account, Worker,
Durable Object binding/migration, caps/rates, six explicit `"false"` flags and empty
cron list. Unknown fields, alternate environments, routes, build hooks and plaintext
secrets fail closed. The deploy job rechecks this policy and source cleanliness.
Only its final step receives the environment secret `CLOUDFLARE_API_TOKEN`.

Deployment targets account `dc81a3cb74492ea63c9f3e14f13711a2` and Worker
`hacker-times-production` through `wrangler.production.jsonc`. It does not use
`--keep-vars`, so checked default-off values replace remote plain variables.
Existing Cloudflare Worker secrets, including `OPENAI_API_KEY`, stay remote and are
neither supplied nor edited by this workflow. Deployments are serialized with
`cancel-in-progress: false`; validation has a 20-minute timeout and deployment a
10-minute timeout. There is no endpoint probe, curl verification or retry of the
prior Cloudflare 1010 denial.

Workflow source is not evidence that any GitHub run or remote deployment succeeded.
Verify the exact commit/run result and Cloudflare deployment version separately.
Do not enable live processing, cron or domain cutover through this staging workflow.

## Verification commands

Run `npm run install:ci` (with a writable npm cache when needed), then:

```
node --test tests/*.test.mjs
node scripts/validate-staging-config.mjs
npx tsc --noEmit --incremental false
npx eslint lib/production worker/production.ts lib/comments-core.ts tests/production*.mjs
npx wrangler deploy --dry-run --config wrangler.production.jsonc
```

Synthetic tests forbid network requests. They cover complete staging/validation,
transactional commit/readback, archive/version access, concurrent stage conflicts,
source provenance, image rejection, durable safety holds, unrestricted story IDs,
incumbent preservation, retirement/repost suppression, stale bases, default-off
scheduling, authentication, and missing authority. The existing stale-date policy
fixture now freezes its own clock instead of expiring 48 hours after its test date.

## Bounded automatic execution

Automatic runs use a durable five-minute fenced lease. Each invocation performs
metadata collection alone, or at most three missing articles with a 90-second
soft start deadline. Existing source/model timeouts bound each started article.
The article cursor is saved before work, and verified stages are durable checkpoints.
Durable Object alarms continue the same exact snapshot promptly, independently
of the half-hour collection tick. An interrupted lease
can expire, but an old owner cannot write or reserve another model request.
Safety-stop reports remain accepted even from expired owners.

Uncertain model calls retain their reservation and cannot be replayed. A durable
round-robin cursor allows other selected articles to finish while the blocked
article remains required and the entire edition stays unpublished. Only the current
pending snapshot can stage, validate or publish; newer collection supersedes older
work without resetting any ledger. No overlapping runner is started automatically.

With all scheduling/automatic/live/mutation switches enabled, claiming a run first
installs a five-minute durable recovery alarm. A progressing chunk schedules its
continuation after one second; a blocked/no-progress chunk backs off thirty minutes.
Completion or a safety hold cancels continuations. Alarm retries use the same lease,
source evidence, stage checkpoints and no-replay model reservations. Disabling the
schedule switch prevents alarm execution as well as cron execution.
