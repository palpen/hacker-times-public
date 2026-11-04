# Current-trending discussion highlights (v4)

## Selection

Each successful edition publication recollects highlights from the first 24 IDs in its saved current HN pages, independently of selected edition articles. This is a bounded current-trending sample, not every discussion that trended during the calendar day. Older stories still on HN may qualify, but quoted comments must be no more than 24 hours older than the edition source timestamp.

For each thread inspect at most five top-level comments in official HN ranked display order. Eligible comments score 70 × (5 − position)/4 + 30 × 2^(−ageHours/6). Age is relative to the source snapshot and floored at zero. This is a transparent relevance proxy, not semantic editorial review or inferred comment votes. The official API documents `kids` as ranked display order and `score` as story score or poll-option votes: https://github.com/HackerNews/API.

Show at most 16 comments in source HN thread order. Keep one per article URL identity, one per author, and unique comment IDs. Quote contiguous original prefixes, at most 25 words/240 characters, using the existing quote/code-boundary guards. Use the official HN story title and source URL, HN author profile and exact comment permalink. Independent source metadata is validated and escaped; legacy snapshots cannot overlay it. No article ranking, lead ledger or placement changes.

## Cadence and failures

An independently configured edition workflow triggers collection on each successful publication. This change does not create another schedule or a comment-only publication path. Relevant comments may remain unchanged. Failed/blocked editions retain the previous publication and therefore cannot promise a hard 30-minute freshness SLA.

At most 144 credentialless API reads, four concurrent, 3 seconds per item, 18 seconds total, and 100KB per item. An unread candidate makes its thread unavailable rather than silently choosing around unknown data. Partial/unavailable collection is explicit. No suitable highlights omits the panel; no old-comment filler. Oversized metadata drops lowest-ranked whole item/source pairs until the 24KB snapshot fits.

V4 uses a separate immutable snapshot key pinned to source time, base publication and current-page IDs, then normal publication CAS. Exact retries reuse it. Rebuilds and archives never recollect. V1–V3 archives and their assets remain supported. The carousel design and reader network behavior are unchanged; no comment/source requests at page load.
