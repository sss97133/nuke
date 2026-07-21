# `publication_pages.printed_folio` — DDL proposal (OWNER SIGN-OFF REQUIRED, NOTHING APPLIED)

**Filed 2026-07-20 by the `folio-capture` build. No DDL has been run. No row has been written.**

Filed here rather than in `schema_proposals` for the reason already established in
`ADJUDICATION_DDL_PROPOSALS.md` §5: `schema_proposals_proposal_type_check` permits only
ontology types (`add_property`, `add_source`, `add_observation_kind`, …). There is no
`add_column`, so filing this there would mean mis-typing the row. Same gap, sixth instance.

---

## The gap

`publication_pages.page_number` is the **PDF index**. The number printed on the paper — the
**folio** — exists in no column, anywhere.

The consequence is not cosmetic. Every citation a magazine makes about itself is phrased in
folios: a table of contents says *page 84*, an editor says *"the Dior spread on 62"*, an
advertiser buys *folio 47*. None of those can be resolved to a row. **The magazine cannot audit
itself**, and no reconciliation between the printed book and the database is possible in either
direction.

The folio is not absent from the corpus — only from the schema. It survives in two places, both
of them free text:

| where | rows | shape |
|---|---|---|
| `mag_stories.source_note` | 329 of 432 | `"Folio 47; La Pointe."` |
| `publication_pages.extracted_text` | ~122 | an isolated integer line, `"84"` |

Free text is not a key. Nothing can join on it, nothing can validate against it, and every reader
must re-derive the parse. That is the whole defect.

## The proposal

```sql
-- Nullable on purpose, and the nullability is load-bearing. A cover, an inside-cover, a
-- gatefold and most front matter carry NO printed folio. NULL means "this page has no printed
-- number, or we have not recovered it" — it must never be read as 0 and never defaulted.
-- Unknown is not zero (AGENTS.md invariant 1-2).
ALTER TABLE publication_pages
  ADD COLUMN printed_folio integer;

-- A folio is a small positive integer. The bound is a typo catch, not a business rule.
ALTER TABLE publication_pages
  ADD CONSTRAINT publication_pages_printed_folio_chk
  CHECK (printed_folio IS NULL OR (printed_folio >= 1 AND printed_folio <= 999)) NOT VALID;

-- The reconciliation query this exists to serve: "the TOC says 84 — which row is that?"
CREATE INDEX CONCURRENTLY idx_pubpages_pub_folio
  ON publication_pages (publication_id, printed_folio)
  WHERE printed_folio IS NOT NULL;
```

`NOT VALID` so no rewrite of a 47,792-row table. `CONCURRENTLY` so no write lock. Both
reversible (`DROP COLUMN` / `DROP INDEX CONCURRENTLY`). Touches no testimony and no existing
value: this is a pure addition, and by construction it cannot overwrite a fact column.

**Also proposed, and it matters more than the column:** a provenance sibling, because a folio
carries source DNA like every other number here (`feedback_numbers_carry_source_dna`).

```sql
ALTER TABLE publication_pages
  ADD COLUMN printed_folio_method text;  -- observed_printed | observed_text | derived_offset | extrapolated_offset
```

Without it, a folio read off the page and a folio computed from an offset are indistinguishable
in the row, and the weakest class silently acquires the authority of the strongest — the exact
shape of the 554-page status lie in `ANALYSIS_SPEC.md`. If only one of the two columns is
approved, **approve both or neither**; the bare column is worse than no column.

## Measured evidence (run `npm run folio:extract`, 2026-07-20)

Scope: the two L'Officiel titles — 41 publication rows, which are **16 distinct issues × cover
variants**, 5,870 pages. (Publication rows are not issues. Cover variants share one
phash-identical interior — `progressive-extraction.md`, corrected the same day.)

| | |
|---|---|
| folio **observations** — read, never inferred | **923** |
| issues with a confirmed offset | **15 of 16** |
| pages with a **recovered folio** | **3,407** (58% of pages in scope) |
| ...of which read directly off the page | 914 (`observed_printed` 814 · `observed_text` 100) |
| ...of which interpolated between two agreeing observations | 2,493 |
| trust split | T2 3,281 · T4 126 |
| extrapolated beyond any evidence, **staged separately** | 60 |
| **sequence breaks** | **99** — `opener_off_by_one` 55 · `break_printed` 36 · `break_text` 8 |
| spine-vs-OCR conflicts on the same page | 2 |
| candidate readings rejected as implausible | 1 |

The one issue with no confirmed offset is `lofficiel-stbarth-23` — the AMTD print master, which
also has no canon and no spine. Not an extraction failure; a different kind of artifact.

Staged values: `output/folio/folio-staging.json` (one row per page, carrying `page_id`,
`printed_folio`, `method`, `tier`, `offset` and its evidence string). It lands the moment the
column exists. **`rows` and `extrapolated` are kept in separate arrays on purpose** — land
`rows` without hesitation; `extrapolated` is arithmetic past the end of the evidence and is an
owner call.

## Why this is recovery and not a guess

No model is invoked anywhere in the extractor. A wrong folio is worse than a missing one: it
misfiles every citation on that page while *looking* answered. So the method is arithmetic.

Take two observations in one issue, pages A < B, whose folios differ by exactly B − A. Folios
are consecutive integers, so (B − A) pages of travel producing (B − A) of folio travel leaves no
room for an unnumbered leaf. **Every page in [A, B] has folio = page + offset.** That is a proof.
Where the arithmetic fails, the extractor reports a break instead of picking a winner.

**Independent holdout — `npm run folio:validate`.** The two sources never saw each other: the
spine folios were read off printed TOCs by a strong model, the OCR integers came from a 7B
discovery sweep. Build the folio map from the **spine alone**, then score the OCR readings
against it:

```
OCR folio readings on a spine-covered page : 76
AGREE                                      : 68     89.5%
```

All four gross misses are small integers that were never folios (OCR read 3, 10, 29, 29 where
the map says 92, 43, 71, 71) — the extractor already classes these `break_text`/`suspect_text`.
On readings within ±2 the rate is **68/72 = 94.4%**.

## Findings that are not the column

**1. 55 spine openers are off by one — and the OCR is probably right, not the spine.**
The largest break class is a T2 spine folio landing exactly ±1 off the local offset. Several of
these `source_note`s admit it in their own words (*"opener approximate"*, *"boundary
approximate"*). Both surviving spine-vs-OCR conflicts are the same shape (p.77: OCR 75, spine
74; p.123: OCR 119, spine 118), and in both the OCR read an isolated number **on that physical
page** while the spine folio is bound to an editorially-judged `page_start`.

This suggests `mag_stories.page_start` drifts by one at story openers. **It is raised, not
acted on.** `ANALYSIS_SPEC.md` sets T2 > T4 and the extractor obeys that; inverting precedence
for one field is an owner decision, not an agent's. Concretely: *should a folio read directly
off a page outrank a folio inferred from a spine row's page_start?*

**2. 36 real structural breaks.** Offsets that jump by 2 or more — inserts, foldouts, unlisted
spreads, or pages missing from the scan. `lofficiel-stbarth-03` alone carries offsets of −2, +18
and −22 in one issue, and its own spine note says *"may include unlisted spread."* These are
where the printed book and the PDF genuinely diverge, and they were invisible before this run.

**3. Two false-evidence classes were found and are now rejected in code**, both of which would
have injected phantom offsets:
- 12 `source_note`s reading *"Printed contents, part 1 (folios 18–62), PDF p22"* — a TOC
  **listing** other pages' folios. Binding 18 to p22 injected a +40 offset into six issues on
  the first run.
- `#LOFFICIEL100`, a hashtag, matched a running-head pattern and produced a +69 offset on four
  Riviera pages.

Both are the same failure as the `cover` dumping-ground in `ANALYSIS_SPEC.md`: a page that
*lists* a thing being read as a page that *is* the thing.

## The check, which is the actual deliverable

```
npm run folio:check     # exit 0 = staged folios reproduce; exit 1 = a folio MOVED
```

Verified 2026-07-20 in both directions: it reproduces 3,407 rows exactly, and a single tampered
value makes it exit 1 naming the page. (Adversarial review the same day found the extractor was
staging 9 uncorroborated T4 OCR singletons — `break_text` breaks the header promised were never
staged, several of them ad copy: "15 YEARS", "50 - a retrospective". Those are now routed to eyes,
not staged; count fell 3,416 -> 3,407.)

This exists because prose gets skipped. In one day agents re-derived the org centroid piles, the
entity gate, the observation grammar and the two-pass extraction model — every one of them
already documented, correctly, in a file nobody opened. A paragraph asserting "folios are
already recovered" would be skipped the same way. **A command that exits non-zero is not.** If
you are about to write a folio extractor, run `npm run folio:check` first.

## Files

- `scripts/entity/folio-extract.mjs` — the extractor (read-only; writes no DB row)
- `output/folio/folio-staging.json` — staged values, awaiting the column
- `npm run folio:extract` · `folio:validate` · `folio:check`
- Reuses `canonOf()` from `scripts/entity/mag-spine-join.mjs` — not reimplemented
