# BaT Organization Extraction Workflow

## Overview

This workflow demonstrates how to extract all BaT listings from an organization's member profile and import them into the n-zero database. Used for Fantasy Junction (~486 listings) but works for any BaT member profile.

## Key Insight: Smart Delays > IP Rotation

**BaT is lenient** - you don't need expensive proxy services. Human-like delays with randomization are sufficient to avoid blocks.

### Strategy
- **Base delay**: 8 seconds
- **Random variation**: ±5 seconds (makes it look human)
- **Gradual slowdown**: Gets slightly slower over time (people get tired)
- **Thinking breaks**: 15-25 second break every 5 listings
- **Result**: Works perfectly with direct IP, no blocks

## Scripts

### 1. Create Organization: `scripts/create-fantasy-junction-org.js`

Creates the organization record in the database.

```bash
node scripts/create-fantasy-junction-org.js
```

**What it does:**
- Checks if organization already exists
- Creates organization using `extract-organization-from-seller` edge function (falls back to manual creation)
- Enriches with website data using `update-org-from-website`
- Creates BaT identity link

**Prerequisites:**
- `.env` file with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
- Organization website URL (optional, for enrichment)

### 2. Extract & Import Listings: `scripts/scrape-all-fantasy-junction-bat-playwright.js`

**Main script** - Extracts all listings from BaT profile and imports them.

```bash
# Test with 5 listings
node scripts/scrape-all-fantasy-junction-bat-playwright.js 5

# Process all listings found
node scripts/scrape-all-fantasy-junction-bat-playwright.js --full
```

**What it does:**

1. **Step 1: Extract all listing URLs** (Playwright)
   - Navigates to BaT member profile page
   - Clicks "Show more" repeatedly until all listings loaded (auto-detects when done)
   - Extracts all unique listing URLs (found 486 for Fantasy Junction)

2. **Step 2: Process each listing** (Approved two-step workflow)
   - `extract-premium-auction` - Core vehicle data (VIN, specs, images, auction data)
   - `extract-auction-comments` - Comments and bids (non-critical, may fail in free mode)
   - Links vehicle to organization with `'consigner'` relationship type

3. **Smart delays between listings:**
   - Variable delays (5-13 seconds) to avoid patterns
   - Thinking breaks every 5 listings
   - Gradual slowdown over time

**Configuration:**

```bash
# Environment variables (optional, for extra safety)
export USE_TOR=true              # Auto-detect Tor on port 9050 (install: brew install tor && tor)
export TOR_PORT=9050             # Tor SOCKS5 port
export VPN_SOCKS5_PROXY=host:port # VPN SOCKS5 endpoint
export CUSTOM_PROXY_LIST=host1:port1,host2:port2  # Custom proxies
export USE_FREE_PROXIES=true     # Auto-fetch free proxies (default: true)

# Paid options (only if needed)
export BRIGHT_DATA_CUSTOMER_ID=xxx
export BRIGHT_DATA_PASSWORD=xxx
export OXYLABS_USER=xxx
export OXYLABS_PASSWORD=xxx
```

**Note:** Script works fine without any proxy configuration - smart delays are sufficient for BaT.

## Workflow Steps

### Step 1: Create Organization

```bash
cd /Users/skylar/nuke
node scripts/create-fantasy-junction-org.js
```

**Output:**
- Organization ID (save this for next step)
- Organization created/updated
- BaT identity link created

### Step 2: Extract All Listings

```bash
# Test with small sample first
node scripts/scrape-all-fantasy-junction-bat-playwright.js 5

# If test works, run full extraction
node scripts/scrape-all-fantasy-junction-bat-playwright.js --full
```

**What to expect:**
- Playwright loads BaT profile page
- Clicks "Show more" 50-100 times (depends on listing count)
- Extracts all listing URLs (486 for Fantasy Junction)
- Processes each listing one at a time with smart delays
- Links vehicles to organization automatically
- Prints summary at end

**Timeline:**
- ~486 listings × ~8s average = ~65 minutes base
- Plus extraction time = ~90-120 minutes total
- Background process, logs to `/tmp/fantasy-junction-import.log`

### Step 3: Monitor Progress

```bash
# Watch live progress
tail -f /tmp/fantasy-junction-import.log

# Check recent activity
tail -50 /tmp/fantasy-junction-import.log | grep -E "(Processing|Vehicle|Summary)"

# Check if still running
ps aux | grep scrape-all-fantasy-junction-bat-playwright
```

### Step 4: Verify Results

```bash
# View organization profile
open https://n-zero.dev/org/{ORG_ID}

# Check vehicle count
# (Query database or check org profile page)
```

## Technical Details

### Smart Delay Strategy

The script uses intelligent delays that mimic human behavior:

```javascript
const BASE_DELAY = 8000;           // 8 seconds base
const RANDOM_DELAY = 5000;         // ±5 seconds randomization
const DELAY_MULTIPLIER = 1.02;     // Gradual slowdown

// Formula:
// delay = (BASE_DELAY * progressMultiplier) + randomVariation
// - Minimum: 3 seconds (never too fast)
// - Maximum: ~13 seconds (varies with progress)
// - Plus: 15-25s break every 5 listings
```

**Why it works:**
- BaT doesn't have aggressive anti-scraping (unlike KSL with PerimeterX)
- Variable delays avoid detection patterns
- Human-like behavior (breaks, slowdowns) passes rate limit checks
- No need for IP rotation or expensive proxies

### Free Proxy Options

If you want extra safety (optional):

1. **Tor (Best free option)**
   ```bash
   brew install tor
   tor  # Runs on port 9050
   # Script auto-detects and uses it
   ```

2. **Free proxy APIs** (already enabled by default)
   - ScrapingAnt free proxy API
   - Geonode free proxy API
   - Auto-fetches and rotates

3. **VPN SOCKS5** (if your VPN provides it)
   ```bash
   export VPN_SOCKS5_PROXY=127.0.0.1:1080
   ```

### Approved Extraction Workflow

Always use the **two-step approved workflow**:

1. **Step 1: `extract-premium-auction`**
   - Extracts core vehicle data
   - Uses direct HTML fetch + regex parsing (FREE MODE, no paid APIs)
   - Returns `vehicle_id`, `created_vehicle_ids`, `updated_vehicle_ids`

2. **Step 2: `extract-auction-comments`** (non-critical)
   - Extracts comments and bids
   - Uses direct HTML fetch (FREE MODE)
   - May fail in free mode (non-critical, can skip)

**Never use:**
- `process-import-queue` (hits 504 timeouts)
- `bulk-importer` (not reliable)
- Direct database inserts (bypasses validation)

## Results: Fantasy Junction Example

### Input
- BaT Username: `fantasyjunction`
- BaT Profile: `https://bringatrailer.com/member/fantasyjunction/`
- Expected Listings: 477 (BaT shows this on profile)

### Output
- **Listings Found**: 486 (Playwright found more than BaT displays)
- **Listings Processed**: 486
- **Vehicles Created/Updated**: ~486
- **Organization Links**: ~486 (all linked as 'consigner')
- **Time**: ~90-120 minutes
- **Blocks**: 0 (smart delays worked perfectly)

### Organization Details
- **ID**: `1d9122ea-1aaf-46ea-81ea-5f75cb259b69`
- **Name**: Fantasy Junction
- **Website**: https://fantasyjunction.com
- **Type**: Dealership
- **Location**: Emeryville, CA
- **BaT Identity**: `fantasyjunction` (linked)

## Troubleshooting

### Issue: Script hangs on "Show more" clicks

**Solution:** BaT might have changed their UI. Check the button selector:
```javascript
// In script, look for:
page.locator('button:has-text("Show more")').first();
```

### Issue: Getting rate limited/blocked

**Solution:** Increase delays:
```javascript
const BASE_DELAY = 12000;  // Increase from 8000
const RANDOM_DELAY = 8000; // Increase from 5000
```

Or enable Tor:
```bash
brew install tor && tor
# Script will auto-detect
```

### Issue: Only getting 25 listings instead of 477+

**Problem:** Using direct HTML fetch (no JavaScript)

**Solution:** Use the Playwright script, not the basic fetch script. The Playwright script clicks "Show more" to load all listings.

### Issue: Vehicles not linking to organization

**Check:**
1. Organization ID is correct in script
2. `organization_vehicles` table relationship type is valid ('consigner', 'seller', etc.)
3. Vehicle exists (check `extract-premium-auction` returned vehicle_id)

### Issue: Comments extraction always failing

**This is normal in free mode!** The `extract-auction-comments` function may fail because:
- It tries direct HTML fetch (no JavaScript rendering)
- BaT comments may require JS rendering
- This is **non-critical** - core vehicle data is what matters

## Adapting for Other Organizations

To extract listings from a different BaT member:

1. **Update organization creation script:**
   ```javascript
   const BAT_USERNAME = 'their-username';
   const BAT_MEMBER_URL = `https://bringatrailer.com/member/${BAT_USERNAME}/`;
   const ORG_ID = 'their-org-id';
   ```

2. **Update extraction script:**
   ```javascript
   const BAT_USERNAME = 'their-username';
   const ORG_ID = 'their-org-id';
   ```

3. **Run same workflow:**
   ```bash
   node scripts/create-fantasy-junction-org.js  # Update first
   node scripts/scrape-all-fantasy-junction-bat-playwright.js --full
   ```

## Lessons Learned

1. **Smart delays > IP rotation for BaT** - Human-like delays work perfectly, no proxy needed
2. **Playwright is essential** - BaT uses JavaScript pagination, need to click "Show more"
3. **Free mode works** - Both `extract-premium-auction` and `extract-auction-comments` work in free mode (direct HTML fetch)
4. **Comments extraction failures are OK** - Non-critical, core data is what matters
5. **Organization linking uses 'consigner'** - For past BaT auction listings
6. **BaT is lenient** - Unlike KSL, BaT doesn't have aggressive anti-scraping

## Related Documentation

- [BAT_EXTRACTION_SUCCESS_WORKFLOW.md](./BAT_EXTRACTION_SUCCESS_WORKFLOW.md) - Approved extraction workflow details
- [BUDGET_CONSTRAINTS_FREE_MODE.md](./BUDGET_CONSTRAINTS_FREE_MODE.md) - Free mode strategies
- [QUEUE_EXPLAINED.md](../QUEUE_EXPLAINED.md) - Queue system (don't use for this)

## Future Improvements

- [ ] Add retry logic for failed extractions
- [ ] Batch processing option (faster but riskier)
- [ ] Resume capability (save progress, resume on crash)
- [ ] Better error reporting (categorize failures)
- [ ] Parallel processing with rate limiting (process N listings at once)

