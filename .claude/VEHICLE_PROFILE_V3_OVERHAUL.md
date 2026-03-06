# V3 Vehicle Profile Overhaul — Agent Prompt

## Mission

Rewrite the vehicle profile page at `nuke.ag/vehicle/:id` so it looks and behaves **exactly** like the reference template at `/Users/skylar/Downloads/nuke-session-files/nuke-vehicle-v3/index.html`. That file is a self-contained HTML/CSS/JS mockup of a 1983 GMC K2500 — ignore the hardcoded data but replicate every visual detail, layout behavior, tooltip, popup, animation, and interaction. The production page must be pixel-identical in structure, using live data from Supabase.

**Read the entire reference file first.** It's ~2230 lines. Study every CSS rule, every HTML structure, every JS behavior. Then rebuild the React page to match.

---

## Reference Template Structure (what you must replicate)

The template has 5 layers stacked vertically:

### Layer 1: Site Header (32px, fixed, z-1000, #1a1a1a)
Already exists in the app. Don't touch it.

### Layer 2: Vehicle Sub-Header (36px, sticky below site header, z-900)
- **Left side:** Vehicle title (11px/700/uppercase/0.04em), mileage badge (mono 8px, dashed border, with tooltip showing mileage source/confidence/title status)
- **Right side:** ALL badges in a single row: SOLD/LIVE status, SOURCE (BaT/C&B/etc), PRICE ($31,000 mono), BIDS count, COMMENTS count, WATCHERS (eye icon), DQ score (color-coded), BUYER (@handle), SELLER (@handle), LOCATION (zip+state), TIME (relative)
- **Every badge has a hover tooltip** showing detailed data + DB field references
- **Badges are clickable:** BIDS scrolls to feed + activates bids filter, COMMENTS scrolls to feed + activates comments filter, PRICE/SOLD scrolls to pricing widget, SOURCE opens listing URL, BUYER/SELLER show dropdown cards with profile data
- This is the existing `VehicleHeader.tsx` — it needs heavy modification to match

### Layer 3: Barcode Timeline (10px collapsed, sticky below sub-header, z-850)
- **Collapsed:** 10px bar with "TIMELINE" label left, year range right (mono), colored stripes showing event density per week
- **Clickable to expand** into full GitHub-style heatmap grid (day cells, week columns, month labels)
- **Heatmap cells are clickable** — show a receipt-style popup with event details (date, items, costs, totals)
- **Receipt has prev/next navigation** between events
- **Multi-day events** (like a 5-day conversion) highlight all related cells in blue
- **Escape closes** expanded view
- Barcode colors: l0=transparent, l1=#d0d0d0, l2=#a0a0a0, l3=#606060, l4=#1a1a1a (grayscale, NOT green)
- Data source: `timelineEvents` array already available in VehicleProfile.tsx state

### Layer 4: Hero Image (260px, static, #2a2a2a background)
Already exists as `VehicleHeroImage.tsx`. Keep it.

### Layer 5: Two-Column Workspace (sticky below barcode, fills viewport)
- **Left column: 55%, white bg, overflow-y auto, overscroll-behavior contain**
- **Right column: 45%, #f5f5f5 bg, overflow-y auto, overscroll-behavior contain**
- **4px resizable divider** between columns (transparent, turns black on hover/drag, double-click resets to 55/45)
- **Columns position: sticky, top = h-site + h-sub + h-barcode = 78px**

---

## Left Column Widgets (in order)

**Widget chrome pattern** (applies to ALL widgets):
```
.widget { border-bottom: 1px solid #ddd; } /* NO outer border — they stack seamlessly */
.widget__header { padding: 10px 16px; min-height: 32px; border-bottom: 1px solid #f0f0f0; display: flex; justify-content: space-between; }
.widget__label { font: 700 8px/1 Arial; text-transform: uppercase; letter-spacing: 0.12em; color: #888; }
.widget__count { font: 400 7px/1 'Courier New'; color: #bbb; }
.widget__db { font: 400 6px/1 'Courier New'; color: #bbb; border: 1px solid #eee; padding: 1px 3px; } /* tooltip shows table.column */
.widget__body { padding: 10px 16px 14px; }
.widget__toggle { 14px chevron button, rotates when collapsed }
```

Widgets collapse/expand with max-height animation (300ms). Collapsed = max-height:0, padding:0, opacity:0.

### A) Vehicle Information
- Dense info table: key column (8px/700/uppercase/0.12em/#888, width 90px), value column (9px)
- Rows: Year, Make, Model, Body, Engine, Trans, Drivetrain, Exterior, Interior, VIN (mono), Title, Mileage
- **Provenance underlines:** Key fields (Make, Model, Engine, Drivetrain, VIN, Mileage) have dashed-bottom-border. Clicking shows a popover with SOURCE, CONFIDENCE, FIRST OBSERVED, CORROBORATING SOURCES
- Data: `vehicle` object fields

### B) Description
- 10px body text, max-width 65ch, 3-line clamp with SHOW MORE/SHOW LESS toggle
- **Subsections** (shown on expand): HIGHLIGHTS, EQUIPMENT, MODIFICATIONS — each with 8px/700/uppercase label
- Data: `vehicle.description`, `vehicle.highlights`, `vehicle.equipment`, `vehicle.modifications` (from `origin_metadata` if needed)

### C) Pricing & Value
- **4-tab toggle** in header: AUCTION | ESTIMATE | SIGNALS | JACKET
- **Auction tab:** 2-column pricing grid — Sold For (16px mono), High Bid (16px mono), Reserve, Total Bids, Watchers, Views
- **Estimate tab:** Nuke Estimate (16px mono), Range, Confidence (with progress bar), Deal Score, Heat Score
- **Signals tab:** Signal weights table (Comps, Rarity, Bid Curve, Condition, Sentiment, Originality, Market Trend)
- **Jacket tab:** Purchase Price, Total Recon, Gross Profit (green if positive)
- Data: `vehicle.sale_price`, `vehicle.high_bid`, `auctionPulse`, `vehicle.nuke_estimate`, `vehicle.deal_score`, `vehicle.heat_score`, `origin_metadata.deal_jacket_decomposed`

### D) Auction Analysis (if auction data exists)
- Sections: SUMMARY (9px paragraph), SENTIMENT ARC (4-stage flex row: Opening/Peak/Close/Verdict with sentiment scores), KEY MOMENTS (timeline with timestamps), TOP CONTRIBUTORS (user/influence/count/expertise rows)
- Data: `auction_events`, comment analysis data

### E) Service History (if service records exist)
- Records with: date (mono 8px), cost (mono 9px bold), shop name (9px/600/uppercase), location, work description, confidence score
- Data: service_records or origin_metadata.service_history

### F) Comments & Bids
- **Header has filter tabs:** ALL | BIDS (count) | COMMENTS (count)
- **Comment input:** text field + POST button
- **Feed items:** user (8px/700/uppercase), timestamp, source tag, bid label (BID/WINNER), amount (mono 10px bold)
- Winner item has green left border + green "WINNER" label
- Comments show text at 9px
- Data: existing VehicleCommentsSection data + auctionPulse bid data

---

## Right Column

### G) Images Gallery
- **Sticky header** at top of right column with:
  - View mode buttons: ZONES | GRID | FULL | INFO | SESSIONS | CATEGORY | CHRONO | SOURCE
  - Column slider: "COLS" label + range input (1-8) + value display
  - Collapse toggle
- **Content:** Images grouped by category (EXTERIOR — FRONT, EXTERIOR — DRIVER SIDE, REAR, INTERIOR, ENGINE BAY, UNDERBODY)
- Category labels: 8px/700/uppercase/0.12em/#888 with count
- 3px gap grid, square aspect thumbs, transparent→ink border on hover
- **Racing accent easter eggs:** nth-child hover colors cycle through Gulf Blue, Gulf Orange, Martini Red, JPS Gold, BRG, Papaya
- Data: existing ImageGallery component + YONO zone classifications from vehicle_images

### H) Vehicle Scores (below gallery)
- Score rows: label (8px/700/uppercase, 110px), progress bar (4px, #eee bg, #888 fill), value (mono 9px)
- Scores: Condition, Value Score, Investment Quality, Provenance, Desirability
- Null values show "--" in faint color with 0% bar
- Data: `vehicle.condition_rating`, `vehicle.value_score`, `vehicle.investment_quality_score`, `vehicle.provenance_score`, `vehicle.overall_desirability_score`

---

## CSS Rules (non-negotiable)

- **Zero border-radius everywhere** (already enforced by `* { border-radius: 0 !important; }`)
- **Font: Arial only** (Courier New for mono data)
- **Transitions: 180ms cubic-bezier(0.16, 1, 0.3, 1) only**
- **No shadows, no gradients**
- **Paper grain texture** on body: SVG fractalNoise overlay at 3% opacity (the `body::after` pseudoelement from the template)
- **Selection color:** black bg, white text
- **Scrollbar:** 4px width, #ddd thumb, transparent track
- **Widget stacking:** widgets separated by `border-bottom: 1px solid #ddd`, NOT individual bordered cards. They flow as a continuous stack.

---

## Existing Codebase (what you're modifying)

### Files to heavily modify:
- `nuke_frontend/src/pages/VehicleProfile.tsx` (~1900 lines) — main page, orchestrates everything
- `nuke_frontend/src/pages/vehicle-profile/VehicleHeader.tsx` (~5000 lines) — sub-header, needs badge system overhaul
- `nuke_frontend/src/pages/vehicle-profile/WorkspaceContent.tsx` (~390 lines) — two-column layout + widget rendering
- `nuke_frontend/src/styles/vehicle-profile.css` (~530 lines) — all V3 styles

### Files to create:
- `nuke_frontend/src/pages/vehicle-profile/BarcodeTimeline.tsx` — expandable barcode + heatmap + receipt popups (already exists but needs rewrite for grayscale + expand/heatmap/receipt)
- `nuke_frontend/src/pages/vehicle-profile/VehicleBadgeBar.tsx` — already exists but needs rewrite to move badges INTO sub-header
- `nuke_frontend/src/pages/vehicle-profile/ColumnDivider.tsx` — resizable divider component
- `nuke_frontend/src/pages/vehicle-profile/VehicleScoresWidget.tsx` — score rows with progress bars
- `nuke_frontend/src/pages/vehicle-profile/AuctionAnalysisWidget.tsx` — sentiment arc, key moments, contributors
- `nuke_frontend/src/pages/vehicle-profile/ServiceHistoryWidget.tsx` — service records display

### Files to reference but not create from scratch:
- `nuke_frontend/src/components/ui/CollapsibleWidget.tsx` — has `variant="profile"` support, can be adapted
- `nuke_frontend/src/components/images/ImageGallery.tsx` — existing gallery, wrap with V3 chrome
- `nuke_frontend/src/pages/vehicle-profile/VehicleBasicInfo.tsx` — rewrite to use V3 info-table pattern with provenance popovers
- `nuke_frontend/src/components/vehicle/VehicleDescriptionCard.tsx` — rewrite body to use desc-text pattern with show more/less + subsections

### Data already available in VehicleProfile.tsx state:
- `vehicle` — full vehicle record (year, make, model, vin, mileage, sale_price, description, etc.)
- `timelineEvents` — array of timeline events with dates
- `auctionPulse` — current_bid, bid_count, comment_count, watchers, views, etc.
- `liveSession` — live auction session if active
- `vehicleImages` — image URLs
- `session` — current user session
- `permissions` — what the user can do

---

## Implementation Strategy

1. **Start with CSS.** Port every rule from the template's `<style>` block into `vehicle-profile.css`. Use the existing `--vp-*` token prefix but match the template's actual values. The template uses `--border-primary: #1a1a1a`, `--text-secondary: #888`, etc.

2. **Rewrite WorkspaceContent.tsx** to match the template's column structure exactly. Left column white bg, right column #f5f5f5 bg. Widget stacking with border-bottom. Add the resizable column divider.

3. **Modify VehicleHeader.tsx** to render all badges in the sub-header. This is the hardest part — VehicleHeader is 5000 lines. Add badge tooltips, click behaviors (scroll to widget, show dropdown, open URL, filter feed).

4. **Rewrite BarcodeTimeline.tsx** with grayscale colors, click-to-expand, heatmap grid, receipt popups with prev/next navigation.

5. **Create new widget components** (AuctionAnalysis, ServiceHistory, VehicleScores) following the widget chrome pattern.

6. **Rewrite VehicleBasicInfo** to use the info-table pattern with provenance popovers.

7. **Add gallery toolbar** with view mode buttons, column slider, and the gallery-thumb racing accent hover easter eggs.

## Verification

1. `cd /Users/skylar/nuke/nuke_frontend && npx tsc --noEmit` — zero type errors
2. Dev server runs on localhost:5174
3. Navigate to a vehicle with data (e.g. `6442df03-9cac-43a8-b89e-e4fb4c08ee99` — K10 with 419 photos)
4. Visual comparison against the reference template opened side-by-side
5. Test all interactions: badge tooltips, badge clicks (scroll, filter, dropdown, open URL), barcode expand/collapse, heatmap cell click → receipt, receipt prev/next, widget collapse/expand, description show more/less, pricing tab toggle, gallery column slider, column divider drag/resize/double-click-reset
6. Push to main for Vercel deploy
