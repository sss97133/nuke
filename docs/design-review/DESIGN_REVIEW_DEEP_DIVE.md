# DESIGN REVIEW DEEP DIVE -- Addendum

**Date:** 2026-04-05
**Source:** 6 deep-dive reviews (Data Visualization, Broken Interactions, Popup Quality, Mobile Experience, Dark Mode, Typography) + prior DESIGN_REVIEW.md consolidated review
**Scope:** Forensic layer beneath the initial review -- every chart, every modal, every broken click, every unreadable label, every dark-mode failure, every phone-hostile interaction

---

## THE DEEPEST PROBLEM: THIS APP DOES NOT KNOW WHAT IT IS SELLING

The prior review identified an identity crisis. The deep dives revealed something more specific: **the app treats every vehicle listing identically regardless of its temporal state, and it presents market intelligence as a side effect of search rather than as the product itself.**

### Live vs. Sold: Two Products in One Skin

The codebase makes no architectural distinction between a live auction ending in 3 hours and a vehicle that sold at Barrett-Jackson in 2019. Both are `vehicle_events` rows. Both render with the same `VehicleCard`. Both appear in the same feed. Both open the same profile page.

This is wrong. These are fundamentally different products serving different user intents:

**LIVE (active auctions, current listings):** The user asks "should I buy this?" They need urgency signals -- countdown timers, bid velocity, competing interest (watcher count vs. median), price trajectory during the auction, "VIEW LISTING" CTA to go act. The time dimension is everything. The data visualization review found that 3K+ vehicles arrive daily but the feed has zero temporal urgency -- a truck listed 5 minutes ago and one listed 5 months ago look identical. The recency badges (Q6 in the prior review) are a start, but the real fix is treating live listings as a distinct surface with distinct information architecture.

**SOLD/UNSOLD (historical results):** The user asks "what did this sell for?" and "what does the market look like?" They need final price, sale date, condition at time of sale, comparable sales context, and the ability to aggregate across many results to see patterns. This is research, not shopping.

**Evidence from the deep dives that this distinction is missing:**

- The data visualization audit found no price history chart exists for individual vehicles -- the single most valuable chart for a researcher ("this Blazer was listed at $28K in 2022, sold at $31K in 2024, current estimate $38K"). The data exists in `vehicle_events`. The visualization does not.
- The popup quality review found that `VehiclePopup` shows Nuke Estimate vs. current price and apparition history -- this is the closest thing to temporal awareness in the UI, but it is buried in a popup, not surfaced on cards or in the feed.
- The broken interactions review found that time labels render as 8px grey metadata (`vehicleTimeLabel()`). Time is treated as a footnote, not as the organizing principle.
- The mobile review found no countdown or auction-end indicators anywhere in the mobile experience.

**Recommendation:** Split the feed into two modes or surfaces. **LIVE** shows only active listings/auctions with countdown timers, bid counts, watcher comparisons, and urgency badging. **ARCHIVE** shows historical results with final prices, date context, and comp-style presentation. The toggle should be prominent -- not a filter buried in a dropdown, but a primary navigation choice like "NOW" vs. "HISTORY."

### The Real Product: Market Intelligence, Not Car Listings

The prior review noted that Market should be elevated as a first-class section (P7). The deep dives make the case even stronger. Consider what the 268K auction results with dates, platforms, and locations can already answer:

- **Where are they concentrated?** The geographic map system (ChoroplethMap) already has county-level vehicle density. But it is hidden behind a tab on the homepage that most users never see.
- **Where are they moving?** Same VIN appearing at BaT in 2019 then Mecum in 2023 = a vehicle that moved markets. The barcode timeline tracks this per vehicle but there is no aggregate "flow" visualization.
- **Who is accumulating them?** A dealer with 15 active listings is a signal. The organization system tracks this but the data is not surfaced as market intelligence -- it is presented as an org profile.
- **How long do people hold them?** Sequential auction appearances of the same VIN across years = hold time. This data exists in `vehicle_events` but is not computed or displayed.
- **Price trajectory over time?** The AuctionTrendsDashboard has weekly price trends, segment leaders, platform sell-through rates -- genuine Bloomberg-level market intelligence. But it lives at `/admin/`. The data visualization review called this out explicitly: "The market intelligence here is genuinely useful to ALL users, not just admins."
- **Condition distribution?** YONO classifies 41 zones. The data visualization review identified the missing condition radar chart. Aggregated across a model cohort, this becomes "what condition are most 1977 Blazers in?" -- market intelligence that no competitor has.

**The entry point is "show me all the Camaros" but the value is understanding the Camaro market as a living system.** The current UI answers "here are some Camaros" and stops. The data engine can answer "there are 847 Camaros, concentrated in Arizona and Texas, with median price trending up 12% over 24 months, 60% selling above estimate, with the best-condition examples clustering at PCarMarket and BaT while lower-condition examples dominate Craigslist and eBay."

**None of the 6 deep dive reviews surfaced this product concept explicitly.** The data visualization review came closest by identifying the missing charts (price history, comparable sales scatter, condition radar, market segment trends). The broken interactions review focused on what breaks, not what is missing conceptually. The popup review validated that the intelligence layer works at the individual vehicle level (VehiclePopup, PriceContextPopup, WatchersPopup all do genuine analysis) but did not note the absence of cohort-level intelligence outside the admin dashboard.

**Recommendation:** The market intelligence surface should be the second thing a user sees after search. "Chevrolet Camaro" search results should show, above the vehicle grid: total count, median price, price trend arrow, geographic concentration, top platforms, sell-through rate. This is a 1-paragraph summary backed by the same data that already powers the admin AuctionTrendsDashboard. Moving it from admin-only to public-facing is the highest-leverage product decision in this review.

---

## CROSS-CUTTING FINDINGS: THE SIX REVIEWS CONVERGE

### 1. z-index Is the App's Immune System, and It Is Failing

Every review hit z-index problems. The broken interactions review cataloged 12+ tiers from 10 to 99999. The popup review found values ranging from 1000 (InputDialog) to 10060 (PartCheckoutModal). The mobile review found the popup dock (9100) conflicting with the bottom nav (1000). The dark mode review found the paper grain overlay (9999) painting over the notification center (1000) and search dropdowns (1203).

**The convergent finding:** There is no z-index architecture. Each component picks its own number. The result is that:
- Toasts appear behind modals
- Search results disappear behind the paper grain texture on vehicle profile pages
- The notification center is invisible on vehicle profiles
- Modals from different pages (OrgProfile at 10001, OrgInventory at 10003) compete arbitrarily

**The prior review's Q9 (define z-index scale as CSS tokens) is validated by all 6 deep dives as a prerequisite for fixing most overlay bugs.**

### 2. The Popup System Is the Best and Worst Thing Simultaneously

The popup quality review gave the PopupStack system its highest rating -- "the crown jewel of the frontend." Every popup earns its existence. Real data, real analysis, genuine drill-down. The data visualization review confirmed that badge portals (every data point is a clickable portal to deeper context) are a novel interaction model.

But:
- The dark mode review found 254 hardcoded hex values across 9 popup files vs. only 19 CSS variable references. The popup system is ~7% dark-mode compliant.
- The mobile review found that popups use mouse-drag positioning with no touch equivalents, 16x16px title bar buttons (well below Apple's 44px minimum), and fixed positioning math that overflows on a 375px iPhone.
- The typography review confirmed that popup text inherits the 8-9px sizes, which are illegible on mobile even if the popups could be displayed.

**The convergent finding:** The popup system needs two targeted fixes, not a rewrite:
1. Replace hardcoded hex with CSS variables (the dark mode review's Tier 2 recommendation -- 254 values across 9 files, all following one pattern, completable in a focused sprint).
2. On mobile, render popups as full-screen bottom sheets (the HeaderPopover pattern already does this correctly).

### 3. Typography Creates a Ceiling on All Other Improvements

The typography review found that 8px is the most-used font size in the entire application -- 58 instances in `vehicle-profile.css` alone. The contrast analysis found 5 color pairs that fail WCAG AA, including `--vp-pencil` (#888888 on white = 3.5:1) and `--vp-text-faint` (#bbbbbb on white = 1.9:1). These are used for section headers, timestamps, confidence markers, and metadata -- content that users need to read, not decoration.

The mobile review independently arrived at the same conclusion: "The design system mandates font sizes of 8-11px. These are fine on a dense desktop terminal; they are illegible on a phone." The mobile fix (bump `--font-scale` at 768px breakpoint) and the typography fix (raise contrast on pencil/faint tokens, promote content from 8px to 9px) are complementary and should be executed together.

The data visualization review found that chart labels at 6-7px (HeroHeatPanel VelocityCard at 7px, BuildTimelineChart phase labels at 6px) fall below the design system's own stated 8px minimum.

**The convergent finding:** The typography system has three tiers of problems:
1. **Accessibility violations** (P0): Raise `--vp-pencil` and `--vp-text-faint` contrast ratios. Eliminate 6px font-size. These are not style opinions -- they are WCAG failures.
2. **Hierarchy collapse** (P1): Everything that is not a primary value renders at 8px uppercase with indistinguishable letter-spacing. Add a vehicle name anchor (11px), standardize letter-spacing to two values, promote non-label content to 9px.
3. **Scale infrastructure** (P2): The `--font-scale` mechanism exists but the vehicle profile (the densest page) ignores it. 58+ hardcoded px values need to become token references.

### 4. Dark Mode: Architecture A-, Execution D+

The dark mode review quantified the gap precisely:
- Infrastructure/shell: 95% compliant
- Vehicle profile CSS: 85% compliant
- Popup subsystem: ~7% compliant
- General components: ~35% compliant
- Charts/visualization: ~20% compliant

The data visualization review independently found that MarketMap.tsx uses hardcoded `#f0efe8` backgrounds and `#1a1a1a` text with no design system tokens. The popup review found that DuplicateDetectionModal and TitleValidationModal use Tailwind classes exclusively. The broken interactions review found the paper grain overlay hardcodes its stacking.

**The convergent finding:** Dark mode is a token migration problem, not a design problem. The token system is complete. The mapping is known (`#1a1a1a` -> `var(--text)`, `#666` -> `var(--text-secondary)`, etc.). The work is mechanical:
1. Popups first (9 files, 254 values, highest visibility)
2. Extend Tailwind compat layer (missing yellow/indigo/pink/orange)
3. Component-by-component migration (~200 files)

### 5. Mobile Is a Read-Only Problem, Not a Rebuild Problem

The mobile review recommended Path 1: "Fix the 5 must-fix items, accept the Bloomberg terminal is a desktop experience, and make the core read path (search, browse, vehicle profile) functional on mobile."

This is validated by the other reviews:
- The popup system (crown jewel) needs bottom-sheet mode on mobile, not a redesign
- The typography needs a font-scale bump at 768px, not a new type system
- The feed needs bigger cards (already proposed: default 3 columns instead of 6)
- The vehicle profile hero needs a height cap on mobile (550px -> 280px or 50vh)

The 5 mobile must-fixes from the mobile review:
1. Bump `--font-scale` at 768px breakpoint
2. Popups as bottom sheets on mobile
3. Touch target minimum 44px
4. Fix PWA `start_url` to `/`
5. Delete duplicate mobile bottom nav styles in `design-system.css`

### 6. Dead Code Is Still Accumulating

The popup review found 4 components that should be deleted immediately:
- `ProxyBidModal.tsx` (727 lines) -- from the deleted betting/trading feature
- `RiskDisclosureModal.tsx` (270 lines) -- from the deleted investor portal
- `PartCheckoutModal.tsx` (63 lines) -- placeholder with dummy purchase ID
- `PartEnrichmentModal.tsx` (64 lines) -- build stub

The prior review identified 14 dead routes and 15 dead page files. Combined, this is ~2,000+ lines of dead code from features explicitly marked as deleted ("betting, trading/exchange, vault, concierge/villa, shipping, investor portal" per platform-hygiene rules).

---

## CONSOLIDATED ACTION LIST

### Tier 0: The Product Decisions (do these before any code)

These are not code changes. They are decisions that determine what all subsequent code changes mean.

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Separate LIVE from SOLD in the feed and on profiles.** Define how each surface differs: what data is shown, what actions are available, what urgency signals exist. | Every review found temporal blindness. The app treats a live auction and a 2019 sale identically. |
| D2 | **Define the Market Intelligence surface.** What does a user see when they search "Chevrolet Camaro" beyond a list of vehicles? Cohort stats, price trends, geographic distribution, platform breakdown, condition distribution. | The AuctionTrendsDashboard already computes this but it is admin-only. Moving it public is the product. |
| D3 | **Decide: is mobile a first-class experience or a read-only companion?** If read-only: fix the 5 must-fix items and stop. If first-class: budget for a parallel mobile shell. | Every review converged on "desktop-first is the reality." Acknowledging this focuses effort. |

### Tier 1: Accessibility and Standards (fix now -- these are not opinions)

| # | Action | Source Reviews | Effort |
|---|--------|---------------|--------|
| A1 | Raise `--vp-pencil` to #707070 (light) / #999999 (dark) | Typography, Dark Mode | XS |
| A2 | Raise `--vp-text-faint` to #888888 (light) / #777777 (dark) | Typography, Dark Mode | XS |
| A3 | Eliminate 6px font-size (2 instances) | Typography, DataViz | XS |
| A4 | Define z-index scale as CSS tokens and begin migration | Broken Interactions, Popups, Mobile, Dark Mode | S |
| A5 | Remove Cmd+W hijack from VehicleTabBar | Broken Interactions | XS |
| A6 | Require Enter to confirm URL paste (remove auto-ingest on paste) | Broken Interactions | XS |
| A7 | Add Escape handler and backdrop to NotificationCenter | Broken Interactions | S |
| A8 | Delete dead feature code: ProxyBidModal, RiskDisclosureModal, PartCheckoutModal, PartEnrichmentModal | Popups, Platform Hygiene | XS |

### Tier 2: The Quick Wins Validated by Deep Dives

These are the prior review's quick wins (Q1-Q10) that the deep dives independently confirmed or strengthened.

| # | Action | Validation |
|---|--------|-----------|
| Q1 | Enable follow/watch button | Still confirmed -- zero retention loop without it |
| Q2 | Fix button destructive/ghost/link variants | Confirmed by interactions review |
| Q3 | Show homepage tab bar always | Confirmed by IA review |
| Q4 | Default feed to 3 columns | Confirmed by mobile review (6 columns is hostile on any screen) |
| Q5 | Default feed sort to NEWEST | Strengthened by the LIVE vs SOLD analysis -- recency IS the product for live listings |
| Q6 | Add recency badges (JUST LISTED / TODAY) | Strengthened -- this is the minimum viable temporal urgency |
| Q7 | Add VIEW LISTING CTA | Confirmed -- popups and cards are dead ends without it |
| Q8 | Consolidate toast systems | Confirmed by interactions review + popup review (OrgProfile has its own at z-index 99999) |
| Q9 | Define z-index scale | Elevated to Tier 1 (A4) -- every review hit this |
| Q10 | Fix Tailwind dark: classes | Confirmed by dark mode review -- 17 files affected |

### Tier 3: Dark Mode Popup Sprint (high visibility, mechanical work)

| # | Action | Details | Effort |
|---|--------|---------|--------|
| DM1 | Convert PopupContainer.tsx from hardcoded hex to CSS variables | 24 hex values -> `var(--surface)`, `var(--border)`, `var(--text)` etc. | S |
| DM2 | Convert VehiclePopup.tsx | 63 hex values | S |
| DM3 | Convert MakePopup, ModelPopup, SourcePopup, PriceContextPopup, CommentsPopup, WatchersPopup, BidsPopup | 191 hex values across 7 files, all following the same pattern | M |
| DM4 | Extend Tailwind compat layer for missing color utilities (yellow, indigo, pink, orange) | ~30 lines of CSS in index.css | XS |
| DM5 | Fix `::selection` colors in vehicle-profile.css | Hardcoded dark-on-dark in dark mode | XS |

### Tier 4: Mobile Must-Fixes (the "read-only companion" baseline)

| # | Action | Details | Effort |
|---|--------|---------|--------|
| M1 | Add `@media (max-width: 768px)` font-scale bump | `--font-scale: 1.4` or mobile-specific size overrides | S |
| M2 | Popups as full-screen bottom sheets on mobile | Follow HeaderPopover pattern | M |
| M3 | Touch target minimum 44px on mobile | Popup buttons, range sliders, badge pills | M |
| M4 | Fix PWA start_url to `/` | Currently `/tech` | XS |
| M5 | Delete duplicate mobile bottom nav styles in design-system.css | Unified version is canonical | XS |
| M6 | Reduce vehicle profile hero to 280px or 50vh on mobile | Currently 550px = 82% of iPhone viewport | XS |

### Tier 5: Data Visualization Gaps (the market intelligence foundation)

| # | Action | Why It Matters | Effort |
|---|--------|---------------|--------|
| V1 | Add price history line chart to vehicle profile | Most impactful missing visualization per dataviz review. Shows "this Blazer was $28K in 2022, $31K in 2024." Required for the SOLD/ARCHIVE experience. | M |
| V2 | Add comparable sales scatter plot to vehicle profile | Year vs. price, colored by platform, subject vehicle highlighted. The comps data already exists. | M |
| V3 | Extract shared treemap algorithm to `src/lib/treemap.ts` | 4 separate implementations (HomePage custom, HeroHeatPanel custom, HeartbeatModelBar recharts, MarketMap d3-from-CDN). Delete 3. | M |
| V4 | Replace d3 CDN load in MarketMap.tsx with npm package | Runtime CDN dependency is a reliability risk | S |
| V5 | Add condition radar chart using YONO zone data (41 zones) | Instant visual communication of vehicle condition. No competitor has this. | M |
| V6 | Surface AuctionTrendsDashboard charts to non-admin users | Sentiment gauge, price trends, platform performance. The market intelligence product lives here. | M |
| V7 | Add market cohort summary to search results | "847 Camaros, median $34K, trending up 12%, concentrated in AZ/TX." The bridge between search and market intelligence. | L |

### Tier 6: Structural Cleanup (validated by deep dives)

| # | Action | Source |
|---|--------|--------|
| S1 | Consolidate DataValidationPopup into ValidationPopupV2 | Popup review -- two validation popup systems |
| S2 | Decompose ImageLightbox.tsx (~98KB) into subcomponents | Popup review -- largest component in codebase |
| S3 | Fix active tab showing only a dot instead of title (VehicleTabBar) | Broken interactions review |
| S4 | Fix global paste handler intercepting images in all inputs | Broken interactions review |
| S5 | Fix HomePage rendering its own header/search bar (duplicate of AppHeader) | Broken interactions review |
| S6 | Add vehicle name anchor to badge bar (11px, bold, full year/make/model) | Typography review -- no focal point on the page |
| S7 | Standardize letter-spacing to two values (0.08em label, 0.12em header) | Typography review -- five invisible distinctions |
| S8 | Migrate vehicle-profile.css from hardcoded px to var(--fs-*) tokens | Typography review -- font-scale cannot work otherwise |

---

## THE MISSING VISUALIZATIONS: WHAT THE MARKET INTELLIGENCE PRODUCT NEEDS

The data visualization review identified 5 visualizations that do not exist but should. Evaluated against the market intelligence product vision:

### 1. Price History Over Time (per vehicle) -- CRITICAL for SOLD experience

A line chart: "this 1977 Blazer was listed at $X in 2019 (BaT, no reserve, no sale), relisted at $Y in 2021 (Mecum, sold), current estimate $Z." The data exists in `vehicle_events`. This is the single most asked question by any researcher: "what has this vehicle's price done over time?"

For the market intelligence product, aggregating these across a cohort becomes: "Chevrolet K5 Blazer 1973-1979: median price trajectory over the last 5 years."

### 2. Comparable Sales Scatter Plot -- CRITICAL for SOLD experience

Year vs. price, colored by platform, with the subject vehicle highlighted. The `get_comps` data already returns this. A scatter plot instantly communicates "your vehicle is priced above/below/at the market" in a way that a table of numbers cannot.

### 3. Condition Radar Chart (YONO zones) -- DIFFERENTIATOR

41 zones classified by vision AI. A radar chart showing exterior front: 4/5, interior: 3/5, engine bay: 5/5 communicates condition faster than any text description. Aggregated across a cohort: "most 1977 Blazers score 3.2/5 on body condition." No competitor has this.

### 4. Geographic Flow Map -- THE MARKET INTELLIGENCE KILLER FEATURE

Same VIN at BaT (California) in 2019 then Mecum (Arizona) in 2023 = a vehicle that moved. Aggregated: "K5 Blazers flow from the Midwest to the Southwest." This is the "where are they moving?" question. The data exists. The visualization does not.

### 5. Market Segment Trends -- THE BLOOMBERG TICKER

Weekly/monthly average prices by segment (American muscle, German sports, Japanese classics). This exists in the AuctionTrendsDashboard but is admin-only. Making it public and prominent is the equivalent of putting the stock ticker on the homepage.

---

## WHAT THE REVIEWS MISSED

### User Acquisition Funnel

No review examined the path from "I heard about Nuke" to "I am a returning user." The prior review proposed the "Claim Your Vehicle" flow (P5) and onboarding intent capture (R7). The deep dives validated these indirectly -- the broken interactions review showed that pasting a URL auto-creates records without consent (the aggressive version of onboarding), while the popup review showed that the intelligence layer only becomes visible after you find a vehicle. But nobody mapped the actual funnel: landing -> first search -> first vehicle profile -> "oh, this is different" -> return visit -> claim vehicle -> active user.

### Data Freshness

The data visualization review noted missing freshness indicators on the AuctionTrendsDashboard. But freshness is a broader issue. If 3K vehicles arrive daily, how does the user know the feed is current? How does the researcher know the comps data is recent? The real-time refresh ritual (R3 in the prior review) addresses the feed, but there is no freshness indicator on vehicle profiles, market data, or search results.

### Print and Export

WorkOrderStatement.tsx has 186 hardcoded hex values because it is a print-formatted repair order. The dark mode review flagged this as needing a design decision (honor dark mode or fixed light palette for print). But the broader question: is there a print/export strategy? Can a user print a vehicle profile? Export comps as a PDF? Generate a "market report" for a model cohort? This is unexamined.

---

## REVISED PRIORITY SEQUENCE

Integrating the deep dive findings with the prior review's sequence:

**Phase 1: Fix the Foundation (Week 1-2)**
- Tier 1 accessibility fixes (A1-A8) -- contrast ratios, z-index scale, dead code deletion, interaction bugs
- Quick wins Q1-Q7 from prior review (follow/watch, button variants, tab bar, feed defaults, recency badges, VIEW LISTING CTA)
- Quick wins Q8-Q10 (toast consolidation, z-index tokens, Tailwind dark fix)
- Product decisions D1-D3 (LIVE vs SOLD, market intelligence surface, mobile strategy)

**Phase 2: Dark Mode + Mobile (Week 2-3)**
- Popup dark mode sprint (DM1-DM5) -- 9 files, mechanical, highest visibility
- Mobile must-fixes (M1-M6) -- font scale, bottom sheets, touch targets, PWA, hero height
- Typography P0 fixes are already in Tier 1

**Phase 3: The Missing Surface (Week 3-4)**
- Search results page (S1 from prior review)
- Persistent navigation (S2 from prior review)
- Market cohort summary on search results (V7 -- the bridge to market intelligence)
- Price history chart on vehicle profile (V1 -- the most impactful missing visualization)

**Phase 4: Market Intelligence Product (Week 4-6)**
- Surface AuctionTrendsDashboard to all users (V6)
- Comparable sales scatter plot (V2)
- Condition radar chart (V5)
- Market segment trend ticker on homepage
- LIVE vs SOLD feed split (implementing D1)

**Phase 5: Consolidation and Polish (Ongoing)**
- Structural cleanup (S1-S8)
- Component-by-component dark mode migration (~200 files)
- Treemap algorithm consolidation (V3-V4)
- Vehicle profile as narrative (R1 from prior review)
- Geographic flow map (the long-term differentiator)

---

## METRICS: HOW TO KNOW IF THIS IS WORKING

The prior review proposed 5 metrics. The deep dives suggest these additions:

| Metric | What It Measures | Target |
|--------|-----------------|--------|
| Time to first vehicle profile | Landing -> profile view | <15 seconds (prior review) |
| Search-to-market-intelligence exposure | % of searches that show cohort stats | >80% (new -- validates D2) |
| LIVE vs SOLD click distribution | Do users engage differently with live vs historical? | Measurable separation (new -- validates D1) |
| Dark mode toggle adoption | Do users switch? | >10% sessions in dark mode (validates dark mode work) |
| Mobile bounce rate | Do phone users leave immediately? | <60% after M1-M6 fixes |
| Popup drill-down depth | How many nested popups does a user open? | Average >2 (validates the popup system investment) |
| Return visit with personalized content | Does "since you were last here" drive returns? | >20% 7-day return (future -- validates R2) |

---

## CLOSING: THE GAP IS THE PRODUCT

Every deep dive arrived at the same conclusion from a different angle: the data engine is extraordinary, the presentation layer is incomplete. The treemap is novel but answers a question nobody asked. The barcode timeline is iconic but lives on a page most users never reach. The popup intelligence layer is the best interaction pattern in the codebase but it is dark-mode-blind, mobile-hostile, and discoverable only by accident.

The 268K auction results, 1.26M vehicle records, 11.5M comments, and 30M images are not a search index. They are a market census. The product is not "find a car." The product is "understand a vehicle market." The UI needs to catch up to what the data already knows.

The gap between what the system knows and what the user experiences is the entire product opportunity. Every recommendation in this document is aimed at closing that gap.
