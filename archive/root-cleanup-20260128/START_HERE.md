# START HERE - For Any LLM

**Updated:** Jan 19, 2026

## What This System Does

Extracts vehicle data from auction sites (BaT, Cars & Bids, Mecum, etc.) and stores it in Supabase.

## AUTONOMOUS AGENTS (Ralph Wiggum Mode)

**These agents run every 2 hours and do everything automatically:**

```
autonomous-agents.yml (every 2 hours)
├── database-fill-agent → Target: 2000 vehicles/cycle (24k/day)
├── autonomous-extraction-agent → Target: 33k/day
└── unified-scraper-orchestrator → Scrapes ALL sources in scrape_sources table
```

**The agents:**
1. Read URLs from `scrape_sources` and `businesses` tables
2. Auto-create site maps for new sources
3. Scrape healthy sources
4. Process the import queue
5. Self-monitor and scale up when below target

**To add a new source:** Insert it into `scrape_sources` table - the agents will find it.

## The Core Pipeline

```
DISCOVERY (Scheduled Workflows - find new listings)
├── bat-scrape.yml (every 6h) → go-grinder
├── cars-and-bids-discovery.yml (every 4h) → scrape-multi-source
├── classic-com-discovery.yml (every 6h) → scrape-multi-source
├── craigslist-discovery.yml (every 4h) → scrape-all-craigslist-*
├── mecum-extraction.yml (every 2h)
└── scrape-ksl-daily.yml (daily)

PROCESSING (pipeline-orchestrator every 10 min)
├── sync-active-auctions → syncs existing listings
├── extract-all-orgs-inventory → scrapes dealer sites
└── routes import_queue items to extractors:
    ├── extract-bat-core + extract-auction-comments (for BaT)
    ├── import-classic-auction (for Classic.com)
    └── process-import-queue (for everything else)

IMAGE BACKFILL (every 15 min)
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
| `DATA_SOURCES_STATUS.md` | Which sources are flowing data |
| `.github/workflows/pipeline-orchestrator.yml` | Main controller cron |
| `.github/workflows/bat-scrape.yml` | BaT discovery |
| `.github/workflows/cars-and-bids-discovery.yml` | C&B discovery |
| `.github/workflows/craigslist-discovery.yml` | Craigslist discovery |
| `supabase/functions/pipeline-orchestrator/index.ts` | Main controller |
| `supabase/functions/_shared/select-processor.ts` | URL routing logic |

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
