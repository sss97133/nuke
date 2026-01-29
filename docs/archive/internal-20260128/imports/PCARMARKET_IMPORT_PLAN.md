# PCarMarket.com Import Plan

## Overview

Plan for mapping and indexing `pcarmarket.com` to build organizational profiles and import vehicles with structures similar to Bring a Trailer (BaT).

## Goals

1. **Map Site Structure**: Understand pcarmarket.com's listing format, organization, and member/user profile structure
2. **Build Organization Profile**: Create organizational profile for PCarMarket.com in the businesses table
3. **Import Vehicles**: Extract and import vehicle listings following BaT import patterns
4. **Extract Member Profiles**: Support user/member profile extraction (e.g., seller profiles, similar to BaT `/member/username/`)

## Site Structure Analysis

### Vehicle Listing Format

Based on provided HTML snippet, pcarmarket.com listings contain:

- **URL Pattern**: `/auction/{slug}-{id}` (e.g., `/auction/2002-aston-martin-db7-v12-vantage-2`)
- **Title**: Vehicle title (e.g., "5k-Mile 2002 Aston Martin DB7 V12 Vantage Coupe")
- **Image URL**: Cover photo from CloudFront CDN
- **Bid Status**: 
  - Unsold: "High bid: $X,XXX" with gray badge "Unsold"
  - Sold: "Final bid: $X,XXX" with green badge "Sold"
- **Status Indicators**:
  - Unsold: `bg-gray-100 text-gray-600` badge
  - Sold: `bg-green-100 text-green-800` badge with `text-green-700` bid amount

### Data Points to Extract

1. **Listing-Level**:
   - Title
   - URL (full auction page URL)
   - Cover image URL
   - Current/high bid amount
   - Final bid amount (if sold)
   - Sale status (Sold/Unsold)
   - Auction slug/ID

2. **Auction Page** (to be scraped):
   - Vehicle details (year, make, model, trim, mileage, VIN if available)
   - Full description
   - Gallery images
   - Seller information (username/profile)
   - Bid history
   - Comments
   - Auction dates (start, end)
   - Location

3. **Member/User Profiles** (similar to BaT):
   - Profile URL pattern: `/member/{username}/` or `/seller/{username}/`
   - Listings sold/listed
   - Profile information
   - Statistics

## Database Schema Mapping

### Vehicles Table

Following BaT import pattern (`profile_origin: 'bat_import'`), use:

```typescript
{
  year: number,
  make: string,  // lowercase
  model: string, // lowercase
  vin: string | null,
  sale_price: number | null,  // Final bid if sold
  sale_date: Date | null,     // Auction end date if sold
  auction_end_date: string | null,
  auction_outcome: 'sold' | 'reserve_not_met' | null,
  
  // Origin tracking
  profile_origin: 'pcarmarket_import',
  discovery_source: 'pcarmarket',
  discovery_url: string,  // Full auction URL
  listing_url: string,    // Same as discovery_url
  
  // Metadata
  origin_metadata: {
    source: 'pcarmarket_import',
    pcarmarket_url: string,
    pcarmarket_listing_title: string,
    pcarmarket_seller_username: string | null,
    pcarmarket_buyer_username: string | null,
    pcarmarket_auction_id: string,
    pcarmarket_auction_slug: string,
    bid_count: number | null,
    view_count: number | null,
    sold_status: 'sold' | 'unsold',
    imported_at: timestamp
  },
  
  is_public: true,
  description: string | null
}
```

### Organizations Table

Create organization profile for PCarMarket.com:

```typescript
{
  business_name: 'PCarMarket',
  business_type: 'auction_house',
  website: 'https://www.pcarmarket.com',
  description: 'Premium car auction marketplace',
  is_verified: false,
  is_public: true
}
```

### Organization-Vehicle Links

Link vehicles to PCarMarket organization:

```typescript
{
  organization_id: <pcarmarket_org_id>,
  vehicle_id: <vehicle_id>,
  relationship_type: 'consigner',  // or 'sold_by' if sold
  status: 'active',
  listing_status: 'sold' | 'listed',
  sale_price: number | null,
  sale_date: Date | null,
  listing_url: string,
  auto_tagged: true
}
```

### User/Member Profiles (Future Enhancement)

Similar to `bat_user_profiles` table:

```typescript
{
  username: string,  // PCarMarket username
  profile_url: string,
  total_listings: number,
  total_sold: number,
  total_listed: number,
  avg_sale_price: number,
  // ... similar to bat_user_profiles
}
```

## Implementation Plan

### Phase 1: Basic Scraper & Listing Extraction

**Files to Create/Modify**:
- `scripts/scrape-pcarmarket-listings.js` - Main scraper
- `supabase/functions/import-pcarmarket-listing/index.ts` - Edge function for individual listing import

**Tasks**:
1. ✅ Parse listing HTML (completed in `scraper.py`)
2. Extract individual auction page data
3. Parse vehicle details from auction page
4. Extract gallery images
5. Extract seller/buyer information

### Phase 2: Organization Profile Setup

**Tasks**:
1. Create PCarMarket organization in `businesses` table
2. Set up organization metadata
3. Add to `organizationFromSource.ts` mapping

### Phase 3: Vehicle Import Integration

**Tasks**:
1. Create `import-pcarmarket-listing` Edge Function (similar to `import-bat-listing`)
2. Follow BaT import patterns:
   - Find or create vehicle by VIN/URL
   - Extract and store images
   - Link to organization
   - Store origin metadata
3. Handle duplicate detection
4. Support bulk import from listing pages

### Phase 4: Member Profile Extraction

**Tasks**:
1. Create `extract-pcarmarket-profile` Edge Function (similar to `extract-bat-profile-vehicles`)
2. Extract member profile pages
3. List all vehicles associated with member
4. Build member statistics

### Phase 5: Bulk Import & Automation

**Tasks**:
1. Create bulk import script for all listings
2. Set up monitoring for new listings
3. Create GitHub Actions or scheduled job for regular updates

## Data Mapping Details

### Listing Page → Vehicle Mapping

```javascript
{
  // From listing card
  title: "5k-Mile 2002 Aston Martin DB7 V12 Vantage Coupe"
    → Parse: { year: 2002, make: "aston martin", model: "db7", trim: "v12 vantage coupe", mileage: 5000 }
  
  url: "/auction/2002-aston-martin-db7-v12-vantage-2"
    → Full URL: "https://www.pcarmarket.com/auction/2002-aston-martin-db7-v12-vantage-2"
    → Extract slug: "2002-aston-martin-db7-v12-vantage-2"
    → Extract ID: "2" (may need to scrape auction page to get actual ID)
  
  image_url: "https://d2niwqq19lf86s.cloudfront.net/..."
    → Store as primary vehicle image
  
  bid_amount: "$25,000" or "$220,000"
    → Parse: 25000 or 220000
  
  status: "Unsold" or "Sold"
    → Map to: auction_outcome
}
```

### Auction Page → Detailed Vehicle Data

Extract from full auction page:
- Full description
- Gallery images (multiple)
- VIN (if available)
- Mileage (detailed)
- Seller username/profile
- Buyer username/profile (if sold)
- Bid history
- Comments
- Auction dates
- Location

## Code Structure

### Scraper Script

```javascript
// scripts/scrape-pcarmarket-listings.js
- scrapeListingPage(url) // Scrape listing index page
- scrapeAuctionPage(url)  // Scrape individual auction page
- parseVehicleFromListing(listing) // Extract vehicle data
- importVehicle(vehicleData) // Import to database
```

### Edge Function

```typescript
// supabase/functions/import-pcarmarket-listing/index.ts
- Follows pattern of import-bat-listing
- Handles single listing import
- Returns vehicle_id and import status
```

## Next Steps

1. **Immediate**: Create basic scraper for listing pages
2. **Short-term**: Implement auction page scraping
3. **Medium-term**: Build Edge Function for import
4. **Long-term**: Add member profile extraction and bulk import automation

## Similarities to BaT Import

- Same vehicle table structure
- Same origin tracking pattern (`profile_origin`, `origin_metadata`)
- Same organization linking via `organization_vehicles`
- Same image import pattern
- Same member profile extraction approach

## Differences from BaT

- Different URL structure (pcarmarket.com vs bringatrailer.com)
- Different HTML structure
- May have different data availability (VIN, seller info, etc.)
- Different auction format/flow

