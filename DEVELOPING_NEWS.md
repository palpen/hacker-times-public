# Developing News

Readers get a small collection of ongoing stories, a brief explanation of the
section, and permanent pages with source-linked timelines and links to the original Hacker News discussions. Quiet stories move to
Earlier coverage; their URLs and history remain available. The reader never sees
model scores, thresholds, prompts, or operational details.

## System boundaries

```
Published editions ──> indexed article inbox ──> daily bounded assessment
                                      ↑                 │
                    active-story HN follow-up search    │ full source
                                                        ↓
                  Responses: draft + exact-story match
                  Decisions: evidence + editorial assessment
                                                        ↓
                  frozen v2 deterministic roster policy
                                                        ↓
                  atomic SQLite roster + sourced timeline
                                                        ↓
                  front-page section / permanent story pages
```

`DevelopingNews` is a separate SQLite Durable Object in the existing Worker. Its
alarms and storage are independent of `Newsroom` and never block edition
publication. The existing half-hour cron ingests published edition metadata;
model assessment runs once per rolling 24 hours in resumable, one-article alarm
checkpoints. It checks up to five active stories and five shortlisted articles.
A seven-day inbox preserves candidates between editions. Unavailable candidates
back off for 48 hours and leave the shortlist after three failures, so blocked
publishers cannot monopolize discovery. The inbox prioritizes indexed
matches to existing stories before HN score. This is a bounded HN-based discovery
service, not exhaustive monitoring of the whole web.

`store.ts` owns tables and indexes; `source.ts` owns bounded, public-source
retrieval; `model.ts` owns provider requests and validation; `policy.mjs` is pure;
`lifecycle.ts` applies policy to story records; `tracker.ts` coordinates jobs.
`render.ts` and `routes.ts` expose only public projections. Full text, prompts,
probabilities, collection failures and budget records stay private.

The terms index retrieves at most five existing stories, including quiet stories
of any age. The drafting model must then confirm the exact central question;
sharing an organization is insufficient. An uncertain match defers the article.
This inexpensive lexical retrieval can miss stories whose terminology changes;
measure match recall before adding semantic retrieval. Original URLs are indexed
as an additional exact-match signal. Pages and timeline entries are never deleted
by rotation; timeline and archive reads are paginated.

## Editorial and cost contracts

The v2 policy and question templates match the experiment copies. Their numeric
thresholds, bootstrap limit, promotion clock, resolution rules, protections and
revival requirements are unchanged. The reference policy's at-capacity replacement
behavior is also retained. The production evaluator uses Web Crypto for the same
SHA-256 fingerprints instead of Node file/crypto dependencies.

The model receives full extracted HTML article text. A 1.5 MB source-body limit
and 200 KB model-request limit reject oversized sources without excerpting. Pages
that require JavaScript, block access, or are not HTML are unavailable to this
first collector. These failures preserve existing coverage. The older front-page
summary collector keeps its existing excerpt behavior.

Responses drafts a short attributed update, question and search terms; a verbatim
supporting passage must exist in the source. Decisions independently assesses the
five established editorial questions. Only material developments, initial
admissions or confident resolutions publish timeline entries. All text is escaped
for rendering. These checks establish provenance and structural validity; they do
not independently prove that every model-written sentence is accurate.

Both providers reserve through Newsroom's existing shared USD 1/day and USD 5/month
ledger; the feature does not increase either cap. The front-page runner has
priority while it owns the lease. Exact source/shortlist checkpoints survive
restarts. Completed requests are reused; uncertain exact requests remain charged
and are not replayed. Provider bodies and secrets never appear in application logs.
Full request/response journals remain private for 30 days; permanent timelines
retain source links and content hashes. Newsroom's existing budget records have
independent retention. Monitor storage growth and take regular namespace backups.

## Release and operation

The additive `developing-news-v1` migration introduces `DevelopingNews`; it never
renames or resets `NEWSROOM`. The active configuration enables
`DEVELOPING_NEWS_ENABLED`; the paused configuration disables it. Existing
publication, schedule, source, model and mutation switches must also be enabled.
It uses the Worker's existing `OPENAI_API_KEY` server-side; no browser credential
or new public administration endpoint is introduced.

Release through the existing production release process after reviewing the
feature diff with any other pending changes. A new installation initially shows
an honest empty state; its first successful daily batch populates the section.
No sample stories or old experiment results are imported into production.

Public routes:

- `/developing-news` and `/developing-news/:id`
- `/api/developing-news` and `/api/developing-news/:id`

The front-page response adds the section to the persisted current edition without
rewriting immutable edition records. Historical editions link to Developing News
but do not embed today's active roster.

`hacker_times.developing_news` logs report completed/deferred runs and bounded
counts. Private SQLite `dn_state` records hold the last plan and failed work IDs;
`dn_requests` holds request/response audits. A deferred run leaves the prior
published roster readable. No source/model work occurs on reader requests.

## Verify and preview

```
node scripts/build-edition-assets.mjs
node --test tests/*.test.mjs
npx tsc --noEmit --incremental false
node scripts/validate-staging-config.mjs
node scripts/validate-scheduled-config.mjs
npx wrangler deploy --dry-run --config wrangler.scheduled.jsonc
node scripts/preview-developing-news.mjs
```

The local preview at `http://127.0.0.1:8793/developing-news` is explicitly labeled
and uses illustrative copy based on the saved test stories. It loads no API key,
accesses no production database, and cannot publish. Runtime tests use fictional
sources and provider responses, including actual SQLite persistence and restart.

Discussion links use the same lazy-loaded comment reader and CSS as Today. Each
request names the developing story; the private registry verifies the HN item
against its published timeline, including archived updates beyond the first page.
The API retains the same sanitization, ancestry checks, paging and request limits.

For a self-contained file preview, first save public HN comments, then export:

```
node scripts/preview-developing-news.mjs --refresh-comments
node scripts/preview-developing-news.mjs --export outputs/developing-news-preview.html
```

The export embeds the shared reader with a saved discussion transport. Roots and
immediate replies are available offline; deeper replies link to Hacker News.
The banner identifies the snapshot date. Production loads discussions on demand.

The discussion total comes from HN's root `descendants` field, including replies.
Timeline links request only root metadata (`countOnly=1`, two requests at a time);
opening the shared reader refreshes its heading from the discussion response.
Counts use the existing 45-second server cache, with no continuous polling.
Unavailable totals remain “Comments”; zero is shown only when HN reports zero.
The file preview retains saved totals and their retrieval timestamps. Refresh them
with `node scripts/preview-developing-news.mjs --refresh-counts`, then re-export.


Reader dates have separate meanings:

- **Following since** is the first time Hacker Times published the tracked story.
  It remains fixed when a quiet story returns. For legacy records, it comes from
  the earliest stored timeline entry across all pages.
- **Article published** comes from the original publisher's explicit publication
  metadata (publication meta tags or the matching Article JSON-LD), retaining the
  publisher's calendar date. Modified dates and HN submission times are excluded.
  Missing or ambiguous dates are labeled “Article publication date unavailable”.
- **Updated** on cards remains the last time Hacker Times added a development.

New evidence stores HN submission and article publication dates separately. The
frozen decision policy retains its existing submission-time input; legacy evidence
`publishedAt` values are never displayed as publisher dates. Timeline storage and
pagination retain the time each development was added.

Refresh original article dates for the local preview with
`node scripts/preview-developing-news.mjs --refresh-dates`, then export again.
Tracking dates in this preview remain explicitly illustrative.


The first production release reads the deployed migration tag and uses `wrangler
deploy` only for the exact additive `production-v1` → `developing-news-v1`
transition. Existing reader versions, routes and cron are checked before and
after. Subsequent releases use the existing upload/readback/activate workflow.
Unknown migration state stops deployment; migrations are never retried blindly.
