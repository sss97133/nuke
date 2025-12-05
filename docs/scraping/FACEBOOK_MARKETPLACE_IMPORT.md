# Facebook Marketplace Import Guide

## ✅ Implementation Complete

Deep scraping tool for Facebook Marketplace vehicles is now integrated into the Nuke platform.

## Features

- ✅ **Deep Data Extraction**: Extracts year, make, model, price, mileage, VIN, images, description, location
- ✅ **Bot Protection Bypass**: Uses Firecrawl with aggressive settings to bypass Facebook's protection
- ✅ **Favicon Caching**: Automatically caches Facebook Marketplace favicon
- ✅ **Import Rules Compliance**: Follows all platform rules for origin tracking, attribution, validation
- ✅ **Image Import**: Downloads and imports all vehicle images
- ✅ **Timeline Events**: Creates discovery timeline events
- ✅ **VIN Deduplication**: Checks for existing vehicles by VIN

## Quick Start

### 1. Import a Vehicle

```bash
node scripts/import-facebook-marketplace.js "https://www.facebook.com/share/1GZv29h62H/?mibextid=wwXIfr"
```

### 2. Or Use the Edge Function Directly

```javascript
const { data } = await supabase.functions.invoke('scrape-vehicle', {
  body: { url: 'https://www.facebook.com/share/1GZv29h62H/?mibextid=wwXIfr' }
});
```

## How It Works

### 1. Deep Scraping

The `scrapeFacebookMarketplace()` function extracts:

- **Title**: "1968 Dodge Coronet - $15,000"
- **Year/Make/Model**: Parsed from title
- **Price**: Extracted from multiple sources
- **Location**: "Anaheim, California"
- **Mileage**: From description patterns
- **VIN**: Regex patterns in description
- **Images**: All vehicle photos (high-res URLs)
- **Description**: Full listing text
- **Engine/Transmission**: Parsed from description
- **Color/Condition**: Detected keywords

### 2. Firecrawl Integration

For Facebook Marketplace, uses aggressive settings:

```typescript
{
  waitFor: 10000,        // 10 second wait
  mobile: true,          // Mobile user agent (less protected)
  actions: [
    { type: 'wait', milliseconds: 5000 },
    { type: 'scroll', direction: 'down' },
    { type: 'wait', milliseconds: 3000 },
    { type: 'scroll', direction: 'down' }
  ]
}
```

### 3. Import Process

1. **Scrape** → Extract all data using Firecrawl
2. **Validate** → Check for required fields (year, make, model)
3. **Deduplicate** → Check by URL and VIN
4. **Create Vehicle** → Insert with origin tracking
5. **Import Images** → Download and upload all photos
6. **Create Timeline** → Add discovery event
7. **Cache Favicon** → Store Facebook Marketplace icon

## Data Structure

### Vehicle Record

```typescript
{
  year: 1968,
  make: 'dodge',
  model: 'coronet',
  asking_price: 15000,
  mileage: 45000,
  vin: 'WP29H8F1234567890',
  location: 'Anaheim, California',
  description: 'Full listing text...',
  
  // Origin tracking (follows rules)
  profile_origin: 'facebook_marketplace_import',
  discovery_source: 'facebook_marketplace',
  discovery_url: 'https://www.facebook.com/share/...',
  
  origin_metadata: {
    facebook_marketplace_url: '...',
    facebook_marketplace_listing_id: '123456789',
    scraped_at: '2025-01-15T10:00:00Z',
    title: '1968 Dodge Coronet',
    location: 'Anaheim, California'
  }
}
```

## Examples

### Example 1: Import Single Vehicle

```bash
# Import the 1968 Dodge Coronet
node scripts/import-facebook-marketplace.js "https://www.facebook.com/share/1GZv29h62H/?mibextid=wwXIfr"
```

### Example 2: Use in Code

```javascript
const { data } = await supabase.functions.invoke('scrape-vehicle', {
  body: { 
    url: 'https://www.facebook.com/share/1K3VQisoGM/?mibextid=wwXIfr'
  }
});

if (data.success) {
  const vehicleData = data.data;
  console.log(`${vehicleData.year} ${vehicleData.make} ${vehicleData.model}`);
  console.log(`Price: $${vehicleData.asking_price}`);
  console.log(`Images: ${vehicleData.images?.length || 0}`);
}
```

### Example 3: Batch Import Script

```javascript
const urls = [
  'https://www.facebook.com/share/1GZv29h62H/',
  'https://www.facebook.com/share/1K3VQisoGM/',
  'https://www.facebook.com/share/1BwKu6ngCk/'
];

for (const url of urls) {
  await importFacebookMarketplace(url);
  await sleep(5000); // Rate limit
}
```

## Troubleshooting

### Firecrawl Not Working

1. **Check API Key**: Ensure `FIRECRAWL_API_KEY` is set in Supabase secrets
2. **Check Quota**: Verify you have remaining credits
3. **Check Logs**: Look for Firecrawl errors in edge function logs

### Missing Data

Facebook Marketplace structure varies. The parser uses multiple fallback methods:
- Title parsing
- Markdown extraction
- HTML selectors
- Regex patterns
- Full-text search

If data is missing, check the scraped HTML/markdown in logs.

### Images Not Importing

1. **Check URLs**: Facebook CDN URLs may expire
2. **Rate Limits**: Too many rapid requests may be blocked
3. **Storage**: Verify Supabase storage bucket permissions

## Cost Analysis

**Per Import:**
- Firecrawl: ~$0.002 (1 scrape)
- Storage: ~$0.001 (10 images @ 1MB each)
- **Total: ~$0.003 per vehicle**

**Monthly (1,000 vehicles):**
- Firecrawl: $2
- Storage: $1
- **Total: ~$3/month**

## Supported URL Formats

```
✅ https://www.facebook.com/share/1GZv29h62H/?mibextid=wwXIfr
✅ https://www.facebook.com/marketplace/item/123456789/
✅ https://facebook.com/share/1K3VQisoGM/
```

## Related Files

- **Parser**: `supabase/functions/scrape-vehicle/index.ts` (scrapeFacebookMarketplace function)
- **Import Script**: `scripts/import-facebook-marketplace.js`
- **Favicon**: `supabase/functions/_shared/extractFavicon.ts`
- **Documentation**: `docs/scraping/SCRAPING_OPTIONS_COMPARISON.md`

## Next Steps

1. ✅ **Test with real URLs** - Try the import script
2. ✅ **Verify data quality** - Check extracted fields
3. ✅ **Monitor costs** - Track Firecrawl usage
4. 🔄 **Add to UI** - Create admin import interface
5. 🔄 **Batch processing** - Add queue system

---

**Status**: ✅ Ready for Production  
**Last Updated**: January 5, 2025

