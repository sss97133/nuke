# Fix Broken BaT Images

## Overview
These scripts automatically find and fix broken Bring a Trailer (BaT) images by downloading them from BaT listings and saving them to Supabase storage.

## Scripts Available

### 1. `fix-all-broken-bat-images.js` (Recommended)
**Fixes broken BaT images across ALL vehicles**

```bash
node scripts/fix-all-broken-bat-images.js
```

**What it does:**
- Finds all broken BaT images across all vehicles
- Groups them by vehicle
- For each vehicle:
  1. Tries to download original URLs directly
  2. If that fails, scrapes the BaT listing for fresh images
  3. Downloads and uploads images to Supabase storage
  4. Updates database records with new storage URLs

**Use this when:** You want to fix all broken images at once

---

### 2. `fix-broken-bat-images-suburban.js`
**Fixes broken BaT images for a specific vehicle (Suburban example)**

```bash
node scripts/fix-broken-bat-images-suburban.js
```

**What it does:**
- Hardcoded for the Suburban vehicle (`b5a0c58a-6915-499b-ba5d-63c42fb6a91f`)
- Same process as the general script but for one vehicle

**Use this when:** You want to fix images for a specific vehicle (modify the VEHICLE_ID constant)

---

## How to Use

### Step 1: Check for Broken Images
```sql
-- Find broken BaT images
SELECT 
  vi.id,
  vi.vehicle_id,
  v.year,
  v.make,
  v.model,
  v.bat_auction_url,
  vi.image_url,
  vi.is_external
FROM vehicle_images vi
LEFT JOIN vehicles v ON v.id = vi.vehicle_id
WHERE (vi.image_url LIKE '%bringatrailer.com%' OR vi.source = 'bat_listing_broken')
AND vi.is_external = true
ORDER BY vi.created_at DESC;
```

### Step 2: Run the Fix Script
```bash
# Fix all broken images
node scripts/fix-all-broken-bat-images.js
```

### Step 3: Verify Results
The script will output:
- Number of images fixed
- Number of images that failed
- Per-vehicle breakdown

---

## Requirements

1. **Environment Variables** (in `.env`):
   ```bash
   VITE_SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   # OR
   VITE_SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   ```

2. **Dependencies**:
   ```bash
   npm install playwright @supabase/supabase-js node-fetch dotenv
   ```

3. **Playwright Browser**:
   ```bash
   npx playwright install chromium
   ```

---

## How It Works

1. **Find Broken Images**: Queries database for images with BaT URLs or marked as broken
2. **Direct Download**: Tries to download original URLs first (fastest)
3. **Scrape BaT**: If direct download fails, scrapes the BaT listing page for fresh images
4. **Upload to Storage**: Downloads images and uploads to Supabase storage buckets
5. **Update Database**: Updates `vehicle_images` records with:
   - New storage URL
   - `is_external = false`
   - `source = 'bat_listing'`
   - Original BaT URL in `source_url`
   - Metadata with `fixed: true` and `downloaded_at` timestamp

---

## Storage Locations

Images are saved to:
- Primary: `vehicle-images/vehicles/{vehicle_id}/bat/`
- Fallback: `vehicle-data/vehicles/{vehicle_id}/bat/`

---

## Troubleshooting

### "Missing Supabase key" error
- Ensure `SUPABASE_SERVICE_ROLE_KEY` is in your `.env` file
- Service role key bypasses RLS policies

### "RLS policy violation" error
- Make sure you're using the service role key, not anon key
- Service role key has full database access

### "Timeout" errors when scraping
- BaT may be blocking requests
- Try running again later
- Check if the BaT listing URL is still valid

### Images still showing 404
- The original BaT URLs may have been permanently removed
- The script will try to find fresh images from the listing
- If no fresh images found, those images cannot be recovered

---

## Example Output

```
🔍 Finding all broken BaT images...

📸 Found 5 broken images across all vehicles

🚗 1 vehicles need image fixes

============================================================

🚗 1985 Chevrolet K10 Suburban Silverado
   Vehicle ID: b5a0c58a-6915-499b-ba5d-63c42fb6a91f
   Broken images: 5
   BaT URL: https://bringatrailer.com/listing/1985-chevrolet-suburban-11/
   [1/5] Trying direct download... ❌ Download failed
   [2/5] Trying direct download... ❌ Download failed
   ...
   🔄 5 images failed. Scraping BaT for fresh images...
   📡 Scraping images from BaT listing...
   ✅ Found 134 images
   📥 Found 134 fresh images. Downloading...
   [1/5] Downloading fresh image... ✅ Fixed
   [2/5] Downloading fresh image... ✅ Fixed
   ...
   Result: 5 fixed, 0 failed
------------------------------------------------------------

🎯 FINAL RESULTS:
✅ Total fixed: 5 images
❌ Total failed: 0 images
🚗 Vehicles processed: 1

✅ Successfully fixed 5 broken BaT images!
```

---

## Notes

- Images are permanently stored in Supabase, so they won't break again
- Original BaT URLs are preserved in `source_url` for reference
- The script respects rate limits (1 second delay between downloads)
- Failed images are logged for manual review

