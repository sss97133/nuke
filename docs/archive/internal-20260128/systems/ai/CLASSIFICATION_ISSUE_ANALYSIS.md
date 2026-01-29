# Classification Issue Analysis

## Critical Problems Found

### 1. **Massive Duplicate Classifications** 🔴
- Some images have been classified **200+ times**
- Example: `fa16a685-4fed-4ac4-85d1-f12c5e570857` has **206 classifications**
- This is causing:
  - Waste of API calls ($$$)
  - Database bloat
  - Inflated "processed" counts

### 2. **Mapping Step Failing** 🔴
- **294 images** have audit entries (`ai_angle_classifications_audit`)
- **Only 40 images** are mapped to angles (`vehicle_image_angles`)
- **0 images** are in both (meaning mapping is completely broken)
- This causes infinite re-processing because:
  - Script checks `vehicle_image_angles` to skip images
  - But images never get added there
  - So they get re-processed forever

### 3. **Check Logic Issue** 🟡
- Script filters images by checking `vehicle_image_angles`
- But should also check `ai_angle_classifications_audit` to avoid duplicates
- Currently: Only checks if image is in `vehicle_image_angles`
- Result: Images with audit entries but no mapping get re-processed

## Root Cause

The `mapClassificationToAngleId` function is likely:
1. Returning `null` for most classifications
2. Not matching angle_family values to angle_name in `image_coverage_angles`
3. Causing the mapping step to fail silently

## Impact

- **API Costs**: Processing same images 200+ times = wasted money
- **Processing Speed**: Re-processing same images instead of new ones
- **Data Quality**: Multiple conflicting classifications per image
- **Progress Tracking**: Inflated "processed" counts don't reflect reality

## Solution Needed

1. **Fix mapping logic** to successfully map classifications to angles
2. **Update skip logic** to check `ai_angle_classifications_audit` as well
3. **Add deduplication** to prevent re-processing images with recent audit entries
4. **Clean up duplicates** in existing audit table

