# Run Intelligent Ingestion Agent

The `ingest-org-complete` function is an automated agent that:
1. Takes a URL (that's it)
2. Inspects site structure using LLM + Firecrawl
3. Maps DOM structure and extraction points
4. Learns and stores patterns
5. Extracts all data accurately
6. Fills database automatically

## API Keys Required

Keys must be set in **Supabase Edge Function Secrets**:
- `OPENAI_API_KEY` - For LLM analysis
- `FIRECRAWL_API_KEY` - For HTML fetching
- `SUPABASE_URL` - Auto-set by Supabase
- `SUPABASE_SERVICE_ROLE_KEY` - Auto-set by Supabase

## Usage

### Via cURL

```bash
curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/ingest-org-complete" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.velocityrestorations.com/"}'
```

### Via Test Script

```bash
# Using the test script
./scripts/test-ingest-org-complete.sh https://www.velocityrestorations.com/
```

The script will:
- Load API keys from environment
- Call the Edge Function
- Display results

### Via Supabase Dashboard

1. Go to Edge Functions → `ingest-org-complete`
2. Click "Invoke"
3. Enter JSON:
```json
{
  "url": "https://www.velocityrestorations.com/"
}
```

## Response Format

```json
{
  "success": true,
  "organization_id": "uuid",
  "website": "https://example.com",
  "site_structure": {
    "domain": "example.com",
    "site_type": "dealer_website",
    "platform": "DealerFire",
    "page_types": [...],
    "listing_patterns": [...]
  },
  "extraction_patterns": 12,
  "vehicles_found": 45,
  "vehicles_created": 45,
  "images_found": 230
}
```

## What It Does

1. **Creates/Finds Organization**: Automatically creates organization record if it doesn't exist
2. **Site Inspection**: Uses LLM to analyze site structure and identify:
   - Page types (inventory, vehicle_detail, etc.)
   - URL patterns for listings
   - Platform/CMS detection
3. **DOM Mapping**: Learns extraction patterns:
   - CSS selectors for each field
   - Regex patterns where needed
   - Extraction methods (dom, llm, hybrid)
4. **Pattern Storage**: Stores learned patterns in `source_site_schemas` for reuse
5. **Data Extraction**: Extracts all vehicles and data using learned patterns
6. **Database Population**: Creates vehicle profiles and links to organization

## Force Rediscovery

To force re-inspection even if patterns exist:

```json
{
  "url": "https://example.com",
  "force_rediscover": true
}
```

## Monitoring

Check Supabase logs:
- Edge Functions → `ingest-org-complete` → Logs
- Or use: `supabase functions logs ingest-org-complete`

## Database Results

After running, check:
- `businesses` table - Organization record
- `vehicles` table - Vehicle records
- `organization_vehicles` table - Links between org and vehicles
- `vehicle_images` table - Vehicle images
- `source_site_schemas` table - Stored extraction patterns

