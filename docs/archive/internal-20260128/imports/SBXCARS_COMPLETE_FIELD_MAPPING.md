# SBX Cars Complete Database Field Mapping

## Overview

This document shows **all database fields** that will be populated from SBX Cars listings, based on DOM analysis and enhanced extraction requirements.

---

## Core Vehicle Fields (vehicles table)

### Identity Fields
| SBX Cars Source | Database Field | Example Value | Notes |
|----------------|----------------|---------------|-------|
| Title parsing | `year` | `2024` | Extracted from "2024 Mercedes-Benz..." |
| Title parsing | `make` | `Mercedes-Benz` | Extracted from title |
| Title parsing | `model` | `GT 63` | **Split correctly** - "AMG GT 63 4matic+" → model: "GT 63" |
| Title parsing | `amg_nomenclature` (in raw_data) | `AMG` | **High signal field** - stored in raw_data |
| Title parsing | `transmission` | `4matic+` | Extracted separately (not part of model) |
| URL | `discovery_url` | `https://sbxcars.com/listing/555/...` | Full listing URL |
| URL | `platform_url` | Same as discovery_url | Platform URL |
| Title | `bat_listing_title` | Full title text | Complete listing title |

### Pricing & Auction Fields
| SBX Cars Source | Database Field | Example Value | Notes |
|----------------|----------------|---------------|-------|
| Latest bid text | `asking_price` | `300000` | Current bid amount |
| Latest bid text | `sale_price` | Same as asking_price | If auction ended |
| Buyer's premium section | `buyer_premium_percent` (in raw_data) | `5` | Percentage (e.g., "Buyer's premium: 5%") |
| Lot Overview | `lot_number` (in raw_data) | `555` | From URL or page text |
| Location section | `location` (in raw_data) | `Abu Dhabi, United Arab Emirates` | Auction location |
| Auction status | `auction_status` (in raw_data) | `live` | 'live', 'upcoming', 'ended', 'sold' |
| Time remaining | `auction_end_date` (in raw_data) | Calculated date | From "Time left 6 day" |

### Description & Content
| SBX Cars Source | Database Field | Example Value | Notes |
|----------------|----------------|---------------|-------|
| Description section | `notes` | Full description text | Complete vehicle narrative |
| Highlights section | `highlights` (merged) | Array of highlight strings | **Merged with description** |
| Summary section | `summary` (in raw_data) | Summary text | Stored in raw_data |

### Detailed Sections (stored in raw_data)
| Section | Database Location | Structure |
|---------|-------------------|-----------|
| **Vehicle Overview** | `raw_data.overview` | `{ text: string, items: string[], keyValuePairs: {} }` |
| **Specs** | `raw_data.specs` | `{ text: string, items: string[], keyValuePairs: {} }` |
| **Options** | `raw_data.options` | `{ text: string, items: string[] }` |
| **Exterior** | `raw_data.exterior` | `{ text: string, items: string[] }` |
| **Interior** | `raw_data.interior` | `{ text: string, items: string[] }` |
| **Technology** | `raw_data.tech` | `{ text: string, items: string[] }` |
| **Mechanical** | `raw_data.mechanical` | `{ text: string, items: string[] }` |
| **Service** | `raw_data.service` | `{ text: string, items: string[] }` |
| **Condition** | `raw_data.condition` | `{ text: string, items: string[] }` |

### Inspection & Reports
| SBX Cars Source | Database Field | Example Value | Notes |
|----------------|----------------|---------------|-------|
| Inspection section | `inspection_date` (in raw_data) | `2025-12-10` | "performed on December 10, 2025" |
| Inspection section | `inspection_notes` (in raw_data) | "Full body PPF. Front and rear brake life at 100%." | Full inspection text |
| Carfax link | `carfax_url` (in raw_data) | `https://...` | Carfax report URL if present |

### Discovery Metadata
| SBX Cars Source | Database Field | Example Value | Notes |
|----------------|----------------|---------------|-------|
| Static | `discovery_source` | `'sbxcars'` | Source identifier |
| Static | `auction_source` | `'sbxcars'` | Auction platform identifier |
| Current timestamp | `discovered_at` | ISO timestamp | When scraped |

---

## User & Organization Fields

### Seller Organization (businesses table)
| SBX Cars Source | Database Field | Example Value | Notes |
|----------------|----------------|---------------|-------|
| Seller section | `business_name` | `SharjahMotor` | Seller/dealer name |
| Seller link | `website` | `https://...` | Seller website if found |
| External lookup | `metadata` | External data from website | Inventory, team, etc. |
| Static | `business_type` | `'dealership'` | Type of business |
| Source URL | `metadata.discovered_from` | Listing URL | Where seller was found |

**After Creation:**
- External data lookup triggered via `extract-organization-from-seller`
- Website inventory sync (if website found)
- Team members extraction (if available)
- High signal points from external data

### Current Bid User (external_identities table)
| SBX Cars Source | Database Field | Example Value | Notes |
|----------------|----------------|---------------|-------|
| Bid section | `handle` | `username123` | Current bid username |
| Static | `platform` | `'sbxcars'` | Platform identifier |
| Generated | `profile_url` | `https://sbxcars.com/user/username123` | Profile URL |
| Current timestamp | `last_seen_at` | ISO timestamp | When seen |

### Bidder Usernames (external_identities table)
| SBX Cars Source | Database Field | Example Value | Notes |
|----------------|----------------|---------------|-------|
| Bid history | `handle` | Array of usernames | All bidders from live auction |
| Static | `platform` | `'sbxcars'` | Platform identifier |
| Generated | `profile_url` | Profile URLs | For each username |
| Current timestamp | `last_seen_at` | ISO timestamp | When seen |

**Note:** All usernames from live auctions are extracted and stored with origins noted.

### Specialist User (external_identities + organization_vehicles)
| SBX Cars Source | Database Field | Example Value | Notes |
|----------------|----------------|---------------|-------|
| Specialist section | `handle` | Specialist username | If available |
| Specialist section | `name` | Specialist name | Display name |
| Static | `platform` | `'sbxcars'` | Platform identifier |
| Generated | `profile_url` | Profile URL | If username found |

**Collaborator Relationship:**
- Specialist linked to SBX Cars organization as **collaborator**
- Access to SBX org profile
- Relationship stored in `organization_vehicles` or similar table

---

## Import Queue Fields (import_queue table)

| Field | Value Source | Example |
|-------|--------------|---------|
| `source_id` | From `scrape_sources` table | UUID |
| `listing_url` | Full listing URL | `https://sbxcars.com/listing/555/...` |
| `listing_title` | Full title | "2024 Mercedes-Benz AMG GT 63 4matic+..." |
| `listing_price` | Latest bid | `300000` |
| `listing_year` | Parsed year | `2024` |
| `listing_make` | Parsed make | `Mercedes-Benz` |
| `listing_model` | Parsed model | `GT 63` |
| `thumbnail_url` | First gallery image | Image URL |
| `raw_data` | Complete JSON structure | See below |
| `status` | Static | `'pending'` |
| `priority` | Based on auction status | `10` (live) or `5` (others) |

---

## Complete raw_data Structure

```json
{
  "source": "sbxcars",
  "url": "https://sbxcars.com/listing/555/2024-mercedes-amg-gt-63-4matic",
  "title": "2024 Mercedes-Benz AMG GT 63 4matic+ Extensive Carbon Fiber...",
  "year": 2024,
  "make": "Mercedes-Benz",
  "model": "GT 63",
  "amg_nomenclature": "AMG",
  "transmission": "4matic+",
  "price": 300000,
  "current_bid": 300000,
  "current_bid_username": "bidder123",
  "reserve_price": null,
  "auction_end_date": null,
  "auction_status": "live",
  "lot_number": "555",
  "location": "Abu Dhabi, United Arab Emirates",
  "seller_name": "SharjahMotor",
  "seller_website": "https://...",
  "specialist_name": "John Doe",
  "specialist_username": "johndoe",
  "buyer_premium_percent": 5,
  "highlights": [
    "Michelin Pilot Sport S5 tire",
    "Vented front and rear fender",
    "White quilted Nappa leather"
  ],
  "overview": {
    "text": "Full overview text...",
    "items": ["Item 1", "Item 2"],
    "keyValuePairs": { "Key": "Value" }
  },
  "specs": {
    "text": "Specifications...",
    "items": ["Spec 1", "Spec 2"],
    "keyValuePairs": { "Engine": "6.5L V12", "Horsepower": "790 HP" }
  },
  "options": {
    "text": "Options list...",
    "items": ["Option 1", "Option 2"]
  },
  "exterior": {
    "text": "Exterior details...",
    "items": ["Detail 1", "Detail 2"]
  },
  "interior": {
    "text": "Interior details...",
    "items": ["Detail 1", "Detail 2"]
  },
  "tech": {
    "text": "Technology features...",
    "items": ["Feature 1", "Feature 2"]
  },
  "mechanical": {
    "text": "Mechanical details...",
    "items": ["Detail 1", "Detail 2"]
  },
  "service": {
    "text": "Service history...",
    "items": ["Service 1", "Service 2"]
  },
  "condition": {
    "text": "Condition report...",
    "items": ["Note 1", "Note 2"]
  },
  "carfax_url": "https://www.carfax.com/...",
  "inspection_date": "2025-12-10",
  "inspection_notes": "Full body PPF. Front and rear brake life at 100%. Service recommended.",
  "bidder_usernames": ["bidder1", "bidder2", "bidder3"],
  "image_count": 108,
  "scraped_at": "2025-12-24T17:55:33Z"
}
```

---

## Additional Tables Populated

### vehicle_images (via process-import-queue)
- **All 108 gallery images** downloaded and linked
- Primary image set from first gallery image
- Images stored in Supabase Storage
- Linked via `vehicle_id`

### timeline_events (via process-import-queue)
- Discovery event:
  - `event_type`: `'discovery'`
  - `source`: `'sbxcars'`
  - `description`: `'Discovered on SBX Cars auction'`
  - `event_date`: Current date

### origin_metadata (in vehicles table)
```json
{
  "source_id": "<uuid>",
  "queue_id": "<uuid>",
  "imported_at": "2025-12-24T17:55:33Z",
  "image_urls": ["url1", "url2", ...],
  "image_count": 108,
  "sbxcars": {
    "lot_number": "555",
    "location": "Abu Dhabi, United Arab Emirates",
    "auction_status": "live",
    "seller_name": "SharjahMotor",
    "seller_website": "https://...",
    "specialist_name": "John Doe",
    "specialist_username": "johndoe",
    "buyer_premium_percent": 5,
    "current_bid_username": "bidder123",
    "bidder_usernames": ["bidder1", "bidder2"],
    "carfax_url": "https://...",
    "inspection_date": "2025-12-10",
    "inspection_notes": "..."
  }
}
```

### organization_vehicles (via process-import-queue)
- **Seller organization** linked to vehicle:
  - `organization_id`: Seller org UUID
  - `vehicle_id`: Vehicle UUID
  - `relationship_type`: `'seller'`
  - `status`: `'active'`

- **SBX Cars organization** (if exists):
  - `organization_id`: SBX Cars org UUID
  - `vehicle_id`: Vehicle UUID
  - `relationship_type`: `'auction_house'`
  - `status`: `'active'`

- **Specialist collaborator** (if exists):
  - `organization_id`: SBX Cars org UUID
  - `user_id`: Specialist user UUID (from external_identities)
  - `relationship_type`: `'collaborator'`
  - `status`: `'active'`

### dealer_inventory (via process-import-queue)
- If seller is a dealer:
  - `dealer_id`: Seller org UUID
  - `vehicle_id`: Vehicle UUID
  - `status`: `'in_stock'` or `'sold'` (based on auction status)
  - `asking_price`: Current bid
  - `sale_date`: If auction ended

---

## Field Extraction Summary

### ✅ Core Vehicle Identity (Required)
- `year`, `make`, `model` - Parsed from title with special MB handling
- `amg_nomenclature` - High signal field (stored in raw_data)
- `transmission` - Extracted separately (4matic+, etc.)

### ✅ Auction Data
- `lot_number`, `location`, `auction_status`
- `current_bid`, `current_bid_username`
- `buyer_premium_percent`
- `bidder_usernames` (all from live auctions)

### ✅ Detailed Sections (All Extracted)
- `overview`, `specs`, `options`
- `exterior`, `interior`, `tech`
- `mechanical`, `service`, `condition`
- `summary` (if present)

### ✅ Reports & Documentation
- `carfax_url` - Saved if present
- `inspection_date` - Extracted from text
- `inspection_notes` - Full inspection text

### ✅ User & Organization Creation
- **Seller** → Organization created with external data lookup
- **Current bidder** → External identity created
- **All bidders** → External identities created (origins noted)
- **Specialist** → External identity + collaborator link to SBX org

### ✅ Content Merging
- **Highlights** → Merged with description
- **All sections** → Stored in raw_data for full access

---

## Notes

- **AMG Nomenclature**: Treated as high-signal field, stored separately in raw_data
- **Transmission**: Extracted separately (4matic+ is NOT part of model)
- **Model**: Correctly split (e.g., "GT 63" not "AMG GT 63 4matic+")
- **Stories**: Ignored (not extracted)
- **Specialist**: Linked as collaborator to SBX Cars organization
- **Seller**: Organization created with external data lookup (website, inventory, team)
- **Usernames**: All extracted from live auctions with origins noted

