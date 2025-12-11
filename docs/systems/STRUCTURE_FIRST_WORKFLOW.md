# Structure-First Extraction Workflow

## Philosophy

**Index structure first, then extract systematically.**

Know what data exists and where it is before attempting extraction. This ensures:
- ✅ Accurate extraction (know what to target)
- ✅ Complete extraction (can validate against catalog)
- ✅ Consistent extraction (same structure = same method)
- ✅ Maintainable (update schema when site changes, not extraction code)

---

## Two-Phase Workflow

### Phase 1: Catalog Structure (One-Time)

**Goal**: Understand the site structure - what fields exist and where they are.

```bash
# Catalog Classic.com structure
node scripts/catalog-classic-com-structure.js

# Output:
# ✅ Structure cataloged successfully!
# 📊 Schema Summary:
#    Domain: classic.com
#    Confidence: 95.0%
# 📋 Cataloged Fields (12):
#    - name [REQUIRED]
#    - logo_url [REQUIRED]
#    - dealer_license [REQUIRED]
#    - website
#    - address, city, state, zip
#    - phone, email
#    - description
#    - specialties
```

**What happens:**
1. Fetches sample Classic.com dealer profile
2. Analyzes HTML structure with AI
3. Catalogs field locations (CSS selectors, regex patterns)
4. Stores schema in `dealer_site_schemas` table

---

### Phase 2: Extract Using Catalog

**Goal**: Use cataloged structure to extract data systematically.

```bash
# Extract dealer profile using catalog
curl -X POST \
  https://your-project.supabase.co/functions/v1/extract-using-catalog \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.classic.com/s/111-motorcars-ZnQygen/"
  }'

# Response:
{
  "success": true,
  "data": {
    "name": "111 Motorcars",
    "logo_url": "https://images.classic.com/uploads/dealer/One_Eleven_Motorcars.png",
    "dealer_license": "DL-12345",
    "website": "https://www.111motorcars.com",
    ...
  },
  "extraction_method": "catalog_guided",
  "completeness": 0.95,
  "validation": {
    "is_complete": true,
    "missing_required": [],
    "completeness_score": 0.95
  }
}
```

**What happens:**
1. Looks up cataloged schema for domain
2. Uses cataloged selectors/patterns to extract each field
3. Validates completeness against required fields
4. Returns structured data with validation metrics

---

## Schema Structure

Stored in `dealer_site_schemas.schema_data`:

```json
{
  "page_types": {
    "dealer_profile": {
      "url_pattern": "/s/[^/]+/",
      "fields": {
        "name": {
          "selectors": ["h1", ".dealer-title"],
          "patterns": ["/([^-]+)\\s*-\\s*Classic.com/i"],
          "required": true,
          "extraction_method": "dom_selector",
          "confidence": 0.95,
          "verified_selectors": ["h1"],
          "verified_patterns": []
        },
        "logo_url": {
          "selectors": ["img[src*='uploads/dealer']"],
          "patterns": ["https://images.classic.com/uploads/dealer/[^\"']+\\.(png|jpg|svg)"],
          "required": true,
          "extraction_method": "regex",
          "confidence": 0.98,
          "verified_selectors": ["img[src*='uploads/dealer']"],
          "verified_patterns": ["https://images.classic.com/uploads/dealer/.*\\.png"]
        }
      }
    }
  },
  "available_fields": ["name", "logo_url", "dealer_license", "website", ...],
  "required_fields": ["name", "logo_url", "dealer_license"],
  "extraction_confidence": 0.95
}
```

---

## Benefits Over Blind Extraction

### Before (Blind Extraction)
```
Scrape → Try to extract → Hope for best → Missing fields → Try again
```

**Problems:**
- Don't know what fields exist
- Don't know where fields are
- Can't validate completeness
- Inconsistent extraction

### After (Structure-First)
```
Catalog structure → Extract using catalog → Validate completeness → Re-extract missing
```

**Benefits:**
- ✅ Know exactly what to extract
- ✅ Know where fields are located
- ✅ Can validate against catalog
- ✅ Consistent, repeatable extraction

---

## Example: Classic.com Dealer Indexing

### Step 1: Catalog Structure (One-Time)

```bash
node scripts/catalog-classic-com-structure.js
```

### Step 2: Extract All Dealers Using Catalog

```javascript
// scripts/extract-classic-com-dealers-with-catalog.js

async function extractDealersWithCatalog(profileUrls) {
  for (const url of profileUrls) {
    // Uses catalog automatically
    const result = await supabase.functions.invoke('extract-using-catalog', {
      body: { url }
    });
    
    // Can validate completeness
    if (result.data.validation.is_complete) {
      // Create organization
    } else {
      // Missing required fields - log for review
      console.log(`⚠️  Incomplete: ${url}`);
      console.log(`   Missing: ${result.data.validation.missing_required.join(', ')}`);
    }
  }
}
```

---

## Fallback Strategy

If no catalog exists, `extract-using-catalog` falls back to AI extraction:

```javascript
{
  "extraction_method": "ai_fallback",  // vs "catalog_guided"
  "schema_used": null
}
```

This ensures extraction still works even without a catalog, but catalog-guided extraction is more accurate and faster.

---

## Maintenance

When a site structure changes:

1. **Update catalog**:
   ```bash
   node scripts/catalog-classic-com-structure.js
   ```

2. **Verify changes**:
   ```bash
   node scripts/catalog-classic-com-structure.js verify
   ```

3. **Schema automatically updated** in database

Extraction code doesn't need to change - it uses the updated catalog automatically!

---

## Next Steps

1. ✅ Catalog Classic.com structure
2. ✅ Update `index-classic-com-dealer` to use catalog
3. ✅ Catalog common dealer website structures (DealerFire, DealerSocket)
4. ✅ Create cataloging for auction house sites

