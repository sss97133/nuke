# External Platform Extraction Strategy

## Overview

When scraping an organization's website, we also check for their presence on external sales platforms (Classic.com, Bring a Trailer, etc.) and extract vehicles from those platforms to build a complete picture of their inventory and sales history.

## Process Flow

### 1. External Identity Discovery

**Source:** `external_identities` table
- Links organization to external platform profiles
- Created via `extract-organization-from-seller` when seller links are discovered
- Can be manually linked via scripts

**Query:**
```sql
SELECT platform, handle, profile_url, metadata
FROM external_identities
WHERE metadata->>'organization_id' = $organization_id
  AND platform IN ('classic_com', 'bat')
```

### 2. Classic.com Extraction

**Profile URL Pattern:** `https://www.classic.com/s/seller-name-ID/`

**Process:**
1. **Index Dealer Profile** (`index-classic-com-dealer`)
   - Extracts organization metadata (name, website, contact, etc.)
   - Updates `businesses` table with profile data
   - Returns dealer profile information

2. **Extract Listings Page** (`/s/seller-name/lots/`)
   - Fetches the seller's listings page
   - Extracts all vehicle listing URLs using regex:
     ```regex
     /href=["'](https?:\/\/[^"']*classic\.com\/[^"']*(?:\/veh\/|\/auctions\/)[^"']+)["']/gi
     ```
   - Collects unique listing URLs (up to 50 per run to avoid timeout)

3. **Import Each Listing** (`import-classic-auction`)
   - For each listing URL:
     - Extracts vehicle data (year, make, model, VIN, price, etc.)
     - Creates/updates vehicle in `vehicles` table
     - Creates `external_listings` record
     - Links vehicle to organization via `organization_vehicles`
     - Downloads images via `backfill-images`
   - Rate limiting: 500ms delay between imports

**Database Operations:**
```sql
-- External listing record
INSERT INTO external_listings (
  vehicle_id,
  organization_id,
  platform: 'classic_com',
  listing_url,
  listing_id,
  listing_status: 'active' | 'ended' | 'sold',
  current_bid,
  final_price,
  metadata: { images: [...], title: '...' }
)

-- Organization-vehicle link
INSERT INTO organization_vehicles (
  organization_id,
  vehicle_id,
  relationship_type: 'seller' | 'consigner',
  status: 'active' | 'past',
  auto_tagged: true,
  metadata: {
    platform: 'classic_com',
    listing_url: '...',
    discovered_from: 'external_platform'
  }
)
```

### 3. Bring a Trailer (BaT) Extraction

**Profile URL Pattern:** `https://bringatrailer.com/member/username/`

**Process:**
1. **Extract Profile Vehicles** (`extract-bat-profile-vehicles`)
   - Fetches BaT profile page
   - Extracts all listing URLs from profile
   - For each listing:
     - Uses Firecrawl to extract vehicle data
     - Creates/updates vehicle in `vehicles` table
     - Creates `external_listings` record
     - Links to organization

**Database Operations:**
- Same structure as Classic.com
- Platform: `'bat'`
- Relationship type: `'seller'` or `'consigner'`

## Expected Volumes

### Classic.com
- **Per Profile:** 10-200 listings (active + historical)
- **Extraction Time:** ~1-2 minutes per 50 listings (with rate limiting)
- **Data Quality:** High (structured auction data, prices, dates)

### Bring a Trailer
- **Per Profile:** 5-100 listings (active + historical)
- **Extraction Time:** ~10-30 seconds per listing (Firecrawl)
- **Data Quality:** Very High (comprehensive auction data, images, comments)

## Integration with Site Scraping

The `scrape-organization-site` function automatically:
1. Checks for linked external identities
2. Triggers extraction from each platform
3. Links all extracted vehicles to the organization
4. Preserves provenance (source URL, platform, extraction timestamp)

## Manual Linking

If external identities aren't automatically discovered, they can be manually linked:

```javascript
// scripts/link-2002ad-external-identities.js
const EXTERNAL_IDENTITIES = [
  {
    platform: 'classic_com',
    handle: '2002AD',
    profile_url: 'https://www.classic.com/s/2002ad-8pJl1On/',
  },
];

// Creates/updates external_identities with organization_id in metadata
```

## Data Completeness

**From Site Scraping:**
- ~80-120 vehicles (incomplete profiles, historical value)
- ~150-300 images
- Limited price/sale data

**From External Platforms:**
- ~100-400 vehicles (complete auction/sale data)
- High-quality images
- Full pricing history
- Sale dates and status

**Combined:**
- ~180-520 total vehicles
- Complete provenance trail
- Historical sales data
- Multiple data sources for validation

## Relationship Types

**Site Scraping:**
- `relationship_type: 'collaborator'` - Advertising/promotion
- `relationship_type: 'service_provider'` - Restoration work

**External Platforms:**
- `relationship_type: 'seller'` - Active listings
- `relationship_type: 'consigner'` - Auction consignments
- `status: 'active'` - Current listings
- `status: 'past'` - Historical sales

## Timeline Events

External platform extractions create timeline events:
- Auction start/end dates
- Sale completion dates
- Price milestones
- All linked to organization with platform metadata

