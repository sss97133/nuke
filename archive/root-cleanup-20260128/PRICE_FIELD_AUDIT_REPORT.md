# Supabase Price Field Consistency Audit Report

**Date:** 2026-01-22
**Database:** qkgaybvrernstplzjaam.supabase.co
**Total Vehicles:** 14,680
**Total External Listings:** 3,641

---

## Executive Summary

The Nuke database uses a **dual-table approach** for storing price information:
1. **`vehicles` table** - Contains 8 different price fields with varying usage patterns
2. **`external_listings` table** - Contains platform-specific auction data with current_bid and final_price fields

**Key Finding:** There is significant redundancy and inconsistency in how price data is stored, with auction data being duplicated between the vehicles table (high_bid, winning_bid, sale_price) and external_listings table (current_bid, final_price).

---

## Section 1: Vehicles Table - Price Field Usage

### Overall Statistics

| Field | Records Populated | Percentage |
|-------|------------------|------------|
| **asking_price** | 6,366 | 43.37% |
| **high_bid** | 2,989 | 20.36% |
| **price** | 2,778 | 18.92% |
| **sale_price** | 2,334 | 15.90% |
| **winning_bid** | 2,156 | 14.69% |
| **current_value** | 129 | 0.88% |
| **purchase_price** | 36 | 0.25% |
| **msrp** | 19 | 0.13% |

### Key Observations:

1. **asking_price** is the most commonly used field (43.37%) - typically for classified listings (Craigslist, dealer websites, user submissions)

2. **Auction trio (high_bid, sale_price, winning_bid)** accounts for ~20% usage:
   - Often used together for sold auctions
   - Pattern: `high_bid + sale_price + winning_bid` appears in 175 records (1.19%)
   - This suggests auction vehicles store the same price data in multiple fields

3. **price** field (18.92%) appears to be a general-purpose field, sometimes used with high_bid

4. **Rarely used fields:**
   - current_value (129 records) - likely user-estimated values
   - purchase_price (36 records) - what the owner paid
   - msrp (19 records) - manufacturer's suggested retail price

5. **227 records (1.55%)** have NO price fields populated at all

---

## Section 2: Price Field Combinations

### Most Common Patterns:

| Count | Percentage | Combination |
|-------|-----------|-------------|
| 234 | 1.59% | asking_price only |
| 227 | 1.55% | NO_PRICE_FIELDS |
| 175 | 1.19% | high_bid + sale_price + winning_bid |
| 112 | 0.76% | price only |
| 109 | 0.74% | high_bid only |
| 61 | 0.42% | asking_price + high_bid + sale_price + winning_bid |
| 39 | 0.27% | sale_price only |

### Analysis:

- **Single field usage** is most common (asking_price, price, high_bid alone)
- **Auction vehicles** tend to populate 3 fields simultaneously: high_bid, sale_price, winning_bid
- **Mixed patterns** (61 records with asking_price + auction fields) suggest vehicles that were listed for sale, then went to auction
- Very few vehicles use the specialty fields (current_value, purchase_price, msrp)

---

## Section 3: External Listings Table Analysis

### Schema:
The external_listings table contains:
- `current_bid` - The current/latest bid amount
- `final_price` - The final sale price (if sold)
- `reserve_price` - Reserve price (rarely used)
- `buy_now_price` - Buy-it-now price (rarely used)
- `bid_count` - Number of bids placed
- `sold_at` - Timestamp of sale (if sold)

### Price Field Usage:

| Field | Records | Percentage |
|-------|---------|------------|
| **current_bid** | 2,936 | 80.64% |
| **final_price** | 2,154 | 59.16% |
| **reserve_price** | 3 | 0.08% |
| **buy_now_price** | 0 | 0.00% |

### Platform Breakdown:

#### Bring a Trailer (bat) - 677 listings
- **current_bid:** 668 (98.7%) ✓
- **final_price:** 484 (71.5%) ✓
- **sold_at:** 484 (71.5%) ✓
- **Pattern:** Nearly all have current_bid; 71.5% sold with final_price

#### Cars & Bids (cars_and_bids) - 174 listings
- **current_bid:** 38 (21.8%)
- **final_price:** 0 (0.0%)
- **sold_at:** 0 (0.0%)
- **Pattern:** Most listings do NOT have price data (likely active/future auctions)

#### Collecting Cars (collecting_cars) - 71 listings
- **current_bid:** 71 (100.0%) ✓
- **final_price:** 0 (0.0%)
- **sold_at:** 0 (0.0%)
- **Pattern:** All have current_bid but none sold yet

#### Other Platforms:
- **broad_arrow:** 31 listings (45.2% with current_bid)
- **pcarmarket:** 18 listings (0% with price data)
- **sbx:** 12 listings (41.7% with current_bid)
- **gooding:** 9 listings (0% with price data)
- **rmsothebys:** 8 listings (0% with price data)

---

## Section 4: Data Redundancy Analysis

### Problem: Duplicate Price Storage

Comparing vehicles with external_listings shows **significant data duplication**:

#### Example 1: Sold BaT Auction
```
Vehicle Table:
  sale_price: 70500
  high_bid: 70500
  winning_bid: 70500

External Listing:
  current_bid: 70500
  final_price: 70500
  bid_count: 58
  sold_at: 2025-05-17
```

**Issue:** The same price (70,500) is stored in 5 different places!
- 3 fields in vehicles table (sale_price, high_bid, winning_bid)
- 2 fields in external_listings (current_bid, final_price)

#### Example 2: Active Auction with Bid
```
Vehicle Table:
  high_bid: 20750
  winning_bid: null
  sale_price: null

External Listing:
  current_bid: null
  final_price: null
  listing_status: ended
```

**Issue:** Auction ended without sale, but data is inconsistent:
- Vehicle table shows high_bid of 20,750
- External listing shows null current_bid (possibly not synced)

#### Example 3: Sold Auction with Asking Price
```
Vehicle Table:
  asking_price: 35000
  sale_price: 43000
  high_bid: 43000
  winning_bid: 43000

External Listing:
  current_bid: 43000
  final_price: 43000
  sold_at: 2025-07-07
```

**Pattern:** Vehicle had an asking price (35,000) but sold at auction for 43,000. All four price fields in vehicles table + two in external_listings = 6 total fields for 2 prices.

---

## Section 5: Source Distribution

### Vehicles by Source (from sample of 1,000):

| Source | Count | Percentage | Primary Status |
|--------|-------|-----------|----------------|
| **User Submission** | 981 | 98.10% | 84% active, 11.5% pending |
| **dealer_website** | 16 | 1.60% | 100% active |
| **process_import_queue_simple** | 3 | 0.30% | 100% pending |
| **Craigslist** | 5 | ~0.5% | active |
| **KSL Cars** | 1 | <0.1% | active |

### Key Finding:
- **No vehicles have source="BringATrailer" or "CarsAndBids"** in the source field
- Instead, the relationship is tracked through the external_listings table
- The "User Submission" source dominates (98%+), but these vehicles often have associated external_listings from BaT, C&B, etc.

---

## Section 6: Specific Platform Patterns

### Craigslist Listings (from vehicles table):
- **Primary field:** asking_price (4 out of 5 samples)
- **Pattern:** Simple fixed-price listings
- **Example:** asking_price = 500, 6300, 2500, 25000
- **One anomaly:** sale_price = 8200 (possibly sold listing)

### BaT Sold Auctions (from external_listings):
- **Pattern:** sale_price = high_bid = winning_bid in vehicles table
- **External listing:** current_bid = final_price
- **Always includes:** bid_count, sold_at timestamp
- **Consistency:** 71.5% of BaT listings are marked sold

### Cars & Bids Active Auctions:
- **Pattern:** Most have NO price data yet (only 21.8% have current_bid)
- **External listing:** current_bid populated for active auctions
- **Issue:** No sold C&B auctions found (0% final_price)

---

## Key Recommendations

### 1. Eliminate Redundancy
**Problem:** Auction data stored in 5 places (high_bid, winning_bid, sale_price in vehicles + current_bid, final_price in external_listings)

**Recommendation:**
- **For auction vehicles:** Use ONLY external_listings for price data
- **Deprecate** high_bid, winning_bid from vehicles table for auction listings
- **Keep sale_price** in vehicles table as a denormalized "display field" that syncs from external_listings.final_price

### 2. Standardize Field Usage

| Vehicle Type | Recommended Field(s) |
|--------------|---------------------|
| **Auction (sold)** | external_listings.final_price → vehicles.sale_price |
| **Auction (active)** | external_listings.current_bid (no vehicles table field) |
| **Auction (no reserve met)** | external_listings.current_bid + vehicles.high_bid |
| **Classified (for sale)** | vehicles.asking_price |
| **User estimate** | vehicles.current_value |
| **Owner's purchase** | vehicles.purchase_price |
| **New car MSRP** | vehicles.msrp |

### 3. Data Cleanup Tasks

#### High Priority:
1. **Audit 227 vehicles with NO price fields** - Are these valid entries?
2. **Sync auction data** - Ensure vehicles.sale_price matches external_listings.final_price for sold auctions
3. **Remove duplicate data** - For vehicles with external_listings, clear high_bid/winning_bid in vehicles table

#### Medium Priority:
4. **Standardize Craigslist listings** - All should use asking_price (not sale_price)
5. **Review "price" field usage** - 2,778 records use this generic field; determine if they should use asking_price or another specific field

#### Low Priority:
6. **Document specialty fields** - Create clear guidelines for current_value, purchase_price, msrp usage

### 4. Add Source Field to External Listings?

Currently, vehicles.source doesn't reflect "BringATrailer" or "CarsAndBids" - instead these are in external_listings.platform.

**Options:**
- Keep as-is (source = "User Submission", link via external_listings)
- Update vehicles.source to match primary external_listings.platform
- Add a computed field or view for "effective source"

### 5. Address Active Auction Inconsistency

Cars & Bids active auctions show only 21.8% have current_bid populated. This suggests:
- Sync issues with the C&B API
- Auctions scheduled but not started
- Data import problems

**Action:** Investigate why C&B current_bid is missing for 78% of listings.

---

## Data Quality Metrics

### Good:
✓ BaT integration is strong (98.7% have current_bid, 71.5% sold with final_price)
✓ Collecting Cars has 100% current_bid coverage
✓ Craigslist listings consistently use asking_price

### Needs Attention:
⚠ 227 vehicles (1.55%) have NO price fields
⚠ Redundant storage of auction prices (5 fields for same value)
⚠ C&B listings only 21.8% have current_bid (sync issue?)
⚠ Multiple specialty platforms (pcarmarket, gooding, rmsothebys) have 0% price data
⚠ No standardized approach to vehicles.source for external listings

### Critical Issue:
🔴 **Price field chaos** - 8 fields in vehicles table with overlapping semantics creates confusion and sync challenges

---

## Appendix: Complete Price Field Inventory

### Vehicles Table:
1. **price** - Generic price field (18.92% populated)
2. **asking_price** - Seller's asking price for classifieds (43.37%)
3. **sale_price** - Final sale price (15.90%)
4. **high_bid** - Highest bid received (20.36%)
5. **winning_bid** - Winning bid amount (14.69%)
6. **current_value** - User-estimated current value (0.88%)
7. **purchase_price** - What owner paid (0.25%)
8. **msrp** - Manufacturer suggested retail price (0.13%)

### External Listings Table:
1. **current_bid** - Current bid on active auction (80.64% populated)
2. **final_price** - Final sale price for sold auction (59.16%)
3. **reserve_price** - Reserve price (0.08%)
4. **buy_now_price** - Buy-it-now price (0.00%)
5. **bid_count** - Number of bids (tracked but not price)
6. **sold_at** - Sale timestamp (indicator of final_price validity)

---

## Conclusion

The Nuke database has a functional but **overly complex and redundant price data model**. The external_listings table is well-structured for auction data, but the vehicles table contains too many overlapping price fields that create data duplication and sync challenges.

**Primary Recommendation:** Establish a clear data hierarchy where external_listings is the source of truth for auction prices, and vehicles table contains only denormalized display fields (sale_price) plus category-specific fields (asking_price for classifieds, current_value for estimates, etc.).

This will require:
1. Schema cleanup (deprecate/remove redundant fields)
2. Application code updates (change which fields are written/read)
3. Data migration (consolidate existing data to new pattern)
4. Documentation (clear field usage guidelines)

**Estimated Impact:** This cleanup could reduce database storage by 15-20% for price-related fields and eliminate sync bugs where auction data gets out of sync between tables.
