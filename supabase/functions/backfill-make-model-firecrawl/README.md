# Backfill Make/Model from Firecrawl

Supabase Edge Function to backfill missing make/model data by re-scraping vehicle URLs with Firecrawl.

## Usage

### Dry Run (Preview)
```bash
curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/backfill-make-model-firecrawl?dry-run=true&limit=10" \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

### Process Vehicles
```bash
curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/backfill-make-model-firecrawl?limit=100&batch-size=5" \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

## Parameters

- `dry-run` (boolean): Preview what would be processed without making changes
- `limit` (number): Maximum number of vehicles to process (default: all)
- `batch-size` (number): Number of vehicles to process in parallel (default: 10)
- `include-merged` (boolean): Include vehicles with status='merged' (default: false)

## Environment Variables

Set in Supabase Dashboard → Edge Functions → Secrets:
- `FIRECRAWL_API_KEY`: Your Firecrawl API key

## Response

```json
{
  "message": "Backfill complete",
  "total_vehicles": 7496,
  "vehicles_with_urls": 7373,
  "processed": 100,
  "extracted": 45,
  "updated": 45,
  "errors": [],
  "error_count": 0
}
```

## Notes

- Processes vehicles missing make that have scrapeable URLs
- Uses Firecrawl to extract make/model from page content
- Rate-limited to avoid API throttling
- Updates vehicles in batches for efficiency
