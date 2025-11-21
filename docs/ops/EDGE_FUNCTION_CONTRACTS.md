# Edge Function Contracts

## Overview

Supabase Edge Functions serve as the "Worker Layer" for the Nuke platform, handling AI processing, scraping, and heavy computation.

## Core Functions

### `vehicle-expert-agent`

**Trigger**: HTTP POST or Database Webhook (on new images/vehicle).

**Input**:
```json
{
  "vehicleId": "uuid"
}
```

**Output**:
Writes to `vehicle_valuations` table:
- `estimated_value`: number
- `confidence_score`: number
- `components`: JSONB (list of identified parts/values)
- `environmental_context`: JSONB (5 W's)

**Logic**:
1. **Research**: Fetches sales data for Y/M/M.
2. **Observe**: Scans all `vehicle_images` for that ID.
3. **Synthesize**: Generates a valuation narrative.

### `backfill-image-angles`

**Trigger**: Scheduled or Manual HTTP POST.

**Input**:
```json
{
  "vehicleId": "uuid"
}
```

**Output**:
Updates `vehicle_images` table:
- `angle`: string (e.g., "front_34", "engine_bay")
- `score`: number (quality score)

## Integration Pattern

1. **Phoenix Context** triggers function via `Supabase.Functions.invoke`.
2. **Edge Function** processes asynchronously.
3. **Edge Function** writes result to Supabase DB.
4. **Phoenix Context** reads result from DB (or via Realtime).

**Do NOT** wait for Edge Functions synchronously in user-facing requests if they take > 2s.

