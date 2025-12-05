# Facebook Marketplace Import - Status

## ✅ Implementation Complete

Deep scraping tool for Facebook Marketplace is fully implemented with:

- ✅ Deep data extraction parser (`scrapeFacebookMarketplace()`)
- ✅ Firecrawl integration with aggressive settings
- ✅ Favicon caching
- ✅ Import script (`scripts/import-facebook-marketplace.js`)
- ✅ Query script (`scripts/query-facebook-vehicles.js`)

## 🔧 Current Issue

The edge function is returning a 500 error. This needs to be fixed before importing.

**Next Steps:**

1. **Check edge function logs** in Supabase Dashboard:
   - Go to: Logs → Edge Functions → scrape-vehicle
   - Look for the error message

2. **Redeploy the edge function** after fixing any syntax errors:
   ```bash
   cd /Users/skylar/nuke
   supabase functions deploy scrape-vehicle
   ```

3. **Verify Firecrawl API key** is set in Supabase:
   - Dashboard → Settings → Edge Functions → Secrets
   - Should have: `FIRECRAWL_API_KEY`

## 📋 How to Query Facebook Vehicles

Once vehicles are imported, query them with:

```bash
# Query existing Facebook vehicles
node scripts/query-facebook-vehicles.js
```

Or in code:

```javascript
const { data } = await supabase
  .from('vehicles')
  .select('*')
  .or('profile_origin.eq.facebook_marketplace_import,discovery_source.eq.facebook_marketplace')
  .ilike('discovery_url', '%facebook.com%');
```

## 🚀 Once Fixed, Import Vehicles

```bash
# Import Facebook Marketplace vehicle
node scripts/import-facebook-marketplace.js "https://www.facebook.com/share/1GZv29h62H/?mibextid=wwXIfr"
```

## 📊 Current Status

- **Facebook vehicles in DB**: 0 (none imported yet)
- **Edge function**: Needs deployment/fix
- **Parser**: Complete
- **Scripts**: Ready

---

**Last Updated**: December 5, 2025

