# Typography and Legibility Review

**Reviewer:** Typography Director
**Date:** 2026-04-05
**Scope:** Every typographic decision in the app -- font choices, sizes, contrast ratios, line lengths, hierarchy, letter-spacing, and whether the 8-11px constraint serves the data or fights it.

---

## EXECUTIVE SUMMARY

The design system's typographic philosophy is coherent and well-articulated. The 8-11px range, Arial + Courier New pairing, and Bloomberg Terminal inheritance produce a distinctive, information-dense interface that rewards skilled users. But the philosophy has drifted from its implementation. The strict size constraint is applied unevenly, creating a system where some text is illegible while other text violates the rules entirely. The contrast ratios in several configurations fail WCAG AA, and the heavy reliance on 8px uppercase labels creates a wall of identical micro-text that flattens hierarchy rather than establishing it.

**Verdict:** The typography is 70% excellent and 30% self-defeating. The philosophy is right. The execution needs targeted corrections.

---

## 1. CONTRAST RATIO ANALYSIS

WCAG 2.1 requires a minimum contrast ratio of 4.5:1 for normal text and 3:1 for large text (18px+ or 14px bold). Since Nuke's largest text is 11px, ALL text in the system is "normal text" and must meet 4.5:1.

### Light Mode

| Color Pair | Hex Values | Computed Ratio | Verdict |
|-----------|------------|---------------|---------|
| Primary text on background | #2a2a2a on #f5f5f5 | ~10.4:1 | PASS -- excellent |
| Secondary text on background | #666666 on #f5f5f5 | ~5.7:1 | PASS |
| Disabled text on background | #999999 on #f5f5f5 | ~2.8:1 | FAIL -- below 4.5:1 |
| Secondary text on surface | #666666 on #ebebeb | ~4.6:1 | PASS -- barely |
| Disabled text on surface | #999999 on #ebebeb | ~2.3:1 | FAIL |
| "Pencil" text (vehicle profile) | #888888 on #ffffff | ~3.5:1 | FAIL |
| "Text faint" (vehicle profile) | #bbbbbb on #ffffff | ~1.9:1 | FAIL -- severely |
| "Text faint" on row-alt | #bbbbbb on #f9f9f9 | ~1.8:1 | FAIL -- severely |

### Dark Mode

| Color Pair | Hex Values | Computed Ratio | Verdict |
|-----------|------------|---------------|---------|
| Primary text on background | #cccccc on #1e1e1e | ~9.5:1 | PASS -- excellent |
| Secondary text on background | #858585 on #1e1e1e | ~4.6:1 | PASS -- barely |
| Disabled text on background | #656565 on #1e1e1e | ~3.0:1 | FAIL |
| "Pencil" text (vehicle profile) | #858585 on #252526 | ~3.9:1 | FAIL |
| "Text faint" (vehicle profile) | #555555 on #252526 | ~2.1:1 | FAIL -- severely |

### The Problem

The design system's "dark grey principle" (avoiding pure black/white for fatigue reduction) is sound for primary text. But it creates a cascade problem: if primary text is already de-contrasted, then secondary and tertiary text levels fall below legibility thresholds.

The vehicle profile CSS (`vehicle-profile.css`) defines its own token set (`--vp-pencil: #888888`, `--vp-text-faint: #bbbbbb`) that is even lower contrast than the design system tokens. These are used for:
- Section header labels (e.g., "MODIFICATIONS", "DOCUMENTATION", "TIMELINE")
- Provenance indicators (the small arrows and "1x" confidence markers)
- Timestamps in comment feeds
- Chart axis labels
- Badge dropdown labels

At 8px, these text elements are already at the threshold of legibility due to size. Combining 8px with sub-3:1 contrast ratios means many labels are effectively invisible to users over 40 or anyone in a non-ideal lighting environment.

**Recommendation:** Raise `--vp-pencil` to at least #707070 (light) / #999999 (dark) to clear 4.5:1. Raise `--vp-text-faint` to at least #888888 (light) / #777777 (dark) to clear 3:1 minimum. The "disabled" token (`--text-disabled: #999999`) should be renamed to communicate that it is intentionally below contrast threshold and should only be used for truly disabled/unavailable states, never for readable content.

---

## 2. THE 8px PROBLEM

58 instances of `font-size: 8px` in `vehicle-profile.css` alone. 8px is the most-used font size in the entire application. This is a problem because 8px was designed for "micro labels" -- the design book says it is for "badge labels, section headers, metadata captions, axis labels on charts." But it has become the default for everything that is not a primary value.

### What 8px is being used for (correctly)

- Badge text in the sub-header bar: "1984", "CHEVROLET", "PICKUP" -- short, uppercase, high-contrast. Works.
- Chart axis labels: "MAY", "JUN", "JUL" -- short, uppercase, contextual. Works.
- Provenance confidence markers: "1x" next to field values -- tiny supplementary info. Acceptable.

### What 8px is being used for (incorrectly)

- **Modification lists:** "4x4 conversion / 4-inch suspension lift / Pro Comp shocks / 16-inch steel wheels / 315/75 BFG KO3 all-terrain tires" -- This is a full sentence of important vehicle data rendered at 8px. It is the smallest readable text in the browser, rendered in a proportional font, describing the physical configuration of the vehicle. This should be 9px minimum.
- **Comment feed text metadata:** Author names, timestamps, and source indicators in the feed are all 8px. The actual comment text is 9px. The 1px difference between metadata and content is invisible to the eye -- they look the same size, defeating the hierarchy.
- **Signals table cells:** Entire rows of key-value data at 8px. Signal names like "MARKET POSITION" in uppercase + 0.08em letter-spacing at 8px are at the absolute limit of legibility.
- **Service record dates, locations, and confidence indicators:** All 8px. Service history is critical vehicle data, not metadata captions.
- **Show-more buttons:** The "SHOW MORE" toggle for descriptions is 8px uppercase. This is an interactive element that should be visually distinct, not shrunk to caption size.
- **Feed filter buttons:** The ALL/COMMENTS/BIDS filter bar uses 8px text. These are touch/click targets with text labels. At 8px, the text inside them is decorative -- users are clicking based on position memory, not reading.

### The 6px violation

Two instances of `font-size: 6px` exist:
- `vehicle-profile.css:747` -- used for something in the barcode timeline
- `.dot` class separator between feed metadata items

6px is below the design system's stated minimum of 8px. At 6px, text is illegible on standard displays and serves no communicative purpose. It is purely decorative at that point. The dot separator should be a CSS border or pseudo-element, not a text character rendered at 6px.

### The "above 11px" violations

The design system states no size above 11px in the standard interface. But:
- `pricing-item__value` uses 12px for prices (acceptable -- Courier New monospace prices deserve emphasis)
- `pricing-item__value--lg` uses 16px for the primary price (the most important number on the page -- arguably correct)
- Legacy `design-system.css` has 14px, 18px, 24px, 32px in various places (frozen file, but still loaded)
- `AppHeader.css` uses 13px (the NUKE wordmark? acceptable as brand element)
- `ProfessionalToolbox.css` uses 13px, 14px, 16px, 18px, 24px -- a component that ignores the design system entirely
- `UniversalImageUpload.tsx` has inline styles at 14px, 16px, 18px, 24px
- `AdminDashboard.tsx` uses 14px, 18px, 24px inline

The legacy `design-system.css` file also uses `pt` units in several places (8pt, 9pt), which render at 1.333x their pixel equivalent. So `8pt` = ~10.67px and `9pt` = ~12px. The unified design system's header correctly warns "UNIT: Always px. Never pt." but the old file is still loaded.

**Recommendation:** The pricing breakout at 12-16px is good and should be formalized as a deliberate exception ("data emphasis sizes"). The ProfessionalToolbox and UniversalImageUpload components need remediation. The legacy `design-system.css` should be audited for which styles are still active and overriding the unified system.

---

## 3. LINE HEIGHT AND READING COMFORT

### Current line-height values

| Context | line-height | Font Size | Computed Leading | Verdict |
|---------|-----------|-----------|-----------------|---------|
| Body default | 1.3 | 10px | 13px (3px) | Tight but adequate for short labels |
| Vehicle profile base | 1.4 | 10px | 14px (4px) | Good for data tables |
| Description text | 1.6 | 9px | 14.4px (5.4px) | Excellent for reading paragraphs |
| Feed item text | 1.5 | 9px | 13.5px (4.5px) | Good |
| AA summary | 1.6 | 9px | 14.4px (5.4px) | Excellent |
| Barcode timeline labels | 1.1 (via --leading-tight) | 8px | 8.8px (0.8px) | TIGHT -- descenders may clip |

The line-height values are generally well-chosen. The description and analysis sections use 1.5-1.6 for paragraph text at 9px, which provides comfortable reading. The `max-width: 65ch` constraint on description text is excellent -- it prevents lines from running too wide.

### Where line-height fails

- The `line-height: 11px` hard value at line 499 of vehicle-profile.css (on an 8px element) creates exactly 3px of leading, which is adequate for single-line labels but will clip multi-line text.
- The `--leading-tight: 1.1` token is dangerously tight for 8px text. At 8px with 1.1 line-height, the computed leading is 8.8px -- only 0.8px between lines. Descenders from one line will visually merge with ascenders from the next. This token should not be used with text that might wrap.
- The badge system uses no explicit line-height, inheriting 1.4 from the page. This is fine for single-line badges but could break if badge text ever wraps (it currently does not due to `white-space: nowrap`).

**Recommendation:** Add a `--leading-body: 1.5` token for any multi-line 9px text. Reserve `--leading-tight: 1.1` exclusively for single-line elements. Document that any `line-height` below 1.3 must have `white-space: nowrap` to prevent illegible wrapping.

---

## 4. LETTER-SPACING: THE UPPERCASE TAX

The vehicle profile CSS uses `text-transform: uppercase` 41 times. Nearly every uppercase instance is paired with letter-spacing, ranging from 0.02em to 0.12em. This is typographically correct -- uppercase text needs wider spacing because the uniform cap height removes the word-shape cues that lowercase provides.

### The hierarchy problem

The letter-spacing values are inconsistent, which undermines the intended hierarchy:

| Level | Example | Size | Weight | Spacing | Visual Effect |
|-------|---------|------|--------|---------|---------------|
| Section header | DESCRIPTION | 8px | 700 | 0.12em | Strong label |
| Sub-header | MODIFICATIONS (9) | 8px | 700 | 0.08em | Slightly tighter label |
| Table label | HORSEPOWER | 8px | 600 | 0.12em | Same as section header?? |
| Badge label | CHEVROLET | 8px | 600 | 0.06em | Different again |
| Filter button | ALL | 8px | 600 | 0.08em | Matches sub-header?? |

Five different letter-spacing values are used for elements that visually sit at the same hierarchy level. The user cannot distinguish 0.06em from 0.08em from 0.12em at 8px -- the differences are sub-pixel. The visual result is that all uppercase 8px labels look the same regardless of their intended hierarchy level.

**Recommendation:** Standardize to two letter-spacing values:
- `--ls-label: 0.08em` for all uppercase labels
- `--ls-wide: 0.12em` for section headers and widget titles only

This creates one visible distinction instead of five invisible ones.

---

## 5. FONT FAMILY: ARIAL'S LIMITATIONS AT SMALL SIZES

The design book's argument for Arial is compelling -- it disappears. But Arial has specific rendering weaknesses at 8-9px that matter for this application:

### The lowercase 'l' / uppercase 'I' / digit '1' ambiguity

In Arial at 8px, these three characters are nearly identical:
- `l` (lowercase L)
- `I` (uppercase i)
- `1` (digit one)

This matters in a vehicle data platform because VINs, part numbers, and engine codes contain these characters. The design system correctly mandates Courier New for VINs and machine data. But the boundary is not always clear. Consider: "350ci V8" -- is the "I" in "ci" a lowercase L or an uppercase I? In context, humans parse it correctly. But in edge cases (model names like "Il Cavallino", mixed alphanumeric identifiers), Arial's ambiguity at 8-9px creates genuine confusion.

### Antialiasing at 8px

The CSS includes `-webkit-font-smoothing: antialiased` and `-moz-osx-font-smoothing: grayscale`. On macOS Retina displays (where the developer likely works), this produces crisp, readable text even at 8px because the physical pixels are 2x the CSS pixels. On standard-DPI Windows displays (still common), 8px Arial with subpixel antialiasing disabled renders poorly -- individual strokes of characters like 'e', 'a', 's' blur together.

The design system does not acknowledge this platform discrepancy. The "workstation" metaphor from the design book implies a professional setup with good displays, but makes no minimum display requirement explicit.

**Recommendation:** Add a comment to the design system documenting that 8px text is optimized for Retina/HiDPI displays. Consider making 9px the minimum on standard-DPI displays (detectable via `resolution` media query, though this is rarely reliable in practice). The more pragmatic fix: reduce the dependency on 8px by promoting more content to 9px, reserving 8px for genuinely supplementary micro-labels.

---

## 6. HIERARCHY ANALYSIS: CAN YOU SCAN THIS PAGE?

Good typography creates a clear visual hierarchy that guides the eye. The test: can you scan a vehicle profile page and immediately identify what is most important, second most important, etc.?

### Current hierarchy (vehicle profile page, top to bottom):

1. **Hero image** -- dominates viewport. No text competes. Good.
2. **Badge bar** -- 8px uppercase badges. All visually equal weight. No single badge says "this is the vehicle name." The year, make, model, trim, body, engine, trans, drivetrain, and location all look identical. The user must read all of them sequentially. There is no focal point.
3. **Estimate / Deal / Heat / Observations** -- 8px labels with 10-11px values. The price is the most important number and it does stand out (bold monospace). Good hierarchy within this row.
4. **Vehicle Information table** -- Labels are 8px uppercase, values are 9px linked text. The label-value distinction works because labels are grey and values are dark. Adequate.
5. **Provenance Coverage** -- A progress bar widget. The label is 8px uppercase. The bar itself communicates visually. Works.
6. **Description** -- Collapsible section header is 8px uppercase. Body text is 9px at line-height 1.6 with max-width 65ch. This is the best-typeset element on the page. The description text is actually comfortable to read.
7. **Sessions column** -- Session titles appear to be around 10-11px, with dates at 9px and category tags in color. This column has the best hierarchy on the page -- title, date, type are visually distinct.

### What is missing

- **Vehicle name** -- There is no single element that says "1983 GMC K2500 Sierra Classic" in a size that anchors the page. The closest is the badge bar, but that fragments the name across 3-4 separate badges. Bloomberg Terminal always has a ticker symbol in large text at the top of every panel. Nuke has no equivalent.
- **Section breaks** -- Every collapsible section (DESCRIPTION, VEHICLE INFORMATION, PRICING, etc.) uses the same 8px uppercase header. The sections are distinguished by content, not by typography. A quick vertical scan of the left column shows a uniform grey texture of 8px labels with no visual landmarks.
- **Price emphasis** -- The pricing section correctly uses 12-16px for values. This is the one place where the 8-11px constraint is broken, and it is the right call. But the pricing grid is buried below the fold, below the description, below the vehicle info. The most decision-relevant data (price, estimate, deal score) should have the strongest typographic presence.

**Recommendation:** The badge bar needs a companion element -- either an 11px title line that reads "1983 GMC K2500 Sierra Classic" above the badges, or the make/model badges should be visually differentiated (bold, slightly larger, or darker than the spec badges). Widget section headers should alternate between two visual treatments to create rhythm (e.g., bordered vs. borderless, or 9px vs. 8px).

---

## 7. THE FONT-SCALE MECHANISM

The `--font-scale` CSS variable and `textScale` in ThemeContext.tsx provide proportional scaling from 0.9x to 1.2x. This is the right approach -- all sizes scale uniformly, maintaining relative hierarchy.

### Issues

1. **Vehicle profile ignores it.** The vehicle-profile.css uses hardcoded `font-size: 8px`, `font-size: 9px`, etc. -- never `var(--fs-8)`, `var(--fs-9)`. There are only 4 files that reference `var(--fs-*)` tokens at all (index.css, AppHeader.css, unified-design-system.css, MergeProposalsDashboard.css). The vehicle profile -- the most text-dense page in the application -- is entirely outside the font-scale system.

2. **No UI for the control.** The ThemeContext stores and applies textScale, but I did not find a user-facing control to change it (it may exist in settings). If it exists, it is not discoverable.

3. **Interaction with 8px.** At `--font-scale: 0.9`, 8px becomes 7.2px. This is below the absolute minimum legibility threshold on any display. The scale should clamp at a minimum that keeps the smallest text at 8px: `max(8px, calc(8px * var(--font-scale)))`. Or simpler: clamp the scale range to 1.0-1.3x, removing the 0.9x option.

**Recommendation:** Migrate vehicle-profile.css to use `var(--fs-*)` tokens instead of hardcoded px values. This is a large mechanical change (58+ instances of `font-size: 8px` alone) but is necessary for the font-scale feature to work. Clamp minimum scale to 1.0x.

---

## 8. THE pt vs px CONTAMINATION

The legacy `design-system.css` file uses `pt` units in several places:
- `--font-size-small: calc(8pt * var(--font-scale))` -- renders as ~10.67px
- `--font-size: calc(8pt * var(--font-scale))` -- renders as ~10.67px
- Various component styles: `font-size: 9pt` (~12px), `font-size: 8pt` (~10.67px), `font-size: 6pt` (~8px), `font-size: 7pt` (~9.33px)

The unified design system header explicitly warns: "UNIT: Always px. Never pt. (8pt != 8px -- pt renders at 1.333x px)." But the legacy file is still loaded and potentially active. Any component that references `var(--font-size)` from the legacy system gets 10.67px instead of the intended 8px or 9px from the unified system.

The `ApiLanding.tsx` page uses `calc(16pt * var(--font-scale, 1))` and `calc(9pt * var(--font-scale, 1))` -- these are explicit pt uses in new code. The `OrganizationOfferingTab.tsx` uses 8pt through 18pt for a print-style offering document -- which might be intentional for print rendering.

**Recommendation:** Audit which components still import or inherit from `design-system.css`. Any `pt` values in non-print contexts should be converted to `px`. The ApiLanding page values should be migrated to px tokens.

---

## 9. DARK MODE TYPOGRAPHY SPECIFIC ISSUES

Dark mode typography is generally well-handled. The primary text (#cccccc on #1e1e1e at ~9.5:1) is excellent. But:

- **The vehicle profile's own dark mode tokens are weaker than the system tokens.** `--vp-pencil` maps to #858585 in dark mode, which yields ~3.9:1 on the surface color (#252526). This is below 4.5:1 for the labels that use it -- which is most of them.
- **The "text faint" token** (#555555 on #252526) is ~2.1:1. This is used for timestamps, confidence markers, and secondary metadata. In dark mode, these elements are genuinely invisible in low-light environments.
- **Orange accent colors** (the --vp-gulf-orange used for "documentation", "inspection" category tags in sessions) render at approximately #c87830 on #252526, which is ~3.7:1. Borderline.

**Recommendation:** The vehicle profile's dark mode tokens need the same treatment as light mode -- raise the floor. `--vp-pencil` should be at least #999999 in dark mode. `--vp-text-faint` should be at least #777777.

---

## 10. WHAT THE TYPOGRAPHY GETS RIGHT

Credit where it is earned:

1. **Arial + Courier New separation is effective.** The dual-font system genuinely communicates the difference between human text and machine data. When you see Courier New, you know it is a measurement. This is a real design contribution.

2. **Description text at 9px / 1.6 / 65ch is excellent.** The description paragraphs are genuinely comfortable to read. The line-height and max-width create proper reading rhythm. This is better typesetting than most web applications achieve at any font size.

3. **The greyscale-first palette makes semantic color pop.** When "ABOVE MKT" appears in dark red, it stands out because nothing else is red. The color restraint amplifies the meaning of color when it appears.

4. **Tabular-nums and lining-nums on prices.** The `font-variant-numeric: tabular-nums lining-nums` on pricing values ensures columns of numbers align vertically. This is a professional touch that most applications miss.

5. **The pricing breakout.** Using 12-16px for the most important number on the page is the correct exception to the 8-11px rule. It proves that the system can accommodate exceptions without breaking.

6. **Zero border-radius reinforces the typographic severity.** The sharp corners and the small text create a coherent visual language. Rounded corners would fight the terminal aesthetic.

---

## PRIORITIZED RECOMMENDATIONS

### P0 -- Accessibility failures (fix now)

1. **Raise --vp-pencil to #707070 (light) / #999999 (dark).** This affects section labels, metadata, confidence markers. Current values fail WCAG AA.
2. **Raise --vp-text-faint to #888888 (light) / #777777 (dark).** Current values are severely below threshold.
3. **Eliminate 6px font-size.** Replace the two instances with CSS borders/spacing or raise to 8px minimum.
4. **Clamp --font-scale minimum to 1.0x** so scaling never produces sub-8px text.

### P1 -- Hierarchy improvements (next sprint)

5. **Add a vehicle name line** above or alongside the badge bar: 11px, bold, the full year/make/model string. Give the page an anchor.
6. **Standardize letter-spacing** to two values (0.08em label, 0.12em header) instead of the current five.
7. **Promote content at 8px that is not a micro-label to 9px.** Targets: modification lists, service record details, feed filter buttons, show-more toggles. Estimated 15-20 changes in vehicle-profile.css.

### P2 -- Technical debt (plan for)

8. **Migrate vehicle-profile.css to var(--fs-*) tokens.** 58+ hardcoded px values need to become token references for font-scale to work on the densest page.
9. **Audit legacy design-system.css** for active overrides. Convert pt to px or remove.
10. **Add a --leading-body: 1.5 token** and document line-height minimums for multi-line text.
11. **Remediate ProfessionalToolbox and UniversalImageUpload** components that ignore the design system entirely.

### P3 -- Documentation (when time allows)

12. **Document the pricing size exception** (12-16px for primary data values) as a formal pattern, not a violation.
13. **Add display requirement** to design book: "8px text is optimized for Retina/HiDPI displays."
14. **Rename --text-disabled** to --text-inert or similar to communicate that it is intentionally sub-threshold contrast and must not be used for readable content.

---

## APPENDIX: CONTRAST RATIO COMPUTATION METHOD

Relative luminance formula per WCAG 2.1:
- L = 0.2126 * R + 0.7152 * G + 0.0722 * B (where R, G, B are linearized sRGB)
- Contrast ratio = (L1 + 0.05) / (L2 + 0.05) where L1 is the lighter color

All ratios in this document are computed from hex values against their most common background context, not measured from screenshots. Actual rendering may vary slightly due to antialiasing and compositing.
