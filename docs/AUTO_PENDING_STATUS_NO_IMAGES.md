# Auto-Pending Status for Vehicles Without Images

## Overview

This system automatically sets vehicle status to `'pending'` when vehicles are created or updated without images. This is especially useful for BAT (Bring a Trailer) listings that are imported before images are available.

## How It Works

### Database Triggers

Three triggers automatically manage vehicle status:

1. **After Vehicle Insert**: When a new vehicle is created, checks if it has images
2. **After Image Insert**: When an image is added, activates the vehicle (sets status to `'active'`)
3. **After Image Delete**: When all images are deleted, sets status back to `'pending'`

### Status Logic

- **No Images + Status is `'active'`, `'draft'`, or `NULL`** → Set to `'pending'`
- **Has Images + Status is `'pending'`** → Set to `'active'`
- **Status is `'archived'` or `'inactive'`** → Never auto-changed

### Personal Photo Library

The system correctly handles personal photo library images (where `vehicle_id` is NULL) by skipping them.

## Migration

The migration file `supabase/migrations/20250125000017_auto_pending_status_no_images.sql` contains:

- `update_vehicle_status_by_images(UUID)` - Helper function to check and update status
- `check_vehicle_images_on_insert()` - Trigger function for vehicle creation
- `check_vehicle_images_on_image_insert()` - Trigger function for image addition
- `check_vehicle_images_on_image_delete()` - Trigger function for image deletion
- `fix_vehicles_without_images()` - Manual function to fix existing vehicles

## Usage

### Automatic (Recommended)

Once the migration is applied, the system works automatically:

1. BAT listings imported without images → Automatically set to `'pending'`
2. User adds first image → Automatically set to `'active'`
3. User deletes all images → Automatically set back to `'pending'`

### Manual Fix for Existing Vehicles

To fix existing vehicles without images:

```sql
-- Fix all vehicles without images
SELECT * FROM fix_vehicles_without_images();

-- Or fix specific vehicles
UPDATE vehicles
SET status = 'pending', updated_at = NOW()
WHERE id IN ('vehicle-id-1', 'vehicle-id-2')
AND NOT EXISTS (
  SELECT 1 FROM vehicle_images WHERE vehicle_id = vehicles.id
)
AND status != 'pending';
```

## Benefits

1. **BAT Listings**: Automatically marked as pending until images are imported
2. **User Experience**: Clear status indication (pending = needs images)
3. **Data Quality**: Prevents incomplete vehicle profiles from showing as active
4. **Automatic Recovery**: When images are added, status automatically updates

## Testing

After applying the migration:

1. Create a vehicle without images → Should be `'pending'`
2. Add an image → Should become `'active'`
3. Delete all images → Should become `'pending'` again
4. Create BAT listing → Should be `'pending'` until images imported

