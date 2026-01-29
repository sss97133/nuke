# Cars & Bids Comments Extractor - Setup Guide

## Function Status

**Function**: `extract-cars-and-bids-comments`  
**Status**: ✅ Deployed (ACTIVE)  
**Issue**: ❌ Missing `FIRECRAWL_API_KEY` environment variable

## Required Environment Variables

The function requires `FIRECRAWL_API_KEY` to be set in Supabase Edge Function secrets:

```bash
# Set in Supabase Dashboard:
# Settings > Edge Functions > Secrets > Add Secret
# Name: FIRECRAWL_API_KEY
# Value: your_firecrawl_api_key_here
```

Or via Supabase CLI:
```bash
supabase secrets set FIRECRAWL_API_KEY=your_key_here
```

## Testing the Function

### Test with a Valid Auction URL

The Ferrari Roma auction (`rnmn1gx5`) appears to have ended (returns 404). Test with an active auction instead:

```bash
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/extract-cars-and-bids-comments" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "auction_url": "https://carsandbids.com/auctions/ACTIVE_AUCTION_ID/listing-slug",
    "vehicle_id": "vehicle-uuid-here"
  }'
```

### Expected Response (Success)

```json
{
  "success": true,
  "vehicle_id": "vehicle-uuid",
  "auction_event_id": "event-uuid",
  "comments_extracted": 50,
  "authors_found": 15,
  "timestamp": "2026-01-08T22:14:41.000Z"
}
```

### Expected Error (Missing FIRECRAWL_API_KEY)

```json
{
  "error": "FIRECRAWL_API_KEY not configured - please set it in Supabase Edge Function secrets"
}
```

## Function Flow

1. **Resolves `vehicle_id`** from:
   - Request body
   - `auction_events` table
   - `external_listings` table
   - `vehicles` table by `discovery_url`

2. **Resolves `auction_event_id`** from:
   - Request body
   - `auction_events` table by `source_url`
   - Creates new `auction_event` if missing

3. **Fetches HTML** using Firecrawl (requires JavaScript rendering)

4. **Extracts Comments** from:
   - `__NEXT_DATA__` (first priority - most reliable)
   - DOM parsing (fallback if `__NEXT_DATA__` fails)

5. **Stores Data**:
   - Comments → `auction_comments` table
   - Authors → `external_identities` table

## Known Issues

### Issue 1: Auction Returns 404

Some auctions may have ended and been removed. The function will fail if Firecrawl returns 404.

**Solution**: Test with an active auction URL.

### Issue 2: Missing FIRECRAWL_API_KEY

The function throws a 500 error if `FIRECRAWL_API_KEY` is not set.

**Solution**: Set the secret in Supabase Edge Function environment variables.

### Issue 3: Comments Not Found in __NEXT_DATA__

If comments aren't in `__NEXT_DATA__`, the function falls back to DOM parsing which may be less reliable.

**Solution**: The function already handles this with fallback patterns.

## Next Steps

1. ✅ **Set FIRECRAWL_API_KEY** in Supabase Edge Function secrets
2. ✅ **Test with an active auction** (not the expired Ferrari Roma)
3. ✅ **Verify comments are extracted** and stored in `auction_comments` table
4. ✅ **Check `external_identities`** table for bidder usernames

---

**Last Updated**: 2026-01-08  
**Function Version**: 1 (Deployed)

