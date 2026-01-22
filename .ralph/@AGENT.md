# Nuke Project - Build & Run Instructions

## Project Structure

```
nuke/
├── supabase/functions/     # Edge functions (extraction logic)
├── nuke_frontend/          # React frontend
├── nuke_api/               # API layer
├── scripts/                # Utility scripts
├── docs/                   # Documentation
└── .github/workflows/      # CI/CD and scheduled jobs
```

## Key Edge Functions

| Function | Purpose | Location |
|----------|---------|----------|
| `extract-bat-core` | BaT extraction | `supabase/functions/extract-bat-core/` |
| `extract-auction-comments` | Comments/bids | `supabase/functions/extract-auction-comments/` |
| `process-import-queue` | Generic extraction | `supabase/functions/process-import-queue/` |
| `pipeline-orchestrator` | Main controller | `supabase/functions/pipeline-orchestrator/` |

## Environment Setup

```bash
# Required environment variables (in .env)
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx
FIRECRAWL_API_KEY=xxx
OPENAI_API_KEY=xxx
```

## Running Locally

```bash
# Install dependencies
cd ~/nuke && npm install

# Start Supabase locally
supabase start

# Run specific edge function
supabase functions serve extract-bat-core --no-verify-jwt

# Test extraction
curl -X POST http://localhost:54321/functions/v1/extract-bat-core \
  -H "Content-Type: application/json" \
  -d '{"url": "https://bringatrailer.com/listing/..."}'
```

## Deploying Functions

```bash
# Deploy single function
supabase functions deploy extract-bat-core --no-verify-jwt

# Deploy all functions
supabase functions deploy --no-verify-jwt
```

## Database Access

```bash
# Connect to production DB
supabase db remote

# Run SQL query
npx supabase sql "SELECT status, count(*) FROM import_queue GROUP BY status"
```

## Queue Monitoring

```sql
-- Check queue status
SELECT status, count(*) FROM import_queue GROUP BY status;

-- Recent processing
SELECT listing_url, status, error_message
FROM import_queue
WHERE updated_at > NOW() - INTERVAL '1 hour'
ORDER BY updated_at DESC
LIMIT 20;

-- Completeness check
SELECT
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE vin IS NOT NULL AND LENGTH(vin) = 17) as has_vin,
  COUNT(*) FILTER (WHERE price > 0) as has_price,
  COUNT(*) FILTER (WHERE mileage > 0) as has_mileage
FROM vehicles;
```

## Testing Extraction

```bash
# Test specific URL
node scripts/test-extraction.js "https://bringatrailer.com/listing/..."

# Run extraction worker
node low-cost-extraction-worker.js

# Check extraction results
node check-recent-vehicles.js
```

## Key Files to Modify

1. **Extraction Logic**: `supabase/functions/*/index.ts`
2. **Queue Processing**: `supabase/functions/process-import-queue/index.ts`
3. **Workflows**: `.github/workflows/*.yml`
4. **Docs**: `docs/` and root `.md` files

## Budget Tracking

- Firecrawl: $0.002/page
- Target: $0.003/profile total
- Budget: $500 total
