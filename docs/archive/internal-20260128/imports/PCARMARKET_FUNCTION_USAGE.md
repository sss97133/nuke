# PCarMarket Edge Function Usage

## Overview

The PCarMarket import Edge Function provides a serverless way to import vehicle listings from PCarMarket.com into the database.

## Deployment

Deploy the function to Supabase:

```bash
supabase functions deploy import-pcarmarket-listing
```

## Usage

### Via Supabase CLI

```bash
supabase functions invoke import-pcarmarket-listing \
  --data '{"listing_url": "https://www.pcarmarket.com/auction/2002-aston-martin-db7-v12-vantage-2"}'
```

### Via HTTP Request

```bash
curl -X POST \
  https://your-project.supabase.co/functions/v1/import-pcarmarket-listing \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "listing_url": "https://www.pcarmarket.com/auction/2002-aston-martin-db7-v12-vantage-2"
  }'
```

### Via JavaScript/TypeScript

```typescript
const { data, error } = await supabase.functions.invoke('import-pcarmarket-listing', {
  body: {
    listing_url: 'https://www.pcarmarket.com/auction/2002-aston-martin-db7-v12-vantage-2'
  }
});
```

### Via Test Script

```bash
node scripts/test-pcarmarket-import.js https://www.pcarmarket.com/auction/2002-aston-martin-db7-v12-vantage-2
```

## Response Format

### Success Response

```json
{
  "success": true,
  "vehicle_id": "123e4567-e89b-12d3-a456-426614174000",
  "organization_id": "f7c80592-6725-448d-9b32-2abf3e011cf8",
  "listing": {
    "title": "5k-Mile 2002 Aston Martin DB7 V12 Vantage Coupe",
    "url": "https://www.pcarmarket.com/auction/2002-aston-martin-db7-v12-vantage-2"
  }
}
```

### Error Response

```json
{
  "error": "Error message here"
}
```

## Features

- ✅ Scrapes PCarMarket auction pages
- ✅ Extracts vehicle data (year, make, model, VIN, etc.)
- ✅ Creates or updates vehicle records
- ✅ Imports images automatically
- ✅ Links vehicles to PCarMarket organization
- ✅ Handles duplicate detection
- ✅ Uses Firecrawl for JavaScript-rendered pages (if available)

## Environment Variables

Required:
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key for database access

Optional:
- `FIRECRAWL_API_KEY` - For better scraping of JavaScript-rendered pages

## Rate Limiting

Be mindful of rate limits when importing multiple listings. Consider adding delays between requests:

```javascript
for (const url of urls) {
  await importListing(url);
  await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
}
```

## Error Handling

The function handles:
- Invalid URLs
- Missing required fields
- Network errors
- Database errors
- Duplicate vehicles

## Next Steps

1. Deploy the function: `supabase functions deploy import-pcarmarket-listing`
2. Test with a single listing
3. Create batch import script for multiple listings
4. Set up scheduled imports if needed

