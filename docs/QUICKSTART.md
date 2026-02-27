# Nuke API Quickstart

Get from zero to your first API call in under 5 minutes.

---

## 1. Get an API key

Sign in at [nuke.ag](https://nuke.ag) and go to **Settings → API Keys**, or visit directly:
[nuke.ag/settings/api-keys](https://nuke.ag/settings/api-keys)

Your key will start with `nk_live_`. Keep it secret — treat it like a password.

---

## 2. Install the SDK

```bash
npm install @nuke1/sdk
```

Requires Node.js 18+. Works in browser (ESM) and server (CJS/ESM).

No other dependencies. Zero configuration.

---

## 3. Your first call

```typescript
import Nuke from '@nuke1/sdk';

const nuke = new Nuke('nk_live_your_api_key');

// Search vehicles
const results = await nuke.search.query({ q: 'Porsche 911 turbo 1989' });
console.log(results.total_count, results.data[0]);

// Classify a vehicle photo — free, powered by YONO
const vision = await nuke.vision.classify('https://cdn.bringatrailer.com/porsche-911.jpg');
console.log(vision.make, vision.confidence);
// → "Porsche" 0.91

// Get deal signal
const signal = await nuke.signal.score({ vin: 'WP0AB0916KS121279' });
console.log(signal.deal_score_label, signal.price_vs_market);
// → "strong_buy" -15.3
```

---

## 4. Use an environment variable (recommended)

Never hard-code your API key.

**.env**
```
NUKE_API_KEY=nk_live_your_api_key
```

**index.ts**
```typescript
import Nuke from '@nuke1/sdk';

const nuke = new Nuke(process.env.NUKE_API_KEY!);
```

---

## Common patterns

### VIN lookup — full profile in one call

```typescript
const profile = await nuke.vinLookup.get('WP0AB0916KS121279');

console.log(profile.year, profile.make, profile.model);
// → 1989 Porsche 911

console.log(profile.valuation?.estimated_value);
// → 85000

console.log(profile.images.length, profile.counts.observations);
// → 24 images, 8 observations
```

### Comparable sales

```typescript
const comps = await nuke.comps.get({
  make: 'Porsche',
  model: '911',
  year: 1989,
  year_range: 3,  // search ±3 years
  limit: 10,
});

console.log(comps.summary);
// → { count: 14, avg_price: 84200, median_price: 83500, min_price: 62000, max_price: 110000 }

for (const c of comps.data) {
  console.log(`${c.year} ${c.make} ${c.model} — $${c.sale_price.toLocaleString()}`);
}
```

### Batch image classification — 100 images, $0

```typescript
const imageUrls = [
  'https://cdn.bringatrailer.com/car1.jpg',
  'https://cdn.bringatrailer.com/car2.jpg',
  // ... up to 100
];

const batch = await nuke.vision.batch(imageUrls);

console.log(`Classified ${batch.count} images for $${batch.cost_usd}`);
// → "Classified 12 images for $0"

for (const result of batch.results) {
  console.log(result.make, result.confidence, result.family);
}
```

### Market signal scoring

```typescript
// Score by vehicle ID
const score = await nuke.signal.score('vehicle-uuid-here');

// Score by VIN
const score = await nuke.signal.score({ vin: 'WP0AB0916KS121279' });

if (score.deal_score_label === 'strong_buy') {
  console.log(`Deal: ${score.price_vs_market}% below market`);
  console.log(`Based on ${score.comp_count} comp sales`);
  console.log(`Confidence: ${(score.confidence * 100).toFixed(0)}%`);
}
```

### Market price trends

```typescript
const trends = await nuke.marketTrends.get({
  make: 'Porsche',
  model: '911',
  period: '1y',
});

console.log(trends.summary?.trend_direction); // 'rising' | 'falling' | 'stable'
console.log(trends.summary?.price_change_pct); // e.g. 8.4
```

### Create and track a vehicle

```typescript
// Create
const vehicle = await nuke.vehicles.create({
  year: 1989,
  make: 'Porsche',
  model: '911',
  vin: 'WP0AB0916KS121279',
  mileage: 78000,
});

// Add a mileage observation
await nuke.observations.create({
  vehicle_id: vehicle.id,
  source_type: 'manual',
  observation_kind: 'mileage_reading',
  data: { mileage: 78000, date: '2026-02-27' },
  confidence: 0.95,
});

// Get history
const history = await nuke.vehicleHistory.list(vehicle.vin!);
```

### Bulk import

```typescript
const result = await nuke.batch.ingest({
  vehicles: [
    {
      year: 1989,
      make: 'Porsche',
      model: '911',
      vin: 'WP0AB0916KS121279',
    },
    {
      year: 1973,
      make: 'Porsche',
      model: '911',
      vin: 'WP0AB0916KS000001',
    },
  ],
  options: {
    match_by: 'vin',
    skip_duplicates: true,
  },
});

console.log(`Created: ${result.created}, Skipped: ${result.skipped}`);
```

### Bulk data export

Bulk export is available directly via the REST API — not yet in the SDK:

```bash
# Export 10,000 vehicles as NDJSON
curl "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/api-v1-export" \
  -H "X-API-Key: nk_live_your_api_key" \
  -G \
  --data-urlencode "format=ndjson" \
  --data-urlencode "make=Porsche" \
  --data-urlencode "limit=10000" \
  -o porsche_vehicles.ndjson

# Convert to Parquet
python3 -c "import pandas as pd; pd.read_json('porsche_vehicles.ndjson', lines=True).to_parquet('porsche.parquet')"
```

---

## Error handling

```typescript
import Nuke, { NukeError, NukeAPIError, NukeAuthenticationError, NukeRateLimitError } from '@nuke1/sdk';

const nuke = new Nuke(process.env.NUKE_API_KEY!);

async function getSignal(vin: string) {
  try {
    return await nuke.signal.score({ vin });
  } catch (err) {
    if (err instanceof NukeRateLimitError) {
      // Wait and retry
      await new Promise(r => setTimeout(r, err.retryAfter * 1000));
      return nuke.signal.score({ vin });
    }
    if (err instanceof NukeAuthenticationError) {
      throw new Error('Invalid API key — check NUKE_API_KEY');
    }
    if (err instanceof NukeAPIError && err.statusCode === 404) {
      // No valuation exists yet — request one first
      await nuke.valuations.get({ vin });
      return nuke.signal.score({ vin });
    }
    throw err;
  }
}
```

---

## Rate limits

| Tier | Requests / minute |
|------|-------------------|
| Free | 60 |
| Pro | 600 |
| Enterprise | Custom |

Check the `X-RateLimit-Remaining` response header to monitor usage. On 429, the SDK throws `NukeRateLimitError` with `retryAfter` in seconds.

---

## REST API (no SDK)

Every SDK method maps to an HTTP endpoint. Use the SDK where possible — it handles auth, retry, and type safety. But you can call the REST API directly:

```bash
# Base URL
BASE="https://qkgaybvrernstplzjaam.supabase.co/functions/v1"

# List vehicles
curl "$BASE/api-v1-vehicles?mine=true" \
  -H "X-API-Key: nk_live_your_api_key"

# Signal score
curl "$BASE/api-v1-signal?vin=WP0AB0916KS121279" \
  -H "X-API-Key: nk_live_your_api_key"

# Vision classify
curl -X POST "$BASE/api-v1-vision/classify" \
  -H "X-API-Key: nk_live_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"image_url": "https://cdn.bringatrailer.com/porsche-911.jpg"}'
```

Full OpenAPI spec: [`docs/api/openapi.yaml`](./api/openapi.yaml)

---

## Next steps

- [Full SDK README](../tools/nuke-sdk/README.md) — complete API reference with all types
- [OpenAPI spec](./api/openapi.yaml) — REST endpoint documentation
- [Changelog](../tools/nuke-sdk/CHANGELOG.md) — version history

Questions? [nuke.ag/support](https://nuke.ag/support)
