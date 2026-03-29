# P14: Timeline Filter Modes — The Timeline IS the Vehicle

## Context
Read these before executing:
- `docs/library/technical/design-book/vehicle-profile-computation-surface.md` — "The Timeline IS the Vehicle" section, anti-pattern diagram
- `nuke_frontend/src/pages/vehicle-profile/BarcodeTimeline.tsx` — current implementation (heatmap + receipt popup + day card)
- `nuke_frontend/src/pages/vehicle-profile/VehicleProfileContext.tsx` — `timelineEvents` state, `loadTimelineEvents()` merges `timeline_events` + `work_sessions`

## Problem
The computation surface doc defines the north star:

```
vehicle timeline   ──> Timeline component
                       ├── filtered by work events    = Build Log view
                       ├── filtered by image events   = Photo Gallery view
                       ├── filtered by auction events  = Auction History view
                       └── filtered by title events    = Title History view
(1 data path, 1 UI with filter modes, 0 caches)
```

Currently the BarcodeTimeline shows ALL events indiscriminately. A vehicle with 200 events across 5 years shows every dot at the same intensity. There's no way to ask "show me only the work sessions" or "show me only when this truck appeared at auction."

The left-column widgets (Build Status, Observation History, Auction History, Comments & Bids) are parallel display systems for timeline subsets. The timeline should BE those views — filtered.

## Scope
Add filter pill bar to BarcodeTimeline. Client-side filtering of `timelineEvents`. No new tables. No new queries.

## Steps

1. Define the filter modes. Each mode filters `timelineEvents` by `event_type`:

```typescript
const TIMELINE_FILTERS: { key: string; label: string; match: (ev: any) => boolean }[] = [
  { key: 'all', label: 'ALL', match: () => true },
  { key: 'work', label: 'WORK', match: (ev) => {
    const t = String(ev.event_type || '').toLowerCase();
    return t === 'work_session' || t === 'repair' || t === 'modification' || t === 'maintenance' || t === 'service';
  }},
  { key: 'photos', label: 'PHOTOS', match: (ev) => {
    const t = String(ev.event_type || '').toLowerCase();
    return t === 'photo_session' || (ev.metadata?.image_count > 0);
  }},
  { key: 'sales', label: 'SALES', match: (ev) => {
    const t = String(ev.event_type || '').toLowerCase();
    return t.startsWith('auction_') || t === 'sale' || t === 'purchase';
  }},
  { key: 'discovery', label: 'DISCOVERY', match: (ev) => {
    const t = String(ev.event_type || '').toLowerCase();
    return t === 'vehicle_added' || t === 'mileage_reading' || t === 'registration';
  }},
];
```

2. Add `activeFilter` state to BarcodeTimeline:
```typescript
const [activeFilter, setActiveFilter] = useState('all');
```

3. Filter `timelineEvents` before building the `eventMap`:
```typescript
const filteredEvents = useMemo(() => {
  const filter = TIMELINE_FILTERS.find(f => f.key === activeFilter);
  if (!filter || activeFilter === 'all') return timelineEvents;
  return timelineEvents.filter(filter.match);
}, [timelineEvents, activeFilter]);
```

Use `filteredEvents` instead of `timelineEvents` in the existing `useMemo` that builds `eventMap`.

4. Render filter pills in the expanded heatmap view, above the day-of-week labels:
```
[ALL] [WORK] [PHOTOS] [SALES] [DISCOVERY]
```

Style: same as gallery toolbar buttons (`gallery-btn` class pattern — 8px uppercase, thin border, active state fills).

5. When a filter is active, the heatmap only shows dots for matching events. The barcode strip (collapsed view) always shows all events — filters only apply to the expanded heatmap.

6. Show a count badge on each filter pill: `WORK (14)`, `PHOTOS (7)`. Count from unfiltered `timelineEvents` so the user knows what each filter contains before clicking.

## Verify
- K2500 profile — expand timeline → filter pills appear above heatmap
- Click WORK → only work sessions show as colored cells → year separators still render correctly
- Click PHOTOS → only photo sessions show
- Click SALES → only auction events show
- Click ALL → everything returns
- Each pill shows its event count
- Collapsed barcode strip always shows all events regardless of filter
- Receipt popup works normally with filtered view

## Anti-Patterns
- Do NOT add filter state to VehicleProfileContext. This is local UI state scoped to BarcodeTimeline. Not cross-component.
- Do NOT re-query the database per filter. The events are already loaded. Filter client-side.
- Do NOT hide the filter pills when there's only one event type. If all events are work sessions, the pills still render — WORK (5) is useful information even if SALES (0) and PHOTOS (0) are empty.
- Do NOT disable pills with 0 count. Let the user click them — seeing an empty heatmap for SALES communicates "this vehicle has no auction history" which is meaningful.
- Do NOT create separate timeline components per filter. One component, one data source, filtered views. That's the whole point.

## Library Contribution
After completing:
- Update `docs/library/technical/design-book/vehicle-profile-computation-surface.md` — update the "Timeline IS the Vehicle" section with implementation status
- Update `docs/library/technical/design-book/03-interactions.md` — add "Timeline Filter Pills" interaction pattern
- Update `docs/library/reference/dictionary/README.md` — add "Timeline Filter Mode" definition
