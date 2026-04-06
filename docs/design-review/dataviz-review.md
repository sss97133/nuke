# Data Visualization Audit

**Reviewer:** Data Visualization Director
**Date:** 2026-04-05
**Scope:** Every data visualization component in nuke_frontend

---

## Executive Summary

Nuke has **12+ distinct data visualization systems** spanning treemaps, heatmaps, geographic maps, donut charts, bar charts, sparklines, SVG line charts, and timeline strips. The ambition is extraordinary -- this is the visual density of Bloomberg Terminal meets the interactivity of Observable. But the execution is uneven: the treemap homepage and barcode timeline are genuinely novel and near-professional quality, while several other visualizations are half-built, use inconsistent rendering approaches (React DOM vs D3 imperative vs recharts vs custom SVG), and some core data that should be visualized has no visualization at all.

**Overall verdict: 65/100 -- strong foundation, inconsistent execution, missing killer features.**

---

## 1. HOMEPAGE TREEMAP (squarified algorithm)

**File:** `src/pages/HomePage.tsx` (lines 50-157 algorithm, 316-506 cell rendering, 666-990+ main page)

### What it shows
Hierarchical vehicle market data: Makes -> Models -> Years -> Individual Vehicles. Drill-down navigation with breadcrumb. Each cell sized by vehicle count, colored by median price via CSS custom property heat scale (`--heat-0` through `--heat-6`).

### Assessment

**Algorithm quality: A**
The squarified treemap implementation (Bruls, Huizing, van Wijk 2000) is correct and well-implemented. It is a proper implementation of the published algorithm, not a wrapper around a library. The recursive `layoutRow` function handles both horizontal and vertical orientations, the `worstAspectRatio` function is mathematically correct, and the greedy row-building produces good-looking cells.

**Data quality: A-**
Rich tooltips show count, percentage, total value, median price, price range, sell-through rate, and average bids. Vehicle-level cells show images, listing titles, prices, and mileage. The data hooks (`useTreemapBrands`, `useTreemapModels`, etc.) pull from proper database RPCs and live queries.

**Rendering quality: B+**
- Cells are rendered as absolutely-positioned `<div>` elements (not SVG), which is correct for this use case -- allows CSS transitions, text wrapping, and image backgrounds naturally.
- Representative images appear at aggregate levels (models/years), giving visual identity to each cell.
- Price-to-color mapping uses the design system heat tokens, which means dark mode works.
- Text size adapts to cell area with four tiers: `area > 40000`, `> 15000`, `> 5000`, default.
- Hover states darken border to `--border-focus`.

**Interaction quality: B+**
- 4-level drill-down: brands -> models -> years -> individual vehicles -> vehicle profile.
- Breadcrumb navigation for going back up the hierarchy.
- **Prefetch on hover** with 200ms debounce -- hovering a model cell prefetches year data, hovering a year cell prefetches vehicle data. This eliminates loading flash on click.
- Zoom transition animation (180ms) when drilling in/out.
- Tooltip follows mouse with screen-edge clamping.

**Issues found:**
1. **Search dropdown z-index war**: The search bar overlays the treemap, and its dropdown has `zIndex: 10000` while the tooltip has `zIndex: 10000` -- they could fight.
2. **No keyboard navigation**: Cannot drill into cells with arrow keys or Enter. Accessibility gap.
3. **No loading skeleton for deep levels**: When navigating from brands to models, there is a blank flash before data arrives (prefetch mitigates but does not eliminate).
4. **Mobile experience**: Full-viewport treemap with 8px text is unusable on phone. No responsive breakpoint.
5. **`var(--surface-glass)` on vehicle cells**: The text band at bottom of vehicle cells uses a glass token that may not exist in the design system. This needs verification.

**What would make it go from B+ to Bloomberg:**
- Animated transitions between drill levels (cells should morph/zoom, not snap)
- A small sparkline in each aggregate cell showing price trend direction
- Right-click context menu: "View on map", "Compare with...", "Add to portfolio"
- Keyboard navigation for accessibility
- A "sort by" control: count, median price, total value, sell-through rate

---

## 2. BARCODE TIMELINE (vehicle profile)

**File:** `src/pages/vehicle-profile/BarcodeTimeline.tsx` (754 lines)
**CSS:** `src/styles/vehicle-profile.css` (lines 371-625)

### What it shows
A GitHub-style contribution heatmap showing the entire lifecycle of a vehicle, from the vehicle's year of manufacture to present day. Events include auction listings, sales, work sessions, photo sessions, mileage readings, and more. Collapsed state shows a thin barcode strip; expanded state shows the full heatmap grid.

### Assessment

**Concept quality: A+**
This is the single most novel visualization in Nuke. A "barcode of a vehicle's life" -- every day from 1977 to 2026, colored by activity intensity. No other car platform does this. The metaphor of "the timeline IS the vehicle" is perfectly expressed here.

**Data quality: A**
- Events sourced from `timelineEvents` in VehicleProfileContext, which aggregates multiple event types.
- Event labels are context-aware: "Listed on BaT", "Discovered on Craigslist", "Work: Fabrication (12 photos)".
- Source platform labels map slugs to human names (BaT, Mecum, PCarMarket, etc.).
- Adjacent work sessions are merged into multi-day groups.
- Cost accumulation per day with proper dollar formatting.

**Rendering quality: A-**
- Collapsed: thin strip where each week is a vertical stripe, colored by max activity level.
- Expanded: full 7-row x N-week grid with year separators, month labels, and day-of-week labels.
- Click a cell to open a "receipt" popup showing all events for that day with costs.
- Receipt has PREV/NEXT navigation to browse between active days.
- DayCard popup (lazy-loaded) for deep detail.
- Filter pills (ALL, WORK, PHOTOS, SALES, DISCOVERY) with live counts.

**Interaction quality: A-**
- Collapse/expand toggle with scroll-aware behavior (collapses on scroll down, expands on scroll to top).
- Escape key closes expanded view.
- Auto-scroll to most recent events when expanded.
- Cell click opens receipt; receipt click opens DayCard popup.
- Gallery filter synchronization: clicking a date filters the photo gallery to that day.
- Multi-day session highlighting with group borders.

**Issues found:**
1. **Receipt positioning uses `position: fixed`** with viewport-relative coords. On scroll within the heatmap, the receipt stays fixed while the grid scrolls away. Should be `position: absolute` relative to the heatmap container.
2. **Barcode strip collapsed state is extremely thin** (10px via `--vp-h-barcode`). At 10px, the individual week stripes are barely visible. Consider 16-20px for the collapsed strip.
3. **Year-spanning vehicles create enormous grids**: A 1967 Porsche has ~58 years x 52 weeks = ~3,000 columns. The horizontal scroll works but month labels become dense. Consider a decade-compressed view for vehicles older than 20 years.
4. **Tooltip on barcode stripes** is a plain div with `\n`-split text. Should match the receipt style for consistency.
5. **Color scale is 4 levels** (1-4 events). Work sessions with extensive photo documentation (30+ photos) look the same as a single mileage reading. Consider more granularity.

**What would make it go from A- to iconic:**
- Click a date range to zoom into that period (like GitHub contribution graph yearly view)
- Cost accumulation line overlaid on the heatmap (running total)
- Color-code by event type instead of just intensity (work=blue, sale=green, photo=orange)
- Right-click a day to add a new event
- Minimap at the top showing where you are in the full timeline when scrolled

---

## 3. GEOGRAPHIC MAP SYSTEM (NukeMap, DeckGLMap, ChoroplethMap)

**Files:**
- `src/components/map/NukeMap.tsx` (orchestrator, 181 lines)
- `src/components/map/DeckGLMap.tsx` (47 lines)
- `src/components/map/ChoroplethMap.tsx` (~1000+ lines)
- `src/components/map/layers/` (5 layer files: county, business, cluster, eventPoint, heatmap)

### What it shows
Two rendering modes:
1. **Choropleth mode** (default): US county-level vehicle density map using Leaflet with GeoJSON. Counties colored by vehicle count/value. State borders overlaid. Supports: proximity search (click to drop pin, adjustable radius), make-specific heatmap filter, drill down to county/state vehicle lists, and timeline scrubbing.
2. **Deck.gl mode**: Point-based map with clustering, business overlays, collection pins, and a heatmap layer. Sidebar panels for vehicle detail, org detail, and event pins.

### Assessment

**Ambition: A**
This is a serious geographic intelligence system. County-level choropleth, proximity search with configurable radius, make-specific overlays, and timeline scrubbing. This is closer to Bloomberg Terminal's geographic views than to a typical car listing site.

**Rendering quality: B**
- Choropleth uses Leaflet (not deck.gl) because Leaflet handles GeoJSON polygons more reliably.
- The heatmap layer (`layers/heatmapLayer.ts`) uses deck.gl's HeatmapLayer with an amber color ramp.
- The DraggablePanel for info/legend is a nice touch but the drag handle is only 3px high -- hard to discover.
- Dark CARTO basemap is well-chosen for data overlay visibility.

**Data quality: B+**
- Vehicle location observations with confidence scores (minimum 0.50 for proximity search).
- Business overlays from `businesses` table (3000 limit).
- County data from dedicated hooks with stats (totalCount, totalValue, countyCount).
- Timeline scrubbing filters temporally.

**Issues found:**
1. **Two completely different rendering engines** (Leaflet for choropleth, deck.gl for everything else) adds significant bundle size. They never show simultaneously, but both are loaded.
2. **Mode is hardcoded** to `'county'` (`const [mode] = useState<MapMode>('county')`). There is no UI to switch between choropleth and deck.gl modes. The mode switcher appears to have been removed or never exposed.
3. **Proximity search uses `MILES_TO_DEG = 1/69.0`** which is a rough constant. At high latitudes this is significantly wrong. For a US-only map this is acceptable but not great.
4. **Error boundary fallback** just says "MAP RENDERER UNAVAILABLE / WebGL initialization failed" with no recovery path.
5. **Loading states** show tiny 9px uppercase text that is easy to miss.

**What would make it go from B to must-have:**
- Expose the mode switcher (choropleth vs points vs heatmap)
- Animated transitions when zooming into a county/state
- Vehicle thumbnails in cluster popups (not just counts)
- "Find near me" using browser geolocation
- Price heatmap overlay (color by median price, not just count)

---

## 4. VISUAL VALUATION BREAKDOWN (donut chart)

**File:** `src/components/vehicle/VisualValuationBreakdown.tsx` (~1000+ lines)

### What it shows
A donut chart showing how a vehicle's estimated value breaks down by component (engine, body, interior, etc.). Three modes: Value (share of estimated value), Confidence (fact confidence distribution), Evidence (photo + receipt coverage). Custom SVG rendering using `describeDonutSegment` for arc paths.

### Assessment

**Concept quality: A**
This is a genuinely useful visualization. "Your car is worth $45K -- here is how that breaks down: engine $12K (high confidence, 8 photos), body $15K (medium confidence, 2 photos)." The three-mode switch (value/confidence/evidence) is smart -- it answers "what is it worth?", "how sure are we?", and "what have we documented?"

**Rendering quality: B+**
- Custom SVG donut segments with proper arc math (polar-to-cartesian conversion, large-arc flag handling).
- Color palette with 12 entries using design system tokens where possible.
- Hover interaction highlights segments.

**Issues found:**
1. **Extremely defensive value extraction**: `getComponentValue` tries 6 different field names (`estimatedValue`, `estimated_value`, `value`, `value_usd`, `amount`, fallback 0). This suggests the data shape is inconsistent across sources. The chart may silently show $0 for components that have data in an unexpected field.
2. **No animation**: Segments appear instantly. A build-up animation where segments grow from 0 to their final angle would add polish.
3. **Color palette repeats** at index 9 (duplicates `var(--info)` at index 0 and 8). With 12+ components this causes visual collision.
4. **SmartInvoiceUploader import**: This component imports an invoice uploader. The valuation breakdown component should not own upload functionality -- separation of concerns issue.
5. **CitationModal import**: Similarly couples citation viewing with the chart.

**What would make it better:**
- Entrance animation (segments grow sequentially)
- Click a segment to see the evidence (photos, receipts) for that component
- Compare mode: show two valuations side-by-side (before/after work)

---

## 5. PRICE DISTRIBUTION CHART

**File:** `src/components/charts/PriceDistribution.tsx` (199 lines)

### What it shows
Log-scale price histogram (15 buckets from $1K to $15M) showing vehicle count by price band for a given make. Pure HTML/CSS bars with hover interactivity. Also exports a `MiniDistribution` sparkline for inline use in treemap cells.

### Assessment

**Quality: A-**
This is a clean, well-executed histogram.
- Log-scale bucketing is correct for the car market (most vehicles cluster $10K-$100K, a long tail to $15M+).
- Hover shows exact count, percentage, and price range.
- Click navigates to browse with price filter pre-set.
- The MiniDistribution sparkline is thoughtful -- embedded in treemap cells it shows price distribution at a glance.
- Pure HTML/CSS rendering -- no library dependency, fast.

**Issues:**
1. **Monochrome only**: All bars are `var(--text-secondary)` at 0.45 opacity. Could use the heat scale to encode median days-on-market or sell-through rate.
2. **No Y-axis label**: The 120px bar height has no reference for what "tall" means. A count label on the left would help.
3. **X-axis labels only show 6 of 17 buckets**: `labelIndices = [0, 3, 6, 9, 12, 15]`. This is reasonable but the unlabeled buckets are invisible until hovered.

---

## 6. HEARTBEAT SYSTEM (BrandHeartbeat, HeartbeatModelBar, HeartbeatTrend)

**Files:**
- `src/feed/components/heartbeat/BrandHeartbeat.tsx` (169 lines)
- `src/feed/components/heartbeat/HeartbeatModelBar.tsx` (121 lines)
- `src/feed/components/heartbeat/HeartbeatTrend.tsx` (47 lines)
- `src/feed/components/heartbeat/HeartbeatStatCell.tsx` (referenced)

### What it shows
Market pulse for a specific make/model: total listings, median price, sell-through rate, sentiment, demand level. The HeartbeatModelBar renders a **recharts Treemap** showing model distribution within a make. HeartbeatTrend shows P25/P75 prices, average days on market, rarity, and collector demand.

### Assessment

**Quality: B**
- HeartbeatStatCell is a compact label+value pattern that works well at 9px.
- The stat grid (listings, median, sell-through, sentiment, demand) gives genuine market intelligence in minimal space.
- HeartbeatTrend adds quartile pricing and trend direction arrows.

**Issues:**
1. **HeartbeatModelBar uses recharts Treemap** while the homepage treemap and HeroHeatPanel both implement squarified treemap from scratch. Three different treemap implementations in one app. The recharts one has weaker styling (SVG `<rect>` elements with limited text fitting) compared to the DOM-based custom implementations.
2. **Grayscale palette** (`shade()` function) makes all model tiles look similar. The homepage treemap uses price-based heat coloring which is much more informative.
3. **Click handler is indirect**: Click sets hovered model state, then a parent click handler reads it. This is fragile.
4. **No loading state** for model stats when drilling to a specific model.

---

## 7. HERO HEAT PANEL

**File:** `src/feed/components/hero/HeroHeatPanel.tsx` (497 lines)

### What it shows
"Hot Right Now" -- horizontally scrollable cards showing vehicles with highest heat scores and comment velocity (7-day), plus a make-heat treemap sidebar.

### Assessment

**Quality: B+**
- Hot vehicle cards are compact (160px wide) with thumbnail, heat score badge, rank badge, year/make/model, and price.
- Comment velocity cards show 7-day comment count badges.
- The make heat treemap in the sidebar is a fourth treemap implementation (after HomePage, HeartbeatModelBar/recharts, and MarketMap/d3).
- Layout is well-organized: scrollable cards left, treemap sidebar right.

**Issues:**
1. **Fourth treemap implementation**: `squarify` is re-implemented yet again with slightly different signatures. Should be a shared utility.
2. **Click on HotCard filters by make** rather than navigating to the vehicle profile. This is confusing -- clicking a specific vehicle card should go to that vehicle.
3. **VelocityCard font size is 7px** for the vehicle name. This is below legibility threshold for most screens.
4. **No scroll indicators**: The horizontal card list has `scrollbarWidth: 'none'` so there is no visual affordance that it scrolls.

---

## 8. AUCTION TRENDS DASHBOARD

**File:** `src/components/admin/AuctionTrendsDashboard.tsx` (709 lines)

### What it shows
Comprehensive auction market intelligence: sentiment gauge, weekly price trend chart, platform activity multi-line chart, hourly auction endings distribution, platform sell-through bars, segment leaders table, price distribution bars, bid depth analysis, comment mood sentiment, supply vs demand chart, estimate accuracy stats, tier weighting, and market quality badge.

### Assessment

**Concept quality: A+**
This is the most data-rich single component in the app. 12 distinct sub-visualizations on one page, all driven by the `auction-trends-stats` edge function. This is Bloomberg-level market intelligence.

**Rendering quality: B+**
- Custom SVG line charts for price trend, platform activity, and supply/demand.
- The `SentimentGauge` is a clever half-circle dial with a rotating needle.
- Platform activity chart supports hover isolation (highlight one line, dim others).
- All charts use proper SVG viewBox for responsive scaling.

**Issues:**
1. **SVG gradient in PriceTrendChart**: `<linearGradient id="priceGradient">` violates the "zero gradients" design rule from the frontend rules file. Should be a solid fill at reduced opacity.
2. **Admin-only visibility**: This dashboard lives in `/admin/`. The market intelligence here is genuinely useful to ALL users, not just admins. The sentiment gauge, price trends, and platform performance should be accessible from the homepage or market view.
3. **No data freshness indicator**: Shows `Updated: {date}` at bottom but no staleness warning if data is days old.
4. **Platform colors are hardcoded hex values** with a comment acknowledging this. Most match the design system intent but they do not use CSS custom properties, so dark mode may have contrast issues.
5. **`var(--grey-100)`, `var(--grey-300)`, `var(--grey-50)`** are used throughout -- these appear to be Tailwind-style tokens that may not exist in the unified design system. Need verification.
6. **`var(--text-muted)`** vs `var(--text-secondary)` vs `var(--text-disabled)` -- three different low-emphasis text tokens are used inconsistently.

---

## 9. MARKET MAP (d3 treemap)

**File:** `src/components/market/MarketMap.tsx` (553 lines)

### What it shows
A full-page treemap using **d3.v7 loaded from CDN** with three view modes (segment, source, brand), two metrics (value, count), nested treemap support (parent containers with labeled headers + child tiles), and multi-level drill-down with breadcrumb navigation.

### Assessment

**Quality: B-**

**Issues:**
1. **d3 loaded from CDN at runtime**: `document.createElement('script'); script.src = 'https://d3js.org/d3.v7.min.js'`. This is a red flag -- it adds latency on first load, fails if CDN is down, and the entire d3 library is loaded for just `d3.treemap` and `d3.hierarchy`. Should use `d3-hierarchy` npm package.
2. **Imperative DOM manipulation**: `document.createElement('div')` with inline `cssText` strings, manual event handlers via `.onmouseover`, `.onclick`. This bypasses React completely, losing all benefits of React's reconciliation, accessibility, and state management.
3. **Hardcoded colors**: `background: '#f0efe8'`, `border: '1px solid #2a2a2a'`, `color: '#1a1a1a'`. No design system tokens. Will look wrong in dark mode.
4. **Border-radius: 0** is explicit in the `cssText` strings (good -- matches design system).
5. **Different treemap algorithm**: Uses `d3.treemapSquarify.ratio(1.2)` for nested and `.ratio(1)` for flat. The homepage uses a custom squarified implementation. Different tuning parameters mean visually different results for the same data.
6. **sqrt scaling**: `Math.sqrt(metricVal(d))` is applied before treemap layout. This compresses the visual difference between large and small values. The homepage treemap uses linear scaling. Inconsistent visual language.
7. **No empty state handling**: If the edge function returns empty data, the container is just blank.
8. **Font family is system default** (`-apple-system, BlinkMacSystemFont, sans-serif`) instead of Arial per the design system.

---

## 10. BUILD TIMELINE CHART

**File:** `src/pages/vehicle-profile/BuildTimelineChart.tsx` (220 lines)

### What it shows
Monthly bar chart showing build spending and photo documentation activity over time. Overlays monthly spend bars with photo count bars in Gulf orange. Build phases (Baseline, Planning, Acquisition, Fabrication, Wiring, Current) are marked above the chart with colored lines.

### Assessment

**Quality: A-**
This is a genuinely useful project tracker visualization. The build phase overlay is the kind of thing that makes Nuke feel like a serious tool.

- P90 capping for spend max prevents one outlier month (vehicle purchase) from crushing all other bars -- smart statistical choice.
- Phase labels at 6px are small but work as contextual markers.
- Tooltip pins to edges when near the chart boundary to prevent clipping.
- Orange photo overlay at 40% opacity creates a clear dual-axis reading.

**Issues:**
1. **Hardcoded phases**: `BUILD_PHASES` has fixed date ranges (2021-01 through 2027-12). This is specific to one vehicle. Should be driven by data or user-defined.
2. **Phase colors use tokens** (`var(--info)`, `var(--warning)`, etc.) except `var(--chart-purple)` which may not exist in the design system.
3. **6px label text** is at the absolute floor of legibility.
4. **No total accumulation line**: A cumulative spend line would show the total investment trajectory.

---

## 11. ORGANIZATION TIMELINE HEATMAP

**File:** `src/components/organization/OrganizationTimelineHeatmap.tsx` (509 lines)

### What it shows
GitHub-style 53-week rolling contribution heatmap for an organization. Shows events, labor hours, value generated, active days, and streak statistics. Click a day to see either commit details or work order viewer.

### Assessment

**Quality: B+**
Faithful adaptation of the GitHub contribution graph. The automotive twist (work orders, labor hours, parts costs instead of commits) is well-executed.

**Issues:**
1. **Tailwind class names** (`hover:ring-2 hover:ring-blue-300 transition-all cursor-pointer`, `card`, `card-body`, `card-header`, `p-2`, `text-small`, `font-bold`) are mixed with inline styles. The project uses a custom design system, not Tailwind. These classes may not resolve or may conflict.
2. **Full-screen fixed modal** for commit detail (`position: fixed; inset: 0; zIndex: 1000`). This hijacks the entire viewport. Should use the popup system.
3. **`ReactDOM` import** is present but not used for createPortal (was removed?). Dead import.
4. **Mobile scroll hint** ("Swipe to view last 53 weeks") is always visible, even on desktop. Should be conditional on viewport width.

---

## 12. MAP HEATMAP LAYER

**File:** `src/components/map/layers/heatmapLayer.ts` (24 lines)

### What it shows
deck.gl HeatmapLayer for geographic vehicle density.

**Quality: B+**
Compact, clean implementation. Amber color ramp matches the Nuke aesthetic. Weight function correctly uses cluster count for aggregated features. The `radiusPixels: 40`, `intensity: 1.5`, `threshold: 0.05` parameters produce a good visual result.

**Issue:** The last color entry `[255, 60, 10, 240]` shifts toward red. The color ramp should stay consistently amber/orange to match the brand.

---

## DATA THAT SHOULD HAVE VISUALIZATIONS BUT DOES NOT

### Critical gaps:

1. **Price history over time for a vehicle**: The system tracks auction events with prices and dates. A simple line chart showing "this 1977 Blazer was listed at $28K in 2022, sold at $31K in 2024, current estimate $38K" would be the single most valuable chart for any user looking at a vehicle profile. **This does not exist.**

2. **Comparable sales scatter plot**: The comps data (`get_comps` MCP tool) returns actual auction results from multiple platforms. A scatter plot of year vs price, colored by platform, with the subject vehicle highlighted, would be immediate market context. **This does not exist.**

3. **Provenance network graph**: Vehicles have ownership chains, organizational relationships, and geographic movements. A node-link diagram showing "owned by dealer X (Las Vegas) -> sold on BaT -> owned by collector Y (New Jersey) -> serviced at shop Z" would be unique in the industry. **This does not exist.**

4. **Condition radar/spider chart**: The YONO vision system classifies 41 zones. A radar chart showing condition scores by zone (exterior front: 4/5, interior: 3/5, engine bay: 5/5, etc.) would instantly communicate vehicle condition. **This does not exist.**

5. **Market segment trends**: Weekly/monthly average prices by segment (American muscle, German sports, Japanese classics, etc.) would be the "stock market ticker" that makes Nuke the Bloomberg of cars. **This does not exist as a user-facing visualization** (it exists inside the admin AuctionTrendsDashboard but not in the main app).

---

## CROSS-CUTTING ISSUES

### Issue 1: Four separate treemap implementations

| Location | Method | Library |
|----------|--------|---------|
| HomePage.tsx | Custom squarified (DOM divs) | None |
| HeroHeatPanel.tsx | Custom squarified (DOM divs) | None |
| HeartbeatModelBar.tsx | recharts Treemap (SVG) | recharts |
| MarketMap.tsx | d3.treemap (imperative DOM) | d3 from CDN |

**Recommendation:** Extract the custom squarified algorithm into `src/lib/treemap.ts`. Delete the recharts and d3 implementations. Use one algorithm, one rendering approach (DOM divs with CSS), everywhere.

### Issue 2: Inconsistent chart rendering

Some charts use custom SVG (`AuctionTrendsDashboard`), some use pure HTML bars (`PriceDistribution`), some use recharts (`HeartbeatModelBar`), some use d3 (`MarketMap`), some use deck.gl (`DeckGLMap`), and some use Leaflet (`ChoroplethMap`). There is no shared chart primitive.

**Recommendation:** Standardize on custom SVG for small charts (sparklines, line charts, bar charts) and the custom DOM treemap for treemaps. Remove recharts dependency. Move d3 to npm package for the one place it is needed (geographic map). This reduces bundle size and creates visual consistency.

### Issue 3: Color inconsistency

- Some charts use `var(--heat-N)` tokens (correct)
- Some use `var(--success)`, `var(--error)`, `var(--info)` tokens (correct)
- Some use hardcoded hex: `'#f0efe8'`, `'#2a2a2a'`, `'#dc6b16'`
- Some use `var(--grey-100)` which may not exist
- Some use `var(--text-muted)` while others use `var(--text-disabled)` for the same semantic purpose

**Recommendation:** Audit every hardcoded hex value. Replace with design system tokens. Verify that all referenced tokens actually exist in `unified-design-system.css`.

### Issue 4: Missing animation standards

Most visualizations appear instantly with no entrance animation. The treemap has a basic zoom transition (180ms) but no cell morphing. Bar charts snap into place. The sentiment gauge rotates (0.5s ease-out) but this is the exception.

**Recommendation:** Define a standard entrance animation: bars grow from baseline, donut segments sweep from 12 o'clock, treemap cells fade in from parent position. Use the 180ms cubic-bezier easing from the design system.

### Issue 5: Dark mode readiness

Components using CSS custom properties (`var(--text)`, `var(--surface)`, `var(--border)`) will work in dark mode. Components with hardcoded colors will break. The MarketMap is the worst offender with `#f0efe8` backgrounds and `#1a1a1a` text.

---

## PRIORITY RECOMMENDATIONS

### P0 -- Critical (do these first)
1. **Add price history chart to vehicle profile** -- most impactful missing visualization
2. **Extract shared treemap utility** -- eliminate 3 of 4 implementations
3. **Fix MarketMap dark mode** -- replace all hardcoded hex with tokens
4. **Remove d3 CDN load** -- use npm package or remove d3 dependency entirely

### P1 -- High (do these soon)
5. **Add comparable sales scatter plot to vehicle profile**
6. **Surface AuctionTrendsDashboard to non-admin users** (or extract key charts)
7. **Fix receipt positioning** in BarcodeTimeline (absolute vs fixed)
8. **Add condition radar chart** using YONO zone data
9. **Fix SVG gradient** in AuctionTrendsDashboard PriceTrendChart

### P2 -- Medium (do when possible)
10. **Standardize text tokens** -- pick one for each semantic level and use it everywhere
11. **Add entrance animations** to all chart types
12. **Make BuildTimelineChart phases data-driven** instead of hardcoded
13. **Expose map mode switcher** in NukeMap
14. **Add keyboard navigation** to homepage treemap

### P3 -- Aspirational
15. **Provenance network graph** (node-link diagram)
16. **Market segment trend "ticker"** on homepage
17. **Animated treemap transitions** (cell morphing on drill)
18. **Right-click context menus** on all interactive visualizations

---

## VERDICT

The visualization layer is Nuke's most distinctive feature. The treemap homepage and barcode timeline are genuinely novel -- no competitor has anything comparable. The geographic map system is ambitious and mostly works. The auction trends dashboard is rich with market intelligence.

But the execution is fragmented: four treemap implementations, three rendering approaches, inconsistent color systems, and the most impactful visualization (price history over time) does not exist. Fixing the foundation (shared treemap, consistent tokens, entrance animations) and adding the one missing killer chart (price history) would transform this from "impressive demo" to "I can't use any other platform."

The data is there. The concepts are there. The gap is consolidation and completion.
