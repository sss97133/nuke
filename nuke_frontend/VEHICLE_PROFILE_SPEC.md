# Vehicle Profile Design Spec (Canonical)
## Source: Perplexity design session, 2026-03-01

**This is the authoritative spec. All vehicle profile work MUST follow these rules.**

---

## CSS Custom Properties

```css
:root {
  --bg: #f5f5f5;
  --surface: #ffffff;
  --ink: #1a1a1a;
  --pencil: #888888;
  --ghost: #dddddd;
  --text-faint: #bbbbbb;
  --row-alt: #f9f9f9;
  --invert-bg: #1a1a1a;
  --invert-text: #f5f5f5;

  --font-sans: Arial, Helvetica, sans-serif;
  --font-mono: 'Courier New', Courier, monospace;

  --ease: cubic-bezier(0.16, 1, 0.3, 1);
  --speed: 180ms;

  /* Racing Accents — HOVER ONLY, never primary UI */
  --gulf-blue: #6AADE4;
  --gulf-orange: #EE7623;
  --martini-red: #C8102E;
  --jps-gold: #C8A951;
  --brg: #004225;
  --papaya: #FF8000;
  --live-green: #4ade80;

  /* Layout Heights */
  --h-site: 32px;
  --h-sub: 36px;
  --h-barcode: 10px;
  --sticky-top: calc(var(--h-site) + var(--h-sub) + var(--h-barcode)); /* 78px */

  /* Columns */
  --col-left: 55%;
  --col-right: 45%;
}
```

## Typography Scale (STRICT)

| Role | Font | Size | Weight | Letter-Spacing | Case |
|------|------|------|--------|---------------|------|
| Badge | sans | 8px | 600 | 0.1em | UPPER |
| Widget label | sans | 8px | 700 | 0.12em | UPPER |
| Info key | sans | 8px | 700 | 0.12em | UPPER |
| Info value | sans | 9px | 400 | — | normal |
| Body/feed text | sans | 9px | 400 | — | normal |
| Description | sans | 10px | 400 | — | normal |
| Caption/filter | sans | 7px | 600 | 0.08em | UPPER |
| Micro/DB ref | mono | 6px | 400 | 0.02em | normal |
| Price (standard) | mono | 12px | 700 | — | — |
| Price (large) | mono | 16px | 700 | — | — |
| Sub-header title | sans | 11px | 700 | 0.04em | UPPER |
| Mileage badge | mono | 8px | 400 | 0.08em | UPPER |

**Rules:**
- Arial for all UI. Courier New for ALL numbers/data/VINs/prices/dates.
- Never import web fonts (no Inter, Roboto, etc.)
- Never exceed 12px in the vehicle profile (exception: pricing large 16px)
- All labels/badges are UPPERCASE with letter-spacing

## Layout (5-Layer Stack)

1. **Site Header**: fixed, 32px, z-1000, bg #1a1a1a
2. **Vehicle Sub-Header**: sticky, 36px, z-900, bg white, border-bottom 1px solid
3. **Barcode Timeline**: sticky, 10px collapsed, z-850
4. **Hero Image**: static, 260px height, bg #2a2a2a
5. **Two-Column Workspace**: sticky, fills remaining viewport

### Columns
- Left: **55%** — widgets, info, feed, details
- Right: **45%** — gallery, media, documents
- Both: `overflow-y: auto; overscroll-behavior: contain`
- Divider: 4px gap, draggable, transparent → black on hover
- Scrollbar: 4px width, transparent track, #ddd thumb

## Widget Pattern

```
.widget { border: 2px solid #1a1a1a; background: #fff; margin: 8px 0 }
.widget__header { min-height: 32px; padding: 10px 16px; border-bottom: 1px solid #eee }
.widget__label { 8px, 700, uppercase, 0.12em, color: #888 }
.widget__count { mono 7px, color: #bbb }
.widget__body { padding: 10px 16px 14px }
```

## Badge System

- Base: `8px / 600 / uppercase / 0.1em / padding: 2px 6px / border: 1px solid #1a1a1a / border-radius: 0`
- Grouped: Identity | Transaction | People | Meta — 4px gap within, 12px between groups
- Hover: border-color changes to racing accent color
- Click: scroll-to-widget, open URL, or show dropdown card

## Gallery

- Default: 3 columns, square aspect ratio, 3px gap
- Toolbar: 8 view modes (7px uppercase buttons)
- Column slider: 1-8 range
- Category labels: 8px, 700, uppercase, 0.12em, color #888
- Thumbnail: 1px solid transparent → #1a1a1a on hover
- NO overlaid badges/scores on thumbnails

## Border Rules

| Border | Usage |
|--------|-------|
| 2px solid #1a1a1a | Widget outer, section dividers |
| 1px solid #1a1a1a | Tooltips, popovers, badge borders |
| 1px solid #f0f0f0 | Table row separators |
| 1px solid #eee | Widget header bottom, subtle dividers |
| 1px dashed #888 | Provenance underlines |

**NEVER use border-radius. All corners 0px.**

## Transitions

**ONLY allowed:** `[property] 180ms cubic-bezier(0.16, 1, 0.3, 1)`

Never use: linear, ease, ease-in, ease-out, or any other timing.

## Colors

Racing accents (Gulf Blue, Gulf Orange, Martini Red, JPS Gold, BRG, Papaya) are **easter eggs** — ONLY used for badge hover states. Never as primary UI colors.

Greyscale is the primary visual language: #1a1a1a / #888 / #bbb / #ddd / #eee / #f0f0f0 / #f5f5f5 / #fff
