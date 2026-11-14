# Sites / Cloudflare reconciliation

Reviewed November 14, 2026 UTC. This is a comparison of the running readers and their source, not a claim that different news snapshots should contain identical articles.

The requested first phase is reader parity. Automated image review and a protected publishing dashboard are deferred at the owner's request. This branch changes repository code only; publication of the new code and a successful subsequent edition are separate release steps.

## Compared versions and evidence

- Sites reference source: `23b0b6c80c9ec9df21dc0af031e422200012e9a6` (hosted version 40).
- GitHub `main` at review start: `3d142bdef7d7b3d2cddfd053fcc05856491635a9`.
- Deployed migration branch: `bc812fe77bc08875dc77d43194ff6379d109f201`. Its seven additional commits are merged into this reconciliation branch, preserving archive migration, custom-domain configuration, favicon/font-license routes, cache rebasing, publisher-outage handling and bounded historical searches.
- Sites current source snapshot: `2026-11-12T02:46:27.305Z`, 72 stories, 2 images, 16 discussion highlights.
- Cloudflare snapshot inspected: `2026-11-14T02:30:27.402Z`, 74 stories, 0 images, no discussion snapshot. Later automatic editions can differ.
- Same fictional edition passed through both actual renderers produces identical HTML after normalizing only two generated comment/age-script filenames. Reader source, stylesheet, masthead, carousel, navigation and comments UI already match; no redesign was necessary.
- Live Cloudflare topic navigation, search and native comment loading were exercised. The restored carousel was checked locally with fictional data, including page buttons, keyboard navigation, light/dark themes and 320/390px layouts. Comment text is 17px on mobile and 19px on desktop; no document overflow was observed.

## Difference register

| Area | Finding | Reconciliation / disposition |
| --- | --- | --- |
| Source branch | `main` was seven commits behind the deployed migration branch. Comparing only `main` falsely suggests missing archives and assets. | Merge those commits into the reconciliation branch; deploy only the final reviewed source. |
| Discussion highlights | New Cloudflare editions never attach `discussionHighlights`, so the renderer falls back to the generic story strip. Sites has a separate comment panel. | Restored automatic collection, durable checkpoints and attachment before validation/publication. |
| Highlight appearance | The tinted panel, two stacked comments, next-page peek, dots, swipe/keyboard behavior and attribution code already exist unchanged. | Reuse the exact existing renderer, CSS and client carousel. No new reader requests or autoplay. |
| Cloudflare request limit | Sites' v4 collector may make 144 reads, exceeding a single standalone invocation's request budget. | Four threads per alarm invocation, at most 24 upstream reads each. Six checkpoints cover the same first 24 pinned threads. |
| Highlight interruptions | A fresh collect in one process would lose work after interruption. | Persist each completed batch; resume the next missing batch. Merge in original HN order, then deduplicate globally and freeze up to 16 comments. |
| Highlight failures | A thread with an unread candidate must not masquerade as a complete review. | Keep explicit partial/unavailable status. Never substitute invented or old quotes. An empty result omits the panel, matching Sites behavior. |
| Summary length / vertical density | The inspected Sites summaries had a median of 155 characters; Cloudflare's had a median of 469.5. The editions differ, but the longer decks visibly change layout density. | Automatic publication uses its already-authored one-sentence `shortSummary` as the newspaper deck, including cached model results. No truncation, additional model call or archive rewrite. |
| Publisher bylines | Cloudflare discarded available `og:site_name` and always displayed a hostname. | Preserve bounded publisher metadata in the pinned source; use it even when reusing model copy. HN self-posts use Hacker News. A hostname remains the fallback when metadata is absent. Human-written publisher labels can still differ from metadata. |
| Article images | Sites can include visually reviewed, relevant publisher images. Cloudflare explicitly rejects images during staging. | Deferred: requires a bounded automated image-review pipeline. Existing archived image rendering, alt text, captions and credits remain supported. No unreviewed images are added. |
| Layout and typography | Masthead, headings, rules, columns, Technology grid, story metadata and responsive CSS are the same. | Preserved; verified with same-data renderer comparison and browser checks. |
| Sections and search | Same topic collections, filter code, search scope, empty states, query/date parameters and history handlers. | Preserved. Counts differ when selected stories differ; this is not missing section functionality. |
| Native comments | Both use the same sanitized comment-token protocol and UI. Cloudflare's adapter reads its own immutable publication records. | Verified live loading. Existing tests cover replies, pagination, deleted/dead items, failures, membership and immutable version pinning. No voting or posting is introduced. |
| Archives | All eight Sites dates exist on Cloudflare. Seven have identical versions, story arrays and highlight snapshots. November 12 points to a later Cloudflare edition at `10:30:27.750Z`, rather than Sites' `02:46:27.305Z`. | Preserve the shared latest-edition-per-UTC-date rule. Do not overwrite the later edition to force visual equality. Imported immutable versions remain separate from the date index. |
| Archive rendering and assets | Migration renders imported editions with the shared renderer and retains old hashed assets. Historical content is not reranked. | Preserved. This change does not rewrite archive data or permanently alter old excerpts. |
| Favicon and font license | Missing on old `main`, already fixed on the deployed migration branch; both live routes return 200. | Preserve the existing fix. |
| Theme preference | Both have the same device-default/saved-override logic, but browser storage is origin-scoped. Sites, workers.dev and the custom domain may have different saved choices. | Expected browser behavior. Do not copy private browser storage between origins. |
| Submission ages / footer / stale notice | Same relative-age code, accessible UTC times, one footer update timestamp and 12-hour stale notice. Sites' older snapshot correctly shows a stale notice. | Preserved. Timestamp differences reflect successful source snapshots, not build or visit time. |
| Refresh | Both reload the latest completed edition; neither reader button commands a news collection. Cloudflare reads its publication directly; Sites may use a short internal cache except on explicit refresh. | Preserve this behavior. A refresh during an unfinished run can legitimately show the prior edition. |
| No-JavaScript / accessibility | Same section fallback, readable highlight content, semantic links, focus behavior, reduced-motion handling and theme contrast rules. | Preserved and covered by the existing suite. Physical touch-device testing was not performed; responsive checks used a desktop browser viewport. |
| News candidate ordering | Sites fetches HN HTML pages; standalone collection uses official `topstories` API ranks grouped in thirties because HTML retrieval failed from Cloudflare. | Keep the functioning API path and its explicit provenance. Same ranking policy does not guarantee identical order to the HTML homepage at the same instant. |
| Selection / lead rules | Topic, freshness, allocation, URL deduplication and balanced lead algorithms are shared. Each installation has its own source timestamp and durable history. | Preserve the deployed policy. Archive import does not itself copy the lead-retirement ledger; cross-installation historical continuity was not established by this reader audit. |
| Editorial wording and evidence | Sites used an agent to review sources and author copy; Cloudflare uses a bounded model request. The newer collector also handles legacy encodings and publisher failures differently. | Keep accurate source attribution and unavailable states. Exact future wording and source availability cannot be guaranteed identical. Broader editorial-policy changes are separate from reader parity. |
| Publishing cadence | Cloudflare runs every half hour with alarms for continuation; the old Sites instance is retained privately and is no longer the active publisher. | Keep the new scheduler and existing budget/selection/hold controls. Reader parity does not restart the old publisher. |
| Owner tools / status / template rebuild | Sites has owner-authenticated MCP operations and a private `/publishing` page. Standalone deliberately exposes no public admin or MCP writer. It also lacks the old owner-triggered template-only rebuild flow. | Protected dashboard and administrative workflow deferred. Do not copy trust in Sites identity headers onto a public Worker. |
| Reader failure recovery | Sites can read a last-valid backup and ultimately a bundled edition. Standalone preserves immutable versions and fails if its publication authority is corrupt; tests cover cold recovery. | Keep explicit failure rather than silently presenting synthetic seed news. Storage recovery is an operational concern, not solved by copying the UI. |
| Pause / live-comments switch | Standalone comment reads currently use `LIVE_FETCH_ENABLED`, also used for editorial source reads. A full default-off staging deployment disables both. | Existing behavior documented for a later operational decision; this reader change does not weaken launch/pause gates. |
| Access and deployment | Sites reference is owner-only; Cloudflare/custom-domain reader is public. Hosting, storage and authentication are intentionally different. | No audience, domain, secret, budget, scheduler or live deployment changes in this phase. |

## New discussion publication contract

The runner finishes all required articles, then starts discussion collection in a fresh invocation. Each invocation examines four pinned current threads and up to five top-level comments per thread, using the existing v4 freshness and display-position scoring. The existing 18-second collector deadline applies to each checkpoint, so the overall standalone workflow may span six such checkpoints plus alarm delays. It still makes at most 144 upstream item requests per completed collection.

Network reads happen outside storage transactions. Every save rechecks the runner lease, pending source batch, publication base and safety hold. Checkpoints retain raw candidate pairs until global ordered deduplication, avoiding a subtle loss of eligible threads when the same author or URL appears in different batches. The combined snapshot is limited to 24 KB and is part of the validated atomic publication. The initial standalone publication explicitly supports the real `empty` base; later publications bind to their exact previous version.

A failure to read comments is optional content failure, not an editorial safety stop. It freezes a partial/empty result without inventing comments or changing required article selection. A safety hold or changed publication base still prevents activation. No new model usage, public mutation endpoint or reader-time HN fetch is introduced.

## Validation and release boundary

- 129 Node tests passed, including actual local Workers/SQLite/alarm tests.
- TypeScript, Python masthead geometry, production-workflow lint, scheduled configuration validation and `git diff --check` passed.
- The normal framework build and standalone scheduled Worker dry-run build passed. Framework build emitted existing bundler/sourcemap warnings.
- Same-data renderer comparison and browser desktop/mobile/light/dark/carousel checks passed.
- Production release is not part of these local checks. After deploying this branch, verify a newly completed edition contains the expected frozen highlights, exact HTML/API version agreement, concise decks and publisher metadata. A code deployment alone cannot add highlights to already stored editions; they arrive with a successful subsequent publication. A previously staged article can retain its prior deck until a fresh source batch is authored.
- Live publisher availability, image review, protected administration, cross-installation lead-history continuity and every physical device are outside this first phase. These are explicit remaining differences, not claimed passes.
