# PCarMarket Data Mapping Example

## Real-World Data Extraction & Mapping

This document shows a real example of how data flows from a PCarMarket listing into our database.

---

## Sample PCarMarket Listing

### Source: HTML Listing Card (from listing page)

```html
<a href="/auction/2002-aston-martin-db7-v12-vantage-2" 
   class="flex items-start gap-4 p-4 rounded-lg border border-gray-200 hover:border-blue-500 hover:bg-blue-50 transition-all duration-200 group">
  <div class="flex-shrink-0">
    <img alt="5k-Mile 2002 Aston Martin DB7 V12 Vantage Coupe" 
         class="w-32 h-24 object-cover rounded" 
         src="https://d2niwqq19lf86s.cloudfront.net/htwritable/media/uploads/7px6oyvwxubawlvd4cr52yopjrzs2ixg-2025-02-21-ZcnWw5gj/Cover Photo Ratio.jpg">
  </div>
  <div class="flex-1 min-w-0">
    <h4 class="text-base font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
      5k-Mile 2002 Aston Martin DB7 V12 Vantage Coupe
    </h4>
    <div class="mt-2 flex items-center gap-6 text-sm">
      <div>
        <span class="text-gray-600">High bid: </span>
        <span class="font-semibold text-gray-900">$25,000</span>
        <span class="ml-2 inline-block px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 rounded">Unsold</span>
      </div>
    </div>
  </div>
</a>
```

---

## Step 1: Initial Scrape - Listing Card Data

### Extracted from Listing Card

```javascript
{
  url: "https://www.pcarmarket.com/auction/2002-aston-martin-db7-v12-vantage-2",
  title: "5k-Mile 2002 Aston Martin DB7 V12 Vantage Coupe",
  imageUrl: "https://d2niwqq19lf86s.cloudfront.net/htwritable/media/uploads/7px6oyvwxubawlvd4cr52yopjrzs2ixg-2025-02-21-ZcnWw5gj/Cover Photo Ratio.jpg",
  bidAmount: 25000,
  status: "unsold",
  slug: "2002-aston-martin-db7-v12-vantage-2"
}
```

---

## Step 2: Detailed Scrape - Full Auction Page

### Extracted from Full Auction Page HTML

```javascript
{
  title: "5k-Mile 2002 Aston Martin DB7 V12 Vantage Coupe",
  
  // Parsed from title
  year: 2002,
  make: "aston martin",
  model: "db7",
  trim: "v12 vantage coupe",
  mileage: 5000,  // Extracted from "5k-Mile"
  
  // From auction page content
  description: "This 2002 Aston Martin DB7 V12 Vantage Coupe is finished in British Racing Green...",
  vin: "SCFAC12322K100123",  // If visible on page
  
  // Images from gallery
  images: [
    "https://d2niwqq19lf86s.cloudfront.net/htwritable/media/uploads/7px6oyvwxubawlvd4cr52yopjrzs2ixg-2025-02-21-ZcnWw5gj/Cover Photo Ratio.jpg",
    "https://d2niwqq19lf86s.cloudfront.net/htwritable/media/uploads/galleries/photos/uploads/galleries/54235-2002-aston-martin-db7-v12-vantage-gta/pics4cars.com-27.jpg",
    "https://d2niwqq19lf86s.cloudfront.net/htwritable/media/uploads/galleries/photos/uploads/galleries/54235-2002-aston-martin-db7-v12-vantage-gta/pics4cars.com-28.jpg",
    // ... more images
  ],
  
  // Auction details
  seller: "Eli's Motorcars",
  sellerUsername: "elismotorcars",  // From /seller/elismotorcars/ or /member/elismotorcars/
  buyer: null,  // Not sold yet
  buyerUsername: null,
  
  salePrice: null,  // No final bid (unsold)
  saleDate: null,
  auctionEndDate: "2025-02-25T23:59:59Z",  // If available
  auctionOutcome: null,  // Not sold
  
  bidCount: 12,  // If visible
  viewCount: 345,  // If visible
  location: "Las Vegas, NV",  // If visible
  
  // URL parsing
  slug: "2002-aston-martin-db7-v12-vantage-2",
  auctionId: "2"
}
```

---

## Step 3: Sold Listing Example

### For a SOLD listing, data looks like:

```javascript
{
  title: "MP: 1,621-Mile 2023 Porsche 718 Cayman GT4 RS Weissach Package",
  year: 2023,
  make: "porsche",
  model: "718 cayman",
  trim: "gt4 rs weissach package",
  mileage: 1621,
  
  // Sold status
  salePrice: 220000,  // Final bid
  saleDate: "2025-01-15T18:30:00Z",
  auctionOutcome: "sold",
  
  // Status indicator in HTML
  status: "sold",  // Green badge "Sold"
  
  // Final bid format in HTML
  // <span class="font-semibold text-green-700">$220,000</span>
  // <span class="ml-2 inline-block px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800 rounded">Sold</span>
  
  buyer: "collector123",
  buyerUsername: "collector123"
}
```

---

## Step 4: Final Database Record - vehicles Table

### Complete vehicles Record

```sql
INSERT INTO vehicles (
  id,
  year,
  make,
  model,
  trim,
  vin,
  mileage,
  sale_price,
  sale_date,
  auction_end_date,
  auction_outcome,
  description,
  
  -- Origin tracking
  profile_origin,
  discovery_source,
  discovery_url,
  listing_url,
  
  -- Metadata (JSONB)
  origin_metadata,
  
  is_public,
  status,
  created_at,
  updated_at
) VALUES (
  '456e7890-e12b-34c5-d678-901234567890',  -- Generated UUID
  2002,
  'aston martin',  -- Lowercase
  'db7',  -- Lowercase
  'v12 vantage coupe',  -- Lowercase
  'SCFAC12322K100123',  -- Uppercase
  5000,
  NULL,  -- No sale price (unsold)
  NULL,  -- No sale date
  '2025-02-25T23:59:59Z',
  NULL,  -- No outcome (unsold)
  'This 2002 Aston Martin DB7 V12 Vantage Coupe is finished in British Racing Green...',
  
  'pcarmarket_import',
  'pcarmarket',
  'https://www.pcarmarket.com/auction/2002-aston-martin-db7-v12-vantage-2',
  'https://www.pcarmarket.com/auction/2002-aston-martin-db7-v12-vantage-2',
  
  -- origin_metadata (JSONB)
  '{
    "source": "pcarmarket_import",
    "pcarmarket_url": "https://www.pcarmarket.com/auction/2002-aston-martin-db7-v12-vantage-2",
    "pcarmarket_listing_title": "5k-Mile 2002 Aston Martin DB7 V12 Vantage Coupe",
    "pcarmarket_seller_username": "elismotorcars",
    "pcarmarket_buyer_username": null,
    "pcarmarket_auction_id": "2",
    "pcarmarket_auction_slug": "2002-aston-martin-db7-v12-vantage-2",
    "bid_count": 12,
    "view_count": 345,
    "sold_status": "unsold",
    "imported_at": "2025-01-21T15:30:00Z"
  }'::jsonb,
  
  true,  -- is_public
  'active',
  NOW(),
  NOW()
);
```

---

## Step 5: Vehicle Images - vehicle_images Table

### Multiple Images Stored

```sql
INSERT INTO vehicle_images (vehicle_id, image_url, category, source, is_primary, filename) VALUES
  ('456e7890-e12b-34c5-d678-901234567890', 
   'https://d2niwqq19lf86s.cloudfront.net/htwritable/media/uploads/7px6oyvwxubawlvd4cr52yopjrzs2ixg-2025-02-21-ZcnWw5gj/Cover Photo Ratio.jpg',
   'pcarmarket_listing', 'pcarmarket_listing', true, 'pcarmarket_0.jpg'),
  
  ('456e7890-e12b-34c5-d678-901234567890',
   'https://d2niwqq19lf86s.cloudfront.net/htwritable/media/uploads/galleries/photos/uploads/galleries/54235-2002-aston-martin-db7-v12-vantage-gta/pics4cars.com-27.jpg',
   'pcarmarket_listing', 'pcarmarket_listing', false, 'pcarmarket_1.jpg'),
  
  -- ... more images
```

---

## Step 6: Organization Link - organization_vehicles Table

### Links Vehicle to PCarMarket Organization

```sql
INSERT INTO organization_vehicles (
  organization_id,
  vehicle_id,
  relationship_type,
  status,
  listing_status,
  sale_price,
  sale_date,
  listing_url,
  auto_tagged
) VALUES (
  'f7c80592-6725-448d-9b32-2abf3e011cf8',  -- PCarMarket org ID
  '456e7890-e12b-34c5-d678-901234567890',  -- Vehicle ID
  'consigner',  -- or 'sold_by' if sold
  'active',
  'listed',  -- or 'sold' if sold
  NULL,  -- No sale price (unsold)
  NULL,  -- No sale date
  'https://www.pcarmarket.com/auction/2002-aston-martin-db7-v12-vantage-2',
  true
);
```

---

## Complete Data Flow Summary

```
┌─────────────────────────────────────────────────────────────────┐
│ PCarMarket HTML Listing Card                                    │
│ - Title: "5k-Mile 2002 Aston Martin DB7 V12 Vantage Coupe"    │
│ - URL: /auction/2002-aston-martin-db7-v12-vantage-2           │
│ - Image: https://d2niwqq19lf86s.cloudfront.net/...            │
│ - Bid: $25,000 (Unsold)                                        │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Initial Extraction (Listing Page)                              │
│ {                                                               │
│   url, title, imageUrl, bidAmount: 25000, status: "unsold"    │
│ }                                                               │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Detailed Scrape (Auction Page)                                 │
│ {                                                               │
│   year: 2002, make: "aston martin", model: "db7",             │
│   mileage: 5000, images: [...], seller: "Eli's Motorcars",    │
│   vin: "SCFAC12322K100123", description: "..."                │
│ }                                                               │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Database: vehicles Table                                        │
│ - year: 2002                                                    │
│ - make: "aston martin" (lowercase)                             │
│ - model: "db7" (lowercase)                                      │
│ - vin: "SCFAC12322K100123" (uppercase)                         │
│ - mileage: 5000                                                 │
│ - profile_origin: "pcarmarket_import"                          │
│ - discovery_url: "https://www.pcarmarket.com/auction/..."     │
│ - origin_metadata: { ... complete JSONB object ... }          │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Database: vehicle_images Table                                  │
│ - Multiple image URLs from auction gallery                     │
│ - First image marked as is_primary: true                       │
│ - Category: "pcarmarket_listing"                               │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Database: organization_vehicles Table                           │
│ - Links vehicle to PCarMarket organization                      │
│ - relationship_type: "consigner" (or "sold_by" if sold)       │
│ - listing_status: "listed" (or "sold" if sold)                │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Mapping Reference

### Field Mappings

| PCarMarket Source | Database Field | Transform | Example |
|------------------|----------------|-----------|---------|
| Title: "5k-Mile 2002 Aston Martin..." | `year` | Parse from title | `2002` |
| Title: "... Aston Martin DB7..." | `make` | Extract + lowercase | `"aston martin"` |
| Title: "... DB7 V12 Vantage..." | `model` | Extract + lowercase | `"db7"` |
| Title: "... V12 Vantage Coupe" | `trim` | Extract remaining | `"v12 vantage coupe"` |
| Title: "5k-Mile" | `mileage` | Parse "5k" → 5000 | `5000` |
| Auction page VIN | `vin` | Uppercase | `"SCFAC12322K100123"` |
| Final bid: "$220,000" | `sale_price` | Parse number | `220000` |
| "Sold" badge | `auction_outcome` | Map status | `"sold"` or `null` |
| Auction URL | `discovery_url` | Store as-is | Full URL |
| Auction URL | `listing_url` | Store as-is | Full URL |
| Gallery images | `vehicle_images` | Array of URLs | Multiple records |
| Seller link | `origin_metadata.pcarmarket_seller_username` | Extract from URL | `"elismotorcars"` |
| Auction slug | `origin_metadata.pcarmarket_auction_slug` | Extract from URL | `"2002-aston-martin-db7-v12-vantage-2"` |

---

## Real JSON Output Example

### After Full Extraction (Before Database Insert)

```json
{
  "year": 2002,
  "make": "aston martin",
  "model": "db7",
  "trim": "v12 vantage coupe",
  "vin": "SCFAC12322K100123",
  "mileage": 5000,
  "salePrice": null,
  "saleDate": null,
  "auctionEndDate": "2025-02-25T23:59:59Z",
  "auctionOutcome": null,
  "title": "5k-Mile 2002 Aston Martin DB7 V12 Vantage Coupe",
  "description": "This 2002 Aston Martin DB7 V12 Vantage Coupe is finished in British Racing Green over a tan leather interior. The car is powered by a 6.0-liter V12 engine paired with a six-speed manual transmission...",
  "seller": "Eli's Motorcars",
  "sellerUsername": "elismotorcars",
  "buyer": null,
  "buyerUsername": null,
  "images": [
    "https://d2niwqq19lf86s.cloudfront.net/htwritable/media/uploads/7px6oyvwxubawlvd4cr52yopjrzs2ixg-2025-02-21-ZcnWw5gj/Cover Photo Ratio.jpg",
    "https://d2niwqq19lf86s.cloudfront.net/htwritable/media/uploads/galleries/photos/uploads/galleries/54235-2002-aston-martin-db7-v12-vantage-gta/pics4cars.com-27.jpg",
    "https://d2niwqq19lf86s.cloudfront.net/htwritable/media/uploads/galleries/photos/uploads/galleries/54235-2002-aston-martin-db7-v12-vantage-gta/pics4cars.com-28.jpg",
    "https://d2niwqq19lf86s.cloudfront.net/htwritable/media/uploads/galleries/photos/uploads/galleries/54235-2002-aston-martin-db7-v12-vantage-gta/pics4cars.com-29.jpg"
  ],
  "url": "https://www.pcarmarket.com/auction/2002-aston-martin-db7-v12-vantage-2",
  "slug": "2002-aston-martin-db7-v12-vantage-2",
  "auctionId": "2",
  "bidCount": 12,
  "viewCount": 345,
  "location": "Las Vegas, NV"
}
```

---

## Comparison: Unsold vs Sold

### Unsold Listing
- `sale_price`: `null`
- `sale_date`: `null`
- `auction_outcome`: `null`
- `organization_vehicles.relationship_type`: `"consigner"`
- `organization_vehicles.listing_status`: `"listed"`
- HTML badge: Gray "Unsold"
- Bid text: "High bid: $X,XXX"

### Sold Listing
- `sale_price`: `220000` (from final bid)
- `sale_date`: `"2025-01-15T18:30:00Z"`
- `auction_outcome`: `"sold"`
- `organization_vehicles.relationship_type`: `"sold_by"`
- `organization_vehicles.listing_status`: `"sold"`
- HTML badge: Green "Sold"
- Bid text: "Final bid: $X,XXX" (green text)

---

This shows exactly what data we extract and how it maps to our database schema!

