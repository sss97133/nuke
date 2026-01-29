# Fully Automated Organization Ingestion

## Overview

The `ingest-org-complete` Edge Function provides **fully automated** end-to-end ingestion of organizations and vehicles. No manual steps, no SQL generation, no MCP tool calls required - just invoke the function and data is automatically inserted into the database.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│         ingest-org-complete Edge Function               │
│  (Fully Automated - Scrape + Insert in One Call)        │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  1. Scrape Organization Data                            │
│  2. Scrape Vehicle Data                                 │
│  3. Insert Organization → businesses table              │
│  4. Insert Vehicles → vehicles table                    │
│  5. Link Organization-Vehicles → organization_vehicles│
│  6. Insert Vehicle Images → vehicle_images              │
│                                                          │
│  ✅ Complete - Data in Database                         │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## Usage

### Single HTTP Request

```bash
curl -X POST https://qkgaybvrernstplzjaam.supabase.co/functions/v1/ingest-org-complete \
  -H "Authorization: Bearer YOUR_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.velocityrestorations.com/"}'
```

### Response

```json
{
  "success": true,
  "organization_id": "abc-123-def-456",
  "organization_name": "Velocity Restorations",
  "vehicles": {
    "found": 12,
    "inserted": 12,
    "errors": 0
  },
  "stats": {
    "org_fields_extracted": 8,
    "vehicles_found": 12,
    "vehicles_with_images": 10
  }
}
```

### From TypeScript/JavaScript

```typescript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://qkgaybvrernstplzjaam.supabase.co',
  'YOUR_SUPABASE_ANON_KEY'
);

const { data, error } = await supabase.functions.invoke('ingest-org-complete', {
  body: { url: 'https://www.velocityrestorations.com/' }
});

if (data.success) {
  console.log(`✅ Ingested ${data.vehicles.inserted} vehicles for ${data.organization_name}`);
}
```

### From Deno Script

```typescript
const response = await fetch('https://qkgaybvrernstplzjaam.supabase.co/functions/v1/ingest-org-complete', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ url: 'https://www.velocityrestorations.com/' }),
});

const result = await response.json();
console.log(result);
```

## What It Does Automatically

### 1. Organization Insertion
- Extracts: business_name, website, description, email, phone, address, city, state, zip_code, logo_url
- Inserts/updates `businesses` table
- Conflict resolution: Updates existing organization if `website` matches
- Metadata merging: Preserves existing metadata, adds new extraction data

### 2. Vehicle Insertion
- Extracts: year, make, model, description, price, status, image_urls, source_url, vin
- Inserts/updates `vehicles` table
- Conflict resolution:
  - If VIN exists: Updates existing vehicle
  - If no VIN: Checks `discovery_url` + `model` combination
  - Otherwise: Inserts new vehicle

### 3. Organization-Vehicle Linking
- Creates link in `organization_vehicles` table
- Relationship type: `'owner'` (for active vehicles) or `'seller'` (for sold vehicles)
- Status: `'active'` or `'past'` based on vehicle status
- Conflict resolution: Updates existing link if combination exists

### 4. Vehicle Images
- Inserts each image URL into `vehicle_images` table
- Category: `'exterior'` (default)
- Conflict resolution: Skips duplicate images (same vehicle_id + image_url)

## Database Operations

All operations use the Supabase client with service role key (bypasses RLS):

```typescript
const supabase = createClient(
  Deno.env.get('SUPABASE_URL'),
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
);
```

### Tables Modified

1. **`businesses`** - Organization data
2. **`vehicles`** - Vehicle data
3. **`organization_vehicles`** - Organization-vehicle relationships
4. **`vehicle_images`** - Vehicle image URLs

## Error Handling

The function handles errors gracefully:

- **Missing required fields**: Skips insertion, logs warning
- **Database errors**: Logs error, continues with next item
- **Network errors**: Returns error response with details
- **Partial failures**: Returns success with error counts

### Error Response

```json
{
  "success": false,
  "error": "Error message",
  "stack": "Error stack trace (in development)"
}
```

## Scheduling & Automation

### Cron Job (Remote Server)

```bash
# Crontab entry - runs daily at 2 AM
0 2 * * * curl -X POST https://qkgaybvrernstplzjaam.supabase.co/functions/v1/ingest-org-complete \
  -H "Authorization: Bearer YOUR_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.velocityrestorations.com/"}'
```

### Batch Processing Script

```typescript
// scripts/batch-ingest-orgs.ts
const urls = [
  'https://www.velocityrestorations.com/',
  'https://kindredmotorworks.com/',
  'https://www.bespoke4x4.com/',
];

for (const url of urls) {
  const response = await fetch('https://qkgaybvrernstplzjaam.supabase.co/functions/v1/ingest-org-complete', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url }),
  });
  
  const result = await response.json();
  console.log(`${url}: ${result.success ? '✅' : '❌'} ${result.vehicles?.inserted || 0} vehicles`);
}
```

### Supabase Database Webhook

You can set up a database webhook to trigger ingestion when a URL is added to a queue table:

```sql
-- Create ingestion queue table
CREATE TABLE IF NOT EXISTS org_ingestion_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger function to call Edge Function
CREATE OR REPLACE FUNCTION trigger_org_ingestion()
RETURNS TRIGGER AS $$
BEGIN
  -- Call Edge Function via pg_net or external HTTP
  PERFORM net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/ingest-org-complete',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.supabase_anon_key'),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('url', NEW.url)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
CREATE TRIGGER on_org_ingestion_queue_insert
  AFTER INSERT ON org_ingestion_queue
  FOR EACH ROW
  WHEN (NEW.status = 'pending')
  EXECUTE FUNCTION trigger_org_ingestion();
```

## Comparison: Automated vs Manual

| Feature | `ingest-org-complete` (Automated) | `scrape-org` + MCP (Manual) |
|---------|-----------------------------------|------------------------------|
| **Steps Required** | 1 (single HTTP call) | 3+ (scrape, generate SQL, execute SQL) |
| **Manual Intervention** | None | Required (MCP tool calls) |
| **SQL Generation** | Not needed | Required |
| **Error Recovery** | Automatic | Manual |
| **Best For** | Production, automation, scheduling | Development, debugging, one-offs |
| **Scalability** | High (serverless) | Medium (requires orchestration) |

## Deployment

```bash
# Deploy the function
supabase functions deploy ingest-org-complete

# Set required environment variables (if not already set)
supabase secrets set FIRECRAWL_API_KEY=your-key
supabase secrets set SUPABASE_URL=https://qkgaybvrernstplzjaam.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

## Monitoring

### Logs

View function logs:

```bash
supabase functions logs ingest-org-complete
```

### Metrics

The function returns detailed statistics:

- `org_fields_extracted`: Number of organization fields extracted
- `vehicles_found`: Total vehicles discovered
- `vehicles.inserted`: Successfully inserted vehicles
- `vehicles.errors`: Failed insertions

### Database Verification

```sql
-- Check ingested organizations
SELECT 
  business_name,
  website,
  created_at,
  (SELECT COUNT(*) FROM organization_vehicles WHERE organization_id = businesses.id) as vehicle_count
FROM businesses
WHERE metadata->>'source' = 'automated_ingestion'
ORDER BY created_at DESC;

-- Check ingested vehicles
SELECT 
  year,
  make,
  model,
  discovery_url,
  (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = vehicles.id) as image_count
FROM vehicles
WHERE origin_metadata->>'source' = 'organization_scrape'
ORDER BY created_at DESC;
```

## Benefits

1. **Zero Manual Steps** - Fully automated from URL to database
2. **Idempotent** - Safe to run multiple times (updates existing records)
3. **Error Resilient** - Continues processing even if individual items fail
4. **Scalable** - Serverless, handles concurrent requests
5. **Maintainable** - Single function, clear workflow
6. **Production Ready** - Handles edge cases, proper error handling

## Next Steps

1. **Deploy the function:**
   ```bash
   supabase functions deploy ingest-org-complete
   ```

2. **Test with a sample URL:**
   ```bash
   curl -X POST https://qkgaybvrernstplzjaam.supabase.co/functions/v1/ingest-org-complete \
     -H "Authorization: Bearer YOUR_ANON_KEY" \
     -H "Content-Type: application/json" \
     -d '{"url": "https://www.velocityrestorations.com/"}'
   ```

3. **Set up automation:**
   - Schedule cron jobs for regular ingestion
   - Create queue table for batch processing
   - Set up webhooks for event-driven ingestion

4. **Monitor and refine:**
   - Review logs for extraction quality
   - Adjust extraction patterns as needed
   - Monitor database growth and performance

