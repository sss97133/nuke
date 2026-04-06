# 11. Supply Side — Technical Implementation

## The supply side of the knowledge graph: suppliers, parts, fitment, gap computation, and resolution UI.

---

## Overview

The supply side connects the vehicle's computed needs (demand) to the parts market (supply). It consists of four database structures, one scraping pipeline, one computation layer, and one UI surface.

```
SCRAPING PIPELINE                    KNOWLEDGE GRAPH                      UI SURFACE
                                     (Supply Side)
Firecrawl          ───┐                                         ┌───> Diagnostic Panel
Manual curation    ───┤    ┌──────────────────────────┐         │     (vehicle profile)
Forum mining       ───┼───>│  suppliers               │         │
Purchase history   ───┤    │  parts_catalog            │────────>├───> Work Order
Conversation logs  ───┘    │  fitment_mapping          │         │     (add line item)
                           │  capability_profiles      │         │
                           └──────────────────────────┘         └───> Coaching System
                                      ×                               (ARS recommendations)
                           ┌──────────────────────────┐
                           │  Vehicle Demand Side      │
                           │  (factory spec + mods     │
                           │   + computed loads)       │
                           └──────────────────────────┘
                                      =
                           ┌──────────────────────────┐
                           │  GAP DIAGNOSIS            │
                           │  + RESOLUTION OPTIONS     │
                           └──────────────────────────┘
```

---

## Schema

### Table: `suppliers`

Registry of companies that sell parts relevant to our vehicle population.

```sql
CREATE TABLE suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,              -- 'singer-alternators', 'summit-racing'
  display_name TEXT NOT NULL,             -- 'Singer Alternators'
  supplier_type TEXT NOT NULL             -- 'catalog' | 'bespoke'
    CHECK (supplier_type IN ('catalog', 'bespoke')),
  website_url TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  location_city TEXT,
  location_state TEXT,
  specialization TEXT[],                  -- ['alternators', 'electrical']
  vehicle_coverage TEXT,                  -- 'GM trucks 1960-present'
  reputation_notes TEXT,                  -- 'Huge in car audio, hand-built, copper heatsinks'
  price_tier TEXT                         -- 'budget' | 'mid' | 'premium' | 'bespoke'
    CHECK (price_tier IN ('budget', 'mid', 'premium', 'bespoke')),
  warranty_terms TEXT,                    -- 'Lifetime' | '1 year' | '90 days'
  lead_time_days INT,                    -- NULL for in-stock catalog suppliers
  trust_score NUMERIC(3,2) DEFAULT 0.70, -- 0.00-1.00, same framework as observation sources
  scraped_at TIMESTAMPTZ,                -- last time catalog was refreshed
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE suppliers IS 'Registry of parts suppliers. Not a comprehensive auto parts database — curated set of suppliers relevant to vehicles in our system.';
```

### Table: `parts_catalog`

Scraped product data from catalog suppliers.

```sql
CREATE TABLE parts_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  category TEXT NOT NULL,                 -- 'alternator', 'brake_kit', 'exhaust', 'suspension'
  manufacturer TEXT,                      -- 'Powermaster', 'JS Alternators' (may differ from supplier)
  product_name TEXT NOT NULL,             -- '140A CS130 High Output Alternator'
  sku TEXT,                               -- supplier's part number
  manufacturer_pn TEXT,                   -- manufacturer's part number (if different)

  -- Pricing (testimony with short half-life)
  price_cents INT,                        -- price in cents to avoid float issues
  price_scraped_at TIMESTAMPTZ,           -- when this price was observed
  price_url TEXT,                         -- source URL for the price

  -- Specifications (JSONB — varies by category)
  specs JSONB DEFAULT '{}',
  -- alternator example: {"peak_amps": 140, "idle_amps": 70, "voltage": 14.2,
  --   "pulley_type": "v-belt", "case_type": "CS130", "wiring": "one-wire",
  --   "internal_regulator": true, "finish": "natural"}
  -- brake_kit example: {"type": "disc_conversion", "position": "rear",
  --   "rotor_diameter_in": 11.0, "caliper_type": "single_piston"}

  -- Fitment (denormalized for query speed, normalized in fitment_mapping)
  fitment_summary TEXT,                   -- '1969-1986 GM K-series, SBC 350/305'
  fitment_notes TEXT,                     -- 'Requires plug adapter SI-to-CS'

  -- Metadata
  warranty TEXT,                          -- 'Lifetime', '1 year'
  source_url TEXT,                        -- product page URL
  image_url TEXT,                         -- product image
  discontinued BOOLEAN DEFAULT FALSE,
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_parts_catalog_category ON parts_catalog(category);
CREATE INDEX idx_parts_catalog_supplier ON parts_catalog(supplier_id);
CREATE INDEX idx_parts_catalog_specs ON parts_catalog USING gin(specs);

COMMENT ON TABLE parts_catalog IS 'Scraped product data from catalog suppliers. Prices are testimony with short half-lives — always check price_scraped_at.';
```

### Table: `parts_fitment`

Normalized fitment mapping connecting parts to vehicles.

```sql
CREATE TABLE parts_fitment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id UUID NOT NULL REFERENCES parts_catalog(id) ON DELETE CASCADE,
  year_min INT,                           -- 1969
  year_max INT,                           -- 1986
  make TEXT,                              -- 'GMC', 'Chevrolet'
  model_pattern TEXT,                     -- 'K2500%' (LIKE pattern for model matching)
  engine_pattern TEXT,                    -- '5.7L%' or '350%'
  submodel TEXT,                          -- 'Sierra Classic', 'Scottsdale'
  modification_required TEXT,             -- 'Plug adapter SI-to-CS, ~$10'
  wiring_notes TEXT,                      -- 'Big 3 upgrade required for 200A+'
  belt_notes TEXT,                        -- 'Requires 1/2" shorter belt with overdrive pulley'
  confidence NUMERIC(3,2) DEFAULT 0.90,   -- fitment confidence (1.0 = manufacturer confirmed)
  source TEXT,                            -- 'manufacturer_listing', 'forum_confirmed', 'inferred'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_parts_fitment_vehicle ON parts_fitment(make, year_min, year_max);
CREATE INDEX idx_parts_fitment_part ON parts_fitment(part_id);

COMMENT ON TABLE parts_fitment IS 'Fitment mapping connecting parts_catalog to vehicle specs. Uses pattern matching for flexible year/model coverage.';
```

### Table: `supplier_capabilities`

Capability profiles for bespoke builders (no SKU catalog).

```sql
CREATE TABLE supplier_capabilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  category TEXT NOT NULL,                 -- 'alternator', 'exhaust_fabrication'
  output_range TEXT,                      -- '200-540A'
  price_range_cents_min INT,              -- 40000 ($400)
  price_range_cents_max INT,              -- 60000 ($600)
  vehicle_coverage TEXT,                  -- 'Any GM, any Ford, most imports'
  build_approach TEXT,                    -- 'Hairpin stator, copper plate heatsink, custom billet'
  notable_features TEXT[],                -- ['external_regulator', 'adjustable_voltage', 'remote_rectifier']
  ordering_process TEXT,                  -- 'Call Mike, discuss setup, built in 2-3 weeks'
  competition_presence TEXT,              -- 'Stickers on SPL competition cars worldwide'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE supplier_capabilities IS 'Capability profiles for bespoke builders who do not have fixed product catalogs.';
```

---

## Fitment Query

The core query that matches a vehicle to available parts:

```sql
-- Find alternator options for a specific vehicle
SELECT
  pc.product_name,
  s.display_name AS supplier,
  s.supplier_type,
  pc.price_cents / 100.0 AS price,
  pc.specs->>'peak_amps' AS peak_amps,
  pc.specs->>'idle_amps' AS idle_amps,
  pc.warranty,
  pf.modification_required,
  pf.wiring_notes,
  pc.source_url
FROM parts_catalog pc
JOIN suppliers s ON s.id = pc.supplier_id
JOIN parts_fitment pf ON pf.part_id = pc.id
WHERE pc.category = 'alternator'
  AND NOT pc.discontinued
  AND pf.make IN ('GMC', 'Chevrolet')           -- K2500 is GMC or Chevy
  AND 1983 BETWEEN pf.year_min AND pf.year_max  -- year match
  AND ('5.7L' LIKE pf.engine_pattern OR pf.engine_pattern IS NULL)
ORDER BY
  (pc.specs->>'idle_amps')::int DESC,            -- highest idle output first
  pc.price_cents ASC;                            -- then cheapest
```

For bespoke builders, a separate query against `supplier_capabilities`:

```sql
SELECT
  s.display_name,
  sc.output_range,
  sc.price_range_cents_min / 100.0 AS price_min,
  sc.price_range_cents_max / 100.0 AS price_max,
  sc.build_approach,
  sc.ordering_process,
  s.contact_phone,
  s.warranty_terms
FROM supplier_capabilities sc
JOIN suppliers s ON s.id = sc.supplier_id
WHERE sc.category = 'alternator'
  AND s.supplier_type = 'bespoke';
```

The UI merges both result sets into a single ranked list.

---

## Gap Computation

### Electrical System Example

```sql
-- Compute electrical gap for a vehicle
WITH factory_spec AS (
  SELECT output_amps AS factory_amps
  FROM alternators_generators
  WHERE vehicle_id = :vehicle_id
    AND is_original = true
),
installed_loads AS (
  -- Sum electrical loads from installed accessories
  -- (vehicle_observations with kind = 'component_installed')
  SELECT COALESCE(SUM(
    (structured_data->>'peak_draw_amps')::numeric
  ), 0) AS total_load_amps
  FROM vehicle_observations
  WHERE vehicle_id = :vehicle_id
    AND kind = 'component_installed'
    AND structured_data->>'peak_draw_amps' IS NOT NULL
),
base_load AS (
  -- Every vehicle has ~30-40A base electrical draw
  SELECT 35 AS base_amps
)
SELECT
  fs.factory_amps,
  il.total_load_amps + bl.base_amps AS computed_demand,
  fs.factory_amps - (il.total_load_amps + bl.base_amps) AS surplus_or_deficit,
  CASE
    WHEN fs.factory_amps >= (il.total_load_amps + bl.base_amps) THEN 'adequate'
    WHEN fs.factory_amps >= (il.total_load_amps + bl.base_amps) * 0.8 THEN 'marginal'
    ELSE 'deficit'
  END AS status
FROM factory_spec fs, installed_loads il, base_load bl;
```

When `status = 'deficit'`, trigger the fitment query above and present options.

---

## Scraping Pipeline

### For Catalog Suppliers

```
1. IDENTIFY target URLs
   - JS Alternators: /collections/all-high-output-alternators/k2500
   - Summit Racing: search results for "alternator" + vehicle filter
   - DB Electrical: product category pages

2. SCRAPE via Firecrawl
   - mcp__firecrawl__scrape_url for individual product pages
   - mcp__firecrawl__crawl_url for category pages with multiple products

3. PARSE product data
   - Extract: name, SKU, price, specs, fitment, warranty, images
   - Use AI extraction (same pattern as vehicle data extraction)
   - Validate: price > 0, amps > 0, year range makes sense

4. UPSERT to parts_catalog + parts_fitment
   - Match on supplier_id + sku to avoid duplicates
   - Update price and price_scraped_at on re-scrape
   - Flag discontinued if product page returns 404

5. SCHEDULE re-scrape
   - Prices: monthly (short half-life)
   - Product availability: monthly
   - New products: quarterly (scrape category pages, not just known URLs)
```

### For Bespoke Builders

Manual curation from research sessions. When a conversation discovers a new bespoke builder:

1. Create supplier row with `supplier_type = 'bespoke'`
2. Create capability profile row(s)
3. Source: the conversation itself (cite session date)

This happens ~5-10 times total, not at scale.

---

## Seed Data (From March 31 Research)

The alternator conversation already produced enough data to seed the system:

### Suppliers

| slug | display_name | type | specialization | price_tier |
|------|-------------|------|---------------|------------|
| js-alternators | JS Alternators | catalog | alternators | mid |
| powermaster | Powermaster | catalog | alternators, starters | mid |
| tuff-stuff | Tuff Stuff Performance | catalog | alternators, starters | mid |
| db-electrical | DB Electrical | catalog | alternators, starters | budget |
| eagle-high | Eagle High | catalog | alternators | budget |
| singer-alternators | Singer Alternators | bespoke | alternators | bespoke |
| brand-x-electrical | Brand X Electrical | bespoke | alternators | bespoke |
| mechman | Mechman Alternators | catalog | alternators | premium |
| summit-racing | Summit Racing | catalog | all categories | varies |
| lmc-truck | LMC Truck | catalog | restoration parts | mid |

### Parts (subset — from actual research)

| supplier | product | peak_amps | price | fitment |
|----------|---------|-----------|-------|---------|
| JS Alternators | 12SI 250A V-Belt | 250 | $399 | 1969-1986 GM K-series 5.7L |
| JS Alternators | 12SI 320A V-Belt | 320 | $449 | 1969-1986 GM K-series 5.7L |
| Eagle High | 200A High Output | 200 | ~$150 | 1983-1985 Chevy/GMC C/K 5.0/5.7L |

### Capabilities (bespoke)

| builder | output_range | price_range | approach |
|---------|-------------|-------------|---------|
| Singer Alternators | 200-320A | $400-600 | Copper heatsink, hand-built, remote bridge rectifier |
| Brand X Electrical | 270-540A | $350-600 | Hairpin stator, external regulator, custom billet |

---

## UI Component: DiagnosticPanel

```typescript
// Progressive density — only renders when data exists
function DiagnosticPanel({ vehicleId, system }: { vehicleId: string; system: string }) {
  const gap = useGapAnalysis(vehicleId, system);
  const options = useResolutionOptions(vehicleId, system);

  // Self-guards: disappears when no data
  if (!gap || gap.status === 'adequate') return null;
  if (!options?.length) return null;

  return (
    <Panel status={gap.status}> {/* red for deficit, yellow for marginal */}
      <CurrentState spec={gap.factorySpec} demand={gap.computedDemand} />
      <GapIndicator surplus={gap.surplusOrDeficit} />
      <ResolutionOptions
        options={options}
        onAddToWorkOrder={(partId) => addWorkOrderLineItem(vehicleId, partId)}
      />
    </Panel>
  );
}
```

Follows computation surface rules:
- No cache — computes from graph state on render
- Progressive density — disappears when data is insufficient
- Popup for detail — click any option for full specs, supplier profile, forum reviews
- Action integration — "Add to Work Order" creates a `work_order_line_items` row

---

## Integration Points

| System | Integration |
|--------|------------|
| Vehicle Profile | DiagnosticPanel widget in component system sections |
| Work Orders | "Add to Work Order" creates line item with supplier, price, specs |
| ARS (Auction Readiness) | Supply-side data informs coaching ("your alternator is undersized") |
| Observation System | Scraped prices are observations with short half-lives |
| Trust Framework | Supplier trust_score follows same 0-1 scale as observation_sources |
| Timeline | Part purchase from supply side = timeline event |

---

## Anti-Patterns

```
WRONG:
  Build a "parts store" frontend with cart and checkout
  (Nuke is intelligence, not e-commerce)

RIGHT:
  Surface diagnostic data on the vehicle profile
  Link to supplier for purchase

WRONG:
  Scrape the entire Summit Racing catalog (millions of SKUs)
  (Scope explosion, most data irrelevant)

RIGHT:
  Scrape only categories + fitments relevant to vehicles in our database
  Expand from demand, not from supply

WRONG:
  Build an AI recommendation engine for parts selection
  (Over-engineering — the computation is a SQL join)

RIGHT:
  Rank by idle_output DESC, price ASC
  Let the user choose

WRONG:
  Create new tables for each parts category
  (alternator_catalog, brake_catalog, exhaust_catalog)

RIGHT:
  One parts_catalog table with category column and JSONB specs
  Category-specific specs live in the specs JSONB field
```

---

## Measurement

How to know the supply side is working:

- **Query time**: vehicle gap diagnosis + resolution options < 200ms
- **Coverage**: % of vehicles with at least one component system modeled on supply side
- **Conversion**: parts added to work orders from diagnostic panel vs. manual research
- **Freshness**: % of prices scraped within last 30 days
- **Accuracy**: fitment complaints (parts that didn't actually fit) → feeds back to fitment confidence scores

---

*This is the technical implementation spec. The philosophical case is in `docs/library/intellectual/contemplations/the-supply-side.md`. The operational playbook is in `docs/playbooks/SUPPLIER_INTELLIGENCE_PIPELINE.md`.*
