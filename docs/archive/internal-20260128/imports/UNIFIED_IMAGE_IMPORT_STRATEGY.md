# Unified Image Import Strategy

## Problem Statement

We have **20+ redundant scripts and import methods**, each with incomplete implementations:
- ❌ Different attribution logic in each
- ❌ Missing fields in some
- ❌ Inconsistent ghost user handling
- ❌ No single source of truth

**Result:** Technical debt, bugs, and inconsistent data.

## Solution: ONE Unified Service

Create **ONE** image import/upload service that ALL entry points use.

---

## Architecture

### Core Service: `UnifiedImageImportService`

**Location:** `nuke_frontend/src/services/unifiedImageImportService.ts`

**Responsibilities:**
1. ✅ **Attribution** - Handles user_id, ghost users, device attribution correctly
2. ✅ **Storage** - Uploads to correct bucket with proper paths
3. ✅ **Database** - Inserts with all required fields
4. ✅ **EXIF** - Extracts and stores metadata
5. ✅ **Variants** - Generates optimized image sizes
6. ✅ **AI Analysis** - Triggers analysis functions
7. ✅ **Timeline Events** - Optionally creates timeline entries

**Single Source of Truth** - Fix attribution once, works everywhere.

---

## Current Entry Points (All Use Unified Service)

### Frontend Entry Points

1. **Direct User Upload**
   - `ImageUploadService.uploadImage()` → **Use Unified Service**
   - `VehicleImageViewer` inline upload → **Use Unified Service**
   - `AddEventWizard` upload → **Use Unified Service**

2. **BaT Import**
   - `BaTURLDrop.tsx` → **Use Unified Service**
   
3. **Dropbox Import**
   - `DealerDropboxImport.tsx` → **Use Unified Service**
   - `scripts/dropbox-sync-images-with-ghost-attribution.js` → **Use Unified Service**

4. **Apple Upload**
   - `supabase/functions/apple-upload/index.ts` → **Use Unified Service**

5. **External Scrapers**
   - `scripts/import-blazer-images.js` → **Use Unified Service**
   - `scripts/import-bat-images-and-tag.js` → **Use Unified Service**
   - All other import scripts → **Use Unified Service**

---

## Unified Service API

```typescript
interface ImageImportOptions {
  // Required
  file: File | Blob | Buffer;
  vehicleId?: string; // null = personal library
  
  // Attribution (automatically handled)
  userId?: string; // If provided, use this. Otherwise extract from auth/EXIF
  importedBy?: string; // Who ran the import (for automated imports)
  
  // Metadata
  category?: string;
  takenAt?: Date | string;
  source?: 'user_upload' | 'dropbox_import' | 'bat_listing' | 'apple_upload' | 'scraper';
  sourceUrl?: string; // Original URL if scraped
  
  // Options
  createTimelineEvent?: boolean;
  makePrimary?: boolean;
  stage?: string;
  
  // EXIF override (if already extracted)
  exifData?: any;
}

interface ImageImportResult {
  success: boolean;
  imageId?: string;
  imageUrl?: string;
  ghostUserId?: string; // If created/used
  error?: string;
}

class UnifiedImageImportService {
  static async importImage(options: ImageImportOptions): Promise<ImageImportResult>
}
```

---

## Implementation Steps

### Phase 1: Create Unified Service

1. **Create `unifiedImageImportService.ts`**
   - Extract correct logic from `ImageUploadService`
   - Add ghost user attribution (from dropbox-sync script)
   - Add BaT ghost user creation (from BaTURLDrop)
   - Handle all attribution scenarios correctly

2. **Key Logic:**
   ```typescript
   async importImage(options) {
     // 1. Extract EXIF from file
     const exifData = await extractEXIF(options.file);
     
     // 2. Determine photographer (user_id)
     let photographerId = options.userId;
     
     if (!photographerId) {
       // Try to get from auth
       const { data: { user } } = await supabase.auth.getUser();
       photographerId = user?.id;
     }
     
     // 3. Check if EXIF suggests different photographer (ghost user)
     if (exifData && !options.userId) {
       const deviceFingerprint = generateDeviceFingerprint(exifData);
       const ghostUser = await getOrCreateGhostUser(deviceFingerprint, exifData);
       
       if (ghostUser) {
         photographerId = ghostUser.id; // Use ghost user as photographer
       }
     }
     
     // 4. Upload to storage
     const uploadResult = await uploadToStorage(...);
     
     // 5. Generate variants
     const variants = await generateVariants(...);
     
     // 6. Insert into database with ALL correct fields
     const insertResult = await supabase
       .from('vehicle_images')
       .insert({
         vehicle_id: options.vehicleId || null,
         user_id: photographerId, // Photographer (ghost user or real user)
         imported_by: options.importedBy || null, // Who ran import
         image_url: uploadResult.url,
         storage_path: uploadResult.path,
         category: options.category || 'general',
         source: options.source || 'user_upload',
         source_url: options.sourceUrl || null,
         taken_at: options.takenAt || exifData?.dateTaken || new Date(),
         exif_data: exifData,
         variants: variants,
         // ... all other required fields
       });
     
     // 7. Create device attribution (triggers automatically, but ensure it happens)
     if (exifData && ghostUser) {
       await createDeviceAttribution(imageId, ghostUser.id, options.importedBy);
     }
     
     // 8. Trigger AI analysis
     await triggerAIAnalysis(imageId, uploadResult.url);
     
     // 9. Create timeline event (if requested)
     if (options.createTimelineEvent) {
       await createTimelineEvent(...);
     }
     
     return { success: true, imageId, imageUrl: uploadResult.url };
   }
   ```

### Phase 2: Migrate Entry Points

**Order of Migration:**

1. ✅ **ImageUploadService** - Already mostly correct, wrap in unified service
2. ✅ **BaTURLDrop** - Replace inline logic with unified service
3. ✅ **DealerDropboxImport** - Replace inline logic with unified service
4. ✅ **Apple Upload Function** - Replace inline logic with unified service
5. ✅ **All Import Scripts** - Replace with unified service calls

### Phase 3: Delete Redundant Code

**Files to Delete:**
- `scripts/dropbox-sync-images-with-ghost-attribution.js` (replaced)
- `scripts/import-blazer-images.js` (replaced)
- `scripts/import-bat-images-and-tag.js` (replaced)
- All other redundant import scripts

**Files to Update:**
- `ImageUploadService.ts` - Thin wrapper around unified service
- `BaTURLDrop.tsx` - Use unified service
- `DealerDropboxImport.tsx` - Use unified service
- `apple-upload/index.ts` - Use unified service
- All other import entry points

---

## Benefits

1. ✅ **Single Source of Truth** - Fix attribution once, works everywhere
2. ✅ **Consistency** - All imports use same logic
3. ✅ **Maintainability** - One place to update
4. ✅ **Testing** - Test one service, not 20 scripts
5. ✅ **Less Code** - Delete 15+ redundant scripts

---

## Migration Checklist

- [ ] Create `unifiedImageImportService.ts`
- [ ] Implement attribution logic (ghost users, device fingerprinting)
- [ ] Implement storage upload
- [ ] Implement database insert with all fields
- [ ] Implement EXIF extraction
- [ ] Implement variant generation
- [ ] Implement AI analysis triggers
- [ ] Migrate `ImageUploadService` to use unified service
- [ ] Migrate `BaTURLDrop` to use unified service
- [ ] Migrate `DealerDropboxImport` to use unified service
- [ ] Migrate `apple-upload` function to use unified service
- [ ] Migrate all import scripts to use unified service
- [ ] Delete redundant scripts
- [ ] Update documentation
- [ ] Test all entry points

---

## Example: Before vs After

### Before (BaT Import - Inline Logic)
```typescript
// BaTURLDrop.tsx - 70+ lines of inline attribution logic
const ghostUser = await createGhostUser(...);
await supabase.from('vehicle_images').insert({
  user_id: ghostUserId,
  // ... inconsistent fields
});
```

### After (Using Unified Service)
```typescript
// BaTURLDrop.tsx - 5 lines
const result = await UnifiedImageImportService.importImage({
  file: imageBlob,
  vehicleId: vehicleId,
  source: 'bat_listing',
  sourceUrl: imageUrl,
  importedBy: user.id,
  takenAt: preview.sold_date
});
```

---

## Next Steps

1. **Create the unified service** - Extract and consolidate all correct logic
2. **Start migrating entry points** - One at a time
3. **Delete redundant scripts** - After migration complete
4. **Document the service** - Clear API docs

**Goal:** ONE service, ALL imports use it, NO redundant scripts.

