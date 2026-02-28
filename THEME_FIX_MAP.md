# Theme Fix Map

**Generated: 2026-02-27**
**Total files scanned: ~230+ with violations**
**Total violations found: ~1,709 inline + ~130 CSS + ~2,750 uncovered Tailwind**

---

## Missing CSS Variables

97 variables referenced in components but not defined in `unified-design-system.css`.
71 of these have NO fallback value — they silently resolve to nothing.

### Critical (used in 5+ files, no fallback)

| Variable | Used In | Suggested Light | Suggested Dark |
|----------|---------|----------------|---------------|
| `--danger` | 25 files | `#d13438` (alias → `--error`) | `#d13438` |
| `--bg-secondary` | 26 files | `#fafafa` | `#1a1a1a` |
| `--header-height` | 8 files | `48px` | `48px` |
| `--success-light` | 6 files | `rgba(22, 130, 93, 0.1)` (alias → `--success-dim`) | same |
| `--info` | 6 files | `#0ea5e9` | `#38bdf8` |
| `--background` | 6 files | alias → `--bg` | alias → `--bg` |
| `--text-primary` | 5 files | alias → `--text` | alias → `--text` |
| `--success-bg` | 5 files | `rgba(22, 130, 93, 0.1)` (alias → `--success-dim`) | same |
| `--link` | 5 files | `var(--accent)` | `var(--accent)` |
| `--gray-50` | 5 files | alias → `--grey-50` | alias → `--grey-50` |
| `--color-primary` | 4 files | alias → `--accent` | alias → `--accent` |
| `--border-hover` | 4 files | alias → `--border-focus` | alias → `--border-focus` |
| `--error-text` | 4 files | alias → `--error` | alias → `--error` |
| `--background-secondary` | 4 files | alias → `--bg-secondary` | alias → `--bg-secondary` |
| `--primary` | (old design-system only) | alias → `--accent` | alias → `--accent` |

### Medium (used in 2-4 files)

| Variable | Suggested Resolution |
|----------|---------------------|
| `--card-bg` | alias → `--surface` |
| `--shadow-lg` | `0 4px 12px rgba(0,0,0,0.15)` / `0 4px 12px rgba(0,0,0,0.5)` |
| `--danger-bg` / `--danger-light` | alias → `--error-dim` |
| `--primary-light` / `--primary-dim` | alias → `--accent-dim` |
| `--surface-secondary` | alias → `--bg` |
| `--surface-elevated` | `#ffffff` / `#2d2d30` |
| `--input-bg` | alias → `--bg` |
| `--secondary` | alias → `--text-secondary` |
| `--error-light` / `--error-background` | alias → `--error-dim` |
| `--warning-light` | alias → `--warning-dim` |

### Gray vs Grey Spelling Mismatch

Design system uses `--grey-*`. Components reference `--gray-*`. Need aliases:
- `--gray-50` → `--grey-50`
- `--gray-100` → `--grey-100`
- `--gray-400` → `--grey-400`
- `--gray-500` → `--grey-500`
- `--gray-600` → `--grey-600`
- `--gray-700` → `--grey-700`
- `--gray-900` → `--grey-900`

---

## Files with Hardcoded Colors (by severity)

### Critical (visible on main pages, 15+ violations each)

1. `src/pages/admin/TransfersDashboard.tsx` — ~52 violations
2. `src/components/ComprehensiveWorkOrderReceipt.tsx` — ~50 violations
3. `src/components/image/ImageLightbox.tsx` — ~40 violations (rgba + hex + named)
4. `src/components/image/ImageInfoPanel.tsx` — ~40 violations (rgba heavy)
5. `src/pages/AdminMissionControl.tsx` — ~30 violations
6. `src/pages/AuctionMarketplace.tsx` — ~28 violations
7. `src/pages/HomePage.tsx` — ~27 violations
8. `src/components/images/BundleReviewQueue.tsx` — ~25 violations
9. `src/pages/admin/ScraperDashboard.tsx` — ~25 violations
10. `src/components/image/EnhancedImageTagger.tsx` — ~18 violations
11. `src/pages/admin/InventoryAnalytics.tsx` — ~18 violations (Recharts SVG)
12. `src/pages/BidMarketDashboard.tsx` — ~18 violations
13. `src/components/trading/OrderBook.tsx` — ~16 violations
14. `src/pages/vehicle-profile/VehicleHeader.tsx` — ~15 violations
15. `src/components/vehicles/VehicleCardDense.tsx` — ~15 violations

### High (common components, 5-14 violations each)

16-80+: See audit agent output for full file list. Includes:
- All trading components (TradingTerminal, MarketDepth, PriceChart)
- Organization components (EnhancedDealerInventory ~12, WorkOrderViewer ~4)
- Feed components (FeedGrid, FeedStatsBar, ScrollToTopButton)
- Vehicle components (VehicleStreamingCard, MergeProposalsPanel, NukeEstimatePanel)
- Admin pages (BotTestDashboard ~6, BatchImageAnalysis, DataQualityDashboard)
- Profile components (TechInbox, StreamingDashboard, ContributionTimeline)

### CSS Files with No Dark Mode Support

1. `src/components/vehicle/AnnotatedField.css` — 33 hardcoded colors, ZERO dark support
2. `src/components/profile/ProfessionalToolbox.css` — 16 hardcoded colors, ZERO dark support
3. `src/design-system.css` component rules (lines 2638-3811) — ~80 hardcoded colors

---

## Tailwind Utility Classes Not Covered by Compat Layer

**2,750 of 4,838 (56.9%) base color class uses are uncovered.**

### Biggest Gaps (by usage count)

| Class | Count | Impact |
|-------|-------|--------|
| `text-white` | 413 | Invisible on inverted dark backgrounds |
| `bg-gray-800` | 161 | Dark boxes on dark background |
| `bg-gray-700` | 112 | Dark boxes on dark background |
| `bg-gray-900` | 97 | Dark boxes on dark background |
| `bg-blue-600` | 79 | Blue buttons uncovered |
| `border-white` | 57 | Light borders invisible on dark |
| `text-green-600` | 50 | Success text uncovered |
| `text-green-400` | 49 | Success text uncovered |
| `bg-black` | 47 | Pure black uncovered |
| `text-red-600` | 45 | Error text uncovered |
| `ring-blue-500` | 44 | Focus rings uncovered |
| `bg-blue-700` | 40 | Blue buttons uncovered |
| `text-red-400` | 39 | Error text uncovered |
| `text-blue-600` | 38 | Link text uncovered |
| `bg-blue-500` | 35 | Blue buttons uncovered |

### Color Families Summary

| Family | Uses | Covered? |
|--------|------|----------|
| Gray (covered shades) | 2,088 | Yes |
| Gray (uncovered shades) | 1,116 | No |
| Blue/Indigo | 397 | No |
| Green | 254 | No |
| Red | 253 | No |
| Yellow/Amber | 169 | No |
| Zinc | 102 | No |
| Sky/Cyan | 83 | No |
| Ring classes | 81 | No |
| Shadow classes | 62 | No |
| Gradient classes | 46 | No |
| State variants (hover/focus/dark) | 915 | No |
