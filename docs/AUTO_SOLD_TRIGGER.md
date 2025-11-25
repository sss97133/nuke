# Auto-Mark Vehicles as Sold from External Listings

## Overview

The system now automatically marks vehicles as sold when external listings (BaT, Cars & Bids, etc.) are marked as sold. **No manual intervention required.**

## How It Works

### Automatic Trigger

When an `external_listings` record is created or updated with `listing_status = 'sold'`, a database trigger automatically:

1. **Updates `organization_vehicles`**:
   - Sets `listing_status = 'sold'`
   - Sets `sale_date` from `sold_at` or `end_date`
   - Sets `sale_price` from `final_price` or `current_bid`

2. **Updates `vehicles` table**:
   - Sets `sale_status = 'sold'`
   - Sets `sale_date` and `sale_price` if available

### When It Triggers

The trigger fires when:
- A new `external_listings` record is inserted with `listing_status = 'sold'`
- An existing `external_listings` record is updated and `listing_status` changes to `'sold'`
- `final_price`, `sold_at`, or `end_date` are updated on a sold listing

### BaT Import Flow

1. **Bulk Import**: When you import BaT sales via `BaTBulkImporter`, the `import-bat-listing` edge function creates `external_listings` records with `listing_status = 'sold'`
2. **Trigger Fires**: The trigger automatically updates `organization_vehicles` and `vehicles`
3. **Result**: Vehicles appear in "Sold Inventory" automatically

### Sync Function

The `sync-bat-listing` edge function can also update `external_listings` when auctions end:
- If auction ends with a sale price → `listing_status = 'sold'` → trigger fires
- If auction ends without sale → `listing_status = 'ended'` → no trigger

## Backfilling Historical Data

If you've already imported BaT sales but `organization_vehicles` wasn't updated, run:

```sql
SELECT * FROM backfill_sold_status_from_external_listings();
```

This will update all vehicles that have sold `external_listings` but weren't marked as sold in `organization_vehicles`.

## Testing

To test the trigger:

```sql
-- Create a test external listing
INSERT INTO external_listings (
  vehicle_id,
  organization_id,
  platform,
  listing_url,
  listing_status,
  final_price,
  sold_at
) VALUES (
  'your-vehicle-id',
  'your-org-id',
  'bat',
  'https://bringatrailer.com/listing/test',
  'sold',
  50000,
  NOW()
);

-- Check that organization_vehicles was updated
SELECT 
  ov.vehicle_id,
  ov.organization_id,
  ov.listing_status,
  ov.sale_date,
  ov.sale_price
FROM organization_vehicles ov
WHERE ov.vehicle_id = 'your-vehicle-id';
```

## Edge Cases Handled

1. **Already Sold**: If `organization_vehicles` is already marked as sold, it won't be overwritten
2. **Missing Data**: Uses `COALESCE` to handle missing `sold_at`, `final_price`, etc.
3. **Multiple Listings**: If a vehicle has multiple sold listings, uses the most recent one
4. **Partial Updates**: Only updates fields that aren't already set

## Functions

### `auto_mark_vehicle_sold_from_external_listing()`
- Trigger function that runs automatically
- No manual calls needed

### `backfill_sold_status_from_external_listings()`
- Manual function to backfill historical data
- Returns list of updated vehicles
- Safe to run multiple times (idempotent)

## Migration

The trigger was added in migration: `20250125000009_auto_mark_vehicles_sold_from_external_listings.sql`

