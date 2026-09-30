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

## Owner notes, 2026-09-30

Relayed word for word from the pieces lane's window: "the homepage is still really annoying. the huge ugly list of cars isnt
exactly great. our goal is to zero in on the interesting edge cases across markets. no one wants to see huge lists of porsches.
they want to find the specific thing they are looking for. in our case we are looking to expose delicate threads of data
patterns".

What it asks of the front door, next to the treemap rules above and memory `feedback_homepage_design.md`:
- **Edge cases, not lists.** The page surfaces the unusual across markets: a lot running hot on activity while it reads cold on
  price, a sale far off its comparables, a thin cohort with a sudden run. A long list of one make is the failure mode.
- **Finding the specific thing.** It's a way in to what a visitor is looking for (search, drill), not a catalog to scroll.
- **Delicate threads of data patterns.** Each item says what pattern it is, with its numbers and basis. For example, the
  2026-09-29 SL500 case in `docs/features/ask-nuke/THEORY.md`, owner notes: its activity sat in the top half of 389 comparable
  lots while its price read cold.
- Status: captured, not built. market-home isn't running (LANES.md). The live-auction data it needs, comments and bids pulled on
  a schedule, is the bat-data audit's P1 (#450, held for a daytime rollout).
