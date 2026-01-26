# Extractor Architecture

## The Problem

We were duplicating logic across extractors:
- VIN deduplication
- Collection/organization creation
- Auction event creation
- Image handling
- Owner parsing

Each extractor had its own implementation with subtle differences.

## The Solution

**Shared utilities + Template pattern**

```
scripts/
├── lib/
│   └── extraction-utils.js    # Shared functions ALL extractors use
├── templates/
│   └── extractor-template.js  # Copy this for new sources
└── [source]-extract.js        # Source-specific extractors
```

---

## For Future Agents: Creating a New Extractor

### Step 1: Copy the Template

```bash
cp scripts/templates/extractor-template.js scripts/[newsource]-extract.js
```

### Step 2: Modify These Parts Only

1. **`SOURCE_NAME`** - Set to your source identifier (`'mecum'`, `'bat'`, etc.)

2. **`extractFromPage()`** - Write source-specific scraping logic

3. **Return standardized data object** - See schema below

### Step 3: The Shared Utils Handle Everything Else

You don't need to write code for:
- ✅ VIN deduplication
- ✅ Collection creation
- ✅ Auction event creation
- ✅ Image insertion
- ✅ Vehicle merging
- ✅ Price tracking

Just call `upsertVehicle()` with your extracted data.

---

## Standardized Data Schema

Every extractor should return this structure from `extractFromPage()`:

```javascript
{
  // Vehicle identity
  vin: string | null,
  title: string | null,
  year: number | null,
  make: string | null,
  model: string | null,

  // Specs
  transmission: string | null,
  exterior_color: string | null,
  interior_color: string | null,
  mileage: number | null,
  engine: string | null,

  // Content
  description: string | null,
  highlights: string[],
  images: string[],

  // Sale result
  sale_result: 'sold' | 'not_sold' | 'bid_to' | 'unknown',
  sale_price: number | null,      // Hammer price if sold
  high_bid: number | null,        // Highest bid if not sold

  // Estimates
  low_estimate: number | null,
  high_estimate: number | null,

  // Auction event
  auction_date: string | null,    // YYYY-MM-DD
  lot_number: string | null,
  auction_location: string | null,
  source_listing_id: string | null,

  // Collection/Owner
  collection_name: string | null,
  collection_slug: string | null,

  // Provenance (parsed from description)
  ownership_history: Array<{name, location}>,

  // Raw data for debugging
  raw_data: object
}
```

---

## Shared Utility Functions

### `loadVinCache()`
Call at startup to load existing VINs for deduplication.

### `upsertVehicle({ vehicleId, sourceUrl, source, data })`
Main function - handles everything:
- VIN deduplication
- Collection creation & linking
- Vehicle update
- Image insertion
- Auction event creation

Returns: `{ vehicleId, isNew, collectionId, event }`

### `getOrCreateCollection(name, slug, sourceUrl)`
Creates collection organization if doesn't exist.

### `upsertAuctionEvent({ vehicleId, source, sourceUrl, ... })`
Creates auction event for timeline tracking.

### `insertVehicleImages(vehicleId, images, source)`
Inserts images with deduplication.

### `parseOwnershipHistory(text)`
Extracts owner mentions from description text.

### `parseRestorationHistory(text)`
Extracts restoration/service mentions.

---

## Data Flow

```
                    ┌─────────────────────────────┐
                    │     extractFromPage()       │
                    │   (source-specific logic)   │
                    └──────────────┬──────────────┘
                                   │
                                   ▼
                    ┌─────────────────────────────┐
                    │      upsertVehicle()        │
                    │    (shared utility)         │
                    └──────────────┬──────────────┘
                                   │
          ┌────────────────────────┼────────────────────────┐
          │                        │                        │
          ▼                        ▼                        ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ VIN Dedup Check │    │ Collection      │    │ Auction Event   │
│                 │    │ Creation        │    │ Creation        │
└────────┬────────┘    └────────┬────────┘    └────────┬────────┘
         │                      │                      │
         ▼                      ▼                      ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ vehicles table  │    │ organizations   │    │ auction_events  │
│ (update/merge)  │    │ (type:collection│    │ (timeline)      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

---

## Organization Types

When extracting, collections become organizations:

| Type | When Created | Example |
|------|--------------|---------|
| `collection` | From collectionsTax or named collections | "The Michael Fux Collection" |
| `auction_house` | The auction platform itself | "Mecum Auctions" |
| `dealer` | When seller is identified as dealer | "Classic Car Gallery" |
| `private_collector` | Individual named sellers | - |

---

## Testing a New Extractor

```bash
# Run on 1 vehicle to test
dotenvx run -- node scripts/[source]-extract.js 1 1

# Check the output
# Should see: year | make | model | VIN | SOLD $XXk | Ximg
```

---

## Common Extraction Patterns

### Next.js Sites (Mecum, etc.)
```javascript
const nextData = await page.evaluate(() => {
  const script = document.getElementById('__NEXT_DATA__');
  return script ? JSON.parse(script.textContent) : null;
});
const post = nextData?.props?.pageProps?.post;
```

### JSON-LD (Schema.org)
```javascript
const jsonLd = await page.evaluate(() => {
  const script = document.querySelector('script[type="application/ld+json"]');
  return script ? JSON.parse(script.textContent) : null;
});
if (jsonLd['@type'] === 'Car') { ... }
```

### Text Pattern Matching
```javascript
const bodyText = await page.evaluate(() => document.body.innerText);
const vinMatch = bodyText.match(/VIN[:\s]+([A-Z0-9]{17})/i);
const priceMatch = bodyText.match(/Sold\s*(?:For)?\s*\$?([\d,]+)/i);
```

---

## Source-Specific Extractors

| Source | File | Status |
|--------|------|--------|
| Mecum | `mecum-ultimate-extract.js` | ✅ Full provenance |
| BaT | `bat-simple-extract/` | Edge function |
| Cars & Bids | `extract-cars-and-bids-core/` | Edge function |
| PCarMarket | `pcarmarket-proper-extract.js` | Script |

---

## Remember

1. **Don't duplicate logic** - use shared utilities
2. **Return standardized data** - follow the schema
3. **Let utils handle the plumbing** - focus on scraping
4. **Collections auto-create** - just extract the name/slug
5. **Auction events track timeline** - one per URL/appearance
