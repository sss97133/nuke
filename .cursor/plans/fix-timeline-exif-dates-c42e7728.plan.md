<!-- c42e7728-cb61-4856-8b35-92a2cc922b40 947954bf-6251-46fc-84d3-49598f1f42e0 -->
# Consolidate Add Vehicle Process

## Current State Analysis

### Option 1: QuickVehicleAdd.tsx (Floating Modal)

**Pros:**

- Simple UX (YMM + color + images)
- Fast to complete
- Floating button always accessible
- Contribution mode toggle

**Cons:**

- ❌ Custom image upload (bypasses ImageUploadService)
- ❌ No EXIF handling
- ❌ Limited fields
- ❌ No title scanning
- ❌ No URL scraping

**Lines:** ~400

### Option 2: AddVehicle.tsx (Full Page)

**Pros:**

- ✅ Uses ImageUploadService correctly
- ✅ Title scanning integration
- ✅ URL scraping (BAT, etc.)
- ✅ EXIF extraction
- ✅ Detail levels (basic → expert)
- ✅ Ownership verification
- ✅ Preview before submit
- ✅ Background upload queue

**Cons:**

- Complex (~880 lines)
- Overwhelming for quick adds
- Full page (not contextual)

**Lines:** ~880

### Option 3: AddVehicleRedirect + VehicleForm

- Different component structure
- Less commonly used
- Adds confusion

## User Requirements Met

From your description, you need:

1. ✅ **Photos first** → Images are critical, EXIF dates matter
2. ✅ **Simple and smooth** → Don't overwhelm with fields
3. ✅ **Malleable yet definitive** → Can finish later, but YMM+images required
4. ✅ **Low validation OK** → Starts as "lead", improves over time
5. ✅ **Paper trail paramount** → Focus on documentation
6. ✅ **Lead generation** → Vehicle hint + contact = lead

## Recommended Solution: Enhanced Quick Add

**Take the BEST of both:**

### Core Concept: Progressive Vehicle Entry

```
MINIMUM TO CREATE (Lead):
- Year, Make, Model
- At least 1 image (with EXIF)
- User contact (automatic from auth)

STATUS: "draft" / "lead"
VISIBLE: Owner only

↓ User can add more ↓

BASIC PROFILE (Validation ~30%):
- YMM + 3+ images
- Color
- Basic description

STATUS: "pending_review"
VISIBLE: Owner + invited reviewers

↓ User continues ↓

VALIDATED PROFILE (Validation ~70%):
- YMM + 10+ images
- VIN or Title scan
- Purchase info
- Condition notes

STATUS: "active"
VISIBLE: Public discovery feed

↓ Professional level ↓

PREMIUM PROFILE (Validation ~95%):
- All above +
- Complete specs
- Full documentation
- Verified ownership
- Timeline events

STATUS: "verified"
VISIBLE: Featured listings
```

### Implementation: Unified AddVehicle Component

**Step 1: Photos First (Required)**

```typescript
// Drag and drop or select images
- Uses UniversalImageUpload
- Extracts EXIF automatically
- Shows preview with dates
- Minimum: 1 image required
```

**Step 2: Basic Info (Required)**

```typescript
// Just YMM required
{
  year: required,
  make: required, 
  model: required,
  color: optional,
  vin: optional
}
```

**Step 3: Quick Options (Expandable)**

```typescript
// Accordion sections - all optional
- 📸 Add More Images
- 🔍 Scan Title (auto-fills + verifies ownership)
- 🔗 Import from URL (BAT, Craigslist, etc.)
- 📝 Additional Details (collapsible)
- 💰 Financial Info (collapsible)
```

**Step 4: Submit**

```typescript
// Create vehicle
- Status: "draft" if minimal
- Status: "pending_review" if has images + basic info
- Status: "active" if has VIN or Title
- Navigate to vehicle profile
- Images upload in background
```

### Key Features to Preserve

From **AddVehicle.tsx** (keep):

- ✅ Title scanning
- ✅ URL scraping
- ✅ EXIF extraction
- ✅ Background upload queue
- ✅ Ownership verification
- ✅ Progressive disclosure

From **QuickVehicleAdd.tsx** (keep):

- ✅ Simple modal UX
- ✅ Contribution toggle
- ✅ Fast workflow

## Proposed File Structure

### Delete

- ❌ `/nuke_frontend/src/components/feed/QuickVehicleAdd.tsx` (merge into AddVehicle)
- ❌ `/nuke_frontend/src/pages/AddVehicleRedirect.tsx` (use AddVehicle directly)
- ❌ `/nuke_frontend/src/components/vehicles/VehicleForm.tsx` (if unused)

### Consolidate Into

- ✅ `/nuke_frontend/src/pages/add-vehicle/AddVehicle.tsx` (enhanced)
- Use as both modal AND full page
- Props: `mode?: 'modal' | 'page' | 'inline'`

### New Component Structure

```
AddVehicle/
├── AddVehicle.tsx (main container - smart mode detection)
├── components/
│   ├── PhotoUploadStep.tsx (uses UniversalImageUpload)
│   ├── BasicInfoStep.tsx (YMM required)
│   ├── QuickOptionsAccordion.tsx (title, URL, details)
│   └── VehiclePreview.tsx (before submit)
├── hooks/
│   ├── useVehicleForm.ts (keep - already good)
│   └── useImageMetadata.ts (EXIF extraction helper)
└── types/
    └── index.ts (keep)
```

## Implementation Plan

### Phase 1: Database Migration (Manual)

**Run in Supabase Dashboard > SQL Editor:**

```sql
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS entry_status TEXT DEFAULT 'stash';
CREATE INDEX IF NOT EXISTS idx_vehicles_entry_status ON vehicles(entry_status);
ALTER TABLE vehicles ADD CONSTRAINT public_requires_vin 
  CHECK ((is_public = false) OR (vin IS NOT NULL));
```

### Phase 2: Add URL Deduplication Logic

**Create:** `/nuke_frontend/src/services/vehicleDeduplicationService.ts`

- Check if URL already imported (discovery_url field)
- Check if VIN already exists
- Return: { exists: boolean, vehicleId?, discovererRank: number }
- If exists: Credit user as 2nd/3rd/etc. discoverer
- If new: Proceed with creation

### Phase 3: Enhance AddVehicle.tsx

**Changes:**

1. Add `mode?: 'modal' | 'page'` prop
2. Add URL input at top (alternative to photos)
3. Make either URL OR photos required (not both)
4. When URL pasted:

   - Check for duplicates
   - If exists: Show notification, offer to view existing
   - If new: Auto-scrape and fill form

5. Auto-calculate entry_status on submit:

   - No VIN → 'stash' (private only)
   - Has VIN + minimal → 'lead'
   - Has VIN + basic → 'draft'
   - Has VIN + complete → 'active'

6. Collapse all optional sections by default
7. Remove preview step for modal mode

### Phase 4: Delete Redundant Components

- Delete `QuickVehicleAdd.tsx`
- Delete `AddVehicleRedirect.tsx`  
- Update Discovery.tsx to use AddVehicle modal

### Phase 5: Update Vehicle Display

Add status badges everywhere vehicles shown:

- ⚠️ "Stash" (no VIN, private)
- 🔒 "Lead" (has VIN, private)
- 📝 "Draft" (basic, private)
- ✓ "Active" (public)
- ⭐ "Verified" (ownership confirmed)

### Phase 5: Validation Rules & VIN Safety Protocol

**The VIN Problem:**

- VIN = canonical identifier (like Wikipedia article)
- No VIN = can't align with other contributors
- No VIN = stays in user's private stash
- No VIN = can't go public (avoids duplicate vehicles)

**Status Hierarchy:**

```typescript
// USER'S PRIVATE STASH (No VIN)
entry_status = 'stash'
- YMM + images (any amount)
- No VIN required
- is_public = false (LOCKED)
- visible_to = [owner_id only]
- Shown in user's garage with ⚠️ "Add VIN to publish"

// LEAD (Has VIN, minimal)
entry_status = 'lead'
- YMM + VIN + 1 image
- is_public = false
- visible_to = [owner_id, invited_reviewers]
→ Can invite collaborators to help complete

// DRAFT (Has VIN, basic)
entry_status = 'draft'  
- YMM + VIN + 3+ images + color
- is_public = false
- completion_score ~30%
→ Ready for collaborative contribution

// ACTIVE (Has VIN, public-ready)
entry_status = 'active'
- YMM + VIN + 10+ images + title_scan
- is_public = true
- completion_score ~70%
→ Appears in discovery feed

// VERIFIED (Complete pedigree)
entry_status = 'verified'
- Full documentation + ownership verified
- is_public = true
- featured = true
- completion_score ~95%
→ Featured in premium listings
```

**VIN Safety Rules:**

1. **No VIN** → Stays in private stash forever (until VIN added)
2. **Has VIN** → Can progress to public when quality threshold met
3. **URL duplicate** → Prevents re-import, credits additional discoverers
4. **VIN duplicate** → Triggers collaborative merge (existing memory)

**Database Constraints:**

```sql
-- Prevent public vehicles without VIN
ALTER TABLE vehicles ADD CONSTRAINT public_requires_vin 
CHECK (
  (is_public = false) OR 
  (is_public = true AND vin IS NOT NULL)
);

-- Auto-assign stash status when no VIN
CREATE OR REPLACE FUNCTION set_entry_status_on_insert()
RETURNS TRIGGER AS $
BEGIN
  IF NEW.entry_status IS NULL THEN
    IF NEW.vin IS NULL THEN
      NEW.entry_status = 'stash';
      NEW.is_public = false;
    ELSE
      NEW.entry_status = 'lead';
    END IF;
  END IF;
  RETURN NEW;
END;
$ LANGUAGE plpgsql;
```

**UI Indicators:**

- **Stash vehicles:** Show ⚠️ "Private Stash - Add VIN to publish"
- **Lead vehicles:** Show 🔒 "Private Lead - Add details to publish"
- **Draft vehicles:** Show 📝 "Draft - {completion}% complete"
- **Active vehicles:** Show ✓ "Public Profile"
- **Verified vehicles:** Show ⭐ "Verified Pedigree"
```

## Solution: One Adaptive Form (Lead → Pedigree)

**Philosophy:** Same form, same flow - starts minimal, expands as needed.

### The Form Architecture

**Always visible (Two paths to create):**

```


PATH A: Photos First

Photos (drag/drop) - minimum 1

Year - required

Make - required

Model - required

[Submit] → Creates vehicle

PATH B: URL First

Paste URL (BAT, Craigslist, etc.)

→ Auto-scrapes YMM + images + details

→ Checks if URL already imported

→ If exists: notify user, credit as 2nd/3rd discoverer

→ If new: create vehicle, credit as discoverer

[Submit] → Creates vehicle

```

**Always available (Collapsed by default):**

```

▸ Quick Tools

  - Scan Title → auto-fills + verifies ownership
  - Import URL → scrapes BAT/Craigslist/etc.

▸ Basic Details (color, mileage, condition)

▸ Financial Info (purchase, value, sale)

▸ Specifications (engine, transmission, dimensions)

▸ Modifications (is_modified, details)

▸ Legal/Insurance (registration, insurance, etc.)

```

**User Experience:**

- **Minimal entry (30 seconds):** Drop 1 photo, type YMM → Submit → Creates "lead"
- **Basic entry (2 minutes):** Add 5 photos, color, mileage → Submit → Creates "draft"  
- **Complete entry (10 minutes):** Scan title, add specs, 20 photos → Submit → Creates "active"
- **Pedigree entry (ongoing):** Full documentation over time → Status "verified"

**Same form. Same component. Scales with user effort.**

### Implementation: Enhance AddVehicle.tsx

**What to keep:**

- ✅ All existing features (title scan, URL import, etc.)
- ✅ Background upload queue
- ✅ EXIF extraction
- ✅ Ownership verification

**What to change:**

1. Make images REQUIRED (minimum 1)
2. Collapse all optional sections by default
3. Add `mode` prop for modal vs page
4. Simplify validation (YMM + 1 image = valid)
5. Auto-assign status based on completion
6. Remove preview step (just submit)

**What to delete:**

- ❌ QuickVehicleAdd.tsx (features merged into AddVehicle)
- ❌ AddVehicleRedirect.tsx (redundant)

This gives you ONE form that naturally handles:

- Lead capture (YMM + 1 photo)
- Contribution entries (URL import + basic info)
- Owner entries (title scan + details)
- Professional documentation (everything)

## Files to Modify

### Enhance

- 🔧 `/nuke_frontend/src/pages/add-vehicle/AddVehicle.tsx`

### Delete

- ❌ `/nuke_frontend/src/components/feed/QuickVehicleAdd.tsx`
- ❌ `/nuke_frontend/src/pages/AddVehicleRedirect.tsx`

### Update Consumers

- Discovery.tsx (use AddVehicle modal)
- Nav links (point to /add-vehicle)

### To-dos

- [ ] Add deprecation warnings to ImageUploader.tsx and update to use UniversalImageUpload internally
- [ ] Fix ImageUploader.tsx line 149 to use EXIF date instead of new Date() for timeline events
- [ ] Review and fix AddEventWizard.tsx and eventPipeline.ts to use EXIF dates for image timeline events
- [ ] Create SQL migration script to update existing timeline_events with correct dates from vehicle_images
- [ ] Test backfill script on sample data and verify timeline/contribution display
- [ ] Upload test image and verify timeline and user contribution graph show correct dates