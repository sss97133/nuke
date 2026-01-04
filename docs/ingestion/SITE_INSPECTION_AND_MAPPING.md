# Automated Site Inspection and Data Pinpointing

## How It Works: The Structure-First Approach

The system uses a **structure-first extraction** pattern to automatically inspect sites and pinpoint data. This is how it works:

## Two-Phase Process

### Phase 1: Site Inspection & Structure Mapping (Automated)

**Goal**: Automatically discover what data exists and where it's located on the site.

**Tools Used**:
- **`discover-organization-full`** - Main function for adaptive site discovery
- **`catalog-dealer-site-structure`** - Can catalog structure and store schemas
- **LLM (GPT-4o)** - Analyzes HTML/Markdown to identify fields
- **Firecrawl** - Fetches rendered HTML with JavaScript executed

**Process**:
1. **Fetch Site Content**: Uses Firecrawl to get HTML + Markdown of key pages (homepage, inventory, vehicle details)
2. **LLM Analysis**: GPT-4o analyzes the HTML structure and identifies:
   - Available fields (name, price, VIN, description, images, etc.)
   - Field locations (CSS selectors, regex patterns, JSON-LD, script variables)
   - Page types (inventory listing, vehicle detail, profile page)
   - URL patterns for different page types
3. **Pattern Learning**: System learns extraction patterns:
   - CSS selectors with fallbacks (e.g., `.price`, `.amount`, `[data-price]`)
   - Regex patterns (e.g., `/\$([0-9,]+)/`)
   - JSON-LD structured data extraction
   - Script variable extraction
4. **Schema Storage**: Patterns stored in `dealer_site_schemas` table for reuse

**Output**: Complete site map with:
- All available fields cataloged
- Extraction methods for each field
- Confidence scores
- Sample values

### Phase 2: Data Extraction (Using Mapped Structure)

**Goal**: Extract data using the cataloged structure.

**Process**:
1. **Lookup Schema**: Retrieves stored schema from `dealer_site_schemas`
2. **Apply Patterns**: Uses learned selectors/patterns to extract each field
3. **Validation**: Validates completeness against required fields
4. **Insertion**: Inserts data into database using standard insertion points

## The Key: `discover-organization-full`

This is the **proper function** for organization ingestion. It does everything:

```
1. Inspects site structure (LLM + Firecrawl)
   ↓
2. Learns extraction patterns adaptively
   ↓
3. Stores patterns in dealer_site_schemas (for reuse)
   ↓
4. Extracts all data using learned patterns
   ↓
5. Creates vehicle profiles and links to organization
```

## Why This Works

### Traditional Scraping (What We Had)
```
Scrape → Guess what to extract → Hope it works → Missing data
```
- Don't know what fields exist
- Don't know where fields are
- Can't validate completeness
- Breaks when site changes

### Structure-First (What We Should Use)
```
Inspect → Catalog structure → Extract using catalog → Validate → Complete
```
- ✅ Know exactly what fields exist
- ✅ Know where fields are located
- ✅ Can validate completeness
- ✅ Patterns stored for reuse
- ✅ Gets smarter over time

## Example: Velocity Restorations

### Step 1: Site Inspection (Automatic)

```bash
# discover-organization-full automatically:
# 1. Fetches velocityrestorations.com with Firecrawl
# 2. LLM analyzes HTML structure
# 3. Identifies:
#    - Organization fields: name, logo, description, contact info
#    - Vehicle listing URLs: /for-sale/*, /inventory/*
#    - Vehicle fields: year, make, model, price, images, description
# 4. Learns selectors:
#    - Price: ".price", ".vehicle-price", "[data-price]"
#    - Year/Make/Model: "h1.vehicle-title", ".vehicle-info"
#    - Images: ".gallery img", "[data-image]"
# 5. Stores schema in dealer_site_schemas
```

### Step 2: Data Extraction (Automatic)

```bash
# Using stored schema:
# 1. Finds all vehicle listing URLs
# 2. Extracts each vehicle using learned selectors
# 3. Validates data completeness
# 4. Creates vehicle profiles
# 5. Links to organization
```

## Current Problem

`ingest-org-complete` was built as a naive scraper:
- ❌ No site inspection/mapping
- ❌ Blind extraction with regex patterns
- ❌ Doesn't use structure-first approach
- ❌ Doesn't learn or store patterns
- ❌ Poor data quality (missing fields, wrong data)

## Solution

**Option 1: Use Existing Function**
- Use `discover-organization-full` directly (it already does everything correctly)

**Option 2: Rebuild Using Structure-First Pattern**
- Rebuild `ingest-org-complete` to follow the structure-first pattern
- Use `dealer_site_schemas` for pattern storage
- Use LLM analysis for site inspection
- Use learned patterns for extraction

## How to Use

### For Single Organization

```bash
# Use discover-organization-full (the proper way)
curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/discover-organization-full" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "organization_id": "uuid-here",
    "force_rediscover": false
  }'
```

This will:
1. ✅ Inspect site structure (if not already cataloged)
2. ✅ Learn extraction patterns
3. ✅ Store patterns for reuse
4. ✅ Extract all vehicles and data
5. ✅ Create vehicle profiles
6. ✅ Link to organization

### For Multiple Organizations

```bash
# Use extract-all-orgs-inventory
curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/extract-all-orgs-inventory" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "limit": 10,
    "min_vehicle_threshold": 10
  }'
```

## Key Tables

- **`dealer_site_schemas`**: Stores learned site structures and extraction patterns
- **`businesses`**: Organization profiles
- **`vehicles`**: Vehicle data
- **`organization_vehicles`**: Links vehicles to organizations

## Benefits

1. **Automatic**: No manual DOM mapping needed
2. **Adaptive**: Learns patterns for each site
3. **Reusable**: Patterns stored and reused
4. **Complete**: Validates field coverage
5. **Maintainable**: Update schema when site changes, not extraction code
6. **Scalable**: Patterns can be shared across similar sites

