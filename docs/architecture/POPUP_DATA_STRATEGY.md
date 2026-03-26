# Popup Data Strategy — What to Show and Why

**Created:** 2026-03-26
**Status:** Research complete, awaiting implementation decisions

---

## The Problem

Current popups show garbage aggregate statistics:
- Median price ($813 for Chevrolet = meaningless over dirty data)
- Price range ($1-$2K = noise)
- Year range (1920-2026 = the entire database)
- Data fill rates (internal platform health, not user-facing)
- Top models (mixing tonnage with cab style, no domain understanding)

These metrics are all symptoms of the same mistake: **showing aggregate statistics over unclean heterogeneous data as if they're meaningful.**

## The Principle

**Show specific things, not summaries.** Show THE ACTUAL VEHICLES. Show what's happening RIGHT NOW. Let the user's brain do the aggregation. The popup is an advisor, not a statistics dashboard.

## What Data Actually Exists (742K vehicles, 3.78M observations)

### Core Identity & Specs
| Signal | Population | % | Novel? |
|--------|-----------|---|--------|
| Make/Model/Year | 699K-736K | 94-99% | No |
| Any price | 343K | 46% | Baseline |
| Description | 297K | 40% | Testimony |
| Images | ~34M total | 332K vehicles | Visual evidence |
| Mileage | 224K | 30% | Baseline |
| Transmission | 305K | 41% | Baseline |
| Drivetrain | 250K | 34% | Baseline |
| Body style | 444K | 60% | Baseline |
| Horsepower | 103K | 14% | Performance |

### Intelligence Layer (THE GOLD — mostly unsurfaced)
| Signal | Population | Notes |
|--------|-----------|-------|
| Nuke estimate | 582K | AI-computed market value |
| Heat score | 582K | Market demand 0-100 |
| Deal score | 32K | Value vs estimate |
| Individual bids (bat_bids) | **4.33M rows** | Bid-level granularity |
| Auction comments | **~12M rows** | Full comment text + metadata |
| Comment discoveries | **126K vehicles** | AI-analyzed: sentiment, expert insights, key quotes, concerns |
| Description discoveries | **31K vehicles** | AI-extracted: red flags, mods, work history, rarity |
| Vehicle observations | **3.78M rows** | Multi-source unified events |
| Vehicle events | 335K | Platform listing timeline |
| Price history | 283K entries | Price trajectory over time |
| Cross-platform identities | 524K | Buyer/seller linkage |
| Record prices | 507 | Record-breaking sales |
| Known flaws | 16K | Red flags with severity |
| Modifications | 21K | Aftermarket changes |
| Service history | 18K | Maintenance records |
| Highlights | 32K | AI-extracted selling points |
| Title status | 53K | Clean/salvage/etc |
| Seller info | 136K | Seller identity |
| Buyer info | 110K | BaT buyer identity |

### Existing Views (pre-computed, ready to use)
- `v_vehicle_intelligence_full` — denormalized with scores, sentiment, themes
- `v_vehicle_canonical` — canonical fields with trust scores and data grades
- `vehicle_event_summary` — per-vehicle: total_events, times_sold, platforms_seen, platform_list
- `vehicle_rarity_view` — rarity level, production numbers, collector demand score
- `vehicle_observation_summary` — observation counts and sources
- `vehicle_image_coverage` — image coverage by zone

### What's in comment_discoveries.raw_extraction (JSONB)
This is the biggest untapped source — 126K vehicles with:
- `sentiment.overall` + `sentiment.score` + `sentiment.mood_keywords`
- `key_quotes` — best quotes from discussion
- `expert_insights` — technical knowledge from community
- `price_sentiment` — community opinion on the price
- `community_concerns` — red flags and worries raised
- `seller_disclosures` — what the seller revealed
- `authenticity_discussion` — concerns about vehicle authenticity
- `market_signals` — demand indicators, value factors

### What's in description_discoveries.raw_extraction (JSONB)
31K vehicles with:
- `condition.known_flaws` with severity + quotes
- `modifications` with confidence scores
- `work_history` with dates, shops, descriptions
- `provenance.owner_count`, documentation, matching_numbers
- `red_flags` with severity
- `rarity_claims` — production numbers, special editions
- `option_codes` — factory option codes

## Vehicle Popup — What to Show

### Tier 1: Always show (data exists for most vehicles)
1. **Apparition history** — Where this chassis has appeared across sources. Cross-platform sightings via VIN/entity resolution. This is the knowledge graph's superpower.
2. **Comparable transactions** — Not median. SPECIFIC vehicles that sold, scored by configuration similarity. Price position vs closest comps.
3. **Live auction state** — If live: current bid, bid velocity (bids/hour), time remaining, watcher count. Not static numbers — the DYNAMICS.

### Tier 2: Show when available (populated for subset)
4. **Red flags and signals** — Known flaws (16K vehicles), modifications (21K), description mutations between listings, mileage trajectory inconsistencies.
5. **Comment intelligence** — From 126K comment discoveries: sentiment, themes, specific concerns raised by community.

### Tier 3: Aspirational (build toward)
6. **Configuration rarity** — "Manual trans + 4WD + shortbed is 4% of observed K10s." Computed from observation counts.
7. **Model-specific intelligence** — Common issues, what to inspect, generational context.
8. **Ownership chain** — Who had it, how long, geographic path.

## Make Popup — What to Show

### Kill these metrics:
- Median price (useless over dirty data)
- Price range (noise)
- Year range (obvious)
- Data fill rates (internal metric)

### Replace with:
1. **Live activity** — What's live right now on each source. What just sold (last 30 days). What's newly listed.
2. **Model taxonomy by cultural category** — Not alphabetical. Group by: Trucks & Utility, Muscle & Performance, Full Size, etc. Show observation density as bars (honest about depth).
3. **Price topology as a shape** — Scatter/density by year and price. Shows where the heat is. Not a single number — a SHAPE.
4. **Market velocity** — What's heating up, what's cooling. Transaction price trends. Listing volume changes. Time-on-market shifts.
5. **Cross-source presence** — Where this make appears, source distribution, any arbitrage signals between platforms.

### For model-level specifics:
- Configuration matrix: engine/trans/body options observed, price effect of each
- Generation/era timeline with collector significance
- Survival indicators: listing volume trend (shrinking = finite supply getting scarcer)

## Source Popup — What to Show

### Kill these metrics:
- Data fill rates
- Median price
- "New this week" as a raw count

### Replace with:
1. **What's live right now** — Active auctions/listings, ending soon
2. **Recent results** — What sold this week, hammer prices, sell-through rate
3. **Source character** — What this source is good at (BaT = curated high-end, CL = full spectrum regional, FB = trending younger sellers)
4. **Makes that dominate** — Still useful but with context (% of this source's inventory, not raw count)

## Facet Popup (Year, Drivetrain, Trans, etc.)

### The insight:
A facet popup should EXPLAIN the dimension, not just filter by it. "4WD" means different things for a K10 (the whole point) vs a Suburban (expected). The popup should contextualize.

### Show:
1. **Facet identity and market meaning** — What does this dimension mean in the collector market?
2. **Intersection with current view** — How does adding this filter change the result set, price distribution, geographic mix?
3. **Co-occurrence map** — What travels with this facet? "4WD trucks almost always have V8s." "Manual trans 4WD is rare (15%)."
4. **Specific vehicles** — Recent examples with thumbnails, clickable to vehicle popup
5. **TAB button** — Opens filtered feed in new browser tab

## Anti-Patterns (What NOT to Show)

1. Average or median price over dirty data
2. Price range over heterogeneous data
3. Year range (obvious, useless)
4. Data fill rates (internal metric)
5. Raw counts as the primary metric
6. Alphabetical model lists (nobody thinks alphabetically)
7. Any aggregate computed from `LIMIT 500` samples
8. Star ratings or quality scores without transparent methodology
9. Flat attribute dumps
10. "Similar vehicles" based only on make/model without configuration matching

## Implementation Priority

1. Strip garbage metrics from existing popups
2. Add live activity (what's live, what just sold)
3. Make all specs clickable → relevant context popup
4. Build configuration similarity scoring for comparable sales
5. Build apparition history (cross-platform sightings)
6. Build generation/era taxonomy for Chevrolet trucks (proving ground)

## The Vehicle Generation Problem

The user identified that model naming is broken. "1500 REGULAR" mixes tonnage with cab style. The system doesn't understand:
- 67-72 "Action Line" C/K
- 73-87 "Squarebody"
- 88-91 "R/V series" (overlaps: Suburban, Jimmy, Blazer have different cutoffs)
- 92-00 "OBS" (Old Body Style)
- Crew cabs, cab & chassis have their own timelines

This is a data modeling problem, not just a display problem. The `vehicle_nomenclature` table exists (26 rows, thin) but needs to be built out with generation/era/platform taxonomies. This is prerequisite to showing meaningful model groupings in popups.
