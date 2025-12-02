# Image Pipeline Deep Research Report

**Date:** January 2025  
**Scope:** Complete analysis of image upload, processing, attribution, and display pipelines

---

## Executive Summary

The image pipeline has multiple entry points with varying attribution mechanisms. The core issue identified: **Images are sometimes attributed to the person who triggers an extraction/import rather than the actual photographer**. This affects gallery displays and user contribution tracking.

### Key Findings

1. **Multiple Attribution Systems**: Three parallel systems track image ownership:
   - `vehicle_images.user_id` (primary photographer field)
   - `ghost_users` + `device_attributions` (EXIF-based photographer detection)
   - `imported_by` field (tracks who ran automation)

2. **Inconsistent Attribution**: Some import paths correctly use ghost users, others attribute to the importer

3. **Gallery Display Issue**: `PublicImageGallery` filters by vehicle ownership instead of photographer attribution

---

## Image Pipeline Entry Points

### 1. Direct User Upload (`ImageUploadService.uploadImage`)

**Location:** `nuke_frontend/src/services/imageUploadService.ts`

**Flow:**
```
User selects file → Extract EXIF → Compress if needed → Upload to storage → 
Insert into vehicle_images (user_id = authenticated user) → 
Trigger AI analysis → Create device attribution (if EXIF available)
```

**Attribution:**
- ✅ **Correct**: `user_id` = authenticated user (the photographer)
- ✅ **Correct**: Device attribution trigger creates ghost user if EXIF available
- ✅ **Correct**: `uploaded_by_user_id` in device_attributions = same as user_id

**Code Reference:**
```typescript
// Line 330: user_id set to authenticated user
user_id: user.id,

// Lines 384-435: AI analysis triggered automatically
// Lines 191-194: Device attribution trigger fires on INSERT
```

---

### 2. Dropbox Import (`dropbox-sync-images-with-ghost-attribution.js`)

**Location:** `scripts/dropbox-sync-images-with-ghost-attribution.js`

**Flow:**
```
Scan Dropbox folder → Download image → Extract EXIF → 
Generate device fingerprint → Get/create ghost user → 
Upload to storage → Insert with ghost user as user_id
```

**Attribution:**
- ✅ **Correct**: `user_id` = ghost user (photographer from EXIF)
- ✅ **Correct**: `imported_by` = IMPORTER_USER_ID (tracks automation runner)
- ✅ **Correct**: Creates device attribution linking image to ghost user

**Code Reference:**
```javascript
// Line 277: CRITICAL - Attribute to ghost user, NOT importer
user_id: ghostUserId || IMPORTER_USER_ID, // Ghost user if available, fallback to importer
imported_by: IMPORTER_USER_ID, // Track who ran the automation
```

**Status:** ✅ **CORRECTLY IMPLEMENTED** - Uses ghost user attribution

---

### 3. BaT URL Import (`BaTURLDrop.tsx`)

**Location:** `nuke_frontend/src/components/vehicle/BaTURLDrop.tsx`

**Flow:**
```
User pastes BaT URL → Extract images from listing → 
Download each image → Upload to storage → 
Insert with importer as user_id → Create ghost user for unknown photographer
```

**Attribution:**
- ❌ **INCORRECT**: `user_id` = importer (user.id) - Line 164
- ⚠️ **PARTIAL**: Creates ghost user but doesn't use it as `user_id`
- ⚠️ **PARTIAL**: Creates device attribution but with low confidence (50%)

**Code Reference:**
```typescript
// Line 164: WRONG - Should be ghost user, not importer
user_id: user.id, // Importer (Skylar)

// Lines 183-223: Creates ghost user but doesn't use it
// Creates device_attributions but user_id is still wrong
```

**Issue:** Images from BaT listings are attributed to the person who imports them, not the original photographer. The ghost user is created but not used as the primary `user_id`.

**Recommendation:** 
```typescript
// Should be:
user_id: ghostUserId || user.id, // Use ghost user if available
imported_by: user.id, // Track importer separately
```

---

### 4. Apple Upload Function (`apple-upload/index.ts`)

**Location:** `supabase/functions/apple-upload/index.ts`

**Status:** ⚠️ **NEEDS REVIEW** - Not fully examined in this research

**Note:** Two insertion points found (lines 221, 304) - requires deeper analysis

---

### 5. External Listing Scrapers

**Locations:**
- `supabase/functions/parse-bat-to-validations/index.ts` (BaT scraper)
- `supabase/functions/import-classiccars-listing/index.ts` (ClassicCars scraper)
- `nuke_api/lib/nuke_api_web/controllers/scraper_controller.ex` (Elixir scraper)

**Status:** ⚠️ **NEEDS REVIEW** - Attribution logic not fully examined

---

## Attribution Systems

### System 1: Primary `user_id` Field

**Table:** `vehicle_images.user_id`

**Purpose:** Identifies the photographer/creator of the image

**Current Issues:**
- BaT imports set this to importer instead of photographer
- Some extraction scripts may not properly attribute

**Usage:**
- Gallery filtering (should filter by this field)
- Contribution tracking
- Profile displays

---

### System 2: Ghost Users + Device Attribution

**Tables:** `ghost_users`, `device_attributions`

**Purpose:** Track contributions by camera device before user signs up

**Flow:**
1. Image uploaded with EXIF data
2. Trigger `auto_attribute_image_to_device()` extracts device fingerprint
3. Creates/finds ghost user for that device
4. Creates `device_attributions` record linking image to ghost user
5. When photographer signs up and verifies device, `claim_ghost_user()` transfers all contributions

**Status:** ✅ **WORKING CORRECTLY** for images with EXIF data

**Code Reference:**
```sql
-- supabase/migrations/20251102000002_ghost_users_device_attribution.sql
-- Lines 191-194: Trigger fires on every INSERT
CREATE TRIGGER trg_auto_attribute_device
  AFTER INSERT ON vehicle_images
  FOR EACH ROW
  EXECUTE FUNCTION auto_attribute_image_to_device();
```

**Limitation:** Only works for images with EXIF data. External listings (BaT, etc.) often have stripped EXIF.

---

### System 3: `imported_by` Field

**Purpose:** Track who ran automation/import scripts

**Status:** ✅ **CORRECTLY USED** in Dropbox import, ⚠️ **MISSING** in BaT import

**Recommendation:** Add `imported_by` field to all import paths

---

## Gallery Display Issue

### Current Implementation

**File:** `nuke_frontend/src/components/profile/PublicImageGallery.tsx`

**Problem:**
```typescript
// Lines 31-39: Filters by vehicle ownership, not photographer
if (isOwnProfile) {
  query = query.eq('vehicle.user_id', userId);
} else {
  query = query
    .eq('vehicle.user_id', userId)
    .eq('vehicle.is_public', true);
}
```

**Issue:** Shows images from vehicles the user owns, not images the user photographed.

**Example:** User A owns Vehicle X, but User B took all the photos. Gallery shows User B's photos in User A's gallery.

---

### Correct Implementation

**Should filter by:** `vehicle_images.user_id` (the photographer)

**Fix:**
```typescript
// Filter by who took the photo, not vehicle ownership
let query = supabase
  .from('vehicle_images')
  .select(`
    *,
    vehicle:vehicles!vehicle_images_vehicle_id_fkey(id, is_public, user_id, year, make, model)
  `)
  .eq('user_id', userId); // Filter by photographer

// If viewing someone else's profile, only show images from public vehicles
if (!isOwnProfile) {
  query = query.eq('vehicle.is_public', true);
}
```

---

## Image Processing Pipeline

### Upload → Storage → Database → AI Analysis

**Flow:**
1. **File Processing** (ImageUploadService)
   - Validation (type, size)
   - EXIF extraction
   - Compression (if > 5MB)
   - Document detection

2. **Storage Upload**
   - Original to `vehicle-images` bucket
   - Variants generated (thumbnail, medium, large)
   - Public URLs generated

3. **Database Insert**
   - Insert into `vehicle_images` with metadata
   - Trigger fires: `auto_attribute_image_to_device()` (if EXIF available)

4. **AI Analysis** (Automatic, non-blocking)
   - Tier 1: Basic organization (angle, category, quality)
   - Sensitive document detection
   - Full analysis (tagging, parts detection)

**Code Reference:**
```typescript
// Lines 384-498: AI analysis triggered automatically
supabase.functions.invoke('analyze-image-tier1', { ... });
supabase.functions.invoke('detect-sensitive-document', { ... });
supabase.functions.invoke('analyze-image', { ... });
```

---

## Issues Identified

### Critical Issues

1. **BaT Import Attribution** ❌
   - **Location:** `BaTURLDrop.tsx` line 164
   - **Issue:** Sets `user_id` to importer instead of photographer
   - **Impact:** Gallery shows imported images as if user took them
   - **Fix:** Use ghost user as `user_id`, track importer in `imported_by`

2. **Gallery Filtering** ❌
   - **Location:** `PublicImageGallery.tsx` lines 31-39
   - **Issue:** Filters by vehicle ownership, not photographer
   - **Impact:** Users see photos they didn't take in their gallery
   - **Fix:** Filter by `vehicle_images.user_id` instead of `vehicle.user_id`

### Medium Priority Issues

3. **Missing `imported_by` Field** ⚠️
   - **Location:** `BaTURLDrop.tsx`
   - **Issue:** Doesn't track who ran the import
   - **Impact:** Can't distinguish between photographer and importer
   - **Fix:** Add `imported_by: user.id` to insert

4. **External Listing Attribution** ⚠️
   - **Location:** Various scraper functions
   - **Issue:** Not fully reviewed - may have similar attribution problems
   - **Action:** Review all scraper functions for proper attribution

### Low Priority Issues

5. **Apple Upload Function** ⚠️
   - **Location:** `supabase/functions/apple-upload/index.ts`
   - **Issue:** Not fully examined
   - **Action:** Review attribution logic

---

## Recommendations

### Immediate Fixes

1. **Fix PublicImageGallery** ✅
   ```typescript
   // Change from vehicle.user_id to vehicle_images.user_id
   .eq('user_id', userId) // Filter by photographer
   ```

2. **Fix BaT Import Attribution** ✅
   ```typescript
   // Use ghost user as primary user_id
   user_id: ghostUserId || user.id,
   imported_by: user.id, // Track importer
   ```

### Short-term Improvements

3. **Add `imported_by` to All Import Paths**
   - Standardize tracking of automation runners
   - Helps distinguish photographer from importer

4. **Review All Scraper Functions**
   - Ensure consistent attribution across all import methods
   - Document attribution strategy for each

### Long-term Enhancements

5. **Attribution Audit Tool**
   - Query to find images with incorrect attribution
   - Script to retroactively fix attribution (like `fix-dropbox-attribution-retroactive.js`)

6. **Attribution Display**
   - Show both photographer and importer in UI
   - Display ghost user info when photographer unknown

---

## Data Flow Diagrams

### Correct Attribution Flow (Dropbox Import)

```
Dropbox Image
    ↓
Extract EXIF → Device Fingerprint
    ↓
Get/Create Ghost User
    ↓
Upload to Storage
    ↓
Insert vehicle_images {
  user_id: ghostUserId,      ← Photographer
  imported_by: importerId    ← Automation runner
}
    ↓
Trigger: auto_attribute_image_to_device()
    ↓
Create device_attributions {
  ghost_user_id: ghostUserId,
  uploaded_by_user_id: importerId
}
```

### Incorrect Attribution Flow (BaT Import - Current)

```
BaT Listing URL
    ↓
Extract Images
    ↓
Download & Upload to Storage
    ↓
Insert vehicle_images {
  user_id: importerId        ← WRONG: Should be ghost user
  (no imported_by field)     ← MISSING
}
    ↓
Create Ghost User (but don't use it)
    ↓
Create device_attributions {
  ghost_user_id: ghostUserId,
  uploaded_by_user_id: importerId
}
    ↓
Result: Image attributed to importer, not photographer
```

### Correct Attribution Flow (BaT Import - Proposed)

```
BaT Listing URL
    ↓
Extract Images
    ↓
Create Ghost User for Unknown Photographer
    ↓
Download & Upload to Storage
    ↓
Insert vehicle_images {
  user_id: ghostUserId,      ← Photographer (unknown)
  imported_by: importerId    ← Automation runner
}
    ↓
Create device_attributions {
  ghost_user_id: ghostUserId,
  uploaded_by_user_id: importerId,
  confidence_score: 50       ← Low confidence (unknown photographer)
}
```

---

## Database Schema Reference

### vehicle_images Table

**Key Fields:**
- `id` UUID PRIMARY KEY
- `vehicle_id` UUID (nullable - for personal library)
- `user_id` UUID **← PHOTOGRAPHER** (should be photographer, not importer)
- `image_url` TEXT
- `storage_path` TEXT
- `exif_data` JSONB
- `taken_at` TIMESTAMP
- `source` TEXT (e.g., 'user_upload', 'dropbox_import', 'bat_listing')
- `imported_by` UUID (optional - tracks automation runner)

### ghost_users Table

**Key Fields:**
- `id` UUID PRIMARY KEY
- `device_fingerprint` TEXT UNIQUE
- `camera_make` TEXT
- `camera_model` TEXT
- `display_name` TEXT
- `claimed_by_user_id` UUID (set when photographer claims device)

### device_attributions Table

**Key Fields:**
- `id` UUID PRIMARY KEY
- `image_id` UUID
- `device_fingerprint` TEXT
- `ghost_user_id` UUID
- `uploaded_by_user_id` UUID (who uploaded/imported)
- `actual_contributor_id` UUID (set when ghost user is claimed)
- `attribution_source` TEXT
- `confidence_score` INTEGER (0-100)

---

## Testing Recommendations

### Test Cases

1. **Direct Upload**
   - Upload image with EXIF → Verify `user_id` = authenticated user
   - Verify device attribution created
   - Verify gallery shows image

2. **Dropbox Import**
   - Import image with EXIF → Verify `user_id` = ghost user
   - Verify `imported_by` = importer
   - Verify gallery shows image under ghost user

3. **BaT Import** (After Fix)
   - Import BaT listing → Verify `user_id` = ghost user
   - Verify `imported_by` = importer
   - Verify gallery shows image under ghost user

4. **Gallery Filtering**
   - User A owns Vehicle X
   - User B takes photos of Vehicle X
   - Verify User A's gallery does NOT show User B's photos
   - Verify User B's gallery DOES show their photos

---

## Conclusion

The image pipeline has a sophisticated attribution system with ghost users and device fingerprinting, but **inconsistent implementation** across import paths causes incorrect attribution. The primary issues are:

1. BaT imports attribute to importer instead of photographer
2. Gallery filters by vehicle ownership instead of photographer

Fixing these issues will ensure that:
- Users only see photos they actually took in their gallery
- Contribution tracking accurately reflects photographer work
- Ghost user system works consistently across all import methods

---

## Next Steps

1. ✅ Fix `PublicImageGallery.tsx` to filter by `vehicle_images.user_id`
2. ✅ Fix `BaTURLDrop.tsx` to use ghost user as `user_id`
3. ⚠️ Review other scraper/import functions for attribution issues
4. ⚠️ Add `imported_by` field to all import paths
5. ⚠️ Create attribution audit query to find incorrectly attributed images

