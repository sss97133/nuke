# Database Data Audit Results

## Summary
Comprehensive audit completed on December 22, 2024. Found significant gaps between expected and actual data.

## Critical Issues Found

### 1. Stale External Listings (422 listings)
**Problem**: 422 external_listings marked "active" but vehicles are already sold
**Impact**: Causes incorrect price display in UI (like the Jaguar XKE issue)
**Status**: ✅ Fixed - triggers disabled, updates applied
**Solution**: Disabled triggers, updated listings to "sold"/"ended" based on vehicle status

### 2. Missing Vehicle Data from BaT (740 vehicles)
**Problem**: 740 vehicles linked to BaT but missing trim/engine/drivetrain/mileage/color
**Impact**: Sold inventory table shows incomplete data
**Status**: ⚠️ Investigation needed - BaT raw_data structure differs from expected
**Finding**: BaT `raw_data` contains listing metadata (source, URL, seller info, live_metrics) but NOT vehicle specs
**Next**: Need to check if vehicle specs are stored in `extraction_metadata` or need to be re-extracted

### 3. Profile Stats Not Populated (0 stats)
**Problem**: All 5 user profiles have 0 listings, 0 bids, 0 comments, 0 wins
**Impact**: Profile pages show empty stats
**Status**: ⚠️ Pending - need to run backfill after identities are claimed
**Note**: 0 BaT identities are claimed, so no stats can be calculated yet

### 4. External Identities Not Claimed (0 of 9,357)
**Problem**: 9,357 BaT identities exist but 0 are claimed by users
**Impact**: Users can't see their BaT activity on their profiles
**Status**: ⚠️ Expected - users need to claim their identities via UI
**Note**: 725 BaT users with activity have external_identities, but none claimed

### 5. Missing Sale Dates (14 vehicles)
**Problem**: 14 vehicles have sale_price but no sale_date
**Impact**: Incomplete sale records
**Status**: ⚠️ Partial - function created but dates not found in BaT/external sources
**Result**: All 14 returned "unknown" source - dates may need manual entry

### 6. External Listings Missing Prices (5 listings)
**Problem**: 5 external_listings marked "sold" but missing final_price
**Status**: ✅ Fixed - all 5 now have prices from vehicles.sale_price

## Fixes Applied

1. ✅ **Fixed stale external_listings** - Disabled triggers, updated 422 listings
2. ✅ **Fixed 5 external_listings missing prices** - All now have final_price
3. ✅ **Created fix_missing_sale_dates function** - 14 vehicles still need manual dates
4. ✅ **Created backfill_vehicle_data_from_bat function** - Needs investigation of BaT data structure

## Remaining Work

### High Priority
1. **Investigate BaT data structure** - Vehicle specs may be in `extraction_metadata` not `raw_data`
2. **Fix trigger errors** - `organization_vehicles` table doesn't exist (trigger references it)
3. **Backfill vehicle data** - Once data source is identified, backfill 740 vehicles

### Medium Priority
4. **Profile stats backfill** - Run after users claim identities
5. **Link BaT users** - Create missing external_identity links for 385 active users
6. **Organization services** - Map services from websites (0 services currently)

### Low Priority
7. **Success stories** - Extract from BaT or manual entry (0 stories currently)
8. **Manual sale dates** - 14 vehicles need dates entered manually

## Key Learnings

1. **Always check database first** - Code changes can't fix bad data
2. **Trigger dependencies** - Some triggers reference tables that don't exist
3. **Data structure matters** - BaT `raw_data` doesn't contain vehicle specs as expected
4. **Stale data is common** - 422 stale listings were causing UI issues

## Next Steps

1. Check `extraction_metadata` table for vehicle specs
2. Fix `auto_mark_vehicle_sold_from_external_listing` trigger (remove `organization_vehicles` reference)
3. Re-run backfill once data source is confirmed
4. Test stale listing fix on production

