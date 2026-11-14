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
routes, alternate environments and plaintext secrets. Routine releases verify
agreement between the public readers, workers.dev access and half-hour schedule, upload
one code version, activate that exact version at 100%, and verify the deployment
and unchanged schedule. They do not rewrite domain bindings. Domain health checks
use public HTTP responses, so the deployment token needs no DNS/zone read access.
This avoids the
zone-access error encountered when the scoped deployment credential tried to
reapply already-correct custom domains after a successful code upload.

This workflow requires the expected triggers to exist already. Initial setup,
schedule activation after a pause, or intentional domain changes require the
full deployment command below with the appropriate existing account access;
the routine release fails instead of silently changing those resources.

Deploy locally after the full checks and a pushed commit:

```
node scripts/validate-scheduled-config.mjs
npx wrangler deploy --config wrangler.scheduled.jsonc
```

To stop automatic publishing, deploy the existing `wrangler.production.jsonc`
configuration through `Deploy Cloudflare staging`. It explicitly disables all
six live flags and removes cron. Do not roll back or delete the Durable Object.
Both configurations preserve the apex and www custom-domain routes so a pause
does not alter the reader's domain binding.

## Cutover gate

On November 12, 2026 UTC, an initial metadata-only selection failed the old
hardcoded story-ID blocklist. The owner subsequently requested removal of that
list. The blocklist and its enforcement calls have been removed; model refusals,
durable safety holds and complete-edition validation remain in force. No stored
authority or history is reset. DNS remains on the working site until the
independent backend produces and verifies a complete edition.

The 03:30 UTC run subsequently failed during collection. Remote diagnostics
identified two causes: the HN homepage returned HTTP 419 from Cloudflare, and
the original all-at-once collector exceeded 50 external subrequests. The collector
now uses the official topstories API and private 32-item hydration batches.
See PRODUCTION_BACKEND.md for the explicit API-rank provenance and diagnostic fields.

Before moving the domain, verify a successful scheduled publication; matching
HTML/API versions and complete story counts; archives, reader assets and
comments; and operational recovery for the existing namespace. Historical Sites
archives and their original publisher image URLs were preserved during the
November 13 migration described below. Newly generated automatic articles
currently omit images pending a visual verification workflow.

The existing Sites attachment is `appgdom_6ae92d1a8b788191aa85663de11d466f` for
project `appgprj_6ae7d39bcfd0819185d3d4352e087cf3`. Preserve it until the Cloudflare
replacement is ready. Then configure and verify the Cloudflare custom domain,
remove the old attachment and retire the old publisher. Do not treat a successful
Worker deployment or enabled health flag as proof that a news edition published.


## Domain cutover preparation — November 13, 2026 UTC

The free Cloudflare zone is `bf9be3466d18e174cd7423322d440557`.
Assigned nameservers: `dilbert.ns.cloudflare.com`, `wanda.ns.cloudflare.com`.
Both `hackertimes.ca` and `www.hackertimes.ca` are attached to
`hacker-times-production`; both deployment configurations preserve these routes.
Namecheap registration remains unchanged. No email redirects were configured;
existing MX/SPF and domain-verification TXT records were preserved.

The eight public Sites editions were exported to the ignored local
`work/migration-backup` directory. The private `/import-archive` operation accepts
only the exact SHA-256 documents in `lib/production/archive-manifest.ts` and
renders their original content with the current self-contained reader assets.
It cannot replace current pointers, existing archive dates, editorial history,
reservations, budgets, or pending work. It has no public HTTP route. Seven
previously missing daily editions were indexed; the older November 12 edition
was retained by version without replacing the newer Cloudflare edition.

The scheduled-run investigation found one cached completed summary carrying old
`hnPage`/`hnRank` fields when its current candidate omitted those fields. Cached
copy now carries only editorial fields into the new authoritative selection.
This reuses confirmed results without a second model request. A regression test
covers removed optional fields and unchanged model spending.

Do not retire the public Sites attachment until apex HTTPS returns the verified
Cloudflare publication and historical archive pages load successfully.

### Verified scheduled publication and pending DNS

The November 13 05:00 UTC cron independently collected a fresh 71-story edition
and published it at 05:05:00 UTC (00:05 Toronto). Its version is
`e-97754809fe3a5402619bde41`, with snapshot timestamp
`2026-11-13T05:00:27.334Z`. Public HTML, edition API, and archive index agree;
all 71 IDs are unique. Private status shows no pending edition, active lease,
or safety hold. The schedule remains every 30 minutes, at UTC :00 and :30.

Namecheap saved the two assigned Cloudflare nameservers, verified after a page
reload. At 05:05 UTC the .ca registry and public resolvers still returned
`dns1.registrar-servers.com` and `dns2.registrar-servers.com`; the Cloudflare zone
was pending activation. This is not a completed domain cutover. Keep the Sites
custom-domain attachment and public access until the registry changes, the zone
activates, and apex HTTPS demonstrably serves the Cloudflare edition. Then
remove the old Sites domain attachment and restrict that site to owner access.
The registrar and email records do not need further changes.


### Publisher outage recovery — November 14, 2026 UTC

The zone activated November 13 at 05:10:26 UTC. By the November 14 check,
`hackertimes.ca`, `www.hackertimes.ca`, and the workers.dev address all served
the same Cloudflare publication. The live domain was no longer on Sites.

The configured half-hour cron continued firing, but the November 13 07:00 UTC
edition stalled with 70 of 71 stories staged. Fetching the selected NPR vehicle
price article (HN 50478622) from Cloudflare returned HTTP 520. The source collector
turned publisher 5xx/transport failures into retryable errors, and the runner
kept the same pending edition indefinitely. A live November 14 00:00 UTC cron
confirmed one attempted, one blocked, one remaining. This was a publication
failure, not DNS propagation, browser caching, model spending, or a stopped cron.

Publisher fetch failures now follow the existing unavailable-source policy:
retain the selected original title and link, use empty summaries, and display
"Summary unavailable." Each fresh edition fetches its sources again. HN metadata
collection and identity validation, complete-edition checks, model accounting,
and safety holds remain enforced. No story is dropped from its edition.

The regression covers HTTP 500/502/503/504/520 and transport exceptions through
complete publication. All 124 tests, TypeScript, production lint, and staging
configuration validation passed. Code commit: `4c19125`. Deployed Worker version:
`a1b3da9e-61f1-447e-9056-cc49f3b91e6e`.

Resuming the existing private alarm workflow published the stalled edition at
00:01:18 UTC as `e-3be8a61de4afa52b09c0d384`, then a fresh collection was started.


Fresh collection then exposed history-query timeouts. Two individual Algolia
queries succeeded in about five seconds each, while the original 13 concurrent
queries timed out twice. Workers permits six simultaneous connections awaiting
headers; all 13 request timers started before queued fetches could run. History
queries now run in batches of four, preserving all queries, their ordering, and
strict response validation. A batch is fully settled before propagating a failure.
The bounded live collection succeeded and pinned a fresh 73-story snapshot at
`2026-11-14T00:03:19.317Z`. A regression verifies the concurrency bound and that
all 13 queries and their order are preserved.


Final verification: subsequent scheduled snapshots at 01:30:28 UTC
(`e-abc1bf4dde803aa262b0498d`) and 02:00:27 UTC
(`e-d701fdd63a372007220ce166`, 75 stories) published successfully. Both public
hostnames and workers.dev agree; the public footer displays November 13 at
9:00 PM EST. Private status is idle with no pending edition or safety hold.
The schedule remains `*/30 * * * *` and both custom-domain routes remain attached.
History-query fix commit `2527902` is deployed at 100% as Worker version
`db4acda1-8e60-4956-ae8d-fcaf6e69b885`. Wrangler lost its final response after
upload; the deployments API independently confirmed activation, and live
schedule/domain APIs plus public readback confirmed the resulting state.

The old Sites custom-domain attachment was removed after checking apex HTTPS,
historical HTML/API, favicon/font license, and live comments. The old Site is
now owner-only (`custom`, no other users/groups); its unauthenticated edition
endpoint returns 401 and its custom-domain list is empty. Source and archives
remain preserved as a private backup. The temporary diagnostic mutation/probe
routes were removed and the local preview/tail sessions stopped.
