# Pre-mint memo: the platform entity (2026-10-07)

**Status:** proposal, docs only. Nothing here is applied. Lead session skylar-64, written 11:52Z from read-only production
reads between 11:40Z and 11:55Z (`scripts/data/q.sh`; samples are `TABLESAMPLE SYSTEM` with `REPEATABLE (20261007)`).
Follows the place-entity memo (`2026-10-07-place-entity.md`) and its declaration (migration 20261007210000).

**Recommendation: do not mint.** Declare `observation_sources` as the platform entity in `stack_substrates`
('platform entity', missing in S25, S46 and SC). Before any key is added, give the entity the spellings the writers
already emit (`bringatrailer`, `barrettjackson`, `classiccars`, `user-submission`), as rows or as an alias column,
then key the five text platform columns to it NOT VALID. Treat `source_registry` and `live_auction_sources` as
configuration tables that key to the entity, not as the entity.

## The need

- `v_stacks` (11:40Z): 'platform entity' is missing in **3 of 65 stacks** (S25 venue close clocks, S46 cross-platform
  people, SC the platform page); the substrate note names `source_registry` and `live_auction_sources` as candidates.
- Case ledger C7 (2026-10-06) found `vehicles.platform_source` NULL on new rows and fixed the writers; it said the
  platform entity exists because "slug matches the column's main values". Measured below, that is true of
  `observation_sources`, not of `source_registry`.

## The seven questions

### 1. Search before mint: candidates read, no fit proven?

Four tables already name platforms. None was declared.

| Table | Rows | Key | Keys in | Code files on main | What it is |
|---|---|---|---|---|---|
| `observation_sources` | 192 | PK id, UNIQUE slug | 7 (incl. `vehicle_observations.source_id`) | 64 (`ingest`, `api-v1-*`, `extract-bat-core`, `_shared`) | Every source an observation can come from: 13 categories (registry 37, marketplace 30, auction 27, dealer 16, internal 15, forum 13, documentation 13, shop 13, social_media 11, owner 10, aggregator 5, museum 1, agent 1); trust and decay fields; written through `add_source` proposals. 5 of 22 columns described. |
| `source_registry` | 97 | PK id, UNIQUE slug | 0 | 7 | Extraction configuration per scraped site (extractor function, success rates, discovery). 7 of 30 described. |
| `scrape_sources` | 548 | PK id, UNIQUE url | 4 (`import_queue`, `source_intelligence`, `extractor_registry`) | 37 | Scrape targets by URL (sites, houses, dealers). 1 of 26 described. |
| `live_auction_sources` | 18 | PK id, UNIQUE slug | 1 (`monitored_auctions`) | 4 | Live-sync configuration for auction platforms. 0 of 41 described. |

**How the text platform columns match each slug set** (sampled 11:50Z):

| Column | Sampled with a value | matches `observation_sources.slug` | matches `source_registry.slug` | matches `live_auction_sources.slug` |
|---|---|---|---|---|
| `vehicles.platform_source` (1%) | 8,421 (32 distinct) | 5,673 (67%) | 4,152 (49%) | 1,606 |
| `vehicle_events.source_platform` (1%) | 4,135 (31) | 3,757 (91%) | 926 | 3,287 |
| `auction_comments.platform` (0.1%) | 19,929 (2) | 19,929 (100%) | 0 | 19,907 |
| `external_listings.platform` (5%) | 6,791 (8) | 5,557 (82%) | 325 | 5,510 |
| `vehicle_location_observations.source_platform` (1%) | 5,098 (16) | 4,914 (96%) | 676 | 4,345 |

`observation_sources` fits: it is the most keyed, the most read, the one the writers' spellings already match, and the one
the proposal path writes. **No new table is earned.**

### 2. Observations first?
A platform is a dimension that observations key to (`vehicle_observations.source_id` already does), not testimony.
What a platform *does* (fees, close rules, volume) is testimony about the platform and lands as observations keyed to it.

### 3. DNA
`observation_sources` has slug (UNIQUE), display_name, category (a Postgres enum: the 13 values above), base_url,
url_patterns, trust fields (base_trust_score, veracity, consecration, decay_half_life_days, tier), coverage arrays
(makes, years, regions), created_at/updated_at. Missing for the entity role: an **alias** list (the spellings writers
emit) and a **parent** key (a house's several platforms: `bonhams` and `themarket-bonhams`; `dupont-registry` and
`dupontregistry`). The declaring migration should add nothing until the alias question is decided (Q4).

### 4. View or supersession; the alias decision
- A view cannot be a substrate (`stack_coverage()` measures a declared table through `v_schema_atlas`).
- **Spelling variants are the whole mismatch.** Unmatched values in the samples: `vehicles.platform_source`
  `bringatrailer` 2,039 (the slug is `bat`), `classiccars` 351 (`classiccars-com`), `unknown` 242,
  `user-submission` 80 (`agent-submission` exists), `correct_vehicle_sale_provenance` 14 (a writer name, not a
  platform), `facebook` 8; `external_listings.platform` `barrettjackson` 1,228 (`barrett-jackson`);
  `vehicle_events.source_platform` `barrettjackson` 270, `unknown` 32, and about 20 house names written as display
  names (`Beverly Hills Car Club`, `L'Art de l'Automobile`, `kruse`, `coys`, `leake` ...).
- `observation_sources` already holds five separator variants as separate rows (`broad-arrow`/`broad_arrow`,
  `cars-and-bids`/`cars_and_bids`, `classic-driver`/`classicdriver`, `dupont-registry`/`dupontregistry`,
  `er-classics`/`erclassics`). The house rule (toolbox adjudication, 2026-10-05): duplicates are fine, shop-clean them,
  never mint a prevention mechanism. So the cheapest honest step is **rows for the missing spellings** through the
  existing `add_source` proposal path (`bringatrailer`, `barrettjackson`, `classiccars`, `user-submission`,
  `facebook`), each noting its canonical sibling, and a later fold that resolves siblings to one platform
  (`parent_id` or an alias column) when a reader needs the house grain. Correcting a writer's spelling is a
  supersession of its future rows, never a rewrite of stored ones.
- `unknown` and writer names (`correct_vehicle_sale_provenance`) are not platforms: they stay unmatched under a
  NOT VALID key and the writers that emit them get fixed.

### 5. Invariants
- NOT VALID foreign keys from the five text columns to `observation_sources(slug)`, added **after** the alias rows,
  one table per migration (`vehicles` is 1,000,000+ rows and hot; the key costs one index probe per write).
- Attack tests (PG17 contracts): a new row with an unknown platform refused; stored unmatched rows kept and still
  writable on other columns; a platform delete refused while referenced; the alias rows admitted; the declaration row.

### 6. Writers and registry
- `observation_sources` is written by `fn_schema_proposal_apply` (add_source proposals) and by migrations; its
  `pipeline_registry` row must say so and name the alias rule.
- The five text columns keep their writers (`extract-bat-core`, `ingest`, the house extractors); the key refuses only
  an unknown spelling, so each writer's emitted value must be in the table before its key is added (measure per writer
  from `write_receipts` and the sampled values above).
- `source_registry` and `live_auction_sources`: add `observation_source_id` keys to the entity (`source_registry`
  already has an `observation_source_id` column; its fill is Unknown, to read).

### 7. Migration
One declaring migration (stack_substrates 'platform entity' = observation_sources, registry row, comments for the 17
undescribed columns, the alias rows if not already proposed), then one key migration per text column, each with its
contract; RLS: `observation_sources` policies to read before any public page relies on it (Unknown here).

## What the declaration would move
- S25 0/2 → 1/2 (its other need is `vehicle_events.ended_at`, partial); S46 0/2 → 1/2 (other need
  `cross-platform person identity`); SC 1/5 → 2/5 (`place entity` present since 11:33Z; S12 still missing; two
  partial clocks). Substrates declared 1 → 2 of 61.
- The real value is the keys: a platform page (SC) and venue close clocks (S25) can only be computed when
  `vehicles`, `vehicle_events`, `external_listings` and `auction_comments` resolve to one platform row.

## Decision asked
Approve: (1) alias rows for the five missing spellings through `add_source` proposals (owner approves proposals);
(2) the declaring migration; (3) the keys, one table at a time, after the per-writer read. Nothing minted.
