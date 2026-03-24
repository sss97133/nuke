# DESIGN BOOK — Chapter 5: The Header

The persistent navigation bar. Identity, command, session. One row, one height, one purpose.

---

## Anatomy

```
┌──────────────────────────────────────────────────────────────────────────┐
│ NUKE              [search vehicles, paste a URL, ask anything... ⌘K] [S]│
│  ▲                 ▲                                                  ▲  │
│  identity          command input                                 session │
└──────────────────────────────────────────────────────────────────────────┘
                                    40px
```

Three zones. Fixed proportions.

| Zone | Grid Column | Content | Min Width |
|------|------------|---------|-----------|
| Identity | `max-content` | NUKE wordmark (home link) | 48px |
| Command | `1fr` | Universal input field | 0 (collapses on mobile) |
| Session | `max-content` | User avatar + notification dot | 36px |

---

## The Wordmark

**NUKE.** Four characters. Top-left. Always.

| Property | Value |
|----------|-------|
| Font | Arial |
| Weight | 700 |
| Size | 13px (test 11-13px range in situ) |
| Case | ALL CAPS |
| Letter-spacing | 0.10-0.12em |
| Color | `var(--text)` |
| Hover | `opacity: 0.75` or `color: var(--accent)` |
| Link target | `/` (home) |

The wordmark is not a logo. It's not an icon. It's not a graphic. It's the name of the system. The simplicity IS the identity. Arial bold, tracked, caps. It has no era — it could have been set in 1990 or 2030.

### Context Notation (Optional — Prototype First)

On entity pages, a subtle context suffix:

```
NUKE · 1977 K5 BLAZER
```

- Separator: ` · ` (middle dot, `&middot;`)
- Context text: 9px, `--text-secondary`, truncates with ellipsis
- Only shows when on a specific entity (vehicle, organization)
- Disappears on hover/focus of the command input (input takes full width)

This is speculative. Must be prototyped and evaluated in situ.

---

## The Command Input

The center of the header. Not a "search bar" — a **command line** for the agentic system.

### Behavior

| State | Appearance |
|-------|-----------|
| Idle | Ghost text cycling: "Search vehicles...", "Paste a URL...", "Drop an image...", "Ask anything..." |
| Hover | Border: `--border` → `--border-focus` |
| Focus | Ghost text clears, cursor blinks, border: `--accent`, overlay appears below |
| Typing | Autocomplete results stream in the overlay |
| Submit | Result appears (navigation, overlay, or inline) |
| Escape | Input clears, overlay dismisses, returns to idle |

### Input Types Accepted

| Input | Recognition | Response |
|-------|------------|----------|
| Text query | Default | Search results overlay |
| URL | Starts with `http` / `www` | Extract and ingest |
| VIN | 17 alphanumeric, regex match | Vehicle lookup |
| Year Make Model | Regex: `\d{4}\s+\w+\s+\w+` | Filtered search |
| Natural language question | Fallback | AI-powered query |
| Dragged image | Drop event on input | Image identification pipeline |

### Keyboard

| Key | Action |
|-----|--------|
| `⌘K` / `Ctrl+K` | Focus input from anywhere |
| `Enter` | Submit current input |
| `Escape` | Clear and unfocus |
| `↑` / `↓` | Navigate autocomplete results |
| `Tab` | Accept first autocomplete suggestion |

### Sizing

```css
.header-command {
  min-width: 0;
  flex: 1;
}

.header-command-inner {
  height: 28px;
  border: 2px solid var(--border);
  background: var(--bg);
  padding: 0 8px;
  display: flex;
  align-items: center;
  gap: 6px;
}
```

On mobile (< 768px), collapses to a trigger button showing `⌘` icon. Tap to activate full-screen command palette.

---

## The User Capsule

Rightmost element. Session state at a glance.

| Component | Size | Details |
|-----------|------|---------|
| Avatar | 28px × 28px | 2px border, square (0 radius), fallback: initials |
| Notification dot | 6px × 6px | Rosso red (`#E4002B`), positioned top-right of avatar |
| Click action | Opens user dropdown | Same dropdown as current implementation |

The upload indicator (GlobalUploadIndicator) integrates as a subtle state change on the avatar border (e.g., border pulses or changes color during active upload) rather than a separate element.

---

## What the Header Does NOT Contain

| Element | Where it goes instead |
|---------|----------------------|
| Navigation links (MARKET, SEARCH, etc.) | Command palette results, or discoverable through the input |
| Breadcrumbs | First line of content area (see Sub-Context below) |
| Vehicle tab bar | Content area, above the main content but below the header |
| Page toolbar / stats strip | Within the page's own content area |
| Variant picker | Eliminated entirely |
| Upload status bar | User capsule border state or footer |

---

## Sub-Context Pattern

Position information lives in the content, not the header.

### Content Breadcrumb

The first element in the content area on any non-root page:

```html
<nav class="content-breadcrumb" aria-label="Breadcrumb">
  <a href="/vehicle/list">VEHICLES</a>
  <span class="breadcrumb-sep">→</span>
  <a href="/vehicle/abc123">1977 K5 BLAZER</a>
  <span class="breadcrumb-sep">→</span>
  <span class="breadcrumb-current">SERVICE HISTORY</span>
</nav>
```

| Property | Value |
|----------|-------|
| Font size | `var(--fs-8)` (8px) |
| Weight | 600 |
| Case | ALL CAPS |
| Letter-spacing | 0.06em |
| Color (links) | `var(--text-secondary)` |
| Color (current) | `var(--text)` |
| Separator | `→` |
| Max depth | 4 levels |
| Scroll | Scrolls with content (not sticky) |
| Padding | `12px 0 8px` |

### Vehicle Tabs (When Multiple Open)

When 2+ vehicles are open, a thin tab strip appears at the top of the content area:

```
┌── header ────────────────────────────────────────────────────────┐
│  NUKE          [_____________________________________ ⌘K]   [S] │
└──────────────────────────────────────────────────────────────────┘
┌── content ───────────────────────────────────────────────────────┐
│  [1977 K5 Blazer ×] [1991 GMC V3500 ×] [1984 K10 ×]           │ ← tab strip
│──────────────────────────────────────────────────────────────────│
│  VEHICLES → 1977 K5 BLAZER → SERVICE HISTORY                    │ ← breadcrumb
│                                                                  │
│  [content]                                                       │
```

The tab strip is:
- Part of the content area, not the header
- Only visible when 2+ vehicles are open
- Scrollable horizontally if many tabs
- Each tab has a close button (×)
- Active tab has `border-bottom: 2px solid var(--accent)`
- Height: 28px
- Sticky below the header (position: sticky, top: 40px)

---

## Dimensions

| Property | Value |
|----------|-------|
| Height | 40px |
| Background | `var(--surface)` |
| Border bottom | `2px solid var(--border)` |
| Position | `sticky`, `top: 0` |
| Z-index | 1000 |
| Padding | `0 8px` |
| Grid | `max-content 1fr max-content` |
| Gap | `12px` |

### Responsive

| Breakpoint | Behavior |
|-----------|----------|
| Desktop (768px+) | Full three-zone layout |
| Mobile (< 768px) | `[NUKE] [trigger ⌘] [avatar]` — command input becomes tap-to-expand |

On mobile, tapping the search trigger opens a full-viewport command sheet. The header itself stays at 40px.

---

## File Structure (Target)

```
src/components/layout/
├── AppHeader.tsx           ← The single header component
├── AppHeader.css           ← All header styles
├── CommandInput.tsx         ← Universal input
├── UserCapsule.tsx          ← Avatar + dropdown trigger
├── ContentBreadcrumb.tsx    ← Sub-context breadcrumbs (used by pages)
└── hooks/
    ├── useHeaderState.ts    ← Session, search, notifications (consolidated)
    └── useCommandInput.ts   ← Input type detection, routing, autocomplete
```

5 components, 2 hooks. Down from 14 components and 11 hooks.

---

## Anti-Patterns

- **Never add a fourth zone.** Three zones. That's it. No "actions" zone, no "status" zone.
- **Never stack bars below.** If something needs to be below the header, it's in the content area.
- **Never add variant switching.** One header. One design. No options.
- **Never make the height conditional.** 40px always. No expanding, no collapsing, no auto-hide.
- **Never put page-specific controls in the header.** The header is global. Pages own their controls.
- **Never let the command input navigate away without user explicit action.** Results appear as overlays. Navigation only happens when the user clicks a result or presses Enter on one.

---

---

## Exact CSS Token Reference

### Wordmark (NUKE)

| Property | Value |
|----------|-------|
| Font family | `Arial, sans-serif` / `var(--font-family)` |
| Font size | 13px / `var(--fs-13)` |
| Font weight | 700 |
| Text transform | `uppercase` |
| Letter spacing | `0.10em` to `0.12em` |
| Color | `var(--text)` |
| Hover | `opacity: 0.75` |
| Link target | `/` |

### Command Input

| Property | Value |
|----------|-------|
| Height | 28px |
| Border | `2px solid var(--border)` |
| Background | `var(--bg)` |
| Font family | `var(--font-family)` |
| Font size | `var(--fs-10)` (10px) |
| Color | `var(--text)` |
| Placeholder color | `var(--text-disabled)` |
| Focus border | `var(--accent)` |
| Focus outline | none |
| Padding | `0 8px` |

### User Capsule

| Property | Value |
|----------|-------|
| Avatar size | 28px x 28px |
| Border | `2px solid var(--border)` |
| Border radius | 0 (enforced globally) |
| Fallback | Initials in `var(--text)` on `var(--surface)` background |
| Notification dot | 6px x 6px, `#E4002B` (Rosso red), positioned top-right |

---

## Dark Mode Behavior

In dark mode, the header tokens swap automatically:

| Token | Light | Dark |
|-------|-------|------|
| Background (`var(--surface)`) | `#ebebeb` | `#252526` |
| Border (`var(--border)`) | `#bdbdbd` | `#3e3e42` |
| Text (`var(--text)`) | `#2a2a2a` | `#cccccc` |
| Input background (`var(--bg)`) | `#f5f5f5` | `#1e1e1e` |
| Accent (`var(--accent)`) | `#2a2a2a` | `#cccccc` |

No conditional rendering or `dark:` Tailwind classes needed. All dark mode behavior comes from the CSS variable system.

---

## Responsive Behavior

| Breakpoint | Layout |
|-----------|--------|
| Desktop (768px+) | Full three-zone layout: `[NUKE] [command input] [avatar]` |
| Mobile (< 768px) | `[NUKE] [trigger icon] [avatar]` — command input becomes tap-to-expand |

### Mobile (< 768px)

- Command input collapses to a trigger button showing magnifying glass icon
- Tapping the trigger opens a full-viewport command sheet overlay
- The header stays at 40px height
- NUKE wordmark remains visible
- Avatar/session zone remains visible

### Key Rules

- Header height is ALWAYS 40px. No expanding, collapsing, or auto-hide.
- The header is `position: sticky; top: 0; z-index: 1000`.
- The header is the same on every page. No page-specific modifications.

---

## The Header as Navigation Anchor

The header is the one constant in the entire design. Every screen has it. It communicates: you are always in the same system, regardless of what data you are looking at. Design decisions for the header must never compromise this consistency.

**Rules:**
- Never add a fourth zone
- Never stack bars below the header (sub-context goes in the content area)
- Never add variant switching (one header, one design)
- Never make the height conditional
- Never put page-specific controls in the header

---

*The header is the fulcrum. Get it right and 136px of chrome becomes 40px. Every pixel recovered goes to the content — the vehicles, the images, the data. The header exists to serve what's below it. The moment it serves itself, it's broken.*
