# Popups — The Rhizome Windows

## Purpose
Every click opens a window into deeper data. Popups stack. You can have 5 open. Each one is a terminal into a slice of the ontology. They never navigate away from the page underneath. The grid/feed/profile stays in place.

## Window Chrome

```
┌─ TITLE ────── [search...] ── [S] [M] [L] [—] [X] ─┐
│                                                       │
│                    (content)                          │
│                                                       │
└───────────────────────────────────────────────────────┘
```

- **Title bar**: dimension name + value (e.g. "PORSCHE", "911 TURBO", "BAT")
- **Search**: Contextual. Filters within THIS popup's data only.
- **S/M/L**: Size toggle. S=360px compact, M=460px standard, L=700px explorer.
- **—**: Minimize. Collapses to 24px title bar docked at screen bottom.
- **X**: Close this popup. Escape also closes top popup.
- **Drag**: Title bar is draggable.
- **Stack offset**: Each new popup shifts 20px right + 20px down.
- **Overlay**: Dim bg (rgba(0,0,0,0.2)) behind bottom-most popup only.

## Popup Types

### VehiclePopup (click a vehicle card)
```
┌─ 1996 PORSCHE 911 TURBO ─── [search] [S][M][L][—][X]─┐
│                                                         │
│ ┌────────────────────────────────────┐                  │
│ │           (hero image)             │                  │
│ └────────────────────────────────────┘                  │
│                                                         │
│ SOLD  $247,000                          BAT · 68 OBS   │
│                                                         │
│ DESCRIPTION                                             │
│ This 1996 Porsche 911 Turbo is finished in Arena Red... │
│ [READ MORE →]                                           │
│                                                         │
│ PRICE CONTEXT                                           │
│ $247K — 110% above median ($117K) for 911 Turbo        │
│ Confidence: 58%                                         │
│                                                         │
│ COMPARABLE SALES                                        │
│ ┌──────┐ ┌──────┐ ┌──────┐                            │
│ │$1.3M │ │$876K │ │$500K │  ← each clickable          │
│ │'94 TT│ │'94 TT│ │'96 TT│  → opens nested            │
│ └──────┘ └──────┘ └──────┘     VehiclePopup            │
│                                                         │
│ [VIEW ON SOURCE →]           [OPEN FULL PROFILE →]     │
└─────────────────────────────────────────────────────────┘
```

**S size**: Title + price + source + OPEN PROFILE link only
**M size**: Above layout (default)
**L size**: + full description + all comps + observation count + field evidence summary

### MakePopup (click PORSCHE badge)
```
┌─ PORSCHE ─────────────── [search] [S][M][L][—][X] ─┐
│                                                       │
│ VEHICLES    MEDIAN PRICE    PRICE RANGE    YEARS     │
│ 39,043      $52K            $2K-$3.5M     1952-2026  │
│                                                       │
│ TOP MODELS                                            │
│ [911] 8,412  [CAYENNE] 3,201  [BOXSTER] 2,876       │
│ [CAYMAN] 1,930  [944] 1,456  [928] 892              │
│ ← each clickable → ModelPopup                        │
│                                                       │
│ TOP SOURCES                                           │
│ [BAT] 12,430  [MECUM] 8,201  [BJ] 3,456            │
│ ← each clickable → SourcePopup                       │
│                                                       │
│ PRICE DISTRIBUTION                                    │
│ UNDER $10K  ████░░░░░  12%                           │
│ $10-25K     ██████░░░  18%                           │
│ $25-50K     █████████  28%                           │
│ $50-100K    ███████░░  22%                           │
│ $100-250K   ████░░░░░  14%                           │
│ $250K+      ██░░░░░░░   6%                           │
│                                                       │
│ [VIEW IN FEED →]                                     │
└───────────────────────────────────────────────────────┘
```

### SourcePopup (click BAT badge)
```
┌─ BAT ──────────────────── [search] [S][M][L][—][X] ─┐
│                                                       │
│ VEHICLES    MEDIAN PRICE    NEW THIS WEEK    LAST    │
│ 131,807     $42K            248             Mar 23    │
│                                                       │
│ FILL RATES                                            │
│ PRICE    ████████████████████  99%                    │
│ DESC     ████████████████████  98%                    │
│ VIN      ██████████████████░░  93%                    │
│ PHOTOS   ██████████████████░░  92%                    │
│ MILEAGE  ████████████████░░░░  79%                    │
│                                                       │
│ TOP MAKES                                             │
│ [PORSCHE] 12,430  [CHEVROLET] 9,201  [BMW] 7,456    │
│ ← each clickable → MakePopup                         │
│                                                       │
│ [VIEW IN FEED →]                                     │
└───────────────────────────────────────────────────────┘
```

### CommentsPopup (click COMMENTS badge)
```
┌─ COMMENTS (527) ────────── [search] [S][M][L][—][X] ─┐
│                                                         │
│ TOTAL 527 · 42 BIDS · 3 SELLER                         │
│                                                         │
│ ┌─────────────────────────────────────────────────────┐│
│ │ username123 · Mar 24, 2026                          ││
│ │ Bid for $875,000                               [BID]││
│ ├─────────────────────────────────────────────────────┤│
│ │ porsche_collector · Mar 24, 2026                    ││
│ │ Matching numbers per the Kardex. This is a serious  ││
│ │ car with documented provenance back to 1991.        ││
│ ├─────────────────────────────────────────────────────┤│
│ │ seller_name · Mar 23, 2026                   [SELLER]│
│ │ Thank you for the kind words. The service records...││
│ └─────────────────────────────────────────────────────┘│
│                                                         │
│ ← scrollable, searchable by keyword                     │
└─────────────────────────────────────────────────────────┘
```

### BidsPopup (click BIDS badge)
```
┌─ BIDS (8) ──────────────── [search] [S][M][L][—][X] ─┐
│                                                         │
│ HIGH BID: $901,000                                      │
│                                                         │
│ $901,000  ████████████████████████████████████  user8   │
│ $875,000  ██████████████████████████████████░░  user7   │
│ $850,000  ████████████████████████████████░░░░  user6   │
│ $800,000  ██████████████████████████████░░░░░░  user5   │
│ ...                                                     │
└─────────────────────────────────────────────────────────┘
```

### PriceContextPopup (click PRICE badge)
```
┌─ PRICE CONTEXT ─────────── [search] [S][M][L][—][X] ─┐
│                                                         │
│ THIS VEHICLE: $247,000 (SOLD)                           │
│ NUKE ESTIMATE: $117,350   CONFIDENCE: 58%               │
│ 110% ABOVE MEDIAN FOR 911 TURBO                         │
│                                                         │
│ COMPARABLE SALES (200 total)                            │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                   │
│ │$1.3M │ │$876K │ │$500K │ │$320K │ ← clickable       │
│ │'94   │ │'94   │ │'96   │ │'97   │                   │
│ └──────┘ └──────┘ └──────┘ └──────┘                   │
│                                                         │
│ PRICE RANGE: $35K — $1.3M                               │
│ MEDIAN: $117K                                           │
└─────────────────────────────────────────────────────────┘
```

## Interaction Rules
1. Every data element inside a popup is clickable → opens nested popup
2. Popups stack with 20px offset
3. Escape closes top popup only
4. Click outside closes top popup only
5. Search filters within popup content (not global)
6. Minimized popups dock as 24px bars at bottom
7. S/M/L changes width with 150ms transition
8. No popup shows average price. Use median + range.
9. No popup shows data that the parent already shows.
