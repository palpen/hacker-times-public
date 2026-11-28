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

### Cloudflare collection compatibility

The independent collector reads the first 90 ordered IDs from the official
`https://hacker-news.firebaseio.com/v0/topstories.json` endpoint. It does not scrape
the HN homepage: a Cloudflare remote reproduction returned HTTP 419 (`Sorry`) for
that request. For the existing ranking contract, the first 30 API entries are the
lead/top pool and `hnPage` denotes a group of 30 API ranks. Snapshot discovery
metadata and ranking text explicitly identify this source; the three `sourcePages`
entries are rank groups from the same API URL, not three fetched HTML pages.
The managed editor's existing HTML collection remains its default.

Monthly Algolia discovery still uses its bounded 13-query sample. Required official
item metadata is fetched in batches of at most 32 through the existing private
Newsroom binding. Each batch has a separate invocation, staying below the observed
50-external-request limit without dropping candidate stories or upgrading billing.
Calls remain fenced by the runner lease and durable hold, and external fetches run
outside the storage transaction. No public administration endpoint is added.
The complete selection is pinned only after all batches succeed.

Collection failures now carry fixed `phase`, `reason`, and `upstreamStatus` fields
through the private binding into background logs. Raw responses, source content,
URLs and credentials are never included in those diagnostic fields.

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

## Production release controls

The application now releases from `main` through **Deploy production**. Automatic
checks run on pull requests and pushes to `main`; every main update automatically
deploys after its release validation passes. Manual deployment retries remain available. The
separate **Pause automatic publishing** and **Resume automatic publishing** controls
affect this same live Worker. There is no separate staging website.

All production operations use the `production` GitHub environment restricted to
`main`, share a serial deployment group, and validate the exact event SHA in a
secret-free runner before using credentials in a fresh runner. Locked dependencies,
pinned actions, configuration guards, source cleanliness checks and immutable
version activation remain enforced. Secrets are supplied only to the final step.

`scripts/validate-staging-config.mjs` retains its historical filename and validates
the reviewed paused policy: unchanged account, Worker, Durable Object and spending
bounds, six explicit false flags and no cron. `validate-scheduled-config.mjs`
validates the corresponding active policy. No configuration resets storage.

See [CLOUDFLARE_SCHEDULE.md](CLOUDFLARE_SCHEDULE.md#production-releases) for release,
pause, resume and initial-setup instructions. Earlier default-off launch notes in
this document describe the original staging preparation, not current release policy.

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

Metadata collection can fail before any pending snapshot exists. Those failures
now retain private `runner.collectionFailure` diagnostics: the originating cron
slot, failure count/time, generic HTTP status, allowlisted collection details,
planned retry time and collection recovery time. No response bodies, URLs or
credentials are stored. Recovery here means a new snapshot was saved, not that
publication finished; public readiness still uses the published source timestamp.

Transport failures and upstream HTTP 408, 429 or 5xx responses get at most two
additional metadata attempts, one minute apart, in fresh invocations. Durable
state fences early/duplicate alarm deliveries and exhausted attempts until a new
cron slot. Successful collection resumes the ordinary validation/publication
checkpoints. Invalid payloads, content types, request limits, authorization errors,
safety holds and uncertain model outcomes are not retried by this mechanism.
These retries address a reproduced pre-snapshot recovery gap; they do not establish
the cause of the November 17 production gaps without the corresponding run logs.

## Cloudflare model transport regression (2026-11-12)

The original model adapter set Fetch `redirect: 'error'`. Cloudflare Workers
rejects that option synchronously before dispatching the request, although Node's
Fetch accepts it. A remote preview reproduced the error using an intentionally
invalid diagnostic credential: ordinary POSTs reached OpenAI and returned 401;
the original request options threw `Invalid redirect value` locally.

The adapter now uses `redirect: 'manual'` and explicitly rejects every 3xx
response, so an API credential is never forwarded to a redirect destination.
Request identity is `editorial-v2-manual-redirect`: corrected requests do not
reuse v1's locally rejected attempts. Their old reservations remain counted
conservatively; no history or budget records are deleted or refunded.

Private failure status includes allowlisted phase, HTTP status and recognized
provider error codes. Diagnostic metadata excludes provider error bodies, headers
and credentials. A bounded rejected editorial draft may be retained separately
in its private model record for validator review; it is never written to logs or
exposed through a public endpoint. Private root status exposes lease
expiry and the last claimed schedule slot without the lease token. Public
administration remains unavailable. Runtime regression coverage now executes
both the adapter and the scheduled alarm path in workerd with a synthetic
provider service, in addition to Node unit tests.

Alarm continuations dispatch storage operations directly to the current object's
handler, preserving its transaction and lease fences. They do not send network
requests back into their own namespace. Cron calls still use the private binding;
collection batches always retain separate invocations to bound their external
subrequest counts. This avoids the hosted self-call stall observed after the first
article checkpoint. The runtime model-backed alarm test and a namespace-denial
regression cover this path.

## Expired edition recovery

For phone recovery, open **Recover expired edition** from the action-needed
email or the repository’s Actions tab. Sign in to GitHub, choose `main`, and
tap **Run workflow**. The workflow looks up the exact eligible batch and queues
its replacement with the same checks as the manual operation below. A saved
audit records which GitHub run queued it. The monitor sends confirmation once
the homepage and freshness check agree that a fresh replacement is live.

The workflow finds the eligible batch at the moment it runs. If it finds none,
it reports that no recovery was needed. A safety hold stops the workflow and
triggers a separate review email.

### Detailed inspection

From a checkout of main, run `node scripts/inspect-publisher.mjs --local-read`
with the existing scoped Cloudflare deployment credential in your environment.
The temporary preview returns pending age, progress, pinned base revision and
reservation diagnostics to your terminal. GitHub Actions logs report only
whether the operation succeeded.

For a pending batch older than 48 hours, dispatch **Inspect Cloudflare publisher**
from main with its exact timestamp, pinned base publication version and base
revision. The production environment authorizes the temporary preview. The
newsroom verifies the base, pending batch, lease and safety state in one
transaction, records the GitHub run ID and attempt, and queues fresh collection.
The saved edition stays current until its replacement passes ordinary publication
checks.

The recovery keeps the old batch, checkpoints and spending history. A validated
provider receipt already saved by the runner can settle its reservation. If no
verified receipt was saved, the charge remains fully reserved. If the same
article and source evidence are selected again, the story can appear with its
original HN title and Summary unavailable, without resending the model request.
A safety hold blocks recovery and continues to block publication. Inspect again
after a failure or timeout to see whether an audit was recorded.

## Output and publisher recovery

HN can change the destination URL of an existing lead submission. Collection
uses the newly fetched official URL and authors its source again. The former
URL is retired before lead selection; the submission ID remains active if it
still wins, and is retired normally when replaced. A correction to an already
retired URL remains ineligible. Historic editions retain their original links.
The production publisher reuses a lead headline only when the article identity,
HN title, source text used for authorship and provenance still match. Engagement
counts and fetch times do not affect that comparison. An edition saved before
evidence identities were recorded uses the newly validated headline on the next
publication.

Current request identity is `editorial-v3-normalized-copy`. Single-line formatting
is requested explicitly; validated copy normalizes whitespace without changing
words. Schema, provenance, character limits and the one-sentence short summary
still apply. A confirmed output-validation failure with valid usage can receive
up to two further attempts (three total). Each known charge is settled before the next maximum charge
is reserved, and both attempts count toward the same spending limits. Unknown
transport outcomes, authentication errors and safety refusals are not covered by
this retry. Exhausted retries remain visible for investigation.

Private `model-failed` recovery validates the stored failure, selected story,
pinned source and request key. Historical output failures whose exact usage was
not saved can retain their full charge before a bounded new attempt; the ledger
is never erased. Per-story failure metadata survives later failures in a batch.

Publisher HTML is bounded to **4,000,000 decoded bytes**, with the existing
10-second per-request and 15-second body-read deadlines. The decoded-byte limit
also applies when the response is compressed or omits Content-Length. HN HTML
collection retains its smaller 1,500,000-byte bound; newspaper summary evidence
remains at 8,500 characters. Developing News full-text callers retain the complete
extracted article within the byte bound, including explicit publication dates. Declared charsets/BOMs are honored; unlabelled pages try strict
UTF-8 and then Windows-1252. JSON/API bodies remain strict UTF-8.

An HTML parser extracts article/main/body text without executing scripts. It
excludes navigation, controls, hidden elements and unrelated page furniture;
attribute values cannot leak into article text. Unstructured pages must contain
prose beyond their titles and links. When that text is absent, a descriptive
Open Graph or standard meta description can supply `page_description` evidence.
Short site labels, title-only metadata, and descriptions without a subject word
from the selected story title are discarded. This prevents a generic product
homepage description from replacing a specific article or release summary. The editorial model
still determines whether the supplied evidence supports a faithful summary;
HTML success alone is never sufficient. Invalid image metadata only omits the
image, rather than discarding usable article text.

The scheduled publisher can recover an unavailable summary from an RSS or Atom
entry whose article URL matches the selected story. It checks a same-origin feed
declared by the page or a known publisher feed. The entry must have a usable
description and a timestamp at or before the snapshot. Ambiguous matches are
discarded. A feed summary uses the existing editorial model and spending limits.

For an unreadable tutorial or explainer, the newsroom can reuse fully sourced
copy from a published edition within the preceding 72 hours. The title and
article URL must match. Live, time-sensitive and removed pages are excluded.
Reusing copy preserves the original verification date and requires no model call.
The public edition records `publisher_feed` or `archived_summary` as the summary
source and retains the original retrieval status in `articleStatus`. Model and
budget errors continue through the existing failure handling.

When the incumbent lead loses usable source evidence, its validated original HN
title and empty unavailable summaries take precedence over preserving its previous
rewritten headline. The edition can publish without changing the pinned lead
identity, retirement history, or any previously published edition. Available
incumbent copy continues to preserve its headline.

Source records and published `articleStatus` now distinguish:

- `fetch_body_too_large`, `fetch_timeout`, `fetch_body_timeout`, `fetch_body_error`
- `fetch_network_error`, `fetch_request_limit`, `fetch_decode_failed`
- `fetch_url_rejected`, `fetch_redirect_missing`, `fetch_redirect_limit`
- `fetch_processing_failed` for an unexpected extraction error
- `insufficient_source_text` for a page without usable text or description
- `non_html` for unsupported formats, including PDF
- `unavailable_http_<status>` for publisher HTTP errors, with HTTP 429 retained as
  `temporarily_rate_limited` in production source records

These fixed codes contain no exception messages, response bodies or credentials.
An unavailable source preserves the selected title/link with empty summaries;
it does not stall the edition or fabricate evidence. Source fetches are pinned
within one edition and retried in the next. Unchanged model inputs still reuse
cached copy; existing reservations and historic editions are untouched. This
change does not add browser execution, PDF extraction, video transcription,
or methods to bypass publisher access restrictions.


The final live output blocker was a false sentence boundary at a middle initial
in an author's name. Initials between names are masked for sentence segmentation
only; publication preserves the original text. Genuine multiple sentences remain
invalid. An exhausted, retained draft is revalidated against the pinned source
and current output rules before use, without a new provider request or charge.
The regression suite covers both unchanged name punctuation and rejecting a
second real sentence, plus no-cost draft reuse through the runner.


## Reader parity update

See [READER_PARITY.md](READER_PARITY.md) for the complete comparison and release boundary. After all required articles are staged, the automatic runner now collects the existing Sites v4 discussion highlights in six resumable four-thread checkpoints. Each checkpoint performs at most 24 upstream reads outside storage transactions. The final immutable snapshot is validated with the edition before atomic publication; readers and archives never recollect it. Partial/unavailable comment results remain explicit and do not alter story selection. Publisher metadata is preserved, and generated newspaper decks reuse the authored compact sentence without an extra model call. Automated image review and a protected publishing dashboard remain deferred.

## Definitive editorial HTTP rejection recovery

A parsed HTTP 403 provider rejection (after refusal/safety checks) may recover a
matching reserved text request using the same provider, model, source and budget.
The private `model-rejected` transition retains the entire original reservation,
then requires a separately budgeted retry within the existing three-attempt cap.
It also handles historical reserved requests with a retained, matching rejection.
Pinned-source identity, current snapshot, runner fencing, failure timestamp and
an already-consumed rejection marker prevent an old failure from authorizing a
later uncertain request. Timeout, transport, payload, usage and safety failures
are not eligible. Exhausted retries stay blocked; no fabricated or relabeled
source-unavailable copy is published and no budget limit is increased.
