# villa availability

**Type:** table pair — `villa_availability_observations`, `villa_calendar_crawls`
**Created:** 2026-07-20 (migration `20260720120000_villa_availability_observations.sql`)
**Grain:** one row per source-asserted blocked date range; one crawl row per villa per fetch
**Status:** landed — 12,378 observations, 450 crawls. No consumer yet.

**Blocked range** — a stretch of dates on which an agency asserts a villa cannot be offered. It is *not* a sale. These calendars mix paid bookings, owner stays, maintenance windows and withdrawals; only Eden Rock distinguishes provisional holds. "44% of villas are taken over Christmas" is a fact about **what can be offered to a client**, and must never be captioned as market demand.

**Why a table and not a JSONB field.** Eden Rock's ranges were originally kept in `properties.metadata.availability_observations`. Measured on prod, same question, same box: JSONB = Seq Scan, 8,700 buffers, **36.163 ms** at 1,896 ranges, planner estimate 70% wrong. `daterange` + partial GiST = Bitmap Index Scan, 59 buffers, **0.157 ms** at 12,288 ranges. But the deciding argument is not speed — it is **supersession**. A blob is overwritten on every re-crawl, so a week that frees up (a cancellation) is indistinguishable from a week that was never there, and from a fetch that failed. Yesterday is simply gone. As rows, a cancellation is a `kind='released'` tombstone you can point at. That is the difference between holding a calendar and holding a demand signal.

**`kind`** — `unavailable` (source asserts blocked) · `available` (source asserts open) · `released` (a previously-live block is gone: a cancellation).

**`source_block_id`** — the agency's own identifier for a block, and the supersession key. Measured in the first Le Barth harvest: 10,482 of 10,482 distinct, and **2,352 already mutate in place** at the source — roughly a fifth of bookings change after they are made, which is precisely the population a blob would erase.

**`blocked` / `defect`** — generated columns, never writable. A range only materialises when both endpoints exist and end > start; otherwise `blocked` is NULL and `defect` names the fault (`null_start`, `inverted`, `zero_nights`). Defective source rows land as testimony rather than being discarded — they are what the source actually said.

**`villa_calendar_crawls`** — the coverage ledger, and the reason the system can be honest. Without it, *"this villa has no bookings"* and *"we failed to load this villa's page"* are the same silence. Measured: 6 of 186 Le Barth villas returned genuinely empty — really available all year — and would otherwise be indistinguishable from failures.

**Coverage is structural, not a backlog.** 318 of 603 canonical villas (53%) have a calendar. Le Barth and Eden Rock publish availability; **Sibarth and WIMCO publish none**. The remaining 285 are not a scraping gap — those calendars do not exist to be fetched. Closing it requires an agency relationship, not more engineering.

**Duration distribution** (measured 2026-07-20 over 12,256 live blocking ranges — the basis for any occupancy rule):

| nights | ranges | |
|---|---|---|
| 1–7 | 6,665 | 54% |
| 8–14 | 3,736 | 30% |
| 15–30 | 1,279 | 10% |
| 31–60 | 383 | 3% |
| 61–90 | 80 | 0.7% |
| 91–180 | 58 | |
| 181–365 | 40 | |
| 366+ | 15 | longest 3,220 nights (8.8 years) |

p50 = **7 nights, exactly the agencies' stated minimum stay** — strong evidence the mass genuinely is bookings. p75 = 11, p90 = 20, p95 = 30, p99 = 82.

**Withdrawal trap.** 113 ranges (0.9%) across 77 villas exceed 90 nights, split evenly between Eden Rock (58) and Le Barth (55). A block of that length is not a rental — it is a house taken off the market, an owner in residence, or a renovation. Any "most in demand" ranking built on raw blocked-nights ranks these **top**, exactly inverting the truth.

**The rule: >90 nights is excluded from demand metrics and reported separately.** 90 sits just past p99 and beyond any plausible stay given 7-night minimums. Label it descriptively — *extended block, >90 nights* — never interpretively as "withdrawn": we cannot distinguish a withdrawal from a genuine seasonal let, and asserting the difference would be the same error as reading a dead domain as a closed business.

**Not yet live.** `v_villa_metrics` currently exposes `calendar_status` (coverage) but no occupancy percentage, so nothing served is distorted today. This rule must be applied at the moment occupancy is computed, not after.

See also: `price_observations` (same DNA grammar, distinct fact class — `rate` is NOT NULL there) · `docs/VILLA_TURNSTILE_INGESTION.md` §4 · `docs/library/working/2026-07-20_price-without-unit-postmortem.md`
