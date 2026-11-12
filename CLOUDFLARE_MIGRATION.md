> November 12 update: see [Cloudflare schedule and cutover status](CLOUDFLARE_SCHEDULE.md).
> The following records the earlier preparation and preserves its safety boundaries.

# Independent Cloudflare migration: preparation only

Canonical production source target: `palpen/hacker-times-public`, starting at
`eee9c0d104db6915440d38429b63e7a974e24041`. Current hosted v40 is ahead in
features but lacks some public-repository hardening. Reconcile changes, do not
overwrite the public tree wholesale. This branch is prepared for a dedicated migration-branch push, not an overwrite
of main. No deployment or DNS change has been made.

## Synthetic-only preview (security revision)

The previous restoration-enabled anonymous reader was rejected during upload review.
It has been replaced locally, not retried: `worker/independent.ts` now serves only
`examples/synthetic-preview.json`, a copy of the public repository's explicitly
fictional sample. It has no environment parameter, storage or network client,
production-publication imports, restoration flag or live comments. Caller credentials
are neither removed nor used to impersonate a production identity. All write/admin
routes remain denied. HTML is prominently labeled SYNTHETIC PREVIEW, all responses
are no-store and noindex, and archive/comments endpoints expose no real records.

The separate Vite configuration has **no R2/D1 bindings**, no Vinext/managed route
graph, and no public directory passthrough. Supplying old restoration bindings has
no effect. Do not attach production storage or connect a production domain.

Build with `npx vite build --config vite.cloudflare.config.ts`. This builds a
synthetic design preview, not a restored newspaper and not an autonomous publisher.
Any later real-data preview requires its own verified authorization boundary and
approval; this implementation intentionally has no toggle to activate it.

## Required before cutover

- Cloudflare account access was verified through the owner-authorized local browser.
  The GitHub app is connected to only this repository with owner-approved permissions.
  No deployment has been created.
- Complete production parity review after the source reconciliation below.
  This branch remains a read-only preview, not a production publisher.
- Inventory/export production R2 current/last-valid publication, immutable
  edition versions, archive index and permanent lead/repost state. Source-only
  backups are not sufficient. Verify object hashes and restore into a distinct
  bucket; never seed/reset ledgers from demo source.
- Independently verified administrative authentication and publishing
  credentials are required for any future writer. Managed Sites identity
  headers cannot be trusted on a public Worker.
- A production scheduler and durable jobs require an independently permitted
  future publishing contract and tests. Do not replay a restricted batch or
  remove required stories to evade a safety stop. Migration is not clearance.
- Verify complete reader behavior, archive and comment parity, exact edition
  version readback, backups, shadow runs and rollback before DNS cutover.
- Only after verified cutover, prevent double publishing by disabling the old
  scheduled publisher. Keep the old site and last valid edition for rollback.

Billing scope, domain access, full state export route and authenticated
Cloudflare access are still unverified. Do not incur charges or grant broad
persistent account access without the required user confirmation.

## Preparation verification (November 9)

- Public-lockfile dependency installation completed using a checkout-local npm cache.
- 60 Node tests passed; TypeScript check passed; independent Vite build passed.
- Targeted ESLint and Python masthead tests passed.
- Local Wrangler reported ready after using checkout-local config/persistence,
  but this executor could not connect to its loopback endpoint. HTTP smoke tests
  are therefore unverified, not a pass. No live account or deployment test ran.

## Source reconciliation (November 9, local only)

Ported reviewed implementation files from hosted v40 source commit
`23b0b6c80c9ec9df21dc0af031e422200012e9a6` onto the public baseline:

- Workflow 9 per-article checkpointing, revision conflict checks, complete-edition
  validation and durable safety holds. Independent Worker still exposes none of
  these managed-editor routes.
- Selection versions 4–6 and layout 3: independent section collections, curated
  Today, submission-age-based ranking and pinned legacy-contract compatibility.
- Reader submission ages, footer update time, section URL/history restoration,
  no-JavaScript section access and matching regression tests.

Retained public `package.json`/lockfile, connector-preview protocol fixes,
security module and tests, THIRD_PARTY_NOTICES, fictional source fixtures and
synthetic lead-migration tests unchanged. No live edition, archive, ledger,
source snapshot or staged editorial copy was imported or processed. Generated
prebuilt HTML/version is rebuilt solely from the public fictional demo, not a
production publication. New assets were appended, not old hashes removed.
The managed `/publishing` status UI and internal rollout reports were not ported;
the independent preview deliberately rejects that route. This is not full
production-migration parity or clearance to publish.

Final verification:
- 68 Node tests passed, including synthetic direct independent Worker dispatch
  with forged headers, denied write routes, missing/mismatched state, preserved
  safety hold, exact edition version and CSP checks. No network calls in that test.
- TypeScript, independent Cloudflare Vite build, new-module ESLint and Python
  masthead geometry checks passed.
- Full repository lint remains failing: 2 pre-existing React-page errors
  (`Date.now` during render and a native home anchor), plus 686 warnings, largely
  existing/minified asset warnings. Both error patterns are present in the public
  baseline. Focused checks are not a full lint pass.
- Live Cloudflare/browser rendering, state restore, production CI and DNS cutover
  remain unverified. A synthetic Worker dispatch test is not a deployed HTTP test.

## Pre-push audit (November 9)

All tracked files scanned for common credential formats, private deployment identifiers,
private origin/email markers and restricted batch IDs: no matches. Public fictional
source fixtures, security module, dependency lockfile and third-party notices remain
unchanged from baseline. Re-ran 68 Node tests, TypeScript, independent Vite build and
Python masthead checks successfully. This is a targeted audit, not a guarantee that
a pattern scan detects every possible secret. No live production state was imported.

## Synthetic isolation verification

Added tests for forbidden environment/network access, injected old restoration
controls, absent production modules in the dependency graph, synthetic-only story
URLs, empty archives, disabled comments, forged identity, denied writers, HEAD,
noindex and missing production bindings. No production content was accessed or
imported. Earlier restoration test results above describe the superseded scaffold,
not the current synthetic-only design.

Current revision: all 67 Node tests, TypeScript and synthetic Cloudflare build pass.
Generated Wrangler config confirms empty R2, D1, KV, service and queue bindings.
Targeted lint passes. No upload, push, deployment or DNS action performed.
