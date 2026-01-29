# duPont Registry Complete Ingestion Plan

## Overview

duPont Registry (`dupontregistry.com`) is a luxury/exotic car marketplace featuring:
- **Vehicle Listings**: Private sales, dealer inventory, consignments
- **Dealer Profiles**: Luxury dealerships with inventory
- **Private Seller Profiles**: High-end collectors
- **Auction Listings**: Some auction-style sales

This document maps **all profile types**, **database fields**, and **ingestion strategy** following the SBX Cars pattern.

---

## Site Structure & Profile Types

**IMPORTANT**: duPont Registry has **TWO SEPARATE SITES**:

### Site 1: Main Marketplace (`www.dupontregistry.com`)
- **URL Pattern**: `https://www.dupontregistry.com/autos/listing/{year}/{make}/{model}/{listing-id}`
- **Example**: `https://www.dupontregistry.com/autos/listing/2025/ferrari/296--gts/506113`
- **Type**: `'marketplace'` - Standard dealer/private sales listings
- **Access**: Individual listings accessible, browse/search may require login

### Site 2: Live Auctions (`live.dupontregistry.com`)
- **URL Pattern**: `https://live.dupontregistry.com/auction/{year}-{make}-{model}-{slug}-{lot-number}`
- **Example**: `https://live.dupontregistry.com/auction/2021-lamborghini-urushighspec-400`
- **Type**: `'auction_house'` - Auction-style listings with bidding
- **Access**: Individual auction pages accessible, browse/search **requires login**

### Profile Types

#### 1. Vehicle Listings (Primary)
- **Marketplace Listings**: Standard sales (dealer/private)
- **Auction Listings**: Live auctions with bidding

#### 2. Dealer Profiles
- **URL Pattern**: `https://www.dupontregistry.com/dealers/{dealer-slug}`
- **Type**: `'dealer'` organization

#### 3. Private Seller Profiles (if accessible)
- **URL Pattern**: `https://www.dupontregistry.com/sellers/{seller-slug}` (if exists)
- **Type**: `'private_seller'` or external identity

---

## Database Field Mapping

### Core Vehicle Fields (vehicles table)

| duPont Registry Source | Database Field | Example Value | Notes |
|----------------------|----------------|---------------|-------|
| **Title/Heading** | `year` | `2020` | Extracted from title/URL |
| **Title/Heading** | `make` | `Ferrari` | Extracted from title/URL |
| **Title/Heading** | `model` | `F8 Tributo` | Extracted from title |
| **Title** | `bat_listing_title` | Full title text | Complete listing title |
| **URL** | `discovery_url` | Full listing URL | `https://www.dupontregistry.com/autos/...` |
| **URL** | `platform_url` | Same as discovery_url | Platform URL |
| **Price** | `asking_price` | `450000` | Asking price (USD) |
| **Price** | `sale_price` | Same as asking_price | If marked sold |
| **Mileage** | `mileage` | `3500` | Odometer reading |
| **VIN** | `vin` | `ZFF79ALA0L0251234` | If available |
| **Color** | `color` | `Rosso Corsa` | Exterior color |
| **Location** | `bat_location` (or raw_data) | `Miami, FL` | Vehicle location |
| **Dealer/Seller** | `bat_seller` (or raw_data) | Dealer name | Seller identifier |
| **Description** | `notes` | Full description text | Complete vehicle narrative |
| **Status** | `sale_status` | `'available'` or `'sold'` | Sale status |
| **Source** | `discovery_source` | `'dupontregistry'` | Source identifier |
| **Source** | `auction_source` | `null` (unless auction) | Only if auction-style |

### Detailed Sections (stored in raw_data)

| Section | Database Location | Structure |
|---------|-------------------|-----------|
| **Specifications** | `raw_data.specs` | `{ text: string, items: string[], keyValuePairs: {} }` |
| **Features** | `raw_data.features` | `{ text: string, items: string[] }` |
| **Exterior** | `raw_data.exterior` | `{ text: string, items: string[] }` |
| **Interior** | `raw_data.interior` | `{ text: string, items: string[] }` |
| **Mechanical** | `raw_data.mechanical` | `{ text: string, items: string[] }` |
| **History** | `raw_data.history` | `{ text: string, items: string[] }` |
| **Options** | `raw_data.options` | `{ text: string, items: string[] }` |
| **Service Records** | `raw_data.service` | `{ text: string, items: string[] }` |

### Dealer/Seller Information

| duPont Registry Source | Database Field | Table | Notes |
|----------------------|----------------|-------|-------|
| **Dealer Name** | `business_name` | `businesses` | Dealer organization |
| **Dealer Website** | `website` | `businesses` | Dealer website URL |
| **Dealer Location** | `city`, `state` | `businesses` | Dealer location |
| **Dealer Phone** | `phone` | `businesses` | Contact phone |
| **Dealer Email** | `email` | `businesses` | Contact email |
| **Dealer Logo** | `logo_url` | `businesses` | Logo image URL |
| **Inventory URL** | `inventory_url` | `businesses` | Link to dealer inventory |
| **Private Seller** | `handle` | `external_identities` | If private seller |
| **Private Seller** | `platform` | `external_identities` | `'dupontregistry'` |

### Discovery Metadata

| Field | Value | Notes |
|-------|-------|-------|
| `discovery_source` | `'dupontregistry'` | Source identifier |
| `discovered_at` | ISO timestamp | When scraped |
| `discovery_url` | Full listing URL | Original URL |

---

## Import Queue Fields (import_queue table)

| Field | Value Source | Example |
|-------|--------------|---------|
| `source_id` | From `scrape_sources` table | UUID |
| `listing_url` | Full listing URL | `https://www.dupontregistry.com/autos/...` |
| `listing_title` | Full title | "2020 Ferrari F8 Tributo..." |
| `listing_price` | Asking price | `450000` |
| `listing_year` | Parsed year | `2020` |
| `listing_make` | Parsed make | `Ferrari` |
| `listing_model` | Parsed model | `F8 Tributo` |
| `thumbnail_url` | First gallery image | Image URL |
| `raw_data` | Complete JSON structure | See below |
| `status` | Static | `'pending'` |
| `priority` | Based on price/rarity | `10` (high-end) or `5` (standard) |

---

## Complete raw_data Structure

```json
{
  "source": "dupontregistry",
  "url": "https://www.dupontregistry.com/autos/ferrari/f8-tributo/2020/...",
  "title": "2020 Ferrari F8 Tributo - Rosso Corsa - 3,500 Miles",
  "year": 2020,
  "make": "Ferrari",
  "model": "F8 Tributo",
  "price": 450000,
  "currency": "USD",
  "mileage": 3500,
  "vin": "ZFF79ALA0L0251234",
  "color": "Rosso Corsa",
  "interior_color": "Nero",
  "location": "Miami, FL",
  "seller_type": "dealer",
  "seller_name": "Ferrari of Miami",
  "seller_website": "https://...",
  "seller_phone": "+1-305-...",
  "seller_email": "info@...",
  "listing_status": "available",
  "description": "Full description text...",
  "specs": {
    "text": "Specifications...",
    "items": ["Spec 1", "Spec 2"],
    "keyValuePairs": {
      "Engine": "3.9L V8 Twin Turbo",
      "Horsepower": "710 HP",
      "Transmission": "7-Speed Dual Clutch",
      "Drivetrain": "RWD",
      "0-60 MPH": "2.9 seconds"
    }
  },
  "features": {
    "text": "Features list...",
    "items": [
      "Carbon Fiber Racing Seats",
      "Premium Sound System",
      "Navigation System"
    ]
  },
  "exterior": {
    "text": "Exterior details...",
    "items": ["Detail 1", "Detail 2"]
  },
  "interior": {
    "text": "Interior details...",
    "items": ["Detail 1", "Detail 2"]
  },
  "mechanical": {
    "text": "Mechanical details...",
    "items": ["Detail 1", "Detail 2"]
  },
  "history": {
    "text": "Vehicle history...",
    "items": ["History item 1", "History item 2"]
  },
  "options": {
    "text": "Options list...",
    "items": ["Option 1", "Option 2"]
  },
  "service": {
    "text": "Service records...",
    "items": ["Service 1", "Service 2"]
  },
  "image_count": 45,
  "image_urls": ["url1", "url2", ...],
  "scraped_at": "2025-12-24T18:30:00Z"
}
```

---

## Profile Type-Specific Mappings

### 1. Vehicle Listings (Primary Ingestion)

**Fields Populated:**
- ✅ Core identity: `year`, `make`, `model` (from title/URL)
- ✅ Pricing: `asking_price`, `sale_price` (if sold)
- ✅ Specs: `mileage`, `vin`, `color`, `transmission`, `engine_size`, `horsepower`
- ✅ Location: `bat_location` or `raw_data.location`
- ✅ Seller: `bat_seller` or organization link
- ✅ Description: `notes` (full narrative)
- ✅ Images: All gallery images → `vehicle_images` table
- ✅ Sections: All detailed sections → `raw_data`

**Tables Affected:**
- `vehicles` (core vehicle record)
- `import_queue` (ingestion queue)
- `vehicle_images` (all gallery images)
- `timeline_events` (discovery event)
- `businesses` (if dealer seller)
- `external_identities` (if private seller)
- `organization_vehicles` (dealer-vehicle link)
- `dealer_inventory` (if dealer)

### 2. Dealer Profiles

**Fields Populated:**
- ✅ `business_name` - Dealer name
- ✅ `website` - Dealer website
- ✅ `phone` - Contact phone
- ✅ `email` - Contact email
- ✅ `city`, `state` - Location
- ✅ `logo_url` - Logo image
- ✅ `inventory_url` - Link to inventory
- ✅ `business_type` - `'dealership'`
- ✅ `metadata.discovered_from` - duPont Registry URL

**Tables Affected:**
- `businesses` (dealer organization)
- `organization_vehicles` (inventory links)

**After Creation:**
- External data lookup triggered (if website found)
- Website inventory sync (if inventory URL found)

### 3. Private Seller Profiles (if accessible)

**Fields Populated:**
- ✅ `handle` - Seller username/identifier
- ✅ `platform` - `'dupontregistry'`
- ✅ `profile_url` - Profile URL
- ✅ `name` - Display name (if available)
- ✅ `last_seen_at` - Current timestamp

**Tables Affected:**
- `external_identities` (private seller identity)

---

## Field Extraction Summary

### ✅ Core Vehicle Identity (Required)
- `year`, `make`, `model` - Parsed from title/URL
- `listing_url` - For deduplication

### ✅ Pricing & Status
- `asking_price` - Asking price (USD)
- `sale_price` - If marked sold
- `sale_status` - `'available'` or `'sold'`

### ✅ Vehicle Details
- `mileage` - Odometer reading
- `vin` - VIN if available
- `color` - Exterior color
- `transmission` - Transmission type
- `engine_size` - Engine displacement
- `horsepower` - HP rating
- `drivetrain` - RWD/AWD/FWD

### ✅ Detailed Sections (All Extracted)
- `specs` - Specifications with key-value pairs
- `features` - Feature list
- `exterior` - Exterior details
- `interior` - Interior details
- `mechanical` - Mechanical details
- `history` - Vehicle history
- `options` - Options list
- `service` - Service records

### ✅ Seller/Dealer Information
- **Dealer** → Organization created with external data lookup
- **Private Seller** → External identity created

### ✅ Content Merging
- **All sections** → Stored in raw_data for full access
- **Description** → Merged narrative in `notes`

---

## Custom Fields for duPont Registry

### Source-Specific Fields (in raw_data)

| Field | Type | Description |
|-------|------|-------------|
| `seller_type` | `string` | `'dealer'` or `'private'` |
| `seller_name` | `string` | Dealer/seller name |
| `seller_website` | `string` | Seller website URL |
| `seller_phone` | `string` | Contact phone |
| `seller_email` | `string` | Contact email |
| `listing_status` | `string` | `'available'`, `'sold'`, `'pending'` |
| `interior_color` | `string` | Interior color name |
| `currency` | `string` | Always `'USD'` for duPont Registry |
| `image_count` | `number` | Total gallery images |
| `image_urls` | `array` | All image URLs |

### High-Signal Fields (stored separately if needed)

- **VIN** - Stored in `vehicles.vin` (high confidence if present)
- **Mileage** - Stored in `vehicles.mileage` (if available)
- **Color** - Stored in `vehicles.color` (exterior color)
- **Price** - Stored in `vehicles.asking_price` (high confidence)

---

## DOM Mapping & Extraction Strategy

### URL Patterns

1. **Vehicle Listings**:
   - Pattern: `/autos/{make}/{model}/{year}/{slug}`
   - Extract: `make`, `model`, `year` from URL path

2. **Dealer Profiles**:
   - Pattern: `/dealers/{dealer-slug}`
   - Extract: Dealer information

3. **Search/Browse Pages**:
   - Pattern: `/autos/results/{make}` or `/autos`
   - Extract: All listing URLs from results

### Page Sections (Vehicle Listing)

1. **Header/Title Section**
   - Title: `h1` or `[class*="title"]`
   - Price: `[class*="price"]` or `[data-price]`
   - Status: `[class*="status"]` or `[data-status]`

2. **Image Gallery**
   - Images: `[class*="gallery"] img` or `[data-image]`
   - Extract all `src`, `data-src`, `data-image` attributes

3. **Specifications Section**
   - Specs: `[class*="spec"]` or `[class*="specification"]`
   - Key-value pairs: `dt`/`dd` pairs or table rows

4. **Description Section**
   - Description: `[class*="description"]` or main content area
   - Full narrative text

5. **Features Section**
   - Features: `[class*="feature"]` or list items
   - Array of feature strings

6. **Seller/Dealer Section**
   - Seller name: `[class*="seller"]` or `[class*="dealer"]`
   - Contact info: Phone, email, website links
   - Location: Address or city/state

7. **History/Service Section**
   - History: `[class*="history"]` or `[class*="service"]`
   - Service records: List items or table rows

### Extraction Priority

1. **High Priority** (Required for vehicle creation):
   - `year`, `make`, `model` (from title/URL)
   - `listing_url` (for deduplication)
   - `images` (at least one for thumbnail)
   - `price` (asking price)

2. **Medium Priority** (Enhance vehicle profile):
   - `mileage`, `vin`, `color`
   - `description`
   - `location`
   - `seller_name`

3. **Low Priority** (Nice to have):
   - `specs` key-value pairs
   - `features` array
   - `history` details
   - `service` records

---

## Scrape Source Configuration

### scrape_sources Table Entry

```sql
INSERT INTO scrape_sources (
  domain,
  source_name,
  source_type,
  base_url,
  is_active
) VALUES (
  'dupontregistry.com',
  'duPont Registry',
  'marketplace',  -- or 'dealer' if dealer-focused
  'https://www.dupontregistry.com',
  true
);
```

---

## Ingestion Flow

### 1. Discovery Phase
- Scrape browse/search pages: `/autos`, `/autos/results/{make}`
- Extract all vehicle listing URLs
- Extract dealer profile URLs (if accessible)

### 2. Scraping Phase
- For each vehicle listing:
  - Scrape full page content
  - Extract all fields (see mapping above)
  - Download all gallery images
  - Add to `import_queue` with `raw_data`

### 3. Processing Phase (via `process-import-queue`)
- Create vehicle record in `vehicles` table
- Download and link all images to `vehicle_images`
- Create dealer organization (if dealer seller)
- Create external identity (if private seller)
- Link vehicle to dealer via `organization_vehicles`
- Create discovery timeline event
- Update `dealer_inventory` (if dealer)

---

## Additional Tables Populated

### vehicle_images (via process-import-queue)
- **All gallery images** downloaded and linked
- Primary image set from first gallery image
- Images stored in Supabase Storage
- Linked via `vehicle_id`

### timeline_events (via process-import-queue)
- Discovery event:
  - `event_type`: `'discovery'`
  - `source`: `'dupontregistry'`
  - `description`: `'Discovered on duPont Registry'`
  - `event_date`: Current date

### origin_metadata (in vehicles table)
```json
{
  "source_id": "<uuid>",
  "queue_id": "<uuid>",
  "imported_at": "2025-12-24T18:30:00Z",
  "image_urls": ["url1", "url2", ...],
  "image_count": 45,
  "dupontregistry": {
    "seller_type": "dealer",
    "seller_name": "Ferrari of Miami",
    "seller_website": "https://...",
    "listing_status": "available",
    "interior_color": "Nero"
  }
}
```

### organization_vehicles (via process-import-queue)
- **Dealer organization** linked to vehicle:
  - `organization_id`: Dealer org UUID
  - `vehicle_id`: Vehicle UUID
  - `relationship_type`: `'seller'`
  - `status`: `'active'`

### dealer_inventory (via process-import-queue)
- If seller is a dealer:
  - `dealer_id`: Dealer org UUID
  - `vehicle_id`: Vehicle UUID
  - `status`: `'in_stock'` or `'sold'` (based on listing status)
  - `asking_price`: Listing price
  - `sale_date`: If marked sold

---

## Notes

- **Currency**: Always USD for duPont Registry
- **Image Count**: Variable (typically 20-100+ images per listing)
- **Dynamic Content**: Site uses JavaScript rendering - Firecrawl recommended
- **Rate Limiting**: 1-2 second delay between listings recommended
- **Deduplication**: Use `listing_url` as unique identifier
- **Seller Types**: Both dealers and private sellers (handle accordingly)
- **VIN Availability**: VIN may not always be present (lower confidence)
- **Price Confidence**: High (directly from listing)
- **Mileage Confidence**: High if present (directly from listing)

---

## Organization & User Profile Creation

### 1. duPont Registry Organization (Platform Itself)

**Create once** for the platform:

```sql
INSERT INTO businesses (
  business_name,
  business_type,
  website,
  description,
  is_public,
  is_verified,
  metadata
) VALUES (
  'duPont Registry',
  'marketplace',
  'https://www.dupontregistry.com',
  'Luxury and exotic car marketplace featuring dealer and private sales, plus live auctions',
  true,
  false,
  '{
    "platforms": ["www.dupontregistry.com", "live.dupontregistry.com"],
    "source_type": "marketplace",
    "auction_platform": true
  }'::jsonb
);
```

**Also create for Live Auctions subdomain:**
- `business_name`: `'duPont Registry Live'`
- `website`: `'https://live.dupontregistry.com'`
- `business_type`: `'auction_house'`
- Link via `metadata.parent_org` if needed

### 2. User Profiles (Bidders/Sellers)

**External Identities for Platform Users:**

From auction listings and user profiles (`live.dupontregistry.com/user/{username}`):

```typescript
// Create external identity for bidder/seller
await supabase.from('external_identities').insert({
  platform: 'dupontregistry',
  handle: 'mark.goldman431', // username from URL
  profile_url: 'https://live.dupontregistry.com/user/mark.goldman431',
  display_name: 'Mark Goldman', // if available from profile
  metadata: {
    user_type: 'bidder', // or 'seller'
    first_seen_at: new Date().toISOString(),
    discovered_from: listingUrl
  }
});
```

**User Profile Data (if accessible):**
- **Username**: From URL (`mark.goldman431`)
- **Display Name**: If available on profile page
- **Profile URL**: `https://live.dupontregistry.com/user/{username}`
- **Activity**: Bids placed, listings watched, vehicles sold
- **Note**: User profiles may require login - scrape what's accessible

### 3. Dealer Profiles (e.g., Lexani Motorcars)

**Dealer Profile URL Pattern:**
- `https://www.dupontregistry.com/autos/{dealer-slug}/{dealer-id}`
- **Example**: `https://www.dupontregistry.com/autos/lexani--motorcars/734`

**Fields to Extract:**
- **Dealer Name**: `business_name`
- **Dealer Website**: `website` (e.g., `https://lexanimotorcars.com/`)
- **Dealer Location**: `city`, `state`
- **Dealer Phone**: `phone`
- **Dealer Email**: `email` (if available)
- **Dealer Description**: `description`
- **Inventory URL**: Link to dealer's inventory on duPont Registry
- **External Website**: May have separate website (like Lexani's weird site)
- **Social Media**: Instagram, Facebook, etc. (e.g., `https://www.instagram.com/lexanimotorcars/`)

**Special Case: Lexani Motorcars**
- **Website**: `https://lexanimotorcars.com/` (weird/shitty site per user)
- **Instagram**: `https://www.instagram.com/lexanimotorcars/` (clear presence)
- **Business Type**: Executive mobile service, luxury conversions
- **Note**: Lots of fake/generated imagery (be aware when scraping)
- **Strategy**: Prioritize Instagram for real imagery, website for contact info

**Organization Creation Logic:**

```typescript
async function createDealerOrganization(
  dealerName: string,
  dealerSlug: string,
  dealerId: string,
  dealerWebsite: string | null,
  dealerLocation: string | null,
  dealerPhone: string | null,
  dealerEmail: string | null,
  instagramHandle: string | null,
  sourceUrl: string,
  supabase: any
) {
  // Check if exists by name or website
  const { data: existing } = await supabase
    .from('businesses')
    .select('id')
    .or(`business_name.ilike.%${dealerName}%,website.eq.${dealerWebsite}`)
    .maybeSingle();

  if (existing) {
    return existing.id;
  }

  // Create organization
  const { data: newOrg } = await supabase
    .from('businesses')
    .insert({
      business_name: dealerName,
      business_type: 'dealership',
      website: dealerWebsite,
      phone: dealerPhone,
      email: dealerEmail,
      city: dealerLocation?.split(',')[0] || null,
      state: dealerLocation?.split(',')[1]?.trim() || null,
      is_public: true,
      metadata: {
        dupont_registry_slug: dealerSlug,
        dupont_registry_id: dealerId,
        dupont_registry_url: sourceUrl,
        instagram_handle: instagramHandle,
        discovered_from: sourceUrl,
        discovered_at: new Date().toISOString()
      }
    })
    .select('id')
    .single();

  // Create external identity for Instagram (if available)
  if (instagramHandle && newOrg) {
    await supabase.from('external_identities').insert({
      platform: 'instagram',
      handle: instagramHandle.toLowerCase(),
      profile_url: `https://www.instagram.com/${instagramHandle}/`,
      display_name: dealerName,
      metadata: {
        organization_id: newOrg.id,
        linked_at: new Date().toISOString()
      }
    });
  }

  // Trigger external data extraction if website exists
  if (newOrg && dealerWebsite) {
    await supabase.functions.invoke('extract-organization-from-seller', {
      body: {
        seller_name: dealerName,
        seller_url: sourceUrl,
        website: dealerWebsite,
        platform: 'dupontregistry'
      }
    });
  }

  return newOrg?.id;
}
```

---

## Browse/Search Page DOM Mapping

### URL: `https://www.dupontregistry.com/autos/results/all`

**Page Structure:**

#### 1. Listing Grid/List
- **Selector**: `[class*="listing"]` or `[class*="result"]` or `[class*="vehicle-card"]`
- **Extract**: All vehicle listing cards
- **Pattern**: Each card contains:
  - **Title**: `year make model`
  - **Price**: `$XXX,XXX`
  - **Thumbnail**: Image URL
  - **Link**: Full listing URL
  - **Location**: City, State (if available)
  - **Mileage**: If shown on card
  - **Dealer/Seller**: Name (if shown)

#### 2. Listing URL Extraction
- **Selector**: `a[href*="/autos/listing/"]` or `a[href*="/autos/"]`
- **Pattern**: `/autos/listing/{year}/{make}/{model}/{id}`
- **Extract**: All unique listing URLs

#### 3. Pagination
- **Selector**: `[class*="pagination"]` or `[class*="page"]`
- **Extract**: Next page links, page numbers
- **Pattern**: `/autos/results/all?page={n}` or similar

#### 4. Filters (if accessible)
- **Selector**: `[class*="filter"]` or `[class*="search"]`
- **Extract**: Make, model, year, price range filters
- **Note**: May require login for full filter access

**Extraction Strategy:**
1. Scrape first page (may be accessible without login)
2. Extract all listing URLs
3. Follow pagination if accessible
4. If login required, use authenticated session for discovery only
5. Scrape individual listings directly (no login needed)

---

## Implementation Checklist

- [ ] Create `scrape-dupontregistry` Edge Function
- [ ] Create duPont Registry organization profile (platform)
- [ ] Create duPont Registry Live organization profile (auction subdomain)
- [ ] Implement browse page discovery (`/autos/results/all`)
- [ ] Implement vehicle listing scraper (marketplace)
- [ ] Implement auction listing scraper (`live.dupontregistry.com`)
- [ ] Implement dealer profile scraper (`/autos/{dealer-slug}/{id}`)
- [ ] Implement user profile scraper (`live.dupontregistry.com/user/{username}`)
- [ ] Create external identities for bidders/sellers
- [ ] Create dealer organizations with Instagram links
- [ ] Handle Lexani-style dealers (weird website, clear Instagram)
- [ ] Map all fields to database schema
- [ ] Handle image extraction and storage
- [ ] Link vehicles to dealers/organizations
- [ ] Test with sample listings
- [ ] Deploy and monitor

---

## Login Requirement Strategy

### Problem
- **Browse/Search Pages**: Require login to view full results (especially on `live.dupontregistry.com`)
- **Individual Listings**: Accessible without login (both sites)

### Solutions

#### Option 1: Direct URL Scraping (Recommended) ✅
**Strategy**: Scrape individual listing URLs directly
- **Pros**: No login required, simpler implementation, faster
- **Cons**: Need to discover URLs from other sources

**URL Discovery Methods**:
1. **Sitemap**: Check `https://www.dupontregistry.com/sitemap.xml` and `https://live.dupontregistry.com/sitemap.xml`
2. **RSS Feeds**: Check for RSS/Atom feeds
3. **Search Engine Results**: Use Google/Bing `site:` queries
4. **External Aggregators**: If available
5. **Incremental Discovery**: Start with known URLs, follow internal links

#### Option 2: Authenticated Scraping (If Needed)
**Strategy**: Create account and maintain session for discovery only
- **Pros**: Full access to browse/search for URL discovery
- **Cons**: Account management, rate limiting, ToS concerns

**Implementation**:
1. Create account (if free tier available)
2. Login via Playwright/Firecrawl
3. Maintain session cookies
4. Scrape browse/search pages **only for URL discovery**
5. Extract all listing URLs
6. Scrape individual listings **without auth** (they're accessible)

**Tools**:
- **Firecrawl**: Supports authenticated sessions
- **Playwright**: Full browser automation with login

#### Option 3: Hybrid Approach (Best) ✅
**Strategy**: Combine both methods
1. **Primary**: Direct URL scraping (no login) - scrape individual listings
2. **Secondary**: Authenticated scraping for discovery (if needed) - only to get URLs
3. **Fallback**: Manual URL list, sitemap, or search engine results

### Recommendation
**Start with Option 1 (Direct URL Scraping)**:
- Individual listings are accessible on both sites
- Use sitemap/search engines for URL discovery
- Only add authentication if URL discovery becomes a bottleneck

## Questions to Resolve

1. ✅ **Auction Listings**: Confirmed - `live.dupontregistry.com` has auction-style listings (handle like SBX Cars)
2. **Dealer Profile Access**: Are dealer profiles publicly accessible? If so, scrape them separately.
3. **Private Seller Profiles**: Are private seller profiles accessible? If so, create external identities.
4. **Image Storage**: Confirm image storage strategy (Supabase Storage bucket).
5. **Rate Limiting**: Confirm rate limits with Firecrawl/Playwright.
6. **Sitemap Availability**: Verify sitemap.xml exists for both sites.

---

## Summary

**Total Fields Mapped**: ~50+ fields across multiple tables
**Profile Types**: 3 (Vehicle Listings, Dealer Profiles, Private Seller Profiles)
**Custom Fields**: 10+ source-specific fields in `raw_data`
**Tables Affected**: 8+ (vehicles, import_queue, vehicle_images, businesses, external_identities, organization_vehicles, dealer_inventory, timeline_events)

**Pattern**: Follows SBX Cars ingestion pattern with duPont Registry-specific adaptations.

