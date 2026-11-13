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
