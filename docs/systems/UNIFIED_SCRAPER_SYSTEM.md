# Unified Scraper System - End-to-End Accountability

## The Problem

**Current state:**
- Multiple scraper functions that don't work together
- No visibility into what's actually happening
- New sources don't automatically ingest
- Broken tools, no accountability
- Can't see if data is actually flowing into DB

## The Solution

**Unified system with end-to-end accountability:**

```
1. SOURCE REGISTRATION
   ↓ (scrape_sources table)
   
2. THOROUGH SITE MAPPING
   ↓ (site_maps table - 95%+ coverage)
   
3. DISCOVERY & QUEUEING
   ↓ (scrape-* functions → import_queue)
   
4. PROCESSING
   ↓ (process-import-queue → vehicles table)
   
5. TRACKING & MONITORING
   ↓ (Real-time accountability dashboard)
```

---

## Core Flow

### 1. Source Registration (`scrape_sources` table)

**Every source must be registered:**
```sql
INSERT INTO scrape_sources (
  domain,
  url,
  source_name,
  source_type,
  scraper_function,
  is_active,
  metadata
) VALUES (...);
```

**Fields:**
- `scraper_function`: Which Edge Function to use (e.g., 'scrape-sbxcars', 'scrape-multi-source')
- `is_active`: Whether to scrape this source
- `metadata`: Site map reference, extraction config, etc.

### 2. Thorough Site Mapping (`site_maps` table)

**Before ingestion, every source needs:**
- Complete site map (95%+ field coverage)
- Field mappings
- Extraction rules

**Created by:** `thorough-site-mapper` function

### 3. Discovery & Queueing

**Scraper functions discover listings and add to `import_queue`:**

- `scrape-sbxcars` → discovers SBX Cars listings
- `scrape-dupontregistry` → discovers duPont Registry listings
- `scrape-multi-source` → generic scraper for any site

**All add to `import_queue` with:**
- `listing_url`
- `source_id` (links to scrape_sources)
- `raw_data` (extracted data)
- `status: 'pending'`

### 4. Processing

**`process-import-queue` processes queue items:**
- Claims batch of items (atomic locking)
- Scrapes each listing
- Creates vehicle records
- Creates organizations
- Creates external identities
- Updates status: 'complete' or 'failed'

### 5. Tracking & Monitoring

**Real-time accountability:**
- Source health (is it working?)
- Queue depth (how many pending?)
- Processing rate (vehicles/hour)
- Success rate (what's failing?)
- Data quality (completeness, accuracy)

---

## Unified Orchestrator

### `unified-scraper-orchestrator`

**Single entry point that handles everything:**

```typescript
POST /functions/v1/unified-scraper-orchestrator
{
  "action": "run_cycle" | "add_source" | "check_health" | "get_status"
}
```

**What it does:**

1. **Checks all active sources**
   - Are they mapped? (site_maps table)
   - Are they healthy? (recent successful scrapes)
   - Do they have pending queue items?

2. **Runs scrapers for active sources**
   - Invokes appropriate scraper function
   - Monitors progress
   - Tracks results

3. **Processes queue**
   - Runs process-import-queue
   - Monitors processing rate
   - Tracks failures

4. **Reports accountability**
   - Vehicles added this cycle
   - Sources active
   - Queue depth
   - Success rates
   - Issues found

---

## Accountability Dashboard

### Real-Time Tracking

**Shows:**
1. **Sources Status**
   - Active sources (green/yellow/red)
   - Last scrape time
   - Success rate
   - Queue depth per source

2. **Queue Status**
   - Total pending
   - Processing rate
   - Success/failure rates
   - Recent activity

3. **Database Growth**
   - Vehicles added today
   - Vehicles added this hour
   - Total vehicles
   - Growth rate

4. **Issues & Alerts**
   - Sources not scraping
   - High failure rates
   - Queue stuck
   - Data quality issues

---

## Adding a New Source

### Step-by-Step (Automated)

**1. Register source:**
```sql
INSERT INTO scrape_sources (domain, url, source_name, scraper_function, is_active)
VALUES ('newsite.com', 'https://newsite.com', 'New Site', 'scrape-multi-source', false);
```

**2. Create thorough site map:**
```bash
POST /functions/v1/thorough-site-mapper
{
  "source_url": "https://newsite.com",
  "create_complete_map": true
}
```

**3. Activate source:**
```sql
UPDATE scrape_sources SET is_active = true WHERE domain = 'newsite.com';
```

**4. Run orchestrator:**
```bash
POST /functions/v1/unified-scraper-orchestrator
{
  "action": "run_cycle"
}
```

**That's it. System handles the rest.**

---

## Monitoring & Inspection

### Database Queries

**Check source health:**
```sql
SELECT 
  domain,
  is_active,
  last_successful_scrape,
  (SELECT COUNT(*) FROM import_queue WHERE source_id = scrape_sources.id AND status = 'pending') as pending_count,
  (SELECT COUNT(*) FROM import_queue WHERE source_id = scrape_sources.id AND status = 'complete') as completed_count
FROM scrape_sources
ORDER BY last_successful_scrape DESC NULLS LAST;
```

**Check queue status:**
```sql
SELECT 
  status,
  COUNT(*) as count,
  COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour') as last_hour
FROM import_queue
GROUP BY status;
```

**Check recent vehicles:**
```sql
SELECT 
  discovery_source,
  COUNT(*) as count,
  MAX(created_at) as latest
FROM vehicles
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY discovery_source
ORDER BY count DESC;
```

### Dashboard Endpoint

**GET `/admin/scraper-status`**

Returns:
```json
{
  "sources": [
    {
      "domain": "sbxcars.com",
      "status": "active",
      "last_scrape": "2025-12-24T18:00:00Z",
      "queue_pending": 150,
      "queue_processed": 5000,
      "success_rate": 0.95
    }
  ],
  "queue": {
    "pending": 500,
    "processing": 10,
    "complete": 50000,
    "failed": 100
  },
  "database": {
    "total_vehicles": 100000,
    "vehicles_today": 2000,
    "vehicles_last_hour": 150
  },
  "health": {
    "all_sources_healthy": true,
    "queue_processing": true,
    "on_target": true
  }
}
```

---

## Fixing Broken Integration

### Issues to Fix

1. **Scrapers don't register sources**
   - Fix: All scrapers must create/update scrape_sources entry

2. **No site mapping before scraping**
   - Fix: Orchestrator checks for site_map before running scraper

3. **Queue not processing**
   - Fix: Orchestrator automatically runs process-import-queue

4. **No visibility**
   - Fix: Real-time dashboard shows everything

5. **New sources don't work**
   - Fix: Unified flow handles new sources automatically

---

## Implementation

### 1. Unified Orchestrator Function

**`unified-scraper-orchestrator/index.ts`**
- Checks all sources
- Runs scrapers
- Processes queue
- Reports status

### 2. Enhanced Scraper Functions

**All scrapers must:**
- Register/update scrape_sources
- Check for site_map
- Add to import_queue
- Report results

### 3. Accountability Dashboard

**Enhanced ScraperDashboard:**
- Real-time source status
- Queue monitoring
- Database growth
- Issue alerts

### 4. Database Tracking

**New tables/views:**
- `scraper_runs` - Track each scraper execution
- `source_health` - Track source health over time
- `queue_metrics` - Track queue processing metrics

---

## Summary

**Unified system that:**
- ✅ Registers all sources
- ✅ Maps all sites thoroughly
- ✅ Discovers and queues listings
- ✅ Processes queue automatically
- ✅ Tracks everything in real-time
- ✅ Shows accountability dashboard
- ✅ Handles new sources automatically

**No more broken tools. Real accountability. Data actually flows into DB.**

