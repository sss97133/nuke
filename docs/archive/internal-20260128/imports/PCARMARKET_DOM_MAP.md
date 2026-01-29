# PCarMarket DOM/JSON Extraction Map

**Created**: 2026-01-23
**Purpose**: Complete extraction reference for PCarMarket.com

---

## Key Finding: JSON-Based Data

Unlike BaT (which uses HTML elements), **PCarMarket embeds all listing data as JSON** in the page. This makes extraction much cleaner - just parse the JSON object.

```
BaT:       HTML elements with CSS classes → regex/selector parsing
PCarMarket: Embedded JSON object → JSON.parse()
```

---

## Volume Estimate

| Category | Pages | Listings/Page | Total |
|----------|-------|---------------|-------|
| Sold | 308 | 24 | ~7,400 |
| Unsold | 409 | 24 | ~9,800 |
| No Reserve (live) | ~5 | 24 | ~100 |
| Reserve (live) | ~5 | 24 | ~100 |
| **TOTAL** | - | - | **~17,200** |

More unsold than sold (57% unsold) - interesting market data.

---

## URL Patterns

```
# Individual auctions
https://www.pcarmarket.com/auction/{year}-{make}-{model}-{id}
https://www.pcarmarket.com/auction/2007-porsche-911-carrera-4s-1
https://www.pcarmarket.com/auction/1970-mercedes-benz-280sl-1

# Listing indexes (paginated)
https://www.pcarmarket.com/auctions?auctionType=sold&page=1
https://www.pcarmarket.com/auctions?auctionType=unsold&page=1
https://www.pcarmarket.com/auctions?auctionType=no_reserve
https://www.pcarmarket.com/auctions?auctionType=reserve

# Member profiles
https://www.pcarmarket.com/member/{username}/
https://www.pcarmarket.com/seller/{username}/

# Image CDN
https://d2niwqq19lf86s.cloudfront.net/htwritable/media/uploads/...
```

---

## Complete JSON Schema

Every auction page contains this JSON structure:

```typescript
interface PCarMarketListingJSON {
  // === IDENTIFIERS ===
  id: number;                          // 63888
  title: string;                       // "1970 Mercedes-Benz 280SL"
  slug: string;                        // "1970-mercedes-benz-280sl-1"
  lot_number: string;                  // "V-0063888" (V=vehicle, M=memorabilia)

  // === VEHICLE (null for memorabilia) ===
  vehicle: {
    id: number;
    make: string;                      // "Mercedes-Benz"
    model: string;                     // "280SL"
    year: number;                      // 1970
    slug_model: string;                // "280sl"
  } | null;

  // === CATEGORIES (for non-vehicle items) ===
  categories?: Array<{
    slug: string;                      // "memorabilia"
    name: string;                      // "Art & Memorabilia"
  }>;

  // === VIN/CHASSIS ===
  vin: string;                         // "11304412013245" (short for classics)
                                       // "WP0AB29947S730343" (17-char for modern)

  // === MILEAGE ===
  mileage_body: number | null;         // 38569
  mileage_engine: number | null;       // null or different if swapped
  odometer_type: 'mi' | 'km';
  tmu: boolean;                        // True Mileage Unknown
  five_digit_odo: boolean;             // Rollover risk

  // === AUCTION TYPE ===
  auction_type: number;                // 1 = standard
  auction_subtype: number;
  is_marketplace: boolean;             // Fixed price listing
  marketplace_listing_slug: string | null;

  // === PRICING ===
  current_bid: string;                 // "$74,000" (formatted)
  high_bid: number;                    // 74000.0 (numeric)
  reserve_price: number | null;        // null = no reserve
  reserve_status: 'met' | 'not_met' | null;
  minimum_bid: string;                 // "$74,250"
  msrp: number | null;
  retail_value: number | null;
  dealer_fee_amount: string;
  auction_final_bid: number | null;    // Final sale price

  // === DATES ===
  start_date: string;                  // "2026-01-16T17:14:00-05:00"
  end_date: string;                    // "2026-01-23T15:00:00-05:00"
  time_remaining: number;              // Seconds (negative if ended)
  last_chance: boolean;                // Extended bidding
  last_chance_end_date: string | null;

  // === STATUS ===
  status: 'Live' | 'Sold' | 'Unsold' | 'Coming Soon';
  status_class: 'live' | 'sold' | 'unsold' | 'coming_soon';
  sold: boolean;
  finalized: boolean;
  accepted_offer: boolean;             // Post-auction offer
  hide_sell_price: boolean;
  is_draft: boolean;

  // === ENGAGEMENT ===
  bid_count: number;                   // 14
  view_count: number;                  // 4611
  watch_count: number;                 // 76
  is_saved: boolean;

  // === LOCATION ===
  location: string;                    // "San Luis Obispo, CA"
  zip_code: string;                    // "93401"
  country: string;                     // "United States of America"

  // === SELLER ===
  seller_username: string;             // "smithvolvo"
  seller_user_id: number;
  seller_date_joined: string;          // "March 2019"
  seller_follower_count: number;
  user_follows_seller: boolean;

  // === CONTENT ===
  description: string;                 // Full HTML description
  promo_text: string;
  inspection_completed: boolean;

  // === IMAGES ===
  featured_image_url: string;          // Thumbnail
  featured_image_large_url: string;    // Hero
  gallery_images: Array<{
    id: number;
    url: string;                       // 380px
    hero_url: string;                  // 2048px
    full_url: string;                  // 2048px
    original_url: string;              // Original
    caption?: string;
    position: number;
  }>;

  // === COMMENTS (may be separate) ===
  comments?: Array<{
    id: number;
    user_id: number;
    username: string;
    content: string;
    created_at: string;
    is_bid: boolean;
    bid_amount?: number;
    is_seller: boolean;
    reply_to?: number;
    likes: number;
  }>;
}
```

---

## Mapping to Nuke vehicles Table

| PCarMarket Field | Nuke Field | Transform |
|------------------|------------|-----------|
| `vehicle.year` | `year` | Direct |
| `vehicle.make` | `make` | `.toLowerCase()` |
| `vehicle.model` | `model` | `.toLowerCase()` |
| `vin` | `vin` | `.toUpperCase()`, accept 6-17 chars |
| `mileage_body` or `mileage_engine` | `mileage` | First non-null |
| `high_bid` (if sold) | `sale_price` | Only when `sold: true` |
| `end_date` (if sold) | `sale_date` | Only when `sold: true` |
| `end_date` | `auction_end_date` | Always |
| `sold` + `status` | `auction_outcome` | 'sold' or 'reserve_not_met' |
| `location` + `zip_code` | `location` | Concatenate |
| `description` | `description` | HTML blob |
| `slug` | `discovery_url` | Prepend base URL |

---

## Memorabilia Detection

PCarMarket sells non-vehicle items (watches, art, memorabilia). Detect with:

```typescript
function isVehicle(json: PCarMarketListingJSON): boolean {
  // Check vehicle object
  if (json.vehicle !== null) return true;

  // Check lot number prefix
  if (json.lot_number?.startsWith('V-')) return true;
  if (json.lot_number?.startsWith('M-')) return false;

  // Check categories
  if (json.categories?.some(c => c.slug === 'memorabilia')) return false;

  return true; // Default to vehicle
}
```

Categories seen:
- `Art & Memorabilia` (slug: `memorabilia`)

---

## VIN Handling

PCarMarket shows VINs for all years, including pre-1981 short chassis numbers:

| Year | VIN Format | Example |
|------|------------|---------|
| Pre-1981 | 6-13 characters | `11304412013245` |
| Post-1981 | 17 characters | `WP0AB29947S730343` |

**Accept 6-17 character VINs.** Don't reject short chassis numbers from classics.

---

## Image URLs

```
Thumbnail (380px):  gallery_images[].url
Hero (2048px):      gallery_images[].hero_url
Full (2048px):      gallery_images[].full_url
Original:           gallery_images[].original_url

CDN: https://d2niwqq19lf86s.cloudfront.net/
```

Always prefer `original_url` > `full_url` > `hero_url` > `url`.

---

## Extraction Code

See: `supabase/functions/_shared/pcarDomMap.ts`

```typescript
import { extractListingJSON, FIELD_MAPPINGS, extractImages } from './_shared/pcarDomMap.ts';

// Parse JSON from HTML
const json = extractListingJSON(html);
if (!json) throw new Error('Failed to extract JSON');

// Map to vehicle fields
const vehicle = {
  year: FIELD_MAPPINGS.year(json),
  make: FIELD_MAPPINGS.make(json),
  model: FIELD_MAPPINGS.model(json),
  vin: FIELD_MAPPINGS.vin(json),
  // ... etc
};

// Get images
const images = extractImages(json);
```

---

## Data Availability

### Always Present
- `id`, `title`, `slug`, `lot_number`
- `status`, `status_class`, `sold`, `finalized`
- `start_date`, `end_date`
- `bid_count`, `view_count`, `watch_count`
- `seller_username`, `seller_user_id`
- `location`, `zip_code`
- `description`
- `featured_image_url`, `gallery_images`

### Usually Present
- `vehicle` object (year, make, model)
- `vin`
- `mileage_body`
- `high_bid`, `current_bid`

### Sometimes Missing
- `mileage_engine` (only if different from body)
- `msrp`, `retail_value`
- `auction_final_bid` (sometimes `high_bid` is used)
- `reserve_price` (null for no-reserve)
- `dealer_fee_amount`

### In Description Only (not structured)
- Engine displacement
- Transmission type
- Exterior/interior colors
- Options/features list
- Service history

---

## Comparison to BaT

| Aspect | BaT | PCarMarket |
|--------|-----|------------|
| Data format | HTML elements | Embedded JSON |
| VIN visibility | Usually shown | Usually shown |
| Image count | 50-100+ | 20-80 |
| Volume | ~128k | ~17k |
| Memorabilia | No | Yes (watches, art) |
| Comments structure | HTML with classes | JSON array |
| Seller type | Member profiles | Dealer + Private |
| Reserve info | Badge/text | `reserve_status` field |

---

## References

- DOM Map code: `supabase/functions/_shared/pcarDomMap.ts`
- Import function: `supabase/functions/import-pcarmarket-listing/index.ts`
- Loop shell: `scripts/pcarmarket-loop.sh`
- Agent bootstrap: `scripts/rlm/AGENT_BOOTSTRAP_PCARMARKET.md`
