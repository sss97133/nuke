# Database Data Audit

## Summary
Comprehensive audit of what data exists vs what we expect to be populated.

## Profile Stats

### User Profiles
- **Total profiles**: Check count
- **With listings**: Profiles that have `total_listings > 0`
- **With bids**: Profiles that have `total_bids > 0`
- **With comments**: Profiles that have `total_comments > 0`
- **With wins**: Profiles that have `total_auction_wins > 0`
- **With member_since**: Profiles with member_since date set

**Expected**: All profiles should have member_since set (from backfill). Stats should be populated for users who have claimed BaT identities.

### Organization Profiles
- **Total orgs**: Check count
- **With listings**: Organizations with `total_listings > 0`
- **With bids**: Organizations with `total_bids > 0`
- **With comments**: Organizations with `total_comments > 0`

**Expected**: Organizations linked to BaT listings should have stats populated.

## External Identities & Claims

- **Total external identities**: All platform identities tracked
- **BaT identities**: Identities from Bring a Trailer
- **Claimed identities**: Identities linked to users via `claimed_by_user_id`
- **Claimed BaT identities**: BaT identities that are claimed

**Expected**: Users should be able to claim their BaT usernames. Currently 0 claimed out of 9,357.

## Organization Services

- **Total services**: Services mapped from websites
- **Orgs with services**: Organizations that have at least one service
- **Verified services**: Services verified by org owners
- **Active services**: Currently active services

**Expected**: Organizations should have services mapped from their websites.

## Success Stories

- **Total stories**: Success stories/testimonials
- **Users with stories**: Users who have success stories
- **Orgs with stories**: Organizations with success stories
- **Featured stories**: Stories marked as featured

**Expected**: Should be populated from BaT testimonials or manual entry.

## Vehicle Data Completeness

### Missing Sale Data
- **Sold without price**: Vehicles with `sale_date` but no `sale_price`
- **Price without date**: Vehicles with `sale_price` but no `sale_date`
- **BaT listings without sale price**: Vehicles with BaT URL but no sale price
- **Marked sold without price**: Vehicles with `auction_outcome = 'sold'` but no price

### Missing Basic Data
- **Missing trim**: Vehicles linked to BaT but no trim
- **Missing engine**: Vehicles linked to BaT but no engine_size
- **Missing drivetrain**: Vehicles linked to BaT but no drivetrain
- **Missing mileage**: Vehicles linked to BaT but no mileage
- **Missing color**: Vehicles linked to BaT but no color

**Expected**: Vehicles linked to BaT listings should have data extracted from `raw_data`.

## External Listings Issues

- **Stale active listings**: Listings marked "active" but vehicle is sold
- **Sold without price**: Listings marked "sold" but no `final_price`
- **Old active listings**: Listings marked "active" but not updated in 30+ days

**Expected**: External listings should match vehicle sale status.

## BaT Listings

- **Total BaT listings**: All BaT listings in database
- **Linked to vehicles**: BaT listings with `vehicle_id` set
- **Sold linked listings**: Sold BaT listings linked to vehicles
- **Sold without price**: Sold listings without sale_price in bat_listings table

**Expected**: All BaT listings should be linked to vehicles, and sold listings should have prices.

## Audit Results (December 22, 2024)

### Profile Stats
- **User profiles**: 5 total, 0 with listings/bids/comments/wins (all stats are 0)
- **Organization profiles**: 209 total, 1 with listings (23 total listings), 0 with bids/comments
- **Status**: Stats not populated - need to run backfill

### External Identities
- **Total identities**: 9,357 (all BaT)
- **Claimed identities**: 0 (0%)
- **BaT users with activity**: 1,110
- **BaT users with external_identity**: 725
- **Status**: Missing links between BaT users and external_identities

### Organization Services
- **Total services**: 0
- **Status**: No services mapped yet

### Success Stories
- **Total stories**: 0
- **Status**: No success stories yet

### Vehicle Data
- **Total vehicles**: 8,261
- **Sold without price**: 0
- **Price without date**: 14 (fixed function created, but dates not found in BaT/external sources)
- **BaT listings without sale price**: 87
- **Missing trim**: 368 vehicles with BaT data
- **Missing engine**: 644 vehicles with BaT data
- **Missing drivetrain**: 609 vehicles with BaT data
- **Missing mileage**: 537 vehicles with BaT data
- **Missing color**: 568 vehicles with BaT data
- **Status**: BaT raw_data may not have expected field structure

### External Listings
- **Total listings**: 590
- **Stale active listings**: 422 (vehicles sold but listing still "active")
- **Sold without price**: 5 (fixed - all 5 now have prices)
- **Status**: Stale listings need trigger workaround

### BaT Listings
- **Total BaT listings**: 760
- **Linked to vehicles**: 745
- **Sold linked listings**: 567
- **Sold without price**: 0
- **Status**: Most listings linked, prices present

## Fixes Applied

1. ✅ **Fixed 5 external_listings missing prices** - All now have final_price from vehicles.sale_price
2. ✅ **Created fix_missing_sale_dates function** - 14 vehicles still missing dates (no source data found)
3. ✅ **Created backfill_vehicle_data_from_bat function** - Found 0 updates (BaT raw_data structure may differ)
4. ⚠️ **Stale external_listings** - 422 still exist (trigger issue needs workaround)

## Next Steps

1. **Investigate BaT raw_data structure** - Fields may be nested differently than expected
2. **Fix stale external_listings** - Apply trigger workaround to update 422 listings
3. **Backfill profile stats** - Run backfill_user_profile_stats for users with claimed identities
4. **Link BaT users to external_identities** - Create missing links for 385 active BaT users
5. **Populate organization services** - Map services from websites
6. **Create success stories** - Extract from BaT testimonials or manual entry

