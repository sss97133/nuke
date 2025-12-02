# Photo Events Removed from Timeline

**Date**: November 22, 2025  
**Status**: ✅ COMPLETE

## Problem

The timeline was showing photo uploads as "events" which cluttered the timeline and made it useless:
- "Photo Session (4 photos)" showing as timeline events
- "Photo Added" entries for every image upload
- Timeline dates using upload dates instead of actual event dates
- Image variants being counted as multiple separate photos

## Solution

### 1. Database Cleanup ✅
- **Deleted 140+ photo_added, photo_session, and image_upload timeline events**
- Cleared `timeline_event_id` references from all vehicle_images
- Disabled `tr_delete_image_timeline_event` trigger (obsolete)

### 2. Frontend Changes ✅
- **imageUploadService.ts**: Removed code that creates timeline events for photo uploads
- **VehicleTimeline.tsx**: 
  - Removed derived photo event generation from images
  - Removed photo event grouping logic
  - Fixed image counting to not count variants as separate photos

### 3. Timeline Policy ✅

**Timeline Shows Only Real Events:**
- ✅ Maintenance work
- ✅ Repairs completed
- ✅ Purchases/sales
- ✅ Modifications
- ✅ VIN additions
- ❌ Photo uploads (removed)
- ❌ Image uploads (removed)

**Photos Are Evidence, Not Events:**
- Images are displayed in the **Image Gallery**
- Images can be attached to work events as evidence
- Upload is not an event - the work documented is the event

## Results

### Before:
```
Timeline Events: 517
- 125 photo_session events
- 140 photo_added events  
- 15 image_upload events
- 237 real events
```

### After:
```
Timeline Events: 377
- 350 maintenance
- 17 work_completed
- 10 other real events
- 0 photo events ✅
```

## Technical Details

**Files Modified:**
1. `/nuke_frontend/src/services/imageUploadService.ts` - Removed timeline event creation
2. `/nuke_frontend/src/components/VehicleTimeline.tsx` - Removed photo event handling
3. `/supabase/migrations/20251122_remove_photo_events.sql` - Database cleanup
4. `/supabase/migrations/20251122_fix_auto_tag_organization_gps.sql` - Fixed GPS trigger
5. `/supabase/migrations/20251122_backfill_orphaned_images.sql` - Created for future use
6. `/supabase/migrations/20251122_fix_bat_image_dates_manual.sql` - Fixed BAT import dates
7. `/supabase/migrations/20251122_comprehensive_timeline_date_correction.sql` - Date extraction

**Deployment:**
- Frontend deployed to production (build hash: CqOKmPmP)
- All migrations applied to production database
- Zero errors in deployment

## Future Behavior

### Photo Upload Flow:
1. ✅ Photo uploads to storage with EXIF extraction
2. ✅ `taken_at` date set from EXIF DateTimeOriginal
3. ✅ Record created in `vehicle_images` table
4. ✅ Image appears in Image Gallery
5. ❌ NO timeline event created (photos aren't events!)
6. ✅ Calendar heatmap shows activity on `taken_at` date
7. ✅ Clicking calendar day with photos shows image viewer

### Timeline vs Gallery:
- **Timeline List**: Only actual events (work, repairs, purchases, etc.)
- **Calendar Heatmap**: Includes both events AND photo dates (shows all vehicle activity)
- **Image Gallery**: All photos organized by `taken_at` date from EXIF

### Data Quality:
- **1,898 images (69.6%)** have proper EXIF `taken_at` dates ✅
- **829 images (30.4%)** without EXIF (BAT imports, screenshots) - use defaults
- BAT listing images default to vehicle year (1985-01-01) for sorting

**Timeline shows only real events. Calendar shows when those events happened AND when photos were taken.**

