# BaT Image Extraction Fix

## Problem Summary

- **Earlier scrapings worked well** (got 120+ images)
- **Now only getting 20 images** (or 0 after recent changes)
- **Direct fetch finds 231 items** in `data-gallery-items` attribute
- **Firecrawl is failing** with 401 Unauthorized

## Root Causes

1. **Firecrawl API Key Missing**: The `FIRECRAWL_API_KEY` is not set in Supabase Edge Function secrets, causing Firecrawl to fail
2. **Extraction Code Needs Redeployment**: Improved extraction code has been written but needs to be deployed
3. **Direct Fetch Works**: When using direct fetch (fallback), the HTML contains all 231 images, so the data is there

## Solution Steps

### 1. Set Firecrawl API Key in Supabase

1. Go to: **Supabase Dashboard** → **Project Settings** → **Edge Functions** → **Secrets**
2. Add/Update secret:
   - **Name:** `FIRECRAWL_API_KEY`
   - **Value:** Your Firecrawl API key (from https://firecrawl.dev)
3. Click **Save**

### 2. Redeploy Edge Function

After setting the secret, redeploy the function:

```bash
supabase functions deploy import-bat-listing
```

Or via Supabase Dashboard:
1. Go to **Edge Functions**
2. Find `import-bat-listing`
3. Click **Redeploy**

### 3. Test Extraction

Run the debug script to verify:

```bash
node scripts/debug-bat-html-extraction.js https://bringatrailer.com/listing/2026-chevrolet-corvette-zr1-10/
```

Expected results:
- ✅ Firecrawl should succeed (not 401)
- ✅ Should find 231 items in `data-gallery-items`
- ✅ Edge Function should extract all images

### 4. Re-extract Images for Vehicles

Once working, re-extract images for affected vehicles:

```bash
node scripts/re-extract-single-bat-vehicle.js <vehicle_id>
```

## What Was Fixed

1. **Improved extraction function** (`batDomMap.ts`):
   - Better fallback logic to find `data-gallery-items` even if not in expected div
   - Improved HTML entity decoding
   - Better regex patterns for HTML-encoded attributes
   - More detailed logging

2. **Improved Firecrawl integration** (`import-bat-listing/index.ts`):
   - Increased `waitFor` time to 12 seconds
   - Added timeout handling
   - Better error logging
   - Debug logging to track HTML source and size

3. **Added debug script** (`scripts/debug-bat-html-extraction.js`):
   - Tests Firecrawl directly
   - Tests direct fetch
   - Tests Edge Function
   - Shows exactly what's in the HTML

## Verification

After fixing, you should see:
- Firecrawl returns HTML with `data-gallery-items` containing 200+ items
- Edge Function extracts all images successfully
- `origin_metadata.image_urls` contains full list of images
- Vehicle profiles show all images

## Why It Worked Before

Earlier scrapings likely worked because:
- Firecrawl API key was set correctly
- Or BaT's HTML structure was simpler
- Or the extraction code was different

The current issue is that Firecrawl is failing, so it falls back to direct fetch, but the extraction might not be working correctly with the current deployed code.

