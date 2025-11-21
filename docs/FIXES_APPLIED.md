# Classification Fixes Applied

## Issues Found

1. **Massive Duplicate Classifications**: Images being processed 200+ times
2. **Mapping Failures**: Images not being inserted into `vehicle_image_angles`
3. **Infinite Re-processing**: Script only checked `vehicle_image_angles`, not audit entries

## Fixes Applied

### 1. Enhanced Skip Logic ✅
- Now checks BOTH `vehicle_image_angles` AND `ai_angle_classifications_audit`
- Skips images processed in last 24 hours to prevent duplicates
- Prevents re-processing same images

### 2. Fixed Mapping Insert ✅
- Changed from check-then-insert to direct upsert
- Uses `onConflict: 'image_id,angle_id'` to handle duplicates gracefully
- Includes all required fields (confidence_score, tagged_by, perspective_type, etc.)

### 3. Per-Image Skip Check ✅
- Added check in `processImage` function to skip recently processed images
- Prevents duplicate API calls even if image slips through initial filter

## Expected Results

- **No more duplicates**: Images processed once per 24 hours max
- **Better mapping**: Images successfully inserted into `vehicle_image_angles`
- **Faster processing**: Only processes truly unprocessed images
- **Cost savings**: No wasted API calls on duplicates

## Monitoring

Watch for:
- Decreasing "Skipped" counts (should increase as more images are processed)
- Increasing `vehicle_image_angles` entries
- No images with 200+ classifications

