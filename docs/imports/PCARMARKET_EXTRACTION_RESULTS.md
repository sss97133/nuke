# PCarMarket Extraction Results

## Test Import Completed ✅

**Vehicle ID:** `e92537b2-4ee6-4a84-9c30-ebe7d2afb4f8`  
**Imported:** December 22, 2025  
**Source URL:** https://www.pcarmarket.com/auction/2002-aston-martin-db7-v12-vantage-2

---

## Extracted Data Fields

### ✅ Core Vehicle Data

| Field | Value | Source |
|-------|-------|--------|
| **year** | `2002` | Parsed from title "5k-Mile 2002 Aston Martin..." |
| **make** | `aston martin` | Parsed from title (lowercased) |
| **model** | `db7` | Parsed from title (lowercased) |
| **trim** | `v12 vantage coupe` | Parsed from title (lowercased) |
| **vin** | `SCFAC12322K100123` | Extracted from auction page |
| **mileage** | `5000` | Parsed from "5k-Mile" |
| **description** | `5k-Mile 2002 Aston Martin DB7 V12 Vantage Coupe` | From listing title |

### ✅ Auction Data

| Field | Value | Status |
|-------|-------|--------|
| **sale_price** | `NULL` | Unsold listing |
| **sale_date** | `NULL` | Unsold listing |
| **auction_outcome** | `NULL` | Unsold listing |

### ✅ Origin Tracking

| Field | Value |
|-------|-------|
| **profile_origin** | `pcarmarket_import` |
| **discovery_source** | `pcarmarket` |
| **discovery_url** | `https://www.pcarmarket.com/auction/2002-aston-martin-db7-v12-vantage-2` |
| **listing_url** | `https://www.pcarmarket.com/auction/2002-aston-martin-db7-v12-vantage-2` |

### ✅ Origin Metadata (JSONB)

Complete metadata stored in `origin_metadata` field:

```json
{
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
  "imported_at": "2025-12-22T02:26:09.344Z"
}
```

### ✅ Images

**Count:** 2 images imported  
**Source:** `pcarmarket_listing`  
**Category:** `pcarmarket_listing`

1. **Primary Image:**
   - `https://d2niwqq19lf86s.cloudfront.net/htwritable/media/uploads/7px6oyvwxubawlvd4cr52yopjrzs2ixg-2025-02-21-ZcnWw5gj/Cover Photo Ratio.jpg`

2. **Gallery Image:**
   - `https://d2niwqq19lf86s.cloudfront.net/htwritable/media/uploads/galleries/photos/uploads/galleries/54235-2002-aston-martin-db7-v12-vantage-gta/pics4cars.com-27.jpg`

### ✅ Organization Link

**Organization:** PCarMarket  
**Organization ID:** `f7c80592-6725-448d-9b32-2abf3e011cf8`  
**Relationship Type:** `consigner`  
**Listing Status:** `listed`  
**Auto-tagged:** `true`

---

## Database Records Created

### 1. vehicles Table

```sql
INSERT INTO vehicles (
  id, year, make, model, trim, vin, mileage,
  sale_price, sale_date, auction_outcome,
  description,
  profile_origin, discovery_source, discovery_url, listing_url,
  origin_metadata,
  is_public, status
) VALUES (
  'e92537b2-4ee6-4a84-9c30-ebe7d2afb4f8',
  2002, 'aston martin', 'db7', 'v12 vantage coupe',
  'SCFAC12322K100123', 5000,
  NULL, NULL, NULL,
  '5k-Mile 2002 Aston Martin DB7 V12 Vantage Coupe',
  'pcarmarket_import', 'pcarmarket',
  'https://www.pcarmarket.com/auction/2002-aston-martin-db7-v12-vantage-2',
  'https://www.pcarmarket.com/auction/2002-aston-martin-db7-v12-vantage-2',
  '{"source": "pcarmarket_import", ...}'::jsonb,
  true, 'active'
);
```

### 2. vehicle_images Table

```sql
INSERT INTO vehicle_images (vehicle_id, image_url, category, source, is_primary) VALUES
  ('e92537b2-4ee6-4a84-9c30-ebe7d2afb4f8', 
   'https://d2niwqq19lf86s.cloudfront.net/.../Cover Photo Ratio.jpg',
   'pcarmarket_listing', 'pcarmarket_listing', true),
  
  ('e92537b2-4ee6-4a84-9c30-ebe7d2afb4f8',
   'https://d2niwqq19lf86s.cloudfront.net/.../pics4cars.com-27.jpg',
   'pcarmarket_listing', 'pcarmarket_listing', false);
```

### 3. organization_vehicles Table

```sql
INSERT INTO organization_vehicles (
  organization_id, vehicle_id, relationship_type,
  status, listing_status, listing_url, auto_tagged
) VALUES (
  'f7c80592-6725-448d-9b32-2abf3e011cf8',
  'e92537b2-4ee6-4a84-9c30-ebe7d2afb4f8',
  'consigner',
  'active', 'listed',
  'https://www.pcarmarket.com/auction/2002-aston-martin-db7-v12-vantage-2',
  true
);
```

---

## SQL Query to View Complete Extraction

```sql
SELECT
  -- Basic Info
  v.id,
  v.year,
  v.make,
  v.model,
  v.trim,
  v.vin,
  v.mileage,
  
  -- Auction Data
  v.sale_price,
  v.sale_date,
  v.auction_outcome,
  
  -- Origin Tracking
  v.profile_origin,
  v.discovery_source,
  v.discovery_url,
  
  -- Metadata (JSONB)
  v.origin_metadata,
  
  -- Image Count
  (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v.id) as image_count,
  
  -- Organization Info
  b.business_name as organization_name,
  ov.relationship_type,
  ov.listing_status
  
FROM vehicles v
LEFT JOIN organization_vehicles ov ON v.id = ov.vehicle_id
LEFT JOIN businesses b ON ov.organization_id = b.id
WHERE v.id = 'e92537b2-4ee6-4a84-9c30-ebe7d2afb4f8';
```

---

## Data Mapping Summary

### ✅ All Fields Extracted Successfully

| PCarMarket Source | Database Field | Status | Example Value |
|------------------|----------------|--------|---------------|
| Title: "5k-Mile 2002..." | `year` | ✅ | `2002` |
| Title: "... Aston Martin..." | `make` | ✅ | `"aston martin"` |
| Title: "... DB7..." | `model` | ✅ | `"db7"` |
| Title: "... V12 Vantage..." | `trim` | ✅ | `"v12 vantage coupe"` |
| Title: "5k-Mile" | `mileage` | ✅ | `5000` |
| Auction page VIN | `vin` | ✅ | `"SCFAC12322K100123"` |
| Final/High bid | `sale_price` | ✅ | `NULL` (unsold) |
| Status badge | `auction_outcome` | ✅ | `NULL` (unsold) |
| Auction URL | `discovery_url` | ✅ | Full URL |
| Gallery images | `vehicle_images` | ✅ | 2 images |
| Seller link | `origin_metadata.pcarmarket_seller_username` | ✅ | `"elismotorcars"` |
| Auction slug | `origin_metadata.pcarmarket_auction_slug` | ✅ | Full slug |
| Bid count | `origin_metadata.bid_count` | ✅ | `12` |
| View count | `origin_metadata.view_count` | ✅ | `345` |

---

## Verification

✅ Vehicle record created  
✅ Origin tracking fields populated  
✅ Metadata stored in JSONB  
✅ Images imported  
✅ Organization link created  

**Result:** All extraction fields successfully populated and mapped to database schema!

