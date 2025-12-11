# Dealer Profile Data Format - Raw Output

## Overview

This document describes the data format for **dealer/auction house profile extraction**, specifically from Classic.com and similar dealer directories.

---

## Request Format

### Index Classic.com Dealer Profile

```typescript
// Input to index-classic-com-dealer
{
  profile_url: "https://www.classic.com/s/111-motorcars-ZnQygen/"
}
```

---

## Response Format

### Success Response - Dealer Profile Created

```json
{
  "success": true,
  "organization_id": "550e8400-e29b-41d4-a716-446655440000",
  "organization_name": "111 Motorcars",
  "logo_url": "https://supabase.co/storage/v1/object/public/public/organization-logos/111motorcars-com-logo.png",
  "dealer_data": {
    "name": "111 Motorcars",
    "logo_url": "https://images.classic.com/uploads/dealer/One_Eleven_Motorcars.png",
    "website": "https://www.111motorcars.com",
    "address": "123 Main Street",
    "city": "Franklin",
    "state": "TN",
    "zip": "37064",
    "phone": "(615) 555-0123",
    "email": "info@111motorcars.com",
    "dealer_license": "DL12345",
    "license_type": "dealer_license",
    "business_type": "dealer",
    "description": "Specializing in classic trucks and muscle cars...",
    "specialties": ["Classic Trucks", "Muscle Cars", "Squarebodies"],
    "inventory_url": "https://www.111motorcars.com/inventory",
    "auctions_url": null
  },
  "action": "created"  // or "found_existing"
}
```

### Success Response - Existing Dealer Found

```json
{
  "success": true,
  "organization_id": "550e8400-e29b-41d4-a716-446655440000",
  "organization_name": "111 Motorcars",
  "logo_url": "https://supabase.co/storage/v1/object/public/public/organization-logos/111motorcars-com-logo.png",
  "dealer_data": {
    "name": "111 Motorcars",
    "website": "https://www.111motorcars.com",
    "city": "Franklin",
    "state": "TN",
    "dealer_license": "DL12345",
    "business_type": "dealer"
  },
  "action": "found_existing"
}
```

### Error Response - Missing Greenlight Signals

```json
{
  "success": false,
  "error": "Missing required greenlight signals (name, logo, license)"
}
```

---

## Dealer Profile Data Fields

### Required Greenlight Signals (Auto-creation enabled if all present)

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `name` | `string \| null` | Dealer/business name | `"111 Motorcars"` |
| `logo_url` | `string \| null` | Logo image URL | `"https://images.classic.com/uploads/dealer/..."` |
| `dealer_license` | `string \| null` | Dealer license number | `"DL12345"` |

### Contact Information

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `website` | `string \| null` | Main website URL | `"https://www.111motorcars.com"` |
| `phone` | `string \| null` | Phone number | `"(615) 555-0123"` |
| `email` | `string \| null` | Email address | `"info@111motorcars.com"` |

### Location Information

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `address` | `string \| null` | Street address | `"123 Main Street"` |
| `city` | `string \| null` | City name | `"Franklin"` |
| `state` | `string \| null` | State abbreviation | `"TN"` |
| `zip` | `string \| null` | Zip code | `"37064"` |

### Business Classification

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `business_type` | `"dealer" \| "auction_house"` | Business type | `"dealer"` or `"auction_house"` |
| `license_type` | `"dealer_license" \| "auction_license" \| null` | License type | `"dealer_license"` |
| `dealer_license` | `string \| null` | License number | `"DL12345"` |

### Business Details

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `description` | `string \| null` | Business description | `"Specializing in classic trucks..."` |
| `specialties` | `string[]` | Array of specialties | `["Classic Trucks", "Muscle Cars"]` |

### Inventory/Auction URLs

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `inventory_url` | `string \| null` | URL to inventory page (dealers) | `"https://www.111motorcars.com/inventory"` |
| `auctions_url` | `string \| null` | URL to auctions page (auction houses) | `"https://auctionhouse.com/auctions"` |

---

## Database Mapping

The extracted dealer profile data maps to the `businesses` table:

```sql
INSERT INTO businesses (
  business_name,        -- dealer_data.name
  business_type,        -- 'dealership' if dealer_data.business_type = 'dealer'
                        -- 'other' if dealer_data.business_type = 'auction_house'
  type,                 -- dealer_data.business_type ('dealer' or 'auction_house')
  website,              -- dealer_data.website
  phone,                -- dealer_data.phone
  email,                -- dealer_data.email
  address,              -- dealer_data.address
  city,                 -- dealer_data.city
  state,                -- dealer_data.state
  zip_code,             -- dealer_data.zip
  dealer_license,       -- dealer_data.dealer_license
  logo_url,             -- Downloaded and stored in Supabase Storage
  description,          -- dealer_data.description
  specialties,          -- dealer_data.specialties (JSON array)
  geographic_key,       -- Generated: "name-city-state"
  discovered_via,       -- 'classic_com_indexing'
  source_url,           -- profile_url
  metadata              -- JSON with classic_com_profile, inventory_url, auctions_url
)
```

---

## Multi-Source Dealer Profile Extraction

When extracting dealer profiles from multiple sources (not just Classic.com), use `scrape-multi-source` with `extract_dealer_info: true`:

### Request

```typescript
{
  source_url: "https://dealer.com/about",
  source_type: "dealer_website",
  extract_dealer_info: true,
  extract_listings: false
}
```

### Response

```json
{
  "success": true,
  "source_id": "source-uuid",
  "organization_id": "org-uuid",
  "dealer_info": {
    "name": "Jordan Motorsports",
    "address": "456 Auto Lane",
    "city": "Portland",
    "state": "OR",
    "zip": "97201",
    "phone": "(503) 555-0123",
    "email": "sales@jordanmotorsports.com",
    "website": "https://www.jordanmotorsport.com",
    "dealer_license": "DL98765",
    "specialties": ["Classic Trucks", "4x4s"],
    "description": "Premier classic truck dealer..."
  },
  "listings_found": 0,
  "listings_queued": 0
}
```

---

## Geographic Matching Logic

The system uses a priority-based matching system to avoid duplicates:

### Priority 1: Dealer License (Strongest)
```sql
WHERE dealer_license = 'DL12345'
```
- **Same license = same business** (even if different name/location)
- License is unique identifier

### Priority 2: Website URL
```sql
WHERE website = 'https://www.111motorcars.com'
```
- **Same website = same entity**
- Handles multi-location dealers

### Priority 3: Name + City + State (Geographic)
```sql
WHERE business_name ILIKE '%111 Motorcars%'
  AND city ILIKE '%Franklin%'
  AND state = 'TN'
```
- **Same name + location = same location**
- Prevents mixing different franchise locations

---

## Logo Processing

Logo URLs are automatically:
1. **Downloaded** from source URL (e.g., `https://images.classic.com/uploads/dealer/...`)
2. **Uploaded** to Supabase Storage at: `organization-logos/{domain}-logo.{ext}`
3. **Cached** in `source_favicons` table
4. **Referenced** in `businesses.logo_url`

**Example transformation:**
```
Source: https://images.classic.com/uploads/dealer/One_Eleven_Motorcars.png
↓
Stored: https://supabase.co/storage/v1/object/public/public/organization-logos/111motorcars-com-logo.png
```

---

## Inventory Extraction Trigger

After creating/finding the organization, inventory extraction is automatically queued:

```typescript
// Automatically triggered for dealers
{
  source_url: dealer_data.inventory_url || `${website}/inventory`,
  source_type: "dealer_website",
  organization_id: organization_id,
  max_results: 200
}

// Automatically triggered for auction houses
{
  source_url: dealer_data.auctions_url || `${website}/auctions`,
  source_type: "auction_house",
  organization_id: organization_id,
  max_results: 200
}
```

This uses `scrape-multi-source` to extract all listings from the dealer's website.

---

## Example: Complete Dealer Profile Extraction Flow

```typescript
// 1. Extract dealer profile from Classic.com
const profileResponse = await supabase.functions.invoke('index-classic-com-dealer', {
  body: {
    profile_url: 'https://www.classic.com/s/111-motorcars-ZnQygen/'
  }
});

// Response:
{
  "success": true,
  "organization_id": "org-uuid",
  "organization_name": "111 Motorcars",
  "logo_url": "https://supabase.co/.../logo.png",
  "action": "created",
  "dealer_data": {
    "name": "111 Motorcars",
    "website": "https://www.111motorcars.com",
    "dealer_license": "DL12345",
    "business_type": "dealer",
    "inventory_url": "https://www.111motorcars.com/inventory"
    // ... full profile data
  }
}

// 2. Inventory extraction is automatically queued
// Uses scrape-multi-source with organization_id
// Extracts all vehicles from inventory_url
// Creates dealer_inventory records linking vehicles to organization
```

---

## Data Flow Summary

```
Classic.com Profile URL
    ↓
index-classic-com-dealer()
    ↓
Extract Profile Data (Firecrawl + Schema)
    ↓
Check Greenlight Signals (name, logo, license)
    ↓
Download & Store Logo
    ↓
Find/Create Organization (geographic matching)
    ↓
Return Organization ID + Profile Data
    ↓
Auto-Queue Inventory Extraction
    ↓
scrape-multi-source extracts vehicle listings
    ↓
Creates vehicles + dealer_inventory records
```

