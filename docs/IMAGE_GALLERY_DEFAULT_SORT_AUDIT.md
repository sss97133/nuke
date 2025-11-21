# Image Gallery Default Sort Audit

**Date:** November 17, 2025  
**Vehicle ID:** `5f6cc95c-9c1e-4a45-8371-40312c253abb`  
**Total Images:** 116

## Current State Analysis

### Database Status
- ✅ **116 images** have angle classifications in `ai_angle_classifications_audit`
- ❌ **0 images** have angle links in `vehicle_image_angles` table
- ❌ **0 images** have mapped angles from `image_coverage_angles`

### Code Default Setting
```typescript
const [sortBy, setSortBy] = useState<'hierarchy' | 'date' | 'angle' | 'confidence' | 'coverage'>('hierarchy');
```
**Default:** `'hierarchy'` (line 92)

### Screenshot Observation
The gallery UI shows:
- **Sort dropdown:** "Date" (not "hierarchy")
- **Display:** Flat grid organized by angle categories (INTERIOR, DETAIL)
- **Images shown:** 4 thumbnails with angle badges and part tags

## Root Cause Analysis

### Problem 1: Missing Angle Links
The `imageDisplayPriority.ts` service requires images to have an `angles` array populated from the `vehicle_image_angles` table. However:

```typescript
// From imageDisplayPriority.ts line 84
if (image.angles && image.angles.length > 0) {
  // Calculate priority based on angles
  const highestAnglePriority = Math.max(...image.angles.map(angle => {
    const basePriority = ESSENTIAL_ANGLE_PRIORITY[angle.angle_name] || 0;
    // ...
  }));
  score += highestAnglePriority;
}
```

**Current State:**
- Images have classifications in `ai_angle_classifications_audit` ✅
- Images do NOT have links in `vehicle_image_angles` ❌
- Therefore, `image.angles` is always `undefined` or empty
- Priority scores default to 0 (no angle bonus)
- `groupImagesByTier()` returns empty tiers

### Problem 2: Fallback View Triggered
When tiers are empty, the code falls back to angle category view:

```typescript
// Line 1004
{viewMode === 'grid' && (sortBy !== 'hierarchy' || (imageTiers.heroShots.length === 0 && imageTiers.supporting.length === 0)) && (
  // Fallback: Show organized by angle category
)}
```

**Current Behavior:**
- `sortBy === 'hierarchy'` ✅ (default)
- `imageTiers.heroShots.length === 0` ✅ (no angles = no priority = empty tiers)
- **Result:** Fallback view renders (angle category organization)

### Problem 3: Sort Dropdown Mismatch
The sort dropdown shows "Date" but code default is "hierarchy". Possible causes:
1. User manually changed it
2. State was reset/overwritten
3. Dropdown value binding issue

## Expected vs Actual Behavior

### Expected (Hierarchy Sort)
When `sortBy === 'hierarchy'` AND tiers are populated:
- **Tier 1:** Hero shots (priority ≥ 50) - Large lead image + grid
- **Tier 2:** Supporting angles (priority 10-49) - Medium grid
- **Tier 3:** Historical docs (priority 0-9) - Small grid
- **Tier 4:** Work docs (priority < 0) - Collapsed

### Actual (Fallback View)
- Flat grid organized by angle categories
- No tier structure
- Sort dropdown shows "Date" (mismatch)

## Data Flow Issue

```
1. loadImages() loads images from vehicle_images
2. Loads classifications from ai_angle_classifications_audit ✅
3. Loads angle links from vehicle_image_angles ❌ (EMPTY)
4. Builds angles array for priority calculation ❌ (EMPTY)
5. calculatePriorityScore() returns 0 (no angle bonus)
6. groupImagesByTier() returns empty tiers
7. Fallback view renders (angle category organization)
```

## Solution

### Immediate Fix: Populate `vehicle_image_angles` Table
The `backfill-image-angles` function should be creating links in `vehicle_image_angles`, but it's not. Need to:

1. **Check backfill function:** Verify it's creating `vehicle_image_angles` records
2. **Run backfill:** Ensure all images have angle links created
3. **Verify mapping:** Check that `ai_angle_classifications_audit` → `vehicle_image_angles` → `image_coverage_angles` chain works

### Code Fix: Handle Missing Angles Gracefully
If angles are missing, the hierarchy view should still work using `ai_angle_classifications_audit` data directly:

```typescript
// In loadImages(), build angles array from classifications if vehicle_image_angles is empty
const angles = angleLinks.length > 0 
  ? angleLinks.map(link => ({
      angle_name: link.angle_name,
      confidence_score: link.confidence || classification?.confidence || 0,
      // ...
    }))
  : classification ? [{
      angle_name: classification.primary_label,
      confidence_score: classification.confidence || 0,
      // Map angle_family to angle_name for priority lookup
    }] : [];
```

### UI Fix: Ensure Sort Dropdown Reflects State
Verify the dropdown is properly bound and shows the correct default:

```typescript
<select
  value={sortBy}
  onChange={(e) => setSortBy(e.target.value as any)}
>
  <option value="hierarchy">Best First</option>
  <option value="date">Date</option>
  <option value="angle">Angle</option>
  <option value="confidence">Confidence</option>
  <option value="coverage">Coverage</option>
</select>
```

## Recommendations

1. **Fix Data Pipeline:** Ensure `backfill-image-angles` creates `vehicle_image_angles` records
2. **Add Fallback Logic:** Use `ai_angle_classifications_audit` directly if `vehicle_image_angles` is empty
3. **Debug Logging:** Add console logs to track tier population and sort state
4. **Visual Indicator:** Show which sort mode is active in the UI
5. **Test Hierarchy View:** Once angles are populated, verify tier structure renders correctly

## Next Steps

1. Check why `vehicle_image_angles` table is empty for this vehicle
2. Run backfill to populate angle links
3. Verify hierarchy view renders correctly after data is populated
4. Add fallback logic to use classifications directly if links are missing
