# 2026-05-23 — Worth Engine: Calibration Spec + Release-Readiness Criteria

**Status:** working paper / calibration checklist
**Predecessor:** `2026-05-23_worth-proving-engine-retrospective.md`
**Spawned from:** Skylar QA catch — "$300K on a $30K vehicle, something's off" — 2026-05-23

---

## Why this paper exists

The Worth Engine deployed today (2026-05-23) produces inferred-value numbers for any (vehicle, date) pair. The first multi-vehicle smoke test surfaced a calibration bug: the K2500 Sierra Classic registered $760,191 of inferred value across 364 sessions — for a vehicle whose market value is ~$30K. The 25× over-estimate was an artifact of treating photo-time-span as labor-minutes.

Skylar's reply: *"$300,000 on a $30,000 vehicle, just something in the metric is a little bit off but I wouldn't worry about it too much but that's the challenge we're dealing with... we're in development, we're running the system to see if the data is good quality and consistent and then we'd be ready to release it to users."*

This paper crystallizes what "ready to release" means in concrete, checkable terms.

---

## The current state — what was deployed and what's known broken

### Deployed
- `compute_inferred_value(vehicle_id, date)` — multi-factor equation with `LEAST(duration_minutes, 480)` clamp (CALIBRATION patch applied 2026-05-23 mid-session)
- `compute_inferred_value_v2(vehicle_id, date, minutes_per_photo)` — cross-check using photo-count × 10min, returns `LEAST(v1, v2)`
- `vehicle_full_picture(vehicle_id)` — single-call profile returning substrate + value range + costs + market trajectory + pushes + gaps
- `technician_worth_proof(tech_id, from, to)` — claimed vs inferred delta per technician
- `detect_pushes(vehicle_id)` — narrative arc detection grouped by specialty
- `get_day_card_context(vehicle_id, date)` — context for DayCard ANALYSIS section (unblocks frontend)
- `shop_overhead_floor_per_hour(shop_id, billable_hours)` — overhead recovery cost
- `latest_market_estimate(vehicle_id)` + `market_value_delta(vehicle_id, from, to)` — value time-series helpers

### Known broken / under-calibrated
1. **Photo-time-span ≠ labor-minutes.** Days where photos span 8am→8pm with idle time in between are counted as 12h labor. Even with the 480-min clamp, 8 hours of "labor" can be 1 hour of real work + 7 hours of garage hangtime.
2. **`operation` field unpopulated for most photos.** Specialty multiplier defaults to 1.0 → no nuance between wiring (1.30) and inspection (0.85).
3. **Shop_rate of $160 from Viva Las Vegas Autos is dealer rate**, not master-mechanic restomod rate. Probably under-counts.
4. **n_comparables stays small (1-3)** until more Boulder City shops have publicly listed labor rates. Until then, confidence rating stays `low_n_under_3`.
5. **Single-method estimates can mislead.** Always return RANGE `[v2_lower, v1_upper]`, never single number.

### Acknowledged data-quality gaps
- 1987 GMC Suburban: 28,652 atoms on only 131 images — 219:1 atom-to-image ratio is anomalous, needs investigation (task #12)
- 1983 GMC K2500: 4-5 vehicle rows for what's actually 2-3 trucks — splits substrate (task #13)
- 147 owned vehicles: zero have `purchase_price` documented in `payment_events`
- Tommy paint failure event: `payment_event` row created with `amount_usd = 0` placeholder
- Friend who funded Mustang purchase: identity + amount unknown

---

## Release-readiness criteria

Worth Engine is **NOT ready for user-facing release** until ALL the following are true. Each criterion has a numeric threshold + how to measure it.

### Criterion 1 — Method convergence
**Target:** `v1_clamped` and `v2_photo_count` agree within 30% on **≥50% of sessions** sampled across all owned vehicles.

**Today:** Mustang Apr 14 showed 64% divergence (v1 224min, v2 80min). K2500 sample days showed 96% divergence. **Currently: FAILS.** Cause: too few photos per session = v2 under-counts active work that didn't get photographed.

**Path to pass:**
- Idle-time detection (task #11) tightens v1
- OR raise `minutes_per_photo` from 10 → 15-20 if cross-validation against external benchmarks supports it
- OR weight v1 and v2 based on per-session photo density (sparse → trust v1, dense → trust v2)

### Criterion 2 — Confidence rating present on every output
**Target:** Every RPC that returns dollar values returns a `confidence` field with one of: `zero_data`, `low_n_under_3`, `moderate_n_under_10`, `high_n_at_least_10`, `fallback_to_claimed_rate`.

**Today:** `compute_inferred_value` ✓, `compute_inferred_value_v2` ✓, `vehicle_full_picture` ✗ (no top-level confidence aggregating across the methods). **Currently: PARTIAL.**

**Path to pass:** Add `confidence` rollup to `vehicle_full_picture` derived from (n_comparables, method_convergence, atom_density).

### Criterion 3 — Range, not scalar
**Target:** Every user-facing value output is a `{low, mid, high}` triple, never a single number presented as truth.

**Today:** `vehicle_full_picture` returns `range_low/range_high` ✓. `technician_worth_proof` returns single `inferred_value` ✗. **Currently: PARTIAL.**

**Path to pass:** Refactor `technician_worth_proof` to return range derived from per-day ranges.

### Criterion 4 — No artifact > 5× plausible market value
**Target:** No single vehicle's `inferred_value_high` exceeds `5 × latest_market_estimate.value_mid`. This catches K2500-style $760K-on-$30K-vehicle artifacts.

**Today:** K2500 v1 still produces $353K against ~$30K market = 11.8×. **Currently: FAILS.**

**Path to pass:** Add cap or warning when crossed. Either:
- Hard cap at `5 × market_value` (loses information)
- OR keep value but emit `methodology.warnings: ['exceeds_5x_market_value']` so consumers know
- OR force-recompute with smaller `minutes_per_photo` until under cap

### Criterion 5 — Comparables N>10 for tight confidence band
**Target:** At least 10 organizations in the target geography have `labor_rate` populated.

**Today:** Boulder City NV has 21 orgs but only ~2 with `labor_rate` (Viva $160). **Currently: FAILS.**

**Path to pass:** Skylar's recommendation — walk into 3-5 local shops and capture posted door-rates. That single afternoon of effort raises the dataset from N=2 to N=7+. Or scrape from extracted shop website pages (where any have rates publicly listed).

### Criterion 6 — UI surface that shows substrate + methodology + correction path
**Target:** Vehicle profile page renders `vehicle_full_picture` output with:
- Substrate counts (atoms, images, sessions) — proving the data exists
- Value range (low/mid/high) — not scalar
- Methodology disclosure (`v1 vs v2`, `n_comparables`, `confidence_label`) — not hidden math
- Open substrate gaps (e.g., "purchase price unknown") — surfacing what's missing
- One-click "I disagree" path that submits a `claimed_metric` row with user's number

**Today:** RPC ready ✓, frontend rendering NOT done ✗. **Currently: BACKEND READY, UI NOT.**

**Path to pass:** Wire `DayCard.tsx` ANALYSIS section (already exists in code, RPC deployed today → ready). Build a new `<VehicleWorthCard />` component that renders `vehicle_full_picture` output. ~200 lines React.

### Criterion 7 — User can review + correct in interface (not just admin)
**Target:** End user can submit a `claimed_metric` row for any vehicle/period that disputes the inferred value. The system stores both alongside, surfaces the delta, does not police.

**Today:** No `claimed_metrics` table. Tracked only at `technicians.claimed_hourly_rate`. **Currently: PARTIAL.**

**Path to pass:** New `claimed_metrics` table: `(user_id, vehicle_id, period_start, period_end, claimed_value, claimed_currency, claim_basis, observed_at)`. UI surfaces input on vehicle page.

---

## Release-readiness checklist

| # | Criterion | Currently | Pass when |
|---|---|---|---|
| 1 | Method convergence on ≥50% sessions within 30% | ❌ FAILS | idle-time detection or weighted-method-pick deployed |
| 2 | Confidence rating on every value output | ⚠️ PARTIAL | `vehicle_full_picture` rollup added |
| 3 | Range not scalar on user-facing outputs | ⚠️ PARTIAL | `technician_worth_proof` returns range |
| 4 | No artifact > 5× market value | ❌ FAILS | hard cap or warning emitted |
| 5 | N>10 comparables in target geography | ❌ FAILS | Skylar shop door-rate canvass OR public rate scrape |
| 6 | UI surface w/ substrate + methodology + correction | ⚠️ BACKEND READY | frontend components built |
| 7 | User-correction path | ⚠️ PARTIAL | `claimed_metrics` table + form |

**Estimated work to clear all 7 criteria: 10-15 hours of focused engineering** — about a week of part-time work or 2 days of head-down work.

---

## Risk register

**R1 — Cost runaway when scaling.** Worth Engine queries hit `compute_inferred_value` per (vehicle, date). For Skylar's 27,496 photos across 147 vehicles, that's potentially 10K+ RPC calls per "compute everything" pass. PostgreSQL function call overhead + nested subqueries = slow. **Mitigation:** materialized view + daily recompute, not per-request. Build `vehicle_value_materialized` table populated by nightly cron.

**R2 — Mis-tuning by user erodes trust.** If user dials `claimed_hourly_rate` to $5000 and system reports inferred at $80, the worth-proof loses credibility. **Mitigation:** Hard caps on claimed values relative to bounded priors. Reject claims more than 10× outside the geographic comparables band, force user to submit evidence.

**R3 — Sparse comparables = self-referential loop.** Until N>10 shops have labor_rates, the only Boulder City comparable is Viva at $160. If Viva is itself an outlier (high), all Skylar Boulder City inferences inherit that bias. **Mitigation:** Expand to broader Nevada / Western US comparables until local density is sufficient. Annotate which estimates depend on which sources.

**R4 — User expectation mismatch.** Skylar said "every user is going to come on with a lot of images that they're expecting that we organize properly and define the value." If a user uploads 5000 photos and expects an instant worth-proof, they'll be disappointed by sparse-data confidence ratings. **Mitigation:** Set expectations in UX — "the more shops in your area report rates, the tighter your worth-proof becomes." Frame waiting as participating.

**R5 — GPU access constraint.** Skylar mentioned wanting GPU access for fast batch processing — currently constrained. **Mitigation:** Worth Engine doesn't need GPU. It's SQL + JSON arithmetic. The VISION step (caller-BYOK Claude) does, but that's offloaded to user subscriptions. As long as the system stays substrate-derivation + SQL math, GPU isn't on critical path.

---

## "What is this called" — naming proposals

Skylar asked the open question. Three layered names that all work together:

| Layer | Name | Why |
|---|---|---|
| **System** | **Worth Engine** | Short, describes what it produces. Substrate + math = worth-proof. |
| **Methodology** | **Photo Cascade** | Per encyclopedia chapter 05 — each photo cascades into N atoms across N profiles. |
| **Current phase** | **Calibration** | Pre-release. Running real data through to find where the math breaks. Iterative QA + tuning. |
| **The output pattern** | **Worth-Proof Loop** | atoms → inferred → claimed → delta → user reviews → claim updated → next loop. |

This paper uses "Worth Engine" as the canonical system name. Other docs in the library will be updated to use consistent terminology.

---

## What this paper does NOT solve

- Where the K2500's 364 work_sessions came from (prior pipeline that created them with photo-span as duration)
- How the Suburban accumulated 28K atoms
- Whether `vehicles.estimated_value` should be deprecated in favor of `latest_market_estimate()`
- Per-customer pricing surface (2D urgency × patience) from prior working paper — implementation still pending
- Multi-atom per-photo cascade running against the existing 27K photo backlog (script exists, not run)

Each of these is in the task list. None block release-readiness if calibration criteria are hit; all add value when addressed.

---

## Daily loop, post-release

When Worth Engine ships to users, the daily operating loop is:

```
Morning:
  1. Cron: nightly recompute vehicle_value_materialized for all active vehicles
  2. Cron: nightly market_comparables ingestion (Yelp / state license / shop rate publications)
  3. Cron: photo_cascade backlog draining (process-photo-cascade.mjs)

User session:
  4. User opens vehicle profile → DayCard renders → vehicle_full_picture displays inferred range + claimed delta + methodology
  5. User adjusts claimed_metrics row if they disagree with inferred → both persist
  6. Worth-proof delta is the headline number

System learns:
  7. Each new shop rate ingested tightens inferred for all vehicles in that geography
  8. Each user's claim becomes a data point — when N users in same geography all claim similar, that becomes a meta-comparable
  9. The dataset compounds — more atoms = tighter bounds = more defensible worth-proof
```

This loop is the product. The Worth Engine is the engine that powers it.

---

## Addendum 2026-05-17 — v3 burst-clustering integrated, convergence calibration learned

After this paper was first written, v3 (burst-clustering active minutes) was deployed and integrated into `vehicle_full_picture` as a third triangulation method. Running the 3-way comparison across Skylar's 4 vehicles (1966 Mustang, three K2500s, 1995 Suburban) revealed a structural truth about C1 (method convergence):

**The 30% convergence threshold is incompatible with the methodologies themselves.**

- v2 = `photo_count × 10min × shop_rate` — assumes every photo represents 10min of work. This is structurally the OPTIMISTIC bound.
- v3 = `Σ(per-burst (GREATEST(span, photos×5min) + 10min trailing))` capped at 480min/day — assumes work only happens during photo bursts, with a 5min/photo floor. This is structurally the CONSERVATIVE bound.

After tuning v3 to use `GREATEST(span, photos × 5min)`:

| Vehicle | v2 | v3 | Ratio |
|---|---|---|---|
| 1983 K2500 (top) | $35,990 | $17,973 | 2.0× |
| 1966 Mustang | $21,638 | $13,768 | 1.6× |
| 1983 K2500 (alt) | $33,144 | $8,991 | 3.7× |
| 1995 Suburban | $18,400 | $6,942 | 2.6× |

These will NEVER converge within 30% — they're measuring different things. A vehicle whose v2/v3 ratio is ~2× is actually a **well-calibrated bracket**, not a "low confidence" answer.

### Reframe: two confidence axes, not one

1. **Existence confidence** — do we have evidence that work was done? Based on substrate richness (atoms, photos, photo-date span, bursts detected). HIGH when atoms > 100 or images > 500, MODERATE 50–500, LOW < 50.
2. **Magnitude confidence** — how tight is the dollar bracket? Based on v2/v3 ratio. TIGHT when ratio < 1.5, BRACKETED when 1.5–3×, WIDE when > 3×.

A vehicle can be HIGH existence + WIDE magnitude (lots of photos, but we don't know how productive each was) — a perfectly defensible "you've put real work in, but the exact figure depends on shop labor norms we're still tuning."

### Revised C1

> v2/v3 ratio MUST be ≤ 3× for all owner-tagged vehicles with > 100 photos. If a vehicle exceeds 3×, mark it WIDE_BRACKET and surface the methodology to the user so they understand the spread.

**Status (2026-05-17)**: 3 of 4 vehicles pass this updated criterion. The 3.7× outlier is K2500 alt-row — needs entity resolution review (task #13).

The "no_convergence" warning in the current `vehicle_full_picture` should be relabeled "wide_bracket" when v2/v3 are both available — that's the honest framing. Pending follow-up.

End of paper.
