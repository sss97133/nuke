# Deployed Fixes - November 22, 2025

## What's Now LIVE in Production

### 1. Auto-Grouping Trigger ✅
**Database trigger** `trg_auto_group_photos` now automatically:
- Groups photos by `DATE(taken_at)` into timeline events
- Creates event when first photo uploaded for a date
- Appends subsequent photos to existing event
- Updates photo count and title automatically

**Example:** Upload 10 photos from Jan 15, 2024 →  
System creates ONE event "10 photos from Jan 15, 2024"

### 2. Photo Event Display ✅
- ❌ No fake labor costs ($0 shown for photo events)
- ✅ Event title shows photo count: "6 photos from Jan 06, 2024"
- ✅ Calendar shows green dots on photo dates
- ✅ Click opens receipt directly (no image popup)

### 3. Header Fixed ✅
- Was: "1976 Chevrolet C20 C20 3+3 454ci" (duplicate)
- Now: "1976 Chevrolet Silverado C20 3+3 454ci"

### 4. Timeline Event Linkage ✅
- Images linked to timeline events via `timeline_event_id`
- Calendar loads photo dates from `vehicle_images.taken_at`
- Events show actual EXIF dates, not upload dates

## What's Still Using Old Format

**Receipt Display:**
Still shows "WORK ORDER / SERVICE RECEIPT" format which doesn't fit photo events.

**Needs redesign to show:**
- Photo grid (not work items)
- Device/IMEI info
- Ghost user attribution
- AI-detected content (speedsheet, damage)

## Testing the Implementation

**Upload a photo** → System will:
1. Extract EXIF date
2. Auto-create or append to timeline event for that date
3. Show on calendar at EXIF date
4. NO "upload event" created

**Current 1976 C20 Status:**
- 9 photos with January 2024 EXIF dates
- 3 timeline events (Jan 6, 9, 19)
- Auto-grouping active for future uploads

**Next deployment will include:** Better receipt design for photo events

