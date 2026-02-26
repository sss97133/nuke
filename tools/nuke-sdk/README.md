# @nuke1/sdk

Official TypeScript SDK for the Nuke Vehicle Data API.

## Installation

```bash
npm install @nuke1/sdk
# or
yarn add @nuke1/sdk
# or
pnpm add @nuke1/sdk
```

## Quick Start

```typescript
import Nuke from '@nuke1/sdk';

const nuke = new Nuke('nk_live_your_api_key');

// Classify a vehicle photo — free, powered by YONO
const result = await nuke.vision.classify('https://cdn.example.com/car.jpg');
console.log(result.make, result.confidence); // "Porsche" 0.91

// Create a vehicle
const vehicle = await nuke.vehicles.create({
  year: 1970,
  make: 'Porsche',
  model: '911S',
  vin: 'WP0AA0918LS123456',
});
```

## API Reference

### Vision

Classify and analyze vehicle images using YONO — a locally-trained model that runs free. No cloud API cost for make classification.

```typescript
// Classify: image URL → make, confidence, top-5 predictions
const result = await nuke.vision.classify('https://cdn.example.com/car.jpg');
// {
//   make: 'Porsche',
//   confidence: 0.91,
//   top5: [['Porsche', 0.91], ['BMW', 0.04], ...],
//   is_vehicle: true,
//   source: 'yono',
//   cost_usd: 0,
//   ms: 4.2
// }

// Pass a string directly or use the params object
await nuke.vision.classify({ image_url: 'https://...', top_k: 10 });

// Analyze: full scene analysis — category, angle, condition, camera position
const analysis = await nuke.vision.analyze('https://cdn.example.com/car.jpg');
// {
//   make: 'Porsche',
//   confidence: 0.91,
//   category: 'exterior',
//   subject: 'exterior.panel.door.front.driver',
//   description: 'Left front door of a 911, showing...',
//   condition_notes: 'Minor surface rust on lower sill',
//   visible_damage: true,
//   camera_position: { azimuth_deg: 90, elevation_deg: 15, distance_mm: 3500 },
//   source: 'yono+cloud',
//   cost_usd: 0.0012
// }

// Batch: classify up to 100 images in one call — all free via YONO
const batch = await nuke.vision.batch([
  { image_url: 'https://cdn.example.com/car1.jpg' },
  { image_url: 'https://cdn.example.com/car2.jpg' },
  'https://cdn.example.com/car3.jpg',
]);
// { results: [...], count: 3, cost_usd: 0, elapsed_ms: 142 }
```

**Cost:** Make classification via YONO is `$0.00/image`. Full analysis (category, condition, camera position) uses cloud vision and costs `$0.0001–$0.004/image`.


### Vehicles

```typescript
// Create
const vehicle = await nuke.vehicles.create({
  year: 1970,
  make: 'Porsche',
  model: '911S',
});

// Retrieve
const vehicle = await nuke.vehicles.retrieve('uuid-here');

// Update
const updated = await nuke.vehicles.update('uuid-here', {
  mileage: 50000,
});

// Delete (archive)
await nuke.vehicles.del('uuid-here');

// List with pagination
const { data, pagination } = await nuke.vehicles.list({
  mine: true,
  page: 1,
  limit: 20,
});

// Iterate through all
for await (const vehicle of nuke.vehicles.listAll({ mine: true })) {
  console.log(vehicle.year, vehicle.make, vehicle.model);
}
```

### Observations

Observations are immutable data points about a vehicle.

```typescript
// Create observation
const observation = await nuke.observations.create({
  vehicle_id: 'uuid-here',
  source_type: 'manual',
  observation_kind: 'mileage_reading',
  data: {
    mileage: 45000,
    date: '2024-01-15',
  },
  confidence: 0.95,
});

// List observations for a vehicle
const { data } = await nuke.observations.list({
  vehicle_id: 'uuid-here',
  kind: 'mileage_reading',
});
```

### Batch Operations

Import multiple vehicles at once (up to 1000 per request).

```typescript
const result = await nuke.batch.ingest({
  vehicles: [
    {
      year: 1970,
      make: 'Porsche',
      model: '911S',
      observations: [
        {
          source_type: 'manual',
          observation_kind: 'mileage_reading',
          data: { mileage: 45000 },
        },
      ],
    },
    // ... more vehicles
  ],
  options: {
    match_by: 'vin',
    skip_duplicates: true,
  },
});

console.log(`Created: ${result.created}, Skipped: ${result.skipped}`);

// For large batches, use ingestAll with progress tracking
const result = await nuke.batch.ingestAll(
  { vehicles: largeVehicleArray },
  { chunkSize: 500 },
  (progress) => console.log(`${progress.processed}/${progress.total}`)
);
```

### Webhooks

Register endpoints to receive real-time events.

```typescript
// Create webhook endpoint
const endpoint = await nuke.webhooks.create({
  url: 'https://your-server.com/webhooks',
  events: ['vehicle.created', 'vehicle.updated'],
  description: 'Production handler',
});

// IMPORTANT: Save the secret!
console.log('Webhook secret:', endpoint.secret);

// List endpoints
const { data: endpoints } = await nuke.webhooks.list();

// Update endpoint
await nuke.webhooks.update('uuid-here', { is_active: false });

// Delete endpoint
await nuke.webhooks.del('uuid-here');

// Rotate secret
const rotated = await nuke.webhooks.rotateSecret('uuid-here');
```

#### Verifying Webhook Signatures

```typescript
import { Webhooks } from '@nuke1/sdk';

// Express.js example
app.post('/webhooks', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['nuke-signature'];
  const payload = req.body.toString();

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
    console.error('Webhook verification failed:', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});
```

## Error Handling

```typescript
import Nuke, { NukeError, NukeAPIError, NukeRateLimitError } from '@nuke1/sdk';

try {
  await nuke.vehicles.create({ year: 1970 });
} catch (error) {
  if (error instanceof NukeRateLimitError) {
    console.log(`Rate limited. Retry after: ${error.retryAfter}s`);
  } else if (error instanceof NukeAPIError) {
    console.log(`API error ${error.statusCode}: ${error.message}`);
  } else if (error instanceof NukeError) {
    console.log(`SDK error: ${error.message}`);
  }
}
```

## Configuration

```typescript
const nuke = new Nuke('nk_live_...', {
  baseUrl: 'https://custom-api.example.com', // Custom API URL
  timeout: 60000, // Request timeout in ms
});

// Per-request options
await nuke.vehicles.create(
  { year: 1970, make: 'Porsche' },
  {
    timeout: 10000,
    idempotencyKey: 'unique-key-for-this-request',
  }
);
```

## TypeScript

Full TypeScript support with exported types:

```typescript
import type {
  Vehicle,
  VehicleCreateParams,
  Observation,
  ObservationCreateParams,
  WebhookEndpoint,
  WebhookPayload,
  BatchResult,
  VisionClassifyResult,
  VisionAnalyzeResult,
  VisionBatchResult,
} from '@nuke1/sdk';
```

## License

MIT
