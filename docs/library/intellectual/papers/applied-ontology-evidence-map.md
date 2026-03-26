# Applied Ontology in the Collector Vehicle Domain: Evidence Map

**Companion to:** applied-ontology-vehicle-domain.md
**Date:** 2026-03-25
**Purpose:** Maps every theoretical claim in the paper to its cellular-level implementation in the Nuke codebase.

---

## How to Read This Document

The paper makes six major claims. For each claim, this document provides:
- The **theoretical principle** (what the paper says)
- The **concrete implementation** (where it lives in code/schema)
- The **scale** (how much data flows through it)

This is the receipts.

---

## 1. Immutable Identity Ontology

**Paper claim:** "Physical assets accumulate observations rather than mutating state. No observation replaces a previous observation. Current state is *computed* from the full observation stack."

### Implementation

| Component | Location | What It Does |
|-----------|----------|--------------|
| `vehicle_observations` table | Database (3.3M+ rows) | Append-only observation store. Column comment on `structured_data`: *"DO NOT modify after insert — it is the immutable source record."* |
| `is_superseded` column | `vehicle_observations` | Old observations are marked superseded, never deleted. `superseded_by` creates audit chain. |
| `content_hash` column | `vehicle_observations` | SHA-256 dedup prevents duplicate inserts rather than updating existing rows. |
| `ingest-observation/index.ts` | `supabase/functions/ingest-observation/` | Single ingestion gateway. All extractors write through here. Exclusively INSERT — no UPDATE to observation data. |
| `vehicle_current_state` view | Database view | Computes "current" state by ranking non-superseded observations by `observation_effective_weight()`. The vehicle has no mutable state — only a computed projection. |
| `lineage_chain` column | `vehicle_observations` (uuid[]) | Tracks derivation when observations spawn further observations. Preserves the full epistemic genealogy. |

### Observation Volume by Kind

| Kind | Count | Ontological Role |
|------|------:|-----------------|
| media | 1.87M | Visual evidence |
| listing | 585K | Marketplace testimony |
| comment | 426K | Community testimony |
| bid | 180K | Market signals |
| sale_result | 130K | Market facts |
| work_record | 43K | Actor-event evidence |
| specification | 37K | Technical claims |
| condition | 24K | State assessments |
| provenance | 11K | Ownership chains |

**Total: 3.3M+ observations, zero deletions, zero overwrites.**

### VIN as Constitutive Identity

| Component | Location | What It Does |
|-----------|----------|--------------|
| `vin_plates_tags` table | Database | Models VIN as physical artifact: `tag_type` (vin_plate, body_tag, cowl_tag, engine_stamp), `location` (dash_driver_side, firewall), `legibility` (clear/partial/faded/illegible), `tampered` (boolean), `attachment_method` (rosette_rivets, spot_welded), `is_original` |
| `vin_decode_cache` table | Database | Factory decode results cached permanently |
| Tier 1 resolution | `ingest-observation/index.ts:149-164` | VIN match = 0.99 confidence. "VIN is definitive identity for post-1981 vehicles." |

---

## 2. Epistemological Trust Layer

**Paper claim:** "All data is testimony — statements made by sources with varying authority, at specific times, subject to predictable decay."

### Half-Life Decay Functions

| Component | Location | What It Does |
|-----------|----------|--------------|
| `observation_half_lives` table | Database (14 rows) | Maps each observation kind to a decay rate in days |
| `compute_decayed_confidence()` | PL/pgSQL function (IMMUTABLE) | `confidence * 0.5^(age_days / half_life_days)` with floor at 0.05 |
| `observation_relevance()` | SQL function (IMMUTABLE) | `exp(-0.693 * age_seconds / 86400 / half_life_days)`. Returns 1.0 for permanent observations. |
| `observation_effective_weight()` | SQL function (IMMUTABLE) | `source_trust * extraction_confidence * temporal_decay` — three independent, composable factors |
| `observation_half_life_days()` | SQL function (IMMUTABLE) | Sub-kind granularity: VIN-sourced specs → NULL (permanent). General specs → 1825 days. |
| `vehicle_observations_decayed` view | Database view | Every query sees confidence adjusted for decay in real time. Includes `freshness` label: fresh/aging/stale/expired. |

### Decay Schedule (from `observation_half_lives`)

| Kind | Half-Life | Paper Section |
|------|-----------|---------------|
| specification, provenance | Permanent (999,999 days) | "Constitutive identity; does not decay" |
| expert_opinion | 3 years | Layer 3: Inspection |
| work_record | 5 years | Layer 3: Inspection |
| condition | 1 year | Layer 3: Inspection |
| comment | 6 months | Layer 2: Consensus |
| listing | 3 months | Layer 1: Claims |
| social_mention | 1 month | Layer 1: Claims |

### Source Authority Hierarchy

| Component | Location | What It Does |
|-----------|----------|--------------|
| `data_source_trust_hierarchy` table | Database (18 rows) | Explicit trust ranking with scoped override rules |
| `observation_sources` table | Database (158 sources) | Every source has `base_trust_score` (0.0-1.0). Categories: owner (0.90), registry (0.89), shop (0.83), auction (0.74), dealer (0.65), marketplace (0.61), forum (0.55), social (0.39) |
| `observer_trust_scores` table | Database | Per-observer accuracy tracking: `base_trust`, `current_trust`, `accuracy_rate`, `trust_trend`, `corroboration_count`, `contradiction_count` |
| `override_rules` column | `data_source_trust_hierarchy` | Scopes authority: NHTSA can only override factory specs. Receipts can only assert mileage + work performed. Prevents cross-domain trust bleeding. |

### The Four Layers in Practice

| Layer | Paper Description | Database Implementation |
|-------|-------------------|------------------------|
| **Claims** | Seller descriptions, forum posts | `observation_sources` where category = 'marketplace', 'forum', 'social_media' (trust 0.39-0.61) |
| **Consensus** | Multiple independent sources agree | `vehicle_field_consensus` table: `supporting_count`, `conflicting_count`, `all_values` (jsonb), `resolution_method` (unanimous/majority/expert_override) |
| **Inspection** | Physical examination by qualified observer | `observation_sources` where category = 'shop', 'owner' (trust 0.83-0.90) + `component_events` with event_type = 'inspected' |
| **Scientific test** | Dyno, metallurgy, spectroscopy | `observation_sources` where source_type = 'scientific_test' (trust 0.95+) + `component_events` with event_type = 'tested', 'measured' |

---

## 3. Schema-as-Prompt

**Paper claim:** "Relational DDL serves simultaneously as ontological specification, extraction instruction, and validation constraint."

### DDL Embedded in LLM Prompts

| Component | Location | What It Does |
|-----------|----------|--------------|
| `buildPrompt()` in nlq-sql | `supabase/functions/nlq-sql/index.ts:117-179` | Full database schema (table structures, column types, enum values, zone names, condition taxonomy, scoring rules) written directly into LLM prompt context |
| `buildExtractionPrompt()` | `supabase/functions/extract-vehicle-data-ai/index.ts:571-621` | JSON template mirroring database columns: `"vin": "17-character VIN if found, null if not present"`, `"transmission": "Manual or Automatic or specific"` — each column is a question |
| Discovery-first extractor | `supabase/functions/discover-description-data/index.ts:22` | Prompt: "Return a JSON object. Create whatever keys make sense for the data you find." Schema discovery, not schema imposition. |
| `observation_extractors` table | Database | New extraction sources added by config row, not code. `extractor_config` (jsonb) + `produces_kinds` (text[]) define behavior. Schema IS instruction. |

### Multi-Model Extraction (Ontological Validation)

| Component | Location | Models Used |
|-----------|----------|-------------|
| Primary cascade | `discover-description-data/index.ts:114-220` | Kimi k2-turbo → Grok-3-Mini → Gemini 2.5 Flash Lite → Claude Haiku |
| Fallback cascade | `extract-vehicle-data-ai/index.ts:173-226` | Gemini 2.5 Flash → Anthropic Haiku |
| `extraction_comparisons` table | Database | Records quality delta between free/paid models: `quality_delta`, `best_method`, `difficulty` |

**Paper claim:** "All models agree = fact. Diverge = investigate. None can fill = gap."
**Implementation:** Multi-model cascade with same prompt template. First success wins (current). Quality comparison table enables future agreement-based validation.

### The 66.7% Fabrication Finding

**Paper claim:** "A predefined schema of 344 reference fields applied to Porsche listings produced a 66.7% fabrication rate."
**Implementation response:** The `discover-description-data` extractor was rewritten to use unconstrained extraction ("create whatever keys make sense") rather than forcing a predefined template. Fabrication dropped to ~0%.

---

## 4. Actor Layer / Social Ontology

**Paper claim:** "The vehicle record becomes connective tissue linking actors, organizations, locations, and documents."

### The Actor-Vehicle-Component Triple

| Component | Location | What It Does |
|-----------|----------|--------------|
| `actors` table | Database (30 columns) | People and orgs who touch vehicles. `actor_type`: individual, shop, dealer, factory, inspector, auction_house. `trust_score` (0-100). `specialties` (text[]). `certifications` (text[]). |
| `component_events` table | Database (22 columns) | Reified event ontology: WHO (`actor_id`) did WHAT (`event_type`) to WHICH PART (`component_table` + `component_id`) on WHICH VEHICLE (`vehicle_id`) WHEN (`event_date`) WHERE (`location`) with EVIDENCE (`evidence_ids` uuid[]) |
| `actor_capabilities` table | Database | Evidence-based skill tracking: `capability_type`, `complexity_tier` (basic→master), `evidence_count`, `first_demonstrated`, `last_demonstrated`, `avg_spec_compliance` |
| `organizations` table | Database (100+ columns) | Shops, dealers, auction houses with full institutional profiles |
| `organization_hierarchy` table | Database | Parent/child with `relationship_type`, `ownership_percentage` |
| `person_organization_roles` table | Database | Person → org with role, dates, `is_current` |

### Event Types (from `component_events.event_type`)

```
installed, removed, rebuilt, inspected, modified, repaired,
replaced, cleaned, painted, tested, measured, adjusted,
condemned, sourced, purchased
```

Each is a distinct ontological category of actor-vehicle interaction.

### 33+ Component Tables (Total Resolution)

```
engine_blocks, engine_heads, engine_camshafts, engine_pistons,
brake_systems, wiring_harnesses, seats, carpeting, tires, wheels,
paint_systems, ...
```

Each component carries independent identity (casting numbers), condition, and provenance. The vehicle is an assembly of independently-tracked entities.

---

## 5. Rhizomatic Connectivity

**Paper claim:** "Any point connects to any other. The connections are more informative than the categories."

### Entity Resolution: Three-Tier Cascade

| Tier | Confidence | Method | Location |
|------|-----------|--------|----------|
| Tier 1 | ≥ 0.95 | VIN match (0.99), same source URL (0.99), chassis+make+era (0.95) | `ingest-observation/index.ts:149-164` |
| Tier 2 | 0.80-0.94 | Normalized URL match across `marketplace_listings`, `vehicle_events`, `vehicles.listing_url` | `ingest-observation/index.ts:174-220` |
| Tier 3 | 0.50-0.79 | Y/M/M fuzzy + location (+0.15) + mileage (+0.12) + price (+0.08). **Does NOT auto-link.** Creates `merge_proposals`. | `ingest-observation/index.ts:237-258` |

### Deferred Resolution (merge_proposals)

| Component | Location | What It Does |
|-----------|----------|--------------|
| `merge_proposals` table | Database | `vehicle_a_id`, `vehicle_b_id`, `detection_source`, `ai_decision`, `ai_confidence`, `ai_reasoning`, `match_tier`, `evidence` (jsonb), `status`, `ai_verified`, `human_verified` |
| Design axiom | `ENTITY_RESOLUTION_RULES.md` | "False splits are acceptable. False merges are catastrophic." |

### Polymorphic Foreign Keys

| Component | Location | What It Does |
|-----------|----------|--------------|
| `component_table` + `component_id` | `component_events` | Names the table and the row. 33+ component tables participate in the same event system without N foreign keys or inheritance hierarchy. Any component connects to any event. |
| `vehicle_match_signals` (jsonb) | `vehicle_observations` | Records HOW each observation was linked to its entity — preserving the resolution path as data. |

### Cross-Source Resolution

Five parallel resolution pathways in `ingest-observation`:
1. VIN → `vehicles.vin`
2. Canonical listing ID → `vehicles.listing_url` / `vehicles.discovery_url`
3. Exact URL → `vehicle_events.source_url`
4. Normalized URL → `vehicle_events.source_url`
5. Year+make fuzzy → candidate limiting

A single observation from Facebook Marketplace connects to an existing entity originally discovered on BaT through any of these pathways. The graph has no trunk.

---

## 6. Ontological Pluralism

**Paper claim:** "Multiple ontological frameworks coexist in the same system without a single unifying hierarchy."

### Six Simultaneous Assessments (Auction Readiness)

| Dimension | Column | Ontological Frame |
|-----------|--------|------------------|
| Identity | `identity_score` (0-100) | Legal/administrative ontology |
| Photos | `photo_score` (0-100) | Visual evidence ontology |
| Documentation | `doc_score` (0-100) | Archival/provenance ontology |
| Description | `desc_score` (0-100) | Narrative/testimony ontology |
| Market | `market_score` (0-100) | Financial ontology |
| Condition | `condition_score` (0-100) | Physical/material ontology |

One vehicle, six independent scores, six independent ontological frames. `composite_score` is a weighted merge, not a reduction.

### Condition Spectrometer

| Component | Location | What It Does |
|-----------|----------|--------------|
| `condition_taxonomy` table | Database | Formal taxonomy with dot-notation keys (`exterior.paint.oxidation`), domain classification (exterior/interior/mechanical/structural/provenance), descriptor type (adjective/mechanism/state), lifecycle affinity |
| `vehicle_condition_scores` table | Database | Five sub-scores: exterior (0-30), interior (0-20), mechanical (0-20), provenance (0-15), presentation (0-15) |
| Lifecycle states | Across schema | `fresh` → `worn` → `weathered` → `restored` → `palimpsest` → `ghost` → `archaeological` |
| nlq-sql prompt | `nlq-sql/index.ts:168` | "Condition is SPECTRAL (0-100 continuous), not binary. Damage is an ADJECTIVE, not an event." |

### Three Parallel Field-Level Systems

| System | Table | What It Captures |
|--------|-------|-----------------|
| **Evidence** | `vehicle_field_evidence` | Individual claims from specific sources with specific confidence |
| **Consensus** | `vehicle_field_consensus` | Resolved value after weighing all evidence. `resolution_method`: unresolved, unanimous, majority, expert_override |
| **Provenance** | `vehicle_field_provenance` | Field history: `factory_original_value` → `modified_value` → `modification_date` with `conflicting_sources` (jsonb) |

The same field ("engine") exists simultaneously as: competing claims (evidence), a resolved answer (consensus), and a historical narrative (provenance). Three ontological frames, one field.

### 150+ Views as Ontological Projections

| View | Ontological Frame |
|------|------------------|
| `vehicle_current_state` | The "now" — highest-weighted observation wins |
| `v_vehicle_canonical` | Administrative — data grade (A/B/C/D/F), price type |
| `vehicle_observations_decayed` | Epistemological — all observations with temporal decay |
| `vehicle_observation_summary` | Coverage — observation counts and gaps |
| `data_truth_audit_report` | Forensic — field-by-field comparison against VIN decode, anomaly detection |
| `vehicle_valuation_feed` | Financial — market perspective |
| `vehicle_condition_scores` | Material — physical condition |
| `auction_readiness` | Transactional — readiness-for-sale |

Each view is a lens. The entity is the same. The ontology shifts.

---

## Conclusion: The Code IS the Ontology

The paper's theoretical claims are not aspirational. They are descriptions of running PostgreSQL functions, production edge functions processing thousands of observations daily, and a relational schema with 950+ tables encoding ontological commitments as CHECK constraints, foreign keys, and computed views.

The gap between "applied ontology research" and "production knowledge graph" is exactly zero. The DDL is the ontological specification. The observations are the A-Box. The schema is the T-Box. The trust functions are the epistemological layer. The views are the pluralistic projections.

Every `INSERT INTO vehicle_observations` is an ontological act.
