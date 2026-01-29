# Structure-First Extraction Approach

## Concept

**Before extracting, index the structure** - Understand what data exists and where, then extract systematically.

```
PHASE 1: INDEX STRUCTURE (Catalog what exists)
  ↓
  Understand page structure
  Identify field locations
  Map extraction patterns
  ↓
PHASE 2: EXTRACT DATA (Use structure knowledge)
  ↓
  Extract using known patterns
  Validate against structure
  Handle edge cases
```

---

## Why Structure-First?

### Problems with Blind Extraction
- ❌ Don't know what fields exist
- ❌ Don't know field locations/patterns
- ❌ Missing data goes unnoticed
- ❌ Inconsistent extraction across pages

### Benefits of Structure-First
- ✅ Know exactly what to extract
- ✅ Know where fields are located
- ✅ Can validate completeness
- ✅ Consistent extraction patterns

---

## Implementation: Site Schema Catalog

### Step 1: Catalog Site Structure

**Create**: `source_site_schemas` table

```sql
CREATE TABLE IF NOT EXISTS source_site_schemas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Site Identity
  domain TEXT NOT NULL, -- '111motorcars.com', 'jordanmotorsports.com'
  site_type TEXT CHECK (
    site_type IN (
      'directory',
      'dealer_website',
      'auction_house',
      'marketplace',
      'builder',
      'manufacturer',
      'broker',
      'service_shop',
      'supplier',
      'fabricator',
      'oem',
      'platform'
    )
  ),
  
  -- Structure Mapping
  schema_data JSONB NOT NULL, -- Catalog of available fields and their locations
  
  -- Example schema_data structure:
  -- {
  --   "profile_fields": {
  --     "name": { "selector": "h1.dealer-name", "type": "text" },
  --     "logo": { "selector": "img.dealer-logo", "type": "image" },
  --     "license": { "pattern": "/DL\\s*([A-Z0-9]+)/", "type": "text" },
  --     "phone": { "selector": ".contact-phone", "type": "phone" }
  --   },
  --   "inventory_fields": {
  --     "listing_url": { "selector": "a.listing-link", "type": "url" },
  --     "price": { "selector": ".price", "type": "number" },
  --     "vin": { "pattern": "/([A-HJ-NPR-Z0-9]{17})/", "type": "vin" }
  --   },
  --   "pagination": {
  --     "next_page": { "selector": "a.next-page", "type": "url" }
  --   }
  -- }
  
  -- Metadata
  cataloged_at TIMESTAMPTZ DEFAULT NOW(),
  last_verified_at TIMESTAMPTZ,
  is_valid BOOLEAN DEFAULT true,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(domain)
);
```

### Step 2: Schema Discovery Process

**Function**: `catalog-dealer-site-structure`

1. **Fetch sample pages** (homepage, about, inventory)
2. **Analyze structure** with AI/Firecrawl
3. **Catalog available fields** and their locations
4. **Store schema** in `source_site_schemas`

---

## Example: Cataloging Classic.com Structure

### Discovery Phase

```typescript
// catalog-classic-com-structure.ts

async function catalogClassicComStructure() {
  // Sample profile page
  const sampleUrl = 'https://www.classic.com/s/111-motorcars-ZnQygen/';
  
  // Use AI to analyze structure
  const structure = await analyzePageStructure(sampleUrl);
  
  // Returns:
  {
    "profile_fields": {
      "name": { 
        "locations": ["h1", ".dealer-title"],
        "extraction_method": "dom_selector"
      },
      "logo": {
        "locations": ["img[src*='uploads/dealer']"],
        "pattern": "https://images.classic.com/uploads/dealer/.*\\.png",
        "extraction_method": "regex"
      },
      "dealer_license": {
        "locations": ["body text"],
        "pattern": "/License[\\s:]+([A-Z0-9-]+)/i",
        "extraction_method": "regex"
      },
      "website": {
        "locations": ["a.external-link"],
        "extraction_method": "dom_selector"
      },
      "inventory_url": {
        "locations": ["metadata", "dealer website + /inventory"],
        "extraction_method": "inferred"
      }
    },
    "available_fields": [
      "name", "logo", "website", "address", "city", "state", 
      "zip", "phone", "email", "dealer_license", "description",
      "specialties", "inventory_url"
    ],
    "required_fields": ["name", "logo", "dealer_license"],
    "extraction_confidence": 0.95
  }
}
```

### Extraction Phase

Now that we know the structure, extract systematically:

```typescript
// extract-using-catalog.ts

async function extractUsingCatalog(profileUrl: string) {
  // Get cataloged structure
  const schema = await getSiteSchema('classic.com');
  
  // Extract using known structure
  const extracted = {};
  
  for (const [field, config] of Object.entries(schema.profile_fields)) {
    switch (config.extraction_method) {
      case 'dom_selector':
        extracted[field] = await extractBySelector(config.locations[0]);
        break;
      case 'regex':
        extracted[field] = await extractByPattern(config.pattern);
        break;
      case 'ai_extraction':
        extracted[field] = await extractWithAI(field, config.context);
        break;
    }
  }
  
  // Validate completeness
  const missing = schema.required_fields.filter(f => !extracted[f]);
  if (missing.length > 0) {
    // Try alternative extraction methods
    await reExtractMissingFields(missing, extracted, schema);
  }
  
  return extracted;
}
```

---

## Enhanced Extraction Flow

### Current Flow (Blind)
```
Scrape → Extract → Hope for best
```

### Structure-First Flow
```
1. Catalog Structure (One-time per site)
   ↓
2. Extract Using Catalog
   ↓
3. Validate Against Catalog
   ↓
4. Re-extract Missing Fields
   ↓
5. Store Results
```

---

## Implementation Plan

### Phase 1: Catalog Common Sites

1. **Classic.com Profile Pages**
   - Catalog field locations
   - Document extraction patterns
   - Create schema entry

2. **Dealer Websites** (Generic structure)
   - Common patterns (DealerFire, DealerSocket)
   - Inventory page structures
   - Field location patterns

3. **Auction House Sites**
   - Event catalog structure
   - Lot listing patterns
   - Bid/price field locations

### Phase 2: Schema-Aware Extraction

Update extraction functions to:
1. Check if schema exists for site
2. Use schema-guided extraction
3. Validate against cataloged structure
4. Fall back to AI extraction if no schema

---

## Schema Catalog Example

### Classic.com Dealer Profile Schema

```json
{
  "domain": "classic.com",
  "site_type": "directory",
  "page_types": {
    "dealer_profile": {
      "url_pattern": "/s/[^/]+/",
      "fields": {
        "name": {
          "selectors": ["h1", ".dealer-title", "title"],
          "patterns": ["/([^-]+)\\s*-\\s*Classic.com/i"],
          "required": true,
          "confidence": 0.95
        },
        "logo": {
          "selectors": ["img[src*='uploads/dealer']"],
          "patterns": ["https://images.classic.com/uploads/dealer/[^\"']+\\.(png|jpg|svg)"],
          "required": true,
          "confidence": 0.98
        },
        "dealer_license": {
          "selectors": [],
          "patterns": [
            "/License[\\s:]+([A-Z0-9-]+)/i",
            "/DL[\\s#:]+([A-Z0-9-]+)/i",
            "/Dealer\\s+License[\\s:]+([A-Z0-9-]+)/i"
          ],
          "required": true,
          "confidence": 0.85
        },
        "website": {
          "selectors": ["a[href^='http']", ".dealer-website"],
          "patterns": ["https?://[^\\s\"']+\\.[a-z]{2,}"],
          "required": false,
          "confidence": 0.90
        }
      }
    }
  }
}
```

---

## Benefits

1. **Accuracy**: Know exactly what exists and where
2. **Completeness**: Can check for missing required fields
3. **Consistency**: Same structure = same extraction method
4. **Validation**: Can validate against cataloged schema
5. **Maintenance**: Update schema when site changes, not extraction code

Want me to implement this structure-first cataloging system?

