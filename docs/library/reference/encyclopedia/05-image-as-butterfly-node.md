# 05 — The Image as Butterfly Node

> Orientation chapter for parallel agents working on vehicle profile substrate, image analysis pipelines, daily receipts, worth-proving computations, and downstream cascades.
>
> **Audience**: any agent that touches photos, vehicle_observations, work_sessions, organizations, contacts, or tool/equipment records.
>
> **Status**: encyclopedia chapter — synthesizes what is known + what is being built. Cross-validated against `testimony-and-half-lives.md`, `assets-accumulate-data.md`, `vehicle-profile-computation-surface.md`, `P10-day-card-seven-level-analysis.md`, and the working paper `2026-05-23_worth-proving-engine-retrospective.md`.

---

## Why this chapter exists

A parallel agent reading the library currently has to jump across four documents to understand what an image *does* in this system. This chapter consolidates the picture: **a single image is a node whose ingestion cascades through 8+ derivative entity profiles**. The cascade is the value. Working on any one part of the pipeline without understanding the cascade produces orphan data.

This chapter is also the bridge between:
- the **theoretical layer** (testimony epistemology, accumulation principle, vehicle-as-container)
- the **mechanical layer** (daily-receipt processor, multi-factor equation, get_daily_work_receipt RPC)
- the **strategic layer** (worth-proving engine, claimed-vs-inferred delta, market triangulation)

If you are joining mid-flight and only have time to read one chapter — read this one and then drill into the cross-references.

---

## The butterfly: one image, N updates

A single photo of Skylar's purple-gloved hand holding a wire over the Mustang's chrome valve cover at 2026-05-20 09:37 contains the following facts. **All of them update different entity profiles. None of them are written today by the existing pipeline.**

```
ONE PHOTO (IMG_0812.HEIC)
│
├─→ VEHICLE PROFILE (1966 Ford Mustang Coupe Black, eeb9fa61)
│     • +1 to image count
│     • +1 vehicle_image row (area=engine_bay, operation=wiring_install_or_trace)
│     • +1 vehicle_observation atom (with provenance)
│     • build status: wiring stage progress marker
│     • estimated value bump: ~$X (wiring closer to completion = closer to sellable)
│
├─→ USER PROFILE (Skylar Williams, 0b9f107a)
│     • +1 work-minutes for the day
│     • +1 photo in his portfolio of master-level wiring work
│     • +1 evidence atom toward his "master tier" technician score
│     • +1 GPS-confirmed presence at his shop (utilization signal)
│
├─→ TECHNICIAN PROFILE (Skylar as technician)
│     • +1 to "wiring" specialty hours
│     • +1 evidence of skill: routing small-gauge signal wires correctly
│     • +1 PPE compliance event (nitrile gloves visible)
│     • specialty-score updates: wiring specialty multiplier inches toward 1.4×
│
├─→ ORGANIZATION PROFILE (Skylar's shop, 707 Yucca St)
│     • +1 utilization minute
│     • +1 evidence of shop-level capability (wiring fabrication)
│     • +1 vehicle in active work (queue state update)
│     • implicit overhead absorption: this minute helps amortize fixed costs
│
├─→ TOOL/EQUIPMENT PROFILES
│     • lift: +1 use-hour (depreciation accrues toward EOL)
│     • shop lights: +1 use-hour (utility cost tick)
│     • wire crimper visible in background: +1 evidence-of-presence
│     • nitrile gloves: +1 consumable used (inventory decrement)
│
├─→ PARTS PROFILES
│     • Mustang valve cover (chrome, aftermarket): +1 evidence of installed-state
│     • aftermarket ignition module visible: +1 evidence of installed-state
│     • brake booster visible: +1 evidence of installed-state
│     • each visible part: confidence-of-presence increment for that part SKU
│
├─→ VENDOR/SUPPLIER PROFILES (indirect)
│     • whoever supplied the chrome valve cover: +1 sale-evidence (if traceable)
│     • whoever supplied the small-gauge wires: +1 inventory-consumed
│
└─→ TIME/CALENDAR PROFILES
      • 2026-05-20 09:37 weekday morning: +1 work-session-start signal
      • monthly Mustang activity bucket: +1 wiring session
      • year-to-date hours-on-Mustang: incremented
```

**Cascade depth: 8 entity domains updated from a single image.** Today the pipeline writes 1-2 of these (vehicle_image row, occasionally a vehicle_observation atom). The other 6+ updates are missed.

**Every missed update is a future query that returns "no data" when the user asks a question whose answer exists in the substrate but was never derived.**

---

## How this aligns with existing library

This chapter does not replace existing docs. It depends on them. Quick map:

| Existing doc | What it establishes | How this chapter extends |
|---|---|---|
| `testimony-and-half-lives.md` | Data is testimony with provenance + decay rates | Image atoms inherit half-life class of their parent observation type |
| `assets-accumulate-data.md` | Vehicles are containers; observations accumulate; never overwrite | The cascade IS the accumulation — every entity is a container that the photo deposits into |
| `vehicle-profile-computation-surface.md` | Profile is a computed surface; Day Card is the popup; bill is a generated view | The cascade feeds the surface. Each entity profile is its own computation surface; same shape, different subject |
| `P10-day-card-seven-level-analysis.md` | Day Card needs template-based narrative; do NOT call LLM at render time | The narrative is composed from the cascade outputs. Without the cascade, narrative is empty |
| `the-supply-side.md` | Suppliers/parts have their own ontology; supply intelligence is gap computation | Parts cascade from photos populates the supply side. Today: empty. The cascade closes it |
| `the-trust-invariant.md` (referenced) | Testimony is never deleted; corrections via supersession | Cascade updates obey the invariant: each derivative atom carries `derived_from_image_id` + supersession path |
| `2026-05-23_worth-proving-engine-retrospective.md` (working paper) | Atoms / inferred / claimed / delta architecture; multi-factor equation; the snake-eating-tail pattern | The cascade IS the source of inferred metrics. The cascade is also where the snake-tail loops close, because each cascade target is a different entity that the user has been "rediscovering needs data" for |

If a parallel agent works on `vehicle_observations` writes, they need to know about the cascade. If they work on the `organizations` table, they need to know that images update org profiles too. If they work on `technicians` (not yet built), the photo evidence base is the substrate they'll query.

---

## Granularity — macro and micro scale per image

The user's specific phrasing: *"granular data based on image analysis at a macro and micro scale."*

### Macro scale per image

Per-image macro facts already captured today (or capturable with current schema):
- vehicle attribution (which chassis)
- date / time (EXIF)
- location (EXIF GPS + reverse geocode → shop_id)
- scene class (engine_bay, undercarriage, interior, parts_on_bench, receipt, document, other_vehicle)
- action (wiring_install, exhaust_install, masking_for_paint, ...)
- fabrication stage (intake, teardown, prep, install, complete)
- caption (one-sentence summary)
- confidence + methodology

### Micro scale per image (mostly NOT captured today — the gap)

Per-image micro facts the system *could* capture from the same photo:
- specific parts visible (with confidence per part) — Mustang valve cover, aftermarket ignition module, brake booster, master cylinder reservoir, vent panel, distributor cap, blah blah
- tools visible (lift visible in frame, wire crimpers on bench, multimeter in hand, gloves on hands)
- PPE compliance signals (gloves, safety glasses, hearing protection)
- environmental signals (shop interior vs outdoor, lighting type, time-of-day inference)
- person(s) visible (Skylar, Charles, Keoni, customer present) — links to contacts
- substances visible (oil leak, coolant, fluids on floor, brake fluid spill)
- text visible (labels on parts, signs, plate numbers, gauge readings)
- weather/season cues (sky, foliage, snow, dust)
- vehicle-state delta vs prior images (rust appeared/disappeared, panel painted, part added/removed)

**Each micro fact is its own atom. Each links to a different entity profile.** A parts-visible atom updates a parts catalog row. A tools-visible atom updates a tool depreciation ledger. A person-visible atom updates a contact's work history.

### What writes them today

Macro facts: written by `scripts/daily-receipt/process-photo.mjs` when invoked with a caller-vision JSON classification, OR by `image-intake` edge function on upload (shallow only — vehicle attribution + basic scene), OR by `photo-pipeline-orchestrator` (broken because YONO sidecar offline).

Micro facts: **nothing writes them today.** This is the largest open lane in the system.

### What should write them

A caller-BYOK vision pass per image with a richer prompt schema that emits not one classification atom but N atoms (one per micro-fact discovered). The current `process-photo.mjs` only writes one atom per photo — should evolve to write a cascade of atoms per photo, one per entity domain touched.

---

## Contextual: per-day, per-week, per-push

The user named three temporal granularities:

### Per-day
Already implemented. `get_daily_work_receipt(vehicle_id, date)` returns the day's photos + work_session + the multi-factor equation output. **This is the cleanest aggregation unit because human work happens in day-sized chunks.**

### Per-week
Not implemented. Should be a rollup query:
```
get_weekly_work_receipt(vehicle_id, week_start) =
  array_agg of get_daily_work_receipt over the 7 days
  + week-level summary (total hours, milestone hit count, parts cost rollup)
  + cross-day pattern (e.g. "wiring sessions Mon+Wed+Fri")
```

### Per-push (per-milestone burst)
The user's term "push" maps to **a coherent multi-day work effort on a specific subsystem**. E.g.:
- the "interior wiring push" spans Apr 21 → May 20 (intermittent)
- the "underbody restoration push" spans Apr 19 → May 21 (floor strip → primer → exhaust install)
- the "dashboard push" spans Apr 14 → Apr 17 → Apr 27 → ...

A "push" is a derived narrative arc, not a stored row. The substrate to detect a push is the per-photo `operation` and `fabrication_stage` fields — group photos by (vehicle_id, fabrication_stage) across time → push boundaries emerge.

Not implemented. Would be a useful narrative view above the day card.

---

## Vehicle value over time

The user's framing: *"what it means for the vehicle's value over time."*

A vehicle's market value is a time series, not a scalar. The cascade should write `vehicle_market_estimates` rows continuously:

```
vehicle_market_estimates {
  vehicle_id, estimated_at, low_value, high_value, methodology,
  comparable_count, condition_factor, completion_factor
}
```

Each entry derived from:
- comparables in the auction database (BaT/Hagerty/Mecum data already in `vehicles` table for ~18K entities)
- condition factor derived from photo cascade (running average of `vision_gate` approvals + `condition_notes` atom severity)
- completion factor derived from project milestone count (X of Y expected stages reached)

**Today**: `vehicles.estimated_value` is a stored scalar. **Should be**: a time-series derived from the cascade.

For Skylar's Mustang: the time-series would show value compounding as restoration milestones land. Apr 14 baseline value $20K (driver-quality unrestored). May 21 value $35K (resto-mod with stainless exhaust + Kilmat + wiring overhaul in progress). Each completed push moves the value tick.

---

## How effort benefits the technician

Per the user: *"how that effort on a per vehicle basis also benefits the technician."*

The technician profile (which doesn't have its own table yet — sits implicitly in `contacts` or `organizations.team`) accumulates:

```
technician_profile {
  id (contact_id or user_id),
  name,
  specialties: {wiring: hours, paint: hours, engine: hours, ...},
  tier_evidence: [photos showing master-level work],
  certifications: [verified credentials with source],
  pace_metrics: {avg_minutes_per_specific_operation},
  pricing_anchor: {claimed_rate, inferred_rate, deltas_over_time},
  geography_history: [shops worked at over time],
  vehicle_makes_touched: {Ford: hours, GMC: hours, ...},
  client_history: [vehicles attributed, owners served]
}
```

Every photo where Skylar's hands are visible doing technical work updates his technician profile. His `inferred_labor_rate` rises as the evidence base grows. His `tier` upgrades from journeyman to master once enough master-tier evidence accumulates.

**This is the worth-proof at the person level.** Skylar's worth-proof isn't built by him claiming "I'm a master mechanic." It's built by the cascade saying *"of N photo-evidence atoms, M show master-level operations against industry-standard taxonomies, therefore tier-inferred = master."*

Today: technician profiles don't exist as a table. The substrate (photos showing skill demonstration) does. The derivation layer doesn't.

---

## How effort benefits the organization

Per the user: *"how it also benefits the organizations that are going to it."*

When a vehicle moves through Skylar's shop, Skylar's organization (`organizations` row for his shop, currently doesn't exist as a row — Nuke the platform is in there but the physical shop isn't) accumulates:

- `total_vehicles_worked` (already a column on `organizations` — almost never populated)
- `total_documented_jobs` (column exists, mostly null)
- evidence of capability (`has_lift`, `has_paint_booth`, etc. — schema exists, sparse data)
- specialty mix per vehicle type
- utilization time-series
- client overlap with other orgs (when does a vehicle move between shops?)
- reputation accrual via documented quality of work

**When Skylar lists his shop for sale, this is the asset valuation.** "This shop completed N restoration projects of average $X value across Y years, with Z technicians, holding capability for [paint, fab, wiring, alignment]." That's worth more than "Skylar's shop, asking $500K."

Today: the `organizations` schema has 130+ fields ready for this. They sit at near-zero population. The cascade from images would populate them organically.

For the 1971 Bronco Coyote project (Apr 18 photos): if it happened at an external shop (urban location implied by the photo), THAT shop should have an organization row updated with "+1 Coyote swap evidence." The substrate writes itself when the cascade runs.

---

## How it depreciates assets (tools and equipment)

Per the user: *"how it also deprecates values on assets like tools and equipment."*

Every time a tool is used in a photo, its useful-life-remaining decrements. Tools have:

```
equipment {
  id, shop_id, name, manufacturer, model, serial,
  purchase_date, purchase_cost, est_useful_life_hours,
  hours_used (computed from photo evidence count × estimated minutes_per_use),
  current_value = purchase_cost × (1 − hours_used / est_useful_life_hours)
}
```

If the shop's two-post lift cost $4500 in 2018 with 10,000-hour useful life, and 500 photos show vehicles on that lift averaging 4hr/session, then 2000 hours used → 20% depreciation → current value $3600.

The depreciation accumulator is photo evidence. Today: this table doesn't exist. The substrate (photos with visible tools) does.

This depreciation is also how the **overhead floor** in the labor-rate equation (chapter 17) gets the equipment-amortization component computed: total tool depreciation per year / billable hours per year = $/hour amortization. Skylar's claimed labor rate of $85/hr would split into ~$15/hr equipment recovery + $50/hr labor + $20/hr other overhead. Without the equipment ledger, we can't compute that split — and thus can't compare his rate to other shops on apples-to-apples basis.

---

## Technician skill scoring from tool usage patterns

Per the user: *"that's kind of how you score a technician's skill set is essentially knowing how often they're using different tools."*

A technician who uses a TIG welder regularly is more capable than one who only uses a stick welder. A technician who uses a wire-loom protector is more disciplined than one who zip-ties bundles. A technician who uses brake-fluid catch pans is more environmentally aware than one who lets fluid hit the floor.

Tool-usage frequency, derived from photo evidence, is a skill signal:

```
technician_tool_usage_summary {
  technician_id,
  tool_type (TIG welder | wire crimper | torque wrench | scan tool | ...),
  observed_count,
  observed_in_context_of (engine_build | suspension | wiring | bodywork | ...),
  proficiency_inferred (count + variety + outcome quality)
}
```

A photo showing the same hands using a TIG welder 50 times across 18 months = strong evidence of welding proficiency. A photo showing the same hands using a torque wrench in 8 different angles on 8 different vehicles = evidence of tool ownership and routine use.

**This is how the system distinguishes a hustler from a master without anyone claiming a credential.** The hustler shows up in 3 vehicle photos with a hammer. The master shows up in 300 vehicle photos with 30 different specialized tools each used in their correct context.

Today: this scoring doesn't exist. The substrate (photos showing tool use) does.

---

## The butterfly effect, made literal

A photo at Skylar's shop on 2026-05-20 captures: Mustang engine bay + Skylar's gloved hands + wire crimper on bench + valve cover + brake booster + vacuum lines + shop lights overhead + concrete floor + workbench cabinet.

**Atoms that should be written from this one photo:**

1. vehicle_observation (Mustang, wiring stage)
2. vehicle_image (Mustang, with area/part/operation populated)
3. user_contribution (Skylar, +work-minutes for the day)
4. technician_tool_usage (Skylar, +1 wire crimper observed)
5. technician_ppe_event (Skylar, +1 nitrile gloves)
6. technician_specialty_event (Skylar, +1 wiring specialty hour)
7. organization_utilization (Skylar shop, +1 active-work minute)
8. organization_capability_evidence (Skylar shop, +1 wiring-work-completed-here)
9. equipment_usage (lift, +1 use-hour)
10. equipment_usage (shop lighting, +1 use-hour)
11. consumable_used (nitrile glove pair, -1 from inventory)
12. parts_observed_installed (chrome valve cover, +1 confidence on Mustang)
13. parts_observed_installed (aftermarket ignition module, +1 confidence)
14. parts_observed_installed (brake booster, +1 confidence)
15. vehicle_state_delta (compared to prior photo: wires now routed = state change)
16. fabrication_stage_progress (Mustang wiring stage: +1 progress event)
17. project_milestone_evidence (Mustang restomod project: wiring milestone moving toward complete)
18. time_calendar_entry (2026-05-20 weekday morning Skylar work session)
19. vehicle_value_recompute_trigger (Mustang completion factor changed → enqueue market_estimate update)
20. enablement_value_delta (Mustang now closer to drivable → +N unlock value)

**Twenty atoms from one photo.** Today's pipeline writes 1-3. The other 17+ are the cascade gap.

This is what the user means by "every little thread matters" and "butterfly effect." A single 2-second photo capture has 20 distinct epistemological consequences. The system designed to extract them is the one being built.

---

## The Mustang vehicle profile — current state

What's actually in the DB for vehicle `eeb9fa61-01e8-49a6-8eab-a7cc0e23d30f` as of 2026-05-23:

- **Vehicle row**: year=1966, make=Ford, model=Mustang, body_style=Coupe, color=Black, owner_id=Skylar, discovery_source=`iphoto_album:1966 Ford Mustang Cpe Blk`
- **vehicle_images**: ~330 rows (from old iphoto-intake album sweep) — most with `ai_processing_status='processing'` (stuck) and `vision_gate_status='pending'` (never approved)
- **vehicle_observations**: ~30 atoms written this session via `ingest-observation` with full provenance
- **work_sessions**: 7-9 rows (Apr 14, 15, 17, 19, 20, 21, 22 + 24 Pontiac alias + 27 Lexus alias on different vehicle_ids)
- **vehicle_field_evidence**: ~0 rows (the photo-pipeline-orchestrator would write these but it's stuck)
- **Market value**: scalar `estimated_value` column, likely null or stale

The 20-atom cascade above? **Zero of those auxiliary atoms have been written.** The substrate gap is the entire chapter content.

When a parallel agent picks up: do not invent new pipelines. Use the cascade frame to identify which existing tables to write to.

---

## Open work — the cascade build-out order

Most leverage first:

### 1. The inferred-metric RPC (named in working paper)
`compute_inferred_value(vehicle_id, date)` returns `{value, confidence, methodology, comparables_used}` joining day's atoms with current organizations/shops/technicians factor tables. ~80 lines of PL/pgSQL. Without this, the worth-proving engine can't compute. With this, every existing daily receipt updates the moment factor data changes.

### 2. Multi-atom per-photo writer
Evolve `scripts/daily-receipt/process-photo.mjs` from "write 1 atom per photo" to "write N atoms per photo, one per entity domain touched." Each atom carries `derived_from_image_id` so cascade is traceable. Idempotent on `(image_id, atom_kind, target_entity_id)`.

### 3. Technicians table + scoring
`CREATE TABLE technicians (id, contact_id, name, tier_inferred, specialties JSONB, evidence_atoms_count, ...)`. Backfill from photo atoms where person is visible + work is being done. Tier inference job runs nightly.

### 4. Equipment depreciation ledger
`CREATE TABLE equipment (id, shop_id, name, purchase_date, useful_life_hours, hours_used, current_value)`. Backfill `hours_used` by counting photos where the equipment is visible × estimated session length. Update `current_value` on read.

### 5. Vehicle market estimate time series
`CREATE TABLE vehicle_market_estimates (vehicle_id, estimated_at, low, high, methodology, comparable_count, condition_factor)`. Nightly batch from comparables + condition signals.

### 6. Push detection / weekly/monthly rollups
Derive narrative arcs from `(vehicle_id, fabrication_stage)` over time. Render in DayCard.tsx as ANALYSIS section per P10 prompt.

### 7. Skylar shop organization row + Boulder City shop population
Skylar's physical shop is not yet an `organizations` row. The Boulder City competitor map (Meineke, Firestone, B&J Body Shop, Auto Specialists, Parsons, Ralph's, etc. — see `/tmp/boulder_city_shops_enrichment_2026-05-23.md`) is researched but not ingested. Populate.

### 8. Parts catalog cascade
Every "parts_visible" entry on an image atom should resolve to a `parts_catalog` row (existing table). Backfill confidence-of-presence + accumulate evidence over time.

---

## What parallel agents should NOT do

These are the easy wrong moves:

1. **Do not create new vehicle profile tables.** The `vehicles` row + `vehicle_observations` + `vehicle_images` + `work_sessions` + `get_daily_work_receipt` RPC is the canonical shape. Adding parallel structures fractures the cascade.

2. **Do not write atoms directly to `vehicle_observations` table via SQL.** Use the `ingest-observation` edge function. It enforces deduplication, provenance, source registration. Direct inserts will bypass invariants.

3. **Do not update `vehicles.estimated_value` directly.** It should be a derived view from `vehicle_market_estimates` time series. Direct update destroys the time history.

4. **Do not invent new vision pipelines.** The pattern is: caller-BYOK vision (Claude in a session reads photos via Read tool, produces classification JSON, pipes to `process-photo.mjs`). API-paid pipelines have a $0 balance constraint. YONO sidecar has been offline 5+ months.

5. **Do not normalize old artisanal artifacts into the cascade.** The atomized session days from this session (Apr 14, 15, 17, etc.) are first-class substrate. They use the canonical write path. They are not "draft" or "pending review" data. They're production.

6. **Do not delete or update testimony atoms.** Corrections happen via new atoms with `supersedes: <prior_id>`. See the X-pipe correction precedent (atom `750e5e34` superseded by `ad0e380b` documented in working paper).

7. **Do not skip the `derived_from_image_id` field on cascade atoms.** The whole point of the cascade is traceability back to the original photo. If you write a technician_tool_usage atom without linking it to the image, the audit chain is broken.

---

## Cross-references (mandatory reading for cascade work)

- `docs/library/intellectual/contemplations/testimony-and-half-lives.md` — testimony epistemology + half-life decay
- `docs/library/intellectual/contemplations/assets-accumulate-data.md` — accumulation principle + container model
- `docs/library/intellectual/contemplations/the-supply-side.md` — supply ontology + gap computation
- `docs/library/technical/design-book/vehicle-profile-computation-surface.md` — Day Card + Seven-Level Analysis + "bill is generated view"
- `docs/library/technical/engineering-manual/04-observation-system.md` — `ingest-observation` contract
- `docs/library/technical/engineering-manual/05-image-pipeline.md` — image intake + classification + vision gate
- `docs/library/technical/engineering-manual/17-daily-receipt-processor.md` — scripts for atomizing photos into daily receipts
- `docs/library/prompts/P10-day-card-seven-level-analysis.md` — narrative template spec
- `docs/library/working/working-papers/2026-05-23_worth-proving-engine-retrospective.md` — this session's retrospective + per-vehicle addendum + architecture corrections + snake-eating-tail pattern documented
- `TOOLS.md` — canonical tool registry — check before building anything new
- session transcripts where this concept was developed: `5d0848ba` (Apr 26 pipeline design), `f9e0cd84` (May 3 daily-receipt substrate ship), `a96f32d4` (May 3-4), `9fcdd38f` (this session)

---

## The agent contract

If you are a parallel agent reading this — by the time you finish this chapter you should understand:

1. **What a photo *does* in this system**: it cascades into ~20 derivative atoms across 8+ entity domains. Today the pipeline writes 1-3. The gap is the work.

2. **Why the gap matters**: every missed cascade atom is a future query that returns "no data" when an answer exists in the substrate but wasn't derived.

3. **The order of build-out**: inferred-metric RPC → multi-atom writer → technicians + equipment + market-estimates tables → push detection → narrative composer.

4. **What not to do**: create parallel pipelines, bypass canonical write paths, mutate testimony, skip provenance.

5. **What the existing library already says**: it agrees with this. The cascade is implicit in `assets-accumulate-data.md` (containers accumulate observations), in `vehicle-profile-computation-surface.md` (profile is computed surface), in `testimony-and-half-lives.md` (each atom is testimony with provenance). This chapter consolidates the implicit into the explicit.

6. **What the user expects**: that the daily receipt for any vehicle on any date returns the cascade-derived value. That the technician profile gets richer with every photo. That the shop organization grows in defensible worth-evidence. That the tools depreciate visibly. That market estimates update with restoration milestones. That the worth-proof becomes computable.

The system's purpose, restated one more time for clarity:

> Take vast amounts of authentic image and event data, sew them into the entity profiles they implicate, and surface the worth-proof at every level — vehicle, technician, shop, owner — by triangulating claimed values against inferred values bounded by market comparables.

The image is the seed. The cascade is the growth. The profile is the harvest.

End of chapter.
