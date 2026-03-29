# P11: Gallery Filter — Widget-to-Image Coupling

## Context
Read these before executing:
- `docs/library/technical/design-book/vehicle-profile-computation-surface.md` — "The Profile as Data Attractor", "The Popup is the Deep Dive"
- `nuke_frontend/src/pages/vehicle-profile/VehicleProfileContext.tsx` — `GalleryFilter` type and `galleryFilter`/`setGalleryFilter` state (just added)
- `nuke_frontend/src/pages/vehicle-profile/WorkspaceContent.tsx` — filter chip UI, Engine Bay badge wiring (just added)
- `nuke_frontend/src/components/images/ImageGallery.tsx` — gallery component with zone/category/session filter modes
- `nuke_frontend/src/pages/vehicle-profile/VehicleListingDetailsCard.tsx` — modifications, highlights, flaws, equipment sections

## Problem
Phase 5 of vehicle profile polish laid the foundation: `galleryFilter` state exists in context, a filter chip renders above the gallery, and the Engine Bay Analysis badge emits the first filter. But:

1. **ImageGallery doesn't read `galleryFilter`** — the filter state exists but the gallery ignores it
2. **Only one widget emits a filter** — Engine Bay badge. No other left-column widget sends filters to the gallery.
3. **No zone-to-image mapping** — `vehicle_images` has `zone` and `category` columns but the gallery's ZONES view uses its own internal classification. The filter needs to bridge these.

The computation surface doc says: "Click a work session — get the Day Card. Click a photo cluster — get the full gallery with classification metadata." The left column should be a control surface for the right column.

## Scope
Wire `galleryFilter` into ImageGallery + add filter emitters to 3 more widgets. No new tables. No new edge functions.

## Steps

1. Read `ImageGallery.tsx` to understand its existing filter/view system. Identify how `galleryView` modes (ZONES, GRID, SESSIONS, CATEGORY, etc.) filter images internally.

2. Add `galleryFilter` as an optional prop to ImageGallery:
```typescript
interface ImageGalleryProps {
  // ... existing props
  galleryFilter?: GalleryFilter | null;
}
```

When `galleryFilter` is set:
- If `galleryFilter.zone` is set → filter images to those where `zone === galleryFilter.zone` (case-insensitive)
- If `galleryFilter.category` is set → filter images to those where `analysis_category` or `category` matches
- If `galleryFilter.tag` is set → filter images whose `tags` array includes the tag
- If `galleryFilter.dateRange` is set → filter to images with `captured_at` in range
- Apply the filter BEFORE the gallery view mode further groups/sorts. The gallery view mode operates on the already-filtered set.

3. Pass `galleryFilter` from WorkspaceContent through ProfileGallery to ImageGallery:
```typescript
<ProfileGallery
  // ... existing props
  galleryFilter={galleryFilter}
/>
```

4. Wire 3 more filter emitters in left-column widgets:

**VehicleListingDetailsCard — Modifications section:**
When modifications list items like "4x4 Conversion", "Custom Exhaust", clicking the modification name should set `galleryFilter({ tag: modification_name })`. This requires `setGalleryFilter` from context.
```typescript
// In VehicleListingDetailsCard, each modification item becomes clickable:
<span
  style={{ cursor: 'pointer', textDecoration: 'underline dotted' }}
  onClick={() => setGalleryFilter({ tag: mod.name || mod })}
>
  {mod.name || mod}
</span>
```

**VehicleDossierPanel — Color field:**
Clicking the COLOR field value should filter gallery to `category: 'exterior'`. Clicking INTERIOR COLOR should filter to `category: 'interior'`.
```typescript
// In FieldRow, add optional onClick:
onClick={() => {
  if (field === 'color') setGalleryFilter({ category: 'exterior' });
  if (field === 'interior_color') setGalleryFilter({ category: 'interior' });
}}
```

**BarcodeTimeline — Day click:**
When a day cell is clicked and the receipt popup opens, also set `galleryFilter({ dateRange: [date, date] })` so the gallery shows only photos from that day. Clear the filter when the receipt is dismissed.

5. When user clicks directly on the gallery toolbar (any view mode button), clear the galleryFilter:
```typescript
onClick={() => {
  setGalleryView(view);
  if (galleryFilter) setGalleryFilter(null);  // user override
}}
```

## Verify
- K2500 profile (`/vehicle/a90c008a-3379-41d8-9eb2-b4eda365d74c`)
- Click Engine Bay Analysis badge → gallery filters to engine_bay zone images → "FILTER: engine_bay" chip appears → click "× CLEAR" → gallery returns to full set
- Click a day on timeline → gallery filters to that day's photos → receipt popup close clears the filter
- Click COLOR field value in dossier → gallery filters to exterior category
- Click INTERIOR COLOR → gallery filters to interior category
- Click a gallery toolbar button (ZONES, GRID, etc.) → any active filter clears
- If a filter produces 0 results, show a one-line "No images match this filter" message instead of empty space

## Anti-Patterns
- Do NOT re-query the database when a filter is set. Filter the already-loaded `vehicleImages` array client-side. The image metadata (zone, category, tags, captured_at) should already be loaded.
- Do NOT create a FilterPanel component. The filter chip in WorkspaceContent already handles display + clear. Individual widgets just call `setGalleryFilter()`.
- Do NOT change the gallery view mode when a filter is applied. The filter operates independently of the view mode. ZONES view with a zone filter shows only matching zones. GRID view with a zone filter shows only matching images in a grid.
- Do NOT persist the filter across navigation. It's ephemeral UI state, scoped to the current profile session.
- Do NOT add filter emitters to every widget in the first pass. Start with these 4 (Engine Bay, modifications, color fields, timeline day). More can be added incrementally.

## Library Contribution
After completing:
- Update `docs/library/technical/design-book/vehicle-profile-computation-surface.md` — add "Cross-Column Coupling" subsection describing the galleryFilter bridge
- Update `docs/library/reference/dictionary/README.md` — add "Gallery Filter" definition (ephemeral cross-column state)
- Update `docs/library/technical/design-book/03-interactions.md` — add "Left-Right Column Coupling" interaction pattern
