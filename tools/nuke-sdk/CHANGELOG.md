# Changelog

All notable changes to `@nuke1/sdk` are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
Versioning: [Semantic Versioning](https://semver.org/)

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
