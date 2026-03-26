# Homepage — Treemap Entry Point

## Purpose
First thing anyone sees. The front door. Communicates: "this is a data topology you can explore." Not a marketing page. Not a dashboard. A map of the entire collector vehicle market.

## Who sees this
Logged-out visitors. Logged-in users go straight to feed.

## Layout

```
┌─────────────────────────────────────────────────────────┐
│ NUKE    [SEARCH, PASTE URL, VIN, OR DROP IMAGE...]  [·] │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────┐┌────────┐┌──────┐┌────┐┌───────┐┌──┐    │
│  │          ││        ││      ││    ││       ││  │    │
│  │ CHEVROLET││ PORSCHE││ FORD ││BMW ││MERCEDES││..│    │
│  │  41,283  ││ 39,043 ││22,127││    ││       ││  │    │
│  │          ││        ││      ││    ││       ││  │    │
│  ├──────────┤├────────┤├──────┤│    │├───────┤│  │    │
│  │  8,412   ││  5,288 ││      ││    ││       ││  │    │
│  │ CORVETTE ││  911   ││      ││    ││       ││  │    │
│  └──────────┘└────────┘└──────┘└────┘└───────┘└──┘    │
│                                                         │
│                    [BROWSE ALL →]                        │
└─────────────────────────────────────────────────────────┘
```

## Elements

### Search Bar (top)
- **What**: Single input field
- **Why**: Magic box. Accepts text, URLs, VINs, images
- **Click/type**: Debounced 300ms autocomplete dropdown. URL detected → "EXTRACTING..." VIN detected → DB lookup. Make typed → stats preview.
- **Data**: `universal-search` edge function + `intentRouter`

### Treemap (center)
- **What**: Squarified treemap. Area = vehicle count per make.
- **Why**: Shows the entire market at a glance. Biggest makes = biggest cells.
- **Click make**: Zooms into that make → shows models as sub-treemap
- **Click model**: Navigates to `/?tab=feed&make=X&model=Y` (filtered feed)
- **Data**: `treemap_by_brand` and `treemap_models_by_brand` MVs
- **Color**: Median price hue scale (green=low, blue/indigo=high). NOT average.

### Browse All Button (bottom)
- **What**: Single button
- **Why**: Entry to unfiltered feed for people who don't want the treemap
- **Click**: `/?tab=feed`

## What's NOT on this page
- No images (data is crusty — boats, ATVs, trailers in recent additions)
- No marketing copy
- No stats dashboard
- No "sign up" CTA (that's in the header area)
- No average prices
