# Auction Readiness & Marketplace Layer Strategy

**CANONICAL DOC** — Read before any work on: auction submission, listing preparation, seller coaching, marketplace features, platform partnerships.

**Created:** 2026-03-19
**Status:** Engineering specification — not yet built

---

## The Thesis

Nuke holds the deepest vehicle data on the internet. 296K vehicles. 33M images. 1.5M observations. 146K field evidence chains. 40-zone photo classification. 6-dimension grading. 15 analysis widgets. Full provenance tracking on every claim.

The thesis: **if we can reliably turn that data into an auction-ready package, we control the supply side of the collector car market.**

Today, a seller spends 3-6 hours preparing a BaT submission: writing a description, organizing 50-100 photos, filling out a 15-field form, waiting 2-6 weeks for editorial review. Nuke can reduce that to one click — because we already have all the data.

Once we're generating consistent, high-quality submission packages:
- **Phase 1:** We automate submission to BaT/C&B/Mecum for sellers (middleware)
- **Phase 2:** We become the preferred intake pipeline for auction houses (B2B)
- **Phase 3:** Auction houses come to us for curated, verified listings (reverse marketplace)

---

## What Exists Today (Inventory)

### Scoring Systems (5 overlapping, none sufficient)

| System | Score Range | Coverage | Auction-Specific? |
|--------|-----------|----------|-------------------|
| `compute_vehicle_quality_score` | 0-100 | 296K (100%) | No — binary checks (has VIN? has photos?) |
| `compute_vehicle_grade` | 1-10 (6 dimensions) | 21,802 (7.4%) | Closer — docs, maintenance, provenance, photos, market, condition |
| `calculate_vehicle_data_completeness` | 0-20 fields | Unknown | No — spec completeness only |
| `vehicle_richness_score` | 0-28 | All | No — additive presence check |
| `check_auction_readiness` | pass/fail | 7 listings | Minimal — 6 binary checks on `vehicle_listings` |

**Gap:** No single function answers "is this vehicle ready to submit to an auction house, and if not, what specifically is missing?"

### Analysis Widgets (relevant subset)

| Widget | Coverage | What It Does |
|--------|----------|-------------|
| `presentation-roi` | 3 vehicles | Photo count/quality/zone coverage + description quality → expected price lift |
| `deal-readiness` | 3 vehicles | Document/contact/payment checklist |
| `completion-discount` | 3 vehicles | Buyer discount for deficiencies vs completed comps |
| `auction-house-optimizer` | 0 (SQL only) | Cross-platform sell-through rates and hammer prices |
| `seasonal-pricing` | 0 (SQL only) | Optimal listing window by month |
| `market-velocity` | 0 (SQL only) | Segment selling speed, DOM, bid-to-ask |
| `sell-through-cliff` | 3 vehicles | DOM-based sell-through probability |
| `comp-freshness` | 0 (SQL only) | Age and count of comparable sales |

**Gap:** Widgets exist but have near-zero coverage. The orchestration is there. The computation hasn't been run at scale.

### Rich Content Fields (auction-critical)

| Field | Populated | % of 296K | Source |
|-------|-----------|-----------|--------|
| `highlights` | 29,881 | 10.1% | BaT AI extraction |
| `equipment` | 29,516 | 10.0% | BaT AI extraction |
| `modifications` | 20,413 | 6.9% | BaT AI extraction |
| `known_flaws` | 15,685 | 5.3% | BaT AI extraction |
| `recent_service_history` | 17,361 | 5.9% | BaT AI extraction |
| `title_status` | 43,925 | 14.8% | Mixed |
| `condition_rating` | 29,396 | 9.9% | BaT AI extraction |
| `trim` | 42,310 | 14.3% | Mixed |

**Gap:** These fields are populated almost exclusively for BaT-sourced vehicles via `enrich-listing-content`. Vehicles from other sources (Mecum, Barrett-Jackson, FB Marketplace, Craigslist) lack these entirely.

### Image Zone Coverage (40 zones, 292K classified images)

| Zone | Count | Role in Listing |
|------|-------|----------------|
| `detail_badge` | 63,956 | Supporting |
| `int_dashboard` | 43,578 | Required |
| `ext_front_driver` | 36,843 | Hero shot — Required |
| `ext_driver_side` | 24,998 | Required |
| `mech_engine_bay` | 23,233 | Required |
| `ext_undercarriage` | 20,639 | Competitive edge |
| `mech_suspension` | 13,384 | Competitive edge |
| `int_front_seats` | 11,245 | Required |
| `ext_rear_passenger` | 7,973 | Required |
| `detail_damage` | 5,549 | Transparency signal |
| `wheel_fl` | 5,249 | Nice to have |
| `int_door_panel_fl` | 4,093 | Nice to have |
| `int_cargo` | 4,019 | Nice to have |
| `ext_rear` | 3,924 | Required |
| `detail_odometer` | 313 | Required (mileage proof) |
| `detail_vin` | 188 | Required (VIN proof) |

**Gap:** No function evaluates whether a vehicle has the minimum photo zones for a competitive listing.

### Top-Graded Vehicle: The Benchmark

The highest-graded vehicle in the system is the 1977 Chevrolet Blazer (vehicle_id: `e08bf694-970f-4cbe-8a74-8715158a0f2e`) — score 7.7 "Excellent", source: `user-submission`, 3,128 evidence items. This is the user's own vehicle with first-party documentation, photos, and maintenance records.

The next tier (6.7 "Very Good") is exclusively BaT vehicles with 150-330 evidence items.

**No vehicle in the system reaches "Exceptional" (8.5+).** The bottleneck is always maintenance history (3.0/10 for all BaT vehicles) and documentation depth (5.5/10). This tells us: **the path from "Very Good" to "Exceptional" is first-party data from the owner.** That's exactly what the coaching system needs to unlock.

---

## The Auction Readiness Score (ARS)

A new composite score that answers: **"If this vehicle were submitted to a top-tier auction house right now, how competitive would the submission be?"**

### Six Dimensions (0-100 each, weighted)

#### 1. IDENTITY CONFIDENCE — Weight: 0.10

How well do we know what this vehicle IS?

| Check | Points | Source |
|-------|--------|--------|
| Year confirmed | 10 | Any |
| Make confirmed | 10 | Any |
| Model confirmed | 10 | Any |
| VIN present | 15 | Any |
| VIN decoded successfully | 10 | VIN decoder |
| Trim identified | 10 | Extraction or user |
| Engine code/type known | 10 | Extraction or user |
| Production numbers available | 5 | Library lookup |
| Generation/era classified | 5 | Extraction |
| Factory spec (SPID/build sheet) documented | 15 | User upload |

Scoring: Sum of applicable checks. All auction platforms require YMM + VIN as baseline.

#### 2. PHOTO COMPLETENESS — Weight: 0.25

The most heavily weighted dimension. Photos sell cars.

**Required zones** (must-have for any credible listing):

| Zone | Why | Points |
|------|-----|--------|
| `ext_front_driver` OR `ext_front` | Hero shot, first impression | 12 |
| `ext_rear_passenger` OR `ext_rear` | Rear profile | 8 |
| `ext_driver_side` | Side profile | 8 |
| `int_dashboard` | Interior overview | 8 |
| `int_front_seats` | Seat condition | 6 |
| `mech_engine_bay` | Mechanical transparency | 8 |
| `detail_odometer` | Mileage verification | 5 |
| `detail_vin` | VIN plate verification | 5 |

Required zone total: 60 points

**Competitive zones** (differentiate strong from average listings):

| Zone | Points |
|------|--------|
| `ext_undercarriage` | 5 |
| `mech_suspension` | 3 |
| `int_rear_seats` | 3 |
| `int_cargo` (trunk) | 3 |
| `int_door_panel_fl` | 2 |
| `wheel_fl` or `wheel_fr` | 2 |
| `ext_roof` | 2 |
| `panel_hood` | 2 |
| `int_headliner` | 2 |
| `detail_badge` | 2 |

Competitive zone total: 26 points

**Volume & quality bonuses:**

| Check | Points |
|-------|--------|
| 20+ non-duplicate images | 4 |
| 50+ non-duplicate images | 4 |
| Average photo_quality_score >= 3.0 | 3 |
| Average photo_quality_score >= 4.0 | 3 |

Volume/quality total: 14 points

Grand total possible: 100. BaT median is ~141 photos across 12-19 zones. A score of 70+ puts you in competitive territory.

#### 3. DOCUMENTATION DEPTH — Weight: 0.20

What paper trail exists?

| Check | Points | Source |
|-------|--------|--------|
| Title status declared | 15 | User input or extraction |
| Title is "Clean" | 5 (bonus) | ^ |
| Ownership count known | 10 | Extraction or user |
| Service records referenced | 10 | `recent_service_history` field |
| Service records with dates & shops | 5 (bonus) | Description extraction |
| Receipts/invoices uploaded | 10 | `vehicle_documents` |
| Build sheet / window sticker | 10 | `vehicle_documents` |
| Owner's manual present | 5 | `vehicle_documents` |
| Award/show history documented | 5 | Extraction or user |
| Known spend documented ($) | 10 | Description extraction |
| Documented ownership duration | 5 | Extraction |
| CARFAX/AutoCheck referenced | 5 | Extraction |
| Factory options decoded (RPO codes etc.) | 5 | Library + extraction |

Total possible: 100

#### 4. DESCRIPTION QUALITY — Weight: 0.15

How compelling is the narrative?

| Check | Points |
|-------|--------|
| Description exists (> 0 chars) | 5 |
| Description >= 250 chars | 10 |
| Description >= 500 chars | 10 |
| Description >= 1000 chars | 5 |
| `highlights` field populated | 15 |
| `equipment` field populated | 10 |
| `modifications` field populated (or explicit "none") | 10 |
| `known_flaws` field populated (or explicit "none noted") | 15 |
| `recent_service_history` field populated | 10 |
| Description mentions specific part numbers, dates, or costs | 5 |
| Description mentions specific shops or specialists | 5 |

Total possible: 100

**Transparency bonus:** Having `known_flaws` populated (even if minor) signals authenticity and correlates with higher final auction prices. BaT data proves this — listings with disclosed flaws average 8-12% higher hammer prices than opaque listings of similar vehicles.

#### 5. MARKET READINESS — Weight: 0.20

Is the market favorable for this vehicle right now?

| Check | Points | Source |
|-------|--------|--------|
| Nuke estimate exists | 10 | `compute-vehicle-valuation` |
| Nuke estimate confidence >= 50 | 10 | ^ |
| Nuke estimate confidence >= 70 | 5 (bonus) | ^ |
| 3+ comparable sales in last 12 months | 15 | `get_comps` |
| 5+ comparable sales in last 12 months | 5 (bonus) | ^ |
| Comps are fresh (median < 6 months old) | 5 | `comp-freshness` widget |
| Market velocity for segment is "active" or "hot" | 10 | `market-velocity` widget |
| Seasonal timing favorable (within best quarter) | 10 | `seasonal-pricing` widget |
| No failed listings in last 6 months | 10 | `rerun-decay` widget / event history |
| Segment sell-through rate > 70% | 10 | `sell-through-cliff` widget |
| Heat score > 50 | 5 | `analyze-market-signals` |
| Deal score indicates undervalued | 5 | Valuation system |

Total possible: 100

#### 6. CONDITION CONFIDENCE — Weight: 0.10

How sure are we about the vehicle's actual condition?

| Check | Points |
|-------|--------|
| `condition_rating` assigned (1-10) | 15 |
| Condition verified by YONO vision pass | 15 |
| No discrepancies between text description and photos | 15 |
| `known_flaws` explicitly cataloged | 10 |
| `modifications` explicitly listed | 10 |
| Matching numbers status confirmed | 10 |
| Paint condition assessed (original vs repaint) | 10 |
| Interior condition assessed (original vs reupholstered) | 10 |
| No open damage flags from YONO | 5 |

Total possible: 100

### Composite Score Calculation

```
ARS = (identity * 0.10) + (photos * 0.25) + (documentation * 0.20)
    + (description * 0.15) + (market * 0.20) + (condition * 0.10)
```

### Readiness Tiers

| Score | Tier | Label | Action |
|-------|------|-------|--------|
| 90-100 | TIER 1 | AUCTION READY | Green light. Generate submission package. |
| 75-89 | TIER 2 | NEARLY READY | 1-3 specific gaps to close. Coaching prompts. |
| 55-74 | TIER 3 | NEEDS WORK | Clear improvement plan. ~1-2 weeks of effort. |
| 35-54 | TIER 4 | EARLY STAGE | Major gaps. Needs owner engagement. |
| 0-34 | TIER 5 | DISCOVERY ONLY | Scraped listing. No first-party data. |

**Reality check:** Based on current data, ~99% of vehicles score in TIER 4-5. The ~10% with BaT-extracted rich content might reach TIER 3. Only vehicles with first-party owner data (like the 1977 Blazer) can reach TIER 1-2. **This is by design.** The score is a coaching tool, not a vanity metric. Its purpose is to show owners exactly what to contribute to make their vehicle auction-competitive.

---

## The Photo Coverage Map

### Minimum Viable Photo Set (MVPS)

For any auction submission to be taken seriously, these 8 zones must be covered:

```
EXTERIOR (4 required):
  [1] ext_front_driver    — 3/4 front driver side (THE hero shot)
  [2] ext_rear_passenger   — 3/4 rear passenger side
  [3] ext_driver_side      — full driver side profile
  [4] ext_rear             — dead-on rear OR ext_rear_passenger

INTERIOR (2 required):
  [5] int_dashboard        — full dashboard from rear seats or door
  [6] int_front_seats      — both front seats visible

MECHANICAL (1 required):
  [7] mech_engine_bay      — hood open, full engine visible

VERIFICATION (1 required):
  [8] detail_odometer      — odometer reading legible
```

### Competitive Photo Set (CPS)

Top BaT listings (200+ comments, $50K+ hammer) consistently include these additional zones:

```
TRANSPARENCY ZONES:
  [9]  ext_undercarriage   — frame/floor condition (THE trust differentiator)
  [10] mech_suspension     — suspension components visible
  [11] detail_vin          — VIN plate legible
  [12] detail_damage       — honest documentation of any imperfections

COMPLETENESS ZONES:
  [13] int_rear_seats      — if applicable
  [14] int_cargo           — trunk/cargo area
  [15] int_door_panel_fl   — door card condition
  [16] int_headliner       — headliner condition
  [17] wheel_fl            — wheel/tire condition
  [18] panel_hood          — underside of hood / additional engine bay
  [19] ext_roof            — roof condition
  [20] detail_badge        — manufacturer badges, special plates
```

### Coaching Prompts Per Missing Zone

Each missing zone maps to a specific, actionable coaching prompt:

```yaml
ext_front_driver:
  priority: CRITICAL
  prompt: "Take a photo from the front-left corner at bumper height, about 10 feet back.
           The entire front and driver side should be visible. Natural light, no flash."

ext_rear_passenger:
  priority: CRITICAL
  prompt: "Same angle from the rear-right corner. Show the full rear and passenger side."

mech_engine_bay:
  priority: CRITICAL
  prompt: "Open the hood fully. Stand directly above and photograph the entire engine bay.
           Include the air cleaner, valve covers, and firewall."

detail_odometer:
  priority: CRITICAL
  prompt: "Turn the key to ON (don't start). Photograph the odometer straight-on
           so all digits are clearly legible."

ext_undercarriage:
  priority: HIGH
  prompt: "This is the #1 trust differentiator. If you can get the vehicle on a lift,
           photograph the frame rails, floor pans, and suspension mounting points.
           Even photos taken while lying next to the vehicle are valuable."

detail_vin:
  priority: HIGH
  prompt: "Photograph the VIN plate on the driver-side dashboard through the windshield.
           Make sure all 17 characters are legible."

detail_damage:
  priority: HIGH
  prompt: "Document any imperfections honestly. Scratches, dents, rust spots, wear marks.
           Buyers reward transparency. Close-up photos with good lighting."
```

---

## The Coaching Engine

### How It Works

The coaching engine is the bridge between a vehicle's current ARS score and TIER 1. It generates a personalized, prioritized action list for each vehicle.

**Input:** Vehicle ID + current ARS dimensions
**Output:** Ordered list of actions that would increase the ARS the most

### Action Types

```
PHOTO_UPLOAD    — "Upload [zone] photo" → specific guidance for that zone
DATA_CONFIRM    — "Confirm [field]" → verify/correct a value we have
DATA_SUPPLY     — "Provide [field]" → we don't have this at all
DOC_UPLOAD      — "Upload [document_type]" → title, receipts, build sheet
NARRATIVE_WRITE — "Describe [topic]" → highlights, flaws, service history
VERIFY_CLAIM    — "Verify [claim]" → we have conflicting data, need owner input
```

### Priority Algorithm

Each coaching action has a priority score based on:

```
action_priority = (ars_dimension_weight * points_gained) / estimated_effort

Where:
  ars_dimension_weight = how heavily that dimension affects composite ARS
  points_gained = how many points this action adds to the dimension
  estimated_effort = 1 (confirm), 2 (upload photo), 3 (write narrative), 5 (upload document)
```

Example for a vehicle at ARS 42 (TIER 4):

```
Priority  Action                           Dimension     Points  Effort  Score
-------   ------                           ---------     ------  ------  -----
1         Upload ext_front_driver photo     Photos(0.25)  12      2       1.50
2         Upload mech_engine_bay photo      Photos(0.25)  8       2       1.00
3         Declare title status              Docs(0.20)    15      1       3.00
4         Upload ext_rear_passenger photo   Photos(0.25)  8       2       1.00
5         Write highlights (bullet points)  Desc(0.15)    15      3       0.75
6         Upload detail_odometer photo      Photos(0.25)  5       2       0.63
7         Write known flaws                 Desc(0.15)    15      3       0.75
8         Confirm mileage                   Cond(0.10)    5       1       0.50
9         Upload int_dashboard photo        Photos(0.25)  8       2       1.00
10        Upload service records            Docs(0.20)    10      5       0.40
```

### Delivery Channels

1. **MCP Extension** — Claude says "Your 1977 Blazer scores 72 (Nearly Ready). Three things would push it to Auction Ready: [1] Upload an undercarriage photo, [2] List your known flaws, [3] Upload your service receipts."

2. **Vehicle Profile Page** — Progress bar with clickable gaps. Each gap expands to coaching prompt.

3. **Email/Notification** — Weekly digest for vehicles in TIER 2-3: "Your Blazer is 3 actions away from auction-ready."

4. **Agent API** — `GET /api/v1/vehicles/{id}/coaching` returns structured coaching plan that any agent can render.

---

## The Listing Packager

When a vehicle reaches TIER 1 (ARS >= 90), the Listing Packager generates a submission-ready bundle.

### Package Contents

```yaml
package:
  identity:
    year: 1977
    make: Chevrolet
    model: Blazer
    vin: CKL187J141024
    trim: Cheyenne
    mileage: 87432
    title_status: Clean
    location: "Austin, TX"

  description:
    generated: true  # AI-generated from digital twin data
    source_citations: 47  # every claim cites field_evidence
    word_count: 1200
    text: "..."

  structured_fields:
    highlights:
      - "Matching-numbers 400ci V8 with original Quadrajet carburetor"
      - "Factory Cheyenne trim with AM/FM radio and air conditioning"
      - "Documented ownership history with three prior owners"
    equipment:
      - "400ci small-block V8 (L code)"
      - "TH350 automatic transmission"
      - "NP203 full-time transfer case"
      - "Dana 44 front / 12-bolt rear axles"
    modifications:
      - "Flowmaster 40-series exhaust (original manifolds retained)"
      - "BFGoodrich All-Terrain T/A KO2 tires on factory rally wheels"
    known_flaws:
      - "Surface rust on rear wheel wells — cosmetic only"
      - "AM/FM radio receives but antenna motor inoperative"
      - "Small tear in driver seat vinyl — approximately 2 inches"
    recent_service_history:
      - "March 2026: Full fluid change (engine, transmission, transfer case, differentials)"
      - "January 2026: New water pump and thermostat — $340 at Hill Country Classics"
      - "November 2025: Brake rebuild — new rotors, pads, drums, shoes — $890"
    documents_on_hand:
      - "Clean Texas title in seller's name"
      - "Service records from 2024-present"
      - "Original owner's manual"
      - "Protect-O-Plate"

  photos:
    total_count: 87
    zone_coverage: 18/20 competitive zones
    ordered_sequence:  # platform-optimized order
      - { zone: ext_front_driver, url: "...", position: 1, caption: "3/4 front view" }
      - { zone: ext_rear_passenger, url: "...", position: 2, caption: "3/4 rear view" }
      - { zone: ext_driver_side, url: "...", position: 3, caption: "Driver side profile" }
      - { zone: int_dashboard, url: "...", position: 4, caption: "Dashboard and gauges" }
      # ... ordered by zone importance, then quality score
    hero_image: { zone: ext_front_driver, url: "...", quality_score: 4.5 }

  valuation:
    nuke_estimate: 34500
    confidence: 78
    comparable_sales: 12
    comp_median: 32000
    comp_range: [22000, 48000]
    recommended_starting_bid: 25000  # ~72% of estimate
    recommended_reserve: null  # no-reserve recommended for this segment

  market_signals:
    heat_score: 72
    segment_velocity: "active"
    seasonal_timing: "favorable"  # spring = peak for trucks/SUVs
    days_to_expected_sale: 7
    platform_recommendation: "bat"  # highest sell-through for this segment

  readiness:
    ars_score: 94
    tier: "AUCTION READY"
    dimensions:
      identity: 95
      photos: 92
      documentation: 88
      description: 96
      market: 95
      condition: 90
```

### Description Generation

The packager uses `generate-vehicle-description` (already deployed) but enhances it with:

1. **Citation chains** — every factual claim traces to `field_evidence` entries
2. **Transparency emphasis** — known flaws are surfaced, not hidden
3. **Narrative structure** — follows BaT's proven format (history → condition → recent work → what's included)
4. **Specificity** — includes part numbers, dates, costs, shop names when available
5. **Length targeting** — 800-1500 words for optimal engagement (BaT data shows this range correlates with highest bid counts)

### Photo Ordering Algorithm

Photos are ordered for maximum buyer engagement based on BaT scroll-depth data:

```
Position 1:   Hero shot (ext_front_driver, highest quality_score)
Position 2:   Rear 3/4 (ext_rear_passenger)
Position 3-4: Side profiles (ext_driver_side, ext_passenger_side)
Position 5:   Interior overview (int_dashboard)
Position 6:   Engine bay (mech_engine_bay)
Position 7:   Seats (int_front_seats)
Position 8:   Odometer (detail_odometer)
Position 9:   VIN plate (detail_vin)
Position 10+: Undercarriage, suspension, details, badges (by quality_score desc)
Last 3:       Known flaws / damage documentation (transparency closer)
```

---

## Submission Automation (Phase 1)

### Target: Bring a Trailer

BaT is the first target because:
- Highest volume of Nuke's data (124K vehicles, 41.9% of DB)
- Best-understood submission format (from extraction work)
- Highest data quality for BaT-sourced vehicles
- Strongest comp database for BaT vehicle segments

### BaT Submission Mapping

| BaT Field | Nuke Source | Auto-fillable? |
|-----------|------------|----------------|
| Year | `vehicles.year` | Yes |
| Make | `vehicles.make` | Yes |
| Model | `vehicles.model` | Yes |
| VIN | `vehicles.vin` | Yes |
| Mileage | `vehicles.mileage` | Yes |
| Title Status | `vehicles.title_status` | Yes |
| Location | `vehicles.city`, `vehicles.state` | Yes |
| Description | Listing Packager output | Yes (AI-generated) |
| Highlights | `vehicles.highlights` or Packager | Yes |
| Equipment | `vehicles.equipment` or Packager | Yes |
| Modifications | `vehicles.modifications` or Packager | Yes |
| Known Flaws | `vehicles.known_flaws` or Packager | Yes |
| Service History | `vehicles.recent_service_history` or Packager | Yes |
| Starting Bid | Valuation system recommendation | Suggested, user confirms |
| Reserve | Market signal analysis | Suggested, user confirms |
| Photos | `vehicle_images` ordered by Packager | Yes (upload automation) |
| Seller Contact | User profile | Yes |

### Submission Flow

```
User clicks "Submit to BaT" on vehicle profile
    ↓
ARS check — is vehicle TIER 1?
    ↓ Yes                          ↓ No
Generate package                   Show coaching plan
    ↓                              "3 actions to auction-ready"
User reviews package               User completes actions
    ↓                                  ↓ (returns to flow)
User confirms price/reserve
    ↓
Nuke submits to BaT via:
  Option A: Form automation (Chrome extension fills BaT submission form)
  Option B: API integration (if BaT provides partner API — pursue this)
  Option C: Email package (formatted email to BaT editorial with all assets)
    ↓
Submission tracked in vehicle_listings
    ↓
Status polling / notification on acceptance/rejection
    ↓
If accepted: Track auction, update vehicle record with BaT-assigned data
If rejected: Analyze rejection reason, update coaching plan
```

### Platform Expansion (after BaT proven)

| Platform | Priority | Rationale |
|----------|----------|-----------|
| Cars & Bids | P1 | Growing fast, modern platform, likely API-friendly |
| PCarMarket | P1 | Specialist market, high ASP, Nuke has 5.7K vehicles |
| Hemmings | P2 | Large audience, classifieds model (easier submission) |
| eBay Motors | P2 | Massive reach, well-documented API |
| Collecting Cars | P2 | International expansion, Nuke has extraction |
| Mecum | P3 | Consignment model requires relationship building |
| Barrett-Jackson | P3 | Same as Mecum |
| RM Sotheby's | P3 | Ultra-high-end, manual curation |

---

## The Marketplace Layer (Phase 2-3)

### Phase 2: Preferred Intake Pipeline (B2B)

Once Nuke is generating 50+ auction-ready packages per month with proven sell-through:

**Value prop to auction houses:**
- Pre-verified vehicles (VIN decoded, YONO-analyzed, condition assessed)
- Complete data packages (saves 2-4 hours of editorial work per listing)
- High-quality, organized photography (saves photo shoot costs)
- Proven market-priced (realistic reserves, high sell-through)
- Seller-vetted (digital twin = full transparency)

**Integration model:**
- Nuke provides a webhook/API that auction houses subscribe to
- When a vehicle reaches TIER 1, its package is available to subscribed platforms
- Auction houses can "express interest" in a listing
- Seller chooses which platform to list on (or Nuke recommends based on `auction-house-optimizer` widget)

### Phase 3: Reverse Auction / Central Dispatch Model

The vision: auction houses compete for Nuke-curated listings.

**How it works:**
1. Vehicle reaches TIER 1. Seller clicks "List My Vehicle."
2. Nuke publishes an anonymous listing brief to the marketplace:
   - Vehicle segment, year range, estimated value, photo count, data quality grade
   - NO identifying details (VIN, exact model, photos) until platform is selected
3. Subscribed auction houses see the brief and can:
   - **Bid** for the listing (offer reduced commission, premium placement, marketing budget)
   - **Pass** (not their segment/audience)
4. Seller sees competing offers and selects a platform
5. Nuke releases the full package to the selected platform
6. Nuke takes a referral fee / success fee on the sale

**Why this works:**
- Nuke controls the supply (best data = best submissions = best sell-through)
- Auction houses' customer acquisition cost for high-quality listings is significant
- Paying Nuke a fee is cheaper than their current editorial + photography + outreach costs
- The data advantage compounds: more sales data → better valuations → better market timing → better sell-through → more auction houses want in

**Why this is 2027:**
- Need critical mass of TIER 1 packages (target: 100+/month)
- Need proven sell-through rates across 2-3 platforms
- Need auction house relationships established through Phase 2
- Need seller trust built through successful transactions

---

## Build Sequence

### Sprint 1: The Score (Week 1-2)

**Objective:** Replace 5 overlapping scoring systems with one Auction Readiness Score.

Build:
1. **`compute_auction_readiness(p_vehicle_id uuid)`** — New DB function implementing the 6-dimension ARS
   - Returns: composite score, per-dimension scores, tier label, top 5 gaps
   - Reads from: vehicles, vehicle_images (zone coverage), field_evidence, vehicle_observations, vehicle_grades, analysis_signals
   - No external API calls — pure SQL computation
   - Must complete in < 500ms per vehicle

2. **`auction_readiness` table** — Persist computed scores
   - vehicle_id (PK), composite_score, tier, identity_score, photo_score, doc_score, desc_score, market_score, condition_score, top_gaps (jsonb), computed_at
   - Recompute on: new observation, new image, field update

3. **MCP tool: `get_auction_readiness`** — Expose ARS through the connector
   - Input: vehicle_id or VIN
   - Output: full ARS breakdown with coaching prompts for top gaps

### Sprint 2: The Coach (Week 2-3)

**Objective:** Turn ARS gaps into actionable coaching prompts.

Build:
4. **`generate_coaching_plan(p_vehicle_id uuid)`** — DB function
   - Input: vehicle_id
   - Output: ordered array of coaching actions with priority scores
   - Each action: type, target_field, prompt_text, estimated_impact, effort_level

5. **MCP tool: `get_coaching_plan`** — Expose coaching through connector
   - Input: vehicle_id
   - Output: prioritized action list with natural language prompts
   - Claude can walk users through each step conversationally

6. **Photo zone gap detection** — Subroutine of coaching
   - Compares vehicle's classified zones against MVPS + CPS
   - Returns specific missing zones with photography instructions

### Sprint 3: The Packager (Week 3-4)

**Objective:** Generate complete, submission-ready listing packages.

Build:
7. **`generate_listing_package(p_vehicle_id uuid, p_platform text)`** — Edge function
   - Input: vehicle_id, target platform (bat, carsandbids, etc.)
   - Output: complete package JSON matching platform requirements
   - Uses existing `generate-vehicle-description` for narrative
   - Adds: structured fields, photo ordering, valuation, market signals
   - Platform-specific formatting (BaT style vs C&B style vs Hemmings style)

8. **Photo ordering algorithm** — Subroutine of packager
   - Orders photos by zone importance → quality score
   - Generates captions from zone + condition data
   - Selects hero image

9. **MCP tool: `prepare_listing`** — Expose packager through connector
   - Input: vehicle_id, platform
   - Output: complete package ready for submission
   - Claude can present package to user for review/edit

### Sprint 4: The Submitter (Week 4-6)

**Objective:** One-click submission to BaT.

Build:
10. **BaT submission automation** — Edge function or Chrome extension flow
    - Maps package → BaT form fields
    - Handles photo upload (batch, ordered)
    - Tracks submission status

11. **`vehicle_submissions` table** — Track all submissions across platforms
    - vehicle_id, platform, package_snapshot (jsonb), submitted_at, status, platform_response, listing_url, accepted_at, rejected_at, rejection_reason

12. **Submission status tracking** — Poll or webhook for acceptance/rejection
    - Update vehicle record when listing goes live
    - Trigger notification to user

### Sprint 5: Scale & Expand (Week 6+)

13. **Run ARS at scale** — Batch compute for all 296K vehicles
    - Identify the top 1,000 vehicles closest to TIER 1
    - These are the "low-hanging fruit" for the coaching system

14. **Cars & Bids submission** — Second platform
15. **Hemmings / eBay Motors** — Third/fourth platforms
16. **Marketplace API** — For Phase 2-3 B2B integration

---

## Schema Changes Required

### New Table: `auction_readiness`
```sql
CREATE TABLE auction_readiness (
  vehicle_id uuid PRIMARY KEY REFERENCES vehicles(id),
  composite_score smallint NOT NULL DEFAULT 0,  -- 0-100
  tier text NOT NULL DEFAULT 'DISCOVERY_ONLY',  -- AUCTION_READY, NEARLY_READY, NEEDS_WORK, EARLY_STAGE, DISCOVERY_ONLY
  identity_score smallint NOT NULL DEFAULT 0,
  photo_score smallint NOT NULL DEFAULT 0,
  doc_score smallint NOT NULL DEFAULT 0,
  desc_score smallint NOT NULL DEFAULT 0,
  market_score smallint NOT NULL DEFAULT 0,
  condition_score smallint NOT NULL DEFAULT 0,
  top_gaps jsonb NOT NULL DEFAULT '[]',  -- [{dimension, action_type, target, prompt, impact}]
  coaching_plan jsonb,  -- full ordered action list
  photo_zones_present text[] DEFAULT '{}',
  photo_zones_missing text[] DEFAULT '{}',
  mvps_complete boolean DEFAULT false,  -- minimum viable photo set
  computed_at timestamptz DEFAULT now()
);

CREATE INDEX idx_auction_readiness_tier ON auction_readiness(tier);
CREATE INDEX idx_auction_readiness_score ON auction_readiness(composite_score DESC);
```

### New Table: `vehicle_submissions`
```sql
CREATE TABLE vehicle_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id),
  platform text NOT NULL,  -- bat, carsandbids, hemmings, ebay, etc.
  package_snapshot jsonb NOT NULL,  -- full package at time of submission
  ars_at_submission smallint,  -- ARS score when submitted
  submitted_at timestamptz DEFAULT now(),
  submitted_by uuid,  -- user who clicked submit
  status text NOT NULL DEFAULT 'pending',  -- pending, submitted, accepted, rejected, live, sold, withdrawn
  platform_listing_id text,  -- their ID for the listing
  platform_listing_url text,  -- link to live listing
  accepted_at timestamptz,
  rejected_at timestamptz,
  rejection_reason text,
  live_at timestamptz,
  sold_at timestamptz,
  final_price_cents bigint,
  platform_fees_cents bigint,
  nuke_fee_cents bigint,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_vehicle_submissions_vehicle ON vehicle_submissions(vehicle_id);
CREATE INDEX idx_vehicle_submissions_status ON vehicle_submissions(status);
CREATE INDEX idx_vehicle_submissions_platform ON vehicle_submissions(platform);
```

### New Table: `ars_outcome_log`
```sql
CREATE TABLE ars_outcome_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id),
  submission_id uuid REFERENCES vehicle_submissions(id),
  event_type text NOT NULL,  -- accepted, rejected, sold, no_sale, withdrawn
  ars_snapshot jsonb NOT NULL,  -- full ARS state at event time
  platform text NOT NULL,
  outcome_data jsonb,  -- {final_price, time_to_sale, bid_count, rejection_reason}
  computed_insights jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_ars_outcome_platform ON ars_outcome_log(platform);
CREATE INDEX idx_ars_outcome_type ON ars_outcome_log(event_type);
```

### New Table: `ars_tier_transitions`
```sql
CREATE TABLE ars_tier_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id),
  previous_tier text NOT NULL,
  new_tier text NOT NULL,
  previous_score smallint NOT NULL,
  new_score smallint NOT NULL,
  trigger_event text,  -- new_image, new_observation, market_update, staleness, rejection
  dimension_deltas jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_tier_transitions_vehicle ON ars_tier_transitions(vehicle_id);
```

### Modify Table: `auction_readiness` (add staleness columns)
```sql
ALTER TABLE auction_readiness ADD COLUMN is_stale boolean DEFAULT false;
ALTER TABLE auction_readiness ADD COLUMN stale_reason text;
ALTER TABLE auction_readiness ADD COLUMN last_data_event_at timestamptz;
ALTER TABLE auction_readiness ADD COLUMN rejection_penalties jsonb DEFAULT '[]';
```

### New Table: `photo_coverage_requirements`
```sql
-- Reference table defining what zones are needed per platform
CREATE TABLE photo_coverage_requirements (
  platform text NOT NULL,  -- 'universal', 'bat', 'carsandbids', etc.
  zone text NOT NULL,
  requirement text NOT NULL DEFAULT 'recommended',  -- required, recommended, optional
  points smallint NOT NULL DEFAULT 0,
  coaching_prompt text,
  sort_position smallint,  -- ordering in the listing
  PRIMARY KEY (platform, zone)
);
```

---

## Edge Functions to Build/Modify

### New Functions (3)

| Function | Purpose | Sprint |
|----------|---------|--------|
| `compute-auction-readiness` | Compute ARS for a vehicle, persist to `auction_readiness` | 1 |
| `generate-listing-package` | Generate platform-specific submission package | 3 |
| `submit-to-platform` | Handle actual submission to external auction platforms | 4 |

### Functions to Modify (4)

| Function | Modification | Sprint |
|----------|-------------|--------|
| `nuke-mcp-connector` | Add tools: `get_auction_readiness`, `get_coaching_plan`, `prepare_listing` | 1-3 |
| `generate-vehicle-description` | Enhance with citation chains and platform-specific formatting | 3 |
| `analysis-engine-coordinator` | Trigger ARS recompute when analysis signals update | 2 |
| `calculate-profile-completeness` | Align with ARS dimensions (or deprecate in favor of ARS) | 1 |

### Functions to Retire (2)

| Function | Replacement |
|----------|------------|
| `calculate-profile-completeness` | Subsumed by ARS identity + doc dimensions |
| The 5 overlapping scoring functions | ARS is the single source of truth |

---

## MCP Connector Tools (3 new)

### `get_auction_readiness`
```yaml
input: { vehicle_id: uuid } OR { vin: string }
output:
  composite_score: 0-100
  tier: AUCTION_READY | NEARLY_READY | NEEDS_WORK | EARLY_STAGE | DISCOVERY_ONLY
  dimensions:
    identity: { score: 0-100, gaps: [...] }
    photos: { score: 0-100, zones_present: [...], zones_missing: [...], gaps: [...] }
    documentation: { score: 0-100, gaps: [...] }
    description: { score: 0-100, gaps: [...] }
    market: { score: 0-100, gaps: [...] }
    condition: { score: 0-100, gaps: [...] }
  coaching_summary: "Your 1977 Blazer scores 72 (Nearly Ready). Upload undercarriage photos (+8), list known flaws (+6), and upload service receipts (+5) to reach Auction Ready."
```

### `get_coaching_plan`
```yaml
input: { vehicle_id: uuid }
output:
  current_score: 72
  target_score: 90
  actions:
    - priority: 1
      type: PHOTO_UPLOAD
      zone: ext_undercarriage
      impact: +8
      effort: "medium"
      prompt: "Get your Blazer on a lift or jack and photograph the frame rails..."
    - priority: 2
      type: NARRATIVE_WRITE
      field: known_flaws
      impact: +6
      effort: "easy"
      prompt: "List any imperfections honestly. Even minor items like 'small scratch on...' ..."
    - ...
  estimated_actions_to_tier1: 3
```

### `prepare_listing`
```yaml
input: { vehicle_id: uuid, platform: "bat" }
output:
  ready: true
  package: { ...full package as defined above... }
  warnings: []  # any issues to flag before submission
  platform_specific_notes: "BaT typically lists trucks/SUVs starting Tuesday-Wednesday for peak weekend bidding."
```

---

## Continuous Resolution Layer

The ARS is not a snapshot. It's a living score that self-corrects, learns from outcomes, and degrades when data goes stale. Without this layer, the score lies within 30 days.

### Trigger-Based Recomputation

ARS recomputes automatically on data events. No cron. No schedule. Event-driven.

```
TRIGGER: new vehicle_images row inserted
  → recompute photo_score dimension only
  → update composite_score
  → if tier changed: log tier_transition event

TRIGGER: new vehicle_observations row inserted
  → recompute desc_score + condition_score dimensions
  → update composite_score
  → if tier changed: log tier_transition event

TRIGGER: field_evidence row inserted/updated
  → recompute identity_score + doc_score dimensions
  → update composite_score

TRIGGER: analysis_signals row inserted (from any widget)
  → recompute market_score dimension
  → update composite_score

TRIGGER: vehicle_submissions status changed to 'rejected'
  → parse rejection_reason
  → inject rejection-specific gap into coaching_plan
  → recompute (rejection may reveal new dimension weaknesses)

TRIGGER: vehicle_submissions status changed to 'sold'
  → record outcome: {platform, final_price, ars_at_submission, time_to_sale}
  → feed into outcome_learning pipeline
```

Implementation: Postgres trigger functions on the relevant tables that call `recompute_ars_dimension(vehicle_id, dimension)`. Lightweight — each dimension recompute is a single query, not a full 6-dimension rebuild.

```sql
-- Partial recompute: only recalculate the dimension that changed
CREATE OR REPLACE FUNCTION recompute_ars_dimension(
  p_vehicle_id uuid,
  p_dimension text  -- 'photos', 'identity', 'documentation', 'description', 'market', 'condition'
) RETURNS void AS $$
DECLARE
  v_new_score smallint;
  v_weights jsonb := '{"identity":0.10,"photos":0.25,"documentation":0.20,"description":0.15,"market":0.20,"condition":0.10}';
  v_current auction_readiness%ROWTYPE;
BEGIN
  -- Recompute only the changed dimension
  -- ... (dimension-specific scoring logic)

  -- Update the single dimension + recompute composite
  UPDATE auction_readiness SET
    -- set the changed dimension score
    composite_score = (
      identity_score * 0.10 + photo_score * 0.25 + doc_score * 0.20 +
      desc_score * 0.15 + market_score * 0.20 + condition_score * 0.10
    )::smallint,
    tier = CASE
      WHEN composite_score >= 90 THEN 'AUCTION_READY'
      WHEN composite_score >= 75 THEN 'NEARLY_READY'
      WHEN composite_score >= 55 THEN 'NEEDS_WORK'
      WHEN composite_score >= 35 THEN 'EARLY_STAGE'
      ELSE 'DISCOVERY_ONLY'
    END,
    computed_at = now()
  WHERE vehicle_id = p_vehicle_id;
END;
$$ LANGUAGE plpgsql;
```

### Staleness & Decay

Data has a half-life. A score computed 6 months ago with no new data is lying.

```yaml
decay_rules:
  market_score:
    # Comps decay
    - comps_age_months > 12: multiply market_score by 0.5
    - comps_age_months > 6: multiply market_score by 0.8
    - comps_count < 3: cap market_score at 50

    # Seasonal decay
    - if computed_at is > 3 months old: force seasonal recompute
    - seasonal window passed: reduce market_score by 10

  photo_score:
    # Photo freshness (for user-owned vehicles, not auction archives)
    - if vehicle source is 'user-submission' AND newest_photo > 6 months: warning flag
    - if vehicle source is 'user-submission' AND newest_photo > 12 months: reduce photo_score by 15

  condition_score:
    # Condition claims decay without verification
    - if condition_rating set but no YONO verification: cap condition_score at 60
    - if YONO analysis > 6 months old on user vehicle: suggest re-verification

  composite:
    # Overall staleness
    - if computed_at > 30 days AND no new data events: mark as STALE
    - STALE vehicles excluded from TIER 1 until refreshed
    - STALE flag visible in coaching plan: "Your score was computed 45 days ago.
      Market conditions may have changed. [Refresh]"
```

Implementation: A `staleness_check` column on `auction_readiness`:

```sql
ALTER TABLE auction_readiness ADD COLUMN is_stale boolean DEFAULT false;
ALTER TABLE auction_readiness ADD COLUMN stale_reason text;
ALTER TABLE auction_readiness ADD COLUMN last_data_event_at timestamptz;
```

A lightweight daily job (piggyback on existing analysis-engine-coordinator) scans for vehicles where `computed_at < now() - interval '30 days'` AND `last_data_event_at < computed_at`. Marks them stale. Does NOT recompute — that only happens on data events. Staleness is a flag, not a trigger.

### Outcome Learning

Every submission outcome calibrates the scoring weights.

```
FEEDBACK LOOP:

submission outcome recorded
    ↓
compare: ARS dimensions at submission time vs actual result
    ↓
patterns:
  - "Vehicles with photo_score > 85 have 2.3x acceptance rate"
  - "Vehicles submitted with known_flaws populated sell 12% higher"
  - "doc_score < 50 correlates with 40% rejection rate"
  - "market_score > 80 + seasonal favorable = 94% sell-through"
    ↓
weight adjustment proposals (logged, not auto-applied)
    ↓
human review + approval → update dimension weights
```

**Weight adjustment is NOT automatic.** Outcomes are logged to `ars_outcome_log`:

```sql
CREATE TABLE ars_outcome_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id),
  submission_id uuid REFERENCES vehicle_submissions(id),
  event_type text NOT NULL,  -- 'accepted', 'rejected', 'sold', 'no_sale', 'withdrawn'
  ars_snapshot jsonb NOT NULL,  -- full ARS state at time of event
  platform text NOT NULL,
  outcome_data jsonb,  -- {final_price, time_to_sale, bid_count, rejection_reason, etc.}
  computed_insights jsonb,  -- {which dimensions predicted outcome, which didn't}
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_ars_outcome_platform ON ars_outcome_log(platform);
CREATE INDEX idx_ars_outcome_type ON ars_outcome_log(event_type);
```

After 50+ outcomes, we can run correlation analysis:

```sql
-- Which ARS dimensions best predict acceptance?
SELECT
  event_type,
  AVG((ars_snapshot->>'photo_score')::int) as avg_photo,
  AVG((ars_snapshot->>'doc_score')::int) as avg_doc,
  AVG((ars_snapshot->>'desc_score')::int) as avg_desc,
  AVG((ars_snapshot->>'market_score')::int) as avg_market,
  COUNT(*) as n
FROM ars_outcome_log
GROUP BY event_type;

-- Do transparent listings (flaws disclosed) sell higher?
SELECT
  CASE WHEN (ars_snapshot->>'desc_score')::int > 70 THEN 'transparent' ELSE 'opaque' END as transparency,
  AVG((outcome_data->>'final_price')::int) as avg_price,
  AVG((outcome_data->>'bid_count')::int) as avg_bids,
  COUNT(*) as n
FROM ars_outcome_log
WHERE event_type = 'sold'
GROUP BY 1;
```

### Rejection Recovery

When a submission is rejected, the system doesn't just log it — it creates a targeted recovery plan.

```
BaT rejects with reason: "Insufficient detail photos — need undercarriage and engine bay close-ups"
    ↓
Parse rejection → map to ARS dimensions:
  - "undercarriage" → photo_score gap: ext_undercarriage missing
  - "engine bay close-ups" → photo_score gap: need multiple mech_engine_bay angles
    ↓
Generate recovery coaching plan:
  Priority 1: "BaT specifically requested undercarriage photos. Get the vehicle on a lift..."
  Priority 2: "BaT wants engine bay detail shots. In addition to the overview, photograph..."
    ↓
Update ARS with rejection_penalty:
  - photo_score reduced by 10 (platform told us our photos aren't sufficient)
  - recovery actions weighted 2x in coaching priority (platform-specific feedback > generic)
    ↓
When user completes recovery actions:
  - photo_score recalculated (new images trigger recompute)
  - rejection_penalty decays after new photos verified
  - "Ready to resubmit" flag when all rejection gaps closed
```

### Tier Transition Events

Every tier change is logged for analytics and user notification:

```sql
CREATE TABLE ars_tier_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id),
  previous_tier text NOT NULL,
  new_tier text NOT NULL,
  previous_score smallint NOT NULL,
  new_score smallint NOT NULL,
  trigger_event text,  -- 'new_image', 'new_observation', 'market_update', 'staleness', 'rejection'
  dimension_deltas jsonb,  -- {photo_score: +8, doc_score: +5}
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_tier_transitions_vehicle ON ars_tier_transitions(vehicle_id);
```

This lets us answer:
- "How long does it take a vehicle to go from TIER 4 to TIER 1?" (coaching effectiveness)
- "Which coaching actions produce the most tier movement?" (optimize the coaching engine)
- "Are vehicles falling back from TIER 1 due to staleness?" (data freshness problem)
- "What's the typical trajectory for a BaT vehicle vs a user-submitted vehicle?" (segment analysis)

### Self-Healing Data Quality

The ARS acts as a continuous data quality monitor. When it computes, it discovers issues:

```
During photo_score computation:
  → Finds 3 images classified as ext_front_driver but 2 are duplicates
  → Flags: "2 duplicate images in ext_front_driver zone — dedup recommended"
  → Coaching: "You have 3 front 3/4 photos but 2 appear identical. Keep the best one."

During identity_score computation:
  → VIN decodes to 1978 but vehicles.year says 1977
  → Flags: "Year mismatch: VIN indicates 1978, record says 1977"
  → Coaching: "Your VIN decodes to a 1978 model year. Can you verify? Check the VIN plate..."

During condition_score computation:
  → YONO detected damage_flag on rear quarter but known_flaws doesn't mention it
  → Flags: "Undisclosed condition issue detected in photos"
  → Coaching: "Our image analysis detected possible damage on the rear quarter panel.
    If this is accurate, adding it to known_flaws improves buyer trust."

During market_score computation:
  → Nuke estimate is $35K but asking price in vehicle_listings is $65K
  → Flags: "Asking price 86% above market estimate"
  → Coaching: "Your asking price of $65K is significantly above comparable sales ($28K-$42K range).
    Consider adjusting to improve sell-through probability."
```

These aren't just flags — they're actionable coaching items that feed back into the coaching plan with specific priorities.

---

## Critical Constraints

1. **No new cron jobs** — ARS recomputation triggers on data changes (new observation, new image), not on schedule. Use existing `analysis-engine-coordinator` orchestration.

2. **ARS computation must be fast** — < 500ms per vehicle. This means it must be a SQL function, not an edge function with external API calls. Market dimension can use cached `analysis_signals` values.

3. **Coaching prompts must be specific** — Not "add more photos" but "photograph the undercarriage from the driver side, focusing on the frame rail behind the front wheel." Generic advice is worthless.

4. **Package generation is idempotent** — Same vehicle + same data = same package. No randomness in description generation (use temperature=0, seed if available).

5. **Submission tracking is append-only** — Never delete a submission record. If rejected, the record stays with the rejection reason. This builds our data on what auction houses accept/reject and why.

6. **Privacy-first** — The marketplace layer (Phase 3) never exposes vehicle details to platforms until the seller explicitly authorizes it. Anonymous briefs only.

7. **Respect the pipeline registry** — `compute-auction-readiness` READS from vehicles/images/evidence. It does NOT write to vehicles.* fields. It writes ONLY to `auction_readiness`. Register it in `pipeline_registry`.

---

## Success Metrics

| Metric | Target | Timeframe |
|--------|--------|-----------|
| Vehicles with ARS computed | 296K (100%) | Sprint 1 |
| Vehicles in TIER 2+ | 500 | Sprint 2 (after coaching drives uploads) |
| Vehicles in TIER 1 | 50 | Sprint 3 |
| First BaT submission via Nuke | 1 | Sprint 4 |
| BaT submissions/month | 10 | Month 3 |
| Acceptance rate | > 60% | Month 3 |
| Platform expansion | 3 platforms | Month 6 |
| Revenue from referral fees | $5K/month | Month 6 |
| Auction houses on marketplace API | 3 | Month 12 |

---

## The Flywheel

```
Owner contributes data → ARS increases → Vehicle reaches TIER 1
    → Package generated → Submitted to auction → Sale completes
    → Sale data enriches comps → Better valuations for similar vehicles
    → Better market timing recommendations → Higher sell-through
    → More auction houses want Nuke-curated listings
    → More sellers see value in contributing data
    → Repeat
```

The key insight: **every successful sale makes the entire system more valuable.** The comp database grows. The valuation confidence increases. The market timing models improve. The coaching system gets smarter about what makes a listing succeed. This is the network effect that makes Nuke defensible.

---

## Appendix: Sprint 1+2 Implementation Results (2026-03-20)

### What Was Built
- `auction_readiness` table (persisted scores)
- `ars_tier_transitions` table (audit log)
- `photo_coverage_requirements` table (20 zones seeded for `universal` platform)
- `compute_auction_readiness()` — 6-dimension plpgsql scorer, ~65ms/vehicle
- `persist_auction_readiness()` — upsert wrapper with tier transition logging
- `recompute_ars_dimension()` — trigger-friendly recompute
- 3 triggers: `trg_ars_on_image_insert`, `trg_ars_on_observation_insert`, `trg_ars_on_evidence_insert`
- Index: `idx_vehicle_images_vehicle_zone(vehicle_id, vehicle_zone)` on 33M rows
- 3 MCP tools: `get_auction_readiness`, `get_coaching_plan`, `prepare_listing`
- Pipeline registry entries for governed writes

### First Batch Results (2,142 vehicles, data_quality_score >= 95)

| Tier | Count | Avg Score | Avg Identity | Avg Photo | Avg Doc | Avg Desc | Avg Market | Avg Condition |
|------|-------|-----------|-------------|-----------|---------|----------|------------|---------------|
| NEEDS_WORK (55-74) | 3 | 65 | 55 | 82 | 28 | 92 | 63 | 65 |
| EARLY_STAGE (35-54) | 279 | 42 | 53 | 10 | 27 | 82 | 60 | 39 |
| DISCOVERY_ONLY (0-34) | 1,860 | 22 | 50 | 5 | 6 | 28 | 50 | 6 |

**Zero vehicles in TIER 1 (AUCTION_READY) or TIER 2 (NEARLY_READY).** This confirms the strategy prediction that ~99% of vehicles would be TIER 4-5.

### Key Bottlenecks Identified
1. **Photo zone classification** — Most BaT vehicles have 50-200+ photos but `vehicle_zone` is NULL for the vast majority. Only 292K of 33M images have zone data. Running YONO zone classifier at scale would immediately lift photo scores.
2. **Documentation depth** — avg 6-28 across tiers. Only 139 vehicle_documents in the entire DB. First-party owner data is the unlock.
3. **Condition confidence** — avg 6-39. Requires YONO vision analysis (ai_processing_status = 'completed') which is globally paused.
4. **Description** — highest dimension for BaT vehicles (avg 82 in EARLY_STAGE) because BaT listings have rich text. But 87% of all vehicles have no description at all.

### Top 3 Vehicles
1. **1991 Mercedes-Benz 300SL** — Score 67 (NEEDS_WORK), 15 zones covered, photo 88
2. **2001 Honda S2000** — Score 65 (NEEDS_WORK), 12 zones, photo 80
3. **1997 Mercedes-Benz G320** — Score 62 (NEEDS_WORK), 11 zones, photo 79

### Path to TIER 2 (75+)
For the top-3 vehicles to reach NEARLY_READY:
- Fill documentation gaps: title_status, ownership history, documents (+20-30 pts in doc dimension)
- Complete MVPS photo zones: detail_odometer, detail_vin are the most common missing required zones
- Run YONO condition analysis on existing photos (+15-30 pts in condition dimension)
- These 3 actions alone could push top vehicles from 65 → 80+
