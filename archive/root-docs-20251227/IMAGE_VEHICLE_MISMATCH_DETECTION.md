# Image-Vehicle Mismatch Detection System

## Problem
Images are sometimes incorrectly associated with vehicles. For example, a 1974 FORD Bronco profile might have images of a different vehicle mixed in.

## Solution
Automated detection system that:
1. **Validates images** using AI (validate-bat-image function)
2. **Auto-detects mismatches** when validation indicates wrong vehicle
3. **Suggests correct vehicle** based on detected vehicle data
4. **Tracks resolution** (moved, removed, confirmed correct)

---

## How It Works

### 1. **AI Validation**
When images are analyzed, the `validate-bat-image` function checks if the image matches the expected vehicle:
- Detects vehicle in image (year, make, model)
- Compares to expected vehicle
- Returns confidence score and mismatch reason

### 2. **Auto-Detection Trigger**
When validation data is added to `vehicle_images.ai_scan_metadata`:
- Trigger `trg_detect_image_mismatches` fires
- If `matches_vehicle = false`, creates mismatch record
- Stores detected vs expected vehicle data

### 3. **Mismatch Tracking**
`image_vehicle_mismatches` table tracks:
- Current vehicle (where image is now)
- Detected vehicle (what AI sees in image)
- Suggested vehicle (if found in database)
- Resolution status (resolved/unresolved)

### 4. **Suggested Vehicle**
`find_suggested_vehicle_for_mismatch()` function:
- Searches for vehicle matching detected data
- Allows 2-year variance
- Updates mismatch with suggestion

---

## Usage

### Validate Images for a Vehicle
```bash
node scripts/validate-vehicle-images.js eea40748-cdc1-4ae9-ade1-4431d14a7726
```

This will:
1. Get all images for the vehicle
2. Call `validate-bat-image` for each unvalidated image
3. Show results (matches/mismatches)
4. Display detected mismatches with suggestions

### View Active Mismatches
```sql
SELECT * FROM active_image_mismatches
WHERE current_vehicle_id = 'eea40748-cdc1-4ae9-ade1-4431d14a7726';
```

### Resolve a Mismatch
```sql
-- Move image to suggested vehicle
UPDATE vehicle_images
SET vehicle_id = (
  SELECT suggested_vehicle_id 
  FROM image_vehicle_mismatches 
  WHERE image_id = 'IMAGE_ID'
)
WHERE id = 'IMAGE_ID';

-- Mark mismatch as resolved
UPDATE image_vehicle_mismatches
SET resolved = true,
    resolved_at = NOW(),
    resolved_by = auth.uid(),
    resolution_action = 'moved_to_correct_vehicle',
    resolution_notes = 'Moved to suggested vehicle'
WHERE image_id = 'IMAGE_ID';
```

---

## Tables

### `image_vehicle_mismatches`
- Tracks all detected mismatches
- Links to current vehicle and suggested vehicle
- Stores validation results and resolution

### `active_image_mismatches` (View)
- Shows unresolved mismatches
- Includes detected vehicle and suggestions
- Sorted by confidence score

---

## Next Steps

1. **Run validation** on the 1974 FORD Bronco:
   ```bash
   node scripts/validate-vehicle-images.js eea40748-cdc1-4ae9-ade1-4431d14a7726
   ```

2. **Review mismatches** in the database:
   ```sql
   SELECT * FROM active_image_mismatches;
   ```

3. **Resolve mismatches** by:
   - Moving images to correct vehicle
   - Removing images that don't belong
   - Confirming if AI was wrong

4. **Bulk validation** for all vehicles (future enhancement)

---

## Status: ✅ READY

The system is in place and ready to detect mismatches. Run validation on the vehicle to identify which images don't match!

