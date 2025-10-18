<!-- 5aec0345-1027-4182-b4d1-133f713a8c0b 5971b466-351f-4bb6-a786-e4991bfdf961 -->
# Mobile Upload Date Fix Plan

## Problem

Timeline events from mobile uploads are using **upload date** instead of **actual photo dates from EXIF**. When uploading 20+ photos taken over several months, they all get today's date instead of being properly organized on the timeline.

### Current Behavior (Wrong)

- Upload batch of 23 photos from June-October
- All photos get event_date = `2025-10-18` (upload date) ❌
- Creates single "Photo Added" event with all 23 images
- Timeline shows one giant event on October 18

### Desired Behavior (Correct)

- Upload batch of 23 photos with various EXIF dates
- Extract EXIF `dateTimeOriginal` from each photo
- Group photos by date: June photos, July photos, etc.
- Create separate timeline events for each date ✅
- Timeline accurately reflects when work was done

## Root Cause

**`apple-upload` edge function** (line 49):

```typescript
const eventDate = String(form.get('event_date') || new Date().toISOString().split('T')[0])
```

Falls back to today's date without extracting EXIF data from images.

## Solution Architecture

### Option 1: Edge Function EXIF Extraction (Recommended)

**Pros:**

- Centralized - fixes all mobile uploads
- Works for iOS Shortcuts, web uploads, etc.
- No client-side changes needed

**Cons:**

- Need EXIF library in Deno edge function
- Slightly slower uploads (process images server-side)

### Option 2: Client-Side Pre-Processing

**Pros:**

- Faster server processing
- Client already has image data

**Cons:**

- Need to update multiple upload paths
- iOS Shortcuts can't easily extract EXIF

### Recommended: Option 1

## Implementation Steps

### 1. Add EXIF Extraction to Edge Function

Update `supabase/functions/apple-upload/index.ts`:

```typescript
import { readExif } from 'npm:exifr'  // Add EXIF library

// After collecting files, extract EXIF from each
const filesWithDates: Array<{file: File, exifDate: Date | null}> = []
for (const file of files) {
  const arrayBuffer = await file.arrayBuffer()
  const exif = await readExif(arrayBuffer)
  const exifDate = exif?.DateTimeOriginal || exif?.DateTime || null
  filesWithDates.push({ file, exifDate })
}

// Group by date
const dateGroups = new Map<string, typeof filesWithDates>()
for (const item of filesWithDates) {
  const dateKey = item.exifDate 
    ? item.exifDate.toISOString().split('T')[0]
    : eventDate  // fallback to provided/today
  
  if (!dateGroups.has(dateKey)) {
    dateGroups.set(dateKey, [])
  }
  dateGroups.get(dateKey)!.push(item)
}

// Create separate event for each date group
for (const [date, groupFiles] of dateGroups.entries()) {
  // Create event with this date
  // Upload files for this group
  // Link to this event
}
```

### 2. Update Image Metadata Storage

Ensure `vehicle_images` table captures EXIF date:

- Add/use `taken_at` field
- Populate from EXIF `dateTimeOriginal`
- Fall back to `created_at` if no EXIF

### 3. Handle Edge Cases

- **No EXIF data**: Skip timeline event creation, just store image ✅
- **Invalid dates**: Validate date is reasonable (after 1970, not in future)
- **Mixed dates in batch**: Create multiple events, group by date
- **Single photo**: Just use its EXIF date directly
- **Explicit event_date param**: If user provides event_date, use that for all photos

### 4. Update Event Titles

Instead of generic "Photo set", use descriptive titles:

- Single date: "Photos from [date]"
- With album name: "Photos from [date] • [album]"
- Multiple photos same date: "[count] photos from [date]"

## Files to Modify

### Edge Function

- `supabase/functions/apple-upload/index.ts` - Add EXIF extraction, date grouping

### Frontend (Optional Enhancements)

- `nuke_frontend/src/services/imageUploadService.ts` - Extract EXIF before upload
- `nuke_frontend/src/components/mobile/MobileAddVehicle.tsx` - Show detected dates

### Database

- Verify `vehicle_images.taken_at` is populated correctly
- Ensure `vehicle_timeline_events.event_date` uses photo dates

## Testing Strategy

1. **Single photo with EXIF**: Verify event gets photo's date
2. **Batch with same date**: Creates one event with all photos
3. **Batch with multiple dates**: Creates separate events per date
4. **Photos without EXIF**: Falls back gracefully to upload date
5. **Invalid EXIF dates**: Handles edge cases (future dates, invalid formats)

## Success Metrics

✅ Timeline events appear on actual photo dates

✅ Multi-date batches split into separate events

✅ Event titles reflect actual dates

✅ No photos lost or orphaned

✅ Graceful fallback for missing EXIF

## Migration for Existing Wrong-Dated Events

Optional cleanup for the 23 existing events with wrong dates:

```sql
-- Find events with suspiciously recent dates and images
SELECT id, event_date, image_urls, created_at
FROM vehicle_timeline_events  
WHERE source = 'apple_import'
AND event_date >= '2025-10-18'
AND array_length(image_urls, 1) > 0;

-- For each, extract EXIF from images and update event_date
-- (Would need to implement as script)
```

### To-dos

- [ ] Analyze timeline event system and identify errors
- [ ] Update useTimelineEvents.ts to use vehicle_timeline_events
- [ ] Update AddEventWizard.tsx to insert into vehicle_timeline_events
- [ ] Update all timeline display components to read from vehicle_timeline_events
- [ ] Update Elixir API endpoints to use vehicle_timeline_events
- [ ] Test event creation and display end-to-end