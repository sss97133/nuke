# Profile Stats Data Status

## Current Database State

### ✅ Raw Data Exists:
- **760 BaT listings** (29 unique sellers, 556 unique buyers)
- **1,484 BaT comments** (557 unique commenters)  
- **9,357 external identities** (BaT platform)
- **0 auction bids** (auction_bids table is empty)

### ❌ Profile Stats Columns Missing:
- `profiles.total_listings` - **NOT YET CREATED**
- `profiles.total_bids` - **NOT YET CREATED**
- `profiles.total_comments` - **NOT YET CREATED**
- `profiles.total_auction_wins` - **NOT YET CREATED**
- `profiles.member_since` - **NOT YET CREATED**
- `businesses.total_listings` - **NOT YET CREATED**
- `businesses.total_bids` - **NOT YET CREATED**
- `businesses.total_comments` - **NOT YET CREATED**

**Status**: Migration `20251219_comprehensive_profile_stats.sql` needs to be run!

## Where UI Shows This Data

### 1. User Profile Page (`/profile` or `/profile/:userId`)

**Location**: Overview tab (default)

**Component**: `ComprehensiveProfileStats`
- Shows: Listings, Bids, Comments, Auction Wins, Success Stories
- Shows: Member since date
- Shows: Location
- **Currently**: Only displays if `comprehensiveData?.stats` exists

**Additional Tabs**:
- **Listings Tab**: Shows all listings (from `comprehensiveData.listings`)
- **Bids Tab**: Shows all bids (from `comprehensiveData.bids`)
- **Success Stories Tab**: Shows success stories (from `comprehensiveData.success_stories`)

**Code Location**: 
- `nuke_frontend/src/pages/Profile.tsx` (lines 606-614, 675-700)
- `nuke_frontend/src/components/profile/ComprehensiveProfileStats.tsx`

### 2. Organization Profile Page (`/org/:orgId`)

**Location**: Overview tab

**Component**: `ComprehensiveProfileStats`
- Shows: Same stats as user profiles
- **Currently**: Only displays if `comprehensiveData?.stats` exists

**Additional Tabs**:
- **Listings Tab**: Organization listings
- **Bids Tab**: Organization member bids
- **Success Stories Tab**: Organization success stories
- **Services Tab**: Services offered (from `comprehensiveData.services`)

**Code Location**:
- `nuke_frontend/src/pages/OrganizationProfile.tsx` (lines ~1690-1700, 3057-3100)

## How Data is Loaded

### Current Flow:
1. **Profile.tsx** calls `getUserProfileData(userId)` from `profileStatsService.ts`
2. **OrganizationProfile.tsx** calls `getOrganizationProfileData(orgId)` from `profileStatsService.ts`
3. Service calculates stats **dynamically** from raw data:
   - Counts listings from `bat_listings` table
   - Counts bids from `auction_bids` + `bat_listings` (buyer)
   - Counts comments from `bat_comments` + `auction_comments`
   - Links via `external_identities` table

### Problem:
- Service tries to read from `profiles.total_listings` etc. but columns don't exist
- Stats are calculated on-the-fly but can't be stored
- UI will show stats if calculation succeeds, but they're not persisted

## Next Steps

### 1. Run Migration (REQUIRED):
```sql
-- Apply migration to add stats columns
-- File: supabase/migrations/20251219_comprehensive_profile_stats.sql
```

### 2. Backfill Stats:
```sql
-- After migration, run backfill
SELECT * FROM backfill_all_user_profile_stats();
SELECT * FROM backfill_all_organization_profile_stats();
```

Or use the UI tool:
- Go to `/admin/market-data-tools`
- Click "Backfill Stats" tab
- Click "Backfill All Users" or "Backfill All Organizations"

### 3. Verify Display:
- Visit `/profile` (your profile)
- Check Overview tab - should see stats card
- Check Listings/Bids/Stories tabs - should show data

## Data Sources

### Listings:
- `bat_listings` table (760 records)
- Linked via `seller_external_identity_id` → `external_identities` → `claimed_by_user_id`

### Bids:
- `auction_bids` table (0 records - empty!)
- `bat_listings.buyer_external_identity_id` (556 buyers)

### Comments:
- `bat_comments` table (1,484 records)
- `auction_comments` table
- Linked via `external_identity_id` → `external_identities` → `claimed_by_user_id`

### Success Stories:
- `success_stories` table (needs to be populated)

## Current Limitations

1. **Stats columns don't exist** - Migration not run
2. **No auction bids data** - `auction_bids` table is empty
3. **No claimed identities** - 0 out of 9,357 external identities are claimed
4. **Stats calculated dynamically** - Not stored, recalculated on each page load

