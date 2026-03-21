# Entity Relationships

## Every Entity Type and How They Relate

This document catalogs every significant entity (table) in the Nuke system, documents its columns and purpose, and maps the foreign key relationships and cardinalities between them. The system has approximately 1,000 tables, but the operational core comprises roughly 20 tables that carry all meaningful data.

---

## Table of Contents

1. [Core Entity Map](#1-core-entity-map)
2. [vehicles](#2-vehicles)
3. [vehicle_images](#3-vehicle_images)
4. [vehicle_events](#4-vehicle_events)
5. [auction_events](#5-auction_events)
6. [auction_comments](#6-auction_comments)
7. [import_queue](#7-import_queue)
8. [observation_sources](#8-observation_sources)
9. [vehicle_observations](#9-vehicle_observations)
10. [listing_page_snapshots](#10-listing_page_snapshots)
11. [extraction_metadata](#11-extraction_metadata)
12. [bat_quarantine](#12-bat_quarantine)
13. [pipeline_registry](#13-pipeline_registry)
14. [source_census](#14-source_census)
15. [coverage_targets](#15-coverage_targets)
16. [profiles](#16-profiles)
17. [organizations](#17-organizations)
18. [field_evidence](#18-field_evidence)
19. [comment_discoveries](#19-comment_discoveries)
20. [description_discoveries](#20-description_discoveries)
21. [ER Diagram: Core Tables](#21-er-diagram-core-tables)
22. [ER Diagram: Observation System](#22-er-diagram-observation-system)
23. [ER Diagram: Extraction Pipeline](#23-er-diagram-extraction-pipeline)
24. [Cardinality Summary](#24-cardinality-summary)

---

## 1. Core Entity Map

```
+===========================================================================+
|                           CORE ENTITY MAP                                  |
|                                                                            |
|                        +-------------+                                     |
|                        |  profiles   |                                     |
|                        | (users)     |                                     |
|                        +------+------+                                     |
|                               |                                            |
|                        +------+------+         +------------------+        |
|                        |  vehicles   +---------+ organizations    |        |
|                        | (core)      |         | (dealers, shops) |        |
|                        +--+--+--+--+-+         +------------------+        |
|                           |  |  |  |                                       |
|            +--------------+  |  |  +-------------------+                   |
|            |                 |  |                      |                   |
|   +--------+------+   +-----+------+   +--------------+------+            |
|   | vehicle_images|   | vehicle_   |   | auction_comments    |            |
|   | (1M+)         |   | events     |   | (364K)              |            |
|   +---------------+   | (170K)     |   +---------------------+            |
|                       +-----+------+                                       |
|                             |                                              |
|                       +-----+------+                                       |
|                       | auction_   |                                       |
|                       | events     |                                       |
|                       +------------+                                       |
|                                                                            |
|   +------------------+  +-------------------+  +---------------------+     |
|   | observation_     |  | vehicle_          |  | listing_page_       |     |
|   | sources          +--+ observations      |  | snapshots           |     |
|   | (registry)       |  | (unified events)  |  | (HTML archive)      |     |
|   +------------------+  +-------------------+  +---------------------+     |
|                                                                            |
|   +------------------+  +-------------------+  +---------------------+     |
|   | import_queue     |  | extraction_       |  | bat_quarantine      |     |
|   | (job queue)      |  | metadata          |  | (conflict store)    |     |
|   +------------------+  | (provenance)      |  +---------------------+     |
|                         +-------------------+                              |
|                                                                            |
|   +------------------+  +-------------------+                              |
|   | pipeline_        |  | source_census     |                              |
|   | registry         |  | (universe counts) |                              |
|   | (field ownership)|  +-------------------+                              |
|   +------------------+                                                     |
+===========================================================================+
```

---

## 2. vehicles

The central entity. Every other table either describes, references, or feeds into this table. Approximately 18,000 records as of March 2026.

### Schema (Core Columns)

```
vehicles
+----------------------------+--------------+--------------------------------------+
| Column                     | Type         | Purpose                              |
+----------------------------+--------------+--------------------------------------+
| id                         | UUID PK      | Unique vehicle identifier            |
| user_id                    | UUID FK      | -> profiles.id (owner, nullable)     |
| organization_id            | UUID FK      | -> organizations.id (nullable)       |
+----------------------------+--------------+--------------------------------------+
| IDENTITY                                                                         |
+----------------------------+--------------+--------------------------------------+
| make                       | TEXT         | Canonical make name (e.g. Porsche)   |
| model                      | TEXT         | Model name (e.g. 911)               |
| year                       | INTEGER      | Model year (1885-current+2)          |
| vin                        | TEXT UNIQUE  | Vehicle Identification Number        |
| trim                       | TEXT         | Trim level (e.g. GT3, SS 396)       |
| submodel                   | TEXT         | Sub-model specification              |
| series                     | TEXT         | Production series                    |
| listing_title              | TEXT         | Original listing title               |
+----------------------------+--------------+--------------------------------------+
| PROVENANCE SOURCE COLUMNS                                                        |
+----------------------------+--------------+--------------------------------------+
| year_source                | TEXT         | What set the year field              |
| year_confidence            | INTEGER      | Confidence 0-100                    |
| make_source                | TEXT         | What set the make field              |
| make_confidence            | INTEGER      | Confidence 0-100                    |
| model_source               | TEXT         | What set the model field             |
| model_confidence           | INTEGER      | Confidence 0-100                    |
| vin_source                 | TEXT         | What set the VIN field               |
| vin_confidence             | INTEGER      | Confidence 0-100                    |
| color_source               | TEXT         | What set the color fields            |
| color_confidence           | INTEGER      | Confidence 0-100                    |
| mileage_source             | TEXT         | What set the mileage field           |
| mileage_confidence         | INTEGER      | Confidence 0-100                    |
| transmission_source        | TEXT         | What set the transmission field      |
| transmission_confidence    | INTEGER      | Confidence 0-100                    |
| engine_source              | TEXT         | What set the engine fields           |
| engine_confidence          | INTEGER      | Confidence 0-100                    |
| description_source         | TEXT         | listing/ai_generated/user/imported   |
| series_source              | TEXT         | What set the series field            |
| trim_source                | TEXT         | What set the trim field              |
| msrp_source                | TEXT         | oem/listing_parsed/user/ai_estimated |
| listing_location_source    | TEXT         | What set the location                |
| platform_source            | TEXT         | What set the platform field          |
+----------------------------+--------------+--------------------------------------+
| SPECIFICATIONS                                                                   |
+----------------------------+--------------+--------------------------------------+
| color                      | TEXT         | Primary color                        |
| exterior_color             | TEXT         | Exterior color (normalized)          |
| interior_color             | TEXT         | Interior color                       |
| mileage                    | INTEGER      | Odometer reading                     |
| fuel_type                  | TEXT         | Gas/Diesel/Electric/Hybrid           |
| transmission               | TEXT         | Normalized transmission type         |
| engine                     | TEXT         | Engine description                   |
| engine_size                | TEXT         | Displacement (e.g. 3.8L)            |
| horsepower                 | INTEGER      | Peak horsepower                      |
| torque                     | INTEGER      | Peak torque                          |
| drivetrain                 | TEXT         | RWD/FWD/AWD/4WD                     |
| body_style                 | TEXT         | Coupe/Sedan/Convertible/etc.         |
| doors                      | INTEGER      | Number of doors                      |
| seats                      | INTEGER      | Number of seats                      |
| weight_lbs                 | INTEGER      | Curb weight in pounds                |
+----------------------------+--------------+--------------------------------------+
| DIMENSIONS                                                                       |
+----------------------------+--------------+--------------------------------------+
| length_inches              | INTEGER      | Overall length                       |
| width_inches               | INTEGER      | Overall width                        |
| height_inches              | INTEGER      | Overall height                       |
| wheelbase_inches           | INTEGER      | Wheelbase                            |
+----------------------------+--------------+--------------------------------------+
| FUEL/ECONOMY                                                                     |
+----------------------------+--------------+--------------------------------------+
| fuel_capacity_gallons      | DECIMAL(5,2) | Tank size                            |
| mpg_city                   | INTEGER      | City fuel economy                    |
| mpg_highway                | INTEGER      | Highway fuel economy                 |
| mpg_combined               | INTEGER      | Combined fuel economy                |
+----------------------------+--------------+--------------------------------------+
| PRICING/VALUE                                                                    |
+----------------------------+--------------+--------------------------------------+
| msrp                       | DECIMAL(10,2)| Original MSRP                       |
| asking_price               | DECIMAL(10,2)| Current asking price                 |
| sale_price                 | DECIMAL(10,2)| Actual sale price                    |
| high_bid                   | DECIMAL(10,2)| Highest bid (auction)                |
| current_value              | DECIMAL(10,2)| Estimated current market value       |
| price_confidence           | INTEGER      | Value estimate confidence            |
| purchase_price             | DECIMAL(10,2)| What user paid                       |
| purchase_date              | DATE         | When user purchased                  |
| nuke_estimate              | DECIMAL      | AI-computed valuation                |
| nuke_estimate_confidence   | INTEGER      | 0-100 valuation confidence           |
| deal_score                 | INTEGER      | 0-100 deal quality                   |
+----------------------------+--------------+--------------------------------------+
| STATUS                                                                           |
+----------------------------+--------------+--------------------------------------+
| status                     | TEXT         | active/pending/sold/discovered/      |
|                            |              | merged/rejected/inactive/archived/   |
|                            |              | deleted/pending_backfill/duplicate   |
| sale_status                | TEXT         | available/for_sale/sold/unsold/      |
|                            |              | auction_live/ended/etc.              |
| auction_status             | TEXT         | active/ended/sold                    |
| reserve_status             | TEXT         | no_reserve/reserve_met/              |
|                            |              | reserve_not_met                      |
| verification_status        | TEXT         | unverified/contributor_verified/     |
|                            |              | title_verified/multi_verified/       |
|                            |              | disputed                             |
+----------------------------+--------------+--------------------------------------+
| SOURCING                                                                         |
+----------------------------+--------------+--------------------------------------+
| discovery_source           | TEXT         | How vehicle was found                |
| discovery_url              | TEXT         | Original listing URL                 |
| listing_url                | TEXT         | Canonical listing URL (for dedup)    |
| platform_source            | TEXT         | Source platform slug                 |
| platform_url               | TEXT         | Platform-specific URL                |
| bat_auction_url            | TEXT         | Legacy BaT URL field                 |
+----------------------------+--------------+--------------------------------------+
| COMPUTED SCORES (owned by pipeline functions)                                    |
+----------------------------+--------------+--------------------------------------+
| heat_score                 | INTEGER      | 0-100 market demand                  |
| signal_score               | INTEGER      | 0-100 composite signal               |
| signal_reasons             | JSONB        | Array of signal_score reasons        |
| perf_power_score           | INTEGER      | 0-100 power rating                   |
| perf_acceleration_score    | INTEGER      | 0-100 acceleration rating            |
| perf_braking_score         | INTEGER      | 0-100 braking rating                 |
| perf_handling_score        | INTEGER      | 0-100 handling rating                |
| perf_comfort_score         | INTEGER      | 0-100 comfort rating                 |
| social_positioning_score   | INTEGER      | 0-100 social appeal                  |
| investment_quality_score   | INTEGER      | 0-100 investment quality             |
| provenance_score           | INTEGER      | 0-100 documentation quality          |
| overall_desirability_score | INTEGER      | 0-100 composite desirability         |
| completion_percentage      | INTEGER      | 0-100 profile completeness           |
| quality_grade              | NUMERIC      | Numeric quality grade                |
+----------------------------+--------------+--------------------------------------+
| MERGE TRACKING                                                                   |
+----------------------------+--------------+--------------------------------------+
| merged_into_vehicle_id     | UUID FK      | -> vehicles.id (if merged)           |
+----------------------------+--------------+--------------------------------------+
| METADATA                                                                         |
+----------------------------+--------------+--------------------------------------+
| description                | TEXT         | Vehicle narrative                    |
| notes                      | TEXT         | Free-form notes                      |
| is_public                  | BOOLEAN      | Visible to public                    |
| is_modified                | BOOLEAN      | Has modifications                    |
| modification_details       | TEXT         | Modification description             |
| condition_rating           | INTEGER      | 1-10 condition rating                |
| previous_owners            | INTEGER      | Owner count                          |
| created_at                 | TIMESTAMPTZ  | Record creation                      |
| updated_at                 | TIMESTAMPTZ  | Last modification                    |
+----------------------------+--------------+--------------------------------------+
```

### Key Indexes

```
idx_vehicles_user_id       ON (user_id)
idx_vehicles_make_model    ON (make, model)
idx_vehicles_year          ON (year)
idx_vehicles_vin           ON (vin)
idx_vehicles_public        ON (is_public)
idx_vehicles_created_at    ON (created_at)
```

---

## 3. vehicle_images

All images associated with vehicles. Over 1 million records. Images come from listing scrapes, user uploads, and iPhoto intake.

### Schema

```
vehicle_images
+----------------------------+--------------+--------------------------------------+
| Column                     | Type         | Purpose                              |
+----------------------------+--------------+--------------------------------------+
| id                         | UUID PK      | Unique image identifier              |
| vehicle_id                 | UUID FK      | -> vehicles.id                       |
| url                        | TEXT         | Image URL (external or storage)      |
| source                     | TEXT         | Where image came from (bat, iphoto,  |
|                            |              | user, etc.)                          |
| position                   | INTEGER      | Display order                        |
| is_primary                 | BOOLEAN      | Primary display image                |
+----------------------------+--------------+--------------------------------------+
| AI PIPELINE                                                                      |
+----------------------------+--------------+--------------------------------------+
| ai_processing_status       | TEXT         | pending/processing/completed/        |
|                            |              | failed/skipped                       |
| ai_processing_started_at   | TIMESTAMPTZ  | When AI analysis began               |
| ai_processing_completed_at | TIMESTAMPTZ  | When AI analysis finished            |
| ai_suggestions             | JSONB        | Raw AI output (immutable)            |
| analysis_history           | JSONB        | Append-only AI run history           |
+----------------------------+--------------+--------------------------------------+
| CLASSIFICATION                                                                   |
+----------------------------+--------------+--------------------------------------+
| angle                      | TEXT         | front/front_3-4/side/rear_3-4/rear/ |
|                            |              | interior/engine_bay/undercarriage/   |
|                            |              | detail/document/unknown              |
| angle_source               | TEXT         | yono/ai/user/extractor               |
| zone                       | TEXT         | Photo coverage zone                  |
+----------------------------+--------------+--------------------------------------+
| OPTIMIZATION                                                                     |
+----------------------------+--------------+--------------------------------------+
| optimization_status        | TEXT         | pending/processing/optimized/failed  |
| organization_status        | TEXT         | unorganized/organized/ignored        |
+----------------------------+--------------+--------------------------------------+
| VEHICLE DETECTION                                                                |
+----------------------------+--------------+--------------------------------------+
| vehicle_vin                | TEXT         | VIN detected in image via OCR        |
+----------------------------+--------------+--------------------------------------+
| METADATA                                                                         |
+----------------------------+--------------+--------------------------------------+
| width                      | INTEGER      | Image width in pixels                |
| height                     | INTEGER      | Image height in pixels               |
| file_size                  | INTEGER      | File size in bytes                   |
| content_type               | TEXT         | MIME type                            |
| created_at                 | TIMESTAMPTZ  | Record creation                      |
| updated_at                 | TIMESTAMPTZ  | Last modification                    |
+----------------------------+--------------+--------------------------------------+
```

### Relationship

```
vehicles 1 ----< * vehicle_images
(one vehicle has many images)
```

---

## 4. vehicle_events

Records of external events associated with a vehicle: auction listings, marketplace appearances, price changes, etc. Approximately 170,000 records.

### Schema

```
vehicle_events
+----------------------------+--------------+--------------------------------------+
| Column                     | Type         | Purpose                              |
+----------------------------+--------------+--------------------------------------+
| id                         | UUID PK      | Unique event identifier              |
| vehicle_id                 | UUID FK      | -> vehicles.id                       |
| source_platform            | TEXT         | Platform slug (bat, mecum, etc.)     |
| source_url                 | TEXT         | Event URL                            |
| source_listing_id          | TEXT         | Platform-specific listing ID         |
| event_type                 | TEXT         | listing/auction/sale/price_change    |
| event_date                 | TIMESTAMPTZ  | When event occurred                  |
| comment_count              | INTEGER      | Expected comments at source          |
| comments_extracted_at      | TIMESTAMPTZ  | When comments were extracted         |
| created_at                 | TIMESTAMPTZ  | Record creation                      |
| updated_at                 | TIMESTAMPTZ  | Last modification                    |
+----------------------------+--------------+--------------------------------------+
```

### Relationship

```
vehicles 1 ----< * vehicle_events
(one vehicle can appear on multiple platforms across multiple events)
```

### Key Views

- `vehicle_latest_event`: Most recent event per vehicle
- `vehicle_event_summary`: Aggregated event stats per vehicle

---

## 5. auction_events

Specific auction instances: a particular lot at a particular sale event. Links to vehicle_events but provides auction-specific data.

### Schema

```
auction_events
+----------------------------+--------------+--------------------------------------+
| Column                     | Type         | Purpose                              |
+----------------------------+--------------+--------------------------------------+
| id                         | UUID PK      | Unique auction event identifier      |
| vehicle_id                 | UUID FK      | -> vehicles.id                       |
| platform                   | TEXT         | Auction platform                     |
| lot_number                 | TEXT         | Lot number at auction                |
| auction_url                | TEXT         | Auction listing URL                  |
| auction_start              | TIMESTAMPTZ  | Auction start time                   |
| auction_end                | TIMESTAMPTZ  | Auction end time                     |
| sale_price                 | DECIMAL      | Hammer price                         |
| high_bid                   | DECIMAL      | Highest bid                          |
| bid_count                  | INTEGER      | Number of bids                       |
| comment_count              | INTEGER      | Number of comments                   |
| view_count                 | INTEGER      | Page views                           |
| watcher_count              | INTEGER      | Watchers                             |
| reserve_status             | TEXT         | no_reserve/reserve_met/              |
|                            |              | reserve_not_met                      |
| seller_username            | TEXT         | Seller identity                      |
| buyer_username             | TEXT         | Buyer identity                       |
| location                   | TEXT         | Vehicle location                     |
| category                   | TEXT         | Auction category                     |
| created_at                 | TIMESTAMPTZ  | Record creation                      |
| updated_at                 | TIMESTAMPTZ  | Last modification                    |
+----------------------------+--------------+--------------------------------------+
```

### Relationship

```
vehicles 1 ----< * auction_events
(one vehicle can be auctioned multiple times)
```

---

## 6. auction_comments

Individual comments from auction listings. Approximately 364,000 records from primarily Bring a Trailer.

### Schema

```
auction_comments
+----------------------------+--------------+--------------------------------------+
| Column                     | Type         | Purpose                              |
+----------------------------+--------------+--------------------------------------+
| id                         | UUID PK      | Unique comment identifier            |
| vehicle_id                 | UUID FK      | -> vehicles.id                       |
| comment_text               | TEXT         | Full comment text                    |
| username                   | TEXT         | Commenter username                   |
| posted_at                  | TIMESTAMPTZ  | When comment was posted              |
| is_bid                     | BOOLEAN      | Whether this is a bid                |
| bid_amount                 | DECIMAL      | Bid amount (if is_bid)               |
| is_seller                  | BOOLEAN      | Whether commenter is the seller      |
| platform                   | TEXT         | Source platform                      |
| source_url                 | TEXT         | Listing URL                          |
| parent_comment_id          | UUID FK      | -> auction_comments.id (thread)      |
| created_at                 | TIMESTAMPTZ  | Record creation                      |
+----------------------------+--------------+--------------------------------------+
```

### Relationship

```
vehicles 1 ----< * auction_comments
auction_comments 1 ----< * auction_comments (self-referential: threads)
```

---

## 7. import_queue

The central job queue for URL-based data intake. Full schema documented in [data-flow.md](./data-flow.md#3-the-import-queue).

### Relationships

```
observation_sources 1 ----< * import_queue (via source_id)
import_queue * >---- 0..1 vehicles (via vehicle_id, set on completion)
```

---

## 8. observation_sources

Registry of all data sources. Each source has a trust score, supported observation kinds, and metadata about how to extract from it.

### Schema

```
observation_sources
+----------------------------+--------------+--------------------------------------+
| Column                     | Type         | Purpose                              |
+----------------------------+--------------+--------------------------------------+
| id                         | UUID PK      | Unique source identifier             |
| slug                       | TEXT UNIQUE  | URL-friendly identifier (e.g. "bat") |
| display_name               | TEXT         | Human-readable name                  |
| category                   | TEXT         | auction/forum/social_media/          |
|                            |              | marketplace/registry/shop/owner/     |
|                            |              | documentation                        |
| base_trust_score           | DECIMAL      | 0.0-1.0 default trust level          |
| supported_observations     | TEXT[]       | Array of supported kinds:            |
|                            |              | listing/comment/bid/image/           |
|                            |              | price_history/condition_report/etc.  |
| base_url                   | TEXT         | Platform base URL                    |
| scrape_config              | JSONB        | Scraping configuration               |
| is_active                  | BOOLEAN      | Whether source is active             |
| created_at                 | TIMESTAMPTZ  | Record creation                      |
| updated_at                 | TIMESTAMPTZ  | Last modification                    |
+----------------------------+--------------+--------------------------------------+
```

### Source Categories

```
auction       - BaT, C&B, RM Sotheby's, Mecum, Barrett-Jackson, etc.
forum         - Rennlist, Pelican Parts, model-specific forums
social_media  - Instagram, YouTube
marketplace   - eBay, Craigslist, Hagerty Marketplace, FB Marketplace
registry      - Marque registries, Hagerty valuation
shop          - Service records, restoration shops
owner         - Direct owner input
documentation - Titles, build sheets, window stickers
```

### Relationships

```
observation_sources 1 ----< * vehicle_observations (via source_id)
observation_sources 1 ----< * import_queue (via source_id)
observation_sources 1 ----< * source_census (via source_id)
observation_sources 1 ----< * coverage_targets (via source_id)
```

---

## 9. vehicle_observations

The unified event store for the new observation architecture. Every data point from any source is stored here, regardless of type. This is the target data model that the system is migrating toward.

### Schema

```
vehicle_observations
+----------------------------+--------------+--------------------------------------+
| Column                     | Type         | Purpose                              |
+----------------------------+--------------+--------------------------------------+
| id                         | UUID PK      | Unique observation identifier        |
| vehicle_id                 | UUID FK      | -> vehicles.id (nullable if          |
|                            |              | unresolved)                          |
| source_id                  | UUID FK      | -> observation_sources.id            |
| kind                       | TEXT         | Observation type: listing/comment/   |
|                            |              | bid/image/condition_report/          |
|                            |              | price_history/etc.                   |
| observed_at                | TIMESTAMPTZ  | When observation occurred            |
| source_url                 | TEXT         | URL of source material               |
| source_identifier          | TEXT         | Platform-specific ID (e.g. comment   |
|                            |              | ID, listing ID)                      |
| content_text               | TEXT         | Raw observation text                 |
| content_hash               | TEXT         | SHA-256 of content (dedup key)       |
| structured_data            | JSONB        | Extracted structured fields          |
|                            |              | (IMMUTABLE after insert)             |
+----------------------------+--------------+--------------------------------------+
| CONFIDENCE                                                                       |
+----------------------------+--------------+--------------------------------------+
| confidence                 | TEXT         | verified/high/medium/low             |
| confidence_score           | DECIMAL      | 0.0-1.0 numeric confidence           |
| confidence_factors         | JSONB        | What contributed to confidence       |
+----------------------------+--------------+--------------------------------------+
| VEHICLE MATCHING                                                                 |
+----------------------------+--------------+--------------------------------------+
| vehicle_match_confidence   | DECIMAL      | 0.0-1.0 vehicle resolution           |
|                            |              | confidence                           |
| vehicle_match_signals      | JSONB        | What signals matched vehicle         |
|                            |              | (vin_match, url_match, fuzzy_match)  |
+----------------------------+--------------+--------------------------------------+
| EXTRACTION                                                                       |
+----------------------------+--------------+--------------------------------------+
| extractor_id               | TEXT         | Which extractor produced this        |
| extraction_metadata        | JSONB        | Extraction context                   |
| observer_raw               | JSONB        | Raw observer data (username, etc.)   |
+----------------------------+--------------+--------------------------------------+
| STATE                                                                            |
+----------------------------+--------------+--------------------------------------+
| is_superseded              | BOOLEAN      | Replaced by newer observation        |
| is_processed               | BOOLEAN      | Analyzed by discovery engine         |
+----------------------------+--------------+--------------------------------------+
| METADATA                                                                         |
+----------------------------+--------------+--------------------------------------+
| created_at                 | TIMESTAMPTZ  | Record creation                      |
| updated_at                 | TIMESTAMPTZ  | Last modification                    |
+----------------------------+--------------+--------------------------------------+
```

### Relationships

```
vehicles 1 ----< * vehicle_observations
observation_sources 1 ----< * vehicle_observations
```

### Unique Constraint

Deduplication enforced by `content_hash` column. The `ingest-observation` function checks for existing records with the same hash before inserting.

---

## 10. listing_page_snapshots

The archive of every external page fetch. The raw HTML/markdown of every page the system has ever visited. This is the largest table by data volume (~79 GB).

### Schema

```
listing_page_snapshots
+----------------------------+--------------+--------------------------------------+
| Column                     | Type         | Purpose                              |
+----------------------------+--------------+--------------------------------------+
| id                         | UUID PK      | Unique snapshot identifier           |
| platform                   | TEXT         | Platform slug (bat, mecum, etc.)     |
| listing_url                | TEXT         | The URL that was fetched             |
| fetched_at                 | TIMESTAMPTZ  | When the fetch occurred              |
| fetch_method               | TEXT         | direct/firecrawl/proxy               |
| http_status                | INTEGER      | HTTP response status code            |
| success                    | BOOLEAN      | Whether fetch returned useful HTML   |
| error_message              | TEXT         | Error details (if failed)            |
| html                       | TEXT         | Full HTML content (may be NULL if    |
|                            |              | migrated to storage)                 |
| markdown                   | TEXT         | Markdown conversion (from Firecrawl) |
| html_sha256                | TEXT         | SHA-256 hash of HTML content         |
| content_length             | INTEGER      | HTML byte count                      |
| html_storage_path          | TEXT         | Path in listing-snapshots bucket     |
| markdown_storage_path      | TEXT         | Path in listing-snapshots bucket     |
| metadata                   | JSONB        | Caller name, cost_cents, etc.        |
| created_at                 | TIMESTAMPTZ  | Record creation                      |
+----------------------------+--------------+--------------------------------------+
```

### Unique Constraint

Duplicate detection via `(platform, listing_url, html_sha256)` -- if the same URL is fetched and the content hash matches an existing snapshot, the insert is silently rejected (23505 error code).

### Storage Migration

Large HTML content may be stored in the Supabase Storage `listing-snapshots` bucket rather than inline in the `html` column. The `html_storage_path` and `markdown_storage_path` columns point to the storage objects. The `archiveFetch()` and `readArchivedPage()` functions transparently handle both storage modes.

---

## 11. extraction_metadata

Provenance receipts for every field-level write to the `vehicles` table. Created by the Tetris write layer.

### Schema

```
extraction_metadata
+----------------------------+--------------+--------------------------------------+
| Column                     | Type         | Purpose                              |
+----------------------------+--------------+--------------------------------------+
| id                         | UUID PK      | Unique receipt identifier            |
| vehicle_id                 | UUID FK      | -> vehicles.id                       |
| field_name                 | TEXT         | Which field (e.g. "make", "vin")     |
| field_value                | TEXT         | What value was extracted             |
| extraction_method          | TEXT         | regex/table_parse/html_match/        |
|                            |              | url_slug/json_ld/etc.                |
| scraper_version            | TEXT         | Extractor function + version         |
|                            |              | (e.g. "extract-bat-core:3.0.0")     |
| source_url                 | TEXT         | Which listing URL provided this      |
| confidence_score           | DECIMAL      | 0.0-1.0 extraction confidence        |
| validation_status          | TEXT         | unvalidated/confirmed/conflicting    |
| extracted_at               | TIMESTAMPTZ  | When extraction occurred             |
| raw_extraction_data        | JSONB        | Additional context (source_signal,   |
|                            |              | tetris_version, etc.)                |
+----------------------------+--------------+--------------------------------------+
```

### Relationship

```
vehicles 1 ----< * extraction_metadata
(one vehicle has many extraction receipts, one per field per extraction pass)
```

### Deduplication

Before inserting a receipt, the Tetris layer checks if the last receipt for `(vehicle_id, field_name, source_url)` has the same `field_value`. If so, the insert is skipped to prevent redundant receipts.

---

## 12. bat_quarantine

Stores conflicting values that the Tetris write layer refuses to overwrite. Also stores whole-record rejections from the quality gate.

### Schema

```
bat_quarantine
+----------------------------+--------------+--------------------------------------+
| Column                     | Type         | Purpose                              |
+----------------------------+--------------+--------------------------------------+
| id                         | UUID PK      | Unique quarantine identifier         |
| vehicle_id                 | UUID FK      | -> vehicles.id (nullable for record  |
|                            |              | rejections)                          |
| listing_url                | TEXT         | Source of the conflict               |
| field_name                 | TEXT         | Which field (NULL = whole record)    |
| existing_value             | TEXT         | Current value in DB                  |
| proposed_value             | TEXT         | New value from extraction            |
| extraction_version         | TEXT         | Which extractor version              |
| quality_score              | DECIMAL      | Quality gate score                   |
| issues                     | TEXT[]       | Array of issue descriptions          |
| created_at                 | TIMESTAMPTZ  | Record creation                      |
+----------------------------+--------------+--------------------------------------+
```

### Relationship

```
vehicles 1 ----< * bat_quarantine
```

---

## 13. pipeline_registry

Queryable map of `table.column -> owning edge function`. An agent or developer can query this table to determine who owns a field, whether to write directly or call a function, and what valid values a field accepts.

### Schema

```
pipeline_registry
+----------------------------+--------------+--------------------------------------+
| Column                     | Type         | Purpose                              |
+----------------------------+--------------+--------------------------------------+
| id                         | UUID PK      | Unique entry identifier              |
| table_name                 | TEXT         | Database table name                  |
| column_name                | TEXT         | Column name (NULL = whole table)     |
| owned_by                   | TEXT         | Edge function name, 'system',        |
|                            |              | 'user', or 'extractor'               |
| description                | TEXT         | Human-readable description           |
| valid_values               | TEXT[]       | For enum-like columns                |
| do_not_write_directly      | BOOLEAN      | If true, call write_via instead      |
| write_via                  | TEXT         | Function to call for updates         |
| created_at                 | TIMESTAMPTZ  | Record creation                      |
| updated_at                 | TIMESTAMPTZ  | Last modification                    |
+----------------------------+--------------+--------------------------------------+

UNIQUE (table_name, column_name)
```

### Coverage

As of March 2026, pipeline_registry covers:
- 33 entries for `vehicles` columns
- 10 entries for `vehicle_images` columns
- 5 entries for `import_queue` columns
- 4 entries for `bat_extraction_queue` columns
- 6 entries for `document_ocr_queue` columns
- 4 entries for `vehicle_observations` columns
- 1 entry for `listing_page_snapshots` (whole table)

---

## 14. source_census

Point-in-time counts of what exists at each data source. Used for tracking coverage completeness.

### Schema

```
source_census
+----------------------------+--------------+--------------------------------------+
| Column                     | Type         | Purpose                              |
+----------------------------+--------------+--------------------------------------+
| id                         | UUID PK      | Unique census identifier             |
| source_id                  | UUID FK      | -> observation_sources.id            |
| universe_total             | INTEGER      | Total items at source                |
| universe_active            | INTEGER      | Currently live/active                |
| universe_historical        | INTEGER      | Completed/sold/archived              |
| census_method              | TEXT         | sitemap/api/pagination/rss/          |
|                            |              | estimate/manual                      |
| census_confidence          | DECIMAL(3,2) | 0.00-1.00 confidence in count       |
| census_url                 | TEXT         | URL/endpoint used to count           |
| census_notes               | TEXT         | Notes                                |
| census_at                  | TIMESTAMPTZ  | When census was taken                |
| census_duration_ms         | INTEGER      | How long counting took               |
| next_census_at             | TIMESTAMPTZ  | When to recount                      |
| by_year                    | JSONB        | Counts by year                       |
| by_make                    | JSONB        | Counts by make                       |
| by_category                | JSONB        | Counts by category                   |
| raw_response               | JSONB        | Raw census data                      |
| created_at                 | TIMESTAMPTZ  | Record creation                      |
+----------------------------+--------------+--------------------------------------+

UNIQUE (source_id, census_at)
```

### Relationship

```
observation_sources 1 ----< * source_census
```

---

## 15. coverage_targets

Defines what "complete" means for each source or source segment.

### Schema

```
coverage_targets
+----------------------------+--------------+--------------------------------------+
| Column                     | Type         | Purpose                              |
+----------------------------+--------------+--------------------------------------+
| id                         | UUID PK      | Unique target identifier             |
| source_id                  | UUID FK      | -> observation_sources.id            |
| segment_type               | TEXT         | all/make/year/year_range/category    |
| segment_value              | TEXT         | e.g. "Porsche", "1960-1970"          |
| target_coverage_pct        | DECIMAL(5,2) | Target coverage percentage           |
| target_freshness_hours     | INTEGER      | Max data age in hours                |
| target_extraction_hours    | INTEGER      | New item extraction SLA              |
| priority                   | INTEGER      | Resource allocation priority         |
| is_active                  | BOOLEAN      | Whether target is active             |
| notes                      | TEXT         | Notes                                |
| created_at                 | TIMESTAMPTZ  | Record creation                      |
| updated_at                 | TIMESTAMPTZ  | Last modification                    |
+----------------------------+--------------+--------------------------------------+

UNIQUE (source_id, segment_type, segment_value)
```

---

## 16. profiles

User accounts linked to Supabase Auth.

### Schema

```
profiles
+----------------------------+--------------+--------------------------------------+
| Column                     | Type         | Purpose                              |
+----------------------------+--------------+--------------------------------------+
| id                         | UUID PK FK   | -> auth.users.id                     |
| email                      | TEXT         | User email                           |
| full_name                  | TEXT         | Display name                         |
| avatar_url                 | TEXT         | Avatar image URL                     |
| bio                        | TEXT         | User biography                       |
| location                   | TEXT         | User location                        |
| website                    | TEXT         | User website                         |
| created_at                 | TIMESTAMPTZ  | Account creation                     |
| updated_at                 | TIMESTAMPTZ  | Last modification                    |
+----------------------------+--------------+--------------------------------------+
```

### Relationship

```
auth.users 1 ---- 1 profiles (auto-created via trigger)
profiles 1 ----< * vehicles (via user_id)
```

---

## 17. organizations

Dealers, shops, auction houses, builders, and other organizations that interact with vehicles.

### Key Relationship

```
organizations 1 ----< * vehicles (via organization_id)
```

Organizations are the actor layer in the knowledge graph. They represent businesses that sell, service, restore, or auction vehicles.

---

## 18. field_evidence

Part of the v3 extraction system. Stores evidence for individual extracted fields with source citations.

### Relationship

```
vehicles 1 ----< * field_evidence
```

As of March 2026: 107,887 field_evidence rows across vehicles extracted by the v3 extraction pipeline.

---

## 19. comment_discoveries

AI-extracted insights from auction comments. Generated by `discover-comment-data`.

### Relationship

```
vehicles 1 ----< * comment_discoveries
```

Contains: overall_sentiment, sentiment_score, themes, identified experts, market signals.

---

## 20. description_discoveries

AI-extracted fields from listing descriptions. Generated by `discover-from-descriptions`.

### Relationship

```
vehicles 1 ----< * description_discoveries
```

Contains: total_fields extracted, raw_extraction JSON, structured field catalog.

---

## 21. ER Diagram: Core Tables

```
+===========================================================================+
|                          CORE ENTITY RELATIONSHIPS                         |
+===========================================================================+

                          auth.users
                              |
                              | 1:1 (trigger)
                              v
                          profiles
                              |
                              | 1:*
                              v
  organizations 1----<* vehicles *>----1 vehicles
  (org_id)              |  |  |  |     (merged_into_vehicle_id)
                        |  |  |  |
            +-----------+  |  |  +-----------+
            |              |  |              |
            | 1:*          |  | 1:*          | 1:*
            v              |  v              v
    vehicle_images         |  vehicle_    auction_comments
                           |  events         |
                           |    |            | 1:* (self-ref)
                           |    | 1:*        v
                           |    v        auction_comments
                           | auction_    (parent_comment_id)
                           | events
                           |
            +--------------+--------------+
            |              |              |
            | 1:*          | 1:*          | 1:*
            v              v              v
    extraction_      bat_quarantine  vehicle_
    metadata                        observations
                                        |
                                        | *:1
                                        v
                                 observation_sources
                                        |
                            +-----------+-----------+
                            |                       |
                            | 1:*                   | 1:*
                            v                       v
                      source_census          coverage_targets

```

---

## 22. ER Diagram: Observation System

```
+===========================================================================+
|                       OBSERVATION SYSTEM ENTITIES                           |
+===========================================================================+

  observation_sources
  +-------------------+
  | id (PK)           |
  | slug (UNIQUE)     |
  | display_name      |
  | category          |
  | base_trust_score  |    1:*
  | supported_        +--------+
  |   observations    |        |
  +-------------------+        v
          |            vehicle_observations
          |            +------------------------+
          |   1:*      | id (PK)                |
          +----------->| vehicle_id (FK) -------+----> vehicles
                       | source_id (FK) --------+
                       | kind                   |
                       | observed_at            |
                       | content_hash (dedup)   |
                       | structured_data (JSON) |
                       | confidence             |
                       | confidence_score       |
                       | vehicle_match_         |
                       |   confidence           |
                       | vehicle_match_signals  |
                       +------------------------+

  observation_sources
          |
          | 1:*
          v
  source_census         coverage_targets
  +----------------+    +------------------+
  | source_id (FK) |    | source_id (FK)   |
  | universe_total |    | segment_type     |
  | census_method  |    | target_coverage  |
  | census_at      |    | priority         |
  +----------------+    +------------------+

```

---

## 23. ER Diagram: Extraction Pipeline

```
+===========================================================================+
|                      EXTRACTION PIPELINE ENTITIES                          |
+===========================================================================+

  import_queue                     listing_page_snapshots
  +-------------------+            +------------------------+
  | id (PK)           |            | id (PK)                |
  | listing_url (UQ)  +-- fetch -->| listing_url            |
  | source_id (FK) ---+            | platform               |
  | status            |            | html / html_storage    |
  | attempts          |            | markdown               |
  | priority          |            | html_sha256            |
  | locked_by         |            | success                |
  | vehicle_id (FK) --+            +------------------------+
  +-------------------+
          |
          | (on complete)
          v
      vehicles  --------> extraction_metadata
          |                +---------------------+
          |                | vehicle_id (FK)     |
          |                | field_name          |
          |                | field_value         |
          |                | scraper_version     |
          |                | source_url          |
          |                | confidence_score    |
          |                | validation_status   |
          |                +---------------------+
          |
          +--------------> bat_quarantine
                           +---------------------+
                           | vehicle_id (FK)     |
                           | field_name          |
                           | existing_value      |
                           | proposed_value      |
                           | issues              |
                           +---------------------+

  pipeline_registry (metadata, no FK relationships)
  +-------------------+
  | table_name        |
  | column_name       |
  | owned_by          |
  | do_not_write_     |
  |   directly        |
  | write_via         |
  +-------------------+

```

---

## 24. Cardinality Summary

| Relationship | Cardinality | FK Column | Notes |
|-------------|-------------|-----------|-------|
| profiles -> vehicles | 1:* | vehicles.user_id | Nullable (scraped vehicles have no user) |
| organizations -> vehicles | 1:* | vehicles.organization_id | Nullable |
| vehicles -> vehicle_images | 1:* | vehicle_images.vehicle_id | Typically 10-200 images per vehicle |
| vehicles -> vehicle_events | 1:* | vehicle_events.vehicle_id | Typically 1-5 events per vehicle |
| vehicles -> auction_events | 1:* | auction_events.vehicle_id | Typically 1-3 per vehicle |
| vehicles -> auction_comments | 1:* | auction_comments.vehicle_id | 0 to 2000+ per vehicle |
| auction_comments -> auction_comments | 1:* | parent_comment_id | Thread structure |
| vehicles -> vehicle_observations | 1:* | vehicle_observations.vehicle_id | Nullable (unresolved obs) |
| observation_sources -> vehicle_observations | 1:* | vehicle_observations.source_id | Required |
| observation_sources -> import_queue | 1:* | import_queue.source_id | Nullable |
| observation_sources -> source_census | 1:* | source_census.source_id | FK with CASCADE |
| observation_sources -> coverage_targets | 1:* | coverage_targets.source_id | FK with CASCADE |
| vehicles -> extraction_metadata | 1:* | extraction_metadata.vehicle_id | Many per vehicle (per field per pass) |
| vehicles -> bat_quarantine | 1:* | bat_quarantine.vehicle_id | Nullable (record rejections) |
| vehicles -> vehicles | 1:* | merged_into_vehicle_id | Self-referential (merge tracking) |
| import_queue -> vehicles | *:0..1 | import_queue.vehicle_id | Set on successful processing |
| vehicles -> comment_discoveries | 1:* | comment_discoveries.vehicle_id | AI analysis results |
| vehicles -> description_discoveries | 1:* | description_discoveries.vehicle_id | AI extraction results |
| vehicles -> field_evidence | 1:* | field_evidence.vehicle_id | v3 extraction evidence |

### Scale (March 2026)

| Table | Approximate Row Count |
|-------|----------------------|
| vehicles | ~18,000 |
| vehicle_images | ~1,000,000+ |
| vehicle_events | ~170,000 |
| auction_comments | ~364,000 |
| auction_events | ~50,000 |
| vehicle_observations | ~20,000 |
| listing_page_snapshots | ~200,000 (79 GB) |
| extraction_metadata | ~100,000+ |
| field_evidence | ~107,887 |
| import_queue | ~50,000+ |
| comment_discoveries | ~125,000 |
| description_discoveries | ~107 (only 107 AI-extracted) |
| observation_sources | ~30 |
