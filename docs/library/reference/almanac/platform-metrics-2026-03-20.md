# ALMANAC: Platform Metrics — 2026-03-20

**Snapshot date:** 2026-03-20
**Methodology:** Direct database queries against production

---

## Core Entity Counts

| Entity | Count | Notes |
|--------|-------|-------|
| Vehicles (active) | 292,060 | status='active' |
| Vehicles (sold) | 12,959 | status='sold' |
| Vehicles (total tracked) | 304,754 | active + sold (excludes merged/deleted) |
| Vehicles with price | 299,229 | sale_price > 0 |
| Vehicles with VIN | 221,021 | vin IS NOT NULL |
| Vehicles with description | 267,252 | description IS NOT NULL |
| Vehicle observations | 1,543,719 | All observations in unified store |
| Vehicle images | ~33,000,000 | Estimated from previous counts |
| Auction comments | ~11,500,000 | BaT + C&B + others |
| Import queue pending | 13 | Near-empty = healthy |

## Data Completeness

| Field | Populated | % of Active | Gap |
|-------|-----------|-------------|-----|
| Year + Make + Model | ~290,000 | ~99% | ~2K missing YMM |
| VIN | 221,021 | 76% | 71K missing |
| Sale price | 299,229 | 98%+ | Minimal |
| Description | 267,252 | 91% | 25K missing |
| Equipment | ~75,000 | ~26% | **229K missing** |
| Highlights | ~76,000 | ~26% | **228K missing** |
| Known flaws | ~62,000 | ~21% | **243K missing** |
| Modifications | ~75,000 | ~26% | **229K missing** |
| Condition rating | ~45,000 | ~15% | 247K missing |
| Completion % > 60 | 184,865 | 63% | 107K below 60% |

## Squarebody Segment (1973-1991 GM Trucks)

| Metric | Value |
|--------|-------|
| Total vehicles | 4,062 |
| With prices | 3,790 |
| Average price | $25,283 |
| Total images | 457,050 |
| Total comments | 88,186 |
| Unique models | 50+ variants |
| Price range | $1,000 - $227,700 |
| Most common model | Chevrolet C10 (365) |
| Highest avg price | K5 Blazer Cheyenne 4x4 ($37,781) |

## Top Cohorts by Volume

| Cohort | Count | Avg Price | Avg Comments |
|--------|-------|-----------|--------------|
| Chevrolet Corvette | 6,484 | $69,278 | 52 |
| Ford Mustang | 2,819 | $47,897 | 59 |
| Chevrolet Camaro | 2,406 | $54,250 | 54 |
| Ford Thunderbird | 1,706 | $30,031 | 41 |
| Ford Bronco | 1,424 | $67,043 | 45 |
| Chevrolet C10 | 1,205 | $35,958 | 38 |
| Mercedes-Benz SL500 | 1,168 | $17,112 | 44 |
| Chevrolet Chevelle | 1,126 | $62,536 | 61 |
| Volkswagen Beetle | 1,060 | $18,065 | 60 |
| BMW M5 | 1,049 | $31,756 | 77 |

## Infrastructure

| Component | Count/Status |
|-----------|-------------|
| Edge functions deployed | ~394 (target: 50) |
| Cron jobs active | ~112 (target: 50) |
| Database size | ~156 GB |
| listing_page_snapshots | ~79 GB |
| Tables total | ~1,013 (483 empty) |
| Pipeline registry entries | 63 |

## Cost Metrics

| Resource | Current | Notes |
|----------|---------|-------|
| Supabase monthly | ~$1,500-2,000 | Post-triage (was $5,600) |
| Modal monthly | Variable | Pay-per-second, ~$50-200/month active |
| Anthropic API | Variable | Haiku $1/$5 MTok, Sonnet $3/$15, Opus $15/$75 |
| Local inference (Ollama) | $0 | M4 Max, ~40W |

## Data Quality

| Metric | Value |
|--------|-------|
| Data quality scored vehicles | 99.94% |
| Observations with vehicle_id | 100% (0 unresolved) |
| Vehicles merged (dedup) | ~48,000 |
| Field evidence rows | ~146,000 |
| Comment discoveries (Haiku quality) | 2,751 |
| Comment discoveries (programmatic) | 123,000 |

## LLM Infrastructure

| Model | Size | Location | Status |
|-------|------|----------|--------|
| nuke (DeepSeek R1 + prompt) | 19.9 GB | SSD | Live |
| deepseek-r1:32b | 19.9 GB | SSD | Live |
| qwen3:30b-a3b | 18.6 GB | SSD | Live |
| qwen2.5:7b | 4.7 GB | SSD | Live (comment mining) |
| nuke-agent (fine-tuned) | ~5 GB | Modal (training) | In progress |

## Phase 0 Status

| Phase | Status | Details |
|-------|--------|---------|
| 0.1 Single Write Path | Incomplete | Extractors still bypass ingest-observation |
| 0.2 Entity Resolver | Working | 0 unresolved observations |
| 0.3 Audit Trail | **Done** | agent_tier, extraction_method, raw_source_ref added |
| 0.4 Schema-Code Mismatch | **Done** | CHECK constraint includes all status values |

---

*Next snapshot should be taken after the A100 reconciliation blast and Phase 0.1 completion.*
