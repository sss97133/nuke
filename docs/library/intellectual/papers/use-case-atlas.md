# Use Case Atlas

## A Complete Taxonomy of User Interactions with the Nuke Vehicle Intelligence Platform

**Date**: 2026-03-31
**Status**: Living document. New use cases added as user archetypes are validated.

---

## Abstract

This document catalogs every hypothesized interaction between a user and the Nuke platform. Use cases are organized by user archetype, then by the user's temporal relationship to a vehicle (before purchase, during ownership, during sale, after sale). Each use case specifies: the user's situation, what they need, what data answers the need, which system surface serves it, and what infrastructure exists vs. what must be built.

This atlas is the bridge between product vision and engineering work. Every feature built should trace back to one or more use cases in this document. Every use case should eventually have at least one feature that serves it.

---

## Taxonomy Structure

Each use case follows this format:

```
### UC-{archetype}{number}: {Title}
- **Situation**: What the user is doing and why they need help
- **Need**: What information or action they require
- **Data source**: Which tables/views/functions provide the answer
- **Surface**: Where in the UI this is served (Profile, Browse, Segment, New)
- **Intelligence layer**: L0 (headline), L1 (signal card), L2 (evidence), L3 (raw graph)
- **Infrastructure**: EXISTS / PARTIAL / NEEDS BUILD
- **Priority**: P0 (core) / P1 (important) / P2 (nice to have) / P3 (future)
```

---

## Archetype 1: BUYER — Pre-Purchase

The buyer has found a vehicle (or is searching for one) and needs to decide whether to pursue it. Their core anxiety: "Am I about to make a $30,000 mistake?"

### UC-B01: Is This Vehicle Worth the Asking Price?

- **Situation**: Buyer found a truck listed at $28K on BaT. They have no independent basis for evaluating whether this price is fair.
- **Need**: Comparable sales for similar vehicles. Where this price falls in the distribution. Whether the vehicle's condition/options justify its position in the range.
- **Data source**: `price_comparables` (vehicle-specific comps), `market_segment_stats` (segment averages), `nuke_estimate` (AI valuation), `auction_events` (historical sales)
- **Surface**: Vehicle Profile — Comps Card
- **Intelligence layer**: L1 (signal card showing estimate + 3-5 comps), expandable to L2 (full comp grid with photos)
- **Infrastructure**: PARTIAL — `price_comparables` and `nuke_estimate` exist but are not surfaced on the profile. `api-v1-comps` edge function exists.
- **Priority**: P0

### UC-B02: What's Wrong With This Listing?

- **Situation**: Buyer is reading a listing description and wants to know if there are red flags they might miss.
- **Need**: Automated discrepancy detection between the seller's claims and verifiable data. Inconsistencies between description, VIN decode, photos, and historical records.
- **Data source**: `analysis_signals` (deal_health category), `description_discoveries` (AI extraction from description), VIN decode API data, `vehicle_observations` (historical claims)
- **Surface**: Vehicle Profile — Discrepancy Alerts section
- **Intelligence layer**: L1 (alert cards), expandable to L2 (specific conflicting data points with sources)
- **Infrastructure**: PARTIAL — `analysis_signals` exist and `description_discoveries` exist, but no frontend component assembles them into discrepancy alerts.
- **Priority**: P0

### UC-B03: Is This Actually Matching Numbers?

- **Situation**: Seller claims "matching numbers." Buyer wants independent verification.
- **Need**: VIN decode to determine factory engine/transmission, cross-referenced against seller's claimed specs. Casting number analysis. Community corroboration.
- **Data source**: VIN decode data (in `vehicles` and `vehicle_specifications`), `description_discoveries` (extracted engine claims), `auction_comments` (community discussion of numbers matching), `comment_discoveries` (theme extraction)
- **Surface**: Vehicle Profile — Trust Assessment card
- **Intelligence layer**: L1 (trust score with headline), L2 (specific verifications: "VIN decodes to 350/4bbl — seller claims 350/4bbl: MATCH" or "VIN decodes to 350/2bbl — seller claims 454: CONFLICT")
- **Infrastructure**: PARTIAL — VIN decode data exists for ~40% of vehicles. Cross-referencing logic does not exist as a user-facing feature.
- **Priority**: P1

### UC-B04: Has This Vehicle Been Listed Before?

- **Situation**: Buyer wonders if this vehicle has a sales history that might indicate problems (repeated listings, declining prices, failed auctions).
- **Need**: Complete listing history across all platforms. Price at each appearance. Outcome (sold, not sold, withdrawn).
- **Data source**: `vehicle_observations` (kind = 'listing', 'sale_result'), `vehicle_events`, `auction_events`
- **Surface**: Vehicle Profile — Apparition Timeline
- **Intelligence layer**: L1 (summary: "Appeared 3 times in 18 months"), L2 (timeline with prices and outcomes)
- **Infrastructure**: EXISTS in database. No frontend component renders the cross-platform apparition history.
- **Priority**: P0

### UC-B05: What Should I Look For at Inspection?

- **Situation**: Buyer is scheduling a PPI (pre-purchase inspection). They want a vehicle-specific checklist.
- **Need**: Known failure points for this year/make/model/engine combination. Specific items the community has flagged on this vehicle. Areas where data is thin or unverified.
- **Data source**: Model-specific failure patterns (would need a `known_issues` dataset by YMM), `comment_discoveries` (community flags), `analysis_signals` (areas of low confidence)
- **Surface**: Vehicle Profile — PPI Checklist (new component, or part of coaching)
- **Intelligence layer**: L1 (top 5 things to check), L2 (full checklist with reasoning)
- **Infrastructure**: NEEDS BUILD — No model-specific failure pattern database exists. Community comments have some of this data unstructured.
- **Priority**: P2

### UC-B06: What Will This Cost Me After Purchase?

- **Situation**: Buyer wants to budget for ownership. Immediate maintenance needs based on mileage/age, parts costs, insurance estimate.
- **Need**: Service interval data for this model. Parts pricing for common maintenance items. Historical maintenance costs from similar vehicles.
- **Data source**: `part_price_observations` (parts pricing), `labor_operations` (labor benchmarks), service interval reference data (partial in reference catalogs)
- **Surface**: Vehicle Profile — Ownership Cost section (new)
- **Intelligence layer**: L1 (estimated annual maintenance cost), L2 (itemized maintenance schedule with part costs)
- **Infrastructure**: PARTIAL — Parts pricing and labor benchmarks exist. Service interval data is sparse. Assembly logic does not exist.
- **Priority**: P2

### UC-B07: Can I Negotiate Lower?

- **Situation**: Buyer wants leverage for negotiation. Days on market, price drops, comparable vehicle availability.
- **Need**: How long the vehicle has been listed. Whether the price has been reduced. How many comparable vehicles are currently available (supply pressure). Seller's history (frequent flipper vs. long-term owner).
- **Data source**: `vehicle_observations` (listing timestamps, price changes), `market_segment_stats` (active inventory count), seller history from `external_identities`
- **Surface**: Vehicle Profile — Market Position card (part of briefing)
- **Intelligence layer**: L1 (signal: "Listed 67 days, price reduced twice, 4 comparable vehicles active"), L2 (timeline of price changes, comp availability chart)
- **Infrastructure**: PARTIAL — Observation timestamps exist. Price change tracking is implicit (multiple observations with different prices). Active inventory counting needs a view.
- **Priority**: P1

### UC-B08: Is This a Flood/Salvage Vehicle?

- **Situation**: Buyer suspects the vehicle may have a hidden history (title washing, flood damage, salvage rebuild).
- **Need**: Title history across states. Discrepancies in title type. Geographic history (was it in a flood zone during a major event?).
- **Data source**: `vehicle_observations` (kind = 'title_event'), VIN history services (external, not currently integrated), `vehicle_location_observations`
- **Surface**: Vehicle Profile — Risk Signals
- **Intelligence layer**: L1 (alert if title inconsistencies detected), L2 (title history timeline)
- **Infrastructure**: NEEDS BUILD — VIN history service integration (NMVTIS, Carfax, AutoCheck) not currently in system. Location history exists but flood correlation does not.
- **Priority**: P2

### UC-B09: Cross-Platform Vehicle Search

- **Situation**: Buyer wants "a 4x4 K5 Blazer under $35K with A/C." They don't want to search 6 platforms individually.
- **Need**: Unified search across all vehicles in the system regardless of source platform. Structured filtering by specs, price, features.
- **Data source**: `vehicles` table + `vehicle_specifications` + `vehicle_observations`, searched via `universal-search`
- **Surface**: Browse/Search
- **Intelligence layer**: N/A (search results, not intelligence)
- **Infrastructure**: EXISTS — `universal-search` handles this. Enhancement needed: natural language parsing to extract structured filters from prose queries.
- **Priority**: P0

### UC-B10: Show Me All Comparable Sales

- **Situation**: Buyer wants to do their own comp research, not just see the system's pre-selected comps.
- **Need**: All vehicles matching certain criteria that have sold in a time window. Photos, prices, dates, platforms.
- **Data source**: `auction_events` (where sale_result exists), `vehicles`, `vehicle_images`
- **Surface**: Segment Dashboard (comp grid view)
- **Intelligence layer**: L2 (full comp grid, sortable/filterable)
- **Infrastructure**: PARTIAL — `api-v1-comps` exists. Frontend grid component does not.
- **Priority**: P1

### UC-B11: Buyer's Checklist for This Vehicle

- **Situation**: Buyer is flying out tomorrow to see the vehicle. Wants a comprehensive preparation guide.
- **Need**: Vehicle-specific items to verify in person. Documents to request from seller. Questions to ask. Things to photograph.
- **Data source**: All vehicle profile data + model-specific knowledge + areas of low confidence in the data
- **Surface**: Vehicle Profile — Buyer Checklist (generated document)
- **Intelligence layer**: L1 (generated checklist as actionable list)
- **Infrastructure**: NEEDS BUILD — Could be generated from existing data via AI prompt assembly.
- **Priority**: P2

---

## Archetype 2: BUYER — Post-Purchase

The buyer now owns the vehicle. Their relationship with the system shifts from evaluation to management.

### UC-B12: What Should I Do First?

- **Situation**: Just bought the vehicle. Overwhelmed with what needs attention.
- **Need**: Prioritized onboarding list: immediate safety items, deferred maintenance, registration/insurance tasks, community joining.
- **Data source**: Vehicle data (mileage, age, known conditions), model-specific common issues, `work_order` templates
- **Surface**: Vehicle Profile — New Owner Onboarding (triggered when user claims vehicle)
- **Intelligence layer**: L1 (prioritized action list)
- **Infrastructure**: NEEDS BUILD
- **Priority**: P2

### UC-B13: What Maintenance Is Overdue?

- **Situation**: Vehicle was purchased with unknown service history. Owner wants to know what's probably due.
- **Need**: Service interval lookup by mileage and age. Flag items that are likely overdue based on vehicle age/mileage and absence of records.
- **Data source**: Service interval reference data (GM service manuals exist as chunks), `vehicles.mileage`, `work_sessions` (if any exist)
- **Surface**: Vehicle Profile — Maintenance Schedule section
- **Intelligence layer**: L1 (overdue items highlighted), L2 (full schedule with costs)
- **Infrastructure**: PARTIAL — Reference data exists in fragments. No assembled maintenance schedule view.
- **Priority**: P2

### UC-B14: Where Do I Get Parts?

- **Situation**: Owner needs specific parts. Wants to know vendors, prices, availability.
- **Need**: Parts search by vehicle fitment. Price comparison across vendors. Availability/lead time.
- **Data source**: `part_price_observations` (multi-vendor pricing), reference catalogs (LMC, etc.)
- **Surface**: Vehicle Profile — Parts section, or standalone parts search
- **Intelligence layer**: L1 (best price for a part), L2 (all vendors with prices, ratings, lead times)
- **Infrastructure**: PARTIAL — `part_price_observations` exists with pricing data. No user-facing parts search.
- **Priority**: P2

### UC-B15: Who's the Best Mechanic for This Near Me?

- **Situation**: Owner needs work done. Wants a specialist, not a generalist.
- **Need**: Shops near the owner that specialize in this vehicle type. Reputation, pricing, portfolio of past work.
- **Data source**: `organizations` (type = shop/service), `vehicle_location_observations`, work history across the shop's vehicles
- **Surface**: Map view filtered by specialty, or recommendation from vehicle profile
- **Intelligence layer**: L1 (top 3 recommended shops), L2 (shop profiles with work history)
- **Infrastructure**: PARTIAL — Organization data exists. Specialization matching and recommendation logic do not.
- **Priority**: P3

### UC-B16: What Did the Previous Owner Do to It?

- **Situation**: New owner wants to understand the vehicle's history from the previous owner's perspective.
- **Need**: Provenance chain: who owned it, what work was done, what modifications were made, what was the condition at each ownership transition.
- **Data source**: `vehicle_observations` (full history), `work_sessions`, `work_orders`, ownership chain from title events
- **Surface**: Vehicle Profile — Provenance tab
- **Intelligence layer**: L2 (full provenance timeline), L1 (summary: "3 known owners. Last owner: 8 years, documented 12 service events")
- **Infrastructure**: PARTIAL — Data exists. Provenance chain rendering as a user feature does not.
- **Priority**: P1

---

## Archetype 3: SELLER — Preparing to List

The seller's core anxiety: "How do I get the most money for this vehicle?"

### UC-S01: What's My Vehicle Worth?

- **Situation**: Seller wants a data-backed valuation before deciding to sell.
- **Need**: Market-based valuation with comparable sales. Not KBB — actual auction and private sale data for this specific type.
- **Data source**: `nuke_estimate`, `price_comparables`, `market_segment_stats`
- **Surface**: Vehicle Profile — Valuation card (owner view)
- **Intelligence layer**: L1 (estimate with range), L2 (comps used, methodology, confidence)
- **Infrastructure**: PARTIAL — Estimate exists for 60.6% of vehicles. Not surfaced as owner-facing valuation.
- **Priority**: P0

### UC-S02: What Should I Fix Before Selling?

- **Situation**: Seller has limited budget for pre-sale improvements. Which $500 repair adds $3K in value?
- **Need**: ROI analysis on potential repairs. Which deficiencies reduce value by more than the cost to fix?
- **Data source**: `analysis_signals` (completion_discount widget), `part_price_observations`, `labor_operations`, comp data for vehicles with/without specific issues
- **Surface**: Vehicle Profile — Repair ROI section (coaching flow)
- **Intelligence layer**: L1 (ranked repair recommendations with ROI), L2 (cost estimates, comp evidence)
- **Infrastructure**: NEEDS BUILD — Signal exists conceptually but repair ROI calculation needs to be built.
- **Priority**: P1

### UC-S03: Write Me a Listing Description

- **Situation**: Seller is not a writer. They want a professional listing description generated from the data.
- **Need**: Narrative description assembled from all known vehicle data. Honest, complete, well-structured for the target platform.
- **Data source**: All vehicle data: specs, history, work records, observations, modifications
- **Surface**: Vehicle Profile — Listing Preview tab (owner view)
- **Intelligence layer**: L1 (generated description with highlighted gaps: "[MISSING: ownership history]")
- **Infrastructure**: NEEDS BUILD — AI description generation from structured data. Template by platform (BaT vs. C&B vs. Hemmings).
- **Priority**: P1

### UC-S04: What Photos Do I Need?

- **Situation**: Seller wants to photograph the vehicle for listing. Doesn't know what shots matter.
- **Need**: Platform-specific shot list. Indication of which photos the system already has vs. what's missing. Best practices for each angle.
- **Data source**: `vehicle_images` (classified by angle/zone), `image_angle_spectrum` (41 zones), platform requirements (BaT requires specific shots)
- **Surface**: Vehicle Profile — Photo Coaching section
- **Intelligence layer**: L1 (missing shots checklist), L2 (example photos from similar vehicles for each angle)
- **Infrastructure**: PARTIAL — Image classification exists. Gap analysis against a "complete" shot list does not exist as user-facing.
- **Priority**: P1

### UC-S05: Where Should I List This?

- **Situation**: Seller doesn't know which platform is best for their vehicle.
- **Need**: Platform recommendation based on vehicle type, price range, condition, and historical platform performance for similar vehicles.
- **Data source**: `auction_events` (sale results by platform and segment), `market_segment_stats` by platform
- **Surface**: Vehicle Profile — Platform Recommendation (coaching flow)
- **Intelligence layer**: L1 (recommended platform + reasoning), L2 (performance data by platform for this segment)
- **Infrastructure**: PARTIAL — Historical data exists. Recommendation logic and UI do not.
- **Priority**: P2

### UC-S06: When Should I List?

- **Situation**: Seller wants to time the market. Some segments have seasonal patterns.
- **Need**: Seasonal trend data for this vehicle segment. "March is historically strong for convertibles" type intelligence.
- **Data source**: `market_snapshots` (time-series by segment), `auction_events` with timestamps
- **Surface**: Vehicle Profile — Timing recommendation (coaching flow), or Segment Dashboard
- **Intelligence layer**: L1 (timing recommendation), L2 (seasonal price/volume chart)
- **Infrastructure**: PARTIAL — Time-series data exists. Seasonal decomposition and recommendation logic do not.
- **Priority**: P3

### UC-S07: Score My Listing Before I Post

- **Situation**: Seller has drafted a listing. They want to know if it's ready.
- **Need**: Pre-flight check across all dimensions. What's strong, what's weak, what's missing.
- **Data source**: ARS computation, `analysis_signals`, photo coverage, description completeness
- **Surface**: Vehicle Profile — ARS Pre-flight (coaching flow)
- **Intelligence layer**: L1 (overall score + top 3 gaps), L2 (dimension-by-dimension breakdown with actions)
- **Infrastructure**: EXISTS — ARS scoring works. UI for pre-flight check with actionable gaps does not.
- **Priority**: P0

---

## Archetype 4: ENTHUSIAST / COLLECTOR

The enthusiast's core drive is knowledge, appreciation, and community. They may or may not be buying or selling.

### UC-E01: Track My Collection

- **Situation**: Collector owns 3-10 vehicles. Wants a portfolio view with total value, individual trends, overall health.
- **Need**: Multi-vehicle dashboard. Aggregate valuation. Individual vehicle health status. Change alerts.
- **Data source**: `user_vehicle_links` (link_type = 'owner'), `nuke_estimate` per vehicle, `analysis_signals`
- **Surface**: New — Garage/Portfolio page (partially exists as HomePage Garage tab)
- **Intelligence layer**: L1 (portfolio summary), L2 (per-vehicle detail)
- **Infrastructure**: PARTIAL — Garage tab exists on homepage. Portfolio valuation aggregation does not.
- **Priority**: P2

### UC-E02: What's Appreciating in This Segment?

- **Situation**: Enthusiast wants to know which segments are appreciating. Investment research.
- **Need**: Price trends by segment over 1/3/5 years. Volume trends. Which sub-categories are diverging.
- **Data source**: `market_segment_stats`, `market_snapshots`, `auction_events` time series
- **Surface**: Segment Dashboard
- **Intelligence layer**: L1 (segment trend summary), L2 (chart with time controls)
- **Infrastructure**: PARTIAL — Data exists. Segment Dashboard UI does not.
- **Priority**: P1

### UC-E03: How Rare Is My Vehicle?

- **Situation**: Owner wants to know the rarity of their specific configuration.
- **Need**: Production numbers for the year/make/model. Option combination frequency. Known survivor count.
- **Data source**: Production data (in reference catalogs), `vehicles` (count of known examples with same options), historical registries
- **Surface**: Vehicle Profile — Rarity card
- **Intelligence layer**: L1 (rarity statement: "1 of 847 produced with this option package. 23 known examples in database."), L2 (production data table, similar vehicles in system)
- **Infrastructure**: PARTIAL — Production data partial (some models only). Vehicle counting against option combinations not built as a feature.
- **Priority**: P2

### UC-E04: Deep Comp Research — All Sales for a Segment

- **Situation**: Enthusiast doing serious market research. Wants every K5 Blazer auction result in the last 5 years.
- **Need**: Exhaustive results list with filters (year range, condition, reserve met, platform). Exportable.
- **Data source**: `auction_events`, `vehicles`, `vehicle_images`
- **Surface**: Segment Dashboard — Full Comp View
- **Intelligence layer**: L2 (full data table with sort/filter), L3 (raw export)
- **Infrastructure**: PARTIAL — Data exists extensively. Query and display surface does not.
- **Priority**: P1

### UC-E05: What's the Community Saying About X?

- **Situation**: Enthusiast wants to know the current discourse around a topic (LS swaps in C10s, originality vs. restomod, etc.).
- **Need**: Aggregated sentiment and theme analysis from community comments. Expert opinions surfaced.
- **Data source**: `comment_discoveries`, `bat_user_profiles` (expertise identification), `auction_comments`
- **Surface**: Segment Dashboard — Community Intelligence section, or vehicle profile for vehicle-specific discussion
- **Intelligence layer**: L1 (top themes + sentiment), L2 (representative comments with expert badges)
- **Infrastructure**: PARTIAL — Comment analysis exists. Theme aggregation at segment level does not. Expert identification via stylometric profiles is in progress.
- **Priority**: P2

### UC-E06: Document My Vehicle's History

- **Situation**: Enthusiast wants to create a complete heritage file for their vehicle. For personal records, future sale, or posterity.
- **Need**: Assembled document containing all known history, photos, work records, provenance chain, specs, and narratives.
- **Data source**: Everything in the vehicle's profile — all observations, images, work orders, etc.
- **Surface**: Vehicle Profile — "Export Heritage File" action
- **Intelligence layer**: Generated document (PDF or shareable link)
- **Infrastructure**: NEEDS BUILD — All data exists. Assembly into a document does not.
- **Priority**: P2

---

## Archetype 5: BUILDER / RESTORER

The builder's core need is project management with domain-specific intelligence.

### UC-R01: Plan a Build — Cost Estimation

- **Situation**: Builder is planning a restoration or modification project. Wants to know total cost before starting.
- **Need**: Parts list + pricing for the planned work. Labor estimates. Total budget.
- **Data source**: `part_price_observations`, `labor_operations` (64 operations with benchmarks), historical build costs for similar projects (from `work_orders`)
- **Surface**: Vehicle Profile — Build Planner (new section)
- **Intelligence layer**: L1 (estimated total), L2 (itemized budget with vendor options)
- **Infrastructure**: PARTIAL — Parts pricing and labor benchmarks exist. Build planning UI does not.
- **Priority**: P2

### UC-R02: Track Build Progress

- **Situation**: Builder is mid-project. Wants to log work sessions, track parts consumed, monitor budget vs. actual.
- **Need**: Work session logging with photos. Parts tracking. Budget burn rate. Completion percentage.
- **Data source**: `work_sessions`, `work_orders`, `build_images`, `work_order_line_items`
- **Surface**: Vehicle Profile — Build Progress tab (partially exists)
- **Intelligence layer**: L1 (progress summary + budget status), L2 (session-by-session timeline with day cards)
- **Infrastructure**: EXISTS — Work tracking infrastructure is built. UI exists but could be more discoverable.
- **Priority**: P1

### UC-R03: Parts Interchange — What Fits?

- **Situation**: Builder needs a part and wants to know which donor vehicles are compatible.
- **Need**: Interchange database — which years/models share the part. Fitment verification.
- **Data source**: Reference catalogs (partial), `part_price_observations` (claimed fitment JSONB field)
- **Surface**: Parts search with interchange results
- **Intelligence layer**: L1 (interchange list), L2 (fitment details with caveats)
- **Infrastructure**: PARTIAL — Fitment data exists in fragments. No unified interchange search.
- **Priority**: P3

### UC-R04: What Have Others Done With This Platform?

- **Situation**: Builder wants inspiration and guidance. What builds have been done on similar vehicles?
- **Need**: Gallery of completed builds for the same year/make/model. Modification summaries. Build costs.
- **Data source**: `vehicles` (filtered by make/model, with modifications), `vehicle_images`, `work_sessions`
- **Surface**: Segment Dashboard — Build Gallery section
- **Intelligence layer**: L1 (curated builds), L2 (full build profiles)
- **Infrastructure**: PARTIAL — Vehicles with modification data exist. Gallery assembly does not.
- **Priority**: P3

### UC-R05: Document This for the Next Owner

- **Situation**: Builder finishing a project. Wants to create a comprehensive build record that follows the vehicle forever.
- **Need**: Assembled build documentation: every part installed, every photo dated, every session logged, total investment.
- **Data source**: All work data for the vehicle
- **Surface**: Vehicle Profile — Build Record export (overlaps with UC-E06 Heritage File)
- **Intelligence layer**: Generated document
- **Infrastructure**: PARTIAL — Data exists. Export assembly does not.
- **Priority**: P2

---

## Archetype 6: MECHANIC / SHOP

### UC-M01: Vehicle Briefing for Unfamiliar Model

- **Situation**: A '73 C20 rolls in. Mechanic hasn't worked on one before. Needs quick orientation.
- **Need**: Model-specific overview: engine options for that year, common problems, service points, specs.
- **Data source**: Reference catalogs (GM service manual chunks), `vehicle_specifications`, community knowledge from comments
- **Surface**: Vehicle Profile — read as a technical reference
- **Intelligence layer**: L1 (model overview), L2 (detailed specs + known issues)
- **Infrastructure**: PARTIAL — Spec data exists. "Common problems by model" does not as a structured dataset.
- **Priority**: P2

### UC-M02: Labor Time Estimation

- **Situation**: Shop needs to quote a job. How long should it take?
- **Need**: Labor benchmarks for this job on this type of vehicle. National median, local rates.
- **Data source**: `labor_operations` (64 operations), `work_sessions` (actual hours logged by job type)
- **Surface**: Shop tools (future) or API
- **Intelligence layer**: L1 (estimated hours + rate range), L2 (benchmark data with sample size)
- **Infrastructure**: PARTIAL — 64 operations defined. Sample sizes small for many.
- **Priority**: P3

### UC-M03: Document Work for Customer

- **Situation**: Mechanic completed work. Wants to create a professional work report with photos.
- **Need**: Work session → professional report with before/after photos, parts used, hours, narrative.
- **Data source**: `work_sessions`, `build_images`, `work_order_line_items`
- **Surface**: Vehicle Profile — Work Report generation
- **Intelligence layer**: Generated document (same data as Day Card, formatted as customer-facing report)
- **Infrastructure**: PARTIAL — Data input exists (mailbox). Report generation does not.
- **Priority**: P2

---

## Archetype 7: DEALER / FLIPPER

### UC-D01: Acquisition Targeting

- **Situation**: Dealer wants to know which vehicles at upcoming auctions have margin potential.
- **Need**: Pre-auction analysis: estimated market value vs. expected hammer price. Condition risk assessment. Demand signals.
- **Data source**: `nuke_estimate`, `auction_events` (upcoming), `market_segment_stats`, `analysis_signals`
- **Surface**: New — Dealer Dashboard or enhanced Auction browsing
- **Intelligence layer**: L1 (deal score on upcoming lots), L2 (full analysis per lot)
- **Infrastructure**: NEEDS BUILD — Concept exists in analysis widgets. User-facing dealer tools do not.
- **Priority**: P3

### UC-D02: Portfolio Valuation

- **Situation**: Dealer has 15 vehicles in inventory. Wants current total value and aging analysis.
- **Need**: Multi-vehicle valuation with days-on-market tracking. Age-based price decay alerts.
- **Data source**: `user_vehicle_links` or `organization_vehicles`, `nuke_estimate`, listing timestamps
- **Surface**: Org Profile — Inventory Dashboard
- **Intelligence layer**: L1 (portfolio total + aging summary), L2 (per-vehicle analysis)
- **Infrastructure**: PARTIAL — Org vehicle relationships exist. Inventory dashboard with aging does not.
- **Priority**: P3

---

## Archetype 8: CASUAL BROWSER

The casual browser has no specific intent. They're browsing for pleasure or vague interest.

### UC-C01: Discovery — "Show Me Something Cool"

- **Situation**: User opens the site with no specific goal. They want to be entertained and educated.
- **Need**: A feed of interesting vehicles. Not just "newest" — most interesting, unusual, story-rich.
- **Data source**: Interestingness signals: comment count, price anomaly, rarity, story density, photo quality
- **Surface**: Browse — Discovery Feed
- **Intelligence layer**: L0 (feed with interest hooks: "barn find," "$47K above estimate," "1 of 12 built")
- **Infrastructure**: NEEDS BUILD — Interestingness scoring does not exist as a dedicated signal.
- **Priority**: P1

### UC-C02: What's Trending?

- **Situation**: User wants to know what's happening in the market right now.
- **Need**: Market pulse: trending segments, notable sales, market movers.
- **Data source**: `market_snapshots`, `market_segment_stats`, recent `auction_events`
- **Surface**: Browse — Market Pulse section
- **Intelligence layer**: L0 (sparklines + change indicators), L1 (segment detail on click)
- **Infrastructure**: PARTIAL — Data exists. Market Pulse component does not.
- **Priority**: P1

### UC-C03: Best Value Right Now

- **Situation**: Buyer with budget constraints wants the best bang for the buck.
- **Need**: Vehicles where asking price is significantly below the system's estimated market value.
- **Data source**: `nuke_estimate` vs. current asking price (from observations), deal_health signals
- **Surface**: Browse — "Best Deals" sort/filter mode
- **Intelligence layer**: L1 (deal badge on vehicle cards), L0 (sort by deal score)
- **Infrastructure**: PARTIAL — Estimates exist. Deal scoring as browse filter does not.
- **Priority**: P1

---

## Archetype 9: APPRAISER / INSURER

### UC-A01: Agreed Value Documentation

- **Situation**: Vehicle owner needs an agreed-value insurance policy. Insurer wants documentation of the claimed value.
- **Need**: Comparable sales, vehicle condition documentation, specification verification. Professional format.
- **Data source**: `price_comparables`, vehicle profile data, `vehicle_images`, `work_history`
- **Surface**: Vehicle Profile — Appraisal Report export
- **Intelligence layer**: Generated document with comps, photos, provenance
- **Infrastructure**: NEEDS BUILD — Data exists. Report format does not.
- **Priority**: P3

---

## Archetype 10: CONTENT CREATOR / JOURNALIST

### UC-J01: Data for an Article

- **Situation**: Journalist writing about the C10 market. Needs real data, not anecdotes.
- **Need**: Exportable market analysis: price trends, volume, notable sales, segment statistics.
- **Data source**: `market_segment_stats`, `auction_events`, aggregate queries
- **Surface**: Segment Dashboard — Export feature, or API
- **Intelligence layer**: L2 (data tables), L3 (raw export)
- **Infrastructure**: PARTIAL — Data exists. Export tooling does not.
- **Priority**: P3

---

## Archetype 11: POST-SALE RELATIONSHIP

### UC-PS01: Ongoing Value Tracking

- **Situation**: Owner wants to know if their vehicle's value is changing.
- **Need**: Periodic valuation updates. Market movement alerts.
- **Data source**: `nuke_estimate` recomputed periodically, `market_snapshots` changes
- **Surface**: Vehicle Profile — Value History (sparkline), Notifications (future)
- **Intelligence layer**: L1 (current estimate with trend arrow), L2 (value history chart)
- **Infrastructure**: PARTIAL — Estimates recomputed. History tracking and notification infra do not exist.
- **Priority**: P2

### UC-PS02: Update Record With New Work

- **Situation**: Owner did maintenance or modifications. Wants to update the vehicle record.
- **Need**: Simple data entry for work performed. Photo upload. Receipt capture.
- **Data source**: `work_sessions`, `work_orders` (write path), `build_images`
- **Surface**: Vehicle Profile — Work logging (exists as Mailbox)
- **Intelligence layer**: N/A (data input, not output)
- **Infrastructure**: EXISTS — Mailbox and work order system functional.
- **Priority**: P1

### UC-PS03: Transfer Vehicle Record to New Owner

- **Situation**: Selling the vehicle. Wants the next owner to have access to all the accumulated data.
- **Need**: Ownership transfer mechanism that preserves provenance but changes access control.
- **Data source**: `user_vehicle_links`, vehicle record
- **Surface**: Vehicle Profile — Transfer Ownership action
- **Intelligence layer**: N/A (administrative action)
- **Infrastructure**: NEEDS BUILD — No ownership transfer flow exists.
- **Priority**: P2

---

## Summary Statistics

| Category | Use Cases | P0 | P1 | P2 | P3 | EXISTS | PARTIAL | NEEDS BUILD |
|----------|-----------|----|----|----|----|--------|---------|-------------|
| Buyer Pre-Purchase | 11 | 3 | 2 | 5 | 1 | 0 | 8 | 3 |
| Buyer Post-Purchase | 5 | 0 | 1 | 3 | 1 | 0 | 4 | 1 |
| Seller | 7 | 2 | 3 | 1 | 1 | 1 | 3 | 3 |
| Enthusiast | 6 | 0 | 2 | 3 | 1 | 0 | 4 | 2 |
| Builder | 5 | 0 | 1 | 2 | 2 | 1 | 3 | 1 |
| Mechanic | 3 | 0 | 0 | 2 | 1 | 0 | 3 | 0 |
| Dealer | 2 | 0 | 0 | 0 | 2 | 0 | 1 | 1 |
| Casual Browser | 3 | 0 | 3 | 0 | 0 | 0 | 2 | 1 |
| Appraiser | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 1 |
| Journalist | 1 | 0 | 0 | 0 | 1 | 0 | 1 | 0 |
| Post-Sale | 3 | 0 | 1 | 2 | 0 | 1 | 1 | 1 |
| **TOTAL** | **47** | **5** | **13** | **18** | **11** | **3** | **30** | **14** |

**Key finding**: 30 of 47 use cases (64%) have PARTIAL infrastructure — the data exists, the backend works, but the frontend doesn't surface it. Only 14 use cases (30%) require new backend infrastructure. The gap is overwhelmingly a *surface area* gap, not a *data* gap.
