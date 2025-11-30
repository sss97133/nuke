# Remaining Image Pipeline Issues

## ✅ Fixed Issues

1. **PublicImageGallery filtering** - Fixed to filter by photographer (`vehicle_images.user_id`) not vehicle ownership
2. **BaT import attribution** - Fixed to use ghost user as `user_id` instead of importer

---

## ❌ Critical Issues Remaining

### 1. Apple Upload Function Missing `user_id` 

**Location:** `supabase/functions/apple-upload/index.ts`

**Issue:** The function inserts images without `user_id`, causing attribution failures.

**Lines 221-227 and 304-309:**
```typescript
// MISSING user_id!
await supabase.from('vehicle_images').insert({
  vehicle_id: vehicleId,
  image_url: pub.publicUrl,
  is_primary: false,
  process_stage: stage || null,
  taken_at: item.exifDate ? item.exifDate.toISOString() : null
  // ❌ user_id is missing!
})
```

**Impact:**
- Images uploaded via Apple Shortcut/macOS helper will fail database insert (if `user_id` is NOT NULL constraint)
- OR images will be inserted with NULL user_id, breaking attribution and gallery display
- Device attribution trigger won't fire properly (relies on user_id)

**Fix Required:**
1. Get authenticated user from request
2. Extract EXIF data from images
3. Create/find ghost user from EXIF device fingerprint
4. Use ghost user (or authenticated user if no EXIF) as `user_id`
5. Store EXIF data in `exif_data` field to trigger device attribution

**Code Reference:**
```typescript
// Current (WRONG):
await supabase.from('vehicle_images').insert({
  vehicle_id: vehicleId,
  image_url: pub.publicUrl,
  // Missing user_id, exif_data
})

// Should be:
// 1. Get user from auth
const { data: { user } } = await supabase.auth.getUser()

// 2. Extract EXIF and create ghost user (similar to dropbox import)
const exifData = await extractExifFromFile(item.file)
const ghostUserId = await getOrCreateGhostUserFromExif(exifData)

// 3. Insert with proper attribution
await supabase.from('vehicle_images').insert({
  vehicle_id: vehicleId,
  user_id: ghostUserId || user.id, // Ghost user if EXIF available
  image_url: pub.publicUrl,
  exif_data: exifData, // Required for device attribution trigger
  taken_at: item.exifDate ? item.exifDate.toISOString() : null,
  source: 'apple_upload'
})
```

---

## ⚠️ Medium Priority Issues

### 2. Missing `source` Field in Apple Upload

**Location:** `supabase/functions/apple-upload/index.ts`

**Issue:** Images inserted without `source` field, making it hard to track upload method.

**Fix:** Add `source: 'apple_upload'` to insert statements.

---

### 3. Missing `imported_by` Field Standardization

**Status:** The `imported_by` field may not exist in the schema for all imports.

**Action Needed:**
- Verify if `imported_by` column exists in `vehicle_images` table
- If not, create migration to add it
- Add to all import paths (BaT, Dropbox, Apple, scrapers)

**Current Status:**
- ✅ Dropbox import uses `imported_by` (but may fail if column doesn't exist)
- ✅ BaT import stores in `exif_data.imported_by_user_id` (not standardized)
- ❌ Apple upload doesn't track importer

---

### 4. Other Scraper Functions Need Review

**Locations:**
- `supabase/functions/parse-bat-to-validations/index.ts` (BaT scraper - doesn't insert images directly)
- `supabase/functions/import-classiccars-listing/index.ts` (ClassicCars scraper)
- `nuke_api/lib/nuke_api_web/controllers/scraper_controller.ex` (Elixir scraper)

**Action:** Review each for proper attribution when inserting images.

---

## 📋 Testing Checklist

After fixes are applied, test:

1. **Apple Upload**
   - [ ] Upload via iOS Shortcut
   - [ ] Verify `user_id` is set (not NULL)
   - [ ] Verify `exif_data` is stored
   - [ ] Verify device attribution created
   - [ ] Verify gallery shows images under correct user

2. **BaT Import** (Fixed)
   - [ ] Import BaT listing
   - [ ] Verify `user_id` = ghost user (not importer)
   - [ ] Verify device attribution created
   - [ ] Verify gallery shows images under ghost user

3. **Gallery Display** (Fixed)
   - [ ] User A owns Vehicle X
   - [ ] User B takes photos of Vehicle X
   - [ ] Verify User A's gallery does NOT show User B's photos
   - [ ] Verify User B's gallery DOES show their photos

4. **Dropbox Import** (Already Working)
   - [ ] Verify continues to work correctly
   - [ ] Verify ghost user attribution

---

## 🎯 Priority Order

1. **URGENT**: Fix Apple Upload `user_id` issue (breaks attribution entirely)
2. **HIGH**: Add `source` field to Apple Upload
3. **MEDIUM**: Standardize `imported_by` field across all imports
4. **LOW**: Review other scraper functions

---

## 💡 Implementation Notes

### Apple Upload Fix Strategy

The Apple upload function currently:
- Extracts EXIF dates for grouping
- Creates timeline events
- Uploads images to storage
- Inserts into `vehicle_images` (but missing `user_id`)

**Recommended approach:**
1. Extract full EXIF data (not just date) from each image
2. Generate device fingerprint from EXIF
3. Create/find ghost user BEFORE inserting image
4. Insert image with ghost user as `user_id`
5. Device attribution trigger will fire automatically

**Code pattern to follow:**
See `scripts/dropbox-sync-images-with-ghost-attribution.js` for reference implementation.

