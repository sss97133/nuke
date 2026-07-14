# Lab Notebook — Weight Model v0 (2026-07-11)

> Four experiments run against live substrate the same day the theory paper was
> authored (`papers/the-weight-model.md`). Every number below is measured, with
> the query basis recorded in the workflow journals (wf_8ac3317d-0a5,
> wf_08c427aa-2d3). Companion: `2026-07-11_sighting-ledger-schema-proposal.md`.

---

## Lab 1 — v1 localization (the owner's "first huge success" bar)

**Mesh verified by GLB parse** (`vehicle_coordinate_frames` 4b116404):
units = meters CONFIRMED (bbox 2.039 × 2.454 × 4.696 m → 80.3"W × 184.9"L vs
factory ~79.5" × 184.5" — within 1%). Axes: +Z=front, +Y=up. Derived landmarks
from factory overhangs, self-consistent to the mesh: **front axle z=+1.92 m,
rear axle z=−0.79 m, ground y=−0.53 m**. Anomaly flagged: y-extent 96.6" vs ~74"
real height — do not trust y-max as roofline. trust_score 0.5 → 0.7.

**First five pins landed** (fill-only UPDATE per the xyz paper §5, on
2024-10-03 byok observations): frame structure (z=560, ext 2200, rating 95),
LS3 (z=1550, 95), fuel tank (z=−1150, 80 — new-vs-refurb unknown), radiator
(z=2300, 95), front axle+wheels (z=1920, ext 900 spanning both sides — mesh +X
side-sign unverified, 92). The canonical time-lapse-at-coordinate query returns
them. **The scalar field exists: sparse, low-confidence, honest.**

**First capture-request list generated** from field gaps (weight-model §7): red
truck grille (closes Suburban-vs-GMC), rear axle tag (closes the biggest
drivetrain unknown), tank markings/receipt, intake casting (300-129 vs 300-131
conflict), accessory-drive brackets (Holley vs CVF conflict), shelf shot of
awaiting-install body parts.

**Blocker for scale:** bbox geometry (see audit) — projection of bboxes into
the field waits on the teacher-pass fix. Manual pins don't.

## Lab 2 — Image-group parameters (grouping as config, not chore)

Measured on 2,818 same-day consecutive gaps across 2,930 K5 verdicted frames:

- The gap distribution is **three-tier in log space**: burst (<2s, one look —
  66% of gaps sub-second, heavy EXIF second-quantization and pervasive 4-frame
  quad-captures), repositioning (2–30s, same vantage sweep), activity (>300s),
  with a deep density valley at 50–300s.
- **v0 defaults**: `burst_gap_seconds: 2`, `activity_gap_seconds: 300`
  (low-sensitivity — 253→205 activities across a 5× threshold range),
  `gps_radius_m: 50` null-tolerant (shop-day jitter is 8–62m; the 22km
  transport day is the failure class GPS splitting fixes),
  `scene_smoothing: burst_majority`.
- **Compression pipeline**: 2,930 frames → 893 bursts → 241 activities → 112
  days. Effective witness count ≈ bursts, a **3.3× deflation** of naive
  per-frame counting — the W1 √N rule operates on bursts.
- 2024-10-03 case study: thresholds reproduce the known structure EXACTLY
  (2 activities: engine close-ups 23:41–23:46, walkaround 23:58), zero spurious
  splits.
- **Free calibration signal discovered**: intra-burst scene_type disagreement
  (same 0.85s physical look labeled shop_context AND undercarriage) = a
  per-scene verdict-noise floor measurable WITHOUT any adjudication.
- Existing infra: `photo_work_clusters` live but stale (K5 coverage ends
  2024-05); **`image_observations.cluster_id` exists and is dead (0/20,711)** —
  the natural landing column for burst/activity ids. No burst table exists.

## Lab 3 — W3 technician/org scorecard v0

**A technician W3 is computable from existing substrate.** Skylar: 805
documented days across 111 vehicles; 69.6% of K5 verdict-days show tools in
frame (1,281 mentions, 371 free-text strings); 67% of K5 work days have a
receipt within ±1 day; v0 formula (0.30·doc_density + 0.25·tool_doc +
0.25·process_doc + 0.20·corroboration) ≈ **0.79** — an unusually strong
process-documentation signature.

**The org side is structurally starved, not behaviorally weak.** Ernie's ≈ 0.25
— but that number measures PLATFORM GAPS, not shop quality (never surface it):
- no `organization_id` on `equipment_usage_evidence` / `technician_work_evidence`
- `technician_id` NULL on all 30 equipment rows — evidence accrues to user
  accounts and vehicles, never to technician entities
- both evidence tables are one-shot 2026-06-17 backfills; accrual is frozen
- `human_validated = 0` on all 12,332 K5 component rows — the owner-confirm
  stream never lands in the columns built for it
- tools are free text (371 strings incl. "two-post lift"/"2-post lift") — no
  taxonomy
- no re-sighting linkage (outcome-quality-over-time — the half-life-aware W3
  term — has NO substrate; must be designed, not backfilled)
- `analysis_adjudications` (weight-model §4) doesn't exist; today's real
  adjudications live in markdown

## Lab 4 — Name-premium handoff pilot: **premium_measurable**

Method: `vehicles.search_vector` (GIN) as the mention prefilter (raw ILIKE over
83,700 sold descriptions times out), classification regex on the matched
subsets, strict built-by vs parts-mention tiers.

**The ladder is visible in the corpus** (medians, spec-controlled where n allows):

| Rung | Evidence |
|---|---|
| Anonymous restomod | Mustang restomod-proxy $101.5K; Coyote Bronco $138.5K; LS-K5 $74.5K (n=27) |
| Wearing the name's PARTS | Ringbrothers-parts cars $140.5K (n=14) |
| BUILT BY the name | Ringbrothers Mustang $192.5K (1.9× anon restomod); ICON LC 2.6×; ICON Bronco 1.7×; Velocity 1.17× |
| Name IS the make | Singer $1.04M (4.4× modified 964s, 12.5× stock) |

- **The K5's own ceiling reference: Ringbrothers '72 Blazers sold $250K/$300K
  vs $60.5K anonymous K5 median (n=217) and $74.5K anonymous LS-restomod K5s.**
- Velocity (volume builder) shows the weakest premium — converges toward parts
  bill; Singer (scarcity + waitlist) the strongest. Foose is UNMEASURABLE on
  BaT: his name is a parts brand (wheels on 80+ cars) — 50–100% false-positive
  rate for naive mention filters. Attribution needs a typed field
  (built_by / parts_by / style_of / designed_by).
- Confound quantified: vs raw platform medians premiums read 2.7–12.5×; vs
  spec-comparable anonymous restomods they compress to 1.17–4.4×. **Most of the
  naive premium is build content; the residual is the name.** The handoff
  detector must always use the spec-controlled comparison.

## Synthesis — the acquisition doctrine (answering "how do we count every grain of bondo?")

**You don't API into a technician's tool chest. You observe their exhaust.**
The proof is that Skylar's own W3 was computable tonight with zero new
instrumentation: camera roll (capture relay) + Gmail receipts + Zelle SMS +
GPS already carry the daily grind. The camera IS the tool-inventory API — 27%
of verdicts carry visible tools; the consumables cascade counts the bondo and
oil AS PRESENT-IN-FRAME (never a fabricated quantity). Generalization: every
technician and org gets W3 the way Skylar does — point the same ingestion
organs at their exhaust streams. Raw → high value in six steps:

1. **Exhaust capture** (passive: photos, receipts, payments, GPS — no behavior
   change demanded at entry)
2. **Atomization** (verdicts, cascade arms, micro-atoms)
3. **Weighting** (W1–W4, calibrated by the adjudication stream)
4. **Composition** (bursts → activities → objects → operations → days →
   entities → the field)
5. **Worth surfaces** (W3 scorecards, ladder position, documented floor)
6. **Incentive** (Lab 4's measured ladder IS the pitch: documentation moves a
   shop from $74.5K-anonymous toward $250K-named; capture requests tell them
   exactly what to shoot next). Step 6 feeds step 1: the reactor produces the
   fuel (provable worth) that attracts its own raw material.

## The reactor operations model (answering "multiple departments, reach in without derailing")

- **Two lanes, one engine**: the production lane (crons, fleet coordinator,
  config-A) never stops; the theory lane runs the same corpus under config-B
  via the tuning registry — experiments are config rows, not code edits, so
  test-driving heavy cannot derail analysis.
- **The instrument panel** (the reactor "knowing its limits"): standing gauges,
  one per department, computed continuously —
  GEOMETRY: bbox trust (today ≈ 0 — teacher-pass unwired);
  SEMANTICS: intra-burst disagreement noise floor (free, no adjudication needed);
  ACCOUNTING: phantom-PN rate (today 0/12);
  ENTITIES: evidence-accrual liveness (today frozen at 2026-06-17);
  FIELD: pin count / coordinate coverage (today 5 pins).
- A department = a gauge + an issues lane + a re-emission mode. Repair = config
  diff or targeted re-emission, scored on the gauge — never blind prompt surgery.

## Priority order the evidence dictates

1. `analysis_adjudications` + land `human_validated` (the calibration stream —
   everything else tunes against it)
2. bbox teacher-pass (unblocks projection; GEOMETRY gauge off zero)
3. burst/activity ids into `image_observations.cluster_id` (dead column, live
   thresholds measured; makes W1 √N real and the noise floor continuous)
4. org_id + technician_id on the evidence tables + perpetual accrual (unfreezes
   W3; the org side is schema-starved, not data-starved)
5. typed builder attribution (built_by/parts_by/…) — makes the handoff detector
   honest at corpus scale
