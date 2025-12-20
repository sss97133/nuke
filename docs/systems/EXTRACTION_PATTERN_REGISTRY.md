# Extraction Pattern Registry System

## Overview

This system ensures that **extraction patterns we learn stay with us** for future use. When we discover how to extract data from a new site structure (like sidebar patterns, table structures, etc.), we register those patterns so they're automatically used on future scrapes.

## The Problem

Before this system:
- ❌ Patterns discovered during debugging were lost
- ❌ Had to re-discover extraction methods for the same sites
- ❌ No way to share patterns across similar sites
- ❌ Hard-coded patterns scattered across code

## The Solution

**Three-Layer Pattern System:**

1. **Site-Specific Schemas** (`dealer_site_schemas` table)
   - Stores complete extraction schemas per domain
   - Includes selectors, patterns, field mappings
   - Example: Classic.com sidebar structure, Cantech Automotive table structure

2. **Reusable Pattern Registry** (`extraction_pattern_registry` table)
   - Stores generic patterns that work across multiple sites
   - Example: "sidebar_price_amount" pattern used by Classic.com AND Hagerty
   - Tracks which domains use each pattern

3. **Code Functions** (fallback)
   - `extractSidebarData()` - handles sidebar structures
   - `extractTableData()` - handles table structures
   - Generic extraction as final fallback

## How It Works

### 1. Pattern Discovery

When we discover a new extraction pattern (like the sidebar structure):

```typescript
// We learn: Classic.com uses .sidebar .price .price-amount for price
// We learn: Cantech uses .table.table-striped with th/td pairs
```

### 2. Pattern Registration

Register the pattern in the database:

```sql
-- Site-specific schema
INSERT INTO dealer_site_schemas (domain, site_name, schema_data, ...)
VALUES ('classic.com', 'Classic.com', '{
  "fields": {
    "price": {
      "selectors": [".sidebar .price .price-amount"],
      "pattern": "/([\\d,]+)\\.?\\d*/"
    }
  }
}'::jsonb, ...);

-- Reusable pattern (if applicable to multiple sites)
INSERT INTO extraction_pattern_registry (pattern_name, selectors, used_by_domains, ...)
VALUES ('sidebar_price_amount', '["sidebar .price .price-amount"]'::jsonb, 
        ARRAY['classic.com', 'hagerty.com'], ...);
```

### 3. Automatic Pattern Usage

The scraper automatically checks for registered patterns:

```typescript
// In scrape-vehicle/index.ts
const domain = new URL(url).hostname.replace(/^www\./, '');
const schema = await supabase
  .from('dealer_site_schemas')
  .select('schema_data')
  .eq('domain', domain)
  .single();

if (schema) {
  // Use registered schema for extraction
  // Falls back to generic extractors if schema incomplete
}
```

## Registered Patterns

### Sidebar Structure Pattern
- **Sites**: Classic.com, Hagerty
- **Pattern Name**: `sidebar_price_amount`, `sidebar_at_a_glance`
- **Fields**: price, condition, mileage, transmission
- **Selectors**: 
  - `.sidebar .price .price-amount`
  - `.sidebar .at-a-glance .odomoter` (note: handles typo)
  - `.sidebar .at-a-glance .transmission`

### Table Structure Pattern
- **Sites**: Cantech Automotive
- **Pattern Name**: `table_striped_cell`
- **Fields**: price, mileage, transmission, drive_type, year, make, model, seats, doors, fuel_type
- **Structure**: `.table.table-striped` with `th`/`td` pairs
- **Method**: Match table header text, extract corresponding cell value

## Adding New Patterns

### Step 1: Discover the Pattern

When scraping a new site, identify:
- What fields are available
- Where they're located (CSS selectors, table structure, etc.)
- What patterns/regexes are needed

### Step 2: Register the Pattern

**Option A: Site-Specific Schema** (if unique to one site)

```sql
INSERT INTO dealer_site_schemas (domain, site_name, site_type, schema_data, notes, cataloged_by)
VALUES (
  'newsite.com',
  'New Site',
  'dealer_website',
  '{
    "page_types": {
      "vehicle_listing": {
        "url_pattern": "/listing/",
        "fields": {
          "price": {
            "selectors": [".price-display"],
            "pattern": "/([\\d,]+)/",
            "extraction_method": "dom_selector"
          }
        }
      }
    }
  }'::jsonb,
  'Learned from [URL] - handles [structure description]',
  'system'
);
```

**Option B: Reusable Pattern** (if applicable to multiple sites)

```sql
INSERT INTO extraction_pattern_registry (
  pattern_name, 
  pattern_type, 
  description, 
  selectors, 
  patterns, 
  used_by_domains, 
  discovered_from
)
VALUES (
  'price_display',
  'dom_selector',
  'Extract price from .price-display structure',
  '["price-display", ".price .amount"]'::jsonb,
  '["/([\\\\d,]+)/"]'::jsonb,
  ARRAY['newsite.com'],
  'newsite.com/listing/example'
);
```

### Step 3: Update Code (if needed)

If the pattern requires new extraction logic, add a function:

```typescript
function extractNewPattern(doc: any): {
  price: number | null;
  // ... other fields
} {
  // Implementation using registered selectors/patterns
}
```

## Benefits

✅ **Patterns Persist**: Once learned, patterns are stored and reused  
✅ **Automatic Application**: Scraper checks registry before generic extraction  
✅ **Cross-Site Sharing**: Reusable patterns work across similar sites  
✅ **Documentation**: Patterns are self-documenting in the database  
✅ **Versioning**: Can track when patterns were discovered, last used, success rates  

## Migration

The initial migration (`20250117_register_learned_extraction_patterns.sql`) registers:

1. **Classic.com sidebar pattern** - price, condition, mileage, transmission
2. **Cantech Automotive table pattern** - full vehicle specs from Details/Specifications tabs
3. **Reusable patterns** - `sidebar_price_amount`, `sidebar_at_a_glance`, `table_striped_cell`

## Future Enhancements

- [ ] Auto-discovery: Use AI to detect and register new patterns
- [ ] Pattern validation: Test patterns on sample URLs before registration
- [ ] Pattern versioning: Track pattern changes over time
- [ ] Success rate tracking: Monitor which patterns work best
- [ ] Pattern suggestions: Recommend patterns for new sites based on similarity

