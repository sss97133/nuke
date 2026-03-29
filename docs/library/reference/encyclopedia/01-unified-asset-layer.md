# Chapter 1: The Unified Asset Layer

The Unified Asset Layer is the foundational data architecture of the Nuke platform. It treats every vehicle as an entity in a knowledge graph, where the database does not merely describe the vehicle — the database IS the vehicle. Every other table in the system exists to provide testimony about that entity.

This chapter documents the canonical entity model, its schema, its lifecycle, and the trust hierarchy that governs how data flows into it.

---

## The Entity Model

### Vehicles as Entities

The `vehicles` table is the canonical entity table. It holds 828,000+ records, each representing a single physical vehicle (or the system's best understanding of one). Every other table in the database — observations, timeline events, images, comments, discoveries — is testimony that references back to a `vehicles.id`.

This is not a listing database. A vehicle exists independently of any auction, any listing, any photograph. Listings come and go; the vehicle persists. The same 1967 Shelby GT500 might appear on Bring a Trailer in 2019, then on Mecum in 2022, then on a forum in 2024. All three are observations of the same entity.

The `vehicles.id` is a UUID (`gen_random_uuid()`). It is the universal foreign key — the gravitational center of the knowledge graph.

### Why Not a Listing Table?

Early versions of the platform treated listings as the primary unit. This caused a cascade of problems:
- The same vehicle appeared as 3-5 separate records across auction platforms
- Sale prices conflicted because different listings captured different auction events
- There was no way to unify the ownership history across sources

The entity model inverts this: the vehicle is primary, and listings are observations about it.

---

## The vehicles Table: Complete Schema Reference

The `vehicles` table has **340 columns** organized into functional groups. This is intentional — EAV at total resolution means every knowable fact about a vehicle has a dedicated column with type safety, rather than being buried in a JSONB blob.

### Identity Columns

These columns establish what the vehicle IS — the immutable identity facts.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | `uuid` NOT NULL | Primary key. Universal FK across all tables. |
| `vin` | `text` | Vehicle Identification Number (17-digit for post-1981, shorter for vintage) |
| `year` | `integer` | Model year |
| `make` | `text` | Manufacturer name (raw, as ingested) |
| `model` | `text` | Model name (raw, as ingested) |
| `trim` | `text` | Trim level (e.g., "GT", "SS 396", "Turbo S") |
| `series` | `text` | Model series (e.g., "E30", "993", "C3") |
| `generation` | `text` | Generation identifier |
| `title` | `text` | Display title (often the listing title from source) |
| `listing_kind` | `text` NOT NULL | Default `'vehicle'`. Discriminator for non-vehicle listings. |

### Canonical Identity Columns

These are the normalized, system-resolved identity fields:

| Column | Type | Purpose |
|--------|------|---------|
| `canonical_make_id` | `uuid` | FK to a normalized make registry |
| `normalized_model` | `text` | System-normalized model name |
| `normalized_series` | `text` | System-normalized series |
| `canonical_vehicle_type` | `text` | Normalized vehicle type (car, truck, motorcycle, etc.) |
| `canonical_body_style` | `text` | Normalized body style (coupe, sedan, convertible, etc.) |
| `canonical_platform` | `text` | Primary platform this vehicle is associated with |

### Provenance Columns

Every identity field has a companion `_source` and `_confidence` column tracking where the value came from and how much the system trusts it:

| Column | Type | Purpose |
|--------|------|---------|
| `vin_source` | `text` | Where the VIN came from (e.g., `'vin_decode'`, `'bat_listing'`, `'user_input'`) |
| `vin_confidence` | `integer` | Confidence score 0-100 (default 50) |
| `year_source` | `text` | Source of the year value |
| `year_confidence` | `integer` | Confidence 0-100 |
| `make_source` | `text` | Source of the make value |
| `make_confidence` | `integer` | Confidence 0-100 |
| `model_source` | `text` | Source of the model value |
| `model_confidence` | `integer` | Confidence 0-100 |
| `mileage_source` | `text` | Source of the mileage reading |
| `engine_source` | `text` | Source of the engine specification |
| `transmission_source` | `text` | Source of the transmission specification |
| `color_source` | `text` | Source of the exterior color |
| `series_source` | `text` | Source of the series designation |
| `series_confidence` | `integer` | Confidence 0-100 |
| `trim_source` | `text` | Source of the trim level |
| `trim_confidence` | `integer` | Confidence 0-100 |
| `description_source` | `text` | Source of the description text |
| `msrp_source` | `text` | Source of the MSRP value |

This pattern — `field`, `field_source`, `field_confidence` — is the provenance triple. It ensures every fact in the database can be traced back to its origin and weighted against competing claims.

### Auction and Sale Columns

| Column | Type | Purpose |
|--------|------|---------|
| `sale_price` | `integer` | Final sale price in USD |
| `sold_price` | `integer` | Alternate sold price field |
| `canonical_sold_price` | `numeric` | System-resolved canonical sale price |
| `canonical_outcome` | `text` | Resolved auction outcome |
| `asking_price` | `numeric` | Listed asking price |
| `high_bid` | `integer` | Highest bid recorded |
| `winning_bid` | `integer` | Winning bid amount |
| `price` | `integer` | Generic price field |
| `auction_source` | `text` | Which auction house |
| `auction_status` | `text` | Current auction status. CHECK constraint: `live`, `ended`, `cancelled`, `pending`, `unknown` |
| `auction_outcome` | `text` | Result (sold, not sold, withdrawn) |
| `auction_end_date` | `text` | When the auction ended |
| `reserve_status` | `text` | CHECK constraint: `reserve`, `no_reserve`, `reserve_not_met`, `unknown` |
| `sale_status` | `text` | Default `'available'` |
| `sale_date` | `date` | Date of sale |

### BaT-Specific Columns

Bring a Trailer is the platform's deepest data source. These columns capture BaT-specific data:

| Column | Type | Purpose |
|--------|------|---------|
| `bat_auction_url` | `text` | BaT listing URL |
| `bat_sold_price` | `numeric` | BaT-reported sold price |
| `bat_sale_date` | `date` | BaT sale date |
| `bat_bid_count` | `integer` | Total bids on BaT |
| `bat_view_count` | `integer` | Total views on BaT |
| `bat_listing_title` | `text` | Original BaT listing title |
| `bat_bids` | `integer` | Bid count (alternate) |
| `bat_comments` | `integer` | Comment count |
| `bat_views` | `integer` | View count |
| `bat_location` | `text` | Listed location |
| `bat_seller` | `text` | Seller username |
| `bat_buyer` | `text` | Buyer username |
| `bat_lot_number` | `text` | BaT lot number |
| `bat_watchers` | `integer` | Number of watchers |

### Specification Columns

The full mechanical specification of the vehicle:

| Column | Type | Purpose |
|--------|------|---------|
| `engine_size` | `text` | Engine displacement (text, as reported) |
| `engine_displacement` | `text` | Alternate displacement field |
| `engine_liters` | `numeric` | Displacement in liters (numeric) |
| `engine_type` | `text` | Engine configuration (V8, inline-6, flat-4, etc.) |
| `engine_code` | `text` | Factory engine code |
| `horsepower` | `integer` | Rated horsepower |
| `torque` | `integer` | Rated torque (lb-ft) |
| `transmission` | `text` | Transmission description |
| `transmission_type` | `text` | Manual, automatic, sequential, etc. |
| `transmission_model` | `text` | Specific transmission model |
| `transmission_code` | `text` | Factory transmission code |
| `transmission_speeds` | `integer` | Number of gears |
| `drivetrain` | `text` | RWD, FWD, AWD, 4WD |
| `fuel_type` | `text` | Gasoline, diesel, electric, hybrid |
| `displacement` | `text` | Legacy displacement field |
| `compression_ratio` | `numeric` | Engine compression ratio |
| `bore_mm` | `numeric` | Cylinder bore in mm |
| `stroke_mm` | `numeric` | Piston stroke in mm |
| `rear_axle_ratio` | `numeric` | Rear axle gear ratio |
| `rear_axle_type` | `text` | Axle type (Dana 60, etc.) |
| `transfer_case` | `text` | Transfer case model (4WD vehicles) |

### Performance Columns

Measured (or claimed) performance data:

| Column | Type | Purpose |
|--------|------|---------|
| `zero_to_sixty` | `numeric` | 0-60 mph time in seconds |
| `quarter_mile` | `numeric` | Quarter mile ET |
| `quarter_mile_speed` | `numeric` | Quarter mile trap speed |
| `top_speed_mph` | `integer` | Top speed |
| `braking_60_0_ft` | `numeric` | 60-0 braking distance in feet |
| `lateral_g` | `numeric` | Lateral acceleration |
| `power_to_weight` | `numeric` | Power-to-weight ratio |
| `drag_coefficient` | `numeric` | Cd value |

### Condition and Scoring Columns

| Column | Type | Purpose |
|--------|------|---------|
| `condition_rating` | `integer` | Overall condition 1-10 |
| `data_quality_score` | `integer` | How complete the data is (0-100) |
| `quality_issues` | `text[]` | Array of identified quality problems |
| `quality_grade` | `numeric` | Computed quality grade |
| `confidence_score` | `integer` | Overall entity confidence (default 50) |
| `nuke_estimate` | `numeric` | Platform's estimated value |
| `nuke_estimate_confidence` | `integer` | Confidence in the estimate |
| `deal_score` | `numeric` | How good a deal the price represents |
| `heat_score` | `numeric` | Market interest/activity score |
| `signal_score` | `numeric` | Composite signal strength |
| `signal_reasons` | `text[]` | Why the signal score is what it is |
| `analysis_tier` | `integer` NOT NULL | Depth of analysis (0 = unanalyzed) |

### Location Columns

| Column | Type | Purpose |
|--------|------|---------|
| `location` | `text` | General location text |
| `city` | `text` | City |
| `state` | `text` | State/province |
| `country` | `text` | Country (default `'USA'`) |
| `zip_code` | `text` | ZIP/postal code |
| `gps_latitude` | `numeric` | GPS latitude |
| `gps_longitude` | `numeric` | GPS longitude |
| `listing_location` | `text` | Location as listed |
| `listing_location_raw` | `text` | Unprocessed location string |
| `listing_location_source` | `text` | Where the location data came from |
| `listing_location_confidence` | `real` | Confidence in the geocoded location |

### Entity Resolution Columns

| Column | Type | Purpose |
|--------|------|---------|
| `merged_into_vehicle_id` | `uuid` | If this record was merged, points to the surviving entity |
| `status` | `text` | Entity lifecycle status (see below) |
| `verification_status` | `text` | Default `'unverified'` |
| `import_queue_id` | `uuid` | Link back to the import queue item that created this entity |

---

## Vehicle Status Lifecycle

The `vehicles.status` column has a CHECK constraint with these allowed values:

| Status | Meaning |
|--------|---------|
| `active` | Live, valid entity. The default for resolved vehicles. |
| `sold` | Vehicle has been sold (auction completed) |
| `discovered` | Newly discovered, not yet fully resolved |
| `pending` | Awaiting processing or verification |
| `pending_backfill` | Queued for backfill extraction |
| `archived` | No longer actively tracked |
| `inactive` | Temporarily inactive |
| `duplicate` | Identified as a duplicate (see entity resolution) |
| `merged` | Has been merged into another entity via `merged_into_vehicle_id` |
| `rejected` | Invalid or non-vehicle record |

The typical lifecycle: `discovered` -> `pending` -> `active` -> `sold` (or `archived`).

Duplicate detection: `active` -> `duplicate` (with `merged_into_vehicle_id` set).

---

## The Observation Model: Data as Testimony

The `vehicle_observations` table (5.67M rows) is the backbone of the data pipeline. Every fact about a vehicle enters the system as an observation — a statement from a source, at a time, with a confidence level. See Chapter 2 for the full observation model.

The relationship is:

```
vehicles (828K) <--[vehicle_id]-- vehicle_observations (5.67M)
                                       |
                                       +--[source_id]--> observation_sources (159)
                                       +--[extractor_id]--> observation_extractors (4)
```

A single vehicle may have thousands of observations from dozens of sources. The `vehicles` table columns are the materialized consensus — the system's current best understanding, computed from all available testimony.

### How Observations Become Vehicle Data

The flow is:

1. **Ingest**: Raw data enters via `ingest-observation` edge function
2. **Match**: The observation is linked to a `vehicle_id` (or a new entity is created)
3. **Store**: The observation is written to `vehicle_observations` with full provenance
4. **Discover**: AI agents process observations into `observation_discoveries`, `comment_discoveries`, `description_discoveries`
5. **Promote**: High-confidence discoveries are promoted into `field_evidence` (3.29M rows)
6. **Materialize**: The `vehicles` table columns are updated from the highest-confidence evidence

---

## Entity Resolution

When a new observation arrives, the system must determine: does this refer to an existing vehicle, or is it a new entity? This is entity resolution — covered in full in Chapter 4.

The `merge_proposals` table (26 rows currently) tracks proposed merges between vehicle entities. The `merged_into_vehicle_id` column on `vehicles` records the result of approved merges.

Key safety rules:
- Never call `merge_into_primary` without AI verification
- Never overwrite a higher-trust field value with a lower-trust one
- The word "merge" means "link observations to a canonical entity," not "combine two profiles"

---

## The Digital Twin Concept

The Nuke database implements a Digital Twin architecture: the database is a mirror of every physical vehicle it tracks. The technical names for this approach:

- **Domain Ontology Engineering** — a complete formal specification of everything that can be true about a vehicle
- **Canonical Data Model** — a single authoritative schema that every data source maps into
- **Schema-Guided Generation** — the SQL DDL is the specification; LLMs fill the schema and cite their sources
- **EAV at Total Resolution** — Entity-Attribute-Value modeling where every attribute has its own column

The 340 columns on `vehicles` are not accidental. They represent the system's current understanding of what CAN be true about a vehicle. As the ontology grows (new attributes are discovered), the schema grows to match.

### Five Dimensional Shadows

Every vehicle entity casts five "shadows" — different facets of the same truth:

1. **Specification** — factory-delivered configuration (engine, transmission, options)
2. **Current State** — the vehicle as it exists today (modifications, mileage, condition)
3. **Condition** — assessed quality across components (engine health, body, interior)
4. **Provenance** — chain of ownership, documentation, racing history
5. **Evidence** — the raw observations, photos, and documents that support all claims

These are not separate tables — they are logical groupings within the single `vehicles` entity plus its observation graph.

---

## Trust Hierarchy

Different sources carry different weight. The `observation_sources` table assigns a `base_trust_score` to each source:

| Trust Tier | Score Range | Examples |
|-----------|-------------|----------|
| Tier 1 — Institutional | 0.85-0.90 | Gooding & Company, RM Sotheby's, Bonhams |
| Tier 2 — Established | 0.80-0.85 | Bring a Trailer, Cars & Bids, IAA |
| Tier 3 — Known | 0.70-0.80 | Mecum, Barrett-Jackson, PCarMarket |
| Tier 4 — Community | 0.50-0.70 | Forum posts, social media, small auctions |
| Tier 5 — Unverified | 0.00-0.50 | User input, scraped aggregators |

The trust score flows through the system:
- `observation_sources.base_trust_score` sets the floor
- `vehicle_observations.confidence` refines it per observation (`verified`, `high`, `medium`, `low`, `inferred`)
- `vehicle_observations.confidence_score` is the numeric 0-1 equivalent
- `vehicles.*_confidence` columns store the materialized confidence per field

### Provenance Source Types

The `vehicles.*_source` columns record the origin type of each field value:

| Source Type | Trust Level | Description |
|-------------|-------------|-------------|
| `vin_decode` | Highest | NHTSA VIN decoder or manufacturer database |
| `bat_listing` | High | Curated BaT listing content |
| `auction_result` | High | Official auction sale result |
| `user_input` | Medium | Direct owner/user submission |
| `ai_extraction` | Medium | LLM-extracted from source text |
| `web_scrape` | Low | Automated scrape of listing pages |
| `inferred` | Lowest | System-computed from other data |

---

## Data Quality Infrastructure

The platform tracks data completeness and quality at the entity level:

| Column | Purpose |
|--------|---------|
| `data_quality_score` | Computed completeness 0-100 |
| `data_quality_flags` | JSONB of specific quality issues |
| `quality_issues` | Text array of human-readable problems |
| `quality_grade` | Numeric grade |
| `requires_improvement` | Boolean flag for quality review |
| `last_quality_check` | Timestamp of last quality assessment |
| `completion_percentage` | How much of the schema is filled |

The `observation_count` and `image_count` columns (both NOT NULL with default 0) are denormalized counters maintained by triggers, providing instant access to entity density metrics without joins.

---

## Key Relationships

```sql
-- The core graph: vehicle -> observations -> sources
vehicles.id                     = vehicle_observations.vehicle_id
vehicle_observations.source_id  = observation_sources.id
vehicle_observations.extractor_id = observation_extractors.id

-- Evidence chain: observations -> discoveries -> field evidence
vehicle_observations.id         -> observation_discoveries.observation_ids[]
vehicle_observations.vehicle_id -> comment_discoveries.vehicle_id
vehicle_observations.vehicle_id -> description_discoveries.vehicle_id
vehicles.id                     = field_evidence.vehicle_id

-- Entity resolution
vehicles.merged_into_vehicle_id = vehicles.id  (self-referential)
merge_proposals.vehicle_a_id    = vehicles.id
merge_proposals.vehicle_b_id    = vehicles.id

-- Timeline
timeline_events.vehicle_id      = vehicles.id
work_sessions.vehicle_id        = vehicles.id
```

---

## Edge Functions

| Function | Role in the Asset Layer |
|----------|----------------------|
| `ingest-observation` | The single intake point. All new data flows through this. |
| `ingest` | Legacy intake (pre-observation model) |
| `build-identity-graph` | Constructs the knowledge graph from observations |
| `discover-entity-graph` | Discovers entity relationships across observations |
| `dedup-vehicles` | Identifies and proposes duplicate merges |
| `migrate-to-observations` | Ports legacy data into the observation model |
| `db-stats` | Reports entity counts and coverage metrics |

---

## Summary

The Unified Asset Layer is not a vehicle listing database. It is a knowledge graph materialized as a relational schema. Every column is a claim. Every claim has a source. Every source has a trust score. The `vehicles` table is the consensus layer — the system's current best understanding of what is true about each physical vehicle, computed from the full body of evidence in `vehicle_observations`, `field_evidence`, and their associated discovery tables.
