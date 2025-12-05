# Participant Attribution Implementation - Complete

## What Was Implemented

### 1. Participant #1: Image Maker (Primary Documenter)

**Determined from:**
- EXIF device fingerprint (Make-Model-Lens-Software)
- `device_attributions` table (links image to ghost user or real user)
- `ghost_users` table (unclaimed devices)
- `vehicle_images.user_id` (fallback)

**Data Structure:**
```typescript
imageMaker: {
  user_id: string | null,           // Real user if device claimed
  ghost_user_id: string | null,      // Ghost user if unclaimed
  device_fingerprint: string,        // "Apple-iPhone12-Unknown-iOS15.0"
  camera_make: string | null,
  camera_model: string | null,
  lens_model: string | null,
  software_version: string | null,
  display_name: string,              // "iPhone 12 Photographer" or "Joey Martinez"
  is_claimed: boolean,                // Device claimed by real user?
  attribution_source: string,         // 'exif_device' | 'ghost_user' | 'scraped' | 'manual'
  confidence_score: number            // 0-100
}
```

**Saved to:**
- `timeline_events.documented_by` → Real user ID (if claimed)
- `timeline_events.metadata.image_maker` → Full attribution data
- `event_participants` → Participant #1 with role 'other' and notes

### 2. Uploaded By (May Differ from Image Maker)

**Tracked separately:**
- `device_attributions.uploaded_by_user_id` → Who uploaded
- `timeline_events.metadata.uploaded_by` → Full uploader data

**Use Case:** 
- Joey takes photos (image maker)
- Skylar runs automation to upload them (uploader)
- Both get credit, but Joey is Participant #1

### 3. Assigned Participants

**Image maker can assign others via `event_participants` table:**
- Mechanic who performed work
- Assistant
- Supervisor
- Owner
- Witness

**AI can suggest participants:**
- `workLog.participantSuggestions[]` → People seen in photos
- Saved to `event_participants` with confidence scores
- User can verify/assign later

---

## Complete Data Structure Now Provided to AI

### Vehicle Context ✅
- Year, make, model, trim, series, VIN, mileage
- Color, drivetrain, engine, transmission, body style

### Participant Attribution ✅
- Image maker (Participant #1) with full device attribution
- Uploaded by (may differ)
- Assigned participants (if any)
- AI-suggested participants (from photos)

### Organization Context ✅
- Business name, type, specialization
- Labor rate
- Location (if available)

### Image Session Metadata ✅
- Date, photo count
- Time span (start, end, duration)
- GPS coordinates (if available)
- Device fingerprint consistency

### EXIF Aggregation ✅
- Camera make/model/lens/software
- GPS coordinates from images
- Date/time range

### Vehicle History ✅
- Recent work orders (last 10)
- Quality ratings
- Work categories
- Build progression context

### Source Context ✅
- Source type (user_upload, dropbox_import, bat_scrape, etc.)
- Imported by (who ran automation)
- Source URL (if scraped)

---

## AI Prompt Enhancement

The AI now receives:

```
PARTICIPANT ATTRIBUTION:
- Primary Documenter (Image Maker): iPhone 12 Photographer
  Device: Apple-iPhone12-Unknown-iOS15.0
  (Unclaimed device - ghost user)
  Attribution Confidence: 100%
  
- Uploaded By: skylar.williams
  (Different from image maker)

- Assigned Participants:
  - Mike Johnson (mechanic) - Viva! Las Vegas Autos
  - Sarah Chen (assistant)

RECENT WORK HISTORY:
- 2024-08-05: Body panel replacement (Quality: 8/10)
- 2024-07-20: Paint prep and primer

IMAGE SESSION:
- Date: 2024-08-10
- Photo Count: 143
- Time Span: 08:00:00 - 17:30:00 (570 minutes)
- Location: GPS coordinates available (12 images with location data)
```

---

## What Gets Saved

### Timeline Event
- `documented_by` → Image maker user_id (if claimed)
- `metadata.image_maker` → Full attribution data
- `metadata.uploaded_by` → Uploader data

### Event Participants
1. **Participant #1 (Image Maker)**
   - `user_id` → Real user (if claimed) or null (ghost)
   - `name` → Display name
   - `role` → 'other' (documenter)
   - `notes` → Device fingerprint, attribution details

2. **AI-Suggested Participants**
   - `name` → Name from photos
   - `role` → Suggested role
   - `notes` → Evidence + confidence score
   - `user_id` → null (needs manual assignment)

3. **Manually Assigned Participants**
   - Image maker can add others via UI
   - Stored in `event_participants` table

---

## Edge Cases Handled

### 1. Camera Sold to New User
- **Detection:** Location/time gaps, different user patterns
- **Current:** Not yet implemented (future enhancement)
- **Fallback:** EXIF data still provides device fingerprint

### 2. Scraped/Discovered Images
- **Ghost Participant:** "Scraped Profile Photographer"
- **Attribution:** Low confidence, flagged for review
- **Source:** Tracked in `source_type` and `metadata`

### 3. No EXIF Data
- **Fallback:** `uploaded_by_user_id` becomes image maker
- **Confidence:** Lower (50% vs 100%)
- **Notes:** "Attribution incomplete - no EXIF data"

### 4. Multiple Devices Same Day
- **Grouping:** By device fingerprint + date
- **Separate Events:** Different devices = different events
- **Attribution:** Each device gets its own participant

---

## Next Steps

### 1. Re-scan Existing Images
Run analysis on all image bundles to populate:
- Participant attribution
- Parts/labor/materials data
- Quality ratings
- Value impacts

### 2. UI for Participant Assignment
Image maker should be able to:
- Assign other participants
- Verify AI-suggested participants
- Claim ghost user devices

### 3. Cross-Analysis
When analyzing images, factor in:
- Historical work patterns
- Organization specialization
- Location context
- Time span analysis

---

## Testing Checklist

- [ ] Image with EXIF → Participant #1 from device attribution
- [ ] Image without EXIF → Participant #1 from uploaded_by
- [ ] Ghost user device → Participant #1 as ghost user
- [ ] Claimed device → Participant #1 as real user
- [ ] AI suggests participants → Saved to event_participants
- [ ] Receipt shows all participants correctly
- [ ] Historical context included in analysis
- [ ] Organization context included in analysis

---

## Status: ✅ IMPLEMENTED

All participant attribution data is now:
- ✅ Fetched from database
- ✅ Included in AI prompt
- ✅ Saved to timeline_events
- ✅ Saved to event_participants
- ✅ Displayed in receipt component

**Ready for testing with real image analysis!**

