# NUKE DESIGN REVIEW -- Consolidated Executive Summary

**Date:** 2026-04-04
**Source:** 5 director reviews (IA, Search+Profile, Feed, Homepage, Interactions) + prior Product Audit
**Scope:** Full frontend product -- architecture, flows, surfaces, interaction patterns

---

## THE DIAGNOSIS IN ONE SENTENCE

Nuke has a revolutionary data engine (1.26M vehicles, 11.5M comments, 30M images, field-level provenance) presented through a frontend that cannot answer the question: "What is this and what do I do here?"

---

## THE THREE ROOT PROBLEMS

**1. Identity Crisis.** The app tries to be a vehicle search engine, a garage management tool, a market data terminal, a dealer platform, an API product, and a shop capture system -- simultaneously, in one shell, with one 40px header. The landing page claims six products. One delivers value.

**2. No Navigation.** There is no persistent nav. The header has a wordmark and a search bar. The only way to discover features (Market, Auctions, Organizations, Pipeline) is to click a user avatar dropdown. A first-time user who doesn't click their avatar will never know these features exist. The command input is positioned as navigation but functions as search.

**3. Wrong Defaults.** The logged-out homepage is a treemap data visualization that answers a question nobody asked. The logged-in homepage is a tab switcher with no homepage content. The feed defaults to 6-column research density instead of 3-column browse mode. The follow/watch button is implemented but hardcoded to hidden. Time labels are buried in 8px grey text instead of celebrated as urgency signals.

---

## WHAT'S ACTUALLY GOOD (Preserve These)

These are genuine competitive advantages. Do not lose them in any restructure:

1. **Vehicle Profile as Computation Surface.** Provenance-aware data display, barcode timeline, seven-level analysis, day cards, progressive density (empty fields don't render). When you're on a vehicle profile, Nuke feels like the product it wants to be. No competitor has this.

2. **The Popup Stack.** Stacking, draggable, minimizable data exploration popups with search injection. This is Finder-style windowing for data. It is the best interaction pattern in the codebase.

3. **The Data Pipeline.** 3K+ vehicles/day flowing from 15+ sources. Deal scores, heat scores, find scores computed from real market data. Interest memory that learns silently. The intelligence layer is real, not hand-waved.

4. **URL Ingestion.** Paste a BaT/C&B/Craigslist link and the system creates an entity with archived HTML, extracted fields, and provenance. This is data infrastructure made accessible to humans.

5. **The Design System Philosophy.** Zero border-radius, zero shadows, greyscale-first, monospace for data, 8-11px text. Coherent and distinctive. The problems are structural, not visual.

6. **Badge Portals.** Every data point is a clickable portal to deeper context. A genuinely novel interaction model that should be amplified, not buried.

---

## RECOMMENDED ACTIONS

### Quick Wins (config changes, 10-line fixes)

| # | Action | Impact | Effort | Source |
|---|--------|--------|--------|--------|
| Q1 | **Enable the follow/watch button on feed cards.** `showActions` is hardcoded to `false` in FeedPage's `renderCard`. Change to `true`. Wire up follow state (already designed in component props). | Unlocks retention loop -- users can save vehicles and get price drop notifications | 10 lines | Feed Review |
| Q2 | **Fix Button destructive/ghost/link variants.** `button.tsx` maps `destructive` to base class instead of `.btn-danger`. Ghost and link variants also broken. | Destructive actions currently look identical to normal actions | 2 lines in `button.tsx` | Interactions Review |
| Q3 | **Show the homepage tab bar always.** Tab bar is hidden when `activeTab === 'feed'` (line 1387 of HomePage.tsx). Remove this conditional. | Users on the default Feed tab currently cannot see or navigate to Garage or Map | 1 line | IA Review, Homepage Review |
| Q4 | **Default feed to 3 columns instead of 6.** Change default `cardsPerRow` from 6 to 3 for new/anonymous users. Bigger cards, bigger hero images, faster visual identification. | Feed stops looking like a spreadsheet and starts looking like a marketplace | 1 line | Feed Review |
| Q5 | **Default feed sort to NEWEST instead of RANK.** Recency is the product for browsers. Keep RANK as an explicit toggle. | 3K new vehicles/day becomes visible as freshness instead of buried | 1 line | Feed Review |
| Q6 | **Add "JUST LISTED" / "TODAY" badges to feed cards.** Time label exists (`vehicleTimeLabel()`) but renders as 8px grey metadata. Promote to a colored badge: red for <1h, orange for <24h. | Creates temporal urgency that the feed currently lacks entirely | ~20 lines | Feed Review |
| Q7 | **Add "VIEW LISTING" CTA to vehicle cards and popup.** `discovery_url` and `listing_url` data already populated. Surface as a button. | Closes the gap between discovery and action -- currently the popup is a dead end | ~15 lines | Feed Review |
| Q8 | **Consolidate toast systems to one.** Remove `react-hot-toast` dependency and `<Toaster/>` from App.tsx. Remove `OldToastProvider`. Migrate 16 files to use `components/ui/Toast.tsx`. | Eliminates 3 competing toast systems that overlap visually, auto-dismiss at different times, and look different | ~16 file imports | Interactions Review |
| Q9 | **Define z-index scale as CSS tokens.** Add `--z-dropdown: 100`, `--z-sticky: 200`, `--z-overlay: 1000`, `--z-popup: 9000`, `--z-modal: 10000`, `--z-toast: 11000` to `unified-design-system.css`. | Current z-indexes span 10 to 99999 with no scale. Toasts can appear behind modals. | 6 lines in CSS, then gradual migration | Interactions Review |
| Q10 | **Fix Tailwind `dark:` classes.** 17 files use `dark:bg-*` / `dark:text-*` which respond to `prefers-color-scheme`, not the app's `data-theme="dark"` toggle. Convert to CSS variable equivalents. | Dark mode currently breaks for these 17 files including Toast, CollapsibleWidget, AddEventWizard | ~17 files, find-and-replace | Interactions Review |

### Structural Fixes (split files, consolidate systems, rearchitect surfaces)

| # | Action | Impact | Effort | Source |
|---|--------|--------|--------|--------|
| S1 | **Build a real search results page at `/search`.** Route `/search?q=porsche+911` with grid/list view, sort, filter pills (year, price, make, body style, location), and pagination. The edge function already supports `limit` and `total_count`. Make Enter in the command bar navigate to this page. | Currently the entire search experience is a 24-result autocomplete dropdown with no way to browse, sort, filter, compare, save, or share search URLs | Medium -- new page, wire existing service | Search+Profile Review |
| S2 | **Add persistent navigation.** 4-5 primary destinations visible in the header: Feed, Search, Garage, Market. The command input stays as a power-user accelerator. Everything else accessible from user dropdown. | Currently zero navigation visible to users. The app has 60+ routes discoverable only through the user avatar dropdown or direct URL entry. | Medium -- header component changes | IA Review |
| S3 | **Split owner tools from the public vehicle profile.** Owner/builder tools (Wiring Harness, Parts Quote, Ledger Documents, Privacy Settings, Build Manifest, Work Order Progress, Generate Bill) should be behind a toggle or tab that only appears when `canEdit` is true. | The profile tries to serve buyers and owners simultaneously. Owner tools clutter the page for 99% of visitors. | Medium -- WorkspaceContent restructure | Search+Profile Review |
| S4 | **Promote market position on vehicle profile.** Move estimate, comparable sales, and deal score to immediately after the hero image. Currently comps are a collapsed widget deep in the left column. | For buyers, market position is the #1 thing after identity and photos. Currently buried and defaulting to collapsed. | Medium -- component reorder | Search+Profile Review |
| S5 | **Break VehicleHeader.tsx into focused components.** Currently 2000+ lines handling identity, price, auction status, seller, location, VIN, mileage, and actions simultaneously. Split into: IdentityBar, PriceDisplay, AuctionStatus, OwnerBadge, ActionMenu. | Maintenance hazard. Imports 16 custom hooks. Render method is enormous. | Medium-Large | Search+Profile Review |
| S6 | **Split HomePage.tsx into two files.** `LandingPage.tsx` (logged-out, ~900 lines of treemap) and `AppHome.tsx` (logged-in, tab routing). They share zero code. | 1,445-line file doing two completely unrelated jobs | Small | Homepage Review |
| S7 | **Eliminate duplicate routes.** 14 pairs where multiple paths serve the same component (`/pipeline` = `/acquisitions`, `/inbox` = `/photo-library`, `/restoration` = `/intake`, etc.). Pick canonical URL, redirect the rest. | Reduces navigation confusion. Users and developers encounter the same component at different URLs with no explanation. | Small | Product Audit |
| S8 | **Delete 14 dead routes and 15 dead page files.** Routes for retired features (trading, shipping, crypto, proxy bidding) still exist with live routes. Listed in Product Audit appendix. | Dead code from killed features violates platform-hygiene rules | Small, zero risk | Product Audit |
| S9 | **Create shared UI primitives: `<Modal>`, `<LoadingIndicator>`, `<EmptyState>`.** Currently ~70 files build their own `position: fixed; inset: 0` overlays. No shared loading component. No empty state component. Suspense fallback is a blank div. | Every modal picks its own z-index, overlay opacity, close behavior, and border width. Loading states are inconsistent text strings or blank screens. | Medium | Interactions Review |
| S10 | **Group routes under domain prefixes.** Extend the `/vehicle/*` pattern to `/market/*`, `/shop/*`, `/settings/*`, `/developer/*`. | 60+ flat top-level routes with no hierarchy. A user cannot form a mental model of what lives where. | Medium -- routing refactor | IA Review |
| S11 | **Remove duplicate treemap search bar.** The treemap has its own search that does direct Supabase `ilike` queries (limit 5, no thumbnails, no type-ahead richness). Use the global `universal-search` everywhere. | Two search implementations with different quality and capabilities | Small | Homepage Review |
| S12 | **Update popup system colors to CSS variables.** Popup system hardcodes `#f5f5f5` background, `#2a2a2a` borders. These look like light-mode islands in dark mode. | Dark mode is broken for the best interaction pattern in the app | Small | Interactions Review |

### Product Decisions (what to build, what to kill, what to change)

| # | Decision | Rationale | Source |
|---|----------|-----------|--------|
| P1 | **Kill the treemap as the logged-out landing page.** Replace with: search bar (prominent, centered), value proposition sentence, 3-4 curated vehicle profiles showing data depth. The treemap can live at `/explore` for analysts. | The treemap is a data exploration tool designed for someone who already understands the dataset. It does not communicate what Nuke is. It does not direct the visitor to do anything. A visitor sees a wall of colored rectangles and has no idea what they're looking at. | Homepage Review, IA Review, Product Audit |
| P2 | **Make the feed the default logged-in experience, not a tab.** Remove the tab system. The logged-in homepage should be: search bar + personalized activity stream + the feed (pre-filtered to interests). Move Garage and Map to their own routes (`/garage`, `/map`). | The tab system exists because three things needed a home, not because users need to switch between them. There is no "homepage" -- just a three-way switch with no welcome, no personalization, no "what happened since you left." | Homepage Review |
| P3 | **Segment the app by audience.** Show features appropriate to the user's context. Core (everyone): Search, Browse, Feed, Vehicle Profiles, Garage, Market. Pro (shops/dealers): Tech Capture, Invoices, Work Orders. Developer: API Docs, Keys. Don't show API docs to enthusiasts. Don't show shop tools to browsers. | 5+ distinct user types share one undifferentiated shell. A shop technician and an API developer see the same flat list of 22 protected routes. | IA Review |
| P4 | **Simplify the landing page to one product: Search.** Remove Garage, Market Data, Dealer Tools, API, and Shop Capture from the landing page product grid. These are either internal tools, aspirational features, or features of the vehicle profile -- not standalone products. | The landing page claims six products. One delivers value to a visitor (Search + Vehicle Profiles). The other five are empty shells, internal tools, or infrastructure. Setting expectations the product can't meet on 5 of 6 surfaces. | Product Audit |
| P5 | **Build the "Claim Your Vehicle" flow.** User searches -> finds their car (likely already in 1.26M from an auction) -> claims ownership -> existing data becomes "theirs" -> Garage has value. | This is the missing bridge between data engine and user product. Without it, Garage is empty for every user except the founder. This is the user acquisition flywheel. | Product Audit, Homepage Review |
| P6 | **Build two feed persona modes: HUNT and RESEARCH.** HUNT (The Browser): 2-3 columns, big photos, minimal text, newest-first, recency badges, save button, distance, "VIEW LISTING" CTA. RESEARCH (The Archivist): 5-8 columns, full data density, deal/heat scores, RANK sort. The current feed is RESEARCH mode with no way to switch. | The feed was designed by The Archivist for The Archivist. The user is The Browser. The density slider (3-12) is a layout control, not a persona control. Setting it to 3 gives bigger cards but still shows 8 data points per card in 7px font. | Feed Review |
| P7 | **Elevate Market as a first-class navigable section.** Auctions, comparable sales, market trends, and valuations are conceptually a "Market" entity scattered across features. Give it a unified home alongside Vehicles, Users, and Organizations. | Market intelligence (170K+ auction results) is the platform's strongest differentiator. Currently scattered: auctions at `/auctions`, dashboard at `/market/dashboard`, comps computed per-vehicle with no unified view. | IA Review |
| P8 | **Kill the garage query on every homepage mount.** `useVehiclesDashboard(user?.id)` runs 5 parallel queries on every homepage load regardless of which tab is active. | Wastes 5 queries per page load for users who never click the Garage tab | Homepage Review |

### Revolutionary Opportunities (what would make someone say "holy shit")

| # | Opportunity | What It Would Look Like | Why It Matters |
|---|------------|------------------------|----------------|
| R1 | **Vehicle profile as narrative, not widget list.** Restructure the profile page as a story: Identity -> Media -> Market Position -> History -> Community -> Technical Details -> Documents. Each section flows into the next. The data tells you what matters without you having to open drawers. | Currently the profile is a filing cabinet -- 20+ collapsible widgets in a vertical stack. The user has to open each drawer to see what's inside. The data graph underneath is revolutionary; the presentation is basic. The gap between what the system knows and what the user experiences is the entire product opportunity. | Search+Profile Review |
| R2 | **The "Since You Were Last Here" homepage.** When a returning user opens Nuke: "3 new 911s listed. Your K10 got a comp sale at $47K. Price drop on that Blazer you viewed. 1 live auction ending in 2 hours." Personalized, time-aware, actionable. The ReturnVisitBanner already has the bones of this. | Currently: you open the app and see a treemap (logged out) or an unfiltered feed of 529K vehicles (logged in). No recognition that you've been here before. No answer to "what happened while I was gone?" No reason to come back. | Homepage Review, Feed Review |
| R3 | **Real-time marketplace feed with refresh ritual.** Poll every 60s. "12 NEW ABOVE" sticky banner (like Twitter). Pull-to-refresh on mobile. Minute-level freshness ("12m ago"). Time-decay visual treatment (old cards muted). Animated "NEW" on just-loaded vehicles. | 3K+ vehicles added daily but zero temporal urgency in the UI. A truck listed 5 minutes ago and one listed 5 months ago look identical. The data is genuinely fresh -- the feed just doesn't celebrate it. This is the dopamine loop that makes users check the app 10 times a day. | Feed Review |
| R4 | **Comparison mode.** Pin 2-3 vehicles and compare them side-by-side on key dimensions: price, mileage, condition score, market position, provenance depth, similar sales. Connected to the search results page -- see a result, pin it, keep browsing, compare later. | No vehicle platform does side-by-side comparison with provenance data, condition scoring, and market intelligence. This turns casual browsing into informed purchasing. | Search+Profile Review |
| R5 | **Map-first browse with geolocation.** 263K vehicles have location data. Full map view with vehicle pins, click-for-popup, draw-on-map region filter, auto-detect user location, distance badges on cards, "NEAR ME" quick filter. | FB Marketplace's killer feature is location. Nuke has the location data but buries it in 7px disabled-color text. Making location a first-class dimension would be a genuine differentiator -- a map of collector vehicles with market intelligence that FB Marketplace doesn't have. | Feed Review |
| R6 | **Vehicle summary card -- the 30-second understanding.** After the hero image, show a compact card: estimate with confidence, mileage, location, key specs, deal score, condition assessment, and the briefing headline. The "Carfax report header" equivalent for any collector vehicle. | Currently there's no executive summary. The VehicleBriefing generates one sentence. For a vehicle with 20 sections of data, one sentence isn't enough. A buyer needs to understand a vehicle in 30 seconds before deciding to go deep. | Search+Profile Review |
| R7 | **Onboarding intent capture.** First visit: "What are you looking for?" Make/body/era/budget quick-select. Instantly personalized feed from first interaction. Skip the treemap entirely. Get them to a vehicle profile in 2 clicks -- that is where the magic is. | Currently: new user sees treemap (confusion) or unfiltered feed (overwhelm). No taste capture, no guidance, no path to value. The interest memory system exists and is elegant -- but requires silent learning over multiple visits. An explicit "what do you like?" would boot the personalization engine immediately. | Feed Review, Homepage Review |

---

## PRIORITY SEQUENCE

If executing these recommendations sequentially, this is the order that maximizes impact per unit of effort:

**Week 1: Fix the defaults (Quick wins Q1-Q7)**
- Enable follow/watch button (Q1)
- Fix button variants (Q2)
- Show tab bar always (Q3)
- Default feed to 3 columns + NEWEST sort (Q4, Q5)
- Add recency badges (Q6)
- Add VIEW LISTING CTA (Q7)

**Week 2: Clean the house (Quick wins Q8-Q10, Structural S6-S8)**
- Consolidate toast systems (Q8)
- Define z-index scale (Q9)
- Fix dark mode for Tailwind files (Q10)
- Split HomePage.tsx (S6)
- Delete dead routes and files (S8)
- Eliminate duplicate routes (S7)

**Week 3: Build the missing surface (Structural S1-S2, Product P1-P2)**
- Build search results page (S1)
- Add persistent navigation (S2)
- Replace treemap landing with search-first homepage (P1)
- Make feed the default logged-in experience (P2)

**Week 4: Sharpen the core product (Structural S3-S4, Revolutionary R6)**
- Split owner tools from public profile (S3)
- Promote market position on profile (S4)
- Build vehicle summary card (R6)

**Ongoing: The revolutionary work (R1-R7)**
- Profile as narrative (R1)
- Personalized "since you were last here" homepage (R2)
- Real-time refresh ritual (R3)
- Comparison mode (R4)
- Map-first browse (R5)
- Onboarding intent capture (R7)

---

## METRICS TO TRACK

These would validate whether the changes are working:

- **Time to first vehicle profile view** (from landing). Currently requires: see treemap -> understand it -> search -> click autocomplete result. Target: < 15 seconds.
- **Return visit rate.** Currently unknown. The "since you were last here" feature and follow/watch buttons are the levers.
- **Search-to-profile conversion.** Currently 100% autocomplete-based. A real search results page with sort/filter should increase browsing depth.
- **Feed scroll depth.** Default density change (6 -> 3 columns) should increase engagement per session.
- **Follow/watch adoption.** Currently 0 (button is hidden). Enabling it is the minimum viable retention loop.

---

## APPENDIX: FILE HOTSPOTS

Files that appear across multiple reviews as problems needing attention:

| File | Lines | Reviews Citing It | Issues |
|------|-------|-------------------|--------|
| `HomePage.tsx` | 1,445 | IA, Feed, Homepage | Two apps in one file, treemap as landing, hidden tab bar, garage query on every mount |
| `VehicleHeader.tsx` | 2,000+ | Search+Profile | Monolith -- identity, price, auction, seller, location, VIN, mileage, actions all in one component |
| `AIDataIngestionSearch.tsx` | 500+ | Search+Profile, IA | Impressive capability but autocomplete is the entire search experience -- no results page |
| `WorkspaceContent.tsx` | 500+ | Search+Profile | 20+ widgets in a vertical stack with no structure, grouping, or audience separation |
| `App.tsx` | -- | Interactions | Wraps 3 competing toast providers (ToastProvider, OldToastProvider, Toaster) |
| `VehicleProfileContext.tsx` | 934 | Search+Profile | Well-structured but 115 lines of fallback image special-casing should be a utility |
| `unified-design-system.css` | -- | Interactions, Product Audit | Missing z-index scale, Tailwind dark mode not integrated |
| `button.tsx` | -- | Interactions | Variant mappings broken (destructive, ghost, link do nothing) |
| `FeedPage.tsx` | ~460 | Feed | Good architecture but wrong defaults (density, sort, hidden actions) |
| `VehicleCard.tsx` | ~610 | Feed | Time labels buried, location invisible in default view, no CTA |
