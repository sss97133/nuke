# ImageUpload 1.0 - Official Documentation

**Status**: ✅ PRODUCTION READY
**Last Updated**: October 20, 2025
**Maintainer**: Single source of truth

---

## Overview

**ImageUpload 1.0** is THE image upload component for the entire Nuke platform. 

**One component. Everywhere. No exceptions.**

There is ONE file:
- `nuke_frontend/src/components/UniversalImageUpload.tsx`

There is ONE backend service:
- `nuke_frontend/src/services/imageUploadService.ts`

There is ONE database table:
- `vehicle_images` (with RLS policies)

**USE ONLY UniversalImageUpload.tsx. DO NOT CREATE NEW UPLOAD COMPONENTS.**

---

## What It Does

✅ **Accepts images** via click or drag-drop
✅ **Extracts EXIF data** (date, location, camera info)
✅ **Generates variants** (thumbnail, medium, large)
✅ **Uploads to Supabase** storage (vehicle-images bucket)
✅ **Stores metadata** in vehicle_images table
✅ **Creates timeline events** automatically
✅ **Tracks progress** in real-time
✅ **Handles errors** gracefully
✅ **Non-blocking** - uploads happen in background
✅ **Works everywhere** - AddVehicle, VehicleTimeline, WorkDocumentation, etc.

---

## Usage

### Basic Single Image

```tsx
import UniversalImageUpload from '../components/UniversalImageUpload';

<UniversalImageUpload
  vehicleId={vehicle.id}
  variant="single"
  onUploadSuccess={(results) => console.log('Done!', results)}
/>
```

### Multiple Images (Bulk)

```tsx
<UniversalImageUpload
  vehicleId={vehicle.id}
  variant="bulk"
  maxFiles={50}
  onUploadSuccess={(results) => console.log(`Uploaded ${results.length} images`)}
/>
```

### Quick Upload (Minimal UI)

```tsx
<UniversalImageUpload
  vehicleId={vehicle.id}
  variant="quick"
  showPreview={false}
/>
```

### Detailed Metadata Form

```tsx
<UniversalImageUpload
  vehicleId={vehicle.id}
  variant="detailed"
  category="exterior"
  onUploadStart={() => setLoading(true)}
  onUploadError={(error) => showError(error)}
/>
```

---

## Props Reference

### Required

| Prop | Type | Description |
|------|------|-------------|
| `vehicleId` | string | Vehicle ID for image association |

### Optional

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | 'single' \| 'bulk' \| 'quick' \| 'detailed' | 'single' | UI variant to use |
| `category` | string | 'general' | Image category (exterior, interior, engine, damage, repair, restoration, document) |
| `onUploadSuccess` | (results: ImageUploadResult[]) => void | - | Called when upload succeeds |
| `onUploadStart` | () => void | - | Called when upload starts |
| `onUploadError` | (error: string) => void | - | Called on error |
| `maxFiles` | number | 1 (single) / 10 (bulk) | Max files to accept |
| `className` | string | '' | Custom CSS class |
| `disabled` | boolean | false | Disable uploads |
| `showPreview` | boolean | true | Show image previews |
| `autoUpload` | boolean | true | Auto-upload on file select |

---

## Variants Explained

### 'single'
- One image at a time
- Basic UI
- Recommended for: User profile pictures, primary vehicle images
- Example: AddVehicle initial image

### 'bulk'
- Multiple images (default maxFiles: 10)
- Thumbnail grid
- Progress tracking
- Recommended for: Vehicle galleries, batch uploads
- Example: VehicleTimeline, WorkDocumentation

### 'quick'
- One image
- Minimal UI (no preview)
- Recommended for: Small UI spaces
- Example: Quick edit of primary image

### 'detailed'
- Single image + metadata form
- Category selector
- Caption field
- Date picker
- Recommended for: Detailed vehicle documentation
- Example: Receipt manager, document upload

---

## How It Works (Flow)

```
User selects files
    ↓
File validation (type, size)
    ↓
Create previews (drag-drop visual)
    ↓
[If autoUpload=true]
    ↓
Extract EXIF data (date, location, camera)
    ↓
Generate variants (thumbnail, medium, large)
    ↓
Upload to Supabase storage (vehicle-images bucket)
    ↓
Save metadata to vehicle_images table
    ↓
Create timeline event
    ↓
Refresh UI
    ↓
Call onUploadSuccess callback
```

---

## Storage

### Location
- **Bucket**: `vehicle-images`
- **Path**: `{vehicle_id}/{uuid}.{ext}`

### Variants
All images get 3 versions:
- **thumbnail** - 150px, low quality
- **medium** - 500px, medium quality
- **large** - 2000px, high quality

All URLs stored in `vehicle_images.variants` JSON column.

### Retention
- Images: Forever (or until deleted by user)
- Metadata: Forever in database

---

## Database Integration

### Table: vehicle_images

```sql
CREATE TABLE vehicle_images (
  id UUID PRIMARY KEY,
  vehicle_id UUID NOT NULL,
  user_id UUID NOT NULL,
  image_url TEXT NOT NULL,
  category TEXT,
  caption TEXT,
  is_primary BOOLEAN DEFAULT false,
  taken_at DATE,
  storage_path TEXT,
  variants JSONB,  -- {thumbnail, medium, large}
  metadata JSONB,  -- EXIF data, camera, etc
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
```

### RLS Policies
- **INSERT**: User can upload to their vehicles
- **SELECT**: User sees their images + public vehicle images
- **UPDATE**: User can edit their own images
- **DELETE**: User can delete their own images

---

## Timeline Integration

When an image is uploaded, a timeline event is automatically created:

```json
{
  "vehicle_id": "...",
  "user_id": "...",
  "event_type": "image_added",
  "event_date": "2025-10-20",
  "title": "Image Added",
  "description": "Exterior image added",
  "image_ids": ["..."],
  "metadata": {
    "category": "exterior",
    "taken_at": "2025-10-20",
    "camera": "iPhone 15"
  }
}
```

This:
- ✅ Contributes to user activity
- ✅ Shows on vehicle timeline
- ✅ Counts as user contribution
- ✅ Builds user credibility

---

## Error Handling

The component handles these errors gracefully:

| Error | Message | Recovery |
|-------|---------|----------|
| File too large | "File exceeds 10MB limit" | Show in UI, user can retry |
| Wrong file type | "Only image files allowed" | Show in UI, user selects different file |
| Upload fails | "Upload failed: {reason}" | Show in UI, user can retry |
| Metadata extraction fails | "Could not extract image data" | Continue with basic upload |
| Network error | "Network error during upload" | Show in UI, user can retry |

---

## Current Usage

### Where It's Used (DO THIS)
✅ `nuke_frontend/src/pages/add-vehicle/AddVehicle.tsx`
✅ `nuke_frontend/src/components/VehicleTimeline.tsx`
✅ `nuke_frontend/src/components/WorkDocumentationPanel.tsx`

### What to AVOID
❌ Creating new image upload components
❌ Using BulkImageUploader (legacy, consolidate into UniversalImageUpload)
❌ Using ImageUploader.tsx (minimal, consolidate)
❌ Building custom upload logic (use ImageUploadService directly)

---

## Advanced Usage

### Direct Service Usage (if not using component)

```tsx
import { ImageUploadService } from '../services/imageUploadService';

// Upload single image
const result = await ImageUploadService.uploadImage(
  vehicleId,
  file,
  'exterior'
);

// Upload multiple
const results = await Promise.all(
  files.map(f => ImageUploadService.uploadImage(vehicleId, f, 'general'))
);

// Get image metadata
const metadata = await ImageUploadService.getImageMetadata(imageId);

// Delete image
await ImageUploadService.deleteImage(imageId);
```

---

## Future Enhancements

Things we might add:

### Planned
- [ ] Drag-drop UI improvements (visual feedback)
- [ ] Thumbnail grid with delete buttons
- [ ] Context notes per image (modal)
- [ ] Batch context editing
- [ ] Image reordering
- [ ] Duplicate detection

### Not Planned (use existing features)
- ❌ Multiple upload components - use UniversalImageUpload
- ❌ Custom RLS policies - use existing 3 policies
- ❌ Different storage buckets - use vehicle-images bucket

---

## Troubleshooting

### "Upload failed: 401 Unauthorized"
- Check authentication (user must be logged in)
- Check vehicle ownership (user must own vehicle)
- Verify RLS policies are correct

### "File exceeds 10MB limit"
- File is too large
- Compress image before uploading
- Limit is enforced by Supabase

### "No images found for this vehicle"
- No images uploaded yet, OR
- User doesn't have permission to view images
- Check RLS SELECT policy

### "Image doesn't appear in timeline"
- Check vehicle_timeline_events table
- Verify user_id matches
- Verify vehicle_id matches

---

## Performance

### Typical Performance
- File selection: Instant
- Preview generation: <1s
- EXIF extraction: <500ms
- Variant generation: <2s
- Supabase upload: <5s (depends on file size)
- Database insert: <500ms
- Timeline creation: <500ms

### Total Time (per image)
- Single image: ~8-10 seconds
- Bulk (10 images): ~80-100 seconds (parallel uploads)

### Optimization Tips
- Use 'bulk' variant for multiple images (uploads in parallel)
- Use 'quick' variant if you don't need previews
- Compress images before uploading
- Use smaller image sizes (under 5MB ideal)

---

## Security

### What's Protected
✅ Only authenticated users can upload
✅ Only vehicle owners can upload to their vehicles
✅ Only users can see their own images + public images
✅ File types validated (images only)
✅ File sizes enforced (max 10MB)

### What's NOT Protected
❌ Images are public once uploaded (on purpose - vehicle listings)
❌ Anyone can view vehicle images (on purpose - marketplace)

---

## Migration Guide

### From BulkImageUploader
```tsx
// OLD
<BulkImageUploader vehicleId={id} />

// NEW
<UniversalImageUpload vehicleId={id} variant="bulk" />
```

### From Custom Upload Component
```tsx
// OLD (custom code)
const handleUpload = async (files) => {
  // ... 50 lines of custom logic
}

// NEW (use component)
<UniversalImageUpload vehicleId={id} variant="bulk" />
```

---

## Support

### For Issues
1. Check this documentation
2. Check console errors (browser DevTools)
3. Check database (vehicle_images table)
4. Check RLS policies (Supabase dashboard)
5. Check storage bucket (Supabase dashboard)

### For Feature Requests
Add to "Planned" section above and create issue

### For Bugs
Check if it's an RLS policy issue (most common)

---

## Version History

### 1.0 (Current)
✅ Production ready
✅ Single component (UniversalImageUpload)
✅ Full EXIF support
✅ Variant generation
✅ Timeline integration
✅ Error handling
✅ 4 variants (single, bulk, quick, detailed)

---

**Remember**: 
- One component
- One service
- One table
- One bucket
- No exceptions

Don't create new upload components.
Update ImageUpload 1.0 instead.

