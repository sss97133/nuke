# KSL Extraction Quality Audit

## Executive Summary

**Current extraction quality: 35% of available data captured**

The KSL scraper is extracting basic data (year, make, model, price, mileage) but missing critical structured fields that ARE available in the source.

---

## Data Quality Metrics (19 vehicles)

| Field | Extracted | Available | Rate | Status |
|-------|-----------|-----------|------|--------|
| Year | 19/19 | 19/19 | 100% | OK |
| Make | 19/19 | 19/19 | 100% | OK |
| Model | 19/19 | 19/19 | 100% | OK |
| Price | 19/19 | 19/19 | 100% | OK |
| Mileage | 19/19 | 19/19 | 100% | OK |
| Description | 18/19 | 19/19 | 95% | GOOD |
| **VIN** | 2/19 | ~15/19 | 11% | **CRITICAL** |
| **Trim** | 0/19 | ~10/19 | 0% | **CRITICAL** |
| **Body Style** | 1/19 | 19/19 | 5% | **CRITICAL** |
| **Exterior Color** | 0/19 | ~5/19 | 0% | **POOR** |
| **Interior Color** | 0/19 | ~5/19 | 0% | **POOR** |
| **Engine** | 0/19 | ~12/19 | 0% | **POOR** |
| **Transmission** | 0/19 | ~12/19 | 0% | **POOR** |
| **Title Type** | 0/19 | ~15/19 | 0% | **POOR** |
| **Source URL** | 0/19 | 19/19 | 0% | **CRITICAL** |
| **Location** | 0/19 | 19/19 | 0% | **POOR** |
| **Listing Number** | 0/19 | 19/19 | 0% | **POOR** |
| **Timeline Events** | 0/19 | 19/19 | 0% | **CRITICAL** |
| **Images** | 3/19 | 19/19 | 16% | **CRITICAL** |

---

## Root Cause Analysis

### Issue 1: VIN Extraction (11% success)
**Problem**: VINs are NOT in the body text - they're in CARFAX links
**Source**: `[Get a CARFAX Report](http://www.carfax.com/cfm/check_order.cfm?partner=KSN_2&VIN=CCY333S128408)`
**Current code**: Looking for 17-char VIN in body text
**Fix**: Extract VIN from CARFAX URL parameter

### Issue 2: Specifications Not Extracted (0%)
**Problem**: KSL has a "Specifications" tab with structured data but it's rendered via JavaScript
**Source data available**:
```
Year 1973
Mileage 58,035
Engine Not Specified
Title Clean Title
Make Chevrolet
Model C30
Trim [blank]
Body Truck
Mileage 58035
Title Type Clean Title
```
**Current code**: No extraction logic for specs section
**Fix**: Parse markdown which contains this data in a parseable format

### Issue 3: Source URL Not Stored (0%)
**Problem**: `discovery_source_url` is being passed to scraper but not saved to DB
**Current code**: `scrapeKSL()` sets `data.listing_url = url` but import script doesn't use it
**Fix**: Map `listing_url` to `discovery_source_url` in import script

### Issue 4: Description Garbage (SVG code in 2/19)
**Problem**: Some descriptions contain SVG path data: `37 l 5.84,5.84 c .23,.23...`
**Root cause**: Regex fallback in `scrapeKSL()` capturing wrong content
**Fix**: Better markdown parsing, stricter validation

### Issue 5: Images Only for 3/19 Vehicles
**Problem**: `backfill-ksl-images.js` ran but only processed 3 vehicles
**Root cause**: Script may have errored or been interrupted
**Fix**: Re-run backfill with proper error handling

### Issue 6: Timeline Events Not Created (0%)
**Problem**: `import-ksl-single.js` was supposed to create timeline events but isn't
**Current code**: Has timeline event creation but it's not working
**Fix**: Debug and fix timeline event creation

### Issue 7: Location Not Extracted (0%)
**Problem**: Location is in markdown: `Ogden, UT` or `Midvale, UT`
**Current code**: Only extracts `seller_city` from "City: X" pattern
**Fix**: Parse location from markdown header section

---

## What's Available in KSL Markdown (FULL DATA)

From the Firecrawl markdown output, here's what we CAN extract:

```markdown
1984 Chevrolet Corvette Base    # Title with Year Make Model Trim

Midvale, UT                      # Location

5 Days                           # Listing age

1014                             # Page views

25                               # Favorites count

$15,000                          # Price

$267.25/mo est                   # Monthly payment estimate

Mileage: 17,517                  # Mileage

## Fiuza Motors                  # Dealer name (if dealer)
8160 S State Street              # Dealer address
Midvale, UT84047
Seller Type: Dealership
License # 7142                   # Dealer license

## Description
[actual description text]

Listing Number10224357           # Listing ID
Expiration DateDec 26, 2025      # Expiration

## Vehicle History (CARFAX)
VIN embedded in CARFAX link URL
Accident reported
3 Service history records
16 Detailed records available
17,517 Last reported odometer reading
```

---

## Proposed High-Quality Extraction

### New `scrapeKSL()` Implementation

```typescript
function scrapeKSL(doc: any, url: string, markdown: string = ''): any {
  const data: any = {
    source: 'KSL Cars',
    listing_url: url,
    discovery_source_url: url  // CRITICAL: Store the source URL
  }

  // 1. EXTRACT FROM MARKDOWN (primary source - cleaner than HTML)
  if (markdown) {
    // Title with Year Make Model Trim
    const titleMatch = markdown.match(/^(\d{4})\s+([A-Za-z]+)\s+(.+?)$/m)
    if (titleMatch) {
      data.year = parseInt(titleMatch[1])
      data.make = titleMatch[2]
      // Model might include trim: "Corvette Base" -> model="Corvette", trim="Base"
      const modelParts = titleMatch[3].trim().split(/\s+/)
      if (modelParts.length > 1) {
        data.model = modelParts.slice(0, -1).join(' ')
        data.trim = modelParts[modelParts.length - 1]
      } else {
        data.model = titleMatch[3].trim()
      }
    }

    // Location (city, state)
    const locationMatch = markdown.match(/^([A-Za-z\s]+,\s*[A-Z]{2})$/m)
    if (locationMatch) {
      data.location = locationMatch[1]
    }

    // Listing age -> listed_date
    const ageMatch = markdown.match(/^(\d+)\s+(Days?|Hours?|Minutes?)$/im)
    if (ageMatch) {
      const value = parseInt(ageMatch[1])
      const unit = ageMatch[2].toLowerCase()
      let hoursAgo = 0
      if (unit.startsWith('day')) hoursAgo = value * 24
      else if (unit.startsWith('hour')) hoursAgo = value
      else if (unit.startsWith('minute')) hoursAgo = value / 60
      data.listed_date = new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString()
    }

    // Price
    const priceMatch = markdown.match(/\$(\d{1,3}(?:,\d{3})*)\s*$/m)
    if (priceMatch) {
      data.asking_price = parseInt(priceMatch[1].replace(/,/g, ''))
    }

    // Mileage
    const mileageMatch = markdown.match(/Mileage:\s*([\d,]+)/i)
    if (mileageMatch) {
      data.mileage = parseInt(mileageMatch[1].replace(/,/g, ''))
    }

    // Description
    const descMatch = markdown.match(/## Description\s*\n\n(.+?)(?=\n\n##|\n\n\[|$)/is)
    if (descMatch) {
      data.description = descMatch[1].trim()
    }

    // Dealer info
    const dealerMatch = markdown.match(/Seller Type:\s*Dealership[\s\S]*?License\s*#\s*(\d+)/i)
    if (dealerMatch) {
      data.is_dealer = true
      data.dealer_license = dealerMatch[1]
      
      // Dealer name (## heading before "Seller Type: Dealership")
      const dealerNameMatch = markdown.match(/##\s+([A-Za-z0-9\s&]+)\s*\n[^#]+Seller Type:\s*Dealership/i)
      if (dealerNameMatch) {
        data.dealer_name = dealerNameMatch[1].trim()
      }
      
      // Dealer address
      const addressMatch = markdown.match(/(\d+\s+[A-Za-z\s]+\s+\w+)\s*\n\s*([A-Za-z]+,\s*[A-Z]{2}\s*\d{5})/i)
      if (addressMatch) {
        data.dealer_address = `${addressMatch[1]}, ${addressMatch[2]}`
      }
    } else {
      data.is_dealer = false
      data.seller_type = 'private'
    }

    // Listing number
    const listingMatch = markdown.match(/Listing Number\s*(\d+)/i)
    if (listingMatch) {
      data.ksl_listing_id = listingMatch[1]
    }

    // Page views & favorites
    const viewsMatch = markdown.match(/Page Views\s*([\d,]+)/i)
    if (viewsMatch) {
      data.page_views = parseInt(viewsMatch[1].replace(/,/g, ''))
    }

    const favoritesMatch = markdown.match(/Favorited\s*(\d+)/i)
    if (favoritesMatch) {
      data.favorites_count = parseInt(favoritesMatch[1])
    }
  }

  // 2. EXTRACT VIN FROM CARFAX LINK (critical!)
  const html = doc.documentElement?.outerHTML || doc.body?.innerHTML || markdown || ''
  const vinMatch = html.match(/VIN=([A-HJ-NPR-Z0-9]{17})/i) || 
                   html.match(/VIN=([A-HJ-NPR-Z0-9]{8,13})/i)  // Legacy shorter VINs
  if (vinMatch) {
    data.vin = vinMatch[1].toUpperCase()
  }

  // 3. EXTRACT IMAGES (all of them)
  const images: string[] = []
  const imagePattern = /image\.ksldigital\.com\/([a-f0-9\-]+)\.jpg/gi
  let match
  while ((match = imagePattern.exec(html)) !== null) {
    const fullUrl = `https://image.ksldigital.com/${match[1]}.jpg`
    if (!images.includes(fullUrl)) {
      images.push(fullUrl)
    }
  }
  data.images = images  // NO LIMIT

  // 4. EXTRACT CARFAX METADATA (if available)
  const accidentMatch = html.match(/Accident reported/i)
  if (accidentMatch) {
    data.accident_history = true
  }

  const serviceMatch = html.match(/(\d+)\s+Service history records/i)
  if (serviceMatch) {
    data.service_records_count = parseInt(serviceMatch[1])
  }

  return data
}
```

---

## Import Script Fixes Needed

### `import-ksl-single.js` must:

1. **Store `discovery_source_url`**:
```javascript
discovery_source_url: url,  // The KSL listing URL
```

2. **Create timeline event for listing date**:
```javascript
if (scrapedData.listed_date) {
  await supabase.from('timeline_events').insert({
    vehicle_id: newVehicle.id,
    event_type: 'listing',
    event_date: scrapedData.listed_date.split('T')[0],
    title: 'Listed for Sale on KSL',
    description: `Listed at $${scrapedData.asking_price?.toLocaleString() || 'N/A'}`,
    source_type: 'ksl_import',
    source_url: url
  })
}
```

3. **Map all extracted fields to DB columns**:
```javascript
const vehicleData = {
  year: scrapedData.year,
  make: scrapedData.make,
  model: scrapedData.model,
  trim: scrapedData.trim,
  vin: scrapedData.vin,
  mileage: scrapedData.mileage,
  asking_price: scrapedData.asking_price,
  description: scrapedData.description,
  location: scrapedData.location,
  body_style: scrapedData.body_type || 'Truck',  // Default for trucks
  discovery_source: 'ksl_automated_import',
  discovery_source_url: url,
  status: 'active',
  is_public: true
}
```

---

## Image Backfill Issues

The current `backfill-ksl-images.js` only processed 3/19 vehicles. Issues:

1. Script may have errored silently
2. Some vehicles have 0 images in `data.images` from scraper
3. Need to re-scrape vehicles to get image URLs

**Fix**: Create a script that:
1. Re-scrapes each KSL vehicle URL
2. Extracts ALL image URLs
3. Downloads and uploads to Supabase storage
4. Links to vehicle_images table

---

## Action Plan

### Phase 1: Fix Scraper (1 hour)
- [ ] Update `scrapeKSL()` with markdown-first parsing
- [ ] Add VIN extraction from CARFAX link
- [ ] Add proper location extraction
- [ ] Add listing number extraction
- [ ] Deploy updated edge function

### Phase 2: Fix Import Script (30 min)
- [ ] Map all fields to DB columns
- [ ] Store `discovery_source_url`
- [ ] Create timeline events
- [ ] Deploy and test

### Phase 3: Backfill Existing Data (1 hour)
- [ ] Re-scrape all 19 KSL vehicles
- [ ] Update with new extracted data
- [ ] Re-run image backfill
- [ ] Create missing timeline events

### Phase 4: Verify Quality (30 min)
- [ ] Run audit script again
- [ ] Verify all metrics improved
- [ ] Check frontend display

---

## Expected Results After Fixes

| Field | Before | After |
|-------|--------|-------|
| VIN | 11% | 80%+ |
| Trim | 0% | 50%+ |
| Body Style | 5% | 100% |
| Location | 0% | 100% |
| Source URL | 0% | 100% |
| Timeline Events | 0% | 100% |
| Images | 16% | 100% |

**Overall extraction quality: 35% → 85%+**

