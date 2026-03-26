# Browse — Make → Model → Vehicles Explorer

## Purpose
Alternative to the feed for people who want to explore by taxonomy. Not a search, not a feed — a directory. Like browsing folders on a hard drive.

## Layout

### Level 0: All Makes (`/browse`)

```
┌─────────────────────────────────────────────────────────┐
│ [search filter...]                                      │
│                                                         │
│ ALL MAKES                                               │
│                                                         │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│ │ [C]      │ │ [P]      │ │ [F]      │ │ [B]      │   │
│ │CHEVROLET │ │ PORSCHE  │ │   FORD   │ │   BMW    │   │
│ │ 41,283   │ │  39,043  │ │  22,127  │ │  19,801  │   │
│ │ $38K med │ │  $52K med│ │  $28K med│ │  $31K med│   │
│ │Corvette  │ │ 911      │ │ Mustang  │ │ 3 Series │   │
│ │C10, Camaro│ │Cayenne  │ │ Bronco   │ │ M3       │   │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
│ ... (4-6 columns, sorted by vehicle count)              │
└─────────────────────────────────────────────────────────┘
```

- Searchable filter at top
- Each cell: initial square, make name, count, median price, top 3 models
- Click → drills to Level 1

### Level 1: Models for a Make (`/browse?make=Porsche`)

```
┌─────────────────────────────────────────────────────────┐
│ ALL MAKES / PORSCHE                                     │
│                                                         │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│ │   911    │ │ CAYENNE  │ │ BOXSTER  │ │ CAYMAN   │   │
│ │  8,412   │ │  3,201   │ │  2,876   │ │  1,930   │   │
│ │$52K-$3.5M│ │$18K-$180K│ │$12K-$95K │ │$22K-$120K│   │
│ │ 78% sold │ │ 62% sold │ │ 71% sold │ │ 68% sold │   │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
└─────────────────────────────────────────────────────────┘
```

- Breadcrumb: ALL MAKES / PORSCHE
- Each cell: model name, count, price range, sold ratio
- Click → Level 2 (filtered feed)

### Level 2: Vehicles (`/browse?make=Porsche&model=911`)

- Breadcrumb: ALL MAKES / PORSCHE / 911
- Infinite scroll vehicle grid (same as feed cards)
- Sort options: price, year, recent
