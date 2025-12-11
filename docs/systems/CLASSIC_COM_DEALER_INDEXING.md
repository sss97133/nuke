# Classic.com Dealer & Auction House Indexing System

## Overview

Automated system to index Classic.com dealer directory, extract dealer/auction house profiles, and scrape their full inventory. Uses Firecrawl for robust data extraction and handles both dealers and auction houses differently.

## Architecture

### 1. Classic.com Profile Indexing

**Function:** `supabase/functions/index-classic-com-dealer/index.ts`

**Process:**
1. Scrape Classic.com dealer profile with Firecrawl
2. Extract structured data:
   - **Greenlight signals**: name, logo, dealer license
   - Business info: address, phone, email, website
   - Business type detection: dealer vs auction_house
   - Geographic data: city, state for matching
3. Download logo and store as organization favicon
4. Geographic matching to prevent duplicate orgs
5. Create organization if greenlight signals present
6. Queue inventory extraction

**Greenlight Signals (Auto-create org):**
- ✅ Dealer name
- ✅ Logo image
- ✅ Dealer license number

All 3 required = automatic organization creation.

### 2. Logo Extraction & Favicon Storage

**Logo Extraction:**
- Pattern: `https://images.classic.com/uploads/dealer/One_Eleven_Motorcars.png`
- Stores in Supabase Storage: `organization-logos/{domain}-logo.{ext}`
- Cached in `source_favicons` table for quick lookups
- Used as organization `logo_url` for display

**Favicon Pipeline:**
```
Classic.com logo URL
  ↓
Download image
  ↓
Upload to Supabase Storage
  ↓
Store in organizations.logo_url
  ↓
Cache in source_favicons table
  ↓
Display in UI (OrganizationCard, OrganizationProfile, etc.)
```

### 3. Geographic Matching Logic

**Prevents inventory mixing** by matching organizations using:

**Priority 1: Dealer License** (strongest - unique identifier)
```sql
WHERE dealer_license = 'ABC123'
```

**Priority 2: Website URL** (same website = same entity)
```sql
WHERE website = 'https://111motorcars.com'
```

**Priority 3: Name + City + State** (geographic matching)
```sql
WHERE name ILIKE '%111 Motorcars%'
  AND city ILIKE '%Franklin%'
  AND state = 'TN'
```

**Result:**
- "111 Motorcars - Franklin, TN" ≠ "111 Motorcars - Nashville, TN"
- Prevents mixing inventories from different franchise locations

### 4. Business Type Detection

**Dealer Indicators:**
- Keywords: "dealer", "dealership", "motors", "auto"
- License type: `dealer_license`
- Inventory structure: Continuous inventory (vehicles for sale)

**Auction House Indicators:**
- Keywords: "auction", "bid", "lot", "catalog", "event"
- License type: `auction_license`
- Structure: Time-based events with lots

**Detection Logic:**
```typescript
if (hasAuctionLicense || (auctionKeywords && auctionURLPattern)) {
  business_type = 'auction_house';
} else {
  business_type = 'dealer';
}
```

### 5. Inventory Extraction (Phase 2)

**For Dealers:**
- Scrape inventory page: `{website}/inventory`
- Extract vehicles with:
  - VIN, year, make, model
  - Price (asking_price)
  - Images
  - Status (in_stock, sold, etc.)
- Store in: `dealer_inventory` table

**For Auction Houses:**
- Scrape auctions page: `{website}/auctions`
- Extract auction events with:
  - Event dates, location
  - Catalog URL
- For each event, extract lots:
  - Lot number, vehicle details
  - Starting bid, reserve price
  - Auction dates
- Store in: `auction_events` + `auction_lots` tables

**Extraction Method:**
- Uses Firecrawl for robust scraping (handles JS, bot protection)
- LLM extraction for complex structures
- Falls back to regex patterns if needed

## Usage

### Index Single Dealer Profile

```bash
# Via script
node scripts/index-classic-com-dealers.js https://www.classic.com/s/111-motorcars-ZnQygen/

# Via edge function
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/index-classic-com-dealer \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"profile_url": "https://www.classic.com/s/111-motorcars-ZnQygen/"}'
```

### Batch Index from Directory

```bash
# Index all dealers from Classic.com directory
node scripts/index-classic-com-dealers.js
```

## Data Flow

```
Classic.com Dealer Profile
  ↓ (Firecrawl scrape)
Extract structured data
  ├─ Name, logo, license (greenlight signals)
  ├─ Address, phone, website
  ├─ Business type (dealer vs auction_house)
  └─ Geographic data (city, state)
  ↓
Geographic matching
  ├─ Check by license (strongest)
  ├─ Check by website
  └─ Check by name+city+state
  ↓
Create organization (if new)
  ├─ Store logo as favicon
  ├─ Set geographic_key for matching
  └─ Mark discovered_via = 'classic_com_indexing'
  ↓
Queue inventory extraction
  ├─ Dealers → scrape /inventory page
  └─ Auction houses → scrape /auctions page
  ↓
Extract full inventory
  ├─ Dealers → dealer_inventory records
  └─ Auction houses → auction_events + auction_lots
```

## Example: 111 Motorcars

**Profile:** https://www.classic.com/s/111-motorcars-ZnQygen/

**Extracted Data:**
```json
{
  "name": "111 Motorcars",
  "logo_url": "https://images.classic.com/uploads/dealer/One_Eleven_Motorcars.png",
  "website": "https://www.111motorcars.com",
  "address": "111 Alpha Dr",
  "city": "Franklin",
  "state": "TN",
  "zip": "37064",
  "phone": "(629) 312-1110",
  "dealer_license": "[extracted from profile]",
  "business_type": "dealer",
  "inventory_url": "https://www.111motorcars.com/inventory"
}
```

**Result:**
- ✅ Organization created: "111 Motorcars"
- ✅ Logo stored as favicon
- ✅ Inventory extraction queued
- ✅ 157 vehicles imported from inventory page

## Competitor Monitoring

**DealerFire** (https://www.dealerfire.com/):
- Corporate dealer website platform
- Powered by Engine6 (fast loading)
- Used by many Classic.com dealers
- Monitor for platform changes that might affect scraping

**DealerSocket** (https://dealersocket.com/):
- Full DMS/CRM platform
- Owns DealerFire
- Corporate competitor - monitor for competitive intelligence

**Note:** These platforms may want to "destroy us" - monitor their feature changes and scraping behavior.

## Database Schema

**Organizations Table (businesses):**
```sql
- dealer_license TEXT (indexed, unique identifier)
- geographic_key TEXT (indexed, name-city-state composite)
- logo_url TEXT (downloaded from Classic.com)
- type TEXT ('dealer' | 'auction_house')
- source_url TEXT (Classic.com profile URL)
- discovered_via TEXT ('classic_com_indexing')
- metadata JSONB (stores inventory_url, auctions_url)
```

**Logo Storage:**
- Location: `organization-logos/{domain}-logo.{ext}`
- Also cached in: `source_favicons` table
- Accessible via: `organizations.logo_url`

## Files

- `supabase/functions/index-classic-com-dealer/index.ts` - Main indexing function
- `scripts/index-classic-com-dealers.js` - Batch indexing script
- `supabase/migrations/20250115_add_dealer_indexing_fields.sql` - Schema additions
- `supabase/functions/scrape-multi-source/index.ts` - Inventory extraction (delegates to)

## Next Steps

1. ✅ Profile indexing with Firecrawl
2. ✅ Logo extraction and favicon storage
3. ✅ Geographic matching
4. ⏳ Inventory extraction (per-site scraping)
5. ⏳ Auction house event/lot extraction
6. ⏳ Directory scraping (extract all Classic.com dealer URLs)

