# Classic.com Dealer Indexing - Quick Start

## Overview

Automated system to index Classic.com dealer directory and extract their full inventory. Uses Firecrawl for robust data extraction.

## Example: 111 Motorcars

**Profile:** https://www.classic.com/s/111-motorcars-ZnQygen/

**Extracted Data:**
- Name: "111 Motorcars"
- Logo: `https://images.classic.com/uploads/dealer/One_Eleven_Motorcars.png`
- Website: `https://www.111motorcars.com`
- Location: Franklin, TN
- License: (extracted from profile)
- Inventory: 157 vehicles (from website)

## Usage

### Index Single Dealer

```bash
# Via script
node scripts/index-classic-com-dealers.js https://www.classic.com/s/111-motorcars-ZnQygen/

# Direct API call
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/index-classic-com-dealer \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"profile_url": "https://www.classic.com/s/111-motorcars-ZnQygen/"}'
```

### What Happens

1. **Firecrawl extracts** Classic.com profile HTML
2. **Parses structured data:**
   - Dealer name, logo, license (greenlight signals)
   - Address, phone, website
   - Business type (dealer vs auction_house)
3. **Downloads logo** → stores in Supabase Storage → sets as `organizations.logo_url`
4. **Geographic matching:**
   - Checks license (strongest match)
   - Checks website
   - Checks name+city+state
5. **Creates organization** if greenlight signals present
6. **Queues inventory extraction** for dealer website

## Greenlight Signals

Organization creation requires all 3:
- ✅ **Name** (dealer/auction house name)
- ✅ **Logo** (image from Classic.com)
- ✅ **License** (dealer license number)

If all present → automatic org creation. If missing → skip.

## Geographic Matching

**Prevents inventory mixing** across franchise locations:

- Same dealer name in different cities = different organizations
- "111 Motorcars - Franklin, TN" ≠ "111 Motorcars - Nashville, TN"
- Matches by: license > website > name+city+state

## Next Steps: Inventory Extraction

After org creation, system automatically:
1. Scrapes dealer website inventory page
2. Extracts all vehicles using Firecrawl
3. Creates vehicle profiles + links to organization
4. For auction houses: extracts auction events + lots

## Competitor Monitoring

**DealerFire** (https://www.dealerfire.com/):
- Corporate dealer website platform
- Engine6-powered (fast loading)
- Used by many Classic.com dealers
- Monitor for platform changes

**DealerSocket** (https://dealersocket.com/):
- Full DMS/CRM platform
- Owns DealerFire
- Corporate competitor
- Monitor for competitive intelligence

These platforms may want to "destroy us" - keep an eye on their features and scraping behavior.

## Files

- `supabase/functions/index-classic-com-dealer/index.ts` - Main indexing function
- `scripts/index-classic-com-dealers.js` - Batch indexing script
- `supabase/migrations/20250115_add_dealer_indexing_fields.sql` - Schema additions

