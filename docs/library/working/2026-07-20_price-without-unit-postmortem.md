# A price without its unit is not a price — four instances of one defect

**Date:** 2026-07-20
**Surfaces affected:** `lofficiel-concierge` client chat, inventory API, concierge itinerary; `properties.base_price`
**Verdict:** four separate defects, one root cause. All four were *stored or displayed numbers that had been detached from the metadata that gives them meaning.* Three were live on client-facing surfaces.

## The four

| # | Defect | Magnitude | Detection |
|---|---|---|---|
| 1 | 9 `elanvillarental` villas stored a weekly rate 27×–155× below the merchant's published figure. Villa Grace stored **804 USD/wk**; its live page publishes **22,000–125,000 USD/wk**. Villa K stored 294; Ciel Dazur 539. | 27–155× | Owner noticed the map pin was wrong, unrelated; the prices surfaced while verifying |
| 2 | WIMCO's **nightly** `base_price` rendered with a hardcoded `/week` label in the client chat context. 388 of 747 priced villas (52%) — every WIMCO row — quoted to clients at ~1/7 of cost. Example: Case et Cuisine, 385.71/night, quoted as 385.71/week. | 7× | `grep` for hardcoded `/week` after a report flagged unit mixing |
| 3 | `concierge/page.tsx` substituted **`villa.price \|\| 45000`** and **`item.price \|\| 500`** — invented figures whenever the real rate was absent | fabricated | Code read while fixing #2 |
| 4 | The itinerary subtotal summed `null` prices as zero (`sum + null === sum`), then derived a 15% service fee, a total, and a **30% deposit** from the understated figure | silent understatement | Type change in #3 exposed it |

## Root cause

`properties.base_price` is a single numeric column carrying **two incompatible units**: Sibarth publishes weekly (median ≈ $8,500), WIMCO publishes nightly (median ≈ $1,714). Measured today: `price_period` distribution over 747 priced villa rows = `{week: 359, night: 388}`. The column is honest; every reader that ignored `price_period` was not.

This is the *Villa Neo case law* (`docs/VILLA_TURNSTILE_INGESTION.md` §4: prices land in `price_observations`, never as flat scalars on `properties`) arriving as a live client defect rather than a doctrine note. The flat scalar existed, so readers read it, and a scalar cannot carry a season, a currency, or a unit.

Defect #3 has a different root: a UI written against demo data, where a placeholder made the component render. It survived contact with real data because a missing price is *invisible* — the card looked identical whether the number was real or invented.

## Why none of these were caught

1. **Nothing validated at the write path.** A luxury St Barth villa at 294 USD/week is not a plausible value; nothing said so. A twenty-line plausibility band derived from the observed distribution catches #1 outright.
2. **Type systems do not carry units.** `number` accepted a nightly rate where a weekly rate was meant. `price_period` existed on the row and simply was not selected — `src/app/api/chat/route.ts` selected `base_price` without it.
3. **`null` is falsy and numerically zero in JS.** `{price && …}` hides an unpriced item; `sum + null` silently drops it. Both read as "working" — the failure mode of every defect in this file is that *the screen looked correct*.

## Fixes applied

- **#1** `scripts/concierge/quarantine-elan-prices.mjs` — the 9 values nulled, each preserved verbatim in `metadata.price_quarantine` with restore SQL and the merchant figure that contradicts it. NOT re-derived: Elan is an unrun turnstile leg (186 villas in their sitemap, 9 held), and guessing a replacement repeats the error in the other direction.
- **#2** `chat/route.ts` and `inventory/route.ts` now select and carry `price_period`; the unit is stated only when published, otherwise "rate period not published — confirm before quoting". The figure is labelled *from* X per Y, because an agency floor is not the rate for the client's dates.
- **#3** both fallbacks removed; `price` retyped `number | null` through `BookingCard`, which now renders **"On request"** for absent.
- **#4** subtotal sums only priced lines and carries `unpricedCount` / `quoteIsPartial`, so a total computed over an incomplete set can be labelled an estimate.

Typecheck clean. Nothing committed, pushed or deployed.

## The rule this earns

**A stored number must carry its unit, and a reader that does not select the unit must not render the number.** Corollaries, all paid for above:

- Never substitute a placeholder for an absent price. Absent renders as absent (THE FRAME: low-confidence data surfaces *measured as such*, never as a clean-looking lie).
- Never let `null` enter arithmetic that a client sees. Unknown is not zero — an unpriced line must exclude itself from a total *and say so*.
- Never convert between units to make data uniform. Measured: `wimco_nightly × 7` is a median **20% above** the cheapest week other agencies publish for the same villa, and would have manufactured a contradicting price on the 117 villas where WIMCO is the only source.
- Derive plausibility bands from the observed distribution, per `(subject_type, field)`. Hardcoded thresholds rot; the distribution is already in the table.

## Open, not fixed

**Capacity conflicts resolve by taking the maximum.** Where agencies disagree on sleeps (22 villas), the higher number wins — 3H shows 18 where two of three sources say 17. Same shape as this defect class but *not* the same thing: 18 is a genuinely published figure, so this is an editorial choice of witness, not a falsehood to delete. It errs upward, which is the dangerous direction on a capacity promise. Needs a rule, chosen deliberately.

## See also

`docs/VILLA_TURNSTILE_INGESTION.md` §4 · `docs/library/technical/engineering-manual/19-temporal-change-ingestion.md` (unknown-vs-zero, same failure family) · memory `feedback_numbers_carry_source_dna`, `feedback_valuation_block_when_not_defensible`, `feedback_no_fabricated_or_mixed_data_in_design_surfaces`
