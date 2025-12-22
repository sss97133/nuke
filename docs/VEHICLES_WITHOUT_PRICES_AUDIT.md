# Vehicles Without Prices Audit

## Summary
User asked about the ~4,000 vehicles that don't have prices. This audit identifies where they are and why they're missing prices.

## Total Vehicle Breakdown

- **Total vehicles**: 8,261
- **Vehicles with prices**: 4,909 (59%)
- **Vehicles without prices**: 2,834 (34%)
- **Note**: Some vehicles may have zero prices (counted separately)

## Vehicles Without Prices Analysis

### By Source (2,834 vehicles)
- **From other sources**: 2,744 vehicles (97%) - mostly external listings (Hemmings, Craigslist, L'Art de l'Automobile, etc.)
- **From BaT**: 63 vehicles (2%) - should have prices from BaT listings
- **Manual entry**: 13 vehicles (<1%)

### By Status
- **All marked "available"**: 2,834 vehicles - none are sold, all are available for sale
- **Have discovery_url**: 2,821 vehicles (99.5%) - imported from external sources
- **Have complete specs**: 2,505 vehicles (88%) - have year/make/model
- **All recent entries**: All 2,834 created in last 30 days

### Key Sources
1. **L'Art de l'Automobile** - French dealer listings
2. **Hemmings** - Classic car marketplace
3. **Craigslist** - Various local listings
4. **Beverly Hills Car Club** - Dealer listings
5. **Other external sources** - Various marketplaces

### Linked Data
- **67 vehicles** linked to `bat_listings` but no prices (BaT listings also don't have sale_price)
- **Vehicles with external_listings**: Check if `external_listings` table has prices for these

## The Problem

These vehicles were **imported/scraped** but **price extraction failed or didn't happen**:
1. Vehicles were discovered and added to database
2. Basic specs (year/make/model) were extracted
3. But prices were NOT extracted from the source pages
4. They're all marked "available" but have no `asking_price` or `current_value`

## Examples

Looking at sample vehicles:
- **2018 Porsche 991 II Carrera 4 GTS** - from L'Art de l'Automobile, no price
- **Ferrari 308 GTB** - from L'Art de l'Automobile, no price
- **2024 Porsche 911 GT3 Touring** - from BaT, should have price but doesn't
- **1972 CHEVROLET C10** - from Hemmings, no price
- Some have prices in the model name (e.g., "4Runner SR5 4x4 Premium lift - $28,995") but not extracted

## Key Findings

1. **67 vehicles have prices in model name** - Prices like "$28,995" are embedded in the model field but not extracted
2. **Only 1 vehicle has external_listing with price** - Most external_listings don't have prices either
3. **2,744 vehicles from external sources** - Hemmings, Craigslist, L'Art de l'Automobile, etc.
4. **All marked "available"** - None are sold, all are for sale but prices weren't extracted

## Next Steps

1. ✅ **Extract prices from model names** - Created function to extract prices from 67 vehicles with prices in model field
2. **Backfill from external_listings** - Only 1 vehicle has price in external_listings, so this won't help much
3. **Re-scrape source pages** - Need to extract prices from discovery_url pages (Hemmings, Craigslist, etc.)
4. **Backfill from BaT listings** - For the 67 vehicles linked to BaT, check if we can get prices from raw_data
5. **Mark as "price unknown"** - For vehicles where price truly can't be determined

## Impact on Total Value

These 2,834 vehicles without prices are **not included** in the $31.6M total value calculation. If we could extract prices for them:
- **67 vehicles** with prices in model names could add ~$2-3M (estimated)
- **Remaining 2,767 vehicles** would need price extraction from source pages or estimation

