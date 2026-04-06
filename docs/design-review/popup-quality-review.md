# Popup & Modal Quality Review

**Date:** 2026-04-05
**Reviewer:** Popup Quality Inspector (agent)
**Scope:** Every popup, modal, overlay, dialog, lightbox, toast, and notification component in nuke_frontend

---

## Executive Summary

The codebase contains approximately 40 popup/modal components. They split into two architectural tiers:

1. **PopupStack system** (8 components) -- genuinely excellent. Stacking, dragging, resizing, minimize-to-dock, built-in search filtering. Every data point is clickable and drills into a new popup. This is the crown jewel of the frontend.

2. **Standalone modals** (32+ components) -- inconsistent. Mix of design-system-compliant inline styles, Tailwind classes, CSS module classes, and hybrid approaches. z-index values range from 50 to 10060 with no coordination. Several are placeholders, at least one is dead code from a deleted feature.

**Verdict:** The PopupStack system earns its existence decisively. Among standalone modals, roughly half are finished production-quality work, a quarter are functional but design-system-noncompliant, and a quarter are placeholders or dead code that should be deleted.

---

## TIER 1: PopupStack System

### Architecture Assessment: EXCELLENT

**Files:**
- `src/components/popups/PopupStack.tsx` (121 lines) -- Context provider
- `src/components/popups/PopupContainer.tsx` (545 lines) -- Rendering engine
- `src/components/popups/usePopup.ts` (43 lines) -- Consumer hook
- `src/components/popups/index.ts` -- Exports

**What it does right:**
- Stacking with 20px offset per popup -- you can see what's behind
- Title bar drag with mousedown tracking
- Resize handle (bottom-right corner)
- Minimize dock strip at viewport bottom
- Expand toggle (460px default, 700px expanded)
- Built-in search with debounced filtering (300ms)
- Escape closes top popup, overlay click closes top popup
- Portal rendering to document.body
- Props injection via cloneElement (searchQuery, popupExpanded)
- Title bar styling is design-system-compliant: #2a2a2a bg, 16x16 controls, Courier New 8px

**One concern:** The `cloneElement` pattern for injecting searchQuery/popupExpanded props works but is fragile. If a child component doesn't accept these props, they silently pass through to the DOM. Not a bug today, but a maintenance risk.

---

### PopupStack Children: Individual Assessments

#### VehiclePopup.tsx (637 lines) -- EARNS ITS EXISTENCE: YES, EMPHATICALLY

**Trigger:** Click any vehicle reference anywhere in the app.
**Content:** Hero image, title+price, Nuke Estimate with % diff, spec grid, Community Intelligence (key quotes, expert insights, concerns, market signals), Vehicle Intelligence (red flags, mods, condition, documentation), comparable sales (each clickable to open another VehiclePopup), apparition history, source link, "OPEN FULL PROFILE" button.
**Data source:** Single RPC call `popup_vehicle_intel` returning comment_intel, description_intel, scores, apparitions, recent_comps.
**Quality:** Production-grade. Real data, real intelligence, proper drill-down. Tracks views via useViewHistory, records interests via useInterests. Make/model/source text is clickable, opening nested popups. This is what makes Nuke feel like an intelligence platform rather than a database viewer.

#### MakePopup.tsx (440 lines) -- EARNS ITS EXISTENCE: YES

**Trigger:** Click any make name (e.g., "Chevrolet" in VehiclePopup).
**Content:** Total vehicles, for-sale count, LIVE NOW grid (4 mini cards), SOLD LAST 90 DAYS grid, MODELS bar chart sorted by volume, PRICE TOPOLOGY (canvas scatter plot year vs price), SOURCES chips, TAB button.
**Data source:** `popup_make_intel` RPC.
**Quality:** Real data, real analysis. The canvas-rendered PriceScatter is DPR-aware. Search filtering works on models and sources.
**Issue:** PriceScatter component is duplicated from ModelPopup -- not shared. Minor DRY violation.

#### ModelPopup.tsx (366 lines) -- EARNS ITS EXISTENCE: YES

**Trigger:** Click any model name.
**Content:** Similar to MakePopup but for specific make+model. Year range, price scatter, FOR SALE NOW grid, RECENT SALES grid, sources, TAB button.
**Data source:** `popup_model_intel` RPC.
**Quality:** Same as MakePopup. The PriceScatter is duplicated (see above).

#### SourcePopup.tsx (314 lines) -- EARNS ITS EXISTENCE: YES

**Trigger:** Click any source platform name (e.g., "Bring a Trailer").
**Content:** Total, for-sale, sold-this-week, sold-30-days stats. Source character description (hardcoded dictionary for bat, cars-and-bids, craigslist, etc.). LIVE NOW grid, RECENT RESULTS list, TOP MAKES chips.
**Data source:** `popup_source_intel` RPC.
**Quality:** Production-grade. The hardcoded source descriptions are a nice touch -- they contextualize the platform.

#### CommentsPopup.tsx (243 lines) -- EARNS ITS EXISTENCE: YES

**Trigger:** Click comment count on vehicle cards.
**Content:** Total/bid/seller counts in summary bar. Scrollable comment list with left-border color coding (blue=bids, red=seller). Username, time ago, platform badge, bid amount badge. Search filters on text and username.
**Data source:** `vehicle_comments_unified` view, limit 200.
**Quality:** Real extracted data. Good filtering. Max-height 60px per comment prevents wall-of-text. Shows real auction discourse.

#### BidsPopup.tsx (229 lines) -- EARNS ITS EXISTENCE: YES

**Trigger:** Click bid count on vehicle cards.
**Content:** Bid count and high bid in summary. Bid list sorted by amount desc with visual progress bars (width proportional to bid/max). Highest bid highlighted green. Graceful fallback when no granular bid data (shows bid count, high bid, VIEW SOURCE LISTING button).
**Data source:** `vehicle_comments_unified` where bid_amount > 0, limit 100.
**Quality:** The fallback for missing granular data is well-handled. Progress bar visualization is effective.

#### WatchersPopup.tsx (259 lines) -- EARNS ITS EXISTENCE: YES

**Trigger:** Click watcher count.
**Content:** Hero stat (large watcher count), page views. Computes model-level watcher stats (avg, median, max, min) by querying bat_watchers for same make/model (limit 500). Visual bar chart comparison. Verdict text ("+X% vs median", "Exceptionally high interest"). Percentile display.
**Quality:** Does meaningful comparative analysis. The "is this watcher count good?" question is answered with real context, not just a raw number.

#### PriceContextPopup.tsx (316 lines) -- EARNS ITS EXISTENCE: YES

**Trigger:** Click price on vehicle cards.
**Content:** Price hero display, Nuke Estimate vs actual with OVER/UNDER/FAIR badge, median comparison from model cohort, comparable sales list (clickable).
**Data source:** Two queries: comps (limit 8), median calculation (limit 300).
**Quality:** Real comps, real analysis. The OVER/UNDER/FAIR badge is a clear signal.

---

## TIER 2: Standalone Modals -- Individual Assessments

### PRODUCTION QUALITY (design-system compliant, real data, earns existence)

#### ValidationPopupV2.tsx (1003 lines) -- EARNS ITS EXISTENCE: YES

**Trigger:** Click any field value on vehicle profile.
**Content:** Field name + value header with inline edit, VIN provenance (VIN fields only), Field Intelligence section (count, rank, rarity badge, price impact, temporal range, top values with current highlighted, common companions), Evidence section (ownership docs, tagged images, BaT auctions, dealer listings), confidence calculation expandable, "UPLOAD PROOF" CTA.
**Data source:** Multiple queries (vehicle_field_sources, ownership_verifications, vehicle_images, vehicle_events, organization_vehicles) plus useFieldIntelligence hook.
**Quality:** This is the epistemological backbone of the platform. Answers "how do you know this?" with real evidence. Design-system compliant inline styles. 2px borders, 8-9px ALL CAPS labels, Courier New for data, zero border-radius.
**Issue:** At 1003 lines, this component does a lot. The inline edit with handleSave that falls back to `admin-update-vehicle-field` edge function, then calls `window.location.reload()` on success, is crude. The confidence calculation section is hardcoded text, not actually computed from the formula it displays.

#### VideoMomentPopups.tsx (813 lines) -- EARNS ITS EXISTENCE: YES (both components)

Contains two popup components:
- **PriceBreakdownPopup**: Hammer price, buyer premium, buyer total, seller commission, entry fee, seller net, house take. Each line item is clickable to reveal its definition. Comparable sales section. Source-specific fee calculations (Mecum, Barrett-Jackson). Portal-rendered.
- **LotStatsPopup**: Lot number breakdown (prefix meaning, timing analysis), historical lot data, time slot performance with bar chart. Three tabs: This Lot, History, Time Slots.
**Quality:** Real analytical content. The price breakdown teaches users how auctions work. The lot stats reveal broadcast timing intelligence. Both use real data.
**Issues:** Uses 1px borders in places (should be 2px per design system). The `borderRadius: 0` is explicitly set, which is good -- but the fact that it needs to be set implies the base might default to rounded.

#### DataValidationPopup.tsx (434 lines) -- EARNS ITS EXISTENCE: YES, BUT OVERLAPS WITH ValidationPopupV2

**Trigger:** Click field validation indicator.
**Content:** Validation sources for a specific field. Queries data_validation_sources, ownership_verifications, vehicle_images (sensitive_type), vehicle_field_sources, data_validations. Consensus calculation. "Have additional proof?" CTA.
**Quality:** Real data, real provenance.
**Issue:** Significant overlap with ValidationPopupV2. These should be consolidated. Having two validation popup systems is confusing.

#### ValueProvenancePopup.tsx (~79KB) -- EARNS ITS EXISTENCE: YES, BUT TOO LARGE

**Trigger:** Click any value to see provenance.
**Content:** Permission-based editing, provenance chain.
**Issue:** At ~79KB this is extremely large for a popup component. Could not fully read in single pass. Needs decomposition.

#### ServiceReportModal.tsx (335 lines) -- EARNS ITS EXISTENCE: YES

**Trigger:** Organization service report view.
**Content:** Stats summary (sessions, hours, estimated cost, photos), photo gallery, work sessions timeline. Portal-rendered.
**Quality:** Real data from timeline_events and vehicle_images. Well-structured with grid stats, photo grid, and timeline. Design-system mostly compliant (2px border, 11px font sizes, UPPERCASE labels).

#### OwnershipDetailsPopup.tsx (367 lines) -- EARNS ITS EXISTENCE: YES

**Trigger:** Click ownership info on vehicle profile.
**Content:** Current owners, ownership transfers, historical owners, recent transfer alerts, context summary (stable ownership, multiple owners, recent change).
**Quality:** Real data from vehicle_ownerships and ownership_transfers. Smart context summaries. Robust error handling with join fallbacks.
**Issue:** Uses `var(--grey-100)` and `var(--info-bg)` which may not exist in the design system. Close button says "CLOSE" instead of using the standard X pattern.

#### DuplicateDetectionModal.tsx (352 lines) -- EARNS ITS EXISTENCE: YES

**Trigger:** Vehicle mailbox duplicate detection notification.
**Content:** Detection method with icon, confidence score, side-by-side vehicle comparison, evidence details, confirm/reject actions.
**Quality:** Real detection data with meaningful evidence display (GPS distance, hash similarity, time difference).
**Issue:** Uses Tailwind classes exclusively (className="fixed inset-0 bg-gray-600..."). Not design-system compliant. Uses lucide-react icons. Zero Nuke styling.

#### ImageLightbox.tsx (~98KB) -- EARNS ITS EXISTENCE: YES, BUT ENORMOUSLY OVERSIZED

**Trigger:** Click any image.
**Content:** Full image viewer with AI chat, spatial parts, annotations, tagging, info panel, expanded data.
**Issue:** At ~98KB this is the largest component in the codebase. It does image viewing, AI conversation, part identification, annotation, and data display all in one file. Imports old `design-system.css` instead of `unified-design-system.css`. Needs major decomposition.

### FUNCTIONAL BUT DESIGN-SYSTEM NONCOMPLIANT

#### TitleValidationModal.tsx (395 lines) -- EARNS ITS EXISTENCE: YES, BUT WRONG STYLING

**Trigger:** Title document upload and AI extraction.
**Content:** Field-by-field comparison (VIN, mileage, year, make, model, state) between title document and vehicle profile. Color-coded status (match/empty/conflict/suggestion), severity levels, checkbox selection, batch apply.
**Quality:** Real data, real logic, genuinely useful workflow.
**Issue:** Uses Tailwind classes and gradients (bg-gradient-to-r from-blue-600 to-blue-700). Violates zero-gradient, zero-border-radius rules. Uses emoji. Not remotely Nuke-styled.

#### ClickablePartModal.tsx (449 lines) -- EARNS ITS EXISTENCE: QUESTIONABLE

**Trigger:** Click a part tag on an image.
**Content:** Part search results across suppliers, order tracking, installation documentation. Three tabs: Find Part, Order Status, Document Installation.
**Quality:** Calls partsMarketplaceService for search. The concept is good but depends on a parts marketplace service that may not be fully operational.
**Issue:** Uses `var(--color-primary)` and `var(--background-secondary)` which are not in the design system. Uses `var(--surface-elevated)` for text color which is wrong. Font sizes (13px, 16px, 21px) don't match the system. 1px borders instead of 2px.

#### VehicleInquiryModal.tsx (301 lines) -- EARNS ITS EXISTENCE: YES

**Trigger:** Inquire button on organization vehicle listings.
**Content:** Contact form with inquiry type selector, pre-filled user data, message. Creates both vehicle_interaction_requests and work_orders.
**Quality:** Real workflow, real data persistence. Auto-fills from authenticated user profile.
**Issue:** Uses `var(--white)` directly. 1px borders. Close button is a raw "x" character at 27px. Mostly compliant but rough edges.

#### VehicleValueEditModal.tsx (275 lines) -- EARNS ITS EXISTENCE: YES

**Trigger:** Edit vehicle value on dashboard.
**Content:** Purchase price input, current value input, ROI preview calculation, save with price source attribution.
**Quality:** Real data, real price source tracking via priceSourceService. ROI preview is immediate visual feedback.
**Issue:** Mix of design-system classes (button, button-primary, input) and inline styles. Mostly compliant.

#### ScoreDetailModal.tsx (515 lines) -- EARNS ITS EXISTENCE: PARTIALLY

**Trigger:** Click score on vehicle profile.
**Content:** Score breakdown with factors table, bonuses/modifiers, blurred algorithm formula (click-to-reveal), source comments, AI sentiment analysis.
**Quality:** Real score data from calculate-vehicle-scores edge function. The blurred formula reveal is a nice interaction.
**Issue:** "Users Like You" section is a **COMING SOON** placeholder with hardcoded placeholder data. z-index 9999. Uses `to8` font-size shorthand which isn't standard CSS.

#### QuickFixModal.tsx (479 lines) -- EARNS ITS EXISTENCE: PARTIALLY

**Trigger:** Quick fix button on admin dashboard.
**Content:** Batch fix missing data (price, VIN, mileage, color, images) across multiple vehicles. Per-vehicle input fields with individual and batch save.
**Quality:** Real workflow for data entry.
**Issue:** Images tab is a **PLACEHOLDER** -- says "visit each vehicle's profile page directly". Progress bar exists but the batch save has no actual batching logic.

### UTILITY MODALS (small, focused, appropriate)

#### ConfirmModal.tsx (163 lines) -- EARNS ITS EXISTENCE: YES

Generic confirmation dialog with danger/warning/info types. Uses CSS variables. Optional amount display. z-index 10000. Well-scoped.

#### InputDialog.tsx (136 lines) -- EARNS ITS EXISTENCE: YES

Text input dialog. Auto-focus, Enter to confirm, Escape to cancel. z-index 1000 (inconsistent with ConfirmModal's 10000). Uses class-based styling. Well-scoped.

#### ImageSetModal.tsx (325 lines) -- EARNS ITS EXISTENCE: YES

Create/edit image sets with name, description, color picker (8 presets), icon, timeline event linking. Functional and focused.

#### UpdateSalePriceModal.tsx (299 lines) -- EARNS ITS EXISTENCE: YES

Form: sale type, price, date, buyer name, notes. Calls recordSoldPrice then updates vehicles table.
**Issue:** Falls back to `window.location.reload()` if no onSuccess callback. Crude but functional.

#### ImportProgressModal.tsx (101 lines) -- EARNS ITS EXISTENCE: YES

Receipt processing progress with steps checklist and progress bar. Uses CSS classes (modal-overlay, modal, modal-header). Compact and focused.

### PLACEHOLDERS AND STUBS

#### PartCheckoutModal.tsx (63 lines) -- EARNS ITS EXISTENCE: NO (PLACEHOLDER)

"Minimal checkout modal placeholder. Calls onSuccess with a dummy id." The Purchase button generates `purchase_${Date.now()}` as the purchase ID. This is a build stub that should not be in production.

#### PartEnrichmentModal.tsx (64 lines) -- EARNS ITS EXISTENCE: NO (PLACEHOLDER)

"Minimal placeholder to satisfy build until the full modal is provided." Shows tag name and Save/Close. Save calls onSave() then closes. No actual enrichment logic.

#### SpatialPartPopup.tsx (89 lines) -- EARNS ITS EXISTENCE: MARGINAL

Minimal supplier selection popup. Shows part name, OEM part number, supplier list with prices. Functional but very bare. 1px borders, uses `inset: 0` shorthand.

### DEAD CODE

#### ProxyBidModal.tsx (727 lines) -- EARNS ITS EXISTENCE: NO (DEAD FEATURE)

Multi-step proxy bidding: credentials, agency agreement, Stripe deposit, commission calculation. **This is from the deleted betting/trading feature.** Per CLAUDE.md and platform-hygiene rules, betting/trading/exchange features were deleted. This 727-line modal should be removed.

### QUESTIONABLE / EDGE CASES

#### RiskDisclosureModal.tsx (270 lines) -- EARNS ITS EXISTENCE: NO (DEAD FEATURE)

Investment risk disclosures (illiquidity, total loss, no guarantee of returns, no dividends, conflicts of interest). Requires typed "I UNDERSTAND" confirmation. Saves to `risk_disclosure_acknowledgments` table. Uses `usePlatformStatus` with `isDemoMode`.
**This is investment/trading infrastructure.** Per the deleted features list: "betting, trading/exchange, vault, concierge/villa, shipping, investor portal." This modal serves the investor portal and should be removed.

#### AnalysisModelPopup.tsx (363 lines) -- EARNS ITS EXISTENCE: MARGINAL

Shows AI model info (what it searches for, what it outputs, usage stats). Hardcoded model definitions for Gemini, GPT-4o, Claude variants.
**Quality:** The concept is useful for transparency. But the usage stats query scans 1000 vehicle_images and loops through ai_scan_metadata JSONB -- expensive and imprecise. The model definitions will go stale as models change.
**Issue:** Uses `var(--white)`, `var(--border-medium)`, `var(--border-light)`, `var(--space-*)` CSS variables that may not be in the design system. z-index 10001 for popup, 10000 for backdrop (reversed -- backdrop should be higher or equal).

#### DataContextModal.tsx (330 lines) -- EARNS ITS EXISTENCE: YES

Shows comparable vehicles by year/make/model with sort options (coolest, nearest, best ROI, highest value, most documented). Grid of vehicle cards. Functional and useful for discovery context.

---

## Cross-Cutting Issues

### z-index Chaos

There is no z-index coordination. Values found:

| Component | z-index |
|-----------|---------|
| InputDialog | 1000 |
| NotificationCenter | 1000 |
| PriceHistoryModal | 1000 |
| ServiceReportModal | 9999 |
| ScoreDetailModal | 9999 |
| ConfirmModal | 10000 |
| Most standalone modals | 10000 |
| AnalysisModelPopup (popup) | 10001 |
| CitationModal | 10002 |
| SpatialPartPopup | 10040 |
| PartEnrichmentModal | 10050 |
| PartCheckoutModal | 10060 |
| ValidationPopupV2 image viewer | 10002 |

**Recommendation:** Define z-index layers in the design system CSS as named custom properties.

### Styling Approaches (at least 4 in use)

1. **Design-system inline styles** (ValidationPopupV2, PopupContainer) -- 9px ALL CAPS Arial, 2px borders, CSS variables
2. **Tailwind classes** (TitleValidationModal, DuplicateDetectionModal, RiskDisclosureModal) -- completely different visual language
3. **CSS class names** (ImportProgressModal, SearchOverlay) -- .modal-overlay, .button, .input
4. **Hybrid** (most others) -- mix of inline styles and class names

**Recommendation:** All standalone modals should migrate to design-system inline styles or CSS classes that reference unified-design-system.css tokens. Zero Tailwind in modals.

### Dismissal Patterns

- **Overlay click + Escape:** PopupStack, ConfirmModal, InputDialog
- **Overlay click only:** Most standalone modals
- **Close button only:** Some modals don't dismiss on overlay click
- **No Escape handler:** Most standalone modals

**Recommendation:** All modals should support both overlay click and Escape to dismiss.

### Data Loading Patterns

- **RPC calls:** PopupStack children (popup_vehicle_intel, popup_make_intel, etc.) -- clean, single call
- **Multiple sequential queries:** ValidationPopupV2 (5+ separate queries) -- slow, waterfally
- **Direct Supabase queries:** Most standalone modals -- inconsistent field selection

**Recommendation:** High-traffic modals should follow the PopupStack pattern of a single RPC call that returns everything needed.

---

## Action Items

### DELETE (dead code / deleted features)
1. `ProxyBidModal.tsx` (727 lines) -- betting/trading feature, explicitly deleted
2. `RiskDisclosureModal.tsx` (270 lines) -- investor portal feature, explicitly deleted

### DELETE (placeholders with no real function)
3. `PartCheckoutModal.tsx` (63 lines) -- dummy purchase ID stub
4. `PartEnrichmentModal.tsx` (64 lines) -- build placeholder

### CONSOLIDATE
5. Merge `DataValidationPopup.tsx` into `ValidationPopupV2.tsx` -- two validation popup systems is one too many

### DECOMPOSE
6. `ImageLightbox.tsx` (~98KB) -- break into ImageViewer, ImageChat, ImageAnnotation, ImageInfo subcomponents
7. `ValueProvenancePopup.tsx` (~79KB) -- break into manageable subcomponents

### RESTYLE (Tailwind to design system)
8. `TitleValidationModal.tsx` -- remove gradients, Tailwind, emoji; apply Nuke styling
9. `DuplicateDetectionModal.tsx` -- remove Tailwind, lucide-react icons; apply Nuke styling
10. `RiskDisclosureModal.tsx` -- if not deleted, restyle (but should be deleted)

### FIX
11. Standardize z-index values with CSS custom properties
12. Add Escape-to-close to all standalone modals
13. Fix `ScoreDetailModal.tsx` "Users Like You" placeholder -- either implement or remove the section
14. Fix `QuickFixModal.tsx` images tab placeholder
15. Extract shared PriceScatter component from MakePopup/ModelPopup
16. Replace `window.location.reload()` calls in UpdateSalePriceModal and ValidationPopupV2 with proper state refresh

---

## Summary Scorecard

| Category | Count | Verdict |
|----------|-------|---------|
| PopupStack system components | 8 | All excellent, all earn existence |
| Standalone modals -- production quality | 10 | Earn existence, some need restyle |
| Standalone modals -- functional | 6 | Earn existence with caveats |
| Standalone modals -- utility | 5 | Small, focused, appropriate |
| Placeholders / stubs | 3 | Delete or implement |
| Dead code (deleted features) | 2 | Delete immediately |
| Oversized (need decomposition) | 2 | Refactor |
| **Total popup/modal components** | **~36** | |

The PopupStack system is the best-architected piece of the frontend. The standalone modals need a consistency pass but most serve real purposes with real data. The immediate wins are deleting the 4 dead/placeholder files (~1,124 lines) and restoring styling consistency.
