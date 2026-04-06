# 11. The Intelligence Surface

## Design Specification for User-Facing Intelligence on the Vehicle Profile

**Date**: 2026-03-31
**Status**: Specification — ready for implementation
**Prerequisite reading**: `vehicle-profile-computation-surface.md`, `the-knowing-system.md` (Discourses)

---

## Governing Principles

1. **The system does the knowing. The user does the deciding.** No user learns the schema. The system presents computed intelligence at the right abstraction level.

2. **Progressive density applies to intelligence too.** A sparse vehicle gets a sparse briefing ("We know the basics"). A dense vehicle gets a rich briefing with five signal cards and expandable evidence. Never show empty intelligence shells.

3. **Expand, don't navigate.** Intelligence components expand in place (click-anxiety: low). Evidence layers open below signal cards. Nothing navigates away from the profile. The profile IS the briefing.

4. **Every number traces to a source.** Click any number in any intelligence component and you reach the observation, the source, the timestamp, the trust score. Auditability is not optional — it is what distinguishes intelligence from opinion.

5. **Render is compute, not cache.** Intelligence components read from the knowledge graph and compute on render. No separate "intelligence cache." If the underlying data changes, the next render reflects it. This is the computation surface principle.

---

## Component Hierarchy

```
VehicleProfile
├── VehicleHeroImage (existing)
├── VehicleHeader (existing)
├── VehicleBriefing (NEW — the intelligence layer)
│   ├── BriefingHeadline (L0)
│   ├── SignalCards (L1)
│   │   ├── MarketPositionCard
│   │   ├── TrustAssessmentCard
│   │   ├── RiskSignalsCard
│   │   ├── CommunityPulseCard
│   │   └── HistoryPatternCard
│   └── [Each card expands to evidence layer (L2)]
├── VehicleSubHeader (existing)
├── BarcodeTimeline (existing)
└── WorkspaceContent (existing tabs)
    ├── [existing tabs]
    ├── CoachingTab (NEW — seller/owner view only)
    │   ├── AuctionReadinessCard (enhanced)
    │   ├── ListingPreview
    │   ├── PhotoCoaching
    │   ├── RepairROI
    │   └── PlatformMatcher
    └── BuildHistoryTab (NEW — public view)
        └── BuildTimeline
```

---

## VehicleBriefing — Master Component

### Position
Below the hero image, above the existing sub-header. Full-width of the content area. This is the first content a user reads after seeing the vehicle photo and title.

### Behavioral Contract
```typescript
interface VehicleBriefingProps {
  vehicleId: string;
}

// Component self-guards: renders nothing if no intelligence is available
// Fetches from vehicle-briefing DB function or RPC
// Returns null if vehicle has no analysis_signals and insufficient data for any card
```

### Data Flow
```
vehicle-briefing RPC
  ├── analysis_signals WHERE vehicle_id = $1 AND is_active = true ORDER BY severity DESC
  ├── price_comparables WHERE vehicle_id = $1 LIMIT 5
  ├── comment_discoveries WHERE vehicle_id = $1
  ├── vehicle_observations WHERE vehicle_id = $1 AND kind IN ('listing', 'sale_result')
  ├── field_evidence COUNT WHERE vehicle_id = $1
  └── observation_source_diversity (distinct source count)
```

### Layout
```
┌─────────────────────────────────────────────────────────┐
│ [BriefingHeadline — one line, full width]                │
├─────────────────────────────────────────────────────────┤
│ [SignalCard] [SignalCard] [SignalCard] [SignalCard]      │
│  ─ horizontal scroll on mobile, flex-wrap on desktop ─  │
└─────────────────────────────────────────────────────────┘
```

Desktop: Signal cards in a row, wrapping to 2 rows if >4 cards. Each card takes equal width (flex: 1).
Mobile: Horizontal scroll with snap-to-card behavior.

---

## BriefingHeadline — L0

### Purpose
One sentence communicating the single most important thing about this vehicle right now. The user reads this and knows whether to keep scrolling or stop.

### Content Generation Logic

The headline is the highest-severity signal, translated into human language:

| Signal Category | Severity | Headline Template |
|----------------|----------|-------------------|
| `deal_health` critical | CRITICAL | "Multiple risk signals detected — review before bidding" |
| `deal_health` warning | WARNING | "{specific risk}: {brief description}" |
| price below market | INFO | "Priced {X}% below comparable sales ({est_range})" |
| price above market | INFO | "Priced {X}% above comparable sales ({est_range})" |
| strong documentation | OK | "Well-documented: {N} observations from {M} sources" |
| active auction | INFO | "Auction active — {bid_count} bids, {time_remaining}" |
| sparse data | NEUTRAL | "Limited information — {N} observations from {M} sources" |
| no signals | NEUTRAL | "Basic identity confirmed — {year} {make} {model}" |

### Visual Treatment
- Full-width banner below hero image
- Background color by severity:
  - CRITICAL: `#FEE2E2` (light red)
  - WARNING: `#FEF3C7` (light amber)
  - INFO: `#DBEAFE` (light blue)
  - OK: `#D1FAE5` (light green)
  - NEUTRAL: `#F3F4F6` (light grey)
- Text: black, Arial 8pt (system standard), left-aligned
- No icons, no badges — just the sentence
- Left border 3px solid in stronger shade of the background color

### Progressive Density
- No signals, no observations: Do not render. Vehicle profile starts with existing sub-header.
- Some signals: Render headline.
- Multiple signals: Render headline from highest severity. Others become signal cards.

---

## SignalCards — L1

Each signal card is a self-contained intelligence unit. It presents one dimension of analysis with a headline, a key metric, and expandable evidence.

### Common Card Structure

```
┌─────────────────────────────┐
│ CARD TITLE          [icon]  │
│ ─────────────────────────── │
│ Key metric or statement     │
│                             │
│ Supporting detail (1 line)  │
│                             │
│ [▼ View evidence]           │
└─────────────────────────────┘
```

- Card: 1px solid `#E5E7EB` border, 0px border-radius (system standard), `--space-3` padding
- Title: Arial 8pt, `#6B7280` (grey-500), uppercase tracking
- Key metric: Arial 8pt, black, bold
- Supporting detail: Arial 8pt, `#6B7280`
- "View evidence" link: bottom of card, expands card downward (no navigation)

### Card: MarketPositionCard

**Renders when**: `nuke_estimate` exists OR `price_comparables` has >= 3 rows for this vehicle

**Content**:
```
MARKET POSITION
─────────────────
Asking $28,000 · Comparable range: $24K–$36K
Median comparable: $31,200 (5 sales in last 12 months)
[▼ View comparables]
```

**Expanded evidence (L2)**:
```
┌──────┬──────────────────────────────┬─────────┬───────────┬──────────┐
│ Photo│ Vehicle                      │ Price   │ Date      │ Platform │
├──────┼──────────────────────────────┼─────────┼───────────┼──────────┤
│ [img]│ 1977 Blazer K5 4x4 350 auto │ $36,000 │ Jan 2026  │ BaT      │
│ [img]│ 1976 Blazer K5 4x4 400 auto │ $31,200 │ Nov 2025  │ C&B      │
│ [img]│ 1978 Blazer K5 4x4 350 4spd │ $28,500 │ Oct 2025  │ BaT      │
│ [img]│ 1977 Blazer K5 2wd 350 auto │ $24,000 │ Sep 2025  │ Mecum    │
│ [img]│ 1976 Blazer K5 4x4 350 auto │ $27,800 │ Aug 2025  │ BaT      │
└──────┴──────────────────────────────┴─────────┴───────────┴──────────┘
Similarity scoring: matches on ±2 years, same body style, same drivetrain.
Adjustments: ±$2K for engine size, ±$3K for transmission type, ±$5K for condition tier.
```

**Data source**: `price_comparables`, `nuke_estimate`, `auction_events`

### Card: TrustAssessmentCard

**Renders when**: Vehicle has >= 1 observation

**Content**:
```
DOCUMENTATION DEPTH
──────────────────
47 observations from 6 sources · VIN confirmed
Identity: STRONG · Provenance: MODERATE · Condition: THIN
[▼ View sources]
```

The three sub-dimensions:
- **Identity**: VIN confirmed (decode matches claims), year/make/model corroborated, title verified
- **Provenance**: Ownership chain documented, work history present, timeline events > 10
- **Condition**: Inspection reports, classified photos covering all zones, recent observation within 6 months

Each rates as: STRONG (80%+ of relevant data present), MODERATE (40-80%), THIN (<40%), UNKNOWN (no relevant data)

**Expanded evidence (L2)**: Source list with observation count, trust score, and most recent observation date per source.

### Card: RiskSignalsCard

**Renders when**: `analysis_signals` contains any signal with severity = 'warning' or 'critical' for this vehicle

**Content**:
```
ATTENTION
─────────
Mileage discrepancy: listing says 67K, last title transfer showed 72K
[▼ View details]
```

Or multiple risks:
```
ATTENTION (2 signals)
─────────────────────
· Mileage discrepancy between listing and title history
· Vehicle listed 3 times in 14 months with declining prices
[▼ View details]
```

**Expanded evidence (L2)**: Each signal shown with:
- The specific conflicting data points
- Source and timestamp of each data point
- Possible explanations (e.g., "Odometer replacement is documented in some cases — verify with seller")

**Visual**: Uses WARNING color scheme (amber border, amber accent)

### Card: CommunityPulseCard

**Renders when**: `comment_discoveries` exists for this vehicle with sentiment analysis

**Content**:
```
COMMUNITY
──────────
34 comments analyzed · Overall: Positive (0.72)
Top themes: original paint, matching numbers engine, clean undercarriage
[▼ View highlights]
```

**Expanded evidence (L2)**:
- Sentiment distribution chart (simple bar: positive / neutral / negative counts)
- Top 3-5 theme pills with comment count per theme
- Notable comments (highest-expertise posters, most-liked comments)
- Expert badges on comments where `bat_user_profiles` shows high expertise in this segment

**Data source**: `comment_discoveries`, `auction_comments`, `bat_user_profiles`

### Card: HistoryPatternCard

**Renders when**: Vehicle has >= 2 observations of kind 'listing' or 'sale_result'

**Content**:
```
HISTORY
──────
3 market appearances over 18 months
BaT Aug '24 ($32K, sold) → C&B Feb '25 ($29K, no sale) → BaT Mar '26 ($28K, active)
[▼ View timeline]
```

**Expanded evidence (L2)**:
Visual timeline — horizontal dots connected by lines:
```
●──────────────●──────────────●
Aug 2024       Feb 2025       Mar 2026
BaT            C&B            BaT
$32,000 SOLD   $29,000 NS     $28,000 ACTIVE
```

Color coding: Green dot = sold. Red dot = no sale. Blue dot = active. Grey dot = withdrawn.
Price trend line showing trajectory.

**Data source**: `vehicle_observations` (kind IN listing, sale_result), `auction_events`

---

## Signal Card Selection Logic

Not all cards render for every vehicle. The briefing selects cards based on available data:

```
1. ALWAYS show MarketPositionCard if estimate or comps exist
2. ALWAYS show TrustAssessmentCard (even if just to say "limited data")
3. Show RiskSignalsCard ONLY if warning/critical signals exist
4. Show CommunityPulseCard ONLY if comment analysis exists
5. Show HistoryPatternCard ONLY if multiple market appearances exist
```

Maximum: 5 cards. If a vehicle has all 5, show all 5.
Minimum: 1 card (TrustAssessmentCard always renders if the vehicle exists).

Order: Risk signals first (if they exist), then market position, then trust, then community, then history.

---

## CoachingTab — Seller/Owner Intelligence

### Visibility
Only renders when the viewing user is the vehicle owner or a contributor. Uses `VehicleProfileContext.permissions` to gate.

### AuctionReadinessCard (Enhanced)

The existing `AuctionReadinessPanel` shows scores. The enhanced version adds *action items*.

```
AUCTION READINESS: 62/100
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 62%

Identity:     ████████████████░░░░  82/100
Photos:       █████████░░░░░░░░░░░  45/100  ← Top priority
Documentation:██████░░░░░░░░░░░░░░  31/100
Description:  ████░░░░░░░░░░░░░░░░  22/100
Market:       ████████████████████  100/100
Condition:    ██████████████░░░░░░  68/100

NEXT STEPS (highest impact first):
┌─────────────────────────────────────────────────────────┐
│ 1. Upload 3 undercarriage photos                        │
│    Photos: 45 → 68 (+23 pts) · Est. +8% sale price     │
├─────────────────────────────────────────────────────────┤
│ 2. Add maintenance records                              │
│    Documentation: 31 → 50 (+19 pts) · Est. +5%         │
├─────────────────────────────────────────────────────────┤
│ 3. Review generated description and publish              │
│    Description: 22 → 62 (+40 pts) · Est. +15% engage   │
└─────────────────────────────────────────────────────────┘
```

Each action item is a clickable row that either:
- Opens the photo upload interface (for photo actions)
- Opens the document upload interface (for documentation actions)
- Opens the listing preview editor (for description actions)
- Opens a work order form (for condition/repair actions)

### ListingPreview

Full-width text area showing a system-generated listing description assembled from all vehicle data.

```
┌─────────────────────────────────────────────────────────┐
│ LISTING PREVIEW (auto-generated from your data)         │
│ ─────────────────────────────────────────────────────── │
│                                                         │
│ 1977 Chevrolet K5 Blazer Cheyenne 4x4                  │
│                                                         │
│ This 1977 Chevrolet K5 Blazer is a Cheyenne-trimmed    │
│ example powered by a 350ci V8 paired with a TH350      │
│ automatic transmission and NP203 transfer case. The     │
│ truck was repainted in [MISSING: color] within the last │
│ [MISSING: timeframe] and currently shows [MILEAGE:      │
│ 67,000 miles — SINGLE SOURCE, UNVERIFIED].              │
│                                                         │
│ [MISSING SECTION: Ownership History]                    │
│ [MISSING SECTION: Maintenance History]                  │
│ [MISSING SECTION: Known Issues / Disclosure]            │
│                                                         │
│ The truck rides on [MISSING: tire description] and      │
│ features [LIST: modifications from observations]...     │
│                                                         │
│ ─────────────────────────────────────────────────────── │
│ [Edit Description]  [Copy to Clipboard]  [Platform: BaT]│
└─────────────────────────────────────────────────────────┘
```

Key behaviors:
- `[MISSING: ...]` tags highlight gaps inline — they're not errors, they're calls to action
- User can edit the generated text before copying
- Platform selector (BaT, C&B, Hemmings, Craigslist) adjusts tone and format
- "Copy to Clipboard" exports the final text for use on the actual listing platform

**Data source**: All vehicle data assembled by an AI prompt. The prompt receives structured data (specs, observations, work history, photos analyzed) and produces a platform-appropriate narrative.

### PhotoCoaching

Shows the 41-zone image angle spectrum with coverage status:

```
PHOTO COVERAGE (12 of 41 zones covered)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 29%

EXTERIOR                    COVERED?
  Front 3/4                    ✓
  Rear 3/4                     ✓
  Driver side                  ✓
  Passenger side               ✗ ← NEEDED
  Undercarriage front          ✗ ← NEEDED
  Undercarriage rear           ✗ ← NEEDED
  Wheel detail (×4)            ✗ ← NEEDED

INTERIOR
  Dashboard                    ✓
  Front seats                  ✓
  Rear area                    ✗ ← NEEDED
  Gauges                       ✓
  Odometer                     ✗ ← NEEDED (for mileage verification)

ENGINE BAY
  Overall                      ✓
  Numbers/casting              ✗ ← NEEDED (for matching numbers verification)
  ...
```

Each "NEEDED" item links to photo upload with the zone pre-selected.

**Data source**: `vehicle_images` classified by `image_angle_spectrum`, cross-referenced against a "complete" shot list (defined per platform).

---

## DensityBadge — Cross-Surface Component

### Purpose
A compact visual indicator showing how much the system knows about a vehicle. Appears on every vehicle card in browse results, search results, and feeds.

### Visual Design

Five density levels, encoded as a simple fill indicator:

```
Level 1 (Sparse):    ●○○○○   "Basic identity only"
Level 2 (Thin):      ●●○○○   "Some history"
Level 3 (Moderate):  ●●●○○   "Well-documented"
Level 4 (Dense):     ●●●●○   "Comprehensive"
Level 5 (Bedrock):   ●●●●●   "Fully verified"
```

### Calculation
```sql
SELECT
  CASE
    WHEN observation_count >= 100 AND source_diversity >= 5 AND has_vin AND has_work_history THEN 5
    WHEN observation_count >= 30 AND source_diversity >= 3 AND has_vin THEN 4
    WHEN observation_count >= 10 AND source_diversity >= 2 THEN 3
    WHEN observation_count >= 3 THEN 2
    ELSE 1
  END as density_level
```

Factors: observation count, source diversity (distinct sources), VIN confirmation, work history presence, photo coverage, time span of observations, field evidence count.

### Placement
- Vehicle cards in browse results: top-right corner
- Vehicle cards in search results: top-right corner
- Vehicle profile header: next to title
- Comp grid entries: next to price

### Hover State
On hover, shows brief explanation: "34 observations from 5 sources over 3 years"

---

## Browse Surface Enhancements

### SmartSearchBar

Replaces or augments the existing search input. Accepts natural language and decomposes into structured query parameters.

**Client-side parsing patterns** (no API call needed):
```
Pattern: /(\d{4})\s*/           → year_exact (e.g., "1977")
Pattern: /(\d{4})s/             → year_decade (e.g., "1970s" → 1970-1979)
Pattern: /under\s*\$?([\d,]+)/  → price_max
Pattern: /over\s*\$?([\d,]+)/   → price_min
Pattern: /\$?([\d,]+)\s*-\s*\$?([\d,]+)/ → price range
Pattern: /(red|blue|green|...)/  → color
Pattern: /(truck|convertible|sedan|...)/ → body_style
Pattern: /(4x4|4wd|awd)/        → drivetrain
Pattern: /(manual|automatic|stick)/ → transmission
Pattern: /(K5|C10|Bronco|...)    → model (known model names)
Pattern: /(Chevy|Ford|Dodge|...)/ → make (known make names)
```

What remains after pattern extraction becomes the text search query sent to `universal-search`.

**Visual feedback**: As the user types, extracted filters appear as pills below the search bar:
```
┌─────────────────────────────────────┐
│ red trucks under 30k from the 70s   │
└─────────────────────────────────────┘
 [color: red] [body: truck] [price: <$30K] [year: 1970-1979]

 Searching for: "" (all filters extracted)
```

Users can remove pills to adjust the search. The text query only contains what wasn't matched by patterns.

### MarketPulse

A compact section above browse results showing market activity.

```
MARKET PULSE
─────────────────────────────────────────
Trending ↑  K5 Blazer (+12%) · C10 (+8%) · Bronco (+6%)
Notable    '72 Blazer sold $47K on BaT (est: $33K)
Active     23 auctions ending today · 147 new listings this week
```

Each item is clickable — trending segment links to filtered browse, notable sale links to vehicle profile, active count links to filtered browse sorted by auction end time.

**Data source**: `market_segment_stats` (computed weekly), `auction_events` (recent notable), active listing counts from `vehicle_observations`.

### ValueBadge

On vehicle cards in browse results, a subtle badge indicating deal quality:

```
GOOD DEAL          — asking price 10-20% below estimate
GREAT DEAL         — asking price 20%+ below estimate
ABOVE MARKET       — asking price 10%+ above estimate
(no badge)         — price is within ±10% of estimate, or no estimate available
```

Badge: small pill in the card's price area. Green for good/great, amber for above market.

**Data source**: `nuke_estimate` vs. current listing price.

---

## Segment Dashboard

### Route
`/market/:make` — make-level dashboard (all K5 Blazers, all C10s)
`/market/:make/:model` — model-level dashboard

### Layout
```
┌─────────────────────────────────────────────────────────┐
│ K5 BLAZER MARKET OVERVIEW                               │
│ 1,247 vehicles tracked · 342 with sale results          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ PRICE TREND (24 months)                                 │
│ ┌─────────────────────────────────┐                     │
│ │    ╱─╲                          │  Median: $28,400    │
│ │   ╱   ╲    ╱─╲                  │  Range: $8K–$89K    │
│ │──╱     ╲──╱   ╲──────          │  Volume: 12/month   │
│ │                                 │  YoY: +8.2%         │
│ └─────────────────────────────────┘                     │
│                                                         │
│ RECENT SALES                                            │
│ ┌──────┬───────────────────┬────────┬─────────┬───────┐ │
│ │ Photo│ Vehicle           │ Price  │ Date    │ Platf │ │
│ ├──────┼───────────────────┼────────┼─────────┼───────┤ │
│ │ [img]│ '77 K5 4x4 350   │ $36,000│ Mar '26 │ BaT   │ │
│ │ [img]│ '76 K5 4x4 400   │ $31,200│ Feb '26 │ C&B   │ │
│ │ ...  │ ...               │ ...    │ ...     │ ...   │ │
│ └──────┴───────────────────┴────────┴─────────┴───────┘ │
│                                                         │
│ ACTIVE LISTINGS                                         │
│ [Grid of current listings with DensityBadge]            │
│                                                         │
│ SEGMENT STATS                                           │
│ Avg Days on Market: 34 · Sell-through: 67%              │
│ Most Common Config: 350/auto/4x4 (43%)                  │
│ Price by Condition: Excellent $45K+ · Good $25-35K      │
│                     Fair $12-20K · Project $5-12K       │
└─────────────────────────────────────────────────────────┘
```

### Data Sources
- `market_segment_stats` — pre-aggregated segment-level data
- `auction_events` — individual sales
- `vehicles` — active listings
- `vehicle_images` — thumbnails for comp grid

### PriceTrendChart (Reusable)

Used in: Segment Dashboard, Vehicle Profile (comps context), Browse page.

Input: Array of `{ date, price, platform?, sold? }` data points.
Rendering: SVG or canvas line chart. Confidence band (light fill between P25 and P75). Individual dots for sales. Hover for details.

Design system compliance: no gradients, no rounded corners on chart container, 1px solid border, Arial labels.

### CompGrid (Reusable)

Used in: Segment Dashboard, Vehicle Profile (expanded comps).

Input: Array of comparable vehicles with photo, title, price, date, platform, key specs.
Rendering: Table layout with thumbnail column. Sortable by any column. Click row → vehicle profile.

---

## Build History Tab — Public Vehicle Provenance

### Visibility
Public — any viewer can see the build history if it exists. The raw timeline data is not sensitive (it's the same data the vehicle would carry in a logbook).

### Renders When
`work_sessions` count > 0 for this vehicle.

### Layout
```
BUILD HISTORY (26 sessions · 14 months · $18,240 documented)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 73% complete

MAR 2026 ───────────────────────────────────
● Session 26: Final detail and delivery prep
  2.5 hours · Interior, exterior
  3 photos
  [expand for day card]

● Session 25: Exhaust completion + test drive
  8 hours · Exhaust, drivetrain
  $1,239 parts · 12 photos
  [expand for day card]

FEB 2026 ───────────────────────────────────
● Session 24: Custom exhaust fabrication
  11.5 hours · Exhaust
  $977.50 labor · $1,239 materials · 28 photos
  [expand for day card]

...
```

Each session expands to a Day Card (existing component) with the seven-level analysis narrative.

**Data source**: `work_sessions`, `work_orders`, `work_order_line_items`, `build_images`

---

## Interaction Patterns

### Expand-to-Evidence

Every intelligence component follows the same interaction pattern:

1. **Collapsed state**: Key metric + one-line summary (L1)
2. **Click "View evidence" or "View details"**: Card expands downward, pushing content below it
3. **Expanded state**: Full evidence table/chart/timeline (L2)
4. **Click again or Escape**: Collapses back to L1

No navigation. No modals (except for image lightbox). No new pages. The profile page is the only page.

### Hover-for-Context

Any number, any badge, any metric can be hovered for a tooltip showing:
- Where the number comes from (source)
- When it was last computed
- Confidence level
- Sample size (for aggregates)

Example: Hover on "Median: $31,200" → Tooltip: "Based on 5 comparable sales, Aug 2025 - Mar 2026. Confidence: MODERATE (small sample)."

### Click-Through-to-Source

From the evidence layer (L2), any individual data point links to its source:
- Comparable sale → that vehicle's profile
- Observation → source URL (external link icon)
- Comment → comment in context on the profile's comments section
- Work session → day card expansion

This click-through chain is how the Archivist user reaches Layer 3 (the raw graph) — by following evidence links progressively deeper.

---

## Empty States

### No Intelligence Available (very sparse vehicle)
The entire VehicleBriefing component does not render. The profile shows the existing vehicle data (header, photos, specs) without any intelligence section. No "No insights available" placeholder. No empty cards.

### Partial Intelligence
If only 1-2 signal cards have data, render only those. The briefing section sizes to its content. A vehicle with only a TrustAssessmentCard and a HistoryPatternCard renders just those two cards.

### Coaching Tab with No ARS
If ARS has not been computed for this vehicle, the coaching tab renders a single action: "Score this vehicle for auction readiness" button that triggers computation.

### Build History with No Sessions
Tab does not appear in the tab bar. No empty "Build History" tab with placeholder text.
