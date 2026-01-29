# Data Sources Status - Jan 19, 2026

## Summary

**Active & Working:** 7+ sources
**Autonomous Agents:** ENABLED (Ralph Wiggum mode)
**Target:** 33k profiles/day for 1M in 30 days

---

## AUTONOMOUS AGENTS (Ralph Wiggum Mode)

The following agents run every 2 hours via `autonomous-agents.yml`:

| Agent | Purpose | Target |
|-------|---------|--------|
| `database-fill-agent` | Fill database with vehicles | 2000/cycle (24k/day) |
| `autonomous-extraction-agent` | Extract from premium auctions | 33k/day |
| `unified-scraper-orchestrator` | Scrape ALL sources in `scrape_sources` table | All sources |

**How it works:**
1. Reads sources from `scrape_sources` table (where your URLs are stored)
2. Creates site maps for unmapped sources
3. Scrapes healthy sources
4. Processes queue
5. Self-monitors and scales up when below target

---

## ACTIVE SOURCES (Running & Succeeding)

| Source | Workflow | Schedule | Status |
|--------|----------|----------|--------|
| **BaT** | bat-scrape.yml | Every 6 hours | Working |
| **Mecum** | mecum-extraction.yml | Every 2 hours | Working |
| **KSL** | scrape-ksl-daily.yml | Daily 13:00 UTC | Working |
| **Organizations** | pipeline-orchestrator.yml | Every 10 min | Working |
| **Cars & Bids** | cars-and-bids-discovery.yml | Every 4 hours | NEW |
| **Classic.com** | classic-com-discovery.yml | Every 6 hours | NEW |
| **Craigslist** | craigslist-discovery.yml | Every 4 hours | NEW |

---

## RECENTLY FIXED

| Issue | Fix |
|-------|-----|
| Image backfill 504 timeout | Reduced batch_size to 1, max_images to 15 |

---

## NOT CONFIGURED (No Active Workflow)

### Auction Houses
- **Broad Arrow** - Has code, needs cron workflow
- **Barrett-Jackson** - Has code, needs cron workflow
- **RM Sotheby's** - Has code, needs cron workflow
- **Bonhams** - Has code, needs cron workflow
- **Gooding & Company** - Unknown status

### Marketplaces
- **eBay Motors** - Unknown
- **Facebook Marketplace** - Blocked (Graph API)
- **Autotrader Classics** - Unknown
- **Hemmings** - Unknown

### Specialist Sites
- **duPont Registry** - Has code, needs cron workflow
- **PCarMarket** - Has code, needs cron workflow

### Dealers
- 100+ dealer sites cataloged in `source_site_schemas` - NOT being scraped

---

## How Each Source Works

### BaT (Bring a Trailer)
```
bat-scrape.yml (every 6h)
  └── go-grinder → discovers listings
      └── import_queue → extract-bat-core + extract-auction-comments
```

### Cars & Bids
```
cars-and-bids-discovery.yml (every 4h)
  └── scrape-multi-source → discovers listings from /auctions/
      └── import_queue → process-import-queue
  └── sync-active-auctions → updates existing listings
```

### Classic.com
```
classic-com-discovery.yml (every 6h)
  └── scrape-multi-source → discovers listings from /auctions/
  └── discover-classic-sellers → finds dealers/auction houses
      └── import_queue → import-classic-auction
```

### Craigslist
```
craigslist-discovery.yml (every 4h)
  └── scrape-all-craigslist-squarebodies → discovers listings
  └── scrape-all-craigslist-2000-and-older → discovers pre-2000 vehicles
      └── import_queue → process-import-queue
```

### Mecum
```
mecum-extraction.yml (every 2h)
  └── specific extraction flow for Mecum auctions
```

### KSL
```
scrape-ksl-daily.yml (daily)
  └── scrape-ksl-listings → discovers listings
      └── import_queue → process-import-queue
```

### Organizations/Dealers
```
pipeline-orchestrator.yml (every 10 min)
  └── extract-all-orgs-inventory → scrapes 5 org sites
  └── sync-active-auctions → syncs BaT/C&B active listings
  └── routes import_queue to extractors
```

---

## Key Functions Reference

| Function | Purpose | Used By |
|----------|---------|---------|
| `go-grinder` | BaT discovery + extraction | bat-scrape.yml |
| `scrape-multi-source` | Generic source discovery | C&B, Classic.com |
| `extract-bat-core` | BaT data extraction | pipeline-orchestrator |
| `extract-auction-comments` | BaT comments | pipeline-orchestrator |
| `process-import-queue` | Generic URL extraction | pipeline-orchestrator |
| `sync-active-auctions` | Updates existing listings | pipeline-orchestrator |
| `backfill-images` | Downloads images to storage | backfill_origin_vehicle_images |

---

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

-- Recent profiles by source
SELECT
  profile_origin,
  date_trunc('day', created_at) as day,
  count(*) as profiles
FROM vehicles
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY 1, 2
ORDER BY 2 DESC, 3 DESC;
```

---

## Action Items

1. ~~Fix image backfill timeout~~ DONE
2. ~~Add Cars & Bids scheduled workflow~~ DONE
3. ~~Add Craigslist scheduled workflow~~ DONE
4. ~~Add Classic.com scheduled workflow~~ DONE
5. [ ] Enable Broad Arrow, Barrett-Jackson workflows
6. [ ] Enable duPont Registry, PCarMarket workflows
7. [ ] Create monitoring dashboard showing profiles/day by source
