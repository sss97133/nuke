# Image Sets System - ERD & Wireframe

## Overview
This document outlines the architecture and UI design for adding professional image management (albums/sets, multi-select, prioritization) to the existing ImageGallery without breaking current functionality.

---

## 🗂️ ENTITY RELATIONSHIP DIAGRAM (ERD)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DATABASE SCHEMA                                    │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────┐
│      vehicles        │
│──────────────────────│
│ id (PK)             │
│ vin                 │
│ year, make, model   │
│ created_by          │
│ is_draft            │
│ is_private          │
└──────────────────────┘
         │
         │ (1:N)
         ↓
┌──────────────────────┐         ┌──────────────────────┐
│  vehicle_images      │◄────────│   timeline_events    │
│──────────────────────│  (N:1)  │──────────────────────│
│ id (PK)             │         │ id (PK)              │
│ vehicle_id (FK)     │         │ vehicle_id (FK)      │
│ user_id (FK)        │         │ event_type           │
│ image_url           │         │ event_date           │
│ thumbnail_url       │         │ metadata             │
│ is_primary          │         │ created_at           │
│ caption             │         └──────────────────────┘
│ exif_data           │                  ▲
│ created_at          │                  │
│ taken_at            │                  │
│                     │                  │
│ NEW COLUMNS:        │                  │
│ manual_priority  ◄──┼──────────────────┘
│ display_order       │
│ user_tags           │
│ user_notes          │
└──────────────────────┘
         │
         │ (N:M through image_set_members)
         ↓
┌──────────────────────┐         ┌──────────────────────┐
│ image_set_members    │────────►│   image_sets         │
│──────────────────────│  (N:1)  │──────────────────────│
│ id (PK)             │         │ id (PK)              │
│ image_set_id (FK)   │         │ vehicle_id (FK)      │
│ image_id (FK)       │         │ created_by (FK)      │
│ priority            │         │ name                 │
│ display_order       │         │ description          │
│ caption (override)  │         │ color                │
│ notes               │         │ icon                 │
│ role                │         │ is_primary           │
│ added_by (FK)       │         │ display_order        │
│ added_at            │         │ timeline_event_id    │
│ UNIQUE(set, img)    │         │ event_date           │
└──────────────────────┘         │ tags                 │
                                 │ metadata             │
                                 │ created_at           │
                                 └──────────────────────┘
                                          │
                                          │ (N:1)
                                          ↓
                                 ┌──────────────────────┐
                                 │     profiles         │
                                 │──────────────────────│
                                 │ id (PK)              │
                                 │ username             │
                                 │ email                │
                                 └──────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                        KEY RELATIONSHIPS                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. One VEHICLE has many IMAGES (existing, unchanged)                        │
│ 2. One VEHICLE has many IMAGE_SETS (new)                                    │
│ 3. One IMAGE_SET has many IMAGES through IMAGE_SET_MEMBERS (many-to-many)  │
│ 4. One IMAGE can belong to multiple IMAGE_SETS (Bridge/Photos behavior)    │
│ 5. One IMAGE_SET can optionally link to one TIMELINE_EVENT (integration)   │
│ 6. Images have NEW columns for global priority/ordering (no breaking)      │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🎨 USER INTERFACE WIREFRAME

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    VEHICLE PROFILE PAGE (EXISTING)                           │
└─────────────────────────────────────────────────────────────────────────────┘

                    [Vehicle Header - unchanged]
                    [Timeline Tab - unchanged]
                    
┌─────────────────────────────────────────────────────────────────────────────┐
│  📸 IMAGES TAB (Enhanced)                                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  🔧 NEW: Image Management Toolbar (Collapsible)                        │ │
│  ├────────────────────────────────────────────────────────────────────────┤ │
│  │  [📁 Sets: 3] [✓ Select Mode: OFF] [⭐ Priority View] [🎨 Organize]  │ │
│  │                                                                          │ │
│  │  When Select Mode ON:                                                   │ │
│  │  [✓ 5 Selected] [Add to Set ▼] [Set Priority ▼] [Tag] [Delete]      │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  📁 IMAGE SETS (NEW - Collapsible Section)                             │ │
│  ├────────────────────────────────────────────────────────────────────────┤ │
│  │                                                                          │ │
│  │  ┌──────────────────────────────────────────────────────────────────┐  │ │
│  │  │ 🔵 "Restoration Progress" (12 images) [▶ View] [Edit] [⚙]      │  │ │
│  │  │    Linked to: Timeline Event "Major Restoration" (Oct 2024)      │  │ │
│  │  │    [○○○●○○○○○○○○] ←── visual indicator showing image spread      │  │ │
│  │  └──────────────────────────────────────────────────────────────────┘  │ │
│  │                                                                          │ │
│  │  ┌──────────────────────────────────────────────────────────────────┐  │ │
│  │  │ 🟢 "Engine Bay Details" (8 images) [▶ View] [Edit] [⚙]          │  │ │
│  │  │    [○○○○○○○○] ←── visual indicator                               │  │ │
│  │  └──────────────────────────────────────────────────────────────────┘  │ │
│  │                                                                          │ │
│  │  [+ Create New Set]                                                     │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  🖼️  ALL IMAGES GALLERY (EXISTING - Minimally Modified)                │ │
│  ├────────────────────────────────────────────────────────────────────────┤ │
│  │                                                                          │ │
│  │  [Grid] [Masonry] [List]    Sort: [Best First ▼]    [Upload Images]   │ │
│  │                                                                          │ │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐                  │ │
│  │  │    🖼️   │  │    🖼️   │  │    🖼️   │  │    🖼️   │                  │ │
│  │  │         │  │         │  │  [✓]    │  │         │  ←── NEW: checkbox│ │
│  │  │  ⭐ 100 │  │   ⭐ 85  │  │   ⭐ 75 │  │   ⭐ 60 │  ←── NEW: priority│ │
│  │  │ 📁 2    │  │  📁 1    │  │  📁 3   │  │         │  ←── NEW: set cnt│ │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘                  │ │
│  │  Jan 15      Jan 14       Jan 10       Jan 8                           │ │
│  │                                                                          │ │
│  │  [Load More Images...]                                                  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🎯 IMPLEMENTATION STRATEGY

### Phase 1: Non-Breaking Database Schema ✅ DONE
- ✅ Created `image_sets` table
- ✅ Created `image_set_members` junction table
- ✅ Added new columns to `vehicle_images` (via ALTER TABLE - safe)
- ✅ Set up RLS policies
- ✅ Created helper functions

### Phase 2: New Components (Isolated)
**No modifications to existing ImageGallery component initially**

#### 2A. Create `ImageSetManager.tsx` (NEW FILE)
- Displays image sets as collapsible cards
- Create/edit/delete sets
- View set contents in modal
- Link sets to timeline events
- Completely separate component

#### 2B. Create `ImageSetModal.tsx` (NEW FILE)
- Modal for creating/editing sets
- Form: name, description, color picker, icon picker
- Timeline event selector
- Save/cancel actions

#### 2C. Create `ImageMultiSelect.tsx` (NEW FILE)
- Wrapper/HOC around existing gallery
- Adds checkbox overlays when enabled
- Bulk action toolbar
- Does NOT modify core gallery rendering

### Phase 3: Minimal Gallery Enhancements
**Surgical changes to ImageGallery.tsx**

#### Changes to existing gallery:
1. Add checkbox overlays (CSS-only, no layout changes)
2. Add small badge showing set count per image
3. Add priority star/number badge (optional display)
4. Add "Select Mode" toggle button in toolbar

**What we DON'T change:**
- Existing grid/masonry/list views
- Image loading logic
- Upload functionality
- Lightbox behavior
- Sorting logic
- Filter logic

### Phase 4: Integration Points

```typescript
// In VehicleProfile.tsx or wherever ImageGallery is used:

<div className="images-section">
  {/* NEW: Collapsible Sets Section */}
  <ImageSetManager 
    vehicleId={vehicleId}
    onSetSelected={(setId) => filterGalleryBySet(setId)}
  />
  
  {/* EXISTING: Gallery with minimal enhancements */}
  <ImageGallery
    vehicleId={vehicleId}
    showUpload={true}
    // NEW PROPS (optional - defaults maintain current behavior):
    selectMode={selectModeEnabled}
    selectedImages={selectedImageIds}
    onSelectionChange={(ids) => setSelectedImageIds(ids)}
    showPriority={showPriorityBadges}
    showSetCount={showSetCountBadges}
    filteredSetId={activeSetFilter}
  />
</div>
```

---

## 🔒 RLS SECURITY MODEL

### Image Sets Permissions:
- **SELECT**: Anyone who can view the vehicle
- **INSERT**: Contributors, editors, owners of vehicle
- **UPDATE**: Set creator OR vehicle owner
- **DELETE**: Set creator OR vehicle owner

### Image Set Members Permissions:
- **SELECT**: Anyone who can view the set
- **INSERT**: Anyone who can edit the set
- **UPDATE**: Member adder OR set owner
- **DELETE**: Member adder OR set owner

### Image Priority Updates:
- **UPDATE**: Image uploader OR vehicle owner OR editors

---

## 📊 USER WORKFLOWS

### Workflow 1: Create an Image Set
1. User clicks "+ Create New Set" button
2. Modal opens with form
3. User enters: name, description, optional color/icon
4. User optionally links to timeline event
5. Save creates empty set
6. User can now add images to it

### Workflow 2: Add Images to Set (Multi-Select)
1. User toggles "Select Mode" ON
2. Checkboxes appear on all images
3. User clicks multiple images to select
4. User clicks "Add to Set" dropdown
5. User selects existing set OR creates new set
6. Images added to set with automatic ordering

### Workflow 3: Reorder Images in Set
1. User opens set view modal
2. Images displayed in current order
3. User drags images to reorder (drag-drop UI)
4. Order saved automatically on drop
5. OR user can set explicit priority numbers

### Workflow 4: Set Global Image Priority
1. User selects image(s) in gallery
2. User clicks "Set Priority" action
3. Dropdown or number input appears
4. User sets priority (0-100 scale)
5. Gallery re-sorts if in "Priority View" mode

### Workflow 5: View Set Contents
1. User clicks "View" on an image set card
2. Modal/overlay shows ONLY images in that set
3. Images displayed in set-specific order
4. User can click through like lightbox
5. Close returns to full gallery

### Workflow 6: Link Set to Timeline
1. User edits existing set OR creates new set
2. Timeline event dropdown populated from vehicle timeline
3. User selects event (or creates new event inline)
4. Set now appears linked in timeline view
5. Timeline event shows image count badge

---

## 🎨 VISUAL DESIGN SYSTEM

### Set Cards (NEW)
```
┌────────────────────────────────────────────────────┐
│ 🔵 Restoration Progress                  [⚙]     │
├────────────────────────────────────────────────────┤
│ Before and after photos from Oct 2024 restoration │
│                                                    │
│ 📸 12 images  📅 Oct 15, 2024  🔗 Timeline Event │
│ [○○○●○○○○○○○○] ←─ date distribution chart        │
│                                                    │
│ [View Set] [Edit] [Add Images]                   │
└────────────────────────────────────────────────────┘
```

### Image Card Enhancements
```
┌─────────────────┐
│    [✓]          │ ← NEW: checkbox (select mode only)
│                 │
│      🖼️         │
│    IMAGE        │
│                 │
│ ⭐85  📁2   🏷️3 │ ← NEW badges (optional display)
│ Jan 15, 2024    │
└─────────────────┘
```

### Priority Badge
- ⭐ + number (0-100 scale)
- Color coded: 
  - 90-100: Gold
  - 70-89: Silver
  - 50-69: Bronze
  - 0-49: Gray

### Set Count Badge
- 📁 + number
- Shows how many sets image belongs to
- Clickable to show set list

---

## 🧪 TESTING CHECKLIST

### Database Tests
- [ ] Create image set with RLS enabled
- [ ] Add images to set (bulk and individual)
- [ ] Reorder images in set
- [ ] Delete image (verify membership cleanup)
- [ ] Delete set (verify CASCADE behavior)
- [ ] Test permission boundaries (other user's sets)

### UI Tests
- [ ] Existing gallery still works identically
- [ ] Select mode toggles without breaking layout
- [ ] Multi-select works across pagination
- [ ] Drag-drop reordering is smooth
- [ ] Set modal opens/closes properly
- [ ] Timeline integration displays correctly
- [ ] Priority badges don't overlap images
- [ ] Mobile responsive (especially new toolbar)

### Integration Tests
- [ ] Create set → add images → view in timeline
- [ ] Upload new images → add to existing set
- [ ] Delete image → verify removed from sets
- [ ] Change image priority → gallery re-sorts
- [ ] Filter by set → only set images show

---

## 🚀 ROLLOUT PLAN

### Step 1: Database Migration
- Run migration in development
- Verify RLS policies work
- Test helper functions
- No user-facing changes yet

### Step 2: Build New Components
- ImageSetManager (isolated)
- ImageSetModal (isolated)
- ImageMultiSelect wrapper (isolated)
- Test independently

### Step 3: Minimal Gallery Mods
- Add checkbox overlay CSS
- Add badge rendering (can be toggled off)
- Add select mode state management
- Default everything to OFF (existing behavior)

### Step 4: Integration
- Add ImageSetManager above gallery
- Connect selection state
- Test full workflow
- Deploy to production

### Step 5: User Enablement
- Add "Image Sets" feature to docs
- Create tutorial/demo
- User can enable new features via settings

---

## ⚠️ RISK MITIGATION

### What Could Go Wrong?
1. **Gallery layout breaks**: Mitigated by keeping new UI optional and toggled off by default
2. **Performance issues**: Mitigated by lazy loading sets, pagination unchanged
3. **RLS policy errors**: Mitigated by extensive testing, fallback to read-only
4. **User confusion**: Mitigated by keeping new features collapsed/hidden initially

### Rollback Plan
- All new features can be disabled via feature flag
- Database tables can be dropped without affecting vehicle_images
- Gallery component changes are minimal and reversible

---

## 📝 SUMMARY

### What Changes?
- ✅ Database: 3 new tables + 4 new columns (non-breaking)
- ✅ Components: 3 new files (isolated)
- ⚠️ ImageGallery: ~50 lines added (mostly optional rendering)
- ✅ Integration: 1 new section above existing gallery

### What Stays The Same?
- ✅ Existing gallery grid/masonry/list views
- ✅ Image upload flow
- ✅ Lightbox behavior
- ✅ Sorting and filtering
- ✅ All existing data and queries

### Feature Parity with Adobe Bridge / Apple Photos?
- ✅ Albums/Collections (image_sets)
- ✅ Multi-select (checkbox mode)
- ✅ Manual prioritization (priority field)
- ✅ Drag-drop reordering (in set view)
- ✅ Batch operations (bulk add, tag, delete)
- ✅ Color coding (set colors)
- ✅ Timeline integration (set → events)

### Ready to Implement?
**Awaiting your approval.** Review this ERD and wireframe, let me know if you want any changes to the approach before I proceed with implementation.

