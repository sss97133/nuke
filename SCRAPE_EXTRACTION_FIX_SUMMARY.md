# Scrape & Extraction Fix Summary

## What I Found

### ✅ GOOD NEWS: Vehicles ARE Being Created!
- **686 vehicles created in the last 7 days**
- **20 vehicles created just today**
- Scrapers ARE running via GitHub Actions

### ❌ ISSUES IDENTIFIED

#### 1. BAT Seller Monitor Not Configured
The BAT scraper job is failing with:
```
Error: Scraped data file not found. Run scrape-viva-bat-listings.js first.
```
**Root Cause:** The `bat_seller_monitors` table doesn't have the Viva Las Vegas Autos seller configured.

#### 2. Vehicles Have `discovery_source: unknown`
867 vehicles have `discovery_source = 'unknown'` because the scrapers aren't setting this field properly.

#### 3. Missing Key Data
Even though vehicles are created, they're missing:
- VIN: Only 36.5% have it
- Mileage: Only 13%
- Color: Only 7.2%
- Engine: Only 11.9%

**Root Cause:** Basic scrapers use regex, not the comprehensive AI extraction.

#### 4. Vercel Deployment Failure
The error is:
```
Error: An unexpected error occurred in pull: TypeError: Cannot read properties of undefined (reading 'value')
```
**Root Cause:** Vercel CLI bug, not your code. Fixed by adding retry logic.

---

## Fixes Applied

### 1. Updated Vercel Deploy Workflow
Added retry logic and `continue-on-error` for the flaky `vercel pull` command.

**File:** `.github/workflows/deploy-preview.yml`

### 2. Created SQL Fix Script
Run this in Supabase SQL Editor to fix the issues:

**File:** `scripts/sql/fix-vehicle-creation-issues.sql`

This script:
- Creates the BAT seller monitor for Viva Las Vegas Autos
- Updates `discovery_source` based on `discovery_url`
- Creates a trigger to auto-set `discovery_source` on future inserts

### 3. Created Diagnostic Scripts

| Script | Purpose |
|--------|---------|
| `scripts/diagnose-vehicle-creation.js` | Check why vehicles aren't being created |
| `scripts/check-errors.js` | View all system errors |
| `scripts/trigger-all-extraction.js` | Analyze data gaps |
| `scripts/fix-missing-vehicle-data.js` | Re-extract data for incomplete vehicles |

---

## How to Fix Everything

### Step 1: Fix BAT Seller Monitor (Required!)
Run this SQL in Supabase Dashboard → SQL Editor:

```sql
INSERT INTO bat_seller_monitors (
  organization_id,
  seller_username,
  seller_url,
  is_active
) VALUES (
  'c433d27e-2159-4f8c-b4ae-32a5e44a77cf',
  'VivaLasVegasAutos',
  'https://bringatrailer.com/member/vivalasvegasautos/',
  true
) ON CONFLICT (organization_id, seller_username) 
DO UPDATE SET is_active = true;
```

### Step 2: Fix Discovery Source Tracking
Run the full script: `scripts/sql/fix-vehicle-creation-issues.sql`

### Step 3: Re-extract Missing Data
Get your service role key from: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/settings/api

Then run:
```bash
export SUPABASE_SERVICE_ROLE_KEY="your-key-here"
node scripts/fix-missing-vehicle-data.js
```

### Step 4: Re-run Failed Vercel Deploy
The workflow should now succeed with the retry logic.

---

## Why Data Isn't Being Extracted

The scraping pipeline has two modes:

### Current Mode (Basic):
```
Scrape URL → Extract with regex → Save basic fields → Done
```
Missing: VIN, mileage, color, engine, comprehensive specs

### Desired Mode (Full):
```
Scrape URL → AI extraction → Normalize data → Comprehensive BAT extraction → Save all fields → Analyze images
```

The fix is to ensure scrapers call:
1. `extract-vehicle-data-ai` for all URLs
2. `comprehensive-bat-extraction` for BAT listings
3. `analyze-image-tier1` for uploaded images

---

## Monitoring

### GitHub Actions Running:
- ✅ BAT Scrape: Every 6 hours
- ✅ Process All Images: Periodically
- ✅ Tier1 Batch Runner: Every ~30 minutes

### Check for new vehicles:
```bash
node scripts/diagnose-vehicle-creation.js
```

### Check for errors:
```bash
node scripts/check-errors.js
```
