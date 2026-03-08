# Changelog

All notable changes to `@nuke1/sdk` are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
Versioning: [Semantic Versioning](https://semver.org/)

---

## [2.0.0] — 2026-03-07

**SDK v2.0.0 — Type accuracy overhaul. All 15 resource namespaces live.**

Major version bump due to breaking type changes. Every SDK type now matches the actual API response shapes, verified by a full handshake audit against all 19 API endpoints.

### BREAKING CHANGES

- **`Vehicle` type:** `exterior_color` renamed to `color`. `engine` renamed to `engine_type`. Added `trim`, `series`, `engine_displacement`, `primary_image_url`, `purchase_price`, `discovery_url`.
- **`VehicleCreateParams` / `VehicleUpdateParams`:** `exterior_color` renamed to `color`. `engine` renamed to `engine_type`. Added `purchase_price`.
- **`Observation` type:** `source_type` renamed to `source_id`. `observation_kind` renamed to `kind`. `data` renamed to `structured_data`. Removed `provenance` wrapper.
- **`ObservationCreateParams`:** `source_type` renamed to `source_id`. `observation_kind` renamed to `kind`. `data` renamed to `structured_data`.
- **`ExternalListing` type:** All field names aligned to `vehicle_events` table — `platform` → `source_platform`, `listing_url` → `source_url`, `listing_id` → `source_listing_id`, `listing_status` → `event_status`, `start_date` → `started_at`, `end_date` → `ended_at`, `current_bid` → `current_price`.
- **`Comparable` type:** Removed `condition_rating`, `transmission`. Added `listing_url`, `platform`, `platform_raw`, `sold_date`, `source_type`.
- **`SearchResponse`:** Now uses `pagination` object with `total_count` and `total_pages` instead of flat `total_count` / `query_type`.
- **`SearchResult`:** Rewritten to match API — now returns vehicle fields (`id`, `vin`, `year`, `make`, `model`, `trim`, `sale_price`, etc.) with `valuation` and `data_density` objects, instead of generic `type` / `title` / `relevance_score`.

### Added

- **`nuke.analysis.*`** namespace — proactive deal health signals: `get()`, `signal()`, `refresh()`, `history()`, `acknowledge()`, `dismiss()`.
- **`CompsSummary.auction_event_count`** field.
- **`CompsResponse.query.excluded_vehicle_id`** field.
- **`SignalScore.computed_on_demand`** optional field.
- **`VehicleAuctionResponse.listings`** now typed with correct `vehicle_events` column names.
- **`vehicles.list()`** now handles API's `{ vehicles: [...] }` response key mapping to `{ data: [...] }`.

### Fixed

- `comps.ts` JSDoc typo: `nuke.agps.get()` → `nuke.comps.get()`.
- `search.ts` JSDoc referenced non-existent `total_count` and `query_type` fields.
- `listings.ts` JSDoc referenced non-existent `listing_url` field.
- `index.ts` JSDoc used old observation field names.
- README search example referenced `query_type` and `relevance_score`.
- README observation example used `source_type` / `observation_kind` / `data` instead of `source_id` / `kind` / `structured_data`.
- README vehicle params table listed `exterior_color` and `engine` instead of `color` and `engine_type`.
- README version string updated from 1.5.0 to 2.0.0.
- README data stats updated to current numbers (1.29M vehicles, 35M images).

---

## [1.6.0] — 2026-03-04

**SDK v1.6.0 — Analysis namespace, type fixes from handshake audit.**

### Added

- **`nuke.analysis.*`** namespace — proactive deal health signals.
- Type fixes from SDK-API handshake audit (preparatory, types not yet aligned with API).

---

## [1.5.0] — 2026-02-28

**SDK v1.5.0 — Vision types aligned with live API, health endpoint, smart auth.**

The `nuke.vision.*` namespace now matches the deployed `api-v1-vision` v1.1 endpoint exactly. Types are aligned with real YONO sidecar output, not pre-deployment specs.

### Added

- **`nuke.vision.health()`** — Check YONO sidecar status, loaded models, and API version.
  ```typescript
  const health = await nuke.vision.health();
  console.log(health.sidecar_status.status);       // 'ok'
  console.log(health.sidecar_status.tier2_families); // 6
  console.log(health.sidecar_status.vision_available); // true
  ```

- **`VisionHealthResult` type** — exported from `@nuke1/sdk`
- **`VisionBatchItemResult` type** — individual batch result (was previously inlined)

### Changed

- **`VisionAnalyzeResult` rewritten** to match actual API response. Old spec fields (`category`, `subject`, `description`, `condition_notes`, `visible_damage`, `camera_position`, `yono` sub-object) replaced with real YONO output fields:
  - `vehicle_zone` (41-zone classification), `zone_confidence`, `zone_source`
  - `condition_score` (1-10 scale)
  - `damage_flags`, `modification_flags` (string arrays)
  - `interior_quality`, `photo_quality`, `photo_type`
  - `comps` (optional comparable sales, enabled via `include_comps: true`)
  - `classify_model`, `analyze_model`, `classify_ms`, `analyze_ms`

- **`VisionAnalyzeParams`** now includes `include_comps` option for comparable sales

- **`VisionClassifyResult`** now includes `yono_source` field (e.g. 'hierarchical', 'flat', 'tier2_german')

- **Auth header logic** — SDK now auto-detects key format:
  - `nk_live_*` / `nk_test_*` keys sent as `X-API-Key` header
  - All other tokens (service role keys, JWTs) sent as `Authorization: Bearer` header

- **Vision timeouts** — `analyze()` defaults to 90s, `batch()` defaults to 120s (accounts for Modal cold start + Florence-2 inference)

### Verified

- All 4 vision methods tested end-to-end against live `api-v1-vision` v1.1
- `classify`: Porsche, german family, 0.632 confidence, 370ms
- `analyze`: zone=ext_driver_side, condition=4, photo_quality=5, 4.8s total
- `batch`: concurrent classification, $0 cost
- `health`: sidecar ok, 6 tier-2 families, Florence-2 available

---

## [1.4.0] — 2026-02-27

**SDK v1.4.0 — Signal Score: "Is this a good deal?"**

The deal-finding capability for insurance platforms, dealer tools, and anyone building market-aware applications on Nuke.

### Added

- **`nuke.signal.score(vehicleId)`** — Market signal scoring. Combines comparable sales, pricing position, heat score, and auction sentiment into a single 0–100 deal score.
  ```typescript
  const score = await nuke.signal.score({ vehicle_id: 'uuid-here' });
  // or by VIN:
  const score = await nuke.signal.score({ vin: '1GCNK13T6XF234567' });
  // or shorthand:
  const score = await nuke.signal.score('uuid-here');

  // {
  //   deal_score: 87,
  //   deal_score_label: 'strong_buy',
  //   heat_score: 72,
  //   estimated_value: 48000,
  //   value_low: 42000,
  //   value_high: 55000,
  //   price_vs_market: -12,   // 12% below market (negative = better deal)
  //   comp_count: 28,
  //   signal_weights: {
  //     comp_coverage: 0.45,
  //     condition_signal: 0.18,
  //     auction_sentiment: 0.05,
  //     listing_velocity: 0.10,
  //     price_position: 0.10,
  //   },
  //   confidence: 0.78,
  //   model_version: 'v1',
  //   is_stale: false,
  // }
  ```

- **`SignalScore` type** — full TypeScript type exported from `@nuke1/sdk`
- **`SignalScoreParams` type** — exported from `@nuke1/sdk`
- **`Signal` resource class** — `nuke.signal` namespace on the `Nuke` client

### `deal_score_label` values

| Label | Meaning |
|-------|---------|
| `strong_buy` | Significantly below market, high confidence |
| `buy` | Below market, worth pursuing |
| `hold` | At market, neutral |
| `pass` | Above market or insufficient data |
| `overpriced` | Meaningfully above comparable sales |

### Infrastructure

- New `api-v1-signal` Supabase edge function
- Backed by `nuke_estimates` table (521K rows, indexed on `vehicle_id`)
- `price_vs_market` computed live from `asking_price` vs `estimated_value`
- `comp_count` derived from `signal_weights.comps.sourceCount`
- Returns a 404 with an actionable hint if no valuation exists yet

---

## [1.3.1] — 2026-02-27

### Added
- `family` field on `VisionClassifyResult` — hierarchical origin group from YONO's tier-2 classifier.
  Values: `'american' | 'german' | 'japanese' | 'british' | 'italian' | 'french' | 'swedish' | null`
- `family_confidence` field on `VisionClassifyResult` — confidence score 0.0–1.0 for family prediction
- `family` and `family_confidence` fields on `VisionAnalyzeResult`
- `is_vehicle` field on `VisionAnalyzeResult` (was already on classify, now consistently on both)
- `family` field inside `VisionAnalyzeResult.yono` sub-object

### Changed
- `api-v1-vision/classify` response now includes `family`, `family_confidence`, `is_vehicle`
- `api-v1-vision/analyze` response now includes `family`, `family_confidence`, `is_vehicle`
- `api-v1-vision/batch` per-item results now include `family`, `family_confidence`
- Sidecar unavailable fallback response now includes `family: null`, `family_confidence: null`, `is_vehicle: false`

---

## [1.3.0] — 2026-02-27

**SDK v1.3.0 — YONO Vision unlocked.**

The YONO FastAPI sidecar shipped (deployed to Modal). `nuke.vision.*` is live. This is the feature that separates Nuke from every other vehicle API: $0/image make classification using a model trained on our own 33M-image corpus.

### Added
- **`nuke.vision.classify(imageUrl)`** — Classify a vehicle image using YONO. Returns `make`, `family`, `confidence`, `top5`, `is_vehicle`. Cost: **$0.00/image**.
  ```typescript
  const result = await nuke.vision.classify('https://cdn.example.com/porsche.jpg');
  // { make: 'Porsche', family: 'german', confidence: 0.91, top5: [...], is_vehicle: true, cost_usd: 0 }
  ```

- **`nuke.vision.analyze(imageUrl)`** — Full scene analysis: make classification + cloud scene analysis (category, subject, angle, condition). Returns `make`, `family`, `category`, `subject`, `description`, `condition_notes`, `visible_damage`, `camera_position`. Cost: $0–$0.004/image.
  ```typescript
  const analysis = await nuke.vision.analyze('https://cdn.example.com/car.jpg');
  // {
  //   make: 'Porsche', family: 'german', confidence: 0.91,
  //   category: 'exterior',
  //   subject: 'exterior.panel.door.front.driver',
  //   description: 'Left front door of a 911 showing minor surface rust...',
  //   condition_notes: 'Surface rust on lower sill',
  //   visible_damage: true,
  //   camera_position: { azimuth_deg: 90, elevation_deg: 15, distance_mm: 3500 },
  //   source: 'yono+cloud', cost_usd: 0.0001
  // }
  ```

- **`nuke.vision.batch(images)`** — Classify up to 100 images in one call via YONO. Cost: $0.00.
  ```typescript
  const batch = await nuke.vision.batch([
    'https://cdn.example.com/car1.jpg',
    'https://cdn.example.com/car2.jpg',
  ]);
  // { results: [...], count: 2, errors: 0, cost_usd: 0, elapsed_ms: 142 }
  ```

- **`Vision` resource class** exported from `@nuke1/sdk`
- Types exported: `VisionClassifyResult`, `VisionAnalyzeResult`, `VisionBatchResult`, `VisionClassifyParams`, `VisionAnalyzeParams`, `VisionBatchItem`

### Infrastructure
- YONO sidecar deployed to Modal: `https://sss97133--yono-serve-fastapi-app.modal.run`
- `api-v1-vision` Supabase edge function handles `/classify`, `/analyze`, `/batch` routing
- `YONO_SIDECAR_URL` environment variable set in Supabase and local `.env`
- Hierarchical two-tier classification: tier-1 (family/origin), tier-2 (make within family)
- Gemini Flash ($0.0001/image) + GPT-4o-mini fallback for full scene analysis

---

## [1.2.0] — 2026-02-01

### Added
- **`nuke.search.query()`** — Full-text search across vehicles, organizations, users
- **`nuke.marketTrends.get()`** — Price trends by make/model/year with period statistics
- **`nuke.vehicleAuction.get()`** — Auction results, bidder comments, sentiment analysis
- **`nuke.vehicleHistory.list()`** — Observation timeline for a vehicle
- **`nuke.vinLookup.get()`** — One-call vehicle profile by VIN including valuation
- **`nuke.listings.list()`** — External auction/marketplace listings for a vehicle
- **`nuke.comps.get()`** — Comparable sales for valuation context

---

## [1.1.0] — 2026-01-15

### Added
- **`nuke.valuations.get()`** — Nuke Estimates: estimated value, value range, deal score, heat score
- Pagination improvements: `has_more` field on all paginated responses
- `listAll()` async iterator on `vehicles` and `observations` resources

---

## [1.0.0] — 2026-01-01

Initial public release.

### Added
- **`nuke.vehicles.*`** — CRUD vehicle management (create, retrieve, update, delete, list)
- **`nuke.observations.*`** — Immutable vehicle data points (create, list)
- **`nuke.webhooks.*`** — Webhook endpoint management + signature verification
- **`nuke.batch.*`** — Bulk vehicle + observation ingestion
- TypeScript-first with full type exports
- ESM + CJS build
