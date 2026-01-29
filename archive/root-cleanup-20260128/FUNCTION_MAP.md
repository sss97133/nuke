# Function Map for Zero-Context LLMs

**READ THIS FIRST** when working on data extraction.

## AUTONOMOUS AGENTS (Ralph Wiggum Mode)

These run every 2 hours and do everything automatically:

| Agent | Purpose | Target |
|-------|---------|--------|
| `database-fill-agent` | Fill database with vehicles | 2000/cycle |
| `autonomous-extraction-agent` | Premium auction extraction | 33k/day |
| `unified-scraper-orchestrator` | Scrape ALL sources in `scrape_sources` table | All sources |

**Source of truth:** `scrape_sources` table contains URLs to scrape.

---

## The Core Pipeline

```
DISCOVERY → QUEUE → EXTRACTION → STORAGE → BACKFILL
```

### 1. DISCOVERY (Finding new listings)
| Function | Purpose | Triggers |
|----------|---------|----------|
| `go-grinder` | BaT discovery + extraction | bat-scrape.yml |
| `scrape-multi-source` | Generic source discovery (C&B, Classic.com) | cars-and-bids-discovery.yml, classic-com-discovery.yml |
| `scrape-all-craigslist-squarebodies` | Craigslist squarebody discovery | craigslist-discovery.yml |
| `scrape-all-craigslist-2000-and-older` | Craigslist pre-2000 discovery | craigslist-discovery.yml |
| `sync-active-auctions` | Sync existing BaT/C&B listings | pipeline-orchestrator |
| `extract-all-orgs-inventory` | Scrape dealer inventory sites | pipeline-orchestrator |
| `discover-classic-sellers` | Find Classic.com dealers/auction houses | classic-com-discovery.yml |

### 2. QUEUE (Pending work)
| Table | Purpose |
|-------|---------|
| `import_queue` | Raw listing URLs waiting to be extracted |
| `bat_extraction_queue` | BaT listings needing full extraction |

### 3. EXTRACTION (Turning URLs into data)

**For BaT (APPROVED extractors - DO NOT CHANGE):**
| Function | Purpose |
|----------|---------|
| `extract-bat-core` | Step 1: VIN, specs, images, auction_events |
| `extract-auction-comments` | Step 2: Comments and bids |

**For other sources:**
| Function | Purpose |
|----------|---------|
| `process-import-queue` | Generic queue processor |
| `scrape-vehicle-with-firecrawl` | Single URL extraction |

### 4. IMAGE STORAGE
| Function | Purpose |
|----------|---------|
| `backfill-images` | Download images to Supabase storage |
| `backfill-origin-vehicle-images` | Orchestrates backfill-images for vehicles missing images |

## Orchestration

**THE MAIN CONTROLLER:** `pipeline-orchestrator`
- Runs every 10 minutes via GitHub Actions
- Unlocks stuck queue items
- Triggers scrapers
- Routes queue items to correct extractors

## GitHub Actions Workflows

| Workflow | Schedule | Purpose |
|----------|----------|---------|
| **`autonomous-agents.yml`** | **Every 2 hours** | **MAIN: Runs all autonomous agents** |
| `pipeline-orchestrator.yml` | Every 10 min | Queue processing and routing |
| `backfill_origin_vehicle_images.yml` | Every 15 min | Image backfill |
| `bat-scrape.yml` | Every 6 hours | BaT discovery |
| `cars-and-bids-discovery.yml` | Every 4 hours | Cars & Bids discovery |
| `classic-com-discovery.yml` | Every 6 hours | Classic.com discovery |
| `craigslist-discovery.yml` | Every 4 hours | Craigslist discovery |
| `mecum-extraction.yml` | Every 2 hours | Mecum extraction |
| `scrape-ksl-daily.yml` | Daily | KSL discovery |

## Common Issues & Fixes

### "504 Timeout"
**Cause:** Function taking too long
**Fix:** Reduce `batch_size` or `max_images_per_vehicle` in the workflow

### "Invalid JWT"
**Cause:** Function deployed with `verify_jwt: true` but called with service key
**Fix:** Redeploy with `verify_jwt: false` in config.toml

### "Queue items stuck in processing"
**Cause:** Function crashed without releasing lock
**Fix:** `pipeline-orchestrator` auto-unlocks items older than 15 min

### "No data extracted"
**Cause:** Usually wrong function or missing API key
**Check:**
1. Is the right function being called for this source?
2. Are FIRECRAWL_API_KEY, OPENAI_API_KEY etc. set?
3. Check Supabase function logs

## What NOT to Do

1. **DON'T write new extraction functions** - fix existing ones
2. **DON'T use deprecated BaT functions:**
   - ❌ `comprehensive-bat-extraction`
   - ❌ `import-bat-listing`
   - ❌ `bat-extract-complete-v*`
3. **DON'T call functions with large batch sizes** - causes timeouts

## Quick Debugging

```bash
# Check recent GitHub Actions failures
gh run list --limit 20 --status failure

# View specific failure
gh run view <run_id> --log | tail -100

# Check queue depths
# (run in Supabase SQL editor)
SELECT status, count(*) FROM import_queue GROUP BY status;
SELECT status, count(*) FROM bat_extraction_queue GROUP BY status;
```

## Key Files

| File | Purpose |
|------|---------|
| `supabase/functions/pipeline-orchestrator/index.ts` | Main controller |
| `supabase/functions/_shared/approved-extractors.ts` | List of approved BaT functions |
| `supabase/functions/_shared/select-processor.ts` | Routes URLs to correct extractor |
| `.github/workflows/pipeline-orchestrator.yml` | Cron trigger |

---
**Last updated:** Jan 19, 2026
