# Pipeline Architecture

## The Extraction Pipeline: Agents, Routing, Quality, and Cost

This document describes the complete extraction pipeline: how raw HTML becomes structured vehicle data through a hierarchy of AI agents, domain-specific parsers, quality gates, and provenance tracking.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [The Agent Tier System](#2-the-agent-tier-system)
3. [Processor Selection and Routing](#3-processor-selection-and-routing)
4. [Platform-Specific Extractors](#4-platform-specific-extractors)
5. [The Haiku Extraction Worker](#5-the-haiku-extraction-worker)
6. [Escalation Logic](#6-escalation-logic)
7. [The Quality Gate Pipeline](#7-the-quality-gate-pipeline)
8. [The Pollution Detector](#8-the-pollution-detector)
9. [Vehicle Normalization](#9-vehicle-normalization)
10. [The Tetris Provenance Write Layer](#10-the-tetris-provenance-write-layer)
11. [Retry and Backoff Strategy](#11-retry-and-backoff-strategy)
12. [Cost Model](#12-cost-model)
13. [Extraction Metrics and Monitoring](#13-extraction-metrics-and-monitoring)
14. [The Approved Extractor Registry](#14-the-approved-extractor-registry)
15. [Pipeline Registry](#15-pipeline-registry)
16. [End-to-End Pipeline Diagram](#16-end-to-end-pipeline-diagram)

---

## 1. Architecture Overview

The extraction pipeline is a multi-layer system that progressively refines raw web content into structured, validated vehicle data. The layers are:

```
Layer 1: FETCH         archiveFetch() -- get HTML, cache it
Layer 2: PARSE         Platform parsers -- regex, DOM patterns
Layer 3: AI EXTRACT    Agent tiers -- Haiku/Sonnet/Opus
Layer 4: NORMALIZE     normalizeVehicleFields() -- canonical values
Layer 5: VALIDATE      qualityGate() -- reject garbage
Layer 6: DETECT        pollutionDetector -- catch contamination
Layer 7: RESOLVE       resolveExistingVehicleId() -- find or create
Layer 8: WRITE         batchUpsertWithProvenance() -- Tetris layer
Layer 9: ARCHIVE       extraction_metadata + bat_quarantine
```

Not every extraction passes through every layer. Platform-specific extractors (BaT, Mecum, etc.) handle Layers 1-2 with regex/DOM parsing and may skip Layer 3 entirely. The generic AI extractor (`extract-vehicle-data-ai`) relies heavily on Layer 3. All extractors converge at Layers 4-9.

---

## 2. The Agent Tier System

The AI extraction hierarchy uses three Claude model tiers, each optimized for different tasks and cost profiles.

### 2.1 Tier Configuration (`_shared/agentTiers.ts`)

```
+=========================================================================+
|  TIER  |  MODEL                     | INPUT  | OUTPUT | TIMEOUT | TEMP  |
+========+============================+========+========+=========+=======+
| Haiku  | claude-haiku-4-5-20251001  | $1/MTok| $5/MTok| 30s     | 0.0   |
| Sonnet | claude-sonnet-4-6          | $3/MTok|$15/MTok| 60s     | 0.1   |
| Opus   | claude-opus-4-6            | $5/MTok|$25/MTok| 120s    | 0.2   |
+=========================================================================+
```

### 2.2 Tier Responsibilities

**Haiku** -- The workhorse. Handles 90%+ of extractions.
- Field extraction from HTML/markdown
- VIN parsing
- Simple classification (auction type, vehicle category)
- Price parsing
- Date extraction
- Listing title parsing into year/make/model
- Batch title parsing (up to 20 per call)

**Sonnet** -- The supervisor. Handles edge cases and quality review.
- Quality review of Haiku extractions
- Edge case resolution (unusual formats, ambiguous data)
- Multi-field consistency validation
- Description analysis for hidden details
- Escalation decisions
- Batch result aggregation

**Opus** -- The strategist. Handles system-level intelligence.
- Source prioritization strategy
- Market intelligence synthesis
- YONO retraining decisions
- Extraction pipeline optimization
- Cross-source deduplication strategy

### 2.3 The `callTier()` Function

All AI calls go through `callTier()`:

```typescript
callTier(tier: AgentTier, systemPrompt: string, userMessage: string, options?)
  -> AgentCallResult {
       content: string,        // LLM response text
       tier: AgentTier,        // which tier was used
       model: string,          // exact model identifier
       inputTokens: number,    // tokens consumed
       outputTokens: number,   // tokens generated
       costCents: number,      // calculated cost (4 decimal places)
       durationMs: number,     // wall clock time
       stopReason: string      // end_turn/max_tokens/etc.
     }
```

The function:
1. Reads `ANTHROPIC_API_KEY` from environment
2. Selects model configuration from `TIER_CONFIGS`
3. Calls `https://api.anthropic.com/v1/messages` with the appropriate model
4. Calculates cost from token usage and tier pricing
5. Returns structured result with full cost tracking

### 2.4 Vision Support (`callTierVision()`)

For image analysis tasks, `callTierVision()` extends `callTier()` with image content:

```typescript
callTierVision(tier, systemPrompt, textMessage, imageUrls, options?)
```

This function:
1. Fetches each image URL
2. Converts to base64
3. Builds a multi-content message (images + text)
4. Calls the Anthropic API with image content blocks
5. Falls back gracefully if image download fails (skips that image)

### 2.5 JSON Response Parsing

LLM responses often contain JSON wrapped in markdown or with extraneous text. `parseJsonResponse()` handles this:

```
Attempt 1: JSON.parse(raw)
    |
    | (fails)
    v
Attempt 2: Extract from ```json ... ``` code block
    |
    | (fails)
    v
Attempt 3: Find first { ... } or [ ... ] in text
    |
    | (fails)
    v
Throw Error("Failed to parse JSON from LLM response")
```

### 2.6 Task Classification

`classifyTaskTier()` determines the appropriate tier for a given task:

```
Task Type                          -> Tier
-------------------------------------------
source_prioritization              -> Opus
market_intelligence                -> Opus
pipeline_optimization              -> Opus
yono_retraining_decision           -> Opus
cross_source_dedup_strategy        -> Opus
quality_review                     -> Sonnet
edge_case_resolution               -> Sonnet
batch_aggregation                  -> Sonnet
description_deep_analysis          -> Sonnet
escalation_decision                -> Sonnet
multi_field_validation             -> Sonnet
previousFailures >= 2              -> Sonnet
isEdgeCase == true                 -> Sonnet
(everything else)                  -> Haiku
```

---

## 3. Processor Selection and Routing

Two routing systems coexist in the codebase.

### 3.1 Simple URL-Pattern Router (`process-import-queue`)

The primary production router. Uses normalized URL string matching:

```
URL contains "bringatrailer.com"        -> complete-bat-import
URL contains "carsandbids.com"          -> extract-cars-and-bids-core
URL contains "pcarmarket.com"           -> import-pcarmarket-listing
URL contains "hagerty.com"              -> extract-hagerty-listing
URL contains "classic.com"              -> import-classic-auction
URL contains "collectingcars.com"       -> extract-vehicle-data-ai
URL contains "barnfinds.com"            -> extract-barn-finds-listing
URL contains "craigslist.org"           -> extract-craigslist
URL contains "mecum.com"               -> extract-mecum
URL contains "barrett-jackson.com"      -> extract-barrett-jackson
URL contains "broadarrowauctions.com"   -> extract-broad-arrow
URL contains "gaaclassiccars.com"       -> extract-gaa-classics
URL contains "bhauction.com"            -> extract-bh-auction
URL contains "bonhams.com"             -> extract-bonhams
URL contains "rmsothebys.com"          -> extract-rmsothebys
URL contains "goodingco.com"           -> extract-gooding
URL contains specialty builders         -> extract-specialty-builder
(fallback)                              -> extract-vehicle-data-ai
```

Every extractor is called via internal HTTP POST:
```
POST {SUPABASE_URL}/functions/v1/{function_name}
Headers: Authorization: Bearer {SERVICE_ROLE_KEY}
Body: { url, save_to_db: true }
Timeout: 120 seconds
```

### 3.2 Smart Processor Selector (`_shared/select-processor.ts`)

A more sophisticated routing system that considers source metadata, raw_data fields, and returns priority-ordered selections. Notable behaviors:

- **BaT**: Routes to `process-bat-from-import-queue` orchestrator (two-step: extract-bat-core + extract-auction-comments)
- **BHCC**: Routes to dedicated `process-bhcc-queue`
- **Classic.com**: Routes to `import-classic-auction`
- **Dealer inventory**: Routes based on `organization_id` in raw_data
- **Unknown sources**: Falls back to `process-import-queue` with lowest priority (10)

---

## 4. Platform-Specific Extractors

Each major auction/marketplace platform has a dedicated extractor that understands its HTML structure, data format, and edge cases.

### 4.1 Extractor Inventory

| Function | Platform | Method | Key Features |
|----------|----------|--------|-------------|
| `extract-bat-core` (v3.0.0) | Bring a Trailer | Direct HTML + regex | Essentials block parsing, stats table parsing, URL slug identity, 50KB window limit to prevent comment pollution |
| `extract-cars-and-bids-core` | Cars & Bids | Firecrawl + parse | React SPA rendering via Firecrawl |
| `import-pcarmarket-listing` | PCarMarket | Firecrawl + parse | React SPA rendering |
| `extract-hagerty-listing` | Hagerty Marketplace | Direct + parse | Standard HTML parsing |
| `import-classic-auction` | Classic.com | Direct + parse | Auction house format |
| `extract-mecum` | Mecum Auctions | Direct + parse | Multi-lot format |
| `extract-barrett-jackson` | Barrett-Jackson | Firecrawl | Cloudflare-protected, React |
| `extract-bonhams` | Bonhams | Firecrawl | Next.js SPA, lot format |
| `extract-rmsothebys` | RM Sotheby's | Direct + parse | High-end auction format |
| `extract-gooding` | Gooding & Co. | Direct + parse | Boutique auction format |
| `extract-broad-arrow` | Broad Arrow | Direct + parse | RM subsidiary |
| `extract-craigslist` | Craigslist | Direct + parse | Classified format |
| `extract-barn-finds-listing` | BarnFinds.com | Direct + parse | Blog/listing hybrid |
| `extract-gaa-classics` | GAA Classic Cars | Direct + parse | Regional auction format |
| `extract-bh-auction` | BH Auction | Direct + parse | Regional auction format |
| `extract-specialty-builder` | Multiple builders | Direct + parse | Velocity, Cool&Vintage, etc. |
| `extract-vehicle-data-ai` | Universal fallback | archiveFetch + AI | Generic LLM extraction |

### 4.2 BaT Extractor Deep Dive

The BaT extractor (`extract-bat-core` v3.0.0) is the most complex. Its parsing pipeline:

```
HTML
 |
 +--> extractTitleIdentity()
 |    - <h1 class="post-title"> -> cleanBatTitle()
 |    - <meta property="og:title"> -> cleanBatTitle()
 |    - <title> -> cleanBatTitle()
 |    - URL slug: /listing/YEAR-MAKE-MODEL-HASH/
 |      parseBatIdentityFromUrl()
 |      - Multi-word make detection: alfa->Alfa Romeo,
 |        mercedes->Mercedes-Benz, land->Land Rover,
 |        aston->Aston Martin
 |      - Strip trailing hash numbers from model
 |
 +--> extractEssentials()
 |    CRITICAL: 50KB window from <div class="essentials"> to prevent
 |    comment pollution. Comments start after ~20-30KB.
 |
 |    Parsing targets:
 |    - Seller: <strong>Seller</strong>: <a href="/member/...">name</a>
 |    - Buyer: Stats table "Sold to" row
 |    - Location: <strong>Location</strong>: <a>city, state</a>
 |    - Lot: <strong>Lot</strong> #12345
 |    - Category: <strong class="group-title-label">Category</strong>
 |    - Reserve: Scoped to essentials + title text only
 |      "no-reserve" / "No Reserve" -> no_reserve
 |      "Reserve Not Met" -> reserve_not_met
 |      "Reserve Met" -> reserve_met
 |
 |    Stats Table (<table id="listing-bid">):
 |    - "Sold" row -> sale price + buyer
 |    - "Winning Bid" row -> sale price + buyer
 |    - "High Bid" row -> high bid amount
 |    - "Current Bid" row -> current bid amount
 |
 |    Price parsing (parseMoney):
 |    - Strip commas, normalize whitespace
 |    - k/m suffix multipliers ONLY if base < 1000/100
 |    - Reject values > $100M
 |
 +--> extractDescription()
 |    - Full listing body text
 |    - Gallery images (normalized URLs: strip -scaled, -WxH)
 |
 +--> normalizeVehicleFields()
 +--> qualityGate()
 +--> resolveExistingVehicleId()
 +--> batchUpsertWithProvenance()
 +--> Write vehicle_events, auction_events, vehicle_images
```

---

## 5. The Haiku Extraction Worker

The `haiku-extraction-worker` is the generic AI extraction engine. It processes items from `import_queue` using Claude Haiku for cost-efficient extraction.

### 5.1 Actions

| Action | Purpose | Input |
|--------|---------|-------|
| `extract_listing` | Extract all vehicle data from page content | `{html, markdown, url}` |
| `parse_title` | Parse a single listing title into year/make/model | `{title}` |
| `parse_titles` | Batch parse multiple titles (chunks of 20) | `{titles[]}` |
| `extract_fields` | Extract specific fields from text | `{text, fields[]}` |
| `batch_extract` | Process batch from import_queue | `{batch_size, source}` |

### 5.2 Extraction Flow

```
batch_extract(batch_size, source?)
       |
       v
  1. Claim items from import_queue
     WHERE status='pending' AND locked_by IS NULL
     ORDER BY priority DESC, created_at ASC
     LIMIT batch_size
       |
       v
  2. Lock items (status='processing', locked_by=worker_id)
       |
       v
  3. For each item:
     +-- Try archived content first
     |   SELECT html, markdown FROM listing_page_snapshots
     |   WHERE listing_url = item.listing_url
     |   ORDER BY fetched_at DESC LIMIT 1
     |
     +-- If archived content available (> 200 chars):
     |   extractListing(content, url, contentType)
     |     |
     |     v
     |   callTier('haiku', LISTING_EXTRACTION_SYSTEM, content)
     |     |
     |     v
     |   parseJsonResponse() -> assessQuality()
     |
     +-- If only title available:
     |   parseTitle(title)
     |   -> needsEscalation = true (title_only)
     |
     +-- If nothing available:
         -> needsEscalation = true (no_content_no_title)
       |
       v
  4. Route by quality:
     score >= 0.9 (AUTO_APPROVE_THRESHOLD)
       -> status='complete', auto_approved=true
     score < 0.6 (ESCALATION_THRESHOLD) OR no YMM OR low confidence
       -> status='pending_review', escalation_reason=...
     0.6 <= score < 0.9
       -> status='pending_review', needs_supervisor_review=true
       |
       v
  5. Store haiku results in import_queue.raw_data:
     {
       haiku_extraction: {year, make, model, ...},
       haiku_quality: {score, fieldsExtracted, nullFields, issues},
       haiku_cost: {inputTokens, outputTokens, costCents, durationMs},
       escalation_reason: "...",
       haiku_processed_at: "..."
     }
```

### 5.3 Extraction Prompt

The listing extraction system prompt instructs Haiku to:
1. Extract ONLY what is explicitly stated (never infer)
2. Parse formatted prices to numbers
3. Parse mileage with "TMU" handling
4. Validate VINs (exactly 17 characters)
5. Normalize make names
6. Extract ALL vehicle image URLs (skip logos, avatars, ads)
7. Return null for uncertain fields
8. Include self-assessed confidence (0.0-1.0)

Output schema: year, make, model, trim, vin, mileage, mileage_unit, exterior_color, interior_color, engine, transmission, drivetrain, body_style, title_text, sale_price, asking_price, sale_status, auction_end_date, seller_name, seller_location, description (500 chars), image_urls, source_platform, confidence, extraction_notes.

### 5.4 Quality Assessment

The quality assessor evaluates 15 key fields:

```
KEY_FIELDS = [
  year, make, model, vin, mileage, exterior_color,
  engine, transmission, sale_price, asking_price,
  seller_location, description, image_urls,
  sale_status, title_text
]

score = 1.0 - (null_field_count / 15)
      - (validation_issues * 0.1)
      + (has_YMM ? 0.15 : 0)
      + (has_price ? 0.05 : 0)

Clamped to [0, 1]
```

---

## 6. Escalation Logic

When Haiku extraction produces low-quality results, the item is escalated for higher-tier processing.

### 6.1 Escalation Triggers

```
+---------------------------------------+---------------------------+
| Trigger                               | Escalation Reason         |
+---------------------------------------+---------------------------+
| quality_score < 0.6                   | low_quality_score:0.XX    |
| No year AND no make AND no model      | no_ymm_extracted          |
| LLM self-confidence < 0.8            | low_confidence:0.XX       |
| JSON parse failure                    | haiku_json_parse_failure  |
| No archived content, only title       | no_content_available_     |
|                                       | title_only               |
| No content and no title               | no_content_no_title       |
+---------------------------------------+---------------------------+
```

### 6.2 Escalation Path

```
Haiku extraction (low quality)
       |
       v
  import_queue.status = 'pending_review'
  import_queue.raw_data.escalation_reason = "..."
  import_queue.raw_data.haiku_extraction = {...}
  import_queue.raw_data.haiku_quality = {...}
       |
       v
  (Sonnet supervisor picks up pending_review items)
  sonnet-supervisor
       |
       +-- Re-extract with Sonnet (better at edge cases)
       +-- Validate Haiku's extraction against Sonnet's
       +-- Decide: approve, reject, or flag for human review
       |
       v
  import_queue.status = 'complete' OR 'failed'
```

### 6.3 Quality Thresholds

```
QUALITY_THRESHOLDS = {
  MIN_FIELDS: 3,                  // Minimum non-null fields
  MIN_YMM_CONFIDENCE: 0.8,       // Year/make/model confidence
  ESCALATION_THRESHOLD: 0.6,     // Below this -> escalate
  AUTO_APPROVE_THRESHOLD: 0.9,   // Above this -> auto-approve
  MAX_NULL_RATIO: 0.5            // Maximum acceptable nulls
}
```

---

## 7. The Quality Gate Pipeline

The quality gate (`_shared/extractionQualityGate.ts`) is the mandatory validation checkpoint. Full description in [data-flow.md](./data-flow.md#8-the-quality-gate).

### 7.1 Decision Flow

```
Vehicle data from extractor
       |
       v
  qualityGate(data, options)
       |
       +-- Check 1: Identity (year/make/model) -----> 40% weight
       +-- Check 2: HTML contamination --------------> penalty
       +-- Check 3: Field pollution -----------------> penalty
       +-- Check 3b: Make canonicalization ----------> side effect
       +-- Check 3c: normalizeVehicleFields ---------> side effect
       +-- Check 3d: VIN checksum ------------------> flag
       +-- Check 4: Description presence ------------> 20% weight
       +-- Check 5: Price sanity (era-based) --------> 10% weight
       +-- Check 5b: Cross-field consistency --------> flag
       +-- Check 6: Spec completeness ---------------> 20% weight
       |
       v
  Calculate composite score
       |
       +-- score < 0.2 --> REJECT (-> bat_quarantine)
       +-- score < 0.5 --> FLAG FOR REVIEW (needs_review = true)
       +-- score >= 0.5 -> UPSERT (proceed to write)
       +-- identityScore == 0 -> ALWAYS REJECT
```

### 7.2 Output

```typescript
QualityGateResult {
  pass: boolean,           // false if rejected
  score: number,           // 0-1 composite score
  issues: string[],        // specific problems found
  action: "upsert" | "flag_for_review" | "reject",
  cleaned: Record<string, any>,  // cleaned data (HTML stripped, etc.)
  fieldConfidence?: FieldConfidence[]  // per-field confidence
}
```

---

## 8. The Pollution Detector

The pollution detector (`_shared/pollutionDetector.ts`) catches data contamination that bypasses simple validation.

### 8.1 Types of Pollution

**HTML Contamination**: HTML tags in text fields (e.g. `<strong>Red</strong>` in the color field)

**Auction Metadata in Spec Fields**: Listing titles or auction boilerplate stuffed into vehicle specification fields. Common patterns:
- "for sale on BaT Auctions" in model field
- "Sold for $45,000" in color field
- "Lot #12345" in trim field
- Pipe characters (`|`) from title concatenation

**Platform Noise**: SEO chrome, navigation elements, or sidebar content that gets extracted as vehicle data.

### 8.2 Detection Functions

```
containsHtml(value)
  Returns true if value contains HTML tags (<...>)

isPollutedField(fieldName, value, {platform})
  Returns true if value contains auction metadata,
  is suspiciously long for the field type, or
  contains platform-specific noise patterns

cleanFieldValue(fieldName, value, {platform})
  Strips HTML tags, removes auction metadata,
  truncates to field-appropriate length
```

---

## 9. Vehicle Normalization

The normalization layer (`_shared/normalizeVehicle.ts`) canonicalizes all vehicle fields before database writes.

### 9.1 Make Normalization

107 make aliases mapped to canonical forms:

```
chevy, chev -> Chevrolet
vw -> Volkswagen
merc, mercedes, mb -> Mercedes-Benz
alfa, alfa romeo -> Alfa Romeo
aston martin -> Aston Martin
rolls royce -> Rolls-Royce
land rover, range rover -> Land Rover
ih, scout, international harvester -> International Harvester
pantera -> De Tomaso
... (107 total aliases)
```

Fallback: Title case the input (e.g. "PORSCHE" -> "Porsche")

### 9.2 Transmission Normalization

Handles verbose patterns and abbreviations:

```
auto, a/t, automatic -> Automatic
manual, stick, m/t, standard -> Manual
5-speed, five-speed, 5 speed -> 5-Speed Manual
pdk -> PDK
dct, dual clutch -> DCT
cvt -> CVT
sequential -> Sequential
semi-automatic -> Semi-Automatic

Also handles: "Four-Speed Automatic Transmission" -> "4-Speed Automatic"
(word-to-number conversion + suffix stripping)
```

### 9.3 Drivetrain Normalization

```
rwd, rear wheel drive -> RWD
fwd, front wheel drive -> FWD
awd, all wheel drive -> AWD
4wd, 4x4, four wheel drive -> 4WD
2wd -> RWD
```

### 9.4 VIN Normalization

```
- Uppercase
- Strip non-alphanumeric (except allowed characters)
- Remove I, O, Q (invalid in VINs)
- Reject if length < 6 or > 17
- Reject placeholders (all zeros, all X's, "UNKNOWN")
- Pre-1981: 6-13 characters acceptable (chassis numbers)
- Post-1981: exactly 17 characters required
```

### 9.5 Body Style Normalization

16 canonical body styles with extensive alias mapping:

```
Canonical: Coupe, Sedan, Convertible, Wagon, Hatchback, SUV,
           Pickup, Van, Roadster, Targa, Fastback, Minivan,
           Limousine, Cab & Chassis, Suburban, Truck,
           Cabriolet, Shooting Brake, Hardtop, Bus

Mappings:
  spider, spyder -> Convertible
  station wagon -> Wagon
  sport utility vehicle -> SUV
  "2 Door Coupe" -> Coupe (strip door count prefix)
  "Custom Sedan" -> Sedan (strip "Custom" prefix)

RPO code detection: if body_style matches [A-Z]{2,3}\d{1,3}
  (e.g. "L79", "Z28"), it's moved to the trim field instead.
```

### 9.6 Color Normalization

```
- Strip HTML tags
- Reject if contains pricing or auction metadata
- If short enough (<= 60 chars): keep as-is
- If verbose: truncate at first comma, parenthesis, or "with"
- Fallback: extract first recognizable color word from 33-word vocabulary
  (black, white, red, blue, green, silver, gray, gold, yellow, orange,
   brown, tan, beige, cream, ivory, burgundy, maroon, navy, charcoal,
   pewter, bronze, champagne, copper, platinum, sand, saddle, camel,
   cognac, parchment, palomino, biscuit, cashmere)
```

### 9.7 Source Normalization

60+ source aliases mapped to canonical platform slugs:

```
bat, bat_simple_extract, bat_core, bring a trailer,
  bringatrailer, bat_listing, bat_profile_extraction,
  bat_import, bat-extract:2.0.0 -> "bat"

mecum, mecum-checkpoint-discover, mecum-fast-discover,
  mecum auctions -> "mecum"

cars_and_bids, carsandbids, extract-cars-and-bids-core,
  cab-fast-discover -> "cars-and-bids"

... (60+ aliases across 25+ platforms)
```

---

## 10. The Tetris Provenance Write Layer

Full description in [data-flow.md](./data-flow.md#9-the-tetris-write-layer). Summary:

### 10.1 Write Rules

```
For each field being written:

  DB value is NULL -> GAP FILL
    - Write new value to vehicles
    - Set *_source column
    - Create extraction_metadata receipt (status: unvalidated)

  DB value == proposed value -> CONFIRMATION
    - Do NOT overwrite
    - Create extraction_metadata receipt (status: confirmed)

  DB value != proposed value -> CONFLICT
    - Do NOT overwrite
    - Create bat_quarantine row
    - Create extraction_metadata receipt (status: conflicting)
```

### 10.2 Source Column Map

```
Field           -> Source Column
-----           -> -------------
make            -> make_source
model           -> model_source
year            -> year_source
vin             -> vin_source
mileage         -> mileage_source
color           -> color_source
exterior_color  -> color_source
interior_color  -> color_source (shared)
transmission    -> transmission_source
engine_size     -> engine_source
description     -> description_source
series          -> series_source
trim            -> trim_source
msrp            -> msrp_source
listing_location -> listing_location_source
platform        -> platform_source
```

### 10.3 Comparison Logic

```
Numeric fields (year, mileage, sale_price, high_bid, counts):
  Compare as numbers (Number(a) === Number(b))

All other fields:
  Compare case-insensitive trimmed strings
  (String(a).trim().toLowerCase() === String(b).trim().toLowerCase())
```

---

## 11. Retry and Backoff Strategy

### 11.1 Failure Categories and Limits

```
+--------------------+-------------+-------------+-----------------------+
| Category           | Transient?  | Max Attempts| Base Backoff          |
+--------------------+-------------+-------------+-----------------------+
| timeout            | Yes         | 8           | 10 min * 2^attempts   |
| rate_limited       | Yes         | 8           | 10 min * 2^attempts   |
| blocked            | Yes         | 8           | 10 min * 2^attempts   |
| browser_crash      | No          | 5           | 5 min * 2^attempts    |
| bad_data           | No          | 5           | 5 min * 2^attempts    |
| extraction_failed  | No          | 5           | 5 min * 2^attempts    |
+--------------------+-------------+-------------+-----------------------+

Maximum backoff capped at 2 hours regardless of category.
```

### 11.2 Backoff Formula

```
next_attempt_at = now() + min(2 hours, base_minutes * 2^attempts)

Example progression (transient error, base=10):
  Attempt 1: +10 min
  Attempt 2: +20 min
  Attempt 3: +40 min
  Attempt 4: +80 min
  Attempt 5: +120 min (capped at 2h)
  Attempt 6: +120 min
  Attempt 7: +120 min
  Attempt 8: FAILED (permanent)
```

### 11.3 Non-Vehicle Page Handling

Pages that contain no vehicle data are marked `skipped` (not `failed`) and never retried:

```
Error contains "No vehicle data found"
Error contains "could not find real vehicle data"
Error contains "Missing required fields"
-> status = 'skipped'
-> No retry scheduling
```

---

## 12. Cost Model

### 12.1 Per-Extraction Costs

```
Haiku extraction:
  ~1,500 input tokens + ~500 output tokens per extraction
  Input: 1500 * $1.00 / 1M = $0.0015
  Output: 500 * $5.00 / 1M = $0.0025
  Total: ~$0.004 per extraction (0.4 cents)

Sonnet review:
  ~2,000 input tokens + ~1,000 output tokens
  Input: 2000 * $3.00 / 1M = $0.006
  Output: 1000 * $15.00 / 1M = $0.015
  Total: ~$0.021 per review (2.1 cents)

Firecrawl scrape:
  ~$0.01 per page (flat rate)

Direct HTML fetch:
  $0.00 (free)
```

### 12.2 Batch Cost Estimation

```typescript
estimateBatchCost(tier, itemCount, avgInputTokens, avgOutputTokens)

Example: 1000 BaT listings through Haiku
  = 1000 * ($0.0015 + $0.0025)
  = $4.00

Example: 100 escalated items through Sonnet
  = 100 * ($0.006 + $0.015)
  = $2.10

Total pipeline cost for 1000 listings:
  ~$4.00 (Haiku) + ~$0.21 (10% escalation to Sonnet) + ~$0 (direct fetch)
  = ~$4.21
```

### 12.3 Cost Tracking

Every AI call returns `costCents` in the `AgentCallResult`. These are:
1. Stored in `import_queue.raw_data.haiku_cost` / `sonnet_cost`
2. Aggregated per batch in the worker response
3. Logged via `logFetchCost()` for Firecrawl calls

---

## 13. Extraction Metrics and Monitoring

### 13.1 Health Checks

The `haiku-extraction-worker` has a built-in health endpoint:

```
POST {action: "health"}
-> {
     status: "healthy",
     tier: "haiku",
     model: "claude-haiku-4-5-20251001",
     capabilities: ["extract_listing", "parse_title", ...]
   }
```

### 13.2 Queue Health

The `queue_lock_health` view provides real-time monitoring:

```sql
SELECT * FROM queue_lock_health;
-- Returns: table_name, total_locked, stale_locked, oldest_lock
```

The `release_stale_locks()` function recovers stuck jobs:

```sql
SELECT release_stale_locks(dry_run := true);  -- preview
SELECT release_stale_locks();                  -- execute
```

### 13.3 Extraction Quality Tracking

Each extraction stores quality metrics in `import_queue.raw_data`:
- `haiku_quality.score` -- 0-1 quality score
- `haiku_quality.fieldsExtracted` -- count of non-null fields
- `haiku_quality.nullFields` -- list of null fields
- `haiku_quality.issues` -- validation issues
- `haiku_cost.costCents` -- extraction cost

---

## 14. The Approved Extractor Registry

The `_shared/approved-extractors.ts` module defines which extractors are approved for each platform. This prevents deprecated or experimental extractors from being called in production.

### 14.1 BaT Approved Workflow

```
APPROVED_BAT_EXTRACTORS = {
  CORE_DATA: "extract-bat-core",
  COMMENTS: "extract-auction-comments"
}
```

The two-step workflow:
1. `extract-bat-core` -- Core vehicle data, images, auction events, page snapshot
2. `extract-auction-comments` -- Comments and bids (separate function)

Deprecated BaT extractors (DO NOT USE):
- `comprehensive-bat-extraction`
- `import-bat-listing`
- `bat-extract-complete-v*`
- `bat-extract`
- `bat-simple-extract`

---

## 15. Pipeline Registry

The `pipeline_registry` table (`supabase/migrations/20260225000003_pipeline_registry.sql`) maps every field to its owning function. This prevents agents from accidentally writing to fields owned by specific pipeline stages.

### 15.1 Do-Not-Write-Directly Fields

These fields must be written through specific functions:

```
vehicles.nuke_estimate              -> compute-vehicle-valuation
vehicles.nuke_estimate_confidence   -> compute-vehicle-valuation
vehicles.deal_score                 -> compute-vehicle-valuation
vehicles.heat_score                 -> analyze-market-signals
vehicles.signal_score               -> analyze-market-signals
vehicles.perf_*_score               -> calculate-vehicle-scores
vehicles.social_positioning_score   -> calculate-vehicle-scores
vehicles.investment_quality_score   -> calculate-vehicle-scores
vehicles.provenance_score           -> calculate-vehicle-scores
vehicles.overall_desirability_score -> calculate-vehicle-scores
vehicles.completion_percentage      -> calculate-profile-completeness
vehicles.quality_grade              -> calculate-vehicle-scores

vehicle_images.ai_suggestions       -> photo-pipeline-orchestrator
vehicle_images.analysis_history     -> photo-pipeline-orchestrator

import_queue.locked_by              -> continuous-queue-processor
import_queue.locked_at              -> continuous-queue-processor
import_queue.vehicle_id             -> continuous-queue-processor

vehicle_observations.structured_data -> ingest-observation
vehicle_observations.is_superseded   -> ingest-observation
```

---

## 16. End-to-End Pipeline Diagram

```
+==========================================================================+
|                    COMPLETE EXTRACTION PIPELINE                            |
+==========================================================================+

  [URL enters import_queue]
           |
           v
  (claim_import_queue_batch)  <-- FOR UPDATE SKIP LOCKED
           |
           v
  +--------+----------+
  | process-import-    |
  | queue              |
  | (domain router)    |
  +--------+----------+
           |
  +--------+--------+--------+--------+--------+
  |        |        |        |        |        |
  v        v        v        v        v        v
 BaT     C&B     Mecum    BJ     Bonhams  Generic
 core    core    extract  extract extract  AI
  |        |        |        |        |        |
  +--------+--------+--------+--------+--------+
           |
           v
  +--------+----------+
  | archiveFetch()     |  <-- Layer 1: FETCH
  | (cache check ->    |
  |  fetch -> archive) |
  +--------+----------+
           |
           v
  +--------+----------+
  | Platform Parser    |  <-- Layer 2: PARSE (regex/DOM)
  | OR                 |
  | callTier('haiku')  |  <-- Layer 3: AI EXTRACT
  +--------+----------+
           |
           v
  +--------+----------+
  | normalizeVehicle   |  <-- Layer 4: NORMALIZE
  | Fields()           |
  +--------+----------+
           |
           v
  +--------+----------+
  | qualityGate()      |  <-- Layer 5: VALIDATE
  +--------+----------+
           |
  +--------+--------+
  | pass   |  fail  |
  v        v        v
           |   [bat_quarantine]
           |   status='failed'
  +--------+----------+
  | pollutionDetector  |  <-- Layer 6: DETECT
  | (integrated into   |
  |  quality gate)     |
  +--------+----------+
           |
           v
  +--------+----------+
  | resolveExisting    |  <-- Layer 7: RESOLVE
  | VehicleId()        |
  +--------+----------+
           |
  +--------+--------+
  | found  | new    |
  v        v        v
  UPDATE   INSERT
           |
  +--------+----------+
  | batchUpsertWith    |  <-- Layer 8: WRITE (Tetris)
  | Provenance()       |
  +--------+----------+
           |
  +--------+--------+--------+
  | gap_fill| confirm| conflict|
  v        v        v         v
  UPDATE   receipt  quarantine  <-- Layer 9: ARCHIVE
  vehicles only     + receipt
  + receipt
           |
           v
  [import_queue.status = 'complete']
  [vehicle_id set on import_queue]
  [vehicle_events created]
  [auction_events created]
  [vehicle_images batch inserted]
           |
           v
  (downstream: comments, AI analysis, image pipeline, enrichment)

+==========================================================================+
```
