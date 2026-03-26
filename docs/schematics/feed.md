# Feed — The Market Floor

## Purpose
The core experience. A live, filterable, sortable stream of every vehicle in the system. Feels like scrolling through the entire collector car market. Fresh every visit. Personalized if you've been here before.

## Who sees this
Everyone. Logged-out users access via treemap drill or BROWSE ALL. Logged-in users land here directly.

## Layout

```
┌─────────────────────────────────────────────────────────┐
│ NUKE    [SEARCH, PASTE URL, VIN, OR DROP IMAGE...]  [·] │
├─────────────────────────────────────────────────────────┤
│ SHOWING   VALUE    TODAY    FOR SALE   LIVE    [CLEAR]  │
│ 150/387K  $18.1B   +3,903   36K       1,597            │
├─────────────────────────────────────────────────────────┤
│ SORT: [RANK] NEWEST OLDEST FINDS DEALS HEAT PRICE↓↑    │
│       YEAR MILES                     [AA──] [6──] [▦▤▥] │
├─────────────────────────────────────────────────────────┤
│ ┌─ HERO PANEL (slides down when sort button clicked) ──┐│
│ │ (content depends on which sort — see hero-lenses.md) ││
│ └──────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────┤
│ ┌─ RETURN VISIT BANNER (if return visitor) ────────────┐│
│ │ SINCE YOUR LAST VISIT: +47 Porsches, 3 price drops  ││
│ └──────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────┤
│ ┌─ INTEREST CHIPS (if has interests) ──────────────────┐│
│ │ YOUR INTERESTS: PORSCHE (8) | 911 (4) | K5 (2)      ││
│ └──────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────┤
│ ┌─ RECENTLY VIEWED (if has view history) ──────────────┐│
│ │ [thumb][thumb][thumb][thumb][thumb] →                 ││
│ └──────────────────────────────────────────────────────┘│
├────────┬────────────────────────────────────────────────┤
│FILTERS │ ┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐     │
│        │ │ img  ││ img  ││ img  ││ img  ││ img  │     │
│ YEAR   │ │      ││      ││      ││      ││      │     │
│ [__-__]│ │TITLE ││TITLE ││TITLE ││TITLE ││TITLE │     │
│        │ │SRC·ST││SRC·ST││SRC·ST││SRC·ST││SRC·ST│     │
│ MAKE   │ └──────┘└──────┘└──────┘└──────┘└──────┘     │
│ [chips]│                                                │
│        │ ═══ SIGNAL CARD: LIVE AUCTION ════════════     │
│ BODY   │ ┌─ 1989 PORSCHE 911 ── BID $901K ── 1D ─┐    │
│ [chips]│ └────────────────────────────────────────┘    │
│        │                                                │
│ PRICE  │ ┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐     │
│ [__-__]│ │      ││      ││      ││      ││      │     │
│        │ │ ...more vehicle cards...                │     │
│ STATUS │                                                │
│ [chips]│ ═══ SIGNAL CARD: DEAL ALERT ══════════════     │
│        │                                                │
│ SOURCE │ ┌──────┐┌──────┐┌──────┐ ... infinite scroll   │
│ [chips]│                                                │
└────────┴────────────────────────────────────────────────┘
```

## Elements

### Stats Strip (sticky below header)
- **SHOWING**: X / Y (filtered / total). Click → reset filters.
- **VALUE**: Total dollar value of filtered set. Click → sort by price.
- **TODAY**: Green "+N" new today. Click → filter to last 24h.
- **FOR SALE**: Active listings count. Click → for_sale filter.
- **LIVE**: Live auction count (red). Click → sort by feed_rank (live boost).
- **CLEAR**: Reset all filters. Only shows when filters active.
- **All numbers in Courier New. Labels 8px UPPERCASE.**

### Sort Toolbar
- Each button is a LENS, not just a sort. Click opens hero panel above feed.
- **RANK**: Default composite score. No hero panel.
- **NEWEST**: Hero shows source flow bars + make heatmap + price brackets.
- **FINDS**: Hero shows multi-signal story cards (barn finds, rare, deals).
- **DEALS**: Hero shows deal cards with discount %, make distribution.
- **HEAT**: Hero shows hot vehicles, comment velocity, make heat.
- **PRICE↓/↑**: Hero shows price bracket bars.
- **YEAR**: Hero shows decade timeline bars.
- **MILES**: Hero shows mileage bucket bars.
- Right side: column count slider, fit mode, view mode toggle (grid/list/tech).

### Vehicle Cards (grid)
- **Image**: Clean. No overlays. No badges on image.
- **Below image**: Title (11px Arial UPPERCASE)
- **Info line**: `SOURCE · STATUS · TIME` left, `PRICE` right (8px Courier)
- **Click**: Opens VehiclePopup in popup stack (grid doesn't reflow)

### Signal Cards (injected every 5 rows)
- **LIVE AUCTION**: Red border, pulsing dot, countdown, BID NOW
- **DEAL ALERT**: Green border, "X% BELOW MARKET", crossed estimate
- **PRICE DROP**: Blue border, for viewed vehicles that dropped
- **NEW FROM SOURCE**: Orange border, "47 NEW FROM GOODING" + thumbnails
- **COMMENT HIGHLIGHT**: Grey border, quoted comment + vehicle context

### Sidebar Filters
- **YEAR**: Two inputs (From/To). Type freely, commits on blur/Enter.
- **MAKE**: Clickable chips. Multiple select.
- **BODY STYLE**: Chips (COUPE, CONVERTIBLE, PICKUP, SEDAN, SUV, etc)
- **PRICE**: Two inputs (Min/Max)
- **STATUS**: FOR SALE, SOLD ONLY, HIDE SOLD, 4X4/AWD, HAS PHOTOS, DEALERS
- **SOURCE**: Chips per platform (show/hide)

## What's NOT on this page
- No average prices (ever)
- No marketing content
- No badges that repeat information already in the title
- No dark-themed sections
