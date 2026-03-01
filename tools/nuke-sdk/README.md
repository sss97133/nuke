# @nuke1/sdk

Official TypeScript SDK for the [Nuke Vehicle Data API](https://nuke.ag).

33M+ vehicle records. Free image classification. Deal scoring. Comp data.
Zero-setup access to the collector vehicle market.

[![npm version](https://img.shields.io/npm/v/@nuke1/sdk)](https://www.npmjs.com/package/@nuke1/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## Install

```bash
npm install @nuke1/sdk
# or
yarn add @nuke1/sdk
# or
pnpm add @nuke1/sdk
```

Requires Node.js 18+. Works in browser (ESM) and server (CJS/ESM).

---

## Quick Start

```typescript
import Nuke from '@nuke1/sdk';

const nuke = new Nuke('nk_live_your_api_key');
```

Get an API key at [nuke.ag/settings/api-keys](https://nuke.ag/settings/api-keys).

---

## Three examples: vehicle lookup, vision classify, signal score

### 1. Vehicle lookup

```typescript
// Search vehicles
const results = await nuke.search.query({ q: 'porsche 911 turbo', limit: 10 });
// → { data: [...], total_count: 42, query_type: 'fulltext' }

// Get a vehicle by VIN (includes valuation + images)
const profile = await nuke.vinLookup.get('WP0AB0916KS121279');
// → { year: 1989, make: 'Porsche', model: '911', valuation: { estimated_value: 85000, ... } }

// Get comparable sales
const comps = await nuke.comps.get({ make: 'Porsche', model: '911', year: 1989, year_range: 3 });
// → { data: [{ sale_price: 82000, ... }, ...], summary: { avg_price: 84200, median_price: 83500, ... } }
```

### 2. Vision classify — free, powered by YONO

```typescript
// Classify a vehicle photo: make, confidence, family. Cost: $0.
const result = await nuke.vision.classify('https://cdn.bringatrailer.com/porsche-911.jpg');
// → { make: 'Porsche', family: 'german', confidence: 0.91, top5: [...], is_vehicle: true, cost_usd: 0 }

// Full scene analysis: zone, condition, damage, modifications. Cost: $0.
const analysis = await nuke.vision.analyze('https://cdn.bringatrailer.com/porsche-911-door.jpg');
// → {
//     make: 'Porsche', family: 'german', confidence: 0.91,
//     vehicle_zone: 'ext_front_driver',
//     zone_confidence: 0.88,
//     condition_score: 6.5,
//     damage_flags: ['minor_scratches', 'paint_fade'],
//     modification_flags: [],
//     interior_quality: null,
//     photo_quality: 4,
//     photo_type: 'exterior',
//     cost_usd: 0
//   }

// Batch classify 100 images in one call. Cost: $0.
const batch = await nuke.vision.batch([
  'https://cdn.example.com/car1.jpg',
  'https://cdn.example.com/car2.jpg',
]);
// → { results: [...], count: 2, cost_usd: 0, elapsed_ms: 142 }
```

### 3. Signal score — is this a good deal?

```typescript
// Score by vehicle ID
const score = await nuke.signal.score('vehicle-uuid-here');

// Score by VIN
const score = await nuke.signal.score({ vin: 'WP0AB0916KS121279' });

// → {
//     deal_score: 87,               // 0–100, higher = better deal
//     deal_score_label: 'strong_buy',
//     price_vs_market: -12,         // 12% below market (negative = better)
//     estimated_value: 48000,
//     value_low: 42000,
//     value_high: 55000,
//     comp_count: 28,
//     heat_score: 72,               // market demand intensity
//     confidence: 0.78,
//   }

if (score.deal_score_label === 'strong_buy') {
  console.log(`${score.price_vs_market}% below market based on ${score.comp_count} comparable sales`);
}
```

---

## Authentication

All requests require an API key. Pass it as the first argument to the constructor:

```typescript
const nuke = new Nuke('nk_live_your_api_key');
```

The key is sent as `X-API-Key` on every request. Get yours at [nuke.ag/settings/api-keys](https://nuke.ag/settings/api-keys).

**Environment variable pattern (recommended):**

```typescript
const nuke = new Nuke(process.env.NUKE_API_KEY!);
```

---

## Rate Limits

| Tier | Requests / minute | Batch / request |
|------|-------------------|-----------------|
| Free | 60 | 100 images |
| Pro | 600 | 1000 images |
| Enterprise | Custom | Custom |

When rate limited, the API returns HTTP 429. The SDK throws `NukeRateLimitError` with a `retryAfter` field (seconds).

```typescript
import { NukeRateLimitError } from '@nuke1/sdk';

try {
  await nuke.vision.batch(images);
} catch (err) {
  if (err instanceof NukeRateLimitError) {
    console.log(`Retry in ${err.retryAfter}s`);
  }
}
```

---

## API Reference

### `nuke.vehicles`

Manage your vehicle records.

```typescript
// Create
const vehicle = await nuke.vehicles.create({
  year: 1970,
  make: 'Porsche',
  model: '911S',
  vin: 'WP0AA0918LS123456',
});

// Retrieve by ID
const vehicle = await nuke.vehicles.retrieve('uuid-here');

// Update
const updated = await nuke.vehicles.update('uuid-here', {
  mileage: 50000,
  exterior_color: 'Guards Red',
});

// Archive (soft delete)
await nuke.vehicles.del('uuid-here');

// List with pagination
const { data, pagination } = await nuke.vehicles.list({
  mine: true,
  page: 1,
  limit: 20,
});

// Iterate through all vehicles
for await (const vehicle of nuke.vehicles.listAll({ mine: true })) {
  console.log(vehicle.year, vehicle.make, vehicle.model);
}
```

**`VehicleCreateParams` / `VehicleUpdateParams`**

| Field | Type | Description |
|-------|------|-------------|
| `year` | `number` | Model year |
| `make` | `string` | Manufacturer (e.g. `'Porsche'`) |
| `model` | `string` | Model name |
| `vin` | `string` | 17-character VIN |
| `mileage` | `number` | Odometer reading in miles |
| `exterior_color` | `string` | Exterior paint color |
| `interior_color` | `string` | Interior color |
| `transmission` | `string` | `'manual'`, `'automatic'`, etc. |
| `engine` | `string` | Engine description |
| `drivetrain` | `string` | `'rwd'`, `'awd'`, `'4wd'`, etc. |
| `body_style` | `string` | `'coupe'`, `'sedan'`, `'suv'`, etc. |
| `sale_price` | `number` | Sale/asking price in USD |
| `description` | `string` | Free-text description |
| `is_public` | `boolean` | Whether visible to other users |

---

### `nuke.vision`

Free vehicle image classification powered by YONO — a model trained on Nuke's 33M-image corpus. Make classification costs $0.00 per image.

```typescript
// Classify: make, family (origin group), confidence, top-5
const result = await nuke.vision.classify('https://cdn.example.com/car.jpg');
// or with params:
const result = await nuke.vision.classify({ image_url: 'https://...', top_k: 10 });

// Analyze: full scene — zone, condition, damage, modifications
const analysis = await nuke.vision.analyze('https://cdn.example.com/car.jpg');
// or:
const analysis = await nuke.vision.analyze({
  image_url: 'https://...',
  include_comps: true, // optional — include comparable sales
});

// Batch: up to 100 images, $0 each
const batch = await nuke.vision.batch([
  { image_url: 'https://cdn.example.com/car1.jpg' },
  { image_url: 'https://cdn.example.com/car2.jpg', top_k: 10 },
  'https://cdn.example.com/car3.jpg', // string shorthand also works
]);
```

**`VisionClassifyResult`**

| Field | Type | Description |
|-------|------|-------------|
| `make` | `string \| null` | Best make prediction (e.g. `'Porsche'`) |
| `family` | `string \| null` | Origin group: `'american'`, `'german'`, `'japanese'`, `'british'`, `'italian'`, `'french'`, `'swedish'` |
| `family_confidence` | `number \| null` | Confidence 0.0–1.0 for family prediction |
| `confidence` | `number` | Make confidence 0.0–1.0 |
| `top5` | `[string, number][]` | Top-K predictions as `[make, confidence]` pairs |
| `is_vehicle` | `boolean` | Whether the image contains a vehicle |
| `source` | `'yono' \| 'unavailable'` | Inference source |
| `ms` | `number` | YONO inference time (ms) |
| `cost_usd` | `number` | Always 0 for YONO |

**`VisionAnalyzeResult`** includes all classify fields plus:

| Field | Type | Description |
|-------|------|-------------|
| `vehicle_zone` | `string \| null` | Zone/angle classification (41 zones). E.g. `'ext_front_driver'`, `'int_dashboard'`, `'engine_bay'` |
| `zone_confidence` | `number \| null` | Zone classification confidence 0.0–1.0 |
| `zone_source` | `string \| null` | Zone model source (e.g. `'zone_classifier'`, `'florence2'`) |
| `condition_score` | `number \| null` | Vehicle condition 1–10 (1=poor, 10=concours) |
| `damage_flags` | `string[]` | Detected damage: `'minor_scratches'`, `'dent'`, `'rust'`, `'cracked_glass'`, `'paint_fade'`, etc. |
| `modification_flags` | `string[]` | Aftermarket mods: `'aftermarket_wheels'`, `'lowered'`, `'custom_paint'`, `'roll_cage'`, etc. |
| `interior_quality` | `string \| null` | `'poor'`, `'fair'`, `'good'`, `'excellent'` (null for exterior photos) |
| `photo_quality` | `number \| null` | Photo technical quality 1–5 (1=unusable, 5=professional) |
| `photo_type` | `string \| null` | `'exterior'`, `'interior'`, `'engine'`, `'undercarriage'`, `'detail'`, `'document'`, `'unknown'` |
| `comps` | `Array \| null` | Comparable sales (only when `include_comps: true`) |
| `source` | `string` | `'yono'`, `'yono_classify_only'`, `'yono_analyze_only'`, or `'unavailable'` |
| `cost_usd` | `number` | Always 0 — all YONO inference is free |

---

### `nuke.signal`

Market signal scoring — answers "is this a good deal?".

```typescript
// By vehicle ID
const score = await nuke.signal.score('vehicle-uuid');

// By VIN
const score = await nuke.signal.score({ vin: 'WP0AB0916KS121279' });

// By vehicle ID in params object
const score = await nuke.signal.score({ vehicle_id: 'vehicle-uuid' });
```

**`SignalScore`**

| Field | Type | Description |
|-------|------|-------------|
| `deal_score` | `number \| null` | 0–100. Higher = better deal |
| `deal_score_label` | `string \| null` | `strong_buy`, `buy`, `hold`, `pass`, `overpriced` |
| `heat_score` | `number \| null` | Market demand intensity 0–100 |
| `heat_score_label` | `string \| null` | `cold`, `warm`, `hot`, `fire`, `volcanic` |
| `estimated_value` | `number \| null` | Estimated fair market value in USD |
| `value_low` | `number \| null` | Lower bound of value range |
| `value_high` | `number \| null` | Upper bound of value range |
| `price_vs_market` | `number \| null` | Listing price vs market (negative = below market, better deal) |
| `comp_count` | `number \| null` | Number of comparable sales used |
| `signal_weights` | `object \| null` | Per-factor weight breakdown |
| `confidence` | `number \| null` | Confidence score 0.0–1.0 |
| `model_version` | `string \| null` | Model version used |
| `is_stale` | `boolean \| null` | Whether the score is past its freshness threshold |

**`deal_score_label` values:**

| Label | Meaning |
|-------|---------|
| `strong_buy` | Significantly below market, high confidence |
| `buy` | Below market, worth pursuing |
| `hold` | At market, neutral |
| `pass` | Above market or insufficient data |
| `overpriced` | Meaningfully above comparable sales |

---

### `nuke.comps`

Comparable vehicle sales from auction results.

```typescript
// By make/model/year
const result = await nuke.comps.get({
  make: 'Porsche',
  model: '911',
  year: 1973,
  year_range: 3,   // ±3 years
  limit: 20,
});

// By VIN (resolves make/model/year automatically)
const result = await nuke.comps.get({ vin: 'WP0AB0916KS121279' });

console.log(result.summary);
// { count: 14, avg_price: 84200, median_price: 83500, min_price: 62000, max_price: 110000 }

for (const comp of result.data) {
  console.log(comp.year, comp.sale_price, comp.mileage);
}
```

**`CompsGetParams`**

| Param | Type | Description |
|-------|------|-------------|
| `make` | `string` | Required if not using `vin` |
| `model` | `string` | Model filter |
| `year` | `number` | Target year |
| `vin` | `string` | Use instead of make/model/year |
| `year_range` | `number` | Search ±N years (default 2) |
| `min_price` | `number` | Minimum sale price filter |
| `max_price` | `number` | Maximum sale price filter |
| `limit` | `number` | Max results (default 20) |

---

### `nuke.search`

Full-text search across vehicles, organizations, and users.

```typescript
const results = await nuke.search.query({
  q: 'porsche 911 turbo 1989',
  types: ['vehicle'],   // filter by entity type (optional)
  limit: 10,
});

for (const item of results.data) {
  console.log(item.type, item.title, item.relevance_score);
}
```

---

### `nuke.vinLookup`

One-call vehicle profile by VIN — includes valuation, images, and counts.

```typescript
const profile = await nuke.vinLookup.get('WP0AB0916KS121279');

console.log(profile.year, profile.make, profile.model);
console.log(profile.valuation?.estimated_value);
console.log(profile.images);     // array of vehicle images
console.log(profile.counts);     // { listings, observations, images }
```

---

### `nuke.valuations`

Nuke Estimates — estimated value, value range, deal score, heat score.

```typescript
// By vehicle ID
const val = await nuke.valuations.get({ vehicle_id: 'uuid-here' });

// By VIN
const val = await nuke.valuations.get({ vin: 'WP0AB0916KS121279' });

console.log(val.estimated_value); // 48000
console.log(val.deal_score);      // 72
console.log(val.heat_score);      // 65
```

---

### `nuke.marketTrends`

Price trends by make/model/year with period statistics.

```typescript
const trends = await nuke.marketTrends.get({
  make: 'Porsche',
  model: '911',
  year_from: 1970,
  year_to: 1989,
  period: '1y',   // '30d' | '90d' | '1y' | '3y'
});

console.log(trends.summary);
// { total_sales: 128, price_change_pct: 8.4, trend_direction: 'rising' }

for (const period of trends.periods) {
  console.log(period.period_start, period.avg_price, period.sale_count);
}
```

---

### `nuke.vehicleAuction`

Auction results, bidder comments, and sentiment analysis by VIN.

```typescript
const auction = await nuke.vehicleAuction.get('WP0AB0916KS121279');

console.log(auction.listings);         // auction_events array
console.log(auction.comments.recent); // recent bidder comments
console.log(auction.sentiment);        // { overall: 'positive', score: 0.82 }
```

---

### `nuke.vehicleHistory`

Chronological observation timeline for a vehicle.

```typescript
const history = await nuke.vehicleHistory.list('WP0AB0916KS121279', {
  kind: 'mileage_reading',
  page: 1,
  limit: 50,
});

for (const obs of history.data.observations) {
  console.log(obs.kind, obs.observed_at, obs.structured_data);
}
```

---

### `nuke.listings`

External auction and marketplace listings for a vehicle.

```typescript
const listings = await nuke.listings.list({
  vehicle_id: 'uuid-here',
  platform: 'bat',
  status: 'sold',
});

for (const listing of listings.data) {
  console.log(listing.platform, listing.final_price, listing.listing_url);
}
```

---

### `nuke.observations`

Immutable data points about a vehicle from any source.

```typescript
// Create an observation
const obs = await nuke.observations.create({
  vehicle_id: 'uuid-here',
  source_type: 'manual',
  observation_kind: 'mileage_reading',
  data: { mileage: 45000, date: '2024-01-15' },
  confidence: 0.95,
});

// List observations
const { data } = await nuke.observations.list({
  vehicle_id: 'uuid-here',
  kind: 'mileage_reading',
});
```

---

### `nuke.batch`

Bulk vehicle + observation ingestion (up to 1000 vehicles per call).

```typescript
const result = await nuke.batch.ingest({
  vehicles: [
    {
      year: 1970,
      make: 'Porsche',
      model: '911S',
      vin: 'WP0AA0918LS123456',
      observations: [
        {
          source_type: 'manual',
          observation_kind: 'mileage_reading',
          data: { mileage: 45000 },
        },
      ],
    },
    // ... up to 999 more
  ],
  options: {
    match_by: 'vin',         // dedup strategy: 'vin' | 'year_make_model' | 'none'
    skip_duplicates: true,
    update_existing: false,
  },
});

console.log(`Created: ${result.created}, Skipped: ${result.skipped}`);

// For large batches with progress tracking
const result = await nuke.batch.ingestAll(
  { vehicles: largeArray },
  { chunkSize: 500 },
  (progress) => console.log(`${progress.processed}/${progress.total}`)
);
```

---

### `nuke.webhooks`

Register endpoints to receive real-time events.

```typescript
// Create endpoint
const endpoint = await nuke.webhooks.create({
  url: 'https://your-server.com/webhooks',
  events: ['vehicle.created', 'vehicle.updated', 'observation.created'],
  description: 'Production handler',
});
// IMPORTANT: Save endpoint.secret — it is only shown once.
console.log('Secret:', endpoint.secret);

// List endpoints
const { data: endpoints } = await nuke.webhooks.list();

// Update
await nuke.webhooks.update('uuid-here', { is_active: false });

// Delete
await nuke.webhooks.del('uuid-here');

// Rotate secret
const rotated = await nuke.webhooks.rotateSecret('uuid-here');
```

**Available event types:**

| Event | Fired when |
|-------|-----------|
| `vehicle.created` | A new vehicle is added |
| `vehicle.updated` | Vehicle fields change |
| `vehicle.deleted` | Vehicle is archived |
| `observation.created` | New data point is ingested |
| `document.uploaded` | A document is attached |
| `import.completed` | A batch import finishes |
| `*` | All events |

**Verifying webhook signatures (Express.js example):**

```typescript
import { Webhooks } from '@nuke1/sdk';

app.post('/webhooks', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['nuke-signature'];
  const payload   = req.body.toString();

  try {
    const event = Webhooks.constructEvent(payload, signature, WEBHOOK_SECRET);

    switch (event.type) {
      case 'vehicle.created':
        console.log('New vehicle:', event.data);
        break;
      case 'observation.created':
        console.log('New observation:', event.data);
        break;
    }

    res.json({ received: true });
  } catch (err) {
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});
```

---

## Error Handling

```typescript
import Nuke, { NukeError, NukeAPIError, NukeAuthenticationError, NukeRateLimitError } from '@nuke1/sdk';

try {
  await nuke.vehicles.create({ year: 1970 });
} catch (error) {
  if (error instanceof NukeRateLimitError) {
    console.log(`Rate limited. Retry after ${error.retryAfter}s`);
  } else if (error instanceof NukeAuthenticationError) {
    console.log('Invalid API key');
  } else if (error instanceof NukeAPIError) {
    console.log(`API error ${error.statusCode}: ${error.message}`);
  } else if (error instanceof NukeError) {
    console.log(`SDK error: ${error.message}`);
  }
}
```

**Error classes:**

| Class | When thrown |
|-------|-------------|
| `NukeError` | Base class — network errors, timeouts |
| `NukeAuthenticationError` | Invalid or missing API key (HTTP 401) |
| `NukeAPIError` | 400, 404, 422 — API validation errors |
| `NukeRateLimitError` | HTTP 429 — includes `retryAfter` in seconds |

---

## Configuration

```typescript
const nuke = new Nuke('nk_live_...', {
  baseUrl: 'https://custom-endpoint.example.com', // override API base URL
  timeout: 60000,                                  // request timeout in ms (default: 30000)
});

// Per-request options
await nuke.vehicles.create(
  { year: 1970, make: 'Porsche' },
  {
    timeout: 10000,
    idempotencyKey: 'import-batch-001-row-42',
  }
);
```

---

## TypeScript

Full type exports:

```typescript
import type {
  // Vehicles
  Vehicle,
  VehicleCreateParams,
  VehicleUpdateParams,
  VehicleListParams,

  // Observations
  Observation,
  ObservationCreateParams,

  // Vision
  VisionClassifyResult,
  VisionAnalyzeResult,
  VisionBatchResult,
  VisionClassifyParams,
  VisionAnalyzeParams,
  VisionBatchItem,

  // Signal
  SignalScore,
  SignalScoreParams,

  // Comps
  CompsResponse,
  CompsGetParams,
  Comparable,
  CompsSummary,

  // Valuations
  Valuation,

  // Search
  SearchResponse,
  SearchParams,
  SearchResult,

  // Webhooks
  WebhookEndpoint,
  WebhookPayload,
  WebhookEventType,

  // Batch
  BatchResult,
  BatchVehicle,

  // Market
  MarketTrendsResponse,

  // VIN Lookup
  VinLookupResponse,

  // Pagination
  PaginatedResponse,
} from '@nuke1/sdk';
```

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for version history.

**Current version: 1.5.0** — YONO Vision v3 with zone detection, condition scoring, damage/modification flags. Signal Score. Free inference for all vision endpoints.

---

## License

MIT
