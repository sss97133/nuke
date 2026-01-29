# Target Extractions - Dealer & Auction House Indexing

## Overview

This document defines what data we're targeting to extract from dealer/auction house profiles and their inventory.

---

## 1. Dealer/Auction House Profile Extraction

### Target: Classic.com Dealer Profiles

**Source**: `https://www.classic.com/s/{dealer-slug}/`

**Target Fields**:

#### Greenlight Signals (Required for Auto-Creation)
- ✅ **Name** - Business/dealer name
- ✅ **Logo** - Logo image URL (from Classic.com)
- ✅ **Dealer License** - License number

#### Contact Information
- ✅ **Website** - Main website URL
- ✅ **Phone** - Phone number
- ✅ **Email** - Email address

#### Location
- ✅ **Address** - Street address
- ✅ **City** - City name
- ✅ **State** - State abbreviation
- ✅ **Zip Code** - Postal code

#### Business Classification
- ✅ **Business Type** - `'dealer'` or `'auction_house'`
- ✅ **License Type** - `'dealer_license'` or `'auction_license'`

#### Business Details
- ✅ **Description** - Business description
- ✅ **Specialties** - Array of specialties (e.g., `["Classic Trucks", "Muscle Cars"]`)

#### Inventory/Auction URLs
- ✅ **Inventory URL** - URL to inventory page (dealers)
- ✅ **Auctions URL** - URL to auctions page (auction houses)

#### Images
- ✅ **Logo** - Business logo (downloaded & stored)
- ✅ **Favicon** - Website favicon (for small UI areas)
- ✅ **Primary Image** - Property front/building image (basic extraction)

---

## 2. Dealer Inventory Extraction

### Target: Dealer Website Inventory Pages

**Source**: `{dealer_website}/inventory` or `{inventory_url}`

**Target Fields per Vehicle Listing**:

#### Critical Fields (Required)
- ✅ **VIN** - 17-character Vehicle Identification Number
- ✅ **Year** - Model year
- ✅ **Make** - Manufacturer (normalized: "Chevrolet", "GMC")
- ✅ **Model** - Model name (normalized: "C/K", "Blazer", etc.)
- ✅ **Price** - Asking price (USD, number)
- ✅ **Mileage** - Odometer reading (number)

#### Vehicle Details
- ✅ **Series** - Series designation (e.g., "K10", "C20", "K5")
- ✅ **Trim** - Trim level (e.g., "Cheyenne", "Silverado")
- ✅ **Color** - Exterior color
- ✅ **Interior Color** - Interior color
- ✅ **Transmission** - Transmission type
- ✅ **Drivetrain** - Drivetrain type (2WD, 4WD, RWD)
- ✅ **Engine** - Engine description
- ✅ **Engine Size** - Engine displacement
- ✅ **Body Style** - Body type (Pickup, SUV, etc.)
- ✅ **Title Status** - Title condition (Clean, Salvage, etc.)

#### Squarebody-Specific Fields
- ✅ **Bed Length** - "SWB" or "LWB"
- ✅ **Engine Status** - "No Motor" or null
- ✅ **Transmission Status** - "No Transmission" or null
- ✅ **Odometer Status** - "Broken" or null
- ✅ **Modifications** - Array of modifications

#### Listing Information
- ✅ **Title** - Listing title
- ✅ **Description** - Full description text
- ✅ **Images** - Array of image URLs
- ✅ **Location** - Location (city, state)
- ✅ **Listing URL** - Original listing URL

#### Dealer Information (from listing)
- ✅ **Dealer Name** - Dealer name (if in listing)
- ✅ **Dealer Website** - Dealer website (if in listing)
- ✅ **Dealer Phone** - Dealer phone (if in listing)

---

## 3. Auction House Extraction

### Target: Auction House Website Auction Pages

**Source**: `{auction_house_website}/auctions` or `{auctions_url}`

**Target Structure** (Future Enhancement):

#### Auction Events
- ✅ **Event Name** - Auction event name
- ✅ **Event Date** - Auction date
- ✅ **Location** - Auction location
- ✅ **Catalog URL** - Link to auction catalog
- ✅ **Event Description** - Event description

#### Auction Lots (within Events)
- ✅ **Lot Number** - Lot identifier
- ✅ **Vehicle Data** - All vehicle fields (same as dealer inventory)
- ✅ **Starting Bid** - Starting bid amount
- ✅ **Reserve Price** - Reserve price (if applicable)
- ✅ **Auction Date** - When this lot goes to auction
- ✅ **Current Bid** - Current highest bid
- ✅ **Bid Count** - Number of bids
- ✅ **Status** - "scheduled", "active", "completed", "cancelled"

**Current State**: Extracts as generic listings (not yet structured as events/lots)

---

## 4. Extraction Methods & Priority

### For Dealer Profiles (Classic.com)

1. **Firecrawl + Schema Extraction** (Primary)
   - Structured extraction with schema
   - High accuracy
   - Handles JavaScript rendering

2. **HTML Parsing Fallback** (Secondary)
   - DOMParser + Regex patterns
   - Fast, lightweight
   - Used if Firecrawl fails

### For Inventory Extraction

1. **Firecrawl + Schema Extraction** (Primary)
   - Structured extraction for listings
   - Handles pagination
   - Extracts dealer info + listings

2. **LLM Extraction** (Fallback)
   - GPT-4o extraction
   - Handles irregular formats
   - Universal extraction

3. **DOM + Regex** (Last Resort)
   - Fast parsing
   - Source-specific patterns
   - Used for simple sites

---

## 5. Data Quality Targets

### Profile Extraction
- **Greenlight Signal Rate**: 80%+ have name + logo + license
- **Completeness**: 80%+ have 4/5 core fields (name, logo, license, website, phone)
- **Deduplication**: < 1% false duplicates

### Inventory Extraction
- **Critical Fields Present**: 70%+ listings have VIN, year, make, model, price
- **Image Extraction**: 90%+ listings have at least 1 image
- **Squarebody Detection**: Accurate detection of 1967-1991 C/K trucks

### Confidence Scoring
- **High (0.9+)**: All critical fields present, validated
- **Medium (0.7-0.9)**: Most fields present
- **Low (<0.7)**: Missing critical fields, requires re-extraction

---

## 6. Extraction Schema Examples

### Dealer Profile Schema (Firecrawl)

```json
{
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
  "description": "Specializing in classic trucks...",
  "specialties": ["Classic Trucks", "Muscle Cars"],
  "inventory_url": "https://www.111motorcars.com/inventory",
  "business_type": "dealer"
}
```

### Inventory Listing Schema (Firecrawl)

```json
{
  "listings": [
    {
      "title": "1985 Chevrolet K10 Cheyenne 4x4",
      "url": "https://dealer.com/inventory/1985-k10",
      "price": 25000,
      "year": 1985,
      "make": "Chevrolet",
      "model": "K10",
      "series": "K10",
      "trim": "Cheyenne",
      "mileage": 85000,
      "vin": "1GCHK33K3FE123456",
      "color": "Red",
      "transmission": "Automatic",
      "drivetrain": "4WD",
      "location": "Nashville, TN",
      "thumbnail_url": "https://dealer.com/images/thumb1.jpg",
      "description_snippet": "1985 Chevy K10...",
      "is_squarebody": true
    }
  ]
}
```

---

## 7. Missing Data Handling

### Re-extraction Triggers
- Confidence < 0.8
- Missing critical fields (VIN, year, make, model, price)
- Low data completeness

### Re-extraction Process
1. Identify missing fields
2. Re-scrape with targeted extraction
3. Merge results (prioritize new data)
4. Update confidence score

---

## 8. Extraction Targets Summary

| Category | Target | Status |
|----------|--------|--------|
| **Profile Data** | Name, logo, license, contact, location | ✅ Ready |
| **Business Classification** | Dealer vs Auction House | ✅ Ready |
| **Inventory Listings** | Vehicle data, pricing, images | ✅ Ready |
| **Auction Events** | Event structure, dates, locations | ⚠️ Needs enhancement |
| **Auction Lots** | Lot numbers, bids, reserve prices | ⚠️ Needs enhancement |
| **Images** | Logo, favicon, primary image | ✅ Ready |
| **Squarebody Detection** | 1967-1991 C/K trucks | ✅ Ready |

---

## 9. Success Criteria

### Profile Extraction
- ✅ Extract all greenlight signals
- ✅ Download and store logo
- ✅ Extract favicon and primary image
- ✅ Create organization with geographic matching

### Inventory Extraction
- ✅ Extract all vehicle listings
- ✅ Identify squarebodies
- ✅ Extract VINs when present
- ✅ Link vehicles to organization via `dealer_inventory`

### Data Quality
- ✅ Confidence scores for all extractions
- ✅ Missing field identification
- ✅ Re-extraction for low confidence data
- ✅ Validation and normalization

