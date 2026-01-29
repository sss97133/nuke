# Image Contamination Prevention

## Problem
Images from one vehicle were being incorrectly associated with other vehicles, causing:
- Homepage cards showing wrong vehicle images
- Profile pages displaying incorrect galleries
- BAT images not being properly imported
- Primary images pointing to wrong vehicles

## Root Causes
1. **No validation before association**: Images were inserted into `vehicle_images` without checking if they already belonged to another vehicle
2. **BAT images not backfilled**: Canonical URLs stored in `origin_metadata.image_urls` weren't being imported to `vehicle_images` table
3. **Primary image mismatch**: `primary_image_url` could point to images from other vehicles
4. **URL matching issues**: Images could be matched to wrong vehicles during bulk imports

## Solutions Implemented

### 1. Validation in `backfill-images` Function
Added validation checks before inserting images:
- **Cross-vehicle check**: Verifies image URL doesn't already exist for another vehicle
- **BAT canonical validation**: For BAT imports, verifies images match the vehicle's canonical gallery
- **Warning logging**: Logs warnings for suspicious associations

**Location**: `supabase/functions/backfill-images/index.ts`

### 2. Comprehensive Fix Script
`scripts/comprehensive-image-fix.js`:
- Detects cross-vehicle contamination
- Backfills missing BAT canonical images
- Runs repair RPC to fix gallery ordering
- Sets correct primary images
- Verifies final state

### 3. Prevention Script
`scripts/prevent-image-contamination.js`:
- Detects duplicate image URLs across vehicles
- Validates BAT images match vehicle listings
- Checks primary images belong to correct vehicles
- Can be run as cron job for early detection

### 4. Diagnostic Tools
- `scripts/diagnose-vehicle-mismatch.js`: Diagnoses specific vehicle issues
- `scripts/fix-vehicle-bat-images.js`: Fixes BAT image imports
- `scripts/fix-vehicle-primary-image.js`: Fixes primary image issues

## Usage

### Fix a specific vehicle:
```bash
node scripts/comprehensive-image-fix.js <vehicle_id>
```

### Run prevention check:
```bash
node scripts/prevent-image-contamination.js
```

### Diagnose a vehicle:
```bash
node scripts/diagnose-vehicle-mismatch.js <vehicle_id>
```

## Prevention Best Practices

1. **Always validate before insert**: The `backfill-images` function now validates images don't belong to other vehicles
2. **Use canonical URLs**: For BAT imports, always use `origin_metadata.image_urls` as the source of truth
3. **Run repair RPC**: After importing BAT images, run `repair_bat_vehicle_gallery_images` to fix ordering
4. **Monitor regularly**: Run the prevention script daily to catch issues early
5. **Verify primary images**: After imports, verify primary images match the vehicle

## Database Constraints

Consider adding:
- Unique constraint on `(vehicle_id, image_url)` to prevent duplicates
- Trigger to validate images match vehicle before insert
- Index on `image_url` for faster cross-vehicle checks

## Related Functions

- `repair_bat_vehicle_gallery_images`: Fixes BAT gallery ordering and contamination
- `get_vehicle_profile_data`: Returns vehicle data with filtered images (excludes duplicates/documents)
- `backfill-images`: Imports images with validation checks

