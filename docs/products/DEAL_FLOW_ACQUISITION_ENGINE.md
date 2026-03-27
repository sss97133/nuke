# Deal Flow Acquisition Engine

**CANONICAL DOC** -- Read before any work on: deal detection, buy triggers, watchlists, acquisition plans, build cost estimation, vendor matching, or the "click yes" user experience.

**Created:** 2026-03-27
**Status:** Strategy specification -- nothing built yet
**Trigger:** A 1971 C10 Fleetside short bed appeared on Las Vegas Craigslist for $10K OBO (no engine, no rust, matching numbers, clean title) -- and the system that should have surfaced it didn't.

---

## The Thesis

Nuke holds 829,499 vehicles across 90+ sources. 707 Craigslist feeds poll every 15 minutes. 33,828 Facebook Marketplace vehicles. 163K Mecum lots. 163K BaT listings. 613,907 vehicles have nuke_estimates. 324,062 have auction readiness scores. 34.6 million images.

All of this data flows in, gets stored, and sits there.

**The thesis: the moment a vehicle appears on any marketplace that matches a buyer's criteria, Nuke should present a complete acquisition package -- comps, restoration cost estimate, build timeline, vendor options, total investment vs. projected value -- and the buyer clicks one button.**

This is the stock market limit order applied to collector vehicles. A buyer defines their criteria once. The system monitors continuously. When a match fires, it doesn't send a bare link -- it sends a deal memo with enough confidence that the buyer acts immediately.

The deal is only a deal if you have the build path. A rust-free C10 shell for $10K is just a Craigslist listing to 99% of people. To someone with a restoration cost model, vendor network, and comp database, it's a $15-30K profit opportunity with a 6-month timeline. **Nuke is the system that turns listings into opportunities.**

---

## The Triggering Example

**Listing:** 1971 Chevrolet C10 Fleetside Short Bed, Las Vegas, $10,000 OBO
- No engine, no transmission (that's why it's $10K)
- No rust, no cancer on any panels
- Matching numbers throughout, all original
- Clean title, 17 photos

**What Nuke knows about 1971 C10s (from our database, right now):**
- 6,705 C10s in system, 3,116 with sale prices
- Average C10 sale price: $37,147
- 1971 C10 sale range: $14,000 (BaT, stock short bed) to $214,500 (show truck)
- 1971 C10 Custom Pickups (restomods): $110K-$200K at Barrett-Jackson and Mecum
- C10 short beds specifically: $2K (project) to $90K (BaT show-winner)
- Comparable 1971 C10 Short Bed sold $26,400 at Barrett-Jackson
- Comparable 1971 C10 Short Bed sold $14,000 on BaT (stock condition)

**What the system should have done:**
1. CL Las Vegas feed picks up listing (it does this already -- 2 Vegas feeds active, polling every 15 min)
2. `extract-craigslist` parses structured data (it does this already)
3. Vehicle matches a defined watchlist criteria: "C10 short bed, <$20K, owner sale, clean title"
4. System generates deal package:
   - **Comp analysis:** 30+ C10 short beds in our database with sale prices, segmented by condition
   - **Cost estimate:** No engine/trans = $4-8K (crate 350 + rebuilt 700R4). Paint (good body, desert truck) = $5-12K. Interior = $2-5K. Brakes/suspension/electrical = $3-6K. Total: $24-41K all-in.
   - **Value projection:** Stock restoration = $26-40K finished value. Restomod = $60-140K. Build quality determines which band.
   - **Timeline:** 4-8 months depending on scope and vendor availability
   - **Vendors:** Shops in Las Vegas metro capable of this work (from our `suppliers` table + discovery)
5. Package lands in Telegram/SMS/push with "Review Deal" link
6. User opens deal page, sees everything above, clicks "Acquire" or "Pass"

**What actually happened:** The listing sat on Craigslist for 4 days. Skylar found it manually.

---

## What Exists Today (Inventory)

### Ingestion Layer (WORKING)

| Component | Status | Data |
|-----------|--------|------|
| Craigslist feed polling | Active, 707 feeds, every 15 min | 8,376 CL vehicles in system |
| Craigslist extraction | `extract-craigslist` deployed | Parses JSON-LD structured data |
| CL squarebody discovery | `discover-cl-squarebodies` deployed | 84 search terms, ~90 regions |
| CL queue processor | `process-cl-queue` deployed | **STALLED -- last activity Feb 25, 2026** |
| CL listing queue | 288 items | 137 failed, 124 stuck processing, 27 pending |
| FB Marketplace | 33,828 vehicles extracted | National sweep complete, logged-out GraphQL |
| BaT | 163,362 vehicles | 84% have descriptions |
| Mecum | 163,044 vehicles | Algolia discovery, 69K extracted events |
| Barrett-Jackson | 80,785 vehicles | Strapi API, 29K extracted events |
| Listing page snapshots | 475,671 archived | 436,915 successful (92% rate) |

**Gap:** Feed polling works. Extraction works. But the CL queue processor is stalled (no items processed since Feb 25). Even when it was running, extracted vehicles just land in the database with no alerting.

### Matching Layer (SCHEMA EXISTS, NOT DEPLOYED)

| Component | Status | Location |
|-----------|--------|----------|
| `vehicle_watchlist` table | Migration written, **table does not exist** | `20251127000001_vehicle_watchlist_system.sql` |
| `watchlist_matches` table | Migration written, **table does not exist** | Same migration |
| `check_watchlist_match()` SQL function | Written, **cannot run** (no backing table) | Same migration |
| `process_new_bat_listing()` SQL function | Written, **cannot run** | Same migration |
| `auto_buy_executions` table | Migration written, **table does not exist** | `20251127000002_auto_buy_execution_system.sql` |
| `check_auto_buy_trigger()` SQL function | Written, **cannot run** | Same migration |
| `price_monitoring` table | Migration written, **table does not exist** | Same migration |
| `marketplace_deal_alerts` table | Migration written, **table does not exist** | `20251108_marketplace_deal_alerts.sql` |
| `monitor-price-drops` edge function | Deployed | Calls RPCs that don't exist yet |
| `process-alert-email` edge function | Deployed | Universal inbound email handler (11 sources) |
| `gmail-alert-poller` edge function | Deployed | Polls Gmail for alert emails |

**Gap:** The entire watchlist/matching/auto-buy system was designed in November 2025. The SQL is written. The edge functions are deployed. But the core tables were never created, so none of it runs. This is 4 months of dormant infrastructure.

### Comp Analysis Layer (PARTIAL)

| Component | Status | Coverage |
|-----------|--------|----------|
| `nuke_estimates` | 613,907 vehicles | 74% of all vehicles have an estimate |
| ARS scoring | 324,062 vehicles scored | Top score: 77/100 (TIER_2_COMPETITIVE) |
| Analysis widgets | 14 widgets defined | Near-zero coverage (3 vehicles computed) |
| C10 comp data | 6,705 vehicles, 3,116 with sale prices | Strong -- enough for statistical analysis |
| C10 short bed comps | 30+ with sale prices | $2K-$90K range, multiple sources |
| Sale price by source | BaT, Barrett-Jackson, Mecum, CL, FB | Cross-platform pricing exists |

**Gap:** Raw comp data exists and is strong. But there's no function that takes a vehicle description ("1971 C10 short bed, no engine, no rust") and returns a condition-adjusted valuation range. The nuke_estimates are blanket estimates, not aware of "this one has no engine" or "this one is rust-free." The comp query needs to be contextual.

### Cost Estimation Layer (SEED DATA ONLY)

| Component | Status | Data |
|-----------|--------|------|
| `stage_transition_labor_map` | 15 transitions seeded | raw->disassembled (8-24hr), stripped->fabricated (4-12hr), etc. |
| `labor_estimates` table | **Does not exist** | Migration written, never applied |
| `work_sessions` table | Exists, 1 row | Photo-based work session detection built |
| `detect_work_sessions()` SQL function | Exists | Groups images by timestamp into sessions |
| `estimate_labor_from_delta()` SQL function | Exists | Maps stage transitions to hours/cost |
| YONO `fabrication_stage` column | Added to vehicle_images | 10 stages (raw through complete) |
| YONO training queue | Exists | Active learning for stage classification |

**Gap:** The labor estimation pipeline has its skeleton -- 15 restoration stages with hour/cost ranges, a function to detect work sessions from photos, a function to estimate labor from stage transitions. But `labor_estimates` was never created so nothing can be computed or stored. The seed data covers body/paint stages well but doesn't cover powertrain, interior, electrical, or chassis work -- which is exactly what a C10 shell with no engine needs.

### Build Planning Layer (PARTIAL)

| Component | Status | Data |
|-----------|--------|------|
| `vehicle_builds` table | Exists, 4 rows | Build project tracking |
| `build_phases` table | **Does not exist** | Never created |
| `build_line_items` table | **Does not exist** | Never created |
| `build_documents` table | **Does not exist** | Never created |
| `build_images` table | **Does not exist** | Never created |
| `build_benchmarks` table | **Does not exist** | Never created |
| `receipts` table | Exists, 242 rows | Cost tracking |
| `spend_attributions` table | **Does not exist** | Never created |
| VehicleBuildManager.tsx | Exists | Frontend component, design system compliant |
| Build Management spec | `docs/development/BUILD_MANAGEMENT_IMPLEMENTATION.md` | Full spec with privacy controls |

**Gap:** `vehicle_builds` exists with 4 rows. `receipts` has 242 rows. The frontend component exists. But the sub-tables that make a build plan actionable (phases, line items, documents, benchmarks) were never created. There's no way to break a build into milestones with costs, timelines, and deliverables.

### Vendor Network Layer (MINIMAL)

| Component | Status | Data |
|-----------|--------|------|
| `suppliers` table | Exists, 3 rows | Vendor registry |
| `organizations` table | Exists | Relationship types include fabricator, painter, upholstery, transport, inspector |
| `supplier_vehicle_readiness` view | Exists | Joins orgs + vehicles + ARS |
| Telegram restoration bot | Deployed | Photo intake from shops |
| `fb_saved_items.is_supplier_listing` | Exists | Flag for supplier listings |

**Gap:** 3 suppliers registered. The table structure supports vendor types (fabricator, painter, upholstery, transport, inspector) but there's no vendor discovery, no regional search, no quality scoring, no availability tracking. For Las Vegas specifically, we have zero vendor data.

### Notification Layer (PLUMBING EXISTS)

| Component | Status | Data |
|-----------|--------|------|
| `notification_events` table | Exists, 121 rows | System event log |
| `user_notifications` table | Exists, 21 rows | Notifications sent |
| `notification_channels` table | **Does not exist** | User channel preferences |
| `user_subscriptions` table | **Does not exist** | What users subscribe to |
| `create-notification` edge function | Deployed | Simple notification creator |
| Telegram bot | Active | Can send messages |
| `send-inquiry-notification` edge function | Deployed | Vehicle inquiry notifications |

**Gap:** Notification tables exist but the preference/subscription layer doesn't. 121 events, 21 notifications ever sent. The Telegram bot can push messages but there's no trigger that says "new vehicle matched your criteria -> send Telegram." The wiring between match and notify doesn't exist.

---

## Dimensional Model

Following the ARS pattern (6 dimensions, 0-100 each), the Deal Flow Acquisition Engine scores deals across 7 dimensions:

### 1. Match Confidence (0-100)
How well does this listing match the buyer's criteria?
- Year range match (20 pts)
- Make/model match (25 pts)
- Price within budget (20 pts)
- Body style match (15 pts)
- Condition/title match (10 pts)
- Location proximity (10 pts)

*Existing infrastructure:* `check_watchlist_match()` already implements a 0-100 scoring with year (30pts), make (30pts), model (20pts), price (20pts). Needs body style and location dimensions added.

### 2. Comp Strength (0-100)
How confident are we in the valuation?
- Number of comparable sales (25 pts) -- more = better
- Recency of comps (25 pts) -- 2026 sales worth more than 2020
- Source diversity (20 pts) -- BaT + Barrett-Jackson + CL > just one source
- Condition similarity (15 pts) -- project comps vs. show truck comps
- Price convergence (15 pts) -- tight spread = high confidence

*Existing infrastructure:* 6,705 C10s with 3,116 sale prices across BaT, Barrett-Jackson, Mecum, CL, FB. The data exists. The function to query it condition-aware does not.

### 3. Cost Clarity (0-100)
How well can we estimate the build cost?
- Powertrain needs identified (20 pts)
- Body/paint needs identified (20 pts)
- Interior needs identified (15 pts)
- Chassis/suspension needs identified (15 pts)
- Regional labor rates available (15 pts)
- Parts pricing available (15 pts)

*Existing infrastructure:* `stage_transition_labor_map` covers body/paint stages (15 transitions). Powertrain, interior, electrical stages not seeded. Regional rate data doesn't exist.

### 4. Vendor Coverage (0-100)
Do we know who can do the work?
- Shops in buyer's metro capable of this build (30 pts)
- Quality-rated vendors (20 pts)
- Availability data (20 pts)
- Price quotes or rate history (15 pts)
- Past work on this make/model (15 pts)

*Existing infrastructure:* 3 suppliers in the database. Zero in Las Vegas. Zero with quality scores or availability data.

### 5. Timeline Feasibility (0-100)
Can we project when the build would be complete?
- Scope of work defined (25 pts)
- Vendor capacity known (25 pts)
- Parts lead times estimated (25 pts)
- Milestone dependencies mapped (25 pts)

*Existing infrastructure:* `stage_transition_labor_map` has hour ranges per stage. No parts lead time data. No vendor capacity data. No dependency mapping.

### 6. ROI Projection (0-100)
How confident is the profit/value analysis?
- Purchase price known (20 pts) -- listing has asking price
- Build cost estimated (20 pts) -- from dimension 3
- Finished value estimated (20 pts) -- from dimension 2 (comp strength)
- Holding costs estimated (15 pts) -- storage, insurance, interest
- Risk factors quantified (15 pts) -- hidden rust, title issues, parts availability
- Sensitivity analysis (10 pts) -- best/worst/expected case

*Existing infrastructure:* Purchase price always known from listing. Build cost depends on dimension 3. Finished value depends on dimension 2. Holding costs, risk quantification, sensitivity analysis: nothing exists.

### 7. Urgency Signal (0-100)
How fast does the buyer need to act?
- Days on market (25 pts) -- fresh listing = high urgency
- Price vs. market (25 pts) -- below comps = will go fast
- Seasonal demand (15 pts) -- spring/summer = truck season
- Competition signals (15 pts) -- views, saves, inquiries if available
- Seller motivation (10 pts) -- "OBO", "must sell", price drops
- Location scarcity (10 pts) -- rare spec in buyer's region

*Existing infrastructure:* Days on market computable from listing date. Price vs. market computable from comps. `widget-seasonal-pricing` exists (0 vehicles computed). Seller motivation detectable from description text. Scarcity queryable from our 6,705 C10s by region.

---

## The 1971 C10 Through This Model

If the system were running today, this listing would score approximately:

| Dimension | Score | Reasoning |
|-----------|-------|-----------|
| Match Confidence | ~85 | Year, make, model, price all within hypothetical criteria |
| Comp Strength | ~75 | 30+ short bed comps with prices across 4 sources. Missing: condition-segmented comps |
| Cost Clarity | ~30 | We know it needs engine/trans. Body/paint assessable from photos. No regional labor rates, no parts pricing database |
| Vendor Coverage | ~5 | 0 vendors in Las Vegas in our system |
| Timeline Feasibility | ~15 | Hour ranges exist for body stages. No powertrain/interior timelines, no vendor capacity |
| ROI Projection | ~40 | Purchase price known ($10K). Comps exist ($26K-$90K short beds). Build cost is the gap |
| Urgency Signal | ~70 | 4 days on market, well below comps, spring approaching, OBO signals seller flexibility |

**Composite: ~46/100** -- enough to flag the deal but not enough for the "click yes" experience.

The bottleneck is dimensions 3-5 (cost, vendors, timeline). That's the build planning layer that doesn't exist yet.

---

## Product Architecture

### Six Products, Layered

Each layer depends on the one below it. Build bottom-up.

```
Layer 6: ACQUISITION UI ("click yes")
    Depends on: all layers below feeding into single deal page

Layer 5: BUILD PLANNER (timeline, milestones, payment schedule)
    Depends on: cost model + vendor network

Layer 4: VENDOR NETWORK (who does the work, where, for how much)
    Depends on: cost model (what work is needed)

Layer 3: COST MODEL (what does this build cost)
    Depends on: comp analysis (what's it worth) + listing data (what's missing)

Layer 2: COMP ANALYSIS (what's this vehicle worth as-is and finished)
    Depends on: vehicle data (we have this)

Layer 1: DEAL DETECTION (find matches, alert the buyer)
    Depends on: ingestion (we have this) + user preferences (we don't)
```

### Layer 1 is the MVP

Layer 1 alone would have caught the C10. Everything above Layer 1 makes the deal package richer, but Layer 1 is the thing that says "hey, look at this."

Today: listings flow in silently. With Layer 1: listings that match your criteria hit your phone.

---

## Phased Execution

### Phase 0: Unblock the Pipeline (Week 1)

Before building anything new, fix what's broken:

**P0-A: Fix the CL queue processor**
- `craigslist_listing_queue` has 124 items stuck in `processing` since Feb 25
- 27 pending items never picked up
- Diagnose why `process-cl-queue` stalled (likely a deployment issue or error cascade)
- Get it draining again
- Verify: new CL listings flow from feed poll -> queue -> vehicle record

**P0-B: Verify Las Vegas coverage**
- 2 Vegas CL feeds confirmed active
- Run a manual test: post a fake-style search on `lasvegas.craigslist.org/search/cta?min_auto_year=1960&max_auto_year=1999` and confirm the feed picks it up
- Verify `extract-craigslist` handles the listing format correctly

**P0-C: Ingest the triggering listing**
- Extract `https://lasvegas.craigslist.org/cto/d/las-vegas-chevrolet-c10-short-bed/7923085831.html`
- Create vehicle record
- This becomes the test case for every subsequent layer

**Exit criteria:** CL queue draining, Vegas covered, triggering C10 in database.

### Phase 1: Deal Detection MVP (Weeks 2-3)

**P1-A: Deploy watchlist tables**
- Apply migration `20251127000001_vehicle_watchlist_system.sql`
- Apply migration `20251127000002_auto_buy_execution_system.sql`
- Apply migration `20251108_marketplace_deal_alerts.sql`
- Verify: `vehicle_watchlist`, `watchlist_matches`, `auto_buy_executions`, `price_monitoring`, `marketplace_deal_alerts` all exist
- Verify: `check_watchlist_match()`, `check_auto_buy_trigger()`, `execute_auto_buy()` all callable

**P1-B: Create first watchlist**
- Skylar's criteria: C10/K10/C20/K20, 1967-1987, <$25K, clean title, owner sale
- Insert into `vehicle_watchlist`
- Test: manually call `check_watchlist_match()` against existing C10 vehicles in database
- Verify: matches are scored correctly (year, make, model, price matching)

**P1-C: Wire ingestion to matching**
- After `process-cl-queue` creates a vehicle, call `check_watchlist_match(vehicle_id)`
- After `poll-listing-feeds` creates an import_queue item, same
- After FB Marketplace ingestion, same
- On match (score >= 50): create `watchlist_matches` record

**P1-D: Wire matching to notification**
- On new `watchlist_matches` record: fire Telegram notification
- Message format: year/make/model, price, location, match score, listing URL, top 3 comps from our database
- Use existing `create-notification` edge function + Telegram bot

**P1-E: Notification preferences**
- Apply notification channel/subscription migrations
- Let user configure: Telegram, email, SMS, push
- Default: Telegram for now (already working)

**Exit criteria:** New CL/FB listing matching Skylar's criteria -> Telegram message within 15 minutes with listing + comps.

### Phase 2: Comp Analysis Engine (Weeks 4-6)

**P2-A: Contextual comp query function**
- `get_vehicle_comps(year, make, model, body_style, condition_keywords[])`
- Returns: matching vehicles with sale prices, segmented by condition tier
- Condition tiers: project/driver/show (derived from description + price band)
- Source diversity: how many sources contributed comps

**P2-B: As-is vs. finished valuation**
- Given a listing description, identify what's present vs. missing
- "No engine, no transmission" -> flag as project tier
- Compare to project-tier comps AND finished-tier comps
- Spread = profit opportunity (minus build cost)

**P2-C: Deal score**
- Asking price vs. as-is market value = deal quality
- Formula: `deal_score = 1 - (asking_price / median_as_is_comp)`
- A C10 shell at $10K vs. median project-tier comp of $15K = 33% below market

**P2-D: Enrich the notification**
- Match notification now includes: deal score, as-is valuation range, finished valuation range, comp count, comp sources

**Exit criteria:** Notification includes quantified deal assessment with real comp data from our 6,705 C10s.

### Phase 3: Cost Estimation Model (Weeks 7-10)

**P3-A: Expand labor map**
- Current: 15 body/paint transitions
- Add: powertrain stages (no engine -> crate motor installed, no trans -> rebuilt/swap)
- Add: interior stages (gutted -> recovered, dash cracked -> replaced)
- Add: electrical stages (stock harness -> rewire, no gauges -> installed)
- Add: chassis stages (stock suspension -> upgraded, drum brakes -> disc conversion)
- Each stage: hours_min, hours_max, hours_typical, materials_cost_min, materials_cost_max

**P3-B: Regional labor rate data**
- Source: Bureau of Labor Statistics, auto shop rate surveys, our own receipt data
- Goal: labor rate per metro area (general mechanic, body/paint, upholstery)
- Las Vegas: ~$85-125/hr general, ~$75-100/hr body, ~$65-95/hr upholstery
- Store in new table or extend `stage_transition_labor_map`

**P3-C: Parts cost estimation**
- Common powertrain combos: crate 350 SBC ($2-6K), LS swap ($5-15K), rebuilt 700R4 ($1-3K), TH350 ($800-2K)
- Source: Summit Racing, JEGS, Rock Auto API or price scraping
- Store as reference data linked to vehicle platform (C10 = GMT400 generation)

**P3-D: Apply `labor_estimates` migration**
- Create the table that was designed but never deployed
- Wire: listing description -> identify missing/needed work -> stage transitions -> hours + materials -> total cost range

**P3-E: Build cost in notification**
- Match notification now includes: estimated build cost range, broken down by category (powertrain, body, interior, chassis)

**Exit criteria:** "This C10 needs a crate 350 + 700R4 ($5-8K), minor paint correction ($2-4K), basic interior ($1-3K), brake refresh ($800-1.5K). Estimated total: $9-17K."

### Phase 4: Vendor Network (Weeks 11-14)

**P4-A: Vendor discovery pipeline**
- Source vendors from: Google Places API, Yelp, restoration forums, BaT comment mentions, our own `organizations` table
- For each metro area: identify shops by specialty (engine builder, body/paint, upholstery, general restoration)
- Store in `suppliers` table with: location, specialties, rate range, quality indicators

**P4-B: Vendor quality signals**
- Forum reputation (mentions in BaT comments, forum posts)
- Google/Yelp reviews
- Portfolio evidence (photos of completed work)
- Our own observation data (if we've tracked work they've done)

**P4-C: Vendor matching**
- Given a vehicle's build needs + buyer's metro: return ranked vendor options
- Rank by: quality score, distance, rate competitiveness, relevant experience

**P4-D: Vendor in notification**
- Match notification now includes: "3 shops in Las Vegas metro can do this work" with names and rates

**Exit criteria:** For any metro with >500K population, we can suggest 3+ vendors by specialty.

### Phase 5: Build Planner (Weeks 15-18)

**P5-A: Apply build management migrations**
- `build_phases`, `build_line_items`, `build_documents`, `build_images`, `build_benchmarks`
- Full spec already written: `docs/development/BUILD_MANAGEMENT_IMPLEMENTATION.md`

**P5-B: Build plan generator**
- Input: vehicle needs (from cost model) + vendor options (from network) + buyer budget
- Output: phased timeline with milestones
- Example: Phase 1 (Month 1-2): Powertrain install ($5-8K). Phase 2 (Month 2-4): Body/paint ($5-12K). Phase 3 (Month 4-5): Interior ($2-5K). Phase 4 (Month 5-6): Assembly/shakedown ($1-2K).

**P5-C: Payment schedule**
- Map build phases to payment gates
- Deposit -> parts procurement -> labor milestones -> completion
- Link to receipts/invoicing system (242 receipts already exist)

**P5-D: Build plan in deal package**
- The notification now links to a full deal page with:
  - Comp analysis
  - Cost breakdown
  - Build timeline with milestones
  - Vendor options
  - Payment schedule
  - Total investment vs. projected value

**Exit criteria:** A complete build plan document can be generated for any matched vehicle.

### Phase 6: Acquisition UI (Weeks 19-22)

**P6-A: Deal page**
- Single page showing the complete deal package
- All 7 dimensions with scores and supporting data
- Design system compliant (2px borders, zero radius, Arial/Courier New)
- Mobile-first (these deals get found on the phone)

**P6-B: Action buttons**
- "Acquire" -- triggers next steps (contact seller, arrange inspection, etc.)
- "Pass" -- with reason (too expensive, wrong location, missing something)
- "Save" -- watchlist item for later
- "Get More Info" -- request additional analysis

**P6-C: Deal history**
- Every matched deal tracked
- Pass/acquire decisions logged
- Outcome tracking (did the buyer profit?)

**P6-D: The "click yes" flow**
- Acquire -> confirm budget -> system generates: seller contact template, inspection checklist, transport quotes, build plan PDF
- This is the endgame: one click from notification to acquisition in motion

**Exit criteria:** User receives notification, opens deal page, reviews package, clicks acquire, gets actionable next steps.

---

## Rollout Plan

Following the Restoration Intake template:

### Phase 0: Pre-Launch Checklist

**Technical Readiness:**

| Component | Status | Blocks |
|-----------|--------|--------|
| CL queue processor running | Fix needed | Phase 0 |
| Watchlist tables deployed | Apply migrations | Phase 1 |
| Notification channels deployed | Apply migrations | Phase 1 |
| First watchlist created | Manual insert | Phase 1 |
| Ingestion -> matching wired | Edge function update | Phase 1 |
| Matching -> Telegram wired | Edge function update | Phase 1 |
| Comp query function | New SQL function | Phase 2 |
| Deal page UI | New frontend page | Phase 6 |

**Documentation Readiness:**

| Document | Status | Location |
|----------|--------|----------|
| Strategy doc (this file) | Writing now | `docs/products/DEAL_FLOW_ACQUISITION_ENGINE.md` |
| User journeys | Not started | `docs/products/DEAL_FLOW_USER_JOURNEYS.md` |
| Architecture ERD | Not started | `docs/architecture/data/DEAL_FLOW_ERD.md` |
| Dictionary entries | Not started | Library update |
| Engineering manual chapter | Not started | Library update |

### Internal Testing (Phase 1 complete)

- Create Skylar's watchlist manually
- Monitor for 2 weeks
- Verify: every CL listing matching criteria triggers Telegram
- False positive rate: acceptable?
- False negative rate: are we missing listings?
- Latency: listing posted -> Telegram received (target: <15 min)

### Closed Beta (Phase 2-3 complete)

- 3-5 buyers with defined criteria
- Different vehicle segments (C10s, Porsche 911s, E30 BMWs)
- Measure: deals found, deals acted on, outcomes
- Iterate: comp quality, cost estimates, notification format

### Public Beta (Phase 4-5 complete)

- Open watchlist creation to registered users
- Self-service criteria definition
- Build plan as a premium feature
- Measure: conversion from notification to acquisition

---

## Dependencies & Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| CL listings expire before buyer acts | High | Deal lost | Urgency scoring + instant notification |
| Cost estimates wildly wrong | Medium | Bad decisions | Wide ranges, cite sources, disclaim estimates |
| Vendor data stale/wrong | Medium | Bad recommendations | Freshness tracking, user correction loop |
| Build timelines optimistic | High | Buyer frustration | Conservative estimates, range not point |
| Comp data insufficient for niche models | Medium | Weak deal package | Fall back to make-level comps, flag low confidence |
| User creates too many watchlists, alert fatigue | Low | Ignored notifications | Max 10 watchlists, daily digest option |
| Legal liability for cost/value estimates | Medium | Litigation risk | Disclaimers, "estimate" language, never guarantee ROI |

---

## Metrics

### Layer 1 Metrics (Deal Detection)

| Metric | Target | Measurement |
|--------|--------|-------------|
| Time from listing posted to notification | < 15 min | Timestamp diff (listing posted_at vs notification sent_at) |
| Match precision (true positives / all matches) | > 80% | User feedback (acquire/pass/irrelevant) |
| Match recall (found / all that should match) | > 90% | Manual audit against CL/FB listings |
| Notifications per day per user | 2-10 | If >10, criteria too broad |
| User open rate | > 60% | Telegram read receipts |

### Layer 2 Metrics (Comp Analysis)

| Metric | Target | Measurement |
|--------|--------|-------------|
| Comp count per deal | > 5 | SQL query |
| Comp recency (median age) | < 18 months | Comp sale dates |
| Valuation accuracy (estimate vs actual sale) | Within 20% | Track outcomes |

### Full Product Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Deals presented per month | 50+ | watchlist_matches count |
| Deals acquired per month | 2-5 | User action tracking |
| Avg profit per acquisition | > $10K | Outcome tracking (purchase price + build cost vs. sale price) |
| Time from notification to acquisition | < 48 hours | Timestamp tracking |
| User NPS | > 50 | Survey |

---

## Open Questions

### For This Week

1. What are Skylar's exact watchlist criteria? (Beyond C10s -- what else?)
2. Should we ingest this specific C10 listing right now as test case?
3. Is the CL queue stall a known issue or did it silently die?
4. Who are 3-5 other buyers we could beta test with?

### For Later

1. Pricing: is deal detection free? Is the build plan premium?
2. Should we add auction platform monitoring (BaT ending soon, Mecum upcoming)?
3. Auto-bidding: how far do we go with the "auto-buy" system?
4. Partnership: should restoration shops pay to be in the vendor network?
5. Insurance: do we partner with Hagerty for project vehicle coverage?

---

## Appendix: Migration Files to Apply

These migrations exist in the codebase but were never applied to production:

| Migration | Creates | Blocks |
|-----------|---------|--------|
| `20251108_marketplace_deal_alerts.sql` | `marketplace_deal_alerts` | Deal tracking |
| `20251103000002_notification_system.sql` | `notification_channels`, `user_subscriptions` | User preferences |
| `20251127000001_vehicle_watchlist_system.sql` | `vehicle_watchlist`, `watchlist_matches`, matching functions | Core matching |
| `20251127000002_auto_buy_execution_system.sql` | `auto_buy_executions`, `price_monitoring`, auto-buy functions | Auto execution |
| Labor estimation migration | `labor_estimates` | Cost model |
| Build management migrations | `build_phases`, `build_line_items`, `build_documents`, `build_images`, `build_benchmarks` | Build planner |
| `spend_attributions` migration | `spend_attributions` | ROI tracking |

---

## Appendix: The C10 Short Bed Market (From Our Data)

### Sale Price Distribution (C10 Short Beds with Prices)

| Price Band | Count | Sources | Typical Condition |
|------------|-------|---------|-------------------|
| $2K-$10K | 6 | CL, FB, ConceptCarz | Projects, no engine, rough |
| $10K-$20K | 10 | CL, BaT, Barrett-Jackson | Running projects, drivers |
| $20K-$30K | 8 | Barrett-Jackson, BaT, CL | Good drivers, light restomods |
| $30K-$50K | 4 | Barrett-Jackson, FB, CL | Quality restomods, restored stock |
| $50K-$90K | 2 | BaT, Barrett-Jackson | Show quality, exceptional builds |

### 1971 C10 Specifically

| Sale Price | Model Detail | Source | Condition Tier |
|------------|-------------|--------|---------------|
| $214,500 | C10 | Unknown | Show/restomod |
| $200,750 | C10 Custom Pickup | Mecum | Full custom build |
| $187,000 | C10 Custom Pickup "Sweet Elaine" | Barrett-Jackson | Named show truck |
| $161,700 | C10 Custom Pickup | Multiple | High-end restomod |
| $137,500 | C10 Custom Pickup | Barrett-Jackson | Restomod |
| $110,000 | C10 Custom Pickup | Barrett-Jackson | Restomod |
| $26,400 | C10 Short Bed Pickup | Barrett-Jackson | Stock/restored |
| $14,000 | C10 Short Bed | BaT | Stock condition |

**The spread is $14K to $214K.** The variable is build quality. That's why the build plan matters.
