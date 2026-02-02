# @nuke/sdk

Official TypeScript SDK for the Nuke Vehicle Data API.

## Installation

```bash
npm install @nuke/sdk
# or
yarn add @nuke/sdk
# or
pnpm add @nuke/sdk
```

## Quick Start

```typescript
import Nuke from '@nuke/sdk';

const nuke = new Nuke('nk_live_your_api_key');

// Create a vehicle
const vehicle = await nuke.vehicles.create({
  year: 1970,
  make: 'Porsche',
  model: '911S',
  vin: 'WP0AA0918LS123456',
});

console.log('Created vehicle:', vehicle.id);
```

## API Reference

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
import { Webhooks } from '@nuke/sdk';

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
import Nuke, { NukeError, NukeAPIError, NukeRateLimitError } from '@nuke/sdk';

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
} from '@nuke/sdk';
```

## License

MIT
