# progressive extraction

**Type:** doctrine + measurement rule
**Supersedes:** the boolean reading of `publication_pages.ai_processing_status`
**Extends:** `ANALYSIS_SPEC.md` (the two passes, trust tiers T1–T4), `vision-fillable` (the fillability triplet)
**Owner decision pending:** whether Polo Lifestyles is in scope — it is 66% of the page corpus and changes every denominator below.

**Extraction is not a state a page is in. It is a depth a page has reached.** A page is never "extracted"; it has been through some passes and not others, and each pass either found something, found nothing, or was never run. Collapsing that into one `completed` flag is what produced a corpus that reported 15,917 pages done while nobody could say what "done" meant.

## The rule that makes the number honest

> **coverage = yield ÷ fillable — never yield ÷ total.**

A page's **ceiling** is what its own content makes extractable. A full-bleed fashion photograph has no credit line; an ad has no editorial byline; a masthead has no brands. Measured against an absolute, those pages are permanently incomplete, the metric becomes meaningless, and the pressure to fake it becomes irresistible — which is precisely what happened.

Worked example (measured 2026-07-20): page 3, `property_listing`, 36 characters — *"CAVALAIRE Condo Exceptional location"* — and one correctly identified location. Read as `yield ÷ total` this is a near-empty failure and one of the "5,112 empty completed pages" an earlier audit alarmed about. Read as `yield ÷ fillable` it is **at ceiling**: there was nothing else on it. The page was fine; the denominator was wrong.

Fillability reuses the annotation vocabulary already defined in `vision-fillable` — a field is `vision_fillable`, `context_fillable` or `tool_fillable`. A page's ceiling is the union of fillable fields its content actually supports.

## The passes

A ladder, not a binary. Cost rises, coverage narrows, trust rises.

| pass | cost | yields | trust tier |
|---|---|---|---|
| `identifier` | ~0 | phone, domain, email, social handle, printed codes | **hallucination-survivable** — the string is on the page or it is not, so a fabrication is caught by looking |
| `discovery` | cheap, total coverage | raw text, page_type, candidate brands / people / locations | T4 `vision` — routes attention, never a headline metric |
| `spine` | bounded (one read per issue) | which pages form ONE story; ad vs editorial | T2 `printed` — from the printed TOC, never from vision |
| `drill` | expensive, targeted | creative credits, garment credit lines, adjudicated entities | T2 |
| `sign-off` | human | the editor's verdict | T1 `verified` |

`identifier` is new to the ladder and is the cheapest large win available: it found Gumbs Car Rental's four magazine advertisements by matching a printed phone number that was already in both the OCR text and the org record, when name-matching had failed and the editorial axis had been written off as unreachable.

## Four rules

1. **A pass records what it LOOKED FOR, not only what it found.** "No credits on this page" and "we never looked for credits" are different facts and must be different rows. Conflating them is why nobody could tell whether extraction had happened — both are silence.
2. **Status is derived, never set.** `completed` must be computed from *which passes ran, what each yielded, which model, at what time*. A settable status is an assertion, and assertions get faked — a bulk `UPDATE … SET ai_processing_status='completed'` on 2026-07-14 flipped 554 never-read pages to done and made them permanently invisible to the extractor (`ANALYSIS_SPEC.md`, extraction failure modes).
3. **A cheap pass never overwrites an expensive one.** T4 discovery cannot overwrite a T2 printed read. Precedence is the existing tier order T1 > T2 > T3 > T4.
4. **Re-running a pass is a new observation, not an overwrite.** A better model reading the same page produces a second dated reading; the old one is superseded, never destroyed. This is what makes extraction *improvement* measurable rather than a silent reset.

## The unit problem the spine solves

Counts are computed over the wrong unit until the spine exists. **70% of stories span more than one page** (median 2, p90 12, max 37 — measured over 432 spine rows). A brand appearing on page 4 of a 12-page story is either counted twelve times or once, and neither is right. Both errors are invisible from the page alone, which is why `mag_is_ad` comes from the spine and never from vision `page_type`.

## State, measured 2026-07-20

| | pages | |
|---|---|---|
| total | 47,792 | |
| `discovery` complete | 15,917 | 33% |
| never run | 31,382 | 66% |
| failed | 493 | |

Of the 15,917 through `discovery`: **15,587 (98%) carry structured tags** — they were genuinely processed. Only **10** hold nothing but a status flag. Depth by layer: locations 49%, brands 47%, people 38%, creative credits 23%.

Coverage is **not uniform and the aggregate misleads**. The two titles that matter are effectively done — `lofficiel-stbarth` 3,436/3,470 (99%), `lofficiel-riviera` 2,380/2,400 (99%). Nearly all 31,382 pending pages are Polo Lifestyles (~13,000 across 90+ issues, ~12%) and Spirit of St Barth (1,280, 16%). Quoting "33% extracted" over the whole corpus describes a scope decision, not an extraction failure.

~~`spine` coverage is the real gap on the corpus we care about: **15 issues, 2,088 pages — 4%** of all pages, against 41 issues in the two L'Officiel titles alone.~~

**CORRECTED 2026-07-20 — this sentence was wrong and it cost a work cycle.** There are not
41 L'Officiel issues. There are **41 publication rows = 15 issues × cover variants**, and
all 15 are already spined. Cover variants share one interior: `lofficiel-stbarth-24` and
`-25` are **133 of 134 pages phash-identical to `-07` at offset 0** (they differ on the cover
alone); `-06` is 91/132 identical to `-05`. Counting publication rows as issues manufactured
a 26-issue gap that does not exist.

**`spine` is at ceiling for L'Officiel.** Every page of every canon-derivable L'Officiel
publication resolves to a story: **5,718 in-story, 0 orphans, 0 gaps, 0 overlaps.** The one
publication that still does not join (`lofficiel-stbarth-23`) is an AMTD print master, not an
unspined issue — see `lofficiel-concierge/docs/SPINE_PROPOSALS.md`.

**Do not re-derive this. Run the check:** `npm run spine:validate`
(`scripts/entity/mag-spine-validate.mjs`). It re-measures join, coverage and printed-title
evidence against the live database on every run and exits non-zero on a hard failure. A number
in prose rots; that check cannot.

## folio — the recovered layer, 2026-07-20

**There is no folio column.** `publication_pages.page_number` is the PDF index; the number
printed on the paper lives only in free text (`mag_stories.source_note`, and isolated integers
in `extracted_text`). That single gap is why the printed book cannot be reconciled against the
database in either direction — "the TOC says page 84" resolves to no row.

It has been **recovered, not guessed**: 923 folio observations read verbatim from two
independent sources, **3,415 of 5,870 L'Officiel pages** carrying a folio, **15 of 16 issues**
with a confirmed PDF↔folio offset. The method is arithmetic (two observations agreeing on an
offset force every folio between them), never a model — a wrong folio misfiles every citation
on its page while looking answered. Independent holdout, spine-only map scored against OCR:
**89.5%** (94.4% on readings within ±2).

Two findings outrank the number. **55 spine openers sit exactly one off the local offset**, and
on the evidence the OCR is right and `mag_stories.page_start` drifts — an open owner question,
not an agent's to settle. **36 breaks are structural**: inserts, foldouts, unlisted spreads.

The column is PROPOSED, not applied — `docs/architecture/FOLIO_COLUMN_PROPOSAL.md`; values are
staged in `output/folio/folio-staging.json` ready to land.

**Do not re-derive this. Run the check:** `npm run folio:check` — it re-derives against the live
database and exits non-zero if any staged folio moved. `npm run folio:validate` re-measures the
accuracy above. A number in prose rots; those checks cannot.

## See also

`vision-fillable` · `ANALYSIS_SPEC.md` (passes, tiers, failure modes) · `docs/library/technical/engineering-manual/19-temporal-change-ingestion.md` (same shape: a stable unit must exist before any delta means anything) · `docs/library/working/2026-07-20_price-without-unit-postmortem.md` (the sibling defect — a proxy read as the thing it stands for)
