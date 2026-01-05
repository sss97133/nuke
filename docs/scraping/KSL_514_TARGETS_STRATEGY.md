# KSL 514 Targets: Extraction Strategy

## Current Situation

**Target:** 514 KSL vehicles (1964-1991)

**Challenge:** PerimeterX blocks search pages more aggressively than detail pages
- ✅ Detail pages: 100% success with Playwright stealth
- ❌ Search pages: Blocked (even with stealth)

## Root Cause

PerimeterX uses different detection levels:
- **Search pages**: High scrutiny (many bots scrape search results)
- **Detail pages**: Lower scrutiny (humans browse individual listings)

Even with identical stealth settings, search pages trigger blocks while detail pages don't.

## Scale Solution Options

### Option 1: Manual URL Collection + Batch Import ⭐ RECOMMENDED

**How:**
1. Manually browse KSL search (as a human)
2. Export listing URLs from browser console
3. Feed URLs to batch detail scraper
4. Extract full data + images with Playwright

**Browser Console Script:**
```javascript
// Run this on https://cars.ksl.com/search/yearFrom/1964/yearTo/1991
const urls = [];
document.querySelectorAll('a[href*="/listing/"]').forEach(link => {
  const href = link.getAttribute('href');
  if (href && href.includes('/listing/')) {
    const url = href.startsWith('/') ? `https://cars.ksl.com${href}` : href;
    urls.push(url.split('?')[0]);
  }
});

// Deduplicate
const unique = [...new Set(urls)];
console.log(`Found ${unique.length} listings`);

// Copy to clipboard
copy(JSON.stringify(unique, null, 2));
console.log('URLs copied to clipboard!');
```

**Then:**
```bash
# Save URLs to file
pbpaste > data/ksl-listing-urls.json

# Process all URLs
node scripts/process-ksl-url-list.js data/ksl-listing-urls.json
```

**Pros:**
- ✅ 100% success (detail pages work perfectly)
- ✅ No proxy costs
- ✅ Can process all 514 in one session

**Cons:**
- ❌ Manual step (10-15 minutes to collect URLs)
- ❌ Need to click through ~11 pages

### Option 2: Browser Extension for URL Collection

**How:**
1. Create Chrome extension
2. Extension collects URLs while you browse
3. Auto-sends to API endpoint
4. Batch processes with Playwright

**Time to build:** 2-4 hours
**Best for:** Ongoing daily monitoring

### Option 3: Use KSL RSS/Sitemap (If Available)

**Check:**
```bash
curl -s https://cars.ksl.com/sitemap.xml
curl -s https://cars.ksl.com/rss
curl -s https://cars.ksl.com/robots.txt
```

**If sitemap exists:** Parse XML for listing URLs (no PerimeterX)

### Option 4: Bright Data Proxies (Paid)

**Cost:** $300-500/mo
**Success:** 95-99% on search pages
**Only if:** Manual collection not acceptable

## Recommended Workflow (Hybrid)

### Initial Import (Once)

1. **Collect URLs manually** (10-15 min)
   - Browse all 11 pages of search results
   - Run browser console script on each page
   - Combine into single JSON file

2. **Batch process with Playwright** (2-4 hours)
   - Feed URLs to detail scraper
   - Extract all data + images
   - Import to database
   - 100% success rate

### Daily Monitoring (Automated)

1. **Manual check once/day** (2 min)
   - Visit page 1 of search results
   - Run console script
   - Check for new URLs

2. **Auto-process new listings**
   - Cron job checks `import_queue`
   - Processes with Playwright
   - Fully automated after URLs are queued

### Alternative: Headless Browser on Interval

**If search pages work with longer delays:**
```javascript
// Try scraping search with 60-second wait between pages
for (const pageNum of [1, 2, 3, ...]) {
  const listings = await scrapePage(pageNum);
  await sleep(60000); // Full minute between pages
}
```

**Success probability:** 30-50% (worth testing)

## Immediate Action Plan

### Step 1: Test Search Page with Long Wait

```bash
# Test if 60s wait helps
node scripts/test-ksl-search-long-wait.js
```

### Step 2a: If Works
- Run full automated scraper
- Set wait to 60s between search pages
- Process all 514 automatically

### Step 2b: If Still Blocked
- Use manual URL collection (Option 1)
- 10-15 min one-time collection
- Then automated processing

### Step 3: Setup Daily Monitor

```javascript
// Daily: Check import_queue for new KSL URLs
// Process with Playwright (100% success on details)
// No need to scrape search pages daily
```

## Files Needed

### Create: `scripts/process-ksl-url-list.js`
```javascript
// Takes JSON file of URLs
// Processes each with Playwright detail scraper
// Imports to database with images
```

### Create: `scripts/test-ksl-search-long-wait.js`
```javascript
// Test if 60-90s wait bypasses search page blocks
```

### Update: `scripts/monitor-ksl-daily.js`
```javascript
// Check import_queue instead of scraping search
// Process any new KSL URLs
```

## Expected Results

**Manual Collection + Batch:**
- Time: 15 min (collection) + 4 hours (processing)
- Success: 100%
- Cost: $0

**Automated Search (if 60s wait works):**
- Time: 8-12 hours (fully automated)
- Success: 30-80% (TBD)
- Cost: $0

**Bright Data (if automation required):**
- Time: 4-6 hours
- Success: 95%+
- Cost: $300-500/mo

Let me know which approach you prefer and I'll implement it!

