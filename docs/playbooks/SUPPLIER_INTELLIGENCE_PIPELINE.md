# Supplier Intelligence Pipeline Playbook

**Origin:** Session 2026-03-31. User researched alternator upgrades for the Granholm K2500 manually. Six web searches, four page fetches, 20 minutes. The result was a good recommendation. The result also evaporated. This playbook exists so that research becomes infrastructure.

---

## The Problem Statement

When a user says "what alternator should I put on the K2500," the system should answer in under a second from its own knowledge graph. Instead, it has zero data about parts suppliers, zero data about aftermarket components, and zero ability to match a vehicle's computed needs to available products. Every parts question triggers a manual research session that cannot be reused.

The Granholm K2500 has a factory Delco 10SI alternator (63A peak, ~32A at idle). It runs QTP electric cutouts, upgraded lighting, and potentially an electric fan — drawing ~80A peak. The system can compute this deficit. It cannot tell you what to do about it.

---

## The Model

### The Knowledge Graph Has Two Sides

**Demand side** (already modeled): What the vehicle IS and what it NEEDS.
- Factory specs → installed mods → computed loads → gaps

**Supply side** (not modeled): What EXISTS to serve those needs.
- Suppliers → products → fitment → specs → price → availability

The product is in the **join**: vehicle gap × supply catalog = ranked resolution options.

---

## What Must Exist

### 1. Supplier Registry

A table of companies that sell parts relevant to the vehicles in our system.

Not every auto parts store. The curated set of suppliers whose products are relevant to the collector/enthusiast vehicle market. The registry is small — dozens to low hundreds of entries — and mostly hand-curated with metadata about specialization, reputation, and sourcing approach.

Two supplier types, modeled differently:
- **Catalog supplier** (Summit, JS Alternators, DB Electrical, LMC Truck) — has products with SKUs, prices, fitment. Scrapable.
- **Bespoke builder** (Singer Alternators, Brand X Electrical, local fabricators) — has capabilities, not products. Stored as capability profiles.

Sources for discovery:
- Conversations like the alternator session (proven: we found 6+ suppliers in one conversation)
- Forum recommendations (BaT comments, GM Square Body forum, GMT400)
- The user's own purchase history (Amazon, Summit, eBay — already identified in POST_SALE_BUILD_TRACKING)
- Existing work order line items (every part purchased for the Granholm build came from somewhere)

### 2. Parts Catalog

Scraped product data from catalog suppliers. Each row is a product with:
- Manufacturer, product name, SKU/part number
- Category (alternator, brake kit, exhaust component, shock, etc.)
- Specifications (output amps, idle amps, voltage, weight, dimensions — varies by category)
- Fitment (year range, make, model, engine, submodel)
- Price (scraped, with timestamp — prices are testimony with short half-lives)
- Warranty terms
- Source URL
- Scrape timestamp

The catalog is built incrementally. Start with one category (alternators) for one vehicle segment (1973-1987 GM trucks). Prove the model. Expand.

Scraping approach:
- **Firecrawl** for JS Alternators, Powermaster, Tuff Stuff, DB Electrical (structured product pages)
- **Summit Racing API** if available, otherwise firecrawl their search results
- **Amazon** product pages via firecrawl (for commodity parts like Eagle High)
- **eBay completed listings** for price validation

### 3. Capability Profiles (Bespoke Builders)

For builders who don't have product catalogs:

- Builder name, contact info, location
- Output range (e.g., "200-540A custom")
- Vehicle coverage (e.g., "any GM, any Ford, most imports")
- Build approach (hand-wound stator, hairpin, etc.)
- Price range (e.g., "$400-600 depending on output")
- Lead time (e.g., "2-3 weeks build to order")
- Warranty (e.g., "lifetime")
- Reputation signals (forum mentions, competition presence, years in business)

This is a handful of rows per builder. Mostly curated from research like the alternator session.

### 4. Fitment Mapping

The bridge between supply and demand:
- Product → fits vehicle (year range, make, model, engine)
- Uses existing vehicle spec data for matching
- Must handle fuzzy fitment ("1969-1986 GM trucks with SBC" covers 20+ year/model combinations)
- Must handle modification context ("requires plug adapter" or "needs Big 3 wiring upgrade")

### 5. Gap Computation

The system already has the pieces for demand-side gap computation:
- `alternators_generators` table (schema exists, empty)
- `vehicle_observations` for installed components
- Factory spec data from VIN decode and reference tables

The gap computation is:
```
installed_capacity (from component tables or observations)
  vs.
computed_demand (from accessory inventory + load calculations)
  =
deficit or surplus
```

When deficit exists → query supply catalog → present options.

### 6. Diagnostic Panel (UI)

A vehicle profile widget that appears only when:
- A component system has enough data to compute adequacy (progressive density)
- A deficit exists
- Supply catalog has matching products

Shows:
- Current state and spec
- Computed gap (red/yellow/green)
- Ranked resolution options (from supply catalog)
- "Add to Work Order" action per option

---

## The Alternator Case Study — What Should Have Happened

### With Supply Side Built

User asks: "what alternator for the K2500?"

System responds in <1 second:

> **Electrical System — DEFICIT**
>
> Factory: Delco 10SI, 63A peak, ~32A at idle
> Installed accessories: QTP QTEC50CP cutouts (15-20A), upgraded lighting (15A)
> Computed peak demand: ~80A
> Idle output shortfall: ~48A
>
> **Recommended upgrades (3 options):**
>
> | Option | Output | Idle Output | Price | Warranty | Fit |
> |--------|--------|-------------|-------|----------|-----|
> | Powermaster CS130 140A | 140A | ~70-80A | $289 | 1 year | Bolt-on + adapter |
> | JS Alternators 250A 12SI | 250A | ~125A | $399 | Lifetime | Direct fit, V-belt |
> | Singer Custom (call Mike) | 200-320A | ~100-160A | $400-600 | Lifetime | Custom built to spec |
>
> Singer and JS both exceed your computed demand by >2x. Powermaster is the minimum viable upgrade.
>
> [Add to Work Order ▾]

That's the product. The conversation that took 20 minutes becomes a widget that renders in milliseconds.

---

## Scraping Priority

Start narrow. Prove the model with one category on one vehicle segment.

### Phase 1: Alternators for 1973-1987 GM Trucks (Square Body)

| Supplier | Type | Scrape Method | Est. Products |
|----------|------|---------------|---------------|
| JS Alternators | Catalog | Firecrawl product pages | ~30-50 |
| Powermaster (Summit) | Catalog | Firecrawl Summit search results | ~20-30 |
| Tuff Stuff (Summit) | Catalog | Firecrawl Summit search results | ~15-25 |
| DB Electrical | Catalog | Firecrawl product pages | ~10-20 |
| Eagle High (Amazon) | Catalog | Firecrawl Amazon product page | ~5-10 |
| Singer Alternators | Bespoke | Capability profile from research | 1 profile |
| Brand X Electrical | Bespoke | Capability profile from research | 1 profile |
| Mechman | Catalog/Bespoke | Firecrawl + capability profile | ~10-20 + 1 profile |

**Total: ~100-180 product rows + 3 capability profiles.** This is a few hours of work.

### Phase 2: Expand Categories

Once the model is proven with alternators:
- Brake kits (disc conversion kits for drum-brake trucks)
- Suspension (shocks, springs, lift kits)
- Exhaust components (headers, mufflers, cutouts, tubing)
- Cooling (radiators, electric fans, fan controllers)

Each category follows the same pattern: identify 5-10 key suppliers, scrape catalogs, build fitment maps.

### Phase 3: Expand Vehicle Coverage

Once the categories are proven on square body GMs:
- GMT400 (1988-1998 GM trucks)
- 1967-1972 GM trucks
- Ford F-series (1973-1979, 1980-1986)
- Jeep CJ/YJ/TJ

The vehicle coverage expands based on what's in the Nuke database. Scrape suppliers for vehicles we actually have, not the entire automotive aftermarket.

---

## Existing Infrastructure to Use

| Need | Existing System |
|------|----------------|
| Web scraping | Firecrawl MCP (`mcp__firecrawl__scrape_url`) |
| Data storage | Supabase (new tables via migration) |
| Vehicle specs | `vehicles`, `alternators_generators`, component subsystem tables |
| Work order integration | `work_orders`, `work_order_line_items` |
| Observation framework | `vehicle_observations`, `observation_sources` |
| Trust/provenance | Existing trust scoring framework applies directly |
| UI rendering | Vehicle profile computation surface pattern |
| Price decay | Half-life model (prices are short-half-life testimony) |

Nothing new needs to be invented. The supply side is an application of existing patterns to a new domain.

---

## What NOT to Build

- **A parts store.** Nuke does not sell parts or take orders.
- **A price comparison engine.** The goal is not "cheapest alternator" — it's "right alternator for this truck at this price point."
- **A universal automotive parts database.** Start with what we need for vehicles we have. Grow from demand.
- **A recommendation AI.** The computation is a SQL join with a sort. No ML needed.
- **Custom scraping infrastructure.** Firecrawl already handles JS-rendered product pages.

---

## Implementation Priority

1. **Schema: supplier registry + parts catalog + fitment mapping** — DDL migration
2. **Seed: alternator suppliers from the March 31 research** — the data already exists in the conversation
3. **Scrape: JS Alternators K2500 collection** — firecrawl one product page, parse, insert
4. **Compute: gap detection for K2500 electrical** — query installed components vs. load
5. **Display: diagnostic panel on vehicle profile** — progressive density widget
6. **Expand: remaining alternator suppliers** — Powermaster via Summit, Mechman, etc.
7. **Expand: second category** — pick based on next parts conversation that triggers manual research

---

*This playbook establishes the operational guide for building the supply side. The philosophical case is in `docs/library/intellectual/contemplations/the-supply-side.md`. The technical implementation spec is in `docs/library/technical/engineering-manual/11-supply-side.md`.*
