# Function Cleanup Plan

## Current State: 292 Edge Functions

**Problem:** Too many functions, many duplicates, none working properly.

## Image Analysis Functions (CONSOLIDATE TO 1)

### Keep:
- `analyze-image` - Make this the ONLY image analysis function

### Delete (duplicates):
- `analyze-image-contextual` - Same logic, different name
- `analyze-image-tier1` - Should be part of analyze-image
- `analyze-image-tier2` - Should be part of analyze-image  
- `backfill-image-angles` - Should call analyze-image
- `ai-tag-image-angles` - Should call analyze-image
- `batch-analyze-images` - Should call analyze-image in batch
- `batch-analyze-all-images` - Duplicate of above

### Fix `analyze-image`:
1. Use `angle_taxonomy` table (not free-form text)
2. Return precise angles only (`exterior.front_three_quarter.driver`, not `exterior_three_quarter`)
3. Map to taxonomy via `angle_aliases` table
4. Store in `image_angle_observations` table (not just `vehicle_images.angle`)

## Angle Taxonomy Fix

**Current broken state:**
- 12,653 images: `exterior_three_quarter` ❌
- Should be: `exterior.front_three_quarter.driver` or `.passenger`

**Solution:**
1. ✅ Populate `angle_taxonomy` table (done)
2. ✅ Create alias mappings (done)
3. ⚠️ Update `analyze-image` to use taxonomy
4. ⚠️ Re-analyze images with weak labels to determine side (driver vs passenger)

## Next Steps

1. **Fix analyze-image function** to use taxonomy
2. **Delete duplicate functions**
3. **Re-analyze 12,653 `exterior_three_quarter` images** to determine driver vs passenger
4. **Update extraction tracking** to use precise angles

