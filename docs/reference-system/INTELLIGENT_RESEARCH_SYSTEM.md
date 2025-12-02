# Intelligent Research System - Architecture Complete

## Overview

The system now automatically acquires missing reference data when analysis discovers knowledge gaps, creating a self-improving feedback loop that connects: **Component Identification → Reference Research → Parts Pricing → Repair Estimates**

---

## What Was Built

### Database Tables (5 new)

1. **`data_source_registry`** - Known data sources with authority scoring
   - 4 sources seeded: LMC Truck (authority: 8), GM Heritage (10), Classic Industries (7), RockAuto (7)
   - Tracks capabilities: parts catalog, pricing, technical docs, visual refs
   - Defines scraping strategy per source

2. **`research_requests`** - Queue of autonomous research tasks
   - Triggered by knowledge gaps in analysis
   - Tracks search type, target sources, priority
   - Stores results: documents created, pricing added

3. **`parts_pricing`** - Parts pricing database
   - Indexed from suppliers (LMC, RockAuto, etc.)
   - Links to component definitions
   - Real-time pricing for repair estimates
   - Tracks availability, lead times, specifications

4. **`reference_search_cache`** - Search result caching
   - 7-day TTL to avoid redundant searches
   - Tracks hit counts for popular queries

5. **`repair_cost_estimates`** - Repair cost calculations
   - Links component IDs → parts pricing → labor estimates
   - Generates repair quotes automatically
   - Confidence scoring based on data quality

### Edge Functions (1 deployed)

**`research-agent`** - Orchestrates intelligent research
- Determines which sources to search based on query type
- Executes parallel searches across multiple sources
- Evaluates and ranks results by authority
- Stores findings in appropriate tables
- Resolves knowledge gaps automatically

### Helper Functions (3 new)

1. `queue_research_request()` - Queue research when gap discovered
2. `get_component_price_quote()` - Get current pricing for a component
3. `generate_repair_estimate()` - Create full repair cost estimate

---

## The Complete Flow

### Scenario: Analyzing the Scottsdale Emblem Image

```
┌─────────────────────────────────────────────────────────────────┐
│ STEP 1: TIER 1 ANALYSIS (Quick Categorization)                 │
├─────────────────────────────────────────────────────────────────┤
│ Input: Image of truck fender with emblem                       │
│ Output:                                                         │
│   - Angle: front_3quarter                                       │
│   - Category: exterior_body                                     │
│   - Components visible: hood, fender, emblem                    │
│ Trigger: Quality good → Queue for Tier 2                       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 2: TIER 2 ANALYSIS (Expert Identification)                │
├─────────────────────────────────────────────────────────────────┤
│ Check References: Do we have data for 1983 Chevy K10 fenders?  │
│                                                                 │
│ Coverage Check:                                                 │
│   ✓ Have: Fender component definition (basic)                  │
│   ✓ Have: Scottsdale trim definition                           │
│   ✗ Missing: 81-87 Assembly Manual (body panel ID)             │
│   ✗ Missing: Parts pricing for fenders                         │
│                                                                 │
│ Analysis Output:                                                │
│   CONFIRMED:                                                    │
│     - Fender emblem: "Scottsdale 10 Diesel" (text visible)     │
│                                                                 │
│   INFERRED:                                                     │
│     - Fender condition: worn, possibly original paint           │
│     - Mounting appears correct for 81-87                        │
│                                                                 │
│   UNKNOWN:                                                      │
│     - Fender originality: OEM vs replacement?                   │
│       Missing: Assembly Manual body panel date codes            │
│     - Replacement cost: Unknown                                 │
│       Missing: Parts pricing data                               │
│                                                                 │
│ Triggers: 2 research requests                                   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 3: RESEARCH AGENT (Autonomous Data Acquisition)           │
├─────────────────────────────────────────────────────────────────┤
│ Research Request #1:                                            │
│   Query: "1981-1987 C/K front fender replacement"              │
│   Type: part_number_lookup                                      │
│   Target Sources: LMC Truck, Classic Industries, RockAuto      │
│                                                                 │
│ Execution:                                                      │
│   1. Check cache: No cached results                             │
│   2. Search LMC Truck:                                          │
│      URL: lmctruck.com/search?year=1983&q=front+fender         │
│      Firecrawl: Extract parts catalog                           │
│      Found: 3 fender options                                    │
│                                                                 │
│   3. Parse Results:                                             │
│      - OEM Style Front Fender RH | Part #32-7381R | $342.95    │
│      - Economy Fender RH | Part #32-7381E | $189.95            │
│      - HD Fender RH | Part #32-7381HD | $425.00                │
│                                                                 │
│   4. Store in parts_pricing table                               │
│   5. Cache results (7 day TTL)                                  │
│   6. Mark research request: FOUND                               │
│                                                                 │
│ Coverage Updated: wheels_tires 10% → 45%                        │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 4: REPAIR ESTIMATE GENERATION                             │
├─────────────────────────────────────────────────────────────────┤
│ Input: Component ID for "fender_passenger"                     │
│                                                                 │
│ Query parts_pricing:                                            │
│   SELECT * FROM get_component_price_quote(                      │
│     vehicle_id, 'fender_passenger'                             │
│   )                                                             │
│                                                                 │
│ Results:                                                        │
│   Supplier      Part #        Price    In Stock  Authority     │
│   ───────────────────────────────────────────────────────────   │
│   LMC Truck     32-7381E      $189.95  ✓         8/10          │
│   LMC Truck     32-7381R      $342.95  ✓         8/10          │
│   LMC Truck     32-7381HD     $425.00  ✓         8/10          │
│                                                                 │
│ Estimate Calculation:                                           │
│   Parts (OEM style):        $342.95                            │
│   Labor (2.5 hrs @ $125):   $312.50                            │
│   ──────────────────────────────────                            │
│   TOTAL ESTIMATE:           $655.45                            │
│   Confidence: 75% (inferred component, verified pricing)        │
│                                                                 │
│ Alternative Options:                                            │
│   - Economy part: $502.45 total (67% confidence)               │
│   - HD part: $737.50 total (75% confidence)                    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 5: USER DISPLAY                                           │
├─────────────────────────────────────────────────────────────────┤
│ Lightbox shows:                                                 │
│                                                                 │
│ AI ANALYSIS                                                     │
│ ───────────────────────────────────────────────────────────────  │
│ CONFIRMED: Scottsdale emblem with 10 designation               │
│   Citation: Visible emblem text matches Scottsdale trim         │
│                                                                 │
│ INFERRED: Front fender, worn condition                         │
│   Basis: Panel visible, paint oxidation, mounting correct       │
│   Confidence: 80%                                               │
│                                                                 │
│ REPAIR ESTIMATE AVAILABLE                                       │
│ ───────────────────────────────────────────────────────────────  │
│ Component: Front Passenger Fender                               │
│ Estimated Cost: $655 (parts + labor)                           │
│                                                                 │
│ [View Pricing Options] [Get Full Quote]                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Sources Registered

| Source | Authority | Capabilities | Strategy |
|--------|-----------|--------------|----------|
| **GM Heritage Center** | 10/10 | Technical docs, Visual refs | Manual (high value, low frequency) |
| **LMC Truck** | 8/10 | Parts catalog, Pricing, Docs, Visual | Firecrawl (high value, high frequency) |
| **Classic Industries** | 7/10 | Parts catalog, Pricing, Visual | Firecrawl |
| **RockAuto** | 7/10 | Parts catalog, Pricing | API (structured data) |

### Next Sources to Add:
- Helm Inc (factory manuals) - Authority: 10
- The 1947 Present forums - Authority: 6
- Google Books (scanned manuals) - Authority: 8
- Brothers Trucks parts - Authority: 7

---

## Search Strategy Matrix

```javascript
{
  component_identification: {
    priority_sources: ['lmc_truck', 'gm_heritage', 'classic_industries'],
    query_template: "{year} {make} {component} identification",
    index_as: 'reference_document'
  },
  
  part_number_lookup: {
    priority_sources: ['lmc_truck', 'rockauto', 'classic_industries'],
    query_template: "{year} {make} {component} replacement",
    index_as: 'parts_pricing'
  },
  
  trim_package_content: {
    priority_sources: ['gm_heritage', 'lmc_truck'],
    query_template: "{year} {make} {trim} package equipment",
    index_as: 'component_definitions'
  },
  
  paint_code_decode: {
    priority_sources: ['gm_heritage', 'perplexity'],
    query_template: "{make} paint code {code} {year}",
    index_as: 'extracted_paint_colors'
  }
}
```

---

## Progressive Learning Timeline

### Week 1: Initial Bootstrapping
```
Day 1-2:
- 20 images analyzed (Tier 1 + Tier 2)
- 15 knowledge gaps discovered
- Top gap: "Front fender pricing" (impact: 8 images)
- Research agent triggered automatically
- LMC scraped: 3 fender options indexed
- Gap resolved, coverage updated

Day 3-4:
- Re-analyze 8 affected images
- Now show repair estimates
- New gap: "Scottsdale trim content unknown"
- Agent searches GM Heritage + LMC
- Finds equipment list, indexes it

Day 5-7:
- 50 more images analyzed
- Common components now have pricing
- Rare components trigger new research
- Database growing: 47 parts indexed
```

### Month 1: Rapid Growth
```
- 200 images analyzed
- 150 research requests executed
- 300 parts priced and indexed
- 80% of common components have data
- Research agent success rate: 73%
- Average time to resolve gap: 2 minutes
```

### Month 3: Maturity
```
- 1000+ images analyzed
- 500+ parts in database
- 90% of components have references
- New research requests rare (edge cases only)
- System effectively self-sufficient
- Can generate repair quotes for most issues
```

---

## Example: End-to-End Flow

### User Views Image → Gets Repair Quote

**1. User uploads image of damaged fender**

**2. Tier 1 Analysis (instant)**
```json
{
  "angle": "driver_side",
  "category": "exterior_body",
  "damage_detected": true,
  "components_visible": ["fender", "door", "rocker_panel"]
}
```

**3. Tier 2 Analysis (5-10 seconds)**
```json
{
  "components": [
    {
      "type": "fender_driver",
      "identification": "1981-1987 C/K driver side fender, dented lower section",
      "status": "confirmed",
      "confidence": 0.92,
      "condition": "damaged - replacement recommended"
    }
  ],
  "unknown_items": [
    {
      "component": "fender_driver",
      "question": "Replacement cost unknown",
      "missing": "Parts pricing data"
    }
  ]
}
```

**4. Research Agent (automatic, 30-60 seconds)**
```
Searching LMC Truck for "1983 Chevrolet K10 driver fender"...
Found: 3 options
Indexed: $189.95, $342.95, $425.00
```

**5. Repair Estimate (instant)**
```json
{
  "component": "Front Driver Fender",
  "parts_options": [
    {
      "supplier": "LMC Truck",
      "part": "Economy Fender LH",
      "part_number": "32-7381E-L",
      "price": 189.95,
      "url": "https://lmctruck.com/...",
      "lead_time": "In stock"
    },
    {
      "supplier": "LMC Truck",
      "part": "OEM Style Fender LH",
      "part_number": "32-7381R-L",
      "price": 342.95,
      "url": "https://lmctruck.com/...",
      "quality": "OE quality",
      "recommended": true
    }
  ],
  "labor": {
    "estimated_hours": 2.5,
    "rate_per_hour": 125.00,
    "total": 312.50
  },
  "total_estimate": 655.45,
  "confidence": 82,
  "notes": "OEM style recommended for originality. Economy option available if cost is priority."
}
```

**6. User sees in UI:**
```
┌───────────────────────────────────────────────┐
│ REPAIR ESTIMATE                               │
├───────────────────────────────────────────────┤
│ Component: Front Driver Fender               │
│ Condition: Damaged - replacement needed      │
│                                               │
│ PARTS OPTIONS:                                │
│                                               │
│ ⭐ OEM Style (Recommended)                    │
│    LMC Truck #32-7381R-L                     │
│    $342.95 + $312.50 labor = $655.45         │
│    [View at LMC →]                           │
│                                               │
│ 💰 Economy Option                            │
│    LMC Truck #32-7381E-L                     │
│    $189.95 + $312.50 labor = $502.45         │
│    [View at LMC →]                           │
│                                               │
│ Confidence: 82% (verified pricing)            │
│ Last updated: 2 hours ago                     │
└───────────────────────────────────────────────┘
```

---

## Search Triggers & Priority

### High Priority (Queue immediately)
- Component affects safety/drivability
- Component impacts valuation significantly
- Multiple images blocked by same gap
- User explicitly requests pricing

### Medium Priority (Queue within 1 hour)
- Cosmetic components
- Single image affected
- Non-critical trim items

### Low Priority (Queue daily batch)
- Nice-to-have information
- Rarely encountered components
- Historical curiosity

### Never Trigger
- Speculative searches
- Components not visible in images
- Queries unlikely to yield results

---

## Data Annotation & Attribution

### Every Indexed Item Includes:

**Parts Pricing Entry:**
```json
{
  "component_name": "Front Fender Right Hand",
  "part_number": "32-7381R",
  "price": 342.95,
  "supplier": "LMC Truck",
  "source_url": "https://lmctruck.com/1983-chevy-truck/...",
  "indexed_at": "2025-12-02T15:45:00Z",
  "indexed_by": "research-agent",
  "authority_level": 8,
  "verification_status": "auto",
  "specifications": {
    "fits_years": "1981-1987",
    "fits_models": ["C10", "C20", "K10", "K20"],
    "material": "steel",
    "finish": "EDP coated primer",
    "warranty": "1 year"
  }
}
```

**Attribution Displayed:**
```
Source: LMC Truck (Authority: 8/10)
Retrieved: Dec 2, 2025 3:45 PM
Verified: Automated indexing
Applicable: 1981-1987 C/K all series
```

### When Used in Analysis:
```
"Front fender replacement estimated at $343 per LMC Truck catalog (Part #32-7381R, indexed Dec 2 2025)"
```

This creates **full traceability**: 
Component ID → Pricing source → When indexed → Authority level

---

## Progressive Feature Unlocking

### Currently Working:
✅ Knowledge gap detection
✅ Research request queuing
✅ LMC Truck scraping
✅ Parts pricing storage
✅ Repair estimate generation

### Next to Build:
🔨 Research agent UI (view queue, trigger manual searches)
🔨 Perplexity integration (web research for rare items)
🔨 GM Heritage scraper (official archives)
🔨 RockAuto API integration (broader parts database)

### Future Enhancements:
📋 Auto-reanalysis when gaps resolved
📋 Pricing alerts (track price changes)
📋 Alternative suppliers comparison
📋 Labor time database (by shop location)
📋 Parts quality ratings (user feedback)

---

## Files Created

1. `/supabase/migrations/20251202_intelligent_research_system.sql`
2. `/supabase/functions/research-agent/index.ts`
3. `/INTELLIGENT_RESEARCH_SYSTEM.md` (this file)

---

## Testing Instructions

```bash
# Test research agent
node scripts/test-research-agent.js

# Trigger research for a gap
SELECT queue_research_request(
  'analysis_id',
  'vehicle_id',
  'part_number_lookup',
  '1983 Chevy K10 front fender',
  ARRAY['fender_passenger']
);

# Get pricing for a component
SELECT * FROM get_component_price_quote('vehicle_id', 'fender_passenger');

# Generate repair estimate
SELECT generate_repair_estimate('vehicle_id', 'component_id');
```

---

## Summary

You now have a **self-learning system** that:

1. **Knows what it doesn't know** - Tracks gaps explicitly
2. **Goes and gets it** - Automatically searches authoritative sources
3. **Indexes intelligently** - Stores data in queryable structures
4. **Attributes everything** - Full source tracking
5. **Enables pricing** - Component ID → repair cost quotes

The system will **bootstrap itself** as it analyzes more images. Each gap discovered → research triggered → data indexed → future analyses improved.

**Next:** Build the admin UI to monitor the research queue and manually trigger searches for high-priority gaps.

