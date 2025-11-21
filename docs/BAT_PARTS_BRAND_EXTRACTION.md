# BAT Parts/Brand Extraction System

## Overview

This system extracts parts, brands, and modifications from Bring a Trailer listing descriptions and links them to image tags, providing provenance and legitimizing part identifications.

## Database Schema

### `bat_listing_parts` Table
Stores extracted parts/brands from BAT listings:
- `vehicle_id` - Links to vehicle
- `bat_listing_url` - Source BAT listing URL
- `part_name` - Extracted part name (e.g., "shock absorber")
- `brand_name` - Brand if mentioned (e.g., "Bilstein")
- `part_number` - Part number if mentioned
- `description` - Brief description
- `context_text` - Exact quote from listing mentioning this part
- `confidence_score` - AI confidence (0-100)

### `image_tag_bat_references` Table
Links image tags to BAT listing parts:
- `image_tag_id` - Links to image tag
- `bat_listing_part_id` - Links to extracted BAT part
- `match_confidence` - How well tag matches BAT part

## Edge Function: `extract-bat-parts-brands`

**Endpoint:** `/functions/v1/extract-bat-parts-brands`

**Request:**
```json
{
  "vehicleId": "uuid",
  "batListingUrl": "https://bringatrailer.com/listing/...",
  "listingDescription": "optional - if not provided, will fetch from URL",
  "linkToImageTags": true
}
```

**Response:**
```json
{
  "success": true,
  "extracted": [...],
  "count": 5,
  "message": "Extracted 5 parts/brands from BAT listing"
}
```

## Frontend Components

### `BATListingExtractor`
Located in vehicle profile page. Allows users to:
- Input BAT listing URL (auto-fills if vehicle has `bat_auction_url`)
- Extract parts/brands from listing
- See already extracted parts
- Automatically links to matching image tags

### `ImageLightbox` Metadata Panel
Shows BAT references when viewing images:
- Displays parts/brands extracted from BAT listing
- Shows context text (exact quote from listing)
- Links to original BAT listing
- Shows confidence scores

## Usage

1. **On Vehicle Profile:**
   - Navigate to vehicle profile
   - Find "Extract Parts/Brands from BAT Listing" section
   - URL is auto-filled if vehicle has `bat_auction_url`
   - Click "Extract" to process listing

2. **View Results:**
   - Open any image in lightbox
   - Click "INFO" button
   - Scroll to "BAT Listing References" section
   - See parts/brands with links to BAT listing

## Current Status

**Vehicle ID:** `5f6cc95c-9c1e-4a45-8371-40312c253abb`
- **BAT URL Found:** `https://bringatrailer.com/listing/1978-chevrolet-k20-pickup-9/`
- **Status:** Ready to extract - URL is stored in `bat_auction_url` field

## Next Steps

1. Run extraction on the BAT listing URL
2. System will extract parts like "shock absorber" with brand names
3. Automatically link to matching image tags
4. Display in image metadata panel with provenance

## Schema Concerns

The system uses:
- `bat_listing_parts` - Stores extracted data (scales well)
- `image_tag_bat_references` - Links tags to BAT parts (many-to-many)
- `vehicle_listing_archives` - Full HTML snapshots (optional, for deep analysis)

All tables have proper indexes and RLS policies for scale.

