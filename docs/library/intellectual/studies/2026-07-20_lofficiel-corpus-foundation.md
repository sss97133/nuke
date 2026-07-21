# L'Officiel Corpus Foundation: What Is Now Executable, and What Is Still Prose

**Snapshot:** 2026-07-20 · project `qkgaybvrernstplzjaam`
**Method:** raw SQL (`execute_sql`) cross-checked against the PostgREST shapes used by `scripts/entity/foundation-check.mjs`; every load-bearing number reproduced through both paths. Read-only.
**Purpose:** turn a day's re-derived findings into checks, and record honestly which findings became executable and which remain prose.

---

## The corpus, measured

| | pages | |
|---|---:|---|
| `publication_pages` total | 47,792 | |
| `ai_processing_status='completed'` | 15,917 | 33% of corpus |
| `pending` | 31,382 | 66% |
| `failed` | 493 | |
| completed with a `model` key in `ai_scan_metadata` (genuinely vision-read) | 15,587 | 98% of completed |
| completed with NO `model` key (never vision-read; all carry text via a non-vision path) | 330 | |
| completed, never-read AND textless (**the pure status lie**) | **0** | was 10 at an earlier snapshot; requeue cleaned it |

**Discovery coverage is not uniform — the aggregate misleads.** Per title (`completed / total`):

| title | done / total | % |
|---|---:|---:|
| lofficiel-stbarth | 3,436 / 3,470 | 99.0% |
| lofficiel-riviera | 2,380 / 2,400 | 99.2% |
| other publications | 7,884 / 24,472 | 32.2% |
| polo-lifestyles | 1,966 / 15,942 | 12.3% |
| spirit-of-st-barth | 251 / 1,508 | 16.6% |

The two focus titles are effectively done. "33% extracted" over the whole corpus is a **scope decision** (which titles we chose to process), not an extraction failure. Reporting the aggregate alone is how it got misread as a broken pipeline. (Rule: `dictionary/progressive-extraction.md`, coverage = yield/fillable, never yield/total.)

## The spine↔page join

- Spine: **432** `mag_stories` rows across **15** issue canons.
- **40 of 41** L'Officiel PDF publications resolve to a spined canon. The lone exception, `lofficiel-stbarth-23`, is an **AMTD print master** (metadata has no `issue_no`; canon `lofficiel_stbarth:winter:2024` is not in the spine), not an unspined issue.
- **5,718** pages resolve to a story; **0** orphaned *inside a spined issue*; **0** cross-title matches.
- Trap recorded: `mag-spine-join.mjs`'s main block prints **152 "orphans"** because it counts pages whose canon is *derivable but not spined* (stbarth-23). `mag-spine-validate.mjs` and `foundation-check.mjs` gate on `byCanon.has(canon)` and get **0**. The settled invariant is "0 orphans inside spined issues," not "0 orphans everywhere." Cover variants `stbarth-24/25` fold into `#9:2023` via the slug fallback in `canonOf()`.

## Two defects, and where they actually live now

- **Prompt-placeholder echo.** The schema's own placeholder ("ALL visible text on the page, verbatim") appears in `extracted_text` on **0** pages (the fabrication surface is clean; was 639 L'Officiel pages). It survives in `spatial_tags->>'raw_text'` on **1,102** pages — this is CORRECT: the blob preserves raw vision testimony and must not be overwritten. A check that targets the blob would demand a trust-invariant violation.
- **`page_type` lives twice.** The `page_type` column and `spatial_tags->>'page_type'` disagree on **921** pages (the adjudication delta; `blob-only 0`, `col-only 0`). The column is authoritative (ANALYSIS_SPEC); a consumer reading the blob gets the pre-adjudication vision claim (1,122 covers vs 63 during the 2026-07-19 repair).

## The presence-axis defect

`ax_mark` defined as `organizations.logo_url IS NOT NULL` counts **603** authenticated marks; **344** wear a borrowed/quarantined binary → honest count **259**. Presence is not authentication. (`dictionary/presence-axis.md`.)

---

## Executable now vs. prose only

The honest measure of whether this stops being rehashed. "Executable" = a command exits non-zero if it regresses.

**Executable (checked by `npm run foundation:check`, `scripts/entity/foundation-check.mjs`, baselines dated 2026-07-20):**
1. spine↔page join derives (`canonOf()` resolves ≥40 LO pubs) — HARD
2. 0 orphans inside spined issues — HARD
3. no cross-title story match — HARD
4. no completed-but-never-read status lie (strict = 0) — HARD; and the never-read population (330) is growth-guarded
5. no schema placeholder in `extracted_text` — HARD
6. `page_type` column-vs-blob divergence — REPORT (count 921, visible every run)
7. discovery coverage per title — REPORT (per-title, aggregate labelled a scope fact)
8. presence ≠ authentication (`ax_mark`) — REPORT (603 / 344 / 259)

**Executable elsewhere:** spine join/coverage/title-evidence (`npm run spine:validate`); recovered folio stability + 89.5% holdout (`npm run folio:check` / `folio:validate`); within-page person-layer reconciliation (`npm run reconcile:page-people:verify`).

**Still prose only (NOT yet a check) — the honest residue:**
- **Folio has no column.** 3,415 staged values live in `output/folio/`, PROPOSED in `lofficiel-concierge/docs/architecture/FOLIO_COLUMN_PROPOSAL.md`. Until the column lands, the printed page number cannot be a join key — `folio:check` guards the STAGING file, not the database.
- **55 spine openers sit one folio off** and **36 structural sequence breaks** — surfaced by `folio-extract.mjs`, but whether the spine's `page_start` or the OCR is right is an open owner decision, not asserted.
- **`page_start` drift** (issue #9 2023 openers ~2 pages early, 13 stories) — reported by `spine:validate`, not corrected.
- **Polo Lifestyles / Spirit of St Barth scope** — whether the 31,382 pending pages are in scope is an owner decision (`progressive-extraction.md` names it pending); the check reports coverage but cannot assert a target.
- **81 spine titles await editor sign-off** (T1) — never rendered publicly until verified; no check, by design (human gate).

## Reproduce

```
cd /Users/skylar/nuke
npm run foundation:check     # exits 1 on any HARD regression; prints every defect + date
```

Tripwire verified 2026-07-20: tightening `resolved_lo_pubs_min` to 42 and `no_model_completed_max` to 0 each produced the expected HARD failure and exit 1; reverting returned exit 0.
