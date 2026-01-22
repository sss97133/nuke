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

---

## Loop Validation (REQUIRED)

After completing each task, validate using these CLI tools:

### Supabase CLI Validation
```bash
# Check function deployment status
supabase functions list

# Verify database state
supabase db dump --schema public --data-only | head -50

# Check edge function logs
supabase functions logs extract-bat-core --limit 20

# Run SQL validation query
npx tsx -e "
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { count } = await supabase.from('vehicles').select('*', { count: 'exact', head: true });
console.log('Total vehicles:', count);
"
```

### GitHub CLI Validation
```bash
# Check repo status
gh repo view --json name,defaultBranchRef

# Check recent commits
gh api repos/{owner}/{repo}/commits --jq '.[0:3] | .[] | .commit.message'

# Check workflow runs
gh run list --limit 5

# Check for open issues
gh issue list --limit 5
```

### Vercel CLI Validation (if frontend deployed)
```bash
# Check deployment status
vercel list --limit 5

# Check production deployment
vercel inspect <deployment-url>
```

### Status Check Script (Primary Validation)
```bash
# ALWAYS run this after making changes
npx tsx scripts/ralph-status-check.ts
```

### Validation Checklist
Before marking a task complete, verify:
- [ ] `npx tsx scripts/ralph-status-check.ts` shows improvement
- [ ] No new errors in `supabase functions logs`
- [ ] Queue processing continues (`pending` count decreasing)
- [ ] No TypeScript errors: `npx tsc --noEmit`
