# NUKE FINDER — Full Resolution UI + Rhizome Data Layer
## Claude Code Build Prompt

**Status**: Canonical specification — this is the build document.  
**Scope**: The complete finder interface, every interaction, every component, every data path.  
**Prerequisite**: Read `docs/DESIGN_BIBLE.md`, `docs/FINDER_ARCHITECTURE.md`, and `docs/library/prompts/DESIGN_INTERFACE_ENCYCLOPEDIA.md` first. This prompt extends those — it does not replace them.

---

## PART 1: THE SYSTEM YOU ARE BUILDING

You are building a **data topology explorer** — not a website, not a dashboard, not a search engine. The closest analog is macOS Finder crossed with Google Knowledge Graph, operating on top of a vehicle data ontology with 728K+ vehicles, 339 columns per vehicle across 27 data domains, 964 database tables, 113+ extraction sources, 32.9M images, and 11.6M comments.

The user should be able to:
1. Start anywhere (search, browse, click a badge, paste a URL, paste a VIN)
2. Drill infinitely deep without ever losing context
3. Build novel data combinations that don't exist as pre-built views
4. See every number justified — where it came from, how confident it is, when it was last checked
5. Never experience a dead end, a loading void, or a context break

**The interface IS the data topology. Every pixel renders data. Every click is a query. Every view is a response.**

---

## PART 2: DESIGN SYSTEM — EVERY PIXEL DECISION

### 2.1 Typography (No Exceptions)

| Role | Font | Size | Weight | Case | Letter-spacing | Line-height |
|------|------|------|--------|------|----------------|-------------|
| Section labels | Arial | 8px | 700 | ALL CAPS | 0.10-0.12em | 1 |
| Badge labels | Arial | 8px | 700 | ALL CAPS | 0.08em | 1 |
| Body text | Arial | 10px | 400 | Sentence | normal | 1.4 |
| Heading text | Arial | 11-13px | 700 | ALL CAPS | 0.04-0.06em | 1.2 |
| Entity names (large) | Arial | 14-18px | 700 | ALL CAPS | 0.02em | 1.1 |
| Data values | Courier New | 10-11px | 700 | as-is | normal | 1 |
| Data labels | Courier New | 8-9px | 400 | ALL CAPS | 0.06em | 1 |
| Inline counts | Courier New | 8px | 400 | as-is | normal | 1 |
| Price values | Courier New | 10-11px | 700 | as-is | normal | 1 |

**Only two fonts exist.** Arial for everything human. Courier New for everything machine/data. No fallbacks to other named fonts. No Google Fonts. No Fontshare. No system-ui.

### 2.2 Color Palette

**Core (greyscale only):**

| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | `#f5f5f5` | Page background. THE background. |
| `--surface` | `#ebebeb` | Cards, panels, elevated surfaces |
| `--surface-hover` | `#e0e0e0` | Hover state for surfaces |
| `--border` | `#bdbdbd` | All borders — 2px solid always |
| `--text` | `#2a2a2a` | Primary text, active borders |
| `--text-secondary` | `#666666` | Secondary text, metadata |
| `--text-disabled` | `#999999` | Disabled, placeholder, tertiary |

**Status (earned, never decorative):**

| Token | Value | When to use |
|-------|-------|-------------|
| `--success` | `#16825d` | Verified data, confirmed sale, high confidence (>80%), price values |
| `--warning` | `#b05a00` | Caution, above market, medium confidence (40-80%) |
| `--error` | `#d13438` | Rejected, data conflict, low confidence (<40%) |

**Color is never decorative.** If something is colored, it communicates data state. Green price = confirmed sale price. Amber price = estimated. No color = no price data. A badge turns `--text` border on hover. A badge turns `--text` background when active/selected. That's it.

### 2.3 Borders and Surfaces

```
border: 2px solid var(--border)     /* Default state */
border: 2px solid var(--text)       /* Hover, active, focused, expanded */
border-radius: 0                    /* ALWAYS. NO EXCEPTIONS. */
box-shadow: none                    /* ALWAYS. NO EXCEPTIONS. */
background: none / var(--surface)   /* Flat. No gradients ever. */
```

### 2.4 Motion

```
transition: all 180ms cubic-bezier(0.16, 1, 0.3, 1);
```

One timing function. One duration. Everything uses it. Panel open, badge expand, hover state, collapse — all 180ms ease-out-expo. No spring physics. No bounce. No stagger delays except on initial list render (30ms per item, max 10 items staggered = 300ms total).

### 2.5 Spacing

Base unit: 4px. Everything is a multiple.
- Inline gap between badges: 4px
- Padding inside badges: 2px 6px
- Padding inside cards: 8px
- Gap between cards in grid: 4px
- Section margin: 16px
- Panel padding: 12px
- The entire interface is dense. Not cramped — dense. Like Bloomberg Terminal meets brutalist design. Information-per-pixel ratio is high.

---

## PART 3: NAVIGATION ARCHITECTURE

### 3.1 The Finder Paradigm

The interface has ONE persistent frame:

```
┌─────────────────────────────────────────────────────────────────┐
│ HEADER: ◂ ▸ │ Breadcrumb │ [Search Input          ] │ FINDER ■ │
├─────────────────────────────────────────────────────────────────┤
│ SUBHEADER: [BADGE] [BADGE] [BADGE] [BADGE]        context-aware│
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  CONTENT AREA                                                   │
│  (changes based on what the user is exploring)                  │
│                                                                 │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│ FOOTER: status │ live count │ attribution                       │
└─────────────────────────────────────────────────────────────────┘
```

**The header NEVER changes.** It is always present. The back/forward buttons, breadcrumb, and search input are the permanent navigation controls.

### 3.2 Back/Forward Navigation (State Stack)

The navigation stack is NOT browser history. It is an internal state stack that tracks every exploration action:

```typescript
interface ViewState {
  type: 'home' | 'source' | 'make' | 'model' | 'search' | 'vehicle' | 'query';
  params: Record<string, any>;  // e.g., { slug: 'mecum' } or { make: 'Porsche', model: '911' }
  scrollPosition: number;
  expandedPanels: string[];     // IDs of any open inline panels
  activeTab: string;            // which subheader badge is active
}

const navStack: ViewState[] = [];
let navIndex: number = -1;
```

**Back (◂)**: Restores the EXACT previous state — scroll position, expanded panels, active tab. Not a page back. A state restoration. If the user had a popup open, the popup is still open.

**Forward (▸)**: Restores the EXACT forward state. Same guarantees.

**Every navigation action pushes to the stack**: clicking a source card, clicking a make badge, searching, expanding a vehicle detail. Clicking within a view (toggling a subheader badge, scrolling) does NOT push to the stack — it mutates the current state.

### 3.3 Breadcrumb

The breadcrumb shows the path, not the stack. It's derived from the current view:

- Home: `HOME`
- Source: `HOME ▸ SOURCES ▸ MECUM AUCTIONS`
- Make: `HOME ▸ PORSCHE`
- Model: `HOME ▸ PORSCHE ▸ 911`
- Search: `HOME ▸ SEARCH: 1980 CHEVROLET TRUCK`
- Vehicle: `HOME ▸ PORSCHE ▸ 911 ▸ 1975 911 CARRERA TARGA`
- Query: `HOME ▸ QUERY: FRONT FENDER CONDITION × PORSCHE 911`

Each segment of the breadcrumb is clickable. Clicking `PORSCHE` from the vehicle view navigates to the Porsche make view. The breadcrumb is itself a navigation tool.

### 3.4 Zero Click Anxiety

Every interaction in the system follows these rules:

1. **Every action is reversible.** Click opens, click closes. Back undoes. Nothing is destructive.
2. **Expand, don't navigate.** When you click a badge, it expands inline. The parent view stays visible underneath. The user builds up layers of context and peels them off.
3. **Instant feedback.** Every clickable element shows its depth on hover (e.g., `CHEVROLET · 89,400`). You know what you're about to see before you click.
4. **No dead ends.** Every view has outbound connections. If you drill into "1982" and there are 47 vehicles, each vehicle has badges that lead further.
5. **Context stacking.** Opening a detail doesn't close the list. Opening a sub-cluster doesn't close the parent. Like papers on a desk — edges visible underneath.
6. **Persistent state.** Close the browser, come back, your exploration state is preserved (localStorage).

---

## PART 4: THE SUBHEADER — Multi-Modal Badge Bar

The subheader is the context-aware navigation layer. Its badges change based on what the user is looking at. Each badge is a view mode within the current context.

### 4.1 Badge Rendering

```
┌────────────────┐    ┌────────────────┐
│ OVERVIEW       │    │ VEHICLES       │    (inactive: 1px border --border)
└────────────────┘    └────────────────┘

┌████████████████┐    
│ OVERVIEW       │    (active: --text bg, white text)
└████████████████┘    
```

Badge spec: `font: 700 8px/1 Arial; letter-spacing: 0.08em; text-transform: uppercase; border: 1px solid var(--border); padding: 3px 10px; cursor: pointer;`

Active state: `background: var(--text); color: var(--bg); border-color: var(--text);`

### 4.2 Badge Sets by Context

| Context | Badges | Default Active |
|---------|--------|----------------|
| HOME | `SOURCES` `MAKES` `YEARS` `RECENT` `TOPOLOGY` | `SOURCES` |
| SOURCE (e.g. Mecum) | `OVERVIEW` `VEHICLES` `COVERAGE` `ACTIVITY` | `OVERVIEW` |
| MAKE (e.g. Porsche) | `MODELS` `PRICE MAP` `SOURCES` `TIMELINE` | `MODELS` |
| MODEL (e.g. 911) | `YEARS` `VARIANTS` `PRICE HISTORY` `GALLERY` | `YEARS` |
| VEHICLE (single) | `PROFILE` `PROVENANCE` `IMAGES` `HISTORY` `COMPARABLES` | `PROFILE` |
| SEARCH results | `ALL` `IMAGES` `SOURCES` `PRICE MAP` | `ALL` |
| QUERY (custom) | `RESULTS` `VISUALIZATION` `EXPORT` `SAVE` | `RESULTS` |

Switching badges does NOT push to the nav stack. It changes the content area within the current view. The URL updates (e.g., `/find/porsche?tab=price-map`) but the stack entry is mutated, not pushed.

---

## PART 5: COMPONENT SPECIFICATIONS

### 5.1 Vehicle Box (The Card)

The vehicle box is the atomic display unit for a vehicle. It appears everywhere — search results, source views, recent strips, comparison panels, cluster previews.

**Standard card (in grid):**

```
┌──────────────────────────────┐
│                              │
│         [IMAGE]              │  ← 4:3 aspect ratio, object-fit: cover
│         or                   │
│    [MAKE NAME FALLBACK]      │  ← muted grey bg (#7a7a7a), centered text
│                              │
├──────────────────────────────┤
│ 1975 PORSCHE 911 CARRERA     │  ← 9px Arial 700 ALL CAPS, truncate 2 lines
│ $36,750                      │  ← 10px Courier New 700, --success color
│ [BAT] [1975] [PORSCHE]      │  ← inline badges, 7px, clickable
└──────────────────────────────┘
```

**Card spec:**
- Width: fluid, fits grid column
- Border: `2px solid var(--border)`
- Hover: `border-color: var(--text)`
- Padding body: 6px
- Image: `width: 100%; aspect-ratio: 4/3; object-fit: cover; background: var(--surface)`

**Price display:**
- Confirmed sale: `$36,750` in `--success` (green) Courier New 700
- Asking price: `$36,750 ASK` in `--text` Courier New 400
- Estimated: `~$36,750 EST` in `--warning` (amber) Courier New 400
- No price: `NO PRICE DATA` in `--text-disabled` Courier New 400 8px

**Badges on card:**
- Source badge (e.g., `BAT`): always present, shows where this vehicle was found
- Year: always present
- Make: always present
- Additional badges based on data: `SOLD`, `RESERVE MET`, `NO RESERVE`, `MODIFIED`, condition badges

**Single click on card:** Expands inline to show more detail (badges, snippet, provenance summary, "EXPLORE →" button). Parent grid visible. The expansion is within the grid — the card grows and pushes siblings down.

**Click "EXPLORE →":** Navigates to the vehicle detail view (pushes to nav stack). The grid state is preserved in the stack.

### 5.2 Badges (BadgePortal)

Every data point rendered as a badge is a portal into its cluster. This is the atomic unit of the design.

**Idle state:**
```
┌─────────────┐
│ PORSCHE     │  ← 8px Arial 700 ALL CAPS, 1px border --border
└─────────────┘
```

**Hover state (after 200ms debounce):**
```
┌──────────────────┐
│ PORSCHE · 41,230 │  ← depth count appears, fetched lazily
└──────────────────┘
```

**Click (expand):**
```
┌████████████████████┐
│ PORSCHE · 41,230   │  ← active state (filled bg)
├────────────────────┤
│ ┌─────┐ ┌─────┐   │
│ │ img │ │ img │   │  ← 3x2 preview grid of top vehicles
│ │ 911 │ │ 944 │   │
│ └─────┘ └─────┘   │
│ ┌─────┐ ┌─────┐   │
│ │ img │ │ img │   │
│ │ 356 │ │ Cay │   │
│ └─────┘ └─────┘   │
├────────────────────┤
│ VIEW ALL 41,230 →  │  ← navigates to make view
└────────────────────┘
```

The expand panel is positioned absolute below the badge, `top: calc(100% + 4px)`. It has `2px solid var(--text)` border. Width: 280-400px. Close on Escape, click-outside, or badge re-click.

**Every badge click loads data lazily.** The depth count is fetched on hover. The preview grid is fetched on click. Repeat clicks use cache.

### 5.3 Knowledge Panel (Right Column)

When viewing an entity (source, make, model), the right column shows a structured knowledge panel — similar to Google's knowledge cards.

**Source knowledge panel:**

```
┌─────────────────────────────────┐
│ SOURCE PROFILE                  │  ← section header, 8px ALL CAPS
├─────────────────────────────────┤
│ TYPE           AUCTION HOUSE    │
│ IN DATABASE    148,461          │  ← LIVE from db-stats, not hardcoded
│ DESCRIBED      46%              │  ← LIVE
│ SNAPSHOTS      82,566           │  ← LIVE
│ SUCCESS RATE   100%             │  ← LIVE
│ LAST CHECKED   2 MIN AGO       │  ← timestamp of the API call
├─────────────────────────────────┤
│ DESCRIPTION COVERAGE            │
│ ████████░░░░░░░░░░░░ 46%       │  ← progress bar
├─────────────────────────────────┤
│ RELATED SOURCES                 │
│ Bring a Trailer     134,262    │  ← clickable, navigates
│ Barrett-Jackson      72,849    │
│ Cars & Bids          34,817    │
│ Bonhams              21,937    │
└─────────────────────────────────┘
```

**Critical: ALL numbers are live.** The panel fetches from db-stats on render. The "LAST CHECKED" timestamp tells the user exactly when this data was retrieved. No hardcoded counts.

**Make knowledge panel:**

```
┌─────────────────────────────────┐
│ PORSCHE — OVERVIEW              │
├─────────────────────────────────┤
│ IN DATABASE        41,230       │  ← LIVE count
│ WITH PRICE DATA    16 OF 30     │  ← from search sample
│ MODELS DETECTED    23           │  ← from search sample
│ PRICE RANGE        $18K-$605K   │
│ CONFIDENCE         SAMPLE       │  ← honest about methodology
│                    (30 vehicles) │
├─────────────────────────────────┤
│ YEAR DISTRIBUTION               │
│ ▊ ▊▊▊▊▊ ▊▊▊▊ ▊▊▊▊▊           │  ← mini histogram
│ 60 70 80 90 00 10 20            │
├─────────────────────────────────┤
│ EST. TOTAL PRODUCED   ?         │  ← Unknown. Honest gap.
│ OUR COVERAGE          ?%        │  ← Can't calc without denominator
│ STATUS: RESEARCH NEEDED         │  ← Shows the gap explicitly
│ [CONTRIBUTE DATA →]             │
└─────────────────────────────────┘
```

**When data is unknown, say so.** Don't hide the gap. Display it. "RESEARCH NEEDED" with a "CONTRIBUTE DATA →" action is more valuable than no field at all. This is how the system grows.

### 5.4 Popups and Inline Panels

Popups (expand panels, cluster previews, detail overlays) follow these rules:

1. **Positioned relative to trigger.** A badge popup appears below the badge. A card popup expands the card inline. A detail panel slides in from the right.
2. **2px solid var(--text) border.** The active/expanded state always uses the full `--text` color border to distinguish it from the resting `--border` color.
3. **Background: var(--bg).** Popups use the page background, not surface, to create the layering effect of "this is on top."
4. **Close behavior: Escape, click-outside, or trigger re-click.** All three always work. No exceptions.
5. **Stacking.** Multiple popups can be open. Each new one appears on top (z-index increment). Escape closes the topmost one. They do not conflict.
6. **Transition: 180ms.** Open: opacity 0→1, translateY(-4px→0). Close: reverse.

### 5.5 The Image Fallback

When a vehicle has no image, never show a grey void or "NO IMAGE" text block. Instead:

```
┌──────────────────────────────┐
│                              │
│                              │
│          PORSCHE             │  ← Make name, centered, white text
│                              │     Background: muted brand-adjacent grey
│                              │     (#7a7a7a range, subtle variation per make)
│                              │
└──────────────────────────────┘
```

The fallback communicates identity. It's not an error state — it's a data state. The vehicle exists, we know the make, we don't have an image yet. The muted grey range (not saturated brand colors) keeps the grid visually cohesive.

---

## PART 6: ENTITY VIEWS — What Each "Page" Shows

### 6.1 HOME View

The home view is the topology made visible. It's what you see before you've searched.

**Content area layout:**

```
SOURCES — TOP BY VEHICLE COUNT
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│ MECUM    │ │ BAT      │ │ BARRETT  │ │ CONCEPT  │  ← clickable cards
│ 148,461  │ │ 134,262  │ │ JACKSON  │ │ CARZ     │     with coverage bar
│ ████░░46%│ │ ████95% │ │ 72,849   │ │ 35,460   │
└──────────┘ └──────────┘ │ ███░36%  │ │ █░1%     │
                          └──────────┘ └──────────┘

MAKES — TOP 20
[CHEVROLET 89.4K] [FORD 82.2K] [PORSCHE 41.2K] [BMW 28.3K] ...

DATA TOPOLOGY
(Reserved: this is where the expanding database tree will live.
 For now, show the domain map of the vehicles table:
 ENGINE 28 fields | PROVENANCE 29 | VALUATION 22 | CHASSIS 13 ...
 Each clickable. Each shows fill rate across the database.)

RECENT VEHICLES
┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐  ← horizontal scroll strip
│ img │ │ img │ │ img │ │ img │
│ YMM │ │ YMM │ │ YMM │ │ YMM │
│ $$$ │ │ $$$ │ │ $$$ │ │ $$$ │
└─────┘ └─────┘ └─────┘ └─────┘
```

All numbers are **live from db-stats**, fetched on page load. The "LAST UPDATED" timestamp is visible in the footer.

### 6.2 SOURCE View (e.g., Mecum)

When the user navigates to a source (by clicking a source card, searching a source name, or clicking a breadcrumb):

**Header area:**
```
MECUM AUCTIONS [AUCTION HOUSE]   ← entity name + type badge
```

**OVERVIEW tab (default):**

Left column (60%):
- Key stats row: IN DB: 148,461 | DESCRIBED: 46% | SNAPSHOTS: 82,566 (all LIVE)
- "WHAT THE DATA SHOWS" section:
  - Top makes from this source (derived from a broad sample search, not hardcoded)
  - Price distribution (low / median / high from sample, with SAMPLE SIZE noted)
  - Description quality assessment
  - "These insights are derived from a sample of N vehicles. [QUERY MORE →]"
- Vehicle grid: Sample vehicles from this source, with images

Right column (40%):
- Knowledge panel (see 5.3)

**VEHICLES tab:**
- Full grid of vehicles from this source
- Filter badges: make, year range, price range, has-image, has-vin

**COVERAGE tab:**
- Fill rate visualization: how many fields are populated across vehicles from this source
- The 27 domain categories from the vehicles table, each showing % filled
- This is where you see: "ENGINE domain: 3% filled across Mecum vehicles" — tells you where enrichment is needed

**ACTIVITY tab:**
- Extraction timeline: when were vehicles from this source last ingested
- Snapshot success history
- New vehicles added over time

### 6.3 MAKE View (e.g., Porsche)

**Header:** `PORSCHE [MAKE]`

**MODELS tab (default):**
- Grid of model badges with counts: `911 · 17,644` `MACAN · 2,100` `959 · 340`
- Each badge is a BadgePortal — hover shows count, click shows preview, "VIEW ALL →" navigates to model view

**PRICE MAP tab:**
- Price distribution visualization across all Porsche vehicles
- Box plot or histogram by model
- Honest about sample size and confidence

**SOURCES tab:**
- Which sources have Porsche vehicles? BAT: 8,200 | Mecum: 3,400 | PCarMarket: 2,100...
- Clickable — each navigates to a filtered view

**TIMELINE tab:**
- Year distribution of Porsche vehicles in the database
- Bar chart / histogram: how many per decade

### 6.4 MODEL View (e.g., Porsche 911)

**Header:** `PORSCHE 911 [MODEL]`
**Breadcrumb:** `HOME ▸ PORSCHE ▸ 911`

**YEARS tab:**
- Year badges: `1965 · 23` `1968 · 89` `1973 · 312` `1975 · 445` ...
- Each clickable

**VARIANTS tab:**
- Sub-models: `911 CARRERA` `911 TARGA` `911 GT2` `911 GT3` `911 SC` `911 TURBO` ...
- Derived from model field parsing, not hardcoded

**PRICE HISTORY tab:**
- Price scatter: sale_price vs sale_date for all 911s with price data
- Trend line if enough data points
- Confidence annotation: "Based on N confirmed sales"

**GALLERY tab:**
- Image grid — all images from 911 vehicles
- This is where image density is visible

### 6.5 VEHICLE View (Single Vehicle)

**Header:** `1975 PORSCHE 911 CARRERA TARGA [VEHICLE]`
**Breadcrumb:** `HOME ▸ PORSCHE ▸ 911 ▸ 1975 CARRERA TARGA`

**PROFILE tab:**
- Hero image (largest available)
- Key facts grid: Year, Make, Model, VIN (if known), Price, Source, Location
- Every fact is a badge. Click year → 1975 cluster. Click make → Porsche cluster. Click source → BAT view.
- Description text (if available)
- Badges for all populated fields: `HAS VIN` `HAS DESCRIPTION` `12 IMAGES` `3 COMMENTS` `NUKE ESTIMATE: $42,000`

**PROVENANCE tab:**
- Per-field provenance display (the system you already built)
- Each field: source badge, confidence score, last verified date
- Conflicting values shown side-by-side with evidence weighting
- This is where `vehicle_field_provenance` data renders

**IMAGES tab:**
- Grid of all images for this vehicle
- Image count, source breakdown

**HISTORY tab:**
- Timeline events: when this vehicle was listed, sold, re-listed, price changes
- `timeline_events` table data

**COMPARABLES tab:**
- Similar vehicles: same make/model, similar year, similar price
- This is where the valuation context lives

---

## PART 7: ROOT DATA TOPOLOGY — The Expanding Database Tree

### 7.1 What the Topology Is

The database is a tree that grows. At the root level:

```
NUKE
├── VEHICLES (728K)
│   ├── IDENTITY (10 fields): make, model, year, vin, trim, series...
│   ├── ENGINE/DRIVETRAIN (28 fields): engine_type, displacement, horsepower...
│   ├── PROVENANCE (29 fields): per-field source + confidence tracking
│   ├── VALUATION (22 fields): asking_price, sale_price, nuke_estimate...
│   ├── CHASSIS/SUSPENSION (13 fields): brake_type, suspension_front...
│   ├── PERFORMANCE (13 fields): zero_to_sixty, quarter_mile, top_speed...
│   ├── SPECS/DIMENSIONS (16 fields): weight, wheelbase, mpg...
│   ├── COLOR/PAINT (11 fields): primary, secondary, paint_code...
│   ├── OWNERSHIP (13 fields): verification, transfer history...
│   ├── SCORING (12 fields): quality_grade, deal_score, heat_score...
│   ├── LISTING (11 fields): url, posted_at, location...
│   ├── NARRATIVE (10 fields): description, highlights, known_flaws...
│   ├── LOCATION (7 fields): city, state, gps...
│   ├── CANONICAL (5 fields): standardized types/platforms
│   ├── ... (27 domains total, 339 columns)
│   └── [EVERY FIELD IS A CLICKABLE DATA POINT]
├── IMAGES (32.9M)
│   ├── vehicle_images: per-vehicle photo sets
│   ├── image analysis: AI-extracted features
│   └── angle taxonomy: 3D pose classification
├── OBSERVATIONS (1.7M)
│   ├── comments (11.6M)
│   ├── bids
│   └── auction events
├── VALUATIONS (570K)
│   ├── nuke_estimates
│   ├── comp_engine results
│   └── deal_score breakdowns
├── SOURCES (113+)
│   ├── extraction health per source
│   ├── snapshot quality
│   └── coverage metrics
├── IDENTITIES (510K)
│   ├── external_identities (bat users, dealers, etc.)
│   ├── identity claims
│   └── verification status
├── ORGANIZATIONS
├── TIMELINE_EVENTS
├── SERVICE_RECORDS
├── OWNERSHIP_TRANSFERS
└── ... (964 tables total)
```

### 7.2 How to Visualize the Topology

The TOPOLOGY tab on the home view shows this tree as an interactive, expandable structure. NOT a treemap. A real tree:

```
VEHICLES ────────── 728,593
  ├── IDENTITY ──── 10 fields ── 94% filled
  ├── ENGINE ────── 28 fields ──  3% filled
  ├── VALUATION ─── 22 fields ── 78% filled
  ├── PROVENANCE ── 29 fields ── 12% filled
  ├── PERFORMANCE ─ 13 fields ──  0% filled
  ...
```

Click any domain → expands to show individual fields with their fill rates:

```
  ENGINE/DRIVETRAIN ── 28 fields ── 3% avg fill
    ├── engine_type ────── 2.1% ── "6.2L V8 DIESEL", "FLAT-6 BOXER"...
    ├── horsepower ─────── 1.8% ── range: 65 - 1,001 HP
    ├── displacement ───── 3.2% ── range: 49cc - 8,400cc
    ├── carburetor_type ── 0.4% ── "ROCHESTER QUADRAJET", "WEBER DCOE"...
    ├── exhaust_type ───── 0.1%
    └── ...
```

Click any field → shows the actual values distribution, which sources contribute, and the confidence scores.

### 7.3 Every Number Has a Route

No number displayed without methodology:

| Number shown | Source | Confidence | Route to verify |
|---|---|---|---|
| "728,593 vehicles" | `SELECT count(*) FROM vehicles` | Exact | Live query, db-stats endpoint |
| "148,461 from Mecum" | `WHERE source = 'mecum'` | Exact | Live query |
| "46% described" | `WHERE description IS NOT NULL / total` | Exact | Live query |
| "Avg price $112,750" | Sample of 30 search results | Low — sample | Need full table scan or materialized view |
| "Est. total produced" | NOT YET RESEARCHED | None | Needs factory records, registry data |
| "Survival rate" | NOT YET RESEARCHED | None | Needs cross-referencing production + current market |

If a number can't be justified, display the gap: `? — RESEARCH NEEDED` with a `[CONTRIBUTE →]` action.

---

## PART 8: THE RHIZOME QUERY LAYER

### 8.1 What the Rhizome Is

The root topology is the database tree — it's fixed structure. Tables, columns, relationships. You can navigate it but you can't change its shape.

The **rhizome** is what grows on top. It's the user-created data connections that don't exist as pre-built views. It's the web of queries that users build by combining dimensions in ways nobody anticipated.

**Root**: "Porsche 911" → structured path through make/model hierarchy
**Rhizome**: "Front driver fender condition of all Porsche 911s" → a cross-cut through the image analysis, condition scoring, and vehicle identity dimensions simultaneously

The rhizome is born from queries. Every time a user asks a question the system hasn't been asked before, a new rhizome connection forms. If that query produces interesting results, it can be named, saved, and shared. Other users can build on it.

### 8.2 How Users Build Rhizome Queries

The finder command input accepts natural language, structured filters, or combinations:

```
porsche 911 front fender condition          ← natural language, parsed
make:porsche model:911 field:fender_cond    ← structured
porsche 911 + fender + steering wheel       ← combination query
```

But the real power is the QUERY BUILDER — an interface where users compose multi-dimensional queries visually:

```
┌─────────────────────────────────────────────────┐
│ QUERY BUILDER                                   │
├─────────────────────────────────────────────────┤
│ DIMENSIONS:                                     │
│ [MAKE: Porsche ×] [MODEL: 911 ×]               │
│ [FIELD: front_fender_condition ×]               │
│ [FIELD: steering_wheel_condition ×]             │
│                                                 │
│ [+ ADD DIMENSION]                               │
│                                                 │
│ SHOWING: 2 fields across 17,644 vehicles        │
│ DATA AVAILABLE: 340 vehicles have fender data   │
│                 890 vehicles have steering data  │
│                 120 vehicles have BOTH           │
│                                                 │
│ [RUN QUERY]  [SAVE AS...]  [SHARE]              │
└─────────────────────────────────────────────────┘
```

### 8.3 "Don't See What You're Looking For? Query It."

This is the bottom of every search result. When the user's search returns results but doesn't answer their question:

```
────────────────────────────────────────────
DON'T SEE WHAT YOU'RE LOOKING FOR?

Your search returned 17,644 Porsche 911 vehicles.
But you might be looking for something more specific.

[OPEN QUERY BUILDER →]

Recent community queries on PORSCHE 911:
• 911 price by year with mileage correlation (saved by 12 users)
• Air-cooled vs water-cooled sale price comparison (saved by 8 users)
• 911 Targa hardtop vs soft-top value spread (saved by 3 users)

Or type a natural language question:
[What's the average condition of 1970s 911 front fenders?  ]
────────────────────────────────────────────
```

When a user runs a novel query, the system:
1. Parses the dimensions
2. Queries the relevant fields across the vehicles table (and related tables)
3. Returns results with honest confidence scoring
4. Offers to SAVE the query as a named rhizome connection
5. If saved, other users can discover and build on it

### 8.4 Rhizome Examples

These are real queries that should be possible given the data:

| Query | Dimensions crossed | Data source |
|---|---|---|
| "Porsche 911 front fender condition by year" | make × model × image_analysis × year | vehicles + vehicle_images + AI analysis |
| "Owners of Porsches AND squarebodies" | make:Porsche × make:Chevrolet(C/K) × ownership | vehicles + ownership_transfers + external_identities |
| "Squarebody owners who are high-skilled technicians" | make × body_style × identity × skills | vehicles + external_identities + organizations |
| "Average auction house premium by make" | source × make × (sale_price - nuke_estimate) | vehicles + nuke_estimates |
| "Vehicles with conflicting engine data" | field_provenance:engine × confidence < 50 | vehicle_field_provenance |
| "Most photographed vehicles by model" | make × model × image_count | vehicles + vehicle_images |
| "Price trajectory of C10 trucks 2020-2026" | make:Chevrolet × model:C10 × sale_date × sale_price | vehicles filtered by time |

### 8.5 The Dirt Metaphor

You described the system as "the dirt and nutrients sustaining this growing system." That's the architecture:

```
RHIZOME LAYER (user-built queries, novel connections, saved explorations)
     ↑ grows from ↑
ROOT LAYER (database tree — tables, columns, relationships, fill rates)
     ↑ sustained by ↑
SOIL LAYER (extraction pipeline, enrichment agents, AI analysis, user contributions)
     ↑ fed by ↑
SOURCE LAYER (Mecum, BaT, Barrett-Jackson, FB Marketplace, user submissions, OCR, VIN decode)
```

The finder interface shows ALL of these layers. The topology view shows the root. The query builder creates rhizome. The coverage and activity tabs show the soil health. The source views show the source layer.

---

## PART 9: DATA FRESHNESS ARCHITECTURE

### 9.1 No Hardcoded Numbers

Every number displayed in the UI comes from one of these sources at render time:

| Data type | Source | Cache | Shown to user |
|---|---|---|---|
| Aggregate counts (vehicles, images, comments) | `db-stats` edge function | 5 min TTL | With "UPDATED X MIN AGO" |
| Source-level stats (vehicles per source, description %) | `db-stats.details.platform_quality` | 5 min TTL | Same |
| Search results | `universal-search` edge function | Per-session cache | With search_time_ms |
| Vehicle detail | Supabase REST query | No cache | Real-time |
| Field fill rates | To be built: `schema-stats` RPC | 1 hour TTL | With "SAMPLED X AGO" |
| User-saved queries | Supabase table | Real-time | No stale indicator needed |

### 9.2 Confidence Display

Every derived number shows its confidence:

```
IN DATABASE    148,461          ← exact (COUNT query)
DESCRIBED      46%              ← exact (ratio of two COUNTs)
AVG PRICE      $112,750         ← SAMPLE (30 vehicles) — LOW CONFIDENCE
EST. PRODUCED  ~110,000         ← RESEARCHED — citation: Porsche AG records — MEDIUM
SURVIVAL RATE  ?                ← NOT RESEARCHED
```

The format: `value` + `methodology` + `confidence level` + `source/citation if applicable`

Confidence levels:
- **EXACT**: Live database count or computed ratio. No estimation.
- **SAMPLE**: Derived from a subset. Show sample size. Flag as low confidence if sample < 100.
- **RESEARCHED**: From external source with citation. Show source, date, confidence.
- **ESTIMATED**: Computed from multiple signals with uncertainty. Show methodology.
- **UNKNOWN**: Data not available. Show `?` and `RESEARCH NEEDED`.

---

## PART 10: IMPLEMENTATION PRIORITIES

### Phase 1: The Finder Frame
Build the persistent header (back/forward, breadcrumb, search), subheader (context badges), and content area. Navigation state stack. URL sync. This is the skeleton that everything else mounts into.

### Phase 2: Entity Detection + Views
Build the entity classifier (source, make, model, vehicle, query). Build each view type with its subheader badges and content layout. Knowledge panels. Vehicle cards.

### Phase 3: Live Data Integration
Replace all hardcoded numbers with live API calls. Add timestamp/confidence annotations. Build the field fill rate stats.

### Phase 4: BadgePortal System
Every data point becomes a clickable portal. Hover depth counts. Click expand panels. Context stacking. This is the "zero click anxiety" infrastructure.

### Phase 5: Root Topology Viewer
The interactive database tree. Domain → field → values. Fill rates. Click to explore. This is where the user sees the shape of the data.

### Phase 6: Rhizome Query Builder
The multi-dimensional query composer. Natural language parsing. Dimension crossing. Save/share queries. "Don't see what you're looking for?" prompt.

### Phase 7: Confidence + Provenance Display
Per-number methodology annotation. Research needed flags. Contribution prompts. The system becomes self-aware about its own gaps.

---

## PART 11: WHAT SUCCESS LOOKS LIKE

The system is done when:

1. A user types "mecum" and instantly understands: what Mecum is, how many vehicles we have from them, what the data quality looks like, what the top makes are, what the price range is — with every number live and justified.

2. A user types "porsche 911 front fender condition" and gets a result — even if it's "we have fender condition data on 340 out of 17,644 Porsche 911s, here's what we know" — because the system is honest about its gaps.

3. A user clicks back after 7 levels of drilling and arrives exactly where they were — scroll position, expanded panels, active tab, everything preserved.

4. A user builds a query that nobody has built before ("squarebody owners who are also high-skilled technicians") and the system either answers it or shows exactly what data would need to exist to answer it.

5. Every number on screen can be traced to its source. No number is decoration. No number is a guess presented as fact.

6. The data topology is visible and explorable — not as a dashboard summary, but as the actual tree of tables, columns, values, and connections that make up the platform.

7. The interface rewards curiosity. Every click leads somewhere. Every somewhere leads deeper. There are no dead ends.

**The interface IS the data topology. The data IS the product. The design serves both.**
