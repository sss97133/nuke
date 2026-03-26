# Vehicle Profile — The Dossier

## Purpose
Everything known about one vehicle. Every fact attributed. Every number sourced. The deepest view. This is where the ontology becomes visible — not just what the car IS, but where we learned it, how confident we are, and what the market says.

## Who sees this
Anyone who clicks "OPEN FULL PROFILE" from a popup or navigates to `/vehicle/:id`.

## Layout

```
┌─────────────────────────────────────────────────────────┐
│ NUKE    [SEARCH, PASTE URL, VIN, OR DROP IMAGE...]  [·] │
├─────────────────────────────────────────────────────────┤
│ [■] 1989 PORSCHE 911 6-Speed Manual by Singer     [×]  │
├─────────────────────────────────────────────────────────┤
│ [1989] [PORSCHE] [911 CARRERA 4 COUPE] [660 MI]       │
│ [COUPE] [MANUAL] [RWD] [CA]                            │
│ ← dimension badges only, all clickable → popups        │
├─────────────────────────────────────────────────────────┤
│ ┌─ AUCTION BANNER (if live/recent auction) ────────────┐│
│ │ ■ LIVE  BAT  1d 10h        [BID NOW] [VIEW LISTING] ││
│ │ CURRENT BID  BIDS  WATCHING  COMMENTS                ││
│ │ $901,000     8     3,379     527                     ││
│ │ ← all clickable → popups with deeper data            ││
│ └──────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────┤
│ ┌─ TIMELINE (compressed, only event months) ───────────┐│
│ │ ··· [MAR APR] 2026                                   ││
│ │     [■ ■]  ← green dots = events                     ││
│ └──────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────┤
│                                                         │
│ ┌─ HERO IMAGE ─────────────────────────────────────────┐│
│ │                                                       ││
│ │              (primary vehicle image)                  ││
│ │                                                       ││
│ └──────────────────────────────────────────────────────┘│
│                                                         │
│ 317 IMAGES · 315 OBSERVATIONS · 4 EVENTS · UPDATED 12H │
│                                                         │
├──────────────────────┬──────────────────────────────────┤
│ VEHICLE INFORMATION  │ IMAGES 317                       │
│                      │ [ZONES][GRID][FULL][INFO]        │
│ VIN    WP0AB296...   │ [SESSIONS][CATEGORY][CHRONO]     │
│ ENGINE 3.6L Flat-6   │ [SOURCE]                         │
│ TRANS  6-Speed Manual │                                  │
│ DRIVE  AWD           │ ┌────┐┌────┐┌────┐┌────┐       │
│ COLOR  Silver / Black│ │    ││    ││    ││    │       │
│ MILES  660           │ │img ││img ││img ││img │       │
│ BODY   Coupe         │ │    ││    ││    ││    │       │
│                      │ └────┘└────┘└────┘└────┘       │
│ ← each row clickable │ └────┘└────┘└────┘└────┘       │
│   → field provenance │                                  │
│   drawer showing     │                                  │
│   source + confidence│                                  │
│                      │                                  │
│ DESCRIPTION          │                                  │
│ This 1989 Porsche... │                                  │
│ (full listing text)  │                                  │
│                      │                                  │
│ LISTING DETAILS      │                                  │
│ · Highlights (5)     │                                  │
│ · Equipment (13)     │                                  │
│ · Modifications (4)  │                                  │
│ · Service History (6)│                                  │
│ · Title: Clean IL    │                                  │
│                      │                                  │
│ COMPARABLE SALES     │                                  │
│ ┌──────┐┌──────┐    │                                  │
│ │ img  ││ img  │    │                                  │
│ │$640K ││$580K │    │                                  │
│ │ 911  ││ 911  │    │                                  │
│ └──────┘└──────┘    │                                  │
│                      │                                  │
│ OBSERVATION TIMELINE │                                  │
│ (chronological list  │                                  │
│  of all observations │                                  │
│  with source + kind) │                                  │
└──────────────────────┴──────────────────────────────────┘
```

## Elements

### Tab Bar (below header)
- Vehicle name with close X
- Sticky below main header

### Dimension Badges (below tab)
- ONLY: year, make, model, trim, mileage, body, transmission, drivetrain, location
- Each clickable → opens MakePopup/ModelPopup etc via popup stack
- NO: price, LIVE, source, comments, watchers (those go in auction banner)

### Auction Banner (if applicable)
- Light theme (var(--surface) bg, NOT dark)
- Platform abbreviation badge (BAT, C&B, MECUM)
- Time remaining with urgency color
- BID NOW → links to source listing (green CTA)
- VIEW LISTING → links to source listing
- Stat badges: CURRENT BID, BIDS, WATCHING, COMMENTS
- ALL stat badges clickable → popups:
  - COMMENTS → CommentsPopup (scrollable, searchable)
  - BIDS → BidsPopup (bid history with proportional bars)
  - WATCHING → WatchersPopup (vs model average)
  - CURRENT BID → PriceContextPopup (estimate, comps, vs median)

### Timeline
- Compressed: only shows months with events, gaps shown as "···"
- For a 1989 car with 2026 events: one gap + ~4 months, NOT 37 years of empty cells
- Hidden entirely if zero events

### Hero Image
- Primary vehicle image, large
- Blurred backdrop fallback

### Quick Stats Bar
- One line: `317 IMAGES · 315 OBSERVATIONS · 4 EVENTS · UPDATED 12H AGO`
- Each clickable

### Left Column: Vehicle Information
- Spec rows: VIN, ENGINE, TRANS, DRIVE, COLOR, MILES, BODY
- Each row clickable → FieldProvenanceDrawer showing:
  - Where this data came from (BaT listing, AI extraction, etc)
  - Confidence score
  - Conflicting evidence if any
- DESCRIPTION: Full listing text
- LISTING DETAILS: Highlights, equipment, mods, service history, title
- COMPARABLE SALES: 3-8 similar vehicles with prices, clickable
- OBSERVATION TIMELINE: All observations chronologically

### Right Column: Images
- Tab bar: ZONES, GRID, FULL, INFO, SESSIONS, CATEGORY, CHRONO, SOURCE
- Image grid
- Each image shows zone/category metadata on hover

## What's NOT on this page
- No average prices
- No redundant data (if it's in dimension badges, it's NOT in the auction banner)
- No dark-themed sections
- No emojis
- No "Connect to Bid" branding buttons
- No dead badges (everything clicks)
