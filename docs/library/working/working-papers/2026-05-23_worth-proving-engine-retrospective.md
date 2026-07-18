# 2026-05-23 — Worth-Proving Engine: Session Retrospective + Architecture

**Author:** session `9fcdd38f-5f2d-42f0-9b04-c50add38b086` (Skylar + Claude Opus 4.7 1M)
**Status:** working paper — capture point, not canon
**Spawned from:** the May 17 → May 23 session "have you been ingesting my images / update on my Mustang"
**Predecessors:** prior session threads referenced — `5d0848ba` (Apr 26 pipeline design), `f9e0cd84` (May 3 daily-receipt substrate ship), `a96f32d4` (May 3-4 "are vehicle profiles substantial" thread), `aefe49ba` / `e669bbe3` (May 2 "everything is user/org/vehicle daily receipts" thread)

---

## What this paper is

The work in this session crossed an axis change: it stopped being "fix the photo ingest pipeline" and became "articulate the worth-proving engine that the photo pipeline serves." This paper captures the thinking before it dissolves into chat history, and frames the open work.

It is also, deliberately, a counter-statement to the snake-eating-tail problem the session surfaced: that the per-day-receipts concept has been discovered and rediscovered across 30+ days of prior sessions, each time arriving at the same architectural gap, each time landing some artifact but never closing the loop. This paper exists so that loop closes here.

---

## What was found

### The substrate is richer than I claimed

The session started with assumptions about what didn't exist. Empirical truth:

| What I assumed | What is actually in DB |
|---|---|
| "we have no shop data, all market values would be hallucinated" | `organizations`: **5,269 rows**; 3 in Boulder City NV (Nuke, Viva! Las Vegas Autos at $160/hr, Desert Performance) |
| "we have no rate data" | 5 orgs across the whole table have `labor_rate` populated |
| "we don't have a shops schema" | `organizations` schema already includes: `hourly_rate_min/max`, `hourly_rate_cents`, `labor_rate`, `has_lift`, `has_paint_booth`, `has_dyno`, `has_fabrication`, `has_frame_jig`, `has_machine_shop`, `has_rotisserie`, `has_upholstery`, `has_alignment_rack`, `bay_count`, `sq_footage`, `specializations`, `specialty_makes`, `specialty_eras`, `trust_score`, `verification_level`, `on_time_completion_rate`, `project_completion_rate`, `repeat_customer_rate`, `typical_project_range_low/high_cents`, `accepts_dropoff`, `offers_mobile_service`, `service_radius_miles`, `max_concurrent_projects`, `parking_rate_per_day` |
| "we need to build a daily-receipt aggregator" | `work_sessions` table exists (763 rows); `get_daily_work_receipt(vehicle_id, date)` RPC exists; `DayCard.tsx` component exists |
| "we need an ingestion pipeline" | `iphoto-intake.mjs` (album-scoped) + `photo-sync.mjs` (camera-roll-wide) + `image-intake` edge fn + `photo-pipeline-orchestrator` all exist |
| "we have no observation atom system" | `vehicle_observations` + `ingest-observation` edge fn (single-front-door write path) operational |

**The framework is built. The data is sparse. The algorithms are absent. The interfaces are old.**

That sentence is the situation statement.

### What's actually missing — three layers, not one

1. **The operating system** — the layer that decides what to compute, when, and against which factor values. Today: ad hoc scripts (mine included), no central authority.

2. **The algorithms** — the multi-factor functions that turn raw atoms into inferred metrics (labor value, enablement value, opportunity cost, risk carry). The shape of these algorithms was articulated in this session; none are implemented at production quality.

3. **The user interfaces** — `DayCard.tsx` renders raw RPC output but has no narrative section (per `docs/library/prompts/P10-day-card-seven-level-analysis.md`), no factor-tuning UI, no claimed-vs-inferred delta surface. The UIs that exist are scaffolds awaiting the algorithm layer.

The user's framing: *"we can't really even address the interface until we have functioning algorithms and authentic data which we do pretty much have working on it."* That's the dependency order.

---

## What was articulated in this session (the theory)

### The daily receipt is a function, not a row

```
billable_value(vehicle_id, date) =
    compute(immutable_atoms_for_that_day, current_factor_values)
```

Atoms (photos, timestamps, GPS, per-photo classifications, parts receipts) are frozen testimony. Factors (labor rate, tier multiplier, quality target, markup %, enablement estimate) are looked up live. Receipt is the join.

**Implication:** changing the labor rate from $85 to $95 updates every historical receipt automatically because no receipt was ever stored — they are all computed views. There is no "recalculation" because nothing was ever calculated and frozen.

### Three layers of metric, not two

Initial framing (atoms + factors) was incomplete. Real shape:

| Layer | Source | Mutability |
|---|---|---|
| **Atoms** | photos, GPS, receipts, EXIF, observed events | frozen (per trust invariant) |
| **Inferred metrics** | algorithm output from atoms × market comparables | algorithm-bounded (we tune, not users) |
| **Claimed metrics** | what user / shop / billing system says | mutable, tracked alongside |
| **Delta** | inferred − claimed | derived, the headline insight |

The delta is the worth-proof. *"I claimed $0, system says $4,500 based on N comparables with confidence X"* — that's the output the system exists to produce.

### Tuning is not falsification — it is the education mechanism

A user can dial their claimed rate to $3000/hr. The system does not police this. It surfaces variance: *"your claim diverges from market by 30×; here is why."* Sometimes the user is correct (genuine top-tier specialist with a verified track record). Sometimes the user is delusional. The system reports, the market eventually clears.

**The tunability IS the worth-proof, because the dial-versus-market comparison is what teaches.** They are not opposing concepts as I initially framed them.

### Truth is accurate event reporting

The user's exact phrasing: *"the truth is is basically just accurately reporting on the events."*

The system is not normative. It does not say "you should charge more" or "you are undervaluing yourself." It says: *"on April 14, 2026, you spent 224 minutes at coordinates 35.972°N -114.855°W, the photos show these operations, you have claimed $0 for this work, and the nearest market comparable suggests a range of [unknown — N=0]."* The user draws conclusions.

The closer the system stays to events-as-they-occurred, the more defensible the worth-proof becomes.

### Hourly rate is a 2D price surface, not a scalar

A shop charges different rates for the same job to different customers, all rationally:

```
hourly_rate(customer, moment) =
    overhead_floor (license + rent + equipment_depreciation + insurance + utilities)
                   / shop_billable_hours_per_month
  + technician_cost_per_hour
  + utilization_premium(current_queue_state)
  + urgency_premium(customer urgency 1.0..2.5)
  + specialty_premium(task complexity 1.0..1.8)
  − patience_discount(customer flexibility 1.0..0.5)
  ± strategic_modifier (bootstrap_discount during slack | bootstrap_DEBT at capacity)
```

Two customers, same job, same shop, same day, radically different bills — and both correct.

### Bootstrap clients become debt at capacity

Non-obvious insight from the session. Same low-pay client:

```
utilization < 60%  → client is VALUABLE  (fills empty hours, marginal revenue)
utilization 60-80% → client is NEUTRAL   (fairly priced)
utilization > 80%  → client is DEBT      (occupies slot that could go to premium customer)
```

Sign of the per-client lifetime value flips when shop utilization crosses a threshold. The system should detect this transition per (client_id × shop × time) and surface it as a strategic alert.

### Worth is more than realized revenue

```
worth(period) =
    Σ (your_realized_rate − overhead_floor) × hours
  + Σ (opportunity_value_unlocked − opportunity_value_displaced)
  + intangible_capital_growth
        (reputation, photo evidence portfolio, documented capability, equipment value)
  − tied_capital_decay
        (slow-pay clients sitting on lot, inventory not moving, customer-promised delivery debt)
```

Two shops with identical cash revenue can have radically different worth because one is converting capacity to premium clients (intangible compounds) and the other is grinding bootstrap clients at capacity (debt accumulates).

---

## What was actually built (the artifacts)

### Scripts shipped

1. **`scripts/daily-receipt/process-photo.mjs`** (~150 lines)
   - Per-photo intake step
   - SHA-256 dedup, idempotent
   - Uploads to `vehicle-photos` storage at `{vehicle_id}/daily-receipt/{hash12}_{filename}`
   - Inserts `vehicle_images` row with `area/part/operation/image_type/category/caption/fabrication_stage` populated from caller-vision classification JSON
   - Posts atom to `ingest-observation` (canonical path) with full provenance: `source_slug=photo_pipeline, agent_tier=caller-byok, agent_model=claude-opus-4-7-1m, extraction_method=caller-vision-Read-tool`
   - Outputs `{vehicle_image_id, observation_id, storage_path}`

2. **`scripts/daily-receipt/build-day.mjs`** (~180 lines after multi-factor upgrade)
   - Per-day rollup step
   - Queries `vehicle_images` for `(vehicle_id, date)`
   - Computes time span and labor minutes (conservative 70% of span)
   - **Multi-factor labor value**: `base × tier × quality × speed × specialty(weighted from operations)`
   - **Parts**: `direct_cost × (1 + markup_pct)`
   - **Value adjustments**: `+ enablement_unlock + risk_carry − opportunity_cost`
   - Upserts `work_sessions` row (cost-side stored)
   - Calls `get_daily_work_receipt` RPC and prints human-readable VALUE STATEMENT

3. **Library doc:** `docs/library/technical/engineering-manual/17-daily-receipt-processor.md` — documents the chain, the scripts, the anti-patterns, the open work.

### Substrate written

Across ~30 atoms in this session:

| Date | Atoms | Description |
|---|---|---|
| 2026-04-14 | 8 photos + 1 work_session | Pickup + initial teardown ($317.33 cost / $4,466.50 value w/ multi-factor) |
| 2026-04-15 | 5 photos + 1 work_session | Engine bay + underbody + hood off ($408.00) |
| 2026-04-16 | 1 negative-space atom | Off-Mustang day (work on K5 or Bronco) |
| 2026-04-17 | 2 photos + 1 work_session | iBooster brake plan + interior wiring ($87.83) |
| 2026-04-18 | 1 negative-space atom | Off-Mustang day |
| 2026-04-19 | 2 photos + 1 work_session | Floor pan strip + Kilmat sound deadener ($90.67) — superseded later for brand correction |
| 2026-04-20 | 1 photo + 1 work_session | Underbody paint prep ($42.50) |
| 2026-04-21 | 1 photo + 1 work_session | Under-dash steering column inspection ($42.50) |
| 2026-04-22 | 1 photo + 1 work_session + 1 supersession | Kilmat continued + correction of Apr 19 Dynamat→Kilmat brand call ($42.50) |
| 2026-05-19, 20, 21 | 8 photos + 1 work_session | Wiring + bench harness + exhaust install (May 21 daily receipt prior in session, $317-equivalent) |
| 2026-05-21 | 4 photos | Receipt + 2 exhaust shots + red British roadster pivot |
| 2026-05-23 | 2 market_testimony atoms | Boulder City shop landscape + pricing function theory |

Plus:
- 1 supersession-correction atom (X-pipe call → undetermined crossover, Apr 19 Dynamat → Kilmat)
- 2 negative-space markers (Apr 16, Apr 18) — explicit zero-Mustang-work days

**Running total: $1,031.33 cost-side billable across 9 days (7 active, 2 negative-space).** With the multi-factor equation applied: substantially higher value-side numbers as the equation propagates.

### Corrections made via supersession

- Apr 19 IMG_9667 — claimed Dynamat sound deadener. Apr 22 IMG_9788 shows orange KILMAT branding. New atom written with `correction_reason: "brand misidentification — said Dynamat, was Kilmat"` and explicit reference to evidence atom.
- May 21 IMG_0817 — claimed X-pipe exhaust crossover. User flagged hallucination. New atom written: `crossover_type: undetermined_from_this_angle, supersedes: 750e5e34, correction_reason: "prior atom asserted X-pipe without sufficient evidence"`.

**Both originals preserved per trust invariant. Corrections are additive atoms, not destructive edits.**

---

## What was deleted / abandoned

Tools and patterns explicitly rejected during the session:

1. **Album-scoped ingest as primary path** — works for curated albums, fails for camera-roll-resident work photos. User does not file as he works. Decision: future ingest is camera-roll-wide (`photo-sync.mjs` pattern).

2. **YONO Python sidecar dependency** — offline 5+ months per ISSUES.md. Decision: replaced by caller-BYOK vision (Claude in session via Read tool, subscription compute).

3. **Anthropic API credit dependency** — balance is $0. The first attempt at a `scripts/claude-vision-classifier.mjs` worker was deleted because it coupled to the dead API path. Decision: subscription-only via caller-BYOK.

4. **Tunable rate as user-side configuration** — early framing was "let user set their rate." Corrected mid-session: the rate is an inferred metric, the claim is separate, the delta is the point. Tuning is education, not falsification.

5. **Receipt as a stored row with frozen value** — initial `build-day.mjs` baked the labor cost into `work_sessions.total_labor_cost`. Decision: future architecture stores raw inputs only; value is computed on read against current factor tables. (Migration not yet done — current scripts still bake.)

---

## The snake-eating-tail pattern

This concept has been discovered repeatedly:

```
✅ Apr 26 (5d0848ba)  — pipeline architecture designed
✅ Apr 26 (5d0848ba)  — substrate built: CLIP embeddings, image_observations, emergent_vehicle_clusters
✅ May 3  (f9e0cd84)  — get_daily_work_receipt RPC + DayCard.tsx shipped
✅ May 23 (9fcdd38f)  — process-photo + build-day + 9 days of Mustang substrate
❌ STILL OPEN          — camera_roll → vehicle_images (with vehicle_id) for un-albumed photos
❌ STILL OPEN          — the algorithm layer (inferred-metric computation against comparables)
❌ STILL OPEN          — claimed-vs-inferred delta surface
```

Each session arrives at the same downstream-works-but-upstream-empty gap. The system is starved. The architecture is right. The conversation keeps re-discovering this.

**The way this session attempted to break the loop:** ship the smallest piece that proves end-to-end flow (8 Apr 14 photos → vehicle_images rows → work_session → daily receipt). The proof is in the substrate now (`work_session_id: 2f016ca3-6bf6-4ace-a245-d84cd687b926`). The pattern is repeatable. The remaining ~30 days of Apr-May 2026 backfill is mechanical now that the loop works.

But the deeper loop — algorithm + interface — remains. The next session that picks this up should not redesign the substrate (it is correct). It should not rewrite the scripts (they are correct). It should not re-articulate the theory (this paper exists). It should **complete the algorithm layer**: a real inferred-metric computation against the actual `organizations` data, the actual `work_sessions` history, and the sparse-but-real comparables we have.

---

## Open work, ordered

### Immediate (substrate filling — extends what works)

1. **Apr 23 → today** Mustang backfill at current per-day cadence — accumulates atoms while algorithm is being designed
2. **Add Skylar's physical shop** (707 Yucca St) as `organizations` row — the data does not exist; the Nuke org is the platform, not the shop
3. **Populate the Boulder City competitor map** captured today (Meineke, Firestone, BK Customs, First Choice, Justin, Trent, Dave, etc.) as `organizations` rows with `data_density: low_corroboration` flagged

### Near-term (algorithm layer)

4. **Inferred-metric RPC** — `compute_inferred_labor_rate(vehicle_id, date, shop_id, technician_id)` that returns `{value, confidence_low, confidence_high, n_comparables, methodology_note}` — sparse data returns wide bounds, dense data returns tight bounds, zero data returns explicit "no data" rather than fabricated number
5. **Claimed-vs-inferred delta surface** — display layer that shows both numbers side by side with the delta and the data-density caveat
6. **Strip baked labor_cost from work_sessions** — migrate to raw-inputs only; let receipt be the live computation
7. **Build the `shop_overheads` substrate** — license, rent, equipment, insurance as line items per `organization_id` — enables overhead_floor computation
8. **Build the `equipment_depreciation` substrate** — per-equipment purchase date, useful life, current value — enables equipment cost amortization in the rate formula

### Strategic (interface layer)

9. **Seven-Level Analysis narrative in DayCard.tsx** per `docs/library/prompts/P10-day-card-seven-level-analysis.md` — template logic, inline in the component, no LLM call at render time
10. **Factor-tuning UI** — sliders for the user to dial their claim, with live delta-from-inferred display, with confidence-interval visualization, with comparables-table inspection
11. **Bootstrap-to-debt detection alert** — surfaces the per-client lifetime-value sign-flip when shop utilization crosses thresholds

### Long-running (data network effects)

12. **Auto-capture market testimony** — when conversation mentions a shop / technician / pricing claim / overhead figure, agent writes a `market_testimony` atom for it, attributed to the speaker, with `data_density` self-rating
13. **External market data ingestion** — Yelp / Google reviews / BBB profiles / state license databases / publicly-listed shop rate sheets — programmatic enrichment of the sparse `organizations` rows
14. **Comparables aggregation job** — nightly batch that recomputes per-(geography × specialty × tier) labor-rate priors with confidence intervals, materialized into a hot-read table

---

## Specific decisions that should not be revisited

These are settled. Future sessions should treat them as canon unless explicit re-litigation is invoked.

1. **Caller-BYOK vision is the chosen compute path** for image classification (not YONO sidecar, not paid Anthropic API). Documented in `feedback_vision_is_caller_byok_laser_tag.md` and validated this session.

2. **`ingest-observation` is the canonical write path** for atoms. Direct `INSERT INTO vehicle_observations` is anti-pattern. Documented in CLAUDE.md and validated this session via 30+ atoms.

3. **Trust invariant is absolute.** Corrections are supersession atoms with explicit `supersedes` reference + `correction_reason`. Never UPDATE or DELETE testimony. Validated this session via X-pipe correction and Dynamat → Kilmat correction.

4. **Camera-roll-wide is the primary ingest pattern**, not album-scoped. Album-scoped (`iphoto-intake.mjs`) is retained for curated cases but should not be the autopilot path. (Wiring of `photo-sync.mjs` plist to launchd is gated on `--all` matching being verified, which was completed during this session.)

5. **Negative-space atoms are first-class data**, not absence. A day with no Mustang work produces an explicit "no Mustang activity observed; other vehicle work confirmed" atom. The system reasons about what someone was *not* doing as much as what they were.

6. **Receipts are computed views, not stored rows.** (Migration outstanding; intent locked.)

7. **The algorithm is internal IP.** Users tune their claimed metrics. The inferred-metric algorithm is bounded by market priors and not user-adjustable.

---

## What this session got wrong and corrected mid-flight

For the next agent that inherits this work:

| Mistake | Correction |
|---|---|
| Fabricated "Boulder City master mechanic $90-115/hr" from training-data vibes | Acknowledged hallucination; we have 5 orgs total with rate data; inferred bound is currently `[?, ?]` with confidence ≈ 0 |
| Claimed "we have no shops data" | Actually 5,269 organizations rows; 3 in Boulder City NV with full rich schema available |
| Claimed "we have no daily-receipt aggregator" | Actually `get_daily_work_receipt` RPC + `DayCard.tsx` + `work_sessions` table all exist; gap was upstream (no vehicle_images for un-albumed photos) |
| Framed "tunability vs worth-proving" as opposing concepts | They are the same thing — the dial-vs-market comparison IS the worth-proof |
| Wrote `claude-vision-classifier.mjs` coupled to Anthropic API credits | Deleted same session; replaced with caller-BYOK pattern via Read tool |
| Skipped from Apr 14 to May 20 to compare states | User flagged: "the images in between tell the story"; pivoted to day-by-day contextual packaging |
| Bake-and-store labor cost into work_sessions row | User flagged: should be computed view on raw inputs against current factor tables; baked version retained pending migration |

---

## Closing assertion

**The next session that picks this up has more leverage than it realizes.** The substrate exists. The schema exists. The downstream renders exist. The pattern is proven on one vehicle for one week. The theory is articulated.

The deliverable that closes the loop the most is: **the inferred-metric RPC.** A single Postgres function `compute_inferred_value(vehicle_id, date)` that joins the day's atoms with the current organizations / shops / technicians data and returns `{value, confidence, methodology, comparables_used}`. Once that exists, the value statement printed by `build-day.mjs` is no longer a function of CLI flags — it is a function of the current state of all your substrate. Every receipt in the system updates the moment market data changes.

That RPC is maybe 80 lines of PL/pgSQL. The substrate it queries is mostly built. The math is multiply-and-add. What it produces is the worth-proof you have been articulating for two years.

That is the highest-value next move. Everything else in this paper is downstream of it.

---

## Cross-references

- `docs/library/technical/engineering-manual/17-daily-receipt-processor.md` — the scripts shipped this session
- `docs/library/technical/engineering-manual/04-observation-system.md` — the atom write path
- `docs/library/technical/engineering-manual/05-image-pipeline.md` — image intake & classification
- `docs/library/prompts/P10-day-card-seven-level-analysis.md` — the narrative composer spec
- `docs/library/reference/encyclopedia/03-timeline-architecture.md` — how per-day data composes
- `docs/library/intellectual/contemplations/the-trust-invariant.md` — why supersession not UPDATE
- `~/.claude/projects/-Users-skylar/memory/feedback_vision_is_caller_byok_laser_tag.md` — the BYOK pattern
- `.claude/ISSUES.md` — the CRITICAL entry for the launchd plist (still open) and YONO offline status
- session transcript: `~/.claude/projects/-Users-skylar/9fcdd38f-5f2d-42f0-9b04-c50add38b086.jsonl`
- prior threads on this concept: `5d0848ba`, `f9e0cd84`, `a96f32d4`, `aefe49ba`, `e669bbe3`, `1aa7acdd`, `c3933cd3`, `5d0848ba`, `56aceca5`, `4078eae4`

End of working paper.

---

## Addendum 2026-05-23 — The per-vehicle reframe (mid-session correction)

### What the user said

> "take all the contacts you can possibly have and build daily receipts now what this creates is that it creates within the gaps if there's other vehicles being worked on you would be using that information to build those profiles but again this is all sourcing originally from the user profile and what they're doing and the vehicle profiles are in in a way they are like derivative of the users to a degree but the way that the vehicle profiles work at scale is that other users can participate in them if they have factual data to provide"

### What this corrects

The "negative-space" framing of days where the Mustang was not worked on was **wrong**. There is no negative space. Every day is positive space for **some** vehicle. The 17 Mustang days documented (April month 1) actually represent **work across N vehicles**, with the Mustang as the dominant subject. The other-vehicle days were misclassified as absence rather than as evidence of other-vehicle activity.

### The corrected model

```
Each day produces a set of daily receipts:
  for each (vehicle_id worked on that day):
    build a daily receipt for (vehicle, date)

  The "all-vehicles aggregate" for the user that day is the union.
```

The Skylar user profile is the source of truth (he is the one capturing the activity). Vehicle profiles are **derivatives** of his activity. At scale, multiple users can contribute observations to the same vehicle profile (a previous owner uploads photos, the current owner adds maintenance receipts, a shop employee captures work-order photos — all attribute to the same chassis).

### Demonstrated in DB this session

Three vehicles now have daily-receipt substrate:
- **1966 Ford Mustang Coupe Black** (`eeb9fa61-01e8-49a6-8eab-a7cc0e23d30f`) — 7 active days fully atomized, 4 label-pattern days, 2 multi-day supersession corrections
- **1973 Pontiac Firebird** (`2d99d294-55ae-4dfd-8444-d46d8e90d102`) — Apr 24 shop inspection
- **1997 Lexus LX450 VX Limited** (`4ecc1fa5-c2c2-485b-bc57-144d6215d22a`) — Apr 27 video production session

The same `scripts/daily-receipt/` tools work on any vehicle. No code change required — just `--vehicle-id` swap.

### Architectural implication

The `build-day.mjs` CLI signature should evolve from per-vehicle-per-date to per-date with multi-vehicle output:

```
build-day --date 2026-04-16
  → produces N work_sessions, one per vehicle touched that day
  → produces ONE day-summary across all the user's vehicles
```

This becomes the user's daily work-receipt aggregate. The vehicle profile aggregates ALL its days across all contributors.

### The retroactive fix-up queue

Days previously logged as "Mustang negative-space" that should be re-processed as positive-space for other vehicles:

| Date | Apparent subject | Best-guess vehicle | Action |
|---|---|---|---|
| 2026-04-16 | engine bay with blue firewall, urban shop | possibly 1971 Bronco Coyote (b59-style) | needs visual confirm |
| 2026-04-18 | blue valve cover modern engine, ECU/circuit board work | possibly Bronco Coyote build | needs visual confirm |
| 2026-04-23 | tan vintage Suburban with older grey-haired man (likely Skylar father) | one of (1971 K15 Suburban, 1987 V15, 1988 V15, 1995 2500) | needs color/profile match |
| 2026-04-25 | industrial electrical control panel | not a vehicle — shop equipment maintenance | mark as shop-infrastructure, not vehicle work |
| 2026-04-26 | cream/tan interior with diagnostic tool | unclear, multiple candidates | needs visual review |

The negative-space atoms previously written are NOT wrong — they correctly reported "Mustang received no work this day." They are incomplete: they should be JOINED with positive-space atoms for the actual vehicle worked on.

### The contribution from this addendum

The retrospective above (pre-addendum) treated daily receipts as a per-vehicle concern centered on the Mustang. This addendum re-centers: **daily receipts are per-user, with per-vehicle decomposition**. The Mustang gets a vehicle-level timeline; Skylar gets a user-level timeline that joins all his vehicles' activity.

This is the **shape of the worth-proof at the user level**: "in April 2026 you spent N hours across M vehicles producing $X of value." Single-vehicle receipts are the leaf nodes. User-level receipts are the rollup.

End of addendum.
