# SBX Cars DOM Mapping & Database Field Mapping

## Site Structure Analysis

Based on DOM analysis of `sbxcars.com/listing/555/2024-mercedes-amg-gt-63-4matic`:

### URL Pattern
- **Format**: `https://sbxcars.com/listing/{lot_number}/{slug}`
- **Example**: `https://sbxcars.com/listing/555/2024-mercedes-amg-gt-63-4matic`
- **Lot Number**: Extracted from URL path segment

### Page Sections Identified

1. **Header/Banner Section**
   - Seller/Dealer name (e.g., "SharjahMotor")
   - Watch/Comment buttons
   - "Place a Bid" button

2. **Image Gallery**
   - 108 images found in gallery
   - Image groups numbered 1/108, 2/108, etc.
   - "View all media" button

3. **Lot Overview Section**
   - Lot#: 555
   - Location: "Abu Dhabi, United Arab Emirates"

4. **Auction Details**
   - Time remaining (e.g., "Time left 6 day")
   - Latest bid (e.g., "Latest bid 300,000 AED")
   - Bid history section
   - "View all bids" link

5. **Vehicle Description**
   - Full narrative description
   - Features list (e.g., "Michelin Pilot Sport S5 tire", "Vented front and rear fender")
   - Interior details (e.g., "White quilted Nappa leather")

6. **Inspection Report**
   - Third-party inspection date
   - Inspection notes
   - Service recommendations

7. **Buyer Information**
   - Buyer's Premium notice
   - Sale tax information

---

## Database Field Mapping

### Core Vehicle Fields (vehicles table)

| SBX Cars Source | Database Field | Extraction Method | Notes |
|----------------|----------------|-------------------|-------|
| **Title/Heading** | `make`, `model`, `year` | Parse from H1/title: "2024 Mercedes-Benz AMG GT 63 4matic+" | Extract year (4 digits), make (first word after year), model (rest) |
| **Title** | `bat_listing_title` | Full title text | Store complete listing title |
| **URL** | `discovery_url` | Full listing URL | `https://sbxcars.com/listing/555/...` |
| **URL** | `platform_url` | Full listing URL | Same as discovery_url |
| **URL Path** | `lot_number` (in raw_data) | Extract from URL: `/listing/{lot}/` | Lot number from URL |
| **Lot Overview** | `lot_number` (in raw_data) | Text: "Lot#: 555" | Secondary extraction from page |
| **Location** | `location` (in raw_data) | Text: "Location: Abu Dhabi, United Arab Emirates" | Auction location |
| **Latest Bid** | `asking_price` | Parse from "Latest bid 300,000 AED" | Convert currency, extract number |
| **Latest Bid** | `current_bid` (in raw_data) | Same as asking_price | Store in raw_data for auction context |
| **Time Remaining** | `auction_end_date` (in raw_data) | Calculate from "Time left 6 day" | Estimate end date |
| **Auction Status** | `auction_status` (in raw_data) | Determine from URL/page: "live", "upcoming", "ended" | Based on URL path or page state |
| **Description** | `notes` or `description` (in raw_data) | Full description text | Complete vehicle narrative |
| **Features List** | `features` (in raw_data) | Extract from features section | Array of feature strings |
| **Inspection Date** | `inspection_date` (in raw_data) | "A third-party inspection was performed on December 10, 2025" | Parse date from text |
| **Inspection Notes** | `inspection_notes` (in raw_data) | Inspection report text | Full inspection details |
| **Service Recommendations** | `service_recommendations` (in raw_data) | "Service recommended" text | Service notes |
| **Images** | `vehicle_images` table | Extract all gallery images (108 found) | Link via vehicle_id |
| **Images** | `thumbnail_url` (in import_queue) | First image from gallery | Primary image URL |
| **Bid History** | `bid_count` (in raw_data) | Count from "View all bids" or bid list | Number of bids |
| **Bid History** | `bid_history` (in raw_data) | Full bid history data | Array of bid objects |
| **Seller/Dealer** | `seller_name` (in raw_data) | "SharjahMotor" or similar | Dealer/seller identifier |
| **Source** | `discovery_source` | Static: `'sbxcars'` | Source identifier |
| **Source** | `auction_source` | Static: `'sbxcars'` | Auction platform identifier |

### Provenance Fields (with confidence scores)

| Field | Source | Confidence | Notes |
|-------|--------|------------|-------|
| `year` | Title parsing | 90 | High confidence from title |
| `make` | Title parsing | 90 | High confidence from title |
| `model` | Title parsing | 85 | May include trim/variant |
| `asking_price` | Latest bid text | 95 | Direct from auction data |
| `mileage` | Description parsing | 60 | May be in description text |
| `color` | Description parsing | 70 | May mention "finished in white" |
| `transmission` | Description parsing | 50 | May mention in features |
| `engine_size` | Description parsing | 50 | May mention "6.5L V12" |
| `horsepower` | Description parsing | 50 | May mention "790 HP" |

### Raw Data Structure (stored in `raw_data` JSONB)

```json
{
  "source": "sbxcars",
  "lot_number": "555",
  "location": "Abu Dhabi, United Arab Emirates",
  "current_bid": 300000,
  "currency": "AED",
  "auction_status": "live",
  "time_remaining": "6 day",
  "bid_count": null, // or actual count if available
  "bid_history": [], // if available
  "seller_name": "SharjahMotor",
  "features": [
    "Michelin Pilot Sport S5 tire measuring 295/30 front and 305/30 rear",
    "Vented front and rear fender",
    "White quilted Nappa leather with color-coordinated and contrast-stitched two-tone door panels"
  ],
  "inspection_date": "2025-12-10",
  "inspection_notes": "Full body PPF. Front and rear brake life at 100%. Service recommended.",
  "service_recommendations": ["Service recommended"],
  "image_count": 108,
  "description_full": "...",
  "buyer_premium_note": "The Buyer's Premium will be added to the final sale price...",
  "scraped_at": "2025-12-24T17:55:33Z"
}
```

### Import Queue Fields

| Field | Value Source |
|-------|--------------|
| `source_id` | From `scrape_sources` table (sbxcars.com) |
| `listing_url` | Full listing URL |
| `listing_title` | Full title text |
| `listing_price` | Latest bid amount |
| `listing_year` | Extracted from title |
| `listing_make` | Extracted from title |
| `listing_model` | Extracted from title |
| `thumbnail_url` | First gallery image |
| `raw_data` | Complete JSON structure above |
| `status` | `'pending'` |
| `priority` | `10` for live auctions, `5` for others |

### Additional Tables

#### `vehicle_images` (via process-import-queue)
- All 108 images will be downloaded and linked
- Primary image set from first gallery image
- Images stored in Supabase Storage

#### `timeline_events` (via process-import-queue)
- Discovery event created with:
  - `event_type`: `'discovery'`
  - `source`: `'sbxcars'`
  - `description`: `'Discovered on SBX Cars auction'`
  - `event_date`: Current date

#### `origin_metadata` (in vehicles table)
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
    "seller_name": "SharjahMotor"
  }
}
```

---

## DOM Selectors (for scraper implementation)

### Title/Heading
- Selector: `h1` or `[class*="title"]`
- Example: "2024 Mercedes-Benz AMG GT 63 4matic+ Extensive Carbon Fiber, Premium MBUX Technology"

### Lot Number
- Selector: `[class*="lot"]` or text matching "Lot#: {number}"
- Pattern: `/Lot#:\s*(\d+)/i`

### Location
- Selector: `[class*="location"]` or text matching "Location: {location}"
- Pattern: `/Location:\s*(.+)/i`

### Latest Bid
- Selector: `[class*="bid"]` or text matching "Latest bid {amount} {currency}"
- Pattern: `/Latest\s+bid\s+([\d,]+)\s*([A-Z]{3})?/i`

### Time Remaining
- Selector: `[class*="time"]` or text matching "Time left {duration}"
- Pattern: `/Time\s+left\s+(.+)/i`

### Description
- Selector: `[class*="description"]` or main content area
- Full narrative text

### Features
- Selector: `[class*="feature"]` or list items in features section
- Array of feature strings

### Images
- Selector: Gallery images - `[class*="gallery"] img` or `[data-image]`
- Extract all `src`, `data-src`, `data-image` attributes

### Inspection Report
- Selector: `[class*="inspection"]` or text containing "inspection was performed"
- Parse date and notes

### Bid History
- Selector: `[class*="bid-history"]` or "View all bids" link
- Extract bid count if available

### Seller/Dealer
- Selector: Header/banner area with seller name
- Example: "SharjahMotor"

---

## Extraction Priority

1. **High Priority** (Required for vehicle creation):
   - `year`, `make`, `model` (from title)
   - `listing_url` (for deduplication)
   - `images` (at least one for thumbnail)

2. **Medium Priority** (Enhance vehicle profile):
   - `asking_price` (latest bid)
   - `description`
   - `location`
   - `lot_number`

3. **Low Priority** (Nice to have):
   - `features` array
   - `inspection_notes`
   - `bid_history`
   - `seller_name`

---

## Currency Handling

SBX Cars uses multiple currencies:
- AED (UAE Dirham)
- USD (US Dollar)
- EUR (Euro)

**Extraction**: Parse currency from bid text and store in `raw_data.currency`
**Conversion**: Store original amount; conversion can be done later if needed

---

## Auction Status Detection

1. **From URL**:
   - `/auctions` → `'live'`
   - `/upcoming` → `'upcoming'`
   - `/results` or `/ended` → `'ended'`

2. **From Page Content**:
   - "Time left" present → `'live'`
   - "Upcoming" in text → `'upcoming'`
   - "Sold" or "Ended" → `'ended'`

---

## Notes

- **Image Count**: Found 108 images in gallery - all will be extracted
- **Dynamic Content**: Site uses JavaScript rendering - Firecrawl recommended
- **Rate Limiting**: 1 second delay between listings recommended
- **Deduplication**: Use `listing_url` as unique identifier
- **Lot Number**: Primary identifier for SBX Cars listings (stored in `raw_data`)

