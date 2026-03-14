# The Condition Spectrometer

Complete reference for the vehicle condition observation and scoring system.

---

## What It Is

A spectral vehicle condition scoring system that replaces binary damage flags with a continuous 0-100 scale built from layered observations. Condition is not a binary — it's a spectrum. Damage is an adjective (describes state), not an event to detect.

The system has **duality**: structured taxonomy (arboreal) for known descriptors + natural expansion (rhizomatic) for new observations that don't fit existing categories.

```
         Multipass Observation Pipeline
         ══════════════════════════════

  ┌──────────────────────────────────────────────┐
  │ Pass 0: 5W Context (free metadata)           │
  │   who, what, where, when, which              │
  │   Zero inference cost — pure DB lookups       │
  └────────────────────┬─────────────────────────┘
                       ▼
  ┌──────────────────────────────────────────────┐
  │ Pass 1: Broad Vision (YONO v1/v2)            │
  │   zone, condition_score (1-5), damage_flags,  │
  │   modification_flags, fabrication_stage        │
  │   → mapped to taxonomy via condition_aliases   │
  └────────────────────┬─────────────────────────┘
                       ▼
  ┌──────────────────────────────────────────────┐
  │ Pass 2: Contextual Vision (Y/M/M loaded)     │
  │   Loads knowledge profile for this vehicle    │
  │   type → generates rarity signals,            │
  │   unexpected conditions, coverage gaps         │
  └────────────────────┬─────────────────────────┘
                       ▼
  ┌──────────────────────────────────────────────┐
  │ Pass 3: Sequence Cross-Reference             │
  │   Photo order analysis: zone balance,         │
  │   multi-angle confirmation, systematic vs     │
  │   random, coverage completeness               │
  └────────────────────┬─────────────────────────┘
                       ▼
  ┌──────────────────────────────────────────────┐
  │ Score Aggregation: 0-100                      │
  │   exterior(30) + interior(20) + mechanical(20)│
  │   + provenance(15) + structural(15) = 100     │
  │   → tier, percentile, rarity                  │
  └──────────────────────────────────────────────┘
```

---

## Database Tables

### `condition_taxonomy`

The expandable tree of condition descriptors. Follows the `angle_taxonomy` versioned pattern.

| Column | Type | Description |
|--------|------|-------------|
| `descriptor_id` | UUID PK | |
| `canonical_key` | TEXT UNIQUE | Dot-notation path: `exterior.paint.oxidation` |
| `domain` | TEXT | `exterior` \| `interior` \| `mechanical` \| `structural` \| `provenance` |
| `descriptor_type` | TEXT | `adjective` (oxidized, pristine) \| `mechanism` (water_ingress) \| `state` (original, replaced) |
| `display_label` | TEXT | Human-readable: "Paint Oxidation" |
| `lifecycle_affinity` | TEXT[] | Which lifecycle states this descriptor associates with |
| `severity_scale` | TEXT | `binary` \| `low_med_high` \| `0_to_1` \| null |
| `taxonomy_version` | TEXT | `v1_2026_03`, `v_auto_20260308_2249`, etc. |
| `deprecated_at` | TIMESTAMPTZ | Null if active. Set when replaced. |
| `replaced_by_descriptor_id` | UUID FK | Points to successor descriptor |

**Current size: 69 descriptors** across 5 domains:
- `exterior` (33): paint, metal, chrome, body, glass, trim, surface, wheels, accessories, bed, undercarriage, assessed
- `mechanical` (13): engine, exhaust, suspension, brakes, steering, transmission
- `interior` (10): upholstery, dashboard, headliner, carpet, comfort, electronics
- `structural` (8): collision, component, safety, frame, fire, flood, body
- `provenance` (5): documentation, ownership

### `condition_aliases`

Maps legacy flag names and model outputs to canonical taxonomy keys.

| Column | Type | Description |
|--------|------|-------------|
| `alias_key` | TEXT PK | Source name: `rust`, `lift_kit`, etc. |
| `descriptor_id` | UUID FK | → `condition_taxonomy` |
| `taxonomy_version` | TEXT | When this alias was created |

**Current size: 45 aliases** mapping the 7 damage flags + 8 mod flags + 30 auto-grown entries.

### `image_condition_observations`

Append-only, multipass observations per image. The core data store.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | |
| `image_id` | UUID FK | → `vehicle_images` |
| `vehicle_id` | UUID FK | → `vehicles` |
| `descriptor_id` | UUID FK | → `condition_taxonomy` |
| `severity` | NUMERIC | 0.0–1.0 (null = binary/present) |
| `lifecycle_state` | TEXT | `fresh` \| `worn` \| `weathered` \| `restored` \| `palimpsest` \| `ghost` \| `archaeological` |
| `zone` | TEXT | From vehicle zone taxonomy (41 zones) |
| `region_detail` | TEXT | Finer than zone: `rocker_panel_lower`, `cowl_seam` |
| `surface_coord_u` | NUMERIC | Inches, when available (L2+) |
| `surface_coord_v` | NUMERIC | |
| `pass_number` | SMALLINT | 1=broad, 2=contextual, 3=sequence |
| `confidence` | NUMERIC | 0–1 |
| `source` | TEXT | `yono_v1` \| `yono_v2` \| `contextual_v1` \| `sequence_inference` \| `human` |
| `source_version` | TEXT | |
| `evidence` | JSONB | Raw model outputs, supporting data |
| `context_ymm_key` | TEXT | Y/M/M knowledge used (null if pass 1) |
| `context_sequence_position` | INT | Photo N of M |
| `observed_at` | TIMESTAMPTZ | |

**Indexes:** `image_id`, `vehicle_id`, `descriptor_id`, `zone`, `lifecycle_state`

### `vehicle_condition_scores`

Computed 0-100 score per vehicle. One row per vehicle (upserted on recompute).

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | |
| `vehicle_id` | UUID FK UNIQUE | → `vehicles` |
| `condition_score` | NUMERIC | 0–100 |
| `condition_tier` | TEXT | `concours` \| `excellent` \| `good` \| `driver` \| `project` \| `parts` |
| `percentile_within_ymm` | NUMERIC | 0–100 (null if <10 in group) |
| `percentile_global` | NUMERIC | 0–100 |
| `ymm_key` | TEXT | `1969_Chevrolet_Camaro` |
| `ymm_group_size` | INT | |
| `ymm_mean_score` | NUMERIC | |
| `ymm_std_dev` | NUMERIC | |
| `exterior_score` | NUMERIC | 0–30 |
| `interior_score` | NUMERIC | 0–20 |
| `mechanical_score` | NUMERIC | 0–20 |
| `provenance_score` | NUMERIC | 0–15 |
| `presentation_score` | NUMERIC | 0–15 (structural domain) |
| `lifecycle_state` | TEXT | Dominant lifecycle from observations |
| `descriptor_summary` | JSONB | `{key: {count, avg_severity, zones[]}}` |
| `condition_rarity` | NUMERIC | 0–1: how unusual this condition is for Y/M/M |
| `observation_count` | INT | |
| `zone_coverage` | NUMERIC | 0–1: fraction of zones with observations |
| `computed_at` | TIMESTAMPTZ | |
| `computation_version` | TEXT | `v1` |

### `condition_distributions`

Per-Y/M/M-group statistics. Recomputed after batch scoring.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | |
| `ymm_key` | TEXT | Null = global |
| `group_type` | TEXT | `ymm` \| `make` \| `decade` \| `global` |
| `group_size` | INT | |
| `mean_score` | NUMERIC | |
| `median_score` | NUMERIC | |
| `std_dev` | NUMERIC | |
| `percentile_10` through `percentile_90` | NUMERIC | |
| `skewness` | NUMERIC | Positive = more low-condition, negative = more high-condition |
| `lifecycle_distribution` | JSONB | `{"fresh": 0.15, "worn": 0.35, ...}` |
| `top_descriptors` | JSONB | `[{key, prevalence}]` |
| `computed_at` | TIMESTAMPTZ | |

---

## Condition Tiers

| Score | Tier | Description |
|-------|------|-------------|
| 90–100 | **CONCOURS** | Show-quality, investment grade, fully documented |
| 80–89 | **EXCELLENT** | Well-preserved or professionally restored, minor wear |
| 65–79 | **GOOD** | Solid driver with documented history, moderate wear |
| 45–64 | **DRIVER** | Regular use vehicle, functional but shows age |
| 25–44 | **PROJECT** | Needs significant work, structural concerns |
| 0–24 | **PARTS** | Severe deterioration, value in components |

## Lifecycle States

From the reference catalog's degradation model (323 curated assets):

| State | Description |
|-------|-------------|
| `fresh` | New or freshly restored, no visible wear |
| `worn` | Normal use patina, functional wear |
| `weathered` | Environmental exposure, fading, surface oxidation |
| `restored` | Evidence of restoration work (in progress or complete) |
| `palimpsest` | Multiple layers of history visible (old repairs, repaints over original) |
| `ghost` | Significant deterioration, original form still recognizable |
| `archaeological` | Severe decay, value in provenance/rarity not condition |

---

## Scoring Rubric

The 100-point scale maps to 5 domains:

| Domain | Max Points | What Counts |
|--------|-----------|-------------|
| **Exterior** | 30 | Paint, metal, chrome, body panels, glass, trim, wheels |
| **Interior** | 20 | Upholstery, dashboard, headliner, carpet, electronics |
| **Mechanical** | 20 | Engine, transmission, exhaust, suspension, brakes, steering |
| **Provenance** | 15 | Documentation, ownership history, matching numbers, build sheets |
| **Structural** | 15 | Frame, collision evidence, body integrity, safety equipment |

**How observations affect scores:**
- **Adjectives** (oxidized, cracked, faded) → penalty proportional to severity. Each observation reduces the domain score by up to `max_points / 10`
- **Positive states** (original, matching_numbers, continuous_ownership) → bonus of 5% of max per observation, capped at 10%
- **Negative states** (non_original, aftermarket, replaced, absent) → 3% penalty per observation
- **Mechanisms** (water_ingress, electrolysis) → lighter penalty: `severity * max_points / 15`
- **No data for a domain** → neutral 50% of max points

**Rarity formula:**
```
rarity = 1 - CDF(vehicle_score, ymm_distribution)

Example:
  Porsche 911 group: mean=88, std=8
  → A 911 scoring 45 → rarity = 0.9999 (extremely unusual for a 911)
  → A 911 scoring 92 → rarity = 0.30 (common for 911s)

  Chevy K10 group: mean=55, std=15
  → A K10 scoring 92 → rarity = 0.007 (almost unheard of for a K10)
```

---

## Functions Reference

### `condition_spectrometer.py`

#### Connection
| Function | Signature | Description |
|----------|-----------|-------------|
| `get_connection()` | `→ psycopg2.connection` | Reads `SUPABASE_DB_PASSWORD` from env or `.env` file |

#### Pass 0: 5W Context
| Function | Signature | Description |
|----------|-----------|-------------|
| `get_5w_context(conn, image_id, vehicle_id)` | `→ dict` | Returns `{who, what, where, when, which, sequence_neighbors}` — zero inference cost |

#### Pass 1: Observation Bridge
| Function | Signature | Description |
|----------|-----------|-------------|
| `bridge_yono_output(conn, image_id, vehicle_id, yono_result, source, source_version)` | `→ int` | Maps YONO output (flags) → taxonomy observations. Returns count written. Also writes baseline observation if no flags but condition_score exists. |
| `bridge_vehicle_images(conn, vehicle_id=None, limit=1000)` | `→ dict` | Batch bridge for a vehicle or unprocessed images. Returns `{processed, observations_written, skipped}` |

#### Pass 2: Contextual Vision
| Function | Signature | Description |
|----------|-----------|-------------|
| `contextual_pass(conn, vehicle_id)` | `→ dict` | Loads Y/M/M profile, analyzes pass-1 observations in context. Returns signals: `rarity_signal`, `unexpected_condition`, `coverage_gap` |

#### Pass 3: Sequence Cross-Reference
| Function | Signature | Description |
|----------|-----------|-------------|
| `sequence_pass(conn, vehicle_id)` | `→ dict` | Analyzes photo sequences. Returns signals: `zone_imbalance`, `multi_angle_confirmation`, `sequence_pattern`, `coverage_completeness` |

#### Score Aggregation
| Function | Signature | Description |
|----------|-----------|-------------|
| `compute_condition_score(conn, vehicle_id)` | `→ Optional[dict]` | Aggregates all observations → 0-100 score. Returns full breakdown with per-domain scores. |
| `save_condition_score(conn, score_data)` | `→ None` | Upserts score with distribution-relative percentiles and rarity |
| `tier_from_score(score)` | `→ str` | Maps 0-100 → tier label |

#### Distribution
| Function | Signature | Description |
|----------|-----------|-------------|
| `get_ymm_distribution(conn, ymm_key)` | `→ Optional[dict]` | Cached distribution for a Y/M/M group |
| `get_global_distribution(conn)` | `→ Optional[dict]` | Cached global distribution |
| `compute_distribution(conn, ymm_key=None, group_type="ymm")` | `→ Optional[dict]` | Compute and save stats (mean, median, std, percentiles, skewness, lifecycle distribution) |
| `recompute_all_distributions(conn)` | `→ dict` | Batch recompute for all Y/M/M groups with >=3 scored vehicles + global |

#### Taxonomy Growth (Phase 5)
| Function | Signature | Description |
|----------|-----------|-------------|
| `discover_new_descriptors(conn, dry_run=False)` | `→ dict` | Scans for unmapped flags, creates new taxonomy nodes + aliases. Versioned, never deletes. |

---

## CLI Commands

All commands run from project root:
```bash
python3 -m yono.condition_spectrometer <command> [args]
```

| Command | Arguments | Description |
|---------|-----------|-------------|
| `pipeline` | `--vehicle-id UUID` | Full multipass: bridge → contextual → sequence → score → distribute |
| `context` | `--image-id UUID --vehicle-id UUID` | 5W metadata (zero cost) |
| `bridge` | `--vehicle-id UUID` | Bridge YONO flags → observations |
| `contextual` | `--vehicle-id UUID` | Y/M/M knowledge-informed signals |
| `sequence` | `--vehicle-id UUID` | Photo sequence analysis |
| `score` | `--vehicle-id UUID` | Compute 0-100 score |
| `score-all` | `--limit N` | Batch score all vehicles with observations |
| `distribute` | `--ymm KEY` or `--all` | Recompute distributions |
| `grow` | `[--dry-run]` | Auto-discover and create new taxonomy nodes |

---

## Server Endpoints

All on port 8472 (YONO sidecar):

| Method | Path | Request Body | Description |
|--------|------|-------------|-------------|
| POST | `/condition/context` | `{image_id, vehicle_id}` | 5W free metadata |
| POST | `/condition/bridge` | `{vehicle_id?, limit?}` | Bridge YONO → observations |
| POST | `/condition/contextual` | `{vehicle_id}` | Y/M/M knowledge signals |
| POST | `/condition/sequence` | `{vehicle_id}` | Photo sequence analysis |
| POST | `/condition/score` | `{vehicle_id}` | Compute + save 0-100 score |
| POST | `/condition/pipeline` | `{vehicle_id}` | Full multipass pipeline |
| POST | `/condition/distribute` | `{ymm_key?} or {all: true}` | Recompute distributions |

The `/analyze` endpoint also auto-writes observations when `image_id` and `vehicle_id` are provided in the request body.

---

## Y/M/M Knowledge (v2 Profiles)

`build_ymm_knowledge.py` builds profiles stored in `ymm_knowledge` table.

**v2 changes from v1:**
- Seller comments filtered out (`is_seller = false` on `auction_comments`)
- Model variants coalesced (1969 Camaro Z28 + SS + Convertible → base `1969_Chevrolet_Camaro` with `model_variants: ["Z28", "SS", "Convertible"]`)
- Regex mod extraction removed entirely (was 60-70% false positive)
- Added `lifecycle_distribution` from existing vision data
- Added `condition_distribution` from scored images

**Profile structure:**
```json
{
  "ymm_key": "1969_Chevrolet_Camaro",
  "year": 1969,
  "make": "Chevrolet",
  "model": "Camaro",
  "model_variants": ["Z28", "SS", "RS", "RS/SS", "Convertible", "Coupe"],
  "vehicle_count": 1899,
  "factory_specs": { ... },
  "market": { ... },
  "lifecycle_distribution": {
    "fresh": 0.12, "worn": 0.35, "weathered": 0.28,
    "restored": 0.15, "ghost": 0.08, "archaeological": 0.02
  },
  "condition_distribution": {
    "mean": 3.2, "median": 3.0, "std": 0.9, "scored_count": 450
  },
  "expert_quotes": [ ... ],
  "source_comment_count": 1200
}
```

**Variant coalescing rules:**
- Body suffixes stripped: Convertible, Coupe, Fastback, Hardtop, Pickup, Sedan, Wagon, Sport Coupe, Custom, Custom Coupe
- Trim suffixes stripped: Z28, Z/28, SS, RS, RS/SS, GT, Mach 1, Boss 302, Boss 429, LS6, COPO, Yenko, Shelby, Cobra, GT350, GT500, SC/360, R/T, Judge, Hemi, Six Pack, 4-Speed, 6-Speed

---

## Taxonomy Descriptor Catalog

### Seed Descriptors (v1_2026_03)

**Exterior — Damage Adjectives:**
- `exterior.metal.oxidation` — Rust / surface corrosion
- `exterior.body.deformation` — Dents, creases
- `exterior.surface.fracture` — Cracks in paint or body
- `exterior.paint.fading` — UV degradation, chalking
- `exterior.glass.fracture` — Broken/cracked glass
- `exterior.paint.delamination` — Clear coat peel, paint lifting
- `exterior.chrome.pitting` — Chrome deterioration
- `exterior.body.filler` — Bondo detection
- `exterior.surface.discoloration` — Staining, uneven color
- `exterior.surface.uv_degradation` — UV-specific damage
- `exterior.surface.water_damage` — Water staining

**Exterior — State:**
- `exterior.paint.original` — Factory paint present (provenance signal)
- `exterior.paint.respray` — Repainted (value impact)
- `exterior.chrome.replated` — Chrome redone
- `exterior.trim.original` — Original trim present
- `exterior.wheels.aftermarket` — Non-original wheels
- `exterior.body.aftermarket_panels` — Body kit, non-OEM panels

**Interior:**
- `interior.upholstery.patinated` — Wear that adds character (adjective)
- `interior.upholstery.replaced` — Non-original upholstery (state)
- `interior.dashboard.cracking` — Dash deterioration
- `interior.headliner.sagging` — Headliner separation
- `interior.carpet.staining` — Carpet damage
- `interior.upholstery.tear` — Tears in seats/trim

**Mechanical:**
- `mechanical.engine.non_original` — Engine swap (state)
- `mechanical.engine.matching_numbers` — VIN-matching engine (huge provenance signal)
- `mechanical.exhaust.modified` — Aftermarket exhaust
- `mechanical.suspension.modified` — Aftermarket suspension
- `mechanical.suspension.lifted` — Lifted (trucks)
- `mechanical.suspension.lowered` — Lowered
- `mechanical.engine.forced_induction` — Turbo/supercharger

**Structural:**
- `structural.collision.evidence` — Previous accident signs
- `structural.component.absent` — Missing parts
- `structural.safety.cage_installed` — Roll cage present
- `structural.frame.damage` — Frame issues
- `structural.fire.evidence` — Fire damage
- `structural.flood.evidence` — Flood damage

**Provenance:**
- `provenance.documentation.present` — Build sheets, window stickers
- `provenance.ownership.continuous` — Documented chain of custody
- `provenance.documentation.build_sheet` — Factory build sheet exists
- `provenance.documentation.window_sticker` — Monroney sticker exists
- `provenance.documentation.service_records` — Maintenance documented

### Auto-Grown Descriptors (v_auto_*)

Created by `discover_new_descriptors()` from unmapped flags:

- `exterior.metal.surface_oxidation`, `exterior.metal.perforation`
- `exterior.paint.blistering`
- `exterior.body.hail_damage`
- `exterior.trim.absent`
- `exterior.accessories.light_bar`, `exterior.accessories.winch`, `exterior.accessories.tonneau_cover`
- `exterior.bed.liner`
- `interior.comfort.ac_added`
- `interior.electronics.stereo_aftermarket`, `interior.electronics.gauges_aftermarket`
- `mechanical.engine.camshaft_modified`, `mechanical.engine.intake_modified`
- `mechanical.exhaust.headers_aftermarket`
- `mechanical.brakes.disc_conversion`
- `mechanical.steering.power_added`
- `mechanical.transmission.overdrive_added`
- `structural.fire.evidence`, `structural.flood.evidence`, `structural.frame.damage`

---

## How Taxonomy Grows

When `discover_new_descriptors()` runs:

1. Scans known flag enums and existing observation evidence for unmapped keys
2. For each unmapped flag:
   - Checks against hardcoded mapping rules (e.g., `turbo` → `mechanical.engine.forced_induction`)
   - Falls back to auto-generated path: `exterior.detected.{flag}` or `mechanical.detected.{flag}`
3. Creates new `condition_taxonomy` row with versioned `taxonomy_version`
4. Creates `condition_aliases` entry linking the flag name to the new descriptor
5. All future observations using that flag automatically map to the new taxonomy node

**No code changes required.** The taxonomy is data, not code. New nodes are immediately usable.

---

## Files

| File | Lines | Purpose |
|------|-------|---------|
| `yono/condition_spectrometer.py` | ~1,600 | Core module: all functions, CLI, pipeline |
| `yono/contextual_training/build_ymm_knowledge.py` | ~450 | Y/M/M profile builder (v2) |
| `yono/server.py` | ~1,200 | FastAPI server with 7 `/condition/*` endpoints |
| `yono/CONDITION_SPECTROMETER.md` | This file | Complete reference |

---

## Design Principles

1. **Observations, not flags.** Binary damage_flags can't represent "slightly oxidized rocker panel" vs "perforated floor pan." Severity 0-1 with taxonomy placement does.

2. **Append-only observations.** Never update or delete observations. Each pass adds to the stack. The score is always recomputable from the observation history.

3. **Distribution IS knowledge.** The system doesn't hardcode what "good" means for a 1969 Camaro. It discovers it from scoring enough Camaros. Rarity emerges from the distribution shape.

4. **Multipass refinement.** Pass 1 (broad) gives coarse signal. Pass 2 (contextual) says "this is unusual for this type." Pass 3 (sequence) says "the photographer avoided the passenger side." Each pass is optional and additive.

5. **Taxonomy grows by observation.** When a new condition is encountered (e.g., "cowl seam water ingress"), it becomes a new node. The tree is versioned, never pruned.

6. **Y/M/M knowledge as context, not rules.** The profile tells you what's typical. The spectrometer tells you what's observed. The score comes from comparing the two.
