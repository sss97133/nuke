# AI Extraction System

## Overview

This system replaces blind trial-and-error scraping with **intelligent, one-time learning** of each source's structure. Instead of wasting API calls on failed extractions, we invest them in building reliable, source-specific extraction functions.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    AI EXTRACTION SYSTEM                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────┐    ┌──────────────────────┐            │
│  │ AI Extraction   │───▶│ Source Intelligence  │            │
│  │ Architect       │    │ (selector_hints)     │            │
│  └─────────────────┘    └──────────────────────┘            │
│         │                         │                          │
│         │ Learns site             │ Stores configs           │
│         │ structure               │                          │
│         ▼                         ▼                          │
│  ┌─────────────────┐    ┌──────────────────────┐            │
│  │ Playwright      │    │ Intelligent          │            │
│  │ Browser         │    │ Extractor            │            │
│  └─────────────────┘    └──────────────────────┘            │
│                                   │                          │
│                                   │ Uses stored configs      │
│                                   ▼                          │
│                         ┌──────────────────────┐            │
│                         │ Reliable Vehicle     │            │
│                         │ Extraction           │            │
│                         └──────────────────────┘            │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Components

### 1. AI Extraction Architect (`scripts/ai-extraction-architect.ts`)

**Purpose:** Explores a source website with AI to learn its structure and generate extraction selectors.

**Flow:**
1. Navigate to source URL
2. Find inventory page (if not already on it)
3. Capture page structure (simplified DOM)
4. Send to Claude for analysis
5. Claude generates CSS selectors for vehicle data
6. Test the selectors on the page
7. Store working config if test succeeds

**Output:** Saves extraction config to:
- `source_intelligence.selector_hints` (for scrape_sources)
- `businesses.metadata.extraction_config` (for dealer websites)

**Usage:**
```bash
npx tsx scripts/ai-extraction-architect.ts [count]
```

### 2. Intelligent Extractor (`scripts/intelligent-extractor.ts`)

**Purpose:** Uses stored extraction configs to reliably extract vehicle data. No trial-and-error.

**Flow:**
1. Load extraction config from source_intelligence
2. Navigate to stored inventory URL
3. Apply configured selectors
4. Parse year/make/model from titles
5. Save vehicles to database
6. Link to organization if applicable
7. Update extraction stats

**Usage:**
```bash
npx tsx scripts/intelligent-extractor.ts [count]
```

## Database Integration

### source_intelligence Table

Key fields used by this system:
- `selector_hints` (JSONB) - CSS selectors for extraction
- `page_structure_notes` (TEXT) - Navigation and structure info
- `requires_js_rendering` (BOOLEAN) - Whether Playwright is needed
- `recommended_extraction_method` (TEXT) - 'playwright', 'simple_fetch', etc.
- `extraction_priority` (INTEGER) - Priority for scheduling
- `vehicles_extracted` (INTEGER) - Running count
- `extraction_success_rate` (NUMERIC) - Performance tracking

### businesses.metadata

For dealer websites discovered from businesses table:
```json
{
  "extraction_config": {
    "selector_hints": {...},
    "page_structure_notes": "...",
    "requires_js_rendering": true
  },
  "extraction_confidence": 0.9,
  "extraction_tested_at": "2026-01-20T..."
}
```

## Selector Config Structure

```typescript
{
  listing_selectors: {
    vehicle_card: string;     // Main card container
    vehicle_link: string;     // Link to detail page
    title: string;            // Vehicle title
    price: string;            // Price element
    year: string | null;      // Year (if separate from title)
    make: string | null;      // Make (if separate)
    model: string | null;     // Model (if separate)
    image: string;            // Main image
    mileage: string | null;   // Mileage if available
  }
}
```

## Quality Control

The system only saves configs that pass testing:
- Must extract at least 1 vehicle in test
- Confidence score must be > 0
- Selectors must actually find elements

Failed analyses are logged but not saved, preventing bad configs from polluting the system.

## Cost Efficiency

**Before:** Trial-and-error scraping wasted API calls on failures
- Every failed extraction = wasted Anthropic tokens
- Same site failed repeatedly

**After:** One-time learning per source
- AI analyzes site once
- Config stored permanently
- Subsequent extractions use stored selectors (free)
- Only re-analyze if selectors stop working

## Monitoring

Track extraction health via:
- `source_intelligence.extraction_success_rate` - Per-source success rate
- `source_intelligence.last_extraction_at` - When last extracted
- `source_intelligence.vehicles_extracted` - Running total

## Next Steps

1. **Run architect on all sources** - Build comprehensive config library
2. **Schedule intelligent extraction** - Regular runs using stored configs
3. **Monitor and repair** - Detect when selectors break, re-run architect
4. **Expand to detail pages** - Add configs for individual vehicle pages
