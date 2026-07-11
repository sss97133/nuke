# Sighting Ledger — deliberate schema-growth proposal (byok v4)

> **Status: PROPOSAL** (2026-07-11, from the K5 2024-10-03 closure-pass session).
> Per the living-schema rule: growth is a versioned, deliberate addition — never
> silent per-image keys. This doc is the proposal; the implementation step is one
> `SCHEMA_VERSIONS` append in `scripts/deep-image-analysis-byok.mjs` plus a briefing
> extension. Nothing here is deployed yet.

## The owner's articulation (verbatim intent, 2026-07-11)

> "We aren't just looking at images blind. We are looking at them as if I'm being
> deposed and answering in absolute detail. Things that already are said don't have
> to be restated but rather marked observed, present and what part of them is
> visible in an x,y,z way. … An auditor is balancing the visible and building a
> story line and revising it with every new determination."

## The method, named

**A sighting ledger over persistent objects.** Established names it unifies:

- **Tracking / re-identification** (object permanence): a component seen in frame N
  is *the same object* as in frame N−1 — a track continuation, not a new discovery.
- **Perpetual inventory + cycle counts** (audit): every photo is an unplanned cycle
  count of whichever assets are in view. The ledger is always live; each frame
  reconciles it.
- **Telemetry / state estimation**: the build is a state vector; each photo is a
  sensor sample; the narrative is the running estimate, revised Bayesianly with
  every determination. Prior verdicts are PRIORS, never observations.
- **Deposition standard** (evidence): every sighting must be sayable under oath —
  observed, present, this face of it, from this vantage.

## The motivating failure (live, this session)

On K5 day 2024-10-03, old verdicts called foil-faced foam INSULATION BOARDS
"galvanized body panels." That prose entered a research dossier as fact, and a
closure pass echoed it (with a phantom association to the 2021 LMC rocker receipt).
Separately, a red/tan 1985-88 GM squarebody in the background was closed as "the
K5's own maroon body" at 0.7 confidence — falsified at zoom by stacked-quad
headlights + two-tone paint. Both are the same failure class: **free-text
re-description lets prose inherit as evidence.** A sighting ledger makes both
structurally hard: a sighting must BIND to an object, and an 8-foot foil sheet
cannot bind to a rocker panel — dimension mismatch forces a new-object entry
instead of inherited prose. (Cost ledger was untouched — no PN rode on either false
claim — but the narrative substrate was corrupted until pixel-audited.)

## What exists already (do not mint)

| Organ | Today | Sighting-ledger role |
|---|---|---|
| `receipt_items` (PN-bearing) | the CLAIM side | object ledger seed: bought-objects |
| `component_identifications` (11,835 K5 rows) | per-frame, per-mention, no identity chain | ALREADY the sightings table — missing only `object_ref` |
| `ai_scan_metadata.byok_deep_analysis.components_seen[]` | free-text label + bbox + PN guess | becomes sighting entries (ref or new-object) |
| `camera_pose` (structured) + TWVP bbox 0-999 | per-frame geometry | the "from where" of each sighting |
| `SCHEMA_VERSIONS` extraction ledger | delta re-opening mechanism | v4 append re-opens only for the new keys |
| supersession chain | verdict revision | the auditor's "revising with every new determination" |
| context briefing (`deep-image-analysis-byok.mjs context`) | roster + timeline + places + garage | gains the OBJECT LEDGER section |

## Proposed v4 delta (the new fact-keys)

Append to `SCHEMA_VERSIONS`:

```js
{ version: 'byok_v4_sighting_ledger_<date>',
  facts: ['sightings'] }
```

Each `components_seen[]` entry grows (superset of v3; v3 fields unchanged):

```json
{
  "label": "…",                      // v3 (kept for new/unresolved objects)
  "bbox": [x1,y1,x2,y2],             // v3
  "confidence": 0.0-1.0,             // v3
  "part_number_guess": "…|null",     // v3
  "object_ref": "roster:<receipt_item_id> | object:<slug> | null",
  "sighting_status": "first_observed | re_observed | expected_but_absent | state_changed",
  "aspect_visible": { "faces": ["top","driver_side","front"...],
                       "fraction": 0.0-1.0 },
  "occluded_by": ["object_ref | label", ...],
  "state_delta": "string|null"        // e.g. "chain removed since 23:42 frame"
}
```

Rules:
- `re_observed` entries need NO re-description — the briefing's object ledger holds
  the canon; the sighting carries only geometry + state. ("Things already said are
  marked observed, present.")
- A sighting with no plausible `object_ref` MUST open a new object (honest
  discovery) — binding failure is the tripwire against prose inheritance.
- `expected_but_absent` is first-class: the roster says installed-here, the aspect
  is visible, the object is not there → that is testimony too (audit exception).
- Occlusion honesty carries over: never a sighting of what 3D hides.

## Briefing extension

`context` gains **THE OBJECT LEDGER** section: established objects (roster +
previously first-observed), each with canonical one-line description, last-known
state, last-sighting date. Directive: re-sightings reference; only genuinely new
objects get described.

## What it buys the accounting engine (the point)

- **Parts**: receipt → object → first-sighted-installed date → re-sightings =
  perpetual inventory proof ("bought AND seen AND still present"), cost attached
  once per object, not per caption. `component_identifications.status`
  (confirmed/day_context/inferred) becomes a property of the OBJECT's best
  evidence, monotonically improvable.
- **Labor**: state deltas between sightings of the same object bound work windows
  (chain-on 23:42 → freestanding 23:58 = engine-set completed in-session) — labor
  becomes the derivative of the object-state time series: finite, provable,
  owner-signed before any value accrues ($410 rule unchanged).
- **Token economics**: re-sightings are cheap (no re-description), and the v4 delta
  re-opens old frames only for sighting fields — the convergent-series property of
  the extraction ledger is preserved.

## Implementation order (when ratified)

1. `SCHEMA_VERSIONS` v4 append + validator additions (accept superset; v3 verdicts
   remain valid).
2. `context` object-ledger section (source: receipt roster + prior
   component_identifications grouped by resolved object).
3. Object identity: add `object_ref` resolution in the entity-landing path
   (`landEntityPage`) — chain sightings of one object across frames
   (component-level entity resolution, threshold + never-force, mirroring
   vehicle-level ER).
4. Backfill is the ledger's own delta mechanism — no bespoke migration.

## Prior art & positioning — "Mitchell 2.0" (owner framing, 2026-07-11)

> "There's systems in the world like the Mitchell manual and things we are trying
> to be the 2.0 version where we can be 90% accurate."

Mitchell1/ProDemand (and ALLDATA, MOTOR) are **flat-rate labor guides**: per
operation, per vehicle, a PRESCRIBED book time — an actuarial average that shops
and insurers bill against without ever proving the hours occurred on the specific
job. The sighting ledger inverts the epistemics:

| | Mitchell 1.0 | Nuke (this proposal) |
|---|---|---|
| Labor number | prescribed book time | OBSERVED time, derived from sighting state-deltas |
| Evidence | none per-job | per-frame telemetry, deposition-grade, owner-signed |
| Parts | catalog diagram | receipt+sighting reconciliation (bought AND seen installed) |
| Accuracy claim | precise fiction | ~90% accurate actuals, confidence-scored |

What Mitchell contributes to us: the **operation taxonomy** — the billing-grade
middle layer between sightings (too granular) and days (too coarse). Pipeline:
**sightings → object state-deltas → operations (Mitchell-style coded) → observed
hours vs book hours**. The book time becomes the PRIOR; observed time is the
evidence; the delta is itself product (the same claimed-vs-inferred triangulation
the worth-proof engine runs on prices). `work_items` in the day synthesis is where
operation codes land (task/component/frame_span already exist there).

## The organism metrics (owner steer 2026-07-11: "frames are not the goal metric")

The system-level scorecard — computed on the WHOLE build, never per-frame. First
measured values (K5, 2026-07-11):

1. **Roster reconciliation** — of PN-bearing receipt items (claims), fraction with
   ≥1 pixel sighting. By count: 45/92 = 48.9%. **By dollars: $2,011/$2,760 =
   72.9%** (cost-weighted is the accounting-grade number).
2. **Unreconciled classification** — every unsighted object must carry a state:
   awaiting_install (body parts during paint arc) / installed_occluded (engine
   mount, rotor behind wheel) / consumable_becomes_state (paint qt) / genuinely
   missing. Only the last counts against the build.
3. **Labor ledger** — documented days (106), machine-documented minutes (463),
   owner-signed minutes (0 → $0 claimable). Signed/documented ratio is the
   provable-labor coverage.
4. **Consistency load** — revision rate (100/3,089 = 3.2%) + open attribution
   doubts (3). Contradiction is measured, never hidden.
5. **Calibration** — owner/auditor adjudications vs stated confidence. First data
   points (2026-07-11): 2 prose-anchored claims failed at 0.7–0.75; 0
   paper-anchored claims failed. Learned weight: paper-anchored ≫ prose-anchored;
   scene-interpretation confidence must be capped below citation-backed confidence.
   Adjudications feed this loop; weights are revised, not asserted.

Known measurement artifact: PN-string joins undercount (the LS3 intake — the most
photographed object on the build — reads "unsighted" because 300-129/300-131/rail
PNs don't string-match). Object-level identity (`object_ref`) is the fix; expect
reconciliation to jump on adoption.

## Open questions for the owner

- Object granularity: is "the four powder-coated wheels" one object or four?
  (Audit answer: four, with a set-membership; but confirm.)
- Where discovered non-vehicle objects live (shop consumables/materials like the
  insulation boards): same ledger with `domain: shop`, or excluded from vehicle
  cost entirely? (Proposal: recorded, domain-tagged, never in vehicle cost.)
