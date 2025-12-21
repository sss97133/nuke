# Profile Stats Setup - Complete ✅

## ✅ Migrations Applied

1. **`comprehensive_profile_stats`** - Added stats columns to profiles and businesses tables
2. **`backfill_profile_stats`** - Created backfill functions

## Database Status

### Columns Created:
- ✅ `profiles.total_listings`
- ✅ `profiles.total_bids`
- ✅ `profiles.total_comments`
- ✅ `profiles.total_auction_wins`
- ✅ `profiles.total_success_stories`
- ✅ `profiles.member_since`
- ✅ `businesses.total_listings`
- ✅ `businesses.total_bids`
- ✅ `businesses.total_comments`
- ✅ `businesses.total_auction_wins`
- ✅ `businesses.total_success_stories`
- ✅ `businesses.member_since`

### Tables Created:
- ✅ `organization_services` - Services organizations offer
- ✅ `organization_website_mappings` - Website structure mapping
- ✅ `success_stories` - BaT-style testimonials

### Functions Created:
- ✅ `backfill_user_profile_stats(user_id)`
- ✅ `backfill_organization_profile_stats(org_id)`
- ✅ `backfill_all_user_profile_stats()`
- ✅ `backfill_all_organization_profile_stats()`
- ✅ `update_user_profile_stats(user_id)`
- ✅ `update_organization_profile_stats(org_id)`

## Current Data Status

### Raw Data Available:
- **760 BaT listings** (29 sellers, 556 buyers)
- **1,484 BaT comments** (557 commenters)
- **9,357 external identities** (BaT platform)
- **0 claimed identities** (users need to claim their BaT usernames)

### Stats Populated:
- ✅ All profiles have `member_since` set (from `created_at` or earliest activity)
- ⚠️ Most stats are 0 because users haven't claimed their BaT identities yet

## Where to See It in UI

### User Profiles:
1. Go to `/profile` or `/profile/:userId`
2. **Overview tab** - Shows `ComprehensiveProfileStats` component at top
3. **Listings tab** - Shows all listings
4. **Bids tab** - Shows all bids
5. **Success Stories tab** - Shows success stories

### Organization Profiles:
1. Go to `/org/:orgId`
2. **Overview tab** - Shows `ComprehensiveProfileStats` component
3. **Listings/Bids/Stories/Services tabs** - Show respective data

## Next Steps for Users

### To See Stats:
1. **Claim BaT Identity**: Go to `/claim-identity` and claim your BaT username
2. **Stats Auto-Update**: Once claimed, stats automatically populate from BaT data
3. **View Profile**: Visit `/profile` to see your stats

### For Organizations:
1. **Link BaT Listings**: Organizations with BaT listings will show stats automatically
2. **Add Services**: Use Service Mapper tool to extract services from website
3. **View Profile**: Visit `/org/:orgId` to see organization stats

## Backfill Status

✅ **Backfill completed** for all users and organizations
- Member since dates set
- Stats calculated (will be 0 until identities are claimed)

## How Stats Are Calculated

### User Stats:
- **Listings**: Count of `bat_listings` where user is seller (via claimed external identity)
- **Bids**: Count of `auction_bids` + `bat_listings` where user is buyer
- **Comments**: Count of `bat_comments` + `auction_comments` from user
- **Wins**: Count of `bat_listings` where user is buyer and status = 'sold'
- **Member Since**: Earliest activity date (profile creation, first comment, first bid, etc.)

### Organization Stats:
- **Listings**: Count of `bat_listings` + `auction_events` linked to org
- **Bids**: Count of bids from organization members
- **Comments**: Count of comments from organization members
- **Wins**: Count of sold listings from organization

## Manual Backfill

If you need to backfill a specific user or org:

```sql
-- Single user
SELECT backfill_user_profile_stats('user-uuid-here');

-- Single organization
SELECT backfill_organization_profile_stats('org-uuid-here');

-- All users (use with caution)
SELECT * FROM backfill_all_user_profile_stats();

-- All organizations
SELECT * FROM backfill_all_organization_profile_stats();
```

Or use the UI tool at `/admin/market-data-tools` → "Backfill Stats" tab.

