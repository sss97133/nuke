# Ralph Wiggum UI Fix Plan

## Current Mission: UI Quality & Consistency

Started: 2026-01-23
Target: 5+ hours autonomous work (~75 loops)

---

## PHASE 1: VEHICLE PROFILE - COLLAPSIBLE WIDGETS (Loops 1-15)

Make all left-column widgets collapsible with consistent design.

### Basic Pattern Setup
- [ ] **1.1** Create reusable `CollapsibleWidget` component in `/components/ui/CollapsibleWidget.tsx`
- [ ] **1.2** Export from components/ui/index.ts

### Widget Conversions (keep Basic Info as-is, it's fine)
- [ ] **1.3** Convert `VehicleDataGapsCard` (Proof Tasks) to use CollapsibleWidget
- [ ] **1.4** Convert `VehicleResearchItemsCard` (Research Notes) to use CollapsibleWidget
- [ ] **1.5** Convert `VehicleROISummaryCard` (Investment Summary) to use CollapsibleWidget
- [ ] **1.6** Convert `VehiclePricingValueCard` (Pricing & Value) to use CollapsibleWidget
- [ ] **1.7** Convert `ExternalListingCard` (Auction History) to use CollapsibleWidget
- [ ] **1.8** Convert `VehicleDescriptionCard` (Description) to use CollapsibleWidget
- [ ] **1.9** Convert `VehicleReferenceLibrary` (Reference Documents) to use CollapsibleWidget
- [ ] **1.10** Fix Data Sources section - replace `<details>` with CollapsibleWidget, make clickable
- [ ] **1.11** Convert `VehicleCommentsCard` (Comments & Bids) to use CollapsibleWidget

### Typography Standardization
- [ ] **1.12** Audit all widget headlines - ensure `text-sm font-medium uppercase tracking-wide text-gray-500`
- [ ] **1.13** Fix any widgets with inconsistent capitalization
- [ ] **1.14** Ensure consistent padding (p-4) across all widgets
- [ ] **1.15** Deploy and verify on a vehicle profile page

---

## PHASE 2: VEHICLE PROFILE - HEADER BADGES (Loops 16-25)

Fix header to show critical auction info across all platforms.

### Audit Current State
- [ ] **2.1** Read `VehicleHeader.tsx` - document what badges exist
- [ ] **2.2** Check which badges work for BaT vs other platforms
- [ ] **2.3** Identify what data is available for Hagerty, Mecum, C&B

### Add Missing Badges
- [ ] **2.4** Add auction house badge (which platform is listing)
- [ ] **2.5** Add seller badge (who's selling)
- [ ] **2.6** Add high bidder badge (current high bidder)
- [ ] **2.7** Add countdown timer (CRITICAL - auction end time)
- [ ] **2.8** Add "Bid Now" button when auction is live
- [ ] **2.9** Add reserve status badge (reserve met / not met / no reserve)
- [ ] **2.10** Deploy and test on BaT, Hagerty, C&B listings

---

## PHASE 3: VEHICLE PROFILE - CLEANUP (Loops 26-35)

Fix the messy/broken widgets.

### Description Card
- [ ] **3.1** Read `VehicleDescriptionCard.tsx` - understand current state
- [ ] **3.2** Clean up formatting - consistent line breaks, paragraphs
- [ ] **3.3** Add "Read more" truncation for long descriptions
- [ ] **3.4** Remove any debug/test content

### Data Sources
- [ ] **3.5** Make each source clickable (link to original listing)
- [ ] **3.6** Add source favicon/icon
- [ ] **3.7** Show last updated date for each source

### Comments & Bids (Hagerty fix)
- [ ] **3.8** Investigate why Hagerty comments don't work
- [ ] **3.9** Fix Hagerty comment extraction or hide section when empty
- [ ] **3.10** Ensure bid history shows for all platforms that have it

---

## PHASE 4: CURSOR HOMEPAGE (Loops 36-50)

Fix stats panels, filters, and popups.

### Filter Improvements
- [ ] **4.1** Add Model filter after Make is selected
- [ ] **4.2** Ensure filter chain: Make → Model → Year range
- [ ] **4.3** Test filter persistence across page loads

### Stats Panels
- [ ] **4.4** Audit stats accuracy (11K vehicles, $445M value, etc.)
- [ ] **4.5** Fix any miscalculated stats
- [ ] **4.6** Redesign stats popups to be useful (Bloomberg-style insights)
- [ ] **4.7** Add meaningful drill-down from each stat

### Remove Ralph Button
- [ ] **4.8** Find and remove Ralph button from subhead/toolbar
- [ ] **4.9** Move any Ralph controls to admin-only area

### Stats Panel Popups (make them useful)
- [ ] **4.10** Vehicles panel: Show top makes, recent additions, coverage by source
- [ ] **4.11** Value panel: Show value by category, trending makes, price ranges
- [ ] **4.12** For Sale panel: Show by platform, price distribution
- [ ] **4.13** Auctions panel: Show ending soon, by platform, hot lots
- [ ] **4.14** Sold panel: Show recent sales, ROI examples, market trends
- [ ] **4.15** Deploy and test all stats panels

---

## PHASE 5: AUCTION MARKETPLACE (Loops 51-65)

Fix stale listings, timers, and live auction experience.

### Header Cleanup
- [ ] **5.1** Remove "182 stale listings" from header - embarrassing
- [ ] **5.2** Replace with useful info: "X ending today" or "X live now"

### Timer Implementation
- [ ] **5.3** Add countdown timer to each auction card
- [ ] **5.4** Timer format: "Ends in 2h 34m" or "Ends in 5m 23s"
- [ ] **5.5** Red/pulse styling when < 15 minutes
- [ ] **5.6** Auto-refresh/remove when auction ends

### Bid Count Fixes
- [ ] **5.7** Investigate BaT showing 0 bids - data extraction issue?
- [ ] **5.8** Fix bid count display for all platforms
- [ ] **5.9** Hide bid count if genuinely 0 (new listing) vs unknown

### Sold Vehicle Removal
- [ ] **5.10** Ensure sold vehicles are removed from auction page
- [ ] **5.11** Add "Recently Sold" section or move to separate tab

### More Live Options
- [ ] **5.12** Check what auction sources we're tracking
- [ ] **5.13** Ensure all active auctions from tracked sources appear
- [ ] **5.14** Add loading state for fetching new auctions
- [ ] **5.15** Deploy and test marketplace

---

## PHASE 6: VEHICLE CARDS & BADGES (Loops 66-75)

Unify card design across the site.

### Badge Audit
- [ ] **6.1** Document all badge types used on CursorHomepage cards
- [ ] **6.2** Document all badge types used on AuctionMarketplace cards
- [ ] **6.3** Document all badge types used on VehicleProfile header
- [ ] **6.4** Create unified badge specification

### State Representation
- [ ] **6.5** Implement vehicle state badges (LIVE, ENDING, SOLD, etc.)
- [ ] **6.6** Consistent colors: Blue=live, Orange=ending, Green=sold, Gray=off
- [ ] **6.7** Add state badge to all vehicle cards

### Card Consistency
- [ ] **6.8** Ensure same info displayed on cards across all pages
- [ ] **6.9** Consistent image aspect ratio
- [ ] **6.10** Consistent price display format

---

## DISCOVERED TASKS (add as you find them)

- [ ] ...

---

## BLOCKED TASKS (move here if stuck)

- [ ] ...

---

## COMPLETED TASKS (move here when done)

- [x] Setup: Created UI_PROMPT.md with context
- [x] Setup: Created ui_fix_plan.md with task breakdown

---

## NOTES

- Each checkbox = 1 loop iteration
- Deploy after each fix, verify it works
- If build fails, fix before marking complete
- Target: 75 loops = ~5 hours at 4 min/loop
