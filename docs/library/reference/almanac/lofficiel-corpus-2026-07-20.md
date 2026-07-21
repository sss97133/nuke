# ALMANAC: L'Officiel Magazine Corpus

**Snapshot date:** 2026-07-20 · project `qkgaybvrernstplzjaam`
**Method:** exact counts via SQL, reproduced through the PostgREST shapes in `scripts/entity/foundation-check.mjs`.
**Refresh:** `npm run foundation:check` re-measures every number below against the live DB and exits non-zero on a HARD regression.

## publication_pages

| Metric | Count | Method |
|--------|------:|--------|
| total pages | 47,792 | exact |
| completed (discovery) | 15,917 | exact |
| pending | 31,382 | exact |
| failed | 493 | exact |
| completed, genuinely vision-read (`ai_scan_metadata.model` present) | 15,587 | exact |
| completed, never vision-read (no `model` key) | 330 | exact (watched — must not grow) |
| completed, never-read AND textless (pure status lie) | 0 | exact (HARD, must stay 0) |
| placeholder echo in `extracted_text` (fabrication surface) | 0 | exact (HARD, must stay 0) |
| placeholder in `spatial_tags.raw_text` (preserved testimony) | 1,102 | exact (not a defect) |
| `page_type` column ≠ blob (adjudication delta) | 921 | exact |

## Discovery coverage by title (completed / total)

| title | done | total | % |
|-------|-----:|------:|--:|
| lofficiel-stbarth | 3,436 | 3,470 | 99.0 |
| lofficiel-riviera | 2,380 | 2,400 | 99.2 |
| other | 7,884 | 24,472 | 32.2 |
| polo-lifestyles | 1,966 | 15,942 | 12.3 |
| spirit-of-st-barth | 251 | 1,508 | 16.6 |

Aggregate 15,917 / 47,792 = 33% is a **scope composite**, not an extraction failure rate.

## Spine & folio

| Metric | Count |
|--------|------:|
| `mag_stories` spine rows | 432 |
| issue canons | 15 |
| L'Officiel PDF publications resolving to a spined canon | 40 / 41 |
| pages resolving to a story | 5,718 |
| orphans inside spined issues | 0 |
| cross-title matches | 0 |
| folio observations staged (no column yet — PROPOSED) | 3,415 |

## Concierge orgs — mark axis

| Metric | Count |
|--------|------:|
| orgs with `logo_url` set (ax_mark presence) | 603 |
| of those, wearing a borrowed/quarantined mark | 344 |
| honest authenticated marks | 259 |

Source study: `docs/library/intellectual/studies/2026-07-20_lofficiel-corpus-foundation.md`.
