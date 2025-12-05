# Facebook Marketplace Integration - Ready to Use

## ✅ What's Built

1. **Deep Facebook Marketplace Parser** (`scrapeFacebookMarketplace()`)
   - Extracts year, make, model, price, mileage, VIN, images, description, location
   - Multiple extraction methods for reliability
   
2. **Firecrawl Integration** ✅ 
   - Aggressive settings for Facebook bot protection
   - 10-second wait + mobile UA + scroll actions
   
3. **Favicon Caching** ✅
   - Automatically caches Facebook Marketplace favicon
   
4. **Query Script** ✅ (Ready to use)
   ```bash
   node scripts/query-facebook-vehicles.js
   ```

5. **Import Script** ✅ (Ready once edge function is deployed)
   ```bash
   node scripts/import-facebook-marketplace.js <url>
   ```

## 🔍 Query Facebook Vehicles

**Script is ready and working:**

```bash
node scripts/query-facebook-vehicles.js
```

This will show:
- All vehicles with `profile_origin = 'facebook_marketplace_import'`
- All vehicles with `discovery_source = 'facebook_marketplace'`
- All vehicles with `discovery_url` containing `facebook.com`

**Current Status:** 0 Facebook vehicles found (none imported yet)

## 🚀 Next Steps to Import

1. **Deploy/Update Edge Function**
   ```bash
   cd /Users/skylar/nuke
   supabase functions deploy scrape-vehicle
   ```

2. **Verify Firecrawl API Key** is set in Supabase Dashboard:
   - Settings → Edge Functions → Secrets
   - Should have: `FIRECRAWL_API_KEY`

3. **Run Import**
   ```bash
   node scripts/import-facebook-marketplace.js "https://www.facebook.com/share/1GZv29h62H/?mibextid=wwXIfr"
   ```

4. **Query Results**
   ```bash
   node scripts/query-facebook-vehicles.js
   ```

## 📊 Example Query Results

Once vehicles are imported, you'll see:

```
✅ Found 3 Facebook Marketplace vehicle(s):

1. 1968 Dodge Coronet
   ID: abc-123-def
   Discovery URL: https://www.facebook.com/share/1GZv29h62H/
   Origin: facebook_marketplace_import
   Source: facebook_marketplace
   Facebook URL: https://www.facebook.com/share/1GZv29h62H/
   Listing ID: 123456789
   Created: 12/5/2025

2. 1972 GMC Suburban
   ...
```

## 🔧 Files Created

- ✅ `supabase/functions/scrape-vehicle/index.ts` - Added Facebook parser
- ✅ `scripts/import-facebook-marketplace.js` - Import script
- ✅ `scripts/query-facebook-vehicles.js` - Query script (READY)
- ✅ `scripts/test-facebook-scrape.js` - Test script
- ✅ `docs/scraping/FACEBOOK_MARKETPLACE_IMPORT.md` - Full docs

## 💡 Quick Test

Run the query script now (it's ready, just shows 0 results):

```bash
node scripts/query-facebook-vehicles.js
```

---

**Status**: Query tool ready ✅ | Import ready (needs edge function deployment) ⏳

