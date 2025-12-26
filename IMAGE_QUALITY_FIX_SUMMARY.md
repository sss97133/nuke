# Image Quality Consistency Fix

## Problem
Major inconsistencies in image quality across the vehicle profile page were causing a poor user experience:
- **VehicleThumbnail**: Used `quality=70` (too compressed, looked blurry)
- **VehicleHeroImage**: Used `quality=85` (better, but inconsistent)
- **ImageOptimizationService**: Used 0.7, 0.75, 0.8 (different scale, inconsistent)

This created a jarring experience where some images looked crisp and others looked heavily compressed.

## Solution

### 1. Created Centralized Quality Config (`nuke_frontend/src/config/imageQuality.ts`)
Standardized quality settings:
- **Thumbnail/Small**: 80% quality (good balance for small images)
- **Medium**: 85% quality (high quality for medium images)
- **Large/Hero**: 90% quality (very high quality for large displays)
- **Full**: 95% quality (near lossless for full resolution)

### 2. Updated Components

#### VehicleThumbnail.tsx
- Changed from `quality=70` to `quality=80` (small) or `quality=85` (medium)
- Small thumbnails: 80% quality
- Medium thumbnails: 85% quality

#### VehicleHeroImage.tsx
- Changed default from `quality=80` to `quality=90`
- Hero images now use `quality=90` consistently
- Ensures hero images are always high quality

#### ImageOptimizationService.ts
- Updated canvas quality from 0.7/0.75/0.8 to 0.8/0.85/0.9
- Aligns with Supabase quality scale (multiply by 100)
- Thumbnail: 0.8 (80%)
- Medium: 0.85 (85%)
- Large: 0.9 (90%)

## Impact

### Before:
- Thumbnails: 70% quality (blurry, compressed)
- Hero images: 85% quality (inconsistent)
- Canvas optimization: 70-80% (too compressed)

### After:
- Thumbnails: 80% quality (sharp, clear)
- Hero images: 90% quality (high quality, consistent)
- Canvas optimization: 80-90% (proper quality)

## Quality Scale Reference

**Supabase Render API**: 0-100 scale
- 70: Noticeable compression, artifacts visible
- 80: Good quality, minimal artifacts (thumbnails)
- 85: High quality, no visible artifacts (medium images)
- 90: Very high quality, near-lossless (large/hero images)
- 95: Near-lossless, maximum quality (full resolution)

**Canvas API**: 0-1 scale (multiply by 100 for Supabase equivalent)
- 0.7 = 70%
- 0.8 = 80%
- 0.85 = 85%
- 0.9 = 90%
- 0.95 = 95%

## Next Steps

1. **Test the changes**: Verify images look consistent across the vehicle profile page
2. **Monitor performance**: Higher quality = larger file sizes, but should still be acceptable
3. **Consider lazy loading**: For very large galleries, consider progressive loading
4. **Future improvements**: Could add responsive quality based on network speed

## Files Changed

1. `nuke_frontend/src/config/imageQuality.ts` (NEW) - Centralized config
2. `nuke_frontend/src/components/VehicleThumbnail.tsx` - Updated quality from 70 to 80/85
3. `nuke_frontend/src/pages/vehicle-profile/VehicleHeroImage.tsx` - Updated quality from 80/85 to 90
4. `nuke_frontend/src/services/imageOptimizationService.ts` - Updated canvas quality from 0.7-0.8 to 0.8-0.9

All changes maintain backward compatibility and improve visual consistency.

