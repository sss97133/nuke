# Extractor Quality Comparison vs BaT Gold Standard

Last Updated: 2026-01-25

## BaT Gold Standard Fields

| Category | Field | BaT Extracts | Required | Notes |
|----------|-------|--------------|----------|-------|
| **Identity** | title | ✓ | YES | From H1 |
| | year | ✓ | YES | Parsed from title |
| | make | ✓ | YES | Parsed from title |
| | model | ✓ | YES | Parsed from title |
| | vin | ✓ | YES | 17-char or chassis |
| | location | ✓ | YES | Where vehicle is |
| **Specs** | mileage | ✓ | SHOULD | "X miles" |
| | exterior_color | ✓ | SHOULD | "finished in X" |
| | interior_color | ✓ | SHOULD | "X leather" |
| | transmission | ✓ | SHOULD | "4-Speed Manual" |
| | drivetrain | ✓ | SHOULD | RWD/AWD/4WD/FWD |
| | engine | ✓ | SHOULD | "3.8L flat-six" |
| | body_style | ✓ | SHOULD | Coupe/Sedan/etc |
| **Auction** | seller_username | ✓ | Auction | Who listed |
| | buyer_username | ✓ | Auction | Who won |
| | sale_price | ✓ | Auction | Final price |
| | high_bid | ✓ | Auction | Current/ending bid |
| | bid_count | ✓ | Auction | Total bids |
| | comment_count | ✓ | Auction | Discussion size |
| | view_count | ✓ | Auction | Engagement |
| | watcher_count | ✓ | Auction | Interest level |
| | lot_number | ✓ | Auction | Auction lot |
| | reserve_status | ✓ | Auction | no_reserve/met/not_met |
| | auction_end_date | ✓ | Auction | When ended |
| **Rich** | description | ✓ | YES | Full listing text |
| | image_urls[] | ✓ | YES | ALL gallery images |
| | comments[] | ✓ | BaT-only | Q&A/bids/discussion |
| **DB Tables** | vehicles | ✓ | YES | Core record |
| | vehicle_images | ✓ | YES | ALL images stored |
| | external_listings | ✓ | YES | Platform metadata |
| | timeline_events | ✓ | YES | Listed/Sold events |
| | organization_vehicles | ✓ | OPT | Auction house link |

---

## Mecum Extractor Quality

**File:** `scripts/mecum-proper-extract.js`

| Field | Extracts? | Quality | Notes |
|-------|-----------|---------|-------|
| title | ✓ | Good | From H1 |
| year/make/model | ✗ | Missing | Not parsed from title |
| vin | ✓ | Good | VIN/SERIAL pattern |
| location | ✗ | Missing | Not extracted |
| mileage | ✓ | Good | ODOMETER pattern |
| exterior_color | ✓ | Good | EXTERIOR COLOR label |
| interior_color | ✓ | Good | INTERIOR COLOR label |
| transmission | ✓ | Good | TRANSMISSION label |
| drivetrain | ✗ | Missing | Not extracted |
| engine | ✓ | Good | ENGINE label |
| body_style | ✓ | Good | BODY STYLE label |
| sale_price | ✓ | Good | Sold For pattern |
| high_bid | ✓ | Good | High Bid pattern |
| lot_number | ✓ | Good | LOT pattern |
| description | ✓ | Good | From highlights+equipment |
| image_urls | ✓ | Good | Mecum cloudinary images |
| **DB: vehicles** | ✓ | Good | Updates correctly |
| **DB: vehicle_images** | ✓ | Good | Stores ALL images |
| **DB: auction_events** | ✓ | Good | Creates timeline |

### Mecum Quality Score: 75%

**Missing:**
- Year/Make/Model parsing from title
- Location extraction
- Drivetrain
- Bid/comment/view counts (Mecum format different)

**Recommendation:** Add title parsing to extract year/make/model before running at scale.

---

## PCarMarket Extractor Quality

**File:** `scripts/pcarmarket-proper-extract.js`

| Field | Extracts? | Quality | Notes |
|-------|-----------|---------|-------|
| title | ✓ | Good | From H1 |
| year/make/model | ✗ | Missing | Not parsed |
| vin | ✓ | Good | VIN: pattern |
| location | ✓ | Good | Location: label |
| mileage | ✓ | Good | miles/mi pattern |
| exterior_color | ✓ | Good | Exterior/Color label |
| interior_color | ✓ | Good | Interior: label |
| transmission | ✓ | Good | Manual/PDK/etc |
| drivetrain | ✗ | Missing | Not extracted |
| engine | ✓ | Good | Engine: or displacement |
| body_style | ✗ | Missing | Not extracted |
| sale_price | ✓ | Good | Sold for pattern |
| high_bid | ✓ | Good | Current Bid pattern |
| reserve_status | ✓ | Good | Reserve Met/Not Met |
| seller | ✓ | Good | Listed by/Seller |
| description | ✓ | Good | About/Description section |
| image_urls | ✓ | Good | Cloudfront images |
| **DB: vehicles** | ✓ | Good | Updates correctly |
| **DB: vehicle_images** | ✗ | Missing | Not storing images separately! |
| **DB: auction_events** | ✓ | Good | Creates timeline |

### PCarMarket Quality Score: 70%

**Critical Missing:**
- NOT saving images to vehicle_images table! Only primary_image_url
- Year/Make/Model parsing
- Body style
- Drivetrain

**Recommendation:** Fix image storage BEFORE running at scale. This is a blocker.

---

## Quality Checklist Before Running

### Level 1: Can Extract (Min viable)
- [ ] Fetches page without errors
- [ ] Gets title
- [ ] Gets at least 1 image

### Level 2: Core Data (Required)
- [ ] Parses year/make/model from title
- [ ] Extracts VIN (if visible on source)
- [ ] Gets sale/asking price
- [ ] Gets mileage

### Level 3: Rich Data (Expected)
- [ ] Full description text
- [ ] ALL gallery images (not just hero)
- [ ] Seller info
- [ ] Specs: color, transmission, engine

### Level 4: Database Integration (Required)
- [ ] Saves to vehicles table correctly
- [ ] Saves ALL images to vehicle_images
- [ ] Creates auction_events/timeline
- [ ] No duplicates (VIN dedup working)

### Level 5: Validation (Before Scale)
- [ ] Sample 5 URLs manually - compare extraction vs source
- [ ] Image count matches source gallery
- [ ] Prices parse correctly (no $1 bugs)
- [ ] VINs validate (17 chars)

---

## Fix Priority List

### P0 (Blockers - Fix Before Scale)
1. **PCarMarket: Add vehicle_images storage** - Only saving primary_image_url
2. **All: Add year/make/model parsing** - Critical for search/filter

### P1 (High - Fix Soon)
1. Add drivetrain extraction (RWD/AWD/4WD)
2. Add body_style to PCarMarket
3. Add location to Mecum

### P2 (Medium - Nice to Have)
1. Bid/comment/view counts where available
2. Watcher counts
3. Reserve status normalization

---

## Validation Queries

```sql
-- Vehicles missing images (CRITICAL)
SELECT COUNT(*) FROM vehicles v
WHERE NOT EXISTS (SELECT 1 FROM vehicle_images WHERE vehicle_id = v.id)
  AND v.status = 'active';

-- Vehicles missing VIN (post-1981)
SELECT COUNT(*) FROM vehicles
WHERE vin IS NULL AND year >= 1981 AND status = 'active';

-- Vehicles missing year/make/model
SELECT COUNT(*) FROM vehicles
WHERE (year IS NULL OR make IS NULL OR model IS NULL)
  AND status = 'active';

-- Image count per vehicle (should be 15-30 for auctions)
SELECT v.id, v.discovery_source, COUNT(vi.id) as image_count
FROM vehicles v
LEFT JOIN vehicle_images vi ON vi.vehicle_id = v.id
WHERE v.status = 'active'
GROUP BY v.id, v.discovery_source
HAVING COUNT(vi.id) < 5;
```
