# PCarMarket Extraction System

## Mission
Extract all PCarMarket.com auction listings into the Nuke vehicles database. Discover URLs, queue them, extract vehicle data, store profiles with images.

**Scale**: Estimated 5,000-10,000 auctions. Current: 2 vehicles extracted.

---

## CRITICAL: JavaScript Rendering Required

PCarMarket is a React SPA. **Direct fetch returns "JavaScript required".**

```
WRONG: curl https://pcarmarket.com/...
RIGHT: Firecrawl API with waitFor: 5000+
```

Always use Firecrawl MCP or the import-pcarmarket-listing edge function.

---

## Constraints

- **Rate limit**: 3 seconds between requests minimum
- **Firecrawl API**: Required for all scraping
- **VIN**: Not always visible - don't fail if missing
- **URL pattern**: `/auction/{year}-{make}-{model}-{id}`

---

## Core Loop

1. **Discover** → Scrape pcarmarket.com and /results/ for auction URLs
2. **Queue** → Add new URLs to import_queue with source='pcarmarket'
3. **Extract** → Call import-pcarmarket-listing for each pending URL
4. **Validate** → Verify vehicle, images, org link created

---

## Key Files

### Scripts
- `scripts/pcarmarket-loop.sh` - Main loop shell
- `scripts/rlm/AGENT_BOOTSTRAP_PCARMARKET.md` - Full agent context

### Edge Functions
- `supabase/functions/import-pcarmarket-listing/index.ts` - **Working extractor**

### Documentation
- `docs/imports/PCARMARKET_IMPORT_PLAN.md` - Strategy
- `docs/imports/PCARMARKET_DATA_MAPPING_EXAMPLE.md` - Exact data flow
- `docs/imports/PCARMARKET_QUICKSTART.md` - How-to

---

## CLI Commands

```bash
# Check status
./scripts/pcarmarket-loop.sh --status

# Discover new listings (add to queue)
./scripts/pcarmarket-loop.sh --discover

# Process pending queue
./scripts/pcarmarket-loop.sh --extract

# Test single URL
./scripts/pcarmarket-loop.sh --test https://www.pcarmarket.com/auction/...

# Run continuous loop
./scripts/pcarmarket-loop.sh --loop
```

---

## Data Flow

```
PCarMarket HTML → Firecrawl (JS render) → import-pcarmarket-listing
    → vehicles table (profile_origin: 'PCARMARKET_IMPORT')
    → vehicle_images table
    → external_listings table
    → organization_vehicles link
```

---

## URL Patterns

```
Auction:   https://www.pcarmarket.com/auction/2002-aston-martin-db7-v12-vantage-2
Results:   https://www.pcarmarket.com/results/
Member:    https://www.pcarmarket.com/member/{username}/
Images:    https://d2niwqq19lf86s.cloudfront.net/htwritable/media/uploads/...
```

---

## Edge Function Usage

```bash
curl -X POST "$SUPABASE_URL/functions/v1/import-pcarmarket-listing" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"listing_url": "https://www.pcarmarket.com/auction/..."}'

# Returns: { "success": true, "vehicle_id": "...", "organization_id": "..." }
```

---

## Current State

| Metric | Value |
|--------|-------|
| Vehicles extracted | 2 |
| URLs in queue | 0 |
| Edge function | Working |
| Discovery script | Ready |

---

## Next Steps

1. Run discovery: `./scripts/pcarmarket-loop.sh --discover`
2. Process queue: `./scripts/pcarmarket-loop.sh --extract`
3. Monitor: `./scripts/pcarmarket-loop.sh --status`

---

## RLM_INPUT_FILES

- scripts/pcarmarket-loop.sh
- scripts/rlm/AGENT_BOOTSTRAP_PCARMARKET.md
- supabase/functions/import-pcarmarket-listing/index.ts
- docs/imports/PCARMARKET_IMPORT_PLAN.md
- docs/imports/PCARMARKET_DATA_MAPPING_EXAMPLE.md
