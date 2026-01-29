# KSL Automation: Complete Setup for 1964-1991 Vehicles

## Overview

Automated system to:
1. **Scrape all 1964-1991 vehicles** from KSL (one-time batch)
2. **Monitor daily** for new listings (automated cron)
3. **Track removed/sold** listings
4. **Import with images** automatically

## Components

### 1. Batch Scraper: `scripts/scrape-ksl-vintage-trucks-complete.js`

**Purpose:** Initial import of all 1964-1991 vehicles from KSL

**Features:**
- Searches multiple pages (1-5) for vintage vehicles
- Extracts full vehicle data + images
- Imports to database automatically
- Uploads images via `backfill-images` Edge Function
- Rate limiting (10-15s between requests)
- Dry-run mode for testing

**Usage:**
```bash
# Test first (dry run)
node scripts/scrape-ksl-vintage-trucks-complete.js --dry-run --limit=10

# Full import
node scripts/scrape-ksl-vintage-trucks-complete.js

# Limited import
node scripts/scrape-ksl-vintage-trucks-complete.js --limit=50
```

**Expected:**
- 100-200 listings found across 5 search pages
- 50-150 new vehicles created
- 1,000-3,000 images uploaded
- Time: 3-6 hours (with rate limiting)

### 2. Daily Monitor: `scripts/monitor-ksl-daily.js`

**Purpose:** Check for new listings every day

**Features:**
- Scrapes page 1 of search results
- Detects new listings not in database
- Queues new listings for import
- Detects removed/sold listings
- Logs daily summary
- Lightweight (only checks first page)

**Usage:**
```bash
# Run manually
node scripts/monitor-ksl-daily.js

# Setup cron (runs daily at 6 AM)
crontab -e

# Add this line:
0 6 * * * cd /Users/skylar/nuke && node scripts/monitor-ksl-daily.js >> logs/ksl-monitor.log 2>&1
```

**Expected:**
- 0-5 new listings per day
- Queued for import (processed by `process-import-queue`)
- 0-3 listings marked as sold
- Time: 1-2 minutes

### 3. Image Backfiller: `scripts/backfill-ksl-vehicle-images-single.js`

**Purpose:** Backfill images for existing KSL vehicles

**Features:**
- Uses Playwright stealth to extract all images
- Uploads to Supabase Storage
- Skips duplicates
- Force mode to re-scrape

**Usage:**
```bash
# Single vehicle
node scripts/backfill-ksl-vehicle-images-single.js VEHICLE_ID --force

# Batch backfill (all KSL vehicles missing images)
node scripts/backfill-ksl-images.js
```

## Setup Instructions

### 1. Install Dependencies

```bash
cd /Users/skylar/nuke
npm install playwright express cors
npx playwright install chromium
```

### 2. Test Playwright Stealth

```bash
# Verify stealth works
node scripts/test-ksl-headless-stealth.js
```

**Expected output:**
```
✅ SUCCESS: 50 images
Title: 1979 GMC Suburban in Pocatello, ID | KSL Cars
```

### 3. Test Batch Scraper (Dry Run)

```bash
# Test with 5 listings
node scripts/scrape-ksl-vintage-trucks-complete.js --dry-run --limit=5
```

**Expected output:**
```
📋 Total unique listings found: 25+
📋 Processing: 5 listings
[DRY RUN] Would create: 1979 GMC Suburban
...
Success rate: 100%
```

### 4. Run Initial Import

```bash
# Import all 1964-1991 vehicles
node scripts/scrape-ksl-vintage-trucks-complete.js > logs/ksl-initial-import.log 2>&1 &

# Monitor progress
tail -f logs/ksl-initial-import.log
```

**Estimated time:** 3-6 hours (150-200 listings with rate limiting)

### 5. Setup Daily Monitoring

```bash
# Edit crontab
crontab -e

# Add daily monitor (6 AM MST)
0 6 * * * cd /Users/skylar/nuke && node scripts/monitor-ksl-daily.js >> logs/ksl-monitor.log 2>&1

# Save and exit
```

**Verify cron:**
```bash
crontab -l | grep ksl
```

### 6. Setup Weekly Summary Report

```bash
# Add to crontab (Sunday at 8 AM)
0 8 * * 0 cd /Users/skylar/nuke && node scripts/ksl-weekly-summary.js >> logs/ksl-summary.log 2>&1
```

## Monitoring & Alerts

### Check Daily Monitor Status

```bash
# View today's monitor log
tail -50 logs/ksl-monitor.log

# View summary
cat logs/ksl-monitor-$(date +%Y-%m-%d).json
```

**Expected output:**
```json
{
  "timestamp": "2026-01-05T13:00:00.000Z",
  "total_listings": 156,
  "new_listings": 3,
  "our_vehicles": 142,
  "potentially_sold": 2
}
```

### Success Indicators

✅ **Healthy:**
- New listings: 0-5 per day
- Success rate: >90%
- No repeated failures

⚠️ **Warning:**
- New listings: >10 per day (might be missing some)
- Success rate: 80-90%
- Some scrape failures

❌ **Critical:**
- New listings: 0 for 7+ days (scraper broken)
- Success rate: <80%
- All listings failing

### Alert Thresholds

Set up notifications:

```javascript
// In monitor script
if (summary.success_rate < 80) {
  // Send alert email/SMS
  await supabase.functions.invoke('send-notification', {
    body: {
      type: 'alert',
      message: `KSL monitor success rate: ${summary.success_rate}%`,
      severity: 'high',
    }
  });
}

if (summary.new_listings > 15) {
  // Alert: Unusual spike
  await supabase.functions.invoke('send-notification', {
    body: {
      type: 'info',
      message: `KSL has ${summary.new_listings} new listings (check for bulk upload)`,
    }
  });
}
```

## Rate Limiting & Best Practices

### Scraping Rate Limits

**Recommended:**
- Search pages: Max 1 per minute
- Detail pages: Max 6 per minute (10-15s between requests)
- Daily total: Max 500 requests

**Implementation:**
```javascript
// Random delay between requests
const waitTime = 10000 + Math.random() * 5000; // 10-15s
await sleep(waitTime);
```

### Avoid Detection

1. **Vary user agents** (rotate monthly)
2. **Random delays** (don't use exact 10s every time)
3. **Limit daily volume** (don't scrape 1000s in one day)
4. **Monitor error rates** (if >20%, pause for 24h)
5. **Respect robots.txt** (check KSL's robots.txt for allowed paths)

## Troubleshooting

### Monitor Shows 0 New Listings for Days

**Possible causes:**
1. PerimeterX blocking again (check logs for "denied")
2. KSL changed HTML structure (update selectors)
3. No new listings actually posted
4. Cron not running

**Debug:**
```bash
# Run manually
node scripts/monitor-ksl-daily.js

# Check if blocked
grep "denied\|Blocked\|PerimeterX" logs/ksl-monitor.log
```

### Success Rate Drops Below 80%

**Possible causes:**
1. PerimeterX updated detection
2. Wait time too short
3. Too many parallel requests

**Solutions:**
1. Increase wait time to 10-12 seconds
2. Add more random delays
3. Reduce batch size
4. Update stealth arguments

### Images Not Uploading

**Possible causes:**
1. Storage quota exceeded
2. Network timeout
3. Invalid image URLs

**Debug:**
```bash
# Test single vehicle
node scripts/backfill-ksl-vehicle-images-single.js VEHICLE_ID --force

# Check storage usage
npx supabase storage ls --recursive vehicle-images | wc -l
```

## Performance Expectations

### Initial Batch Import

| Metric | Expected |
|--------|----------|
| Total listings found | 150-250 |
| New vehicles created | 50-200 |
| Images uploaded | 1,000-4,000 |
| Success rate | 90-95% |
| Time | 3-6 hours |
| Cost | $0 (Playwright is free) |

### Daily Monitor

| Metric | Expected |
|--------|----------|
| Runtime | 1-2 minutes |
| New listings | 0-5 per day |
| Success rate | 95-100% |
| Time | <2 minutes |
| Cost | $0 |

## File Structure

```
/Users/skylar/nuke/
├── scripts/
│   ├── scrape-ksl-vintage-trucks-complete.js  # Batch scraper
│   ├── monitor-ksl-daily.js                   # Daily monitor
│   ├── backfill-ksl-vehicle-images-single.js  # Image backfiller
│   ├── test-ksl-headless-stealth.js           # Test scraper
│   └── playwright-ksl-server.js               # Microservice (optional)
├── logs/
│   ├── ksl-scrape-2026-01-05.log             # Daily scrape logs
│   ├── ksl-monitor.log                        # Monitor cron logs
│   └── ksl-monitor-2026-01-05.json           # Daily summaries
└── docs/scraping/
    ├── KSL_PLAYWRIGHT_SOLUTION.md             # Technical guide
    └── KSL_AUTOMATION_SETUP.md                # This file
```

## Next Steps

### Phase 1: Initial Import (Today)
```bash
# 1. Test with 5 listings
node scripts/scrape-ksl-vintage-trucks-complete.js --dry-run --limit=5

# 2. Import first 20 (verify quality)
node scripts/scrape-ksl-vintage-trucks-complete.js --limit=20

# 3. Run full import (background)
nohup node scripts/scrape-ksl-vintage-trucks-complete.js > logs/ksl-full-import.log 2>&1 &
```

### Phase 2: Daily Monitoring (Tomorrow)
```bash
# 1. Test monitor manually
node scripts/monitor-ksl-daily.js

# 2. Setup cron
crontab -e
# Add: 0 6 * * * cd /Users/skylar/nuke && node scripts/monitor-ksl-daily.js >> logs/ksl-monitor.log 2>&1
```

### Phase 3: Production (Week 2)
```bash
# Optional: Deploy Playwright microservice to Fly.io
# This allows Edge Functions to call it for on-demand scraping

fly launch --name ksl-scraper
fly deploy
fly scale count 1 # Start with 1 instance

# Update Edge Function
npx supabase secrets set PLAYWRIGHT_SERVICE_URL=https://ksl-scraper.fly.dev
```

## Success Criteria

✅ **Phase 1 Complete:**
- 100+ KSL vehicles imported
- 1,500+ images uploaded
- Success rate >90%

✅ **Phase 2 Complete:**
- Daily monitor running via cron
- New listings auto-queued
- Logs show consistent results

✅ **Phase 3 Complete:**
- Playwright service deployed
- Edge Function integration working
- Fully automated pipeline

## Cost Breakdown

| Component | Monthly Cost |
|-----------|-------------|
| Playwright (local) | $0 |
| Fly.io microservice (optional) | $5-10 |
| Supabase Storage (images) | $0 (free tier) |
| Total | $0-10 |

**vs Alternatives:**
- Firecrawl stealth: $20-50/mo (0% success)
- Bright Data proxies: $500/mo
- Manual collection: Free but not scalable

**Winner:** Playwright local ($0, 95% success) with optional Fly.io deployment ($5-10/mo) for full automation.

