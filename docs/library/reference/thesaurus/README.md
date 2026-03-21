# NUKE THESAURUS

When someone says X, they might mean Y. This maps the vocabulary of conversation to the vocabulary of the system.

---

## Data Entry

| They Say | They Mean | System Term | Where It Lives |
|----------|-----------|-------------|----------------|
| "import" | get data into the system | intake | `ingest-observation` |
| "import queue" | the pipeline that processes incoming data | intake → extract → resolve → observe | `import_queue` table (legacy), becoming `ingest-observation` |
| "extract" | pull structured data from raw source | extraction | domain-specific extractors → `ingest-observation` |
| "scrape" | fetch a web page and extract from it | archive fetch + extraction | `archiveFetch()` → extractor |
| "command S" | save this URL/page for processing | intake | single intake endpoint |
| "ingest" | accept raw data into the system | intake | `ingest-observation` |
| "parse" | extract structured fields from raw text | extraction | LLM schema fill or HTML parse |
| "OCR" | extract text from images/scans | extraction (image-to-text variant) | OCR pipeline |
| "dump" | bulk raw data insertion | batch intake | batched `ingest-observation` calls |

## Data Matching

| They Say | They Mean | System Term | Where It Lives |
|----------|-----------|-------------|----------------|
| "merge" | combine two records that represent the same thing | entity resolution | universal matcher |
| "dedup" | find and merge duplicates | entity resolution + deduplication | `dedup-vehicles`, becoming universal matcher |
| "match" | link an observation to the right entity | entity resolution | universal matcher |
| "link" | connect an observation to an entity | entity resolution | `ingest-observation` vehicle resolution |
| "fuzzy match" | match on incomplete/approximate data | low-confidence entity resolution | universal matcher (below 0.80 = candidate only) |

## Data Quality

| They Say | They Mean | System Term | Where It Lives |
|----------|-----------|-------------|----------------|
| "trust" | how reliable is this data point | confidence score × source trust | observation metadata |
| "confidence" | how sure are we about a specific value | confidence score (0-1) | `vehicle_observations.confidence_score` |
| "provenance" (data) | where did this data point come from | audit trail | observation source_id + agent_tier + timestamp |
| "provenance" (asset) | who owned this thing and when | provenance chain | `provenance_entries` |
| "citation" | proof that a data point is real | evidence (5th dimensional shadow) | `field_evidence`, observation `raw_source_ref` |
| "broken data" | data that's wrong, mismatched, or incomplete | low confidence observations + entity resolution errors | audit trail reveals cause |

## Entities

| They Say | They Mean | System Term | Where It Lives |
|----------|-----------|-------------|----------------|
| "vehicle" | a car/truck/motorcycle tracked by the system | asset (type: vehicle) | `vehicles` table → `assets` registry |
| "artwork" | a painting/sculpture/print tracked by the system | asset (type: artwork) | `artworks` table → `assets` registry |
| "artist" | a person who creates artworks | user (with artist_profiles extension) | `users` + `artist_profiles` |
| "gallery" | a business that shows/sells art | organization (type: gallery) | `organizations` |
| "collector" | a person who owns assets | user (with ownership traces in provenance) | `users` + `provenance_entries` |
| "dealer" | a person/org that buys and sells assets | user or org (with transaction traces) | context-dependent |
| "handler" | a person who physically manages assets | user with org_staff role | `org_staff` |
| "magazine" | a publication that validates through editorial selection | observation source (type: publisher_magazine) | `observation_sources` |
| "edition" | a set of identical artwork copies | edition parent + child assets | `edition_parents` + individual `artworks` |

## Architecture

| They Say | They Mean | System Term | Where It Lives |
|----------|-----------|-------------|----------------|
| "the graph" | the complete network of entity relationships | knowledge graph | the database itself (Postgres) |
| "the pipeline" | data flow from raw to structured | intake → extract → resolve → observe | multiple functions, becoming 5 MCP tools |
| "schema" | the structure that data fills | domain ontology | table definitions, extraction schemas |
| "digital twin" | complete data representation of a physical thing | asset with five dimensional shadows | all tables connected to an asset_id |
| "observation" | any piece of data from any source | the fundamental data unit | `vehicle_observations` (becoming `asset_observations`) |
| "signal" | computed indicator of activity/quality/trajectory | signal score | materialized view from weighted observations |
| "badge" | clickable data token in the UI | UI element | frontend component |
| "portal" | what a badge becomes when clicked | drill-through interaction | frontend interaction pattern |

## Processes

| They Say | They Mean | System Term | Where It Lives |
|----------|-----------|-------------|----------------|
| "extraction" | getting structured data from unstructured sources | the entire intake → observe pipeline | multiple systems |
| "validation" | confirming data is correct | discrepancy detection, cross-source corroboration | observation confidence + conflict detection |
| "enrichment" | adding more data to an existing entity | new observations on existing entity | `ingest-observation` with resolved entity |
| "backfill" | adding missing data to old records | historical extraction / migration | batch processing |
| "discovery" | finding new entities or connections | nose machine — recursive lead finding | `discovery-snowball` |
| "analysis" | AI processing of observations | brain machine — LLM inference on data | `analysis-engine-coordinator` |
| "valuation" | computing what an asset is worth | Nuke Estimate | `nuke_estimate` column, valuation functions |

## Common Confusions

| Confusion | Clarification |
|-----------|---------------|
| "observation" vs "event" | An observation is any data point. An event is a specific type of observation that happened at a time (auction, exhibition, sale). All events are observations. Not all observations are events. |
| "source" vs "origin" | Source = the observation_source (BaT, Christie's). Origin = where the physical asset came from (factory, artist's studio). |
| "trust" vs "confidence" | Trust = how reliable the source is in general (BaT = 0.85). Confidence = how reliable this specific observation is (0-1, considers match quality, content substance). |
| "provenance" (two meanings) | Data provenance = where did this data point come from (audit trail). Asset provenance = who owned this physical thing (chain of custody). Both use the same word. Context determines which. |
| "merge" vs "match" | Match = determine that two records refer to the same entity. Merge = actually combine them. Match can fail safely. Merge is destructive and must be confident. |
| "schema" vs "ontology" | Schema = the database tables and columns. Ontology = the conceptual model of what can be true. The schema implements the ontology. At sufficient detail, they're the same thing. |
