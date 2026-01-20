# START HERE - For Any LLM

**Updated:** Jan 19, 2026

## What This System Does

Extracts vehicle data from auction sites (BaT, Cars & Bids, Mecum, etc.) and stores it in Supabase.

## The Core Pipeline

```
pipeline-orchestrator (every 10 min)
    ├── sync-active-auctions → finds new listings
    ├── extract-all-orgs-inventory → scrapes dealer sites
    └── routes import_queue items to:
        ├── extract-bat-core + extract-auction-comments (for BaT)
        └── process-import-queue (for everything else)

backfill-origin-vehicle-images (every 15 min)
    └── backfill-images → downloads images to storage
```

## Key Functions (APPROVED)

| Function | Purpose |
|----------|---------|
| `pipeline-orchestrator` | Main controller, runs everything |
| `extract-bat-core` | BaT Step 1: VIN, specs, images |
| `extract-auction-comments` | BaT Step 2: Comments and bids |
| `process-import-queue` | Generic URL extraction |
| `backfill-images` | Download images to storage |

## DEPRECATED - Don't Use These

- ❌ `comprehensive-bat-extraction`
- ❌ `import-bat-listing`
- ❌ `bat-extract-complete-v*`
- ❌ `bat-simple-extract`
- ❌ `extract-premium-auction` (replaced by extract-bat-core)

## Quick Debug

```bash
# Check GitHub Actions failures
gh run list --limit 20 --status failure

# View specific failure
gh run view <run_id> --log | tail -100
```

## Check Queue Health

```sql
-- Queue status
SELECT status, count(*) FROM import_queue GROUP BY status;
SELECT status, count(*) FROM bat_extraction_queue GROUP BY status;

-- Recent profiles
SELECT date_trunc('day', created_at) as day, count(*)
FROM vehicles
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY 1 ORDER BY 1 DESC;
```

## Common Fixes

| Problem | Fix |
|---------|-----|
| 504 timeout | Reduce batch_size in workflow |
| Invalid JWT | Redeploy function with verify_jwt: false |
| Stuck in processing | pipeline-orchestrator auto-unlocks after 15 min |
| No data extracted | Check API keys (FIRECRAWL, OPENAI, etc.) |

## Key Files

| File | Purpose |
|------|---------|
| `FUNCTION_MAP.md` | Complete function reference |
| `PIPELINE_STATUS.md` | Current issues and fixes |
| `.github/workflows/pipeline-orchestrator.yml` | Main cron |
| `supabase/functions/pipeline-orchestrator/index.ts` | Main controller |

## Budget

- $500 total for extraction
- Target: $0.003/profile
- Use direct fetch when possible (FREE)
- Firecrawl only when needed ($0.002/page)

## Rules

1. **Fix existing functions** - don't write new ones
2. **Check what's already built** - 200+ functions exist
3. **Small batch sizes** - prevent timeouts
4. **Trust FUNCTION_MAP.md** - other docs may be outdated

---

**Don't read more docs. Fix the one thing that's broken.**
