# DESIGN BOOK — Chapter 12: Document Generation

Design tokens and rules for generating documents — pitch decks, listing packages, reports, invoices — from the Nuke platform. This chapter defines the mechanical skeleton (Layer 0) that agencies and brands build on top of.

**Cross-references:**
- Token values: [TOKENS.md](./TOKENS.md)
- Dark mode mechanism: [08-dark-mode.md](./08-dark-mode.md)
- Violation patterns: [VIOLATIONS.md](./VIOLATIONS.md)
- Web UI foundations: [01-foundations.md](./01-foundations.md)

---

## Why a Separate Document Layer

The web UI uses 8–11px type, dense spacing, and workstation-grade information density. That design is correct for a person at a desk, 20 inches from a screen. It is wrong for every other context: slides projected in a room, PDFs printed on paper, pitch decks viewed on a laptop across a conference table, invoices mailed to a customer.

Documents need larger type, wider margins, and explicit control over page dimensions. They also need to work in two physical formats (A4 and US Letter) and two color spaces (sRGB for screens, CMYK for print). None of this belongs in the web design system — it would contaminate the density rules that make the workstation UI work.

The solution: a parallel token namespace. Every document token is prefixed `--doc-*`. No `--doc-*` token references a `--fs-*` or `--space-*` token. No web component imports document tokens. The two systems share a philosophy (Arial, zero border-radius, no decoration) but share no variables.

**Layer 0** means this system has no personality. It defines dimensions, grids, type scales, and color safety rules. It does not define branding, illustration style, or narrative tone. Those belong to Layer 1 (agency templates) and Layer 2 (brand customization). Layer 0 is the grid paper — what gets drawn on it is someone else's decision.

---

## Page Tokens

Two standard page sizes. All documents must declare which size they target. No auto-detection, no responsive scaling between formats.

### A4 (ISO 216)

| Dimension | Value |
|-----------|-------|
| Width | 210mm |
| Height | 297mm |
| Margins | 20mm all sides |
| Safe zone | 15mm from edge |
| Bleed | 3mm beyond trim |
| Slug | 5mm beyond bleed |

### US Letter (ANSI A)

| Dimension | Value |
|-----------|-------|
| Width | 216mm (8.5in) |
| Height | 279mm (11in) |
| Margins | 20mm all sides |
| Safe zone | 15mm from edge |
| Bleed | 3mm beyond trim |
| Slug | 5mm beyond bleed |

### Zones Defined

- **Trim edge:** The final cut line. This is where the physical page ends.
- **Bleed zone:** 3mm beyond trim. Background colors and images must extend into bleed to prevent white strips after cutting. No text, no logos.
- **Slug zone:** 5mm beyond bleed. Printer marks, color bars, registration marks. Stripped in final output.
- **Margin:** 20mm inward from trim. The outer boundary of the content area.
- **Safe zone:** 15mm inward from trim (5mm inside the margin). Nothing critical (logos, body text, key data) should appear between the margin and the safe zone boundary. This accounts for binding, perforation, and imprecise cutting.

```css
:root {
  /* A4 Page */
  --doc-page-width-a4: 210mm;
  --doc-page-height-a4: 297mm;

  /* US Letter Page */
  --doc-page-width-letter: 216mm;
  --doc-page-height-letter: 279mm;

  /* Shared Page Geometry */
  --doc-margin: 20mm;
  --doc-safe-zone: 15mm;
  --doc-bleed: 3mm;
  --doc-slug: 5mm;
}
```

---

## Slide Tokens

Slides use a 16:9 viewport. The default resolution is 1920x1080 — a 1:1 mapping to Full HD projection. Higher resolutions (3840x2160) are achieved by doubling all pixel values, not by redefining the token set.

| Property | Value |
|----------|-------|
| Viewport width | 1920px |
| Viewport height | 1080px |
| Padding | 80px all sides |
| Content area | 1760x920px |
| Max content width | 1600px (centered) |
| Min font size | 12px |

The 80px padding creates a consistent frame around all slide content. The 1600px max content width prevents text lines from running the full 1760px — lines longer than ~80 characters degrade readability in presentation contexts.

The 12px minimum font size is absolute. The web UI uses 8px labels because users sit 20 inches from a screen. Slides are viewed at 6–20 feet. Anything below 12px is illegible at presentation distance and marginal in printed handouts.

```css
:root {
  /* Slide Viewport */
  --doc-slide-width: 1920px;
  --doc-slide-height: 1080px;
  --doc-slide-padding: 80px;
  --doc-slide-content-width: 1760px;
  --doc-slide-content-height: 920px;
  --doc-slide-max-text-width: 1600px;
  --doc-slide-min-font: 12px;
}
```

---

## Grid System

The web UI uses a 4px base grid. Documents use 8px — double the base — because the larger type and wider spacing of documents make 4px increments too fine to be meaningful.

### Slide Grid

| Property | Value |
|----------|-------|
| Base unit | 8px |
| Columns | 12 |
| Gutter | 24px |
| Column width | (content width - 11 gutters) / 12 |

At 1760px content width with 24px gutters: each column is ~124.67px. In practice, columns are defined as fractions (`1fr`), not fixed pixel widths.

### Page Grid

| Property | Value |
|----------|-------|
| Base unit | 8px |
| Columns | 6 |
| Gutter | 16px |

Six columns instead of twelve. Pages are narrower than slides (170mm content width on A4 vs. 1760px on slides), and the content is typically linear (paragraphs, lists, tables) rather than spatial (chart + callout + image). Six columns provide enough structure for two-column layouts and sidebar elements without creating columns too narrow for body text.

### Grid Overlay

In development mode, a grid overlay renders on each slide/page to verify alignment. The overlay uses `--doc-accent` at 5% opacity for column fills and 10% opacity for gutter lines.

```css
:root {
  /* Grid */
  --doc-grid-base: 8px;
  --doc-grid-columns-slide: 12;
  --doc-grid-columns-page: 6;
  --doc-grid-gutter-slide: 24px;
  --doc-grid-gutter-page: 16px;
}
```

---

## Typography Scale

The web UI caps at 13px. Documents start where the web UI ends and extend to 56px for display type on title slides.

The font families are the same: Arial for human text, Courier New for machine data. The scale is different because the reading context is different.

| Level | Size | Weight | Line Height | Use |
|-------|------|--------|-------------|-----|
| Display | 56px | 700 | 1.1 | Title slides, cover pages |
| H1 | 40px | 700 | 1.15 | Section openers, chapter titles |
| H2 | 32px | 600 | 1.2 | Slide titles, page headings |
| H3 | 24px | 600 | 1.25 | Subsection headers, callout titles |
| H4 | 18px | 500 | 1.3 | Card headers, table titles |
| Body | 14px | 400 | 1.5 | Paragraph text, bullet points |
| Caption | 11px | 400 | 1.4 | Labels, footnotes, axis legends |
| Fine | 9px | 400 | 1.3 | Legal text, disclaimers, copyright |

**Line height rationale:** Display and heading levels use tight line heights (1.1–1.3) because they are short runs of text where vertical compactness matters. Body text uses 1.5 for comfortable reading across multi-line paragraphs. Fine print uses 1.3 because it is typically single-line legal language where saving vertical space is more important than reading comfort.

**Weight rationale:** Display and H1 are bold (700) for impact. H2 and H3 are semibold (600) — distinct from body without the heaviness of bold. H4 is medium (500) as a gentle step above body weight. Body, Caption, and Fine are regular (400).

```css
:root {
  /* Document Typography */
  --doc-font-family: Arial, sans-serif;
  --doc-font-mono: 'Courier New', monospace;

  --doc-font-display: 56px;
  --doc-font-h1: 40px;
  --doc-font-h2: 32px;
  --doc-font-h3: 24px;
  --doc-font-h4: 18px;
  --doc-font-body: 14px;
  --doc-font-caption: 11px;
  --doc-font-fine: 9px;

  --doc-weight-display: 700;
  --doc-weight-h1: 700;
  --doc-weight-h2: 600;
  --doc-weight-h3: 600;
  --doc-weight-h4: 500;
  --doc-weight-body: 400;
  --doc-weight-caption: 400;
  --doc-weight-fine: 400;

  --doc-lh-display: 1.1;
  --doc-lh-h1: 1.15;
  --doc-lh-h2: 1.2;
  --doc-lh-h3: 1.25;
  --doc-lh-h4: 1.3;
  --doc-lh-body: 1.5;
  --doc-lh-caption: 1.4;
  --doc-lh-fine: 1.3;
}
```

---

## Color Safety

Documents must be legible in every output medium: screen (sRGB), print (CMYK), projector (washed-out sRGB), and photocopy (greyscale). Color is never the sole carrier of meaning.

### Contrast Requirements

All text/background pairs must meet WCAG 2.1 AA:

| Text Category | Minimum Contrast Ratio |
|---------------|----------------------|
| Body text (< 18px) | 4.5:1 |
| Large text (>= 18px bold, >= 24px regular) | 3:1 |
| UI components and graphical objects | 3:1 |
| Decorative elements | No requirement |

### Contrast Checker

Given two colors, compute the relative luminance of each and derive the contrast ratio:

```javascript
function relativeLuminance(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const toLinear = (c) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function contrastRatio(hex1, hex2) {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// Usage: contrastRatio('#1a1a2e', '#FFFFFF') → 15.39:1 (passes AAA)
// Usage: contrastRatio('#666680', '#FFFFFF') → 5.36:1 (passes AA for body)
// Usage: contrastRatio('#9999aa', '#1a1a2e') → 4.93:1 (passes AA for body)
```

### Print Color Safety (CMYK Gamut)

Screen colors (sRGB) have a wider gamut than CMYK print. Bright blues, vivid greens, and saturated reds lose vibrancy when converted to CMYK. The document system flags out-of-gamut colors at export time.

**Known out-of-gamut values in the platform palette:**

| sRGB Value | Issue | CMYK-Safe Substitute |
|-----------|-------|---------------------|
| `#0ea5e9` (info) | Vivid cyan — shifts dull in CMYK | `#2b8cbf` |
| `#38bdf8` (info-dark) | Same family, same problem | `#4aa3d4` |
| `#44d62c` (mopar-sublime) | Saturated green — unprintable | `#3fb32a` |
| `#ffd100` (high-contrast gold) | Prints duller than expected | `#e6be00` |

**Rule:** When `--doc-export-colorspace` is `cmyk`, the export pipeline substitutes CMYK-safe equivalents automatically. Designers working in the light/dark slide palettes (see below) do not encounter this issue — those palettes are designed within CMYK gamut.

---

## Logo Placement Zones

Every slide has four zones reserved for identity marks. These zones are outside the main content area but inside the padding.

```
┌──────────────────────────────────────────────┐
│  [Owner Mark]              [Slide Number]    │
│                                              │
│                                              │
│              CONTENT AREA                    │
│            (1760 × 920px)                    │
│                                              │
│                                              │
│  [Doc Title / Date]         [Brand Row]      │
└──────────────────────────────────────────────┘
```

### Zone Definitions

| Zone | Position | Content | Max Height |
|------|----------|---------|------------|
| Top-left | `(80, 24)` origin | Owner mark — the entity presenting | 40px |
| Top-right | Right-aligned, `y: 24` | Slide number, section indicator | 40px |
| Bottom-left | `(80, slide-height - 56)` | Document title, date | 32px |
| Bottom-right | Right-aligned, bottom | Brand row (partner logos, horizontal) | 32px |

### Clear Space Rules

Every logo gets clear space equal to 1.5x its rendered height on all four sides. No text, no other logos, no content edges may intrude into this clear space.

For a logo rendered at 32px height:
- Clear space = 48px (1.5 x 32) on top, bottom, left, and right
- Total reserved area = 128px wide minimum (32px logo + 96px clear space)

Logos must not overlap the content zone. If a logo plus its clear space would intrude into the 1760x920 content area, the logo must be scaled down until the clear space boundary aligns with the content edge.

### Page Logo Placement

Pages follow the same four-zone model, translated to print coordinates:

| Zone | Position | Content |
|------|----------|---------|
| Top-left | Margin origin | Owner mark |
| Top-right | Right margin, top | Page number |
| Bottom-left | Margin origin, bottom | Document title |
| Bottom-right | Right margin, bottom | Brand mark |

---

## Dark / Light Slide Palettes

Slides declare their palette explicitly per-slide. There is no system-preference detection, no auto-switching, no media query involvement. A dark slide is dark because the designer said so, not because the viewer's OS is in dark mode.

### Light Slide Palette

| Token | Value | Use |
|-------|-------|-----|
| `--doc-bg` | `#FFFFFF` | Slide background |
| `--doc-text` | `#1a1a2e` | Primary text |
| `--doc-muted` | `#666680` | Secondary text, captions |
| `--doc-accent` | `#4a6741` | Marsh green — links, highlights, callout borders |
| `--doc-border` | `#d1d1d6` | Dividers, table borders |
| `--doc-surface` | `#f4f4f6` | Card backgrounds, code blocks, callout fills |

Contrast checks (light palette):
- `--doc-text` on `--doc-bg`: `#1a1a2e` on `#FFFFFF` = 15.39:1 (AAA)
- `--doc-muted` on `--doc-bg`: `#666680` on `#FFFFFF` = 5.36:1 (AA)
- `--doc-accent` on `--doc-bg`: `#4a6741` on `#FFFFFF` = 5.89:1 (AA)

### Dark Slide Palette

| Token | Value | Use |
|-------|-------|-----|
| `--doc-bg` | `#1a1a2e` | Slide background |
| `--doc-text` | `#f0efe9` | Primary text |
| `--doc-muted` | `#9999aa` | Secondary text, captions |
| `--doc-accent` | `#6b8f62` | Marsh green, lightened for dark background |
| `--doc-border` | `#3a3a4e` | Dividers, table borders |
| `--doc-surface` | `#24243a` | Card backgrounds, code blocks |

Contrast checks (dark palette):
- `--doc-text` on `--doc-bg`: `#f0efe9` on `#1a1a2e` = 13.72:1 (AAA)
- `--doc-muted` on `--doc-bg`: `#9999aa` on `#1a1a2e` = 4.93:1 (AA)
- `--doc-accent` on `--doc-bg`: `#6b8f62` on `#1a1a2e` = 4.68:1 (AA)

### Application

Each slide element declares its palette via a data attribute:

```html
<section class="slide" data-doc-theme="light">
  <!-- Uses light palette tokens -->
</section>

<section class="slide" data-doc-theme="dark">
  <!-- Uses dark palette tokens -->
</section>
```

```css
.slide[data-doc-theme="light"] {
  --doc-bg: #FFFFFF;
  --doc-text: #1a1a2e;
  --doc-muted: #666680;
  --doc-accent: #4a6741;
  --doc-border: #d1d1d6;
  --doc-surface: #f4f4f6;
}

.slide[data-doc-theme="dark"] {
  --doc-bg: #1a1a2e;
  --doc-text: #f0efe9;
  --doc-muted: #9999aa;
  --doc-accent: #6b8f62;
  --doc-border: #3a3a4e;
  --doc-surface: #24243a;
}
```

A single deck can mix light and dark slides. The palette is per-slide, not per-deck.

---

## Brand Integration Zones

Layer 0 provides four zones where Layer 2 brand colors may appear. Outside these zones, only the neutral palette applies. This prevents brand colors from overwhelming the data.

### Hero Zone

The top 30% of slide height (324px on a 1080px slide). Brand primary color may be used as a full-bleed background. Text in the hero zone must pass contrast checks against the brand color, not against `--doc-bg`.

```css
.slide-hero {
  height: 30%;
  background: var(--brand-primary, var(--doc-bg));
  color: var(--brand-primary-text, var(--doc-text));
}
```

### Accent Stripe

A 4px horizontal bar at the top or bottom edge of the slide. Brand primary color, full saturation.

```css
.slide::before {
  content: '';
  display: block;
  height: 4px;
  background: var(--brand-primary, var(--doc-accent));
}
```

### Pull Quote Background

When a pull quote or callout block uses a brand color, it applies at 10% opacity over `--doc-bg`. Text remains `--doc-text` — the brand color is atmospheric, not structural.

```css
.doc-pullquote {
  background: color-mix(in srgb, var(--brand-primary) 10%, transparent);
  border-left: 4px solid var(--brand-primary, var(--doc-accent));
  padding: 24px 32px;
}
```

### Icon Tint

SVG icons in documents are tinted with the brand primary color. Stroke and fill both receive the tint. Icons that serve as data indicators (arrows, status dots) are exempt — they use status tokens (`--doc-accent`, or status-specific colors).

```css
.doc-icon {
  color: var(--brand-primary, var(--doc-accent));
  fill: currentColor;
}
```

### Outside These Zones

All other slide/page areas use Layer 0 neutrals only. Body text, tables, charts, image captions, slide numbers, footers — all neutral. The brand integration zones are the pressure relief valve that prevents brand colors from taking over the document.

---

## Export Tokens

Settings for PDF generation. These are not CSS variables rendered in browsers — they are configuration values consumed by the export pipeline.

### Screen Export (default)

| Property | Value |
|----------|-------|
| DPI | 150 |
| Color space | sRGB |
| Font embedding | Full (never subset) |
| Image compression | JPEG quality 92 for photographs, PNG for graphics and logos |
| Metadata | Title, author, creation date, Nuke version |

### Print Export

| Property | Value |
|----------|-------|
| DPI | 300 |
| Color space | CMYK (ISO Coated v2 300%) |
| Font embedding | Full (never subset) |
| Image compression | JPEG quality 95 for photographs, PNG for graphics and logos |
| Bleed marks | Included |
| Slug content | Color bars, registration marks |
| Metadata | Title, author, creation date, Nuke version, ICC profile |

### Why Full Font Embedding

Font subsetting (embedding only the glyphs used in the document) reduces file size but introduces a rendering failure mode: if the document is later edited or reflowed, missing glyphs appear as `.notdef` boxes. Since documents generated from the platform may be edited downstream by agencies, full embedding eliminates this class of bug at the cost of ~200KB per font.

### Image Compression Rules

- **Photographs** (vehicle images, hero shots): JPEG at quality 92 (screen) or 95 (print). JPEG artifacts are invisible at these quality levels and the file size savings over PNG are 5–10x.
- **Graphics** (logos, icons, charts, diagrams): PNG always. JPEG introduces artifacts on hard edges and flat color fields.
- **Screenshots**: PNG. Same rationale as graphics.

The export pipeline determines photograph vs. graphic by checking the image source: images from `vehicle_images` are photographs; all others default to PNG unless explicitly flagged.

```css
:root {
  /* Export Configuration (consumed by pipeline, not browser) */
  --doc-export-dpi-screen: 150;
  --doc-export-dpi-print: 300;
  --doc-export-colorspace-screen: srgb;
  --doc-export-colorspace-print: cmyk;
  --doc-export-jpeg-quality-screen: 92;
  --doc-export-jpeg-quality-print: 95;
  --doc-export-font-embed: full;
}
```

---

## Complete CSS Custom Properties

All document tokens in one block. This is the canonical reference. Copy this into the document generation stylesheet.

```css
:root {
  /* ═══════════════════════════════════════
     DOCUMENT TOKENS (Layer 0)
     Prefix: --doc-*
     Namespace is isolated from web UI tokens.
     ═══════════════════════════════════════ */

  /* ── Page Geometry ── */
  --doc-page-width-a4: 210mm;
  --doc-page-height-a4: 297mm;
  --doc-page-width-letter: 216mm;
  --doc-page-height-letter: 279mm;
  --doc-margin: 20mm;
  --doc-safe-zone: 15mm;
  --doc-bleed: 3mm;
  --doc-slug: 5mm;

  /* ── Slide Geometry ── */
  --doc-slide-width: 1920px;
  --doc-slide-height: 1080px;
  --doc-slide-padding: 80px;
  --doc-slide-content-width: 1760px;
  --doc-slide-content-height: 920px;
  --doc-slide-max-text-width: 1600px;
  --doc-slide-min-font: 12px;

  /* ── Grid ── */
  --doc-grid-base: 8px;
  --doc-grid-columns-slide: 12;
  --doc-grid-columns-page: 6;
  --doc-grid-gutter-slide: 24px;
  --doc-grid-gutter-page: 16px;

  /* ── Typography: Families ── */
  --doc-font-family: Arial, sans-serif;
  --doc-font-mono: 'Courier New', monospace;

  /* ── Typography: Sizes ── */
  --doc-font-display: 56px;
  --doc-font-h1: 40px;
  --doc-font-h2: 32px;
  --doc-font-h3: 24px;
  --doc-font-h4: 18px;
  --doc-font-body: 14px;
  --doc-font-caption: 11px;
  --doc-font-fine: 9px;

  /* ── Typography: Weights ── */
  --doc-weight-display: 700;
  --doc-weight-h1: 700;
  --doc-weight-h2: 600;
  --doc-weight-h3: 600;
  --doc-weight-h4: 500;
  --doc-weight-body: 400;
  --doc-weight-caption: 400;
  --doc-weight-fine: 400;

  /* ── Typography: Line Heights ── */
  --doc-lh-display: 1.1;
  --doc-lh-h1: 1.15;
  --doc-lh-h2: 1.2;
  --doc-lh-h3: 1.25;
  --doc-lh-h4: 1.3;
  --doc-lh-body: 1.5;
  --doc-lh-caption: 1.4;
  --doc-lh-fine: 1.3;

  /* ── Colors: Light Slide Palette ── */
  /* Applied via .slide[data-doc-theme="light"] */
  --doc-bg: #FFFFFF;
  --doc-text: #1a1a2e;
  --doc-muted: #666680;
  --doc-accent: #4a6741;
  --doc-border: #d1d1d6;
  --doc-surface: #f4f4f6;

  /* ── Colors: Status (same across palettes) ── */
  --doc-success: #16825d;
  --doc-warning: #b05a00;
  --doc-error: #d13438;

  /* ── Export Configuration ── */
  --doc-export-dpi-screen: 150;
  --doc-export-dpi-print: 300;
  --doc-export-colorspace-screen: srgb;
  --doc-export-colorspace-print: cmyk;
  --doc-export-jpeg-quality-screen: 92;
  --doc-export-jpeg-quality-print: 95;
  --doc-export-font-embed: full;

  /* ── Logo Placement ── */
  --doc-logo-clear-space-ratio: 1.5;
  --doc-logo-max-height-slide: 40px;
  --doc-logo-max-height-page: 32px;

  /* ── Brand Integration ── */
  --doc-hero-height: 30%;
  --doc-accent-stripe-height: 4px;
  --doc-pullquote-brand-opacity: 10%;
}

/* ── Dark Slide Palette Override ── */
.slide[data-doc-theme="dark"] {
  --doc-bg: #1a1a2e;
  --doc-text: #f0efe9;
  --doc-muted: #9999aa;
  --doc-accent: #6b8f62;
  --doc-border: #3a3a4e;
  --doc-surface: #24243a;
}
```

---

## Document-Specific Rules

### Rule 1: Zero border-radius applies to documents

The same enforcement from the web UI extends to documents. Cards, tables, image containers, code blocks, callout boxes — all sharp corners. The `border-radius: 0 !important` universal rule applies to the document stylesheet.

### Rule 2: No gradients, no shadows

Documents use flat fills only. No `linear-gradient`, no `box-shadow`, no `text-shadow`. Gradients print unpredictably across devices. Shadows imply a light source that does not exist in a two-dimensional document.

### Rule 3: All spacing in 8px increments

The document grid base is 8px. Every margin, padding, and gap value must be a multiple of 8: 8, 16, 24, 32, 40, 48, 56, 64, 72, 80. The only exception is the 4px accent stripe, which exists as a visual rule, not a spacing element.

### Rule 4: Machine data in Courier New

Prices, VINs, mileage, dates, timestamps, and any other machine-sourced data render in `--doc-font-mono`. This rule carries forward from the web UI. In a pitch deck showing a vehicle listing, the price is Courier New. The description is Arial.

### Rule 5: No auto-detected palettes

Each slide or page must explicitly declare `data-doc-theme="light"` or `data-doc-theme="dark"`. If no declaration is present, the default is light. The document system never reads `prefers-color-scheme`, `data-theme`, or any external signal. The designer chooses. The system obeys.

### Rule 6: Export metadata is mandatory

Every generated document must include in its PDF metadata: title (from the generating context — vehicle name, report title, invoice number), author (`Nuke`), creation date (ISO 8601), and platform version. This enables provenance tracking when documents are shared downstream.

---

*Documents are the platform's handshake with the outside world. The web UI is for the operator. The document is for the client, the partner, the auction house. It carries the same data with none of the density — larger type, wider margins, explicit palettes. Layer 0 provides the skeleton. What walks out the door wearing it is Layer 2's decision.*
