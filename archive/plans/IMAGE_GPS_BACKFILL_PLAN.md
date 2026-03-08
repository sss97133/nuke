# Image GPS Backfill & AI Work Log Generation

## Problem Identified

**1974 Ford Bronco** has:
- ✅ **243 images** uploaded
- ✅ **243 timeline events**
- ❌ **0 GPS-tagged images** (no location data)
- ❌ **0 organization links** (can't auto-link to Ernie's)
- ❌ **No AI-generated work logs** (generic "Photo Added" events)

**Root Cause**: Images uploaded without EXIF GPS data OR GPS not extracted during upload

---

## Solution: 3-Tier Approach

### **Tier 1: EXIF GPS Extraction (Automated)** ✅ READY
**Script**: `/scripts/backfill-image-gps-and-orgs.js`

**What it does:**
1. Downloads images from Supabase storage
2. Extracts EXIF GPS coordinates using `exifr` library
3. Reverse geocodes GPS → Location names
4. Updates `vehicle_images` table with GPS data
5. Groups images by date/location
6. Finds nearby organizations (within 100m)
7. Calls OpenAI to generate work logs from image batches
8. Creates timeline events linked to organizations

**Usage:**
```bash
# Run for all vehicles
node scripts/backfill-image-gps-and-orgs.js

# Run for specific vehicle (Bronco)
node scripts/backfill-image-gps-and-orgs.js 79fe1a2b-9099-45b5-92c0-54e7f896089e
```

**Limitations:**
- Only works if images have GPS in EXIF metadata
- Many phone uploads strip EXIF data
- Bronco images likely don't have EXIF GPS

---

### **Tier 2: Manual Location Tagging (UI)** 🚧 TO BUILD

**Add "Tag Location" feature to image gallery:**

```typescript
// Button on image batch view
<button onClick={() => setShowLocationTagger(true)}>
  📍 Tag Location for These Photos
</button>

// Modal with map picker (like organization GPS setter)
<LocationTaggerModal>
  - Select organization from dropdown OR
  - Drop pin on map OR
  - Type address
  - Apply to: This photo / This batch / All photos this day
</LocationTaggerModal>
```

**Flow:**
1. User views vehicle images on timeline
2. Clicks "Tag Location" on a batch
3. Selects "Ernie's Upholstery" from dropdown (or map)
4. System updates all selected images with GPS + organization link
5. AI generates work log from batch
6. Timeline event created

**Benefits:**
- Works for images without EXIF
- User knows where photos were taken
- One-time manual input → Future auto-linking

---

### **Tier 3: AI Visual Location Detection** 🔬 FUTURE

**Use AI to identify shop from visual cues:**

- Signage in photos ("Ernie's Upholstery" sign)
- Shop interior features (paint booth, lift, tools)
- Known reference images (if shop has profile photos)
- Cross-reference with other GPS-tagged images

**Confidence scoring:**
- High: Sign visible + GPS within 1km of shop
- Medium: Shop interior features + same day as GPS-tagged photos
- Low: Generic shop environment

---

## Immediate Action Plan

### **Option A: Run EXIF Extraction (Test)**
See if any Bronco images have GPS in EXIF:

```bash
cd /Users/skylar/nuke/scripts
node backfill-image-gps-and-orgs.js 79fe1a2b-9099-45b5-92c0-54e7f896089e
```

**Expected Result**: 
- Either finds GPS in EXIF and links to Ernie's
- Or reports "No GPS data in EXIF" for all images

---

### **Option B: Manual Batch Link (SQL)** ⚡ FASTEST

If we know the Bronco work was at Ernie's, manually link via SQL:

```sql
-- Step 1: Find date ranges of Bronco images
SELECT 
  DATE(taken_at) as work_date,
  COUNT(*) as photo_count
FROM vehicle_images
WHERE vehicle_id = '79fe1a2b-9099-45b5-92c0-54e7f896089e'
GROUP BY DATE(taken_at)
ORDER BY work_date DESC
LIMIT 20;

-- Step 2: Update timeline events for specific dates
UPDATE timeline_events
SET 
  organization_id = 'e796ca48-f3af-41b5-be13-5335bb422b41', -- Ernie's
  service_provider_name = 'Ernies Upholstery',
  updated_at = NOW()
WHERE vehicle_id = '79fe1a2b-9099-45b5-92c0-54e7f896089e'
  AND event_date BETWEEN '2024-10-01' AND '2025-11-02'
  AND organization_id IS NULL
RETURNING id, title, event_date;

-- Step 3: Link Bronco to Ernie's fleet
INSERT INTO organization_vehicles (
  organization_id,
  vehicle_id,
  relationship_type,
  status,
  start_date,
  linked_by_user_id,
  notes
) VALUES (
  'e796ca48-f3af-41b5-be13-5335bb422b41',
  '79fe1a2b-9099-45b5-92c0-54e7f896089e',
  'service_provider',
  'active',
  '2024-10-01',
  '0b9f107a-d124-49de-9ded-94698f63c1c4',
  'Upholstery and paint work - manually linked'
)
ON CONFLICT DO NOTHING;
```

---

### **Option C: Build UI Batch Tagger** 🎨 BEST UX

Add to `VehicleTimeline.tsx`:

```typescript
// Group consecutive same-day events
const eventBatches = groupEventsByDate(events);

// Add "Tag Location" button to each batch
{eventBatches.map(batch => (
  <div className="event-batch">
    <div className="batch-header">
      {batch.date} - {batch.events.length} photos
      {!batch.organization && (
        <button onClick={() => tagBatchLocation(batch)}>
          📍 Tag Location
        </button>
      )}
    </div>
    {/* ... events ... */}
  </div>
))}
```

---

## Recommended Next Steps

1. **Run SQL manual link** (Option B) - Get Bronco work showing on Ernie's NOW
2. **Build UI batch tagger** (Option C) - Allow user to tag future batches
3. **Run EXIF extraction** (Option A) - Catch any images that DO have GPS
4. **AI work log generation** - Enhance timeline events with AI analysis

---

## AI Work Log Enhancement

Once images are linked to organizations, run AI analysis:

**Current timeline event:**
```
Title: "Photo Added"
Description: null
Labor Hours: null
Cost: null
```

**AI-enhanced timeline event:**
```
Title: "Interior Upholstery Replacement"
Description: "Complete seat reupholstery including front buckets and rear bench. Custom diamond-stitch pattern in tan vinyl. Door panels re-wrapped to match."
Labor Hours: 12.5 (estimated)
Cost: $1,850 (parts + labor estimate)
Work Performed: [
  "Removed old seat covers",
  "Fabricated new seat covers",
  "Installed new foam padding",
  "Re-wrapped door panels",
  "Quality inspection"
]
Parts Identified: [
  "Tan vinyl upholstery material",
  "High-density foam padding",
  "Thread and adhesives"
]
Condition Notes: "Original seats showed significant wear and tears. New upholstery professionally installed with attention to detail."
```

This gives the work history real substance and helps with:
- Valuation (documented labor hours)
- Service history (what was actually done)
- Future quotes (similar work reference)
- Portfolio building (showcase shop's work)

---

**Which option do you want to pursue first?**

