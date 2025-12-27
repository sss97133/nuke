# Discover Organization Full

Single-organization adaptive discovery tool that learns and adapts with each extraction.

## Philosophy

- **One org at a time**: Full, comprehensive extraction per organization
- **Adaptive learning**: Reshapes itself for each site structure
- **Pattern reuse**: Learned patterns stored and reused automatically
- **Gets smarter**: Each run improves future extractions
- **Database grows, insertion points stay the same**: Same insertion logic, more data

## Usage

### Basic Discovery

```bash
curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/discover-organization-full" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "organization_id": "uuid-here"
  }'
```

### Force Rediscovery

```bash
curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/discover-organization-full" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "organization_id": "uuid-here",
    "force_rediscover": true
  }'
```

## How It Works

### 1. Site Structure Discovery

- Analyzes website structure using LLM + Firecrawl
- Identifies page types (inventory, vehicle_detail, about, contact)
- Discovers URL patterns for listings
- Detects platform/CMS if possible
- Stores structure for reuse

### 2. Pattern Learning

- Uses LLM to analyze sample pages
- Identifies extraction patterns (CSS selectors, regex, etc.)
- Checks for reusable patterns from similar sites
- Learns field mappings (price, year, make, model, VIN, etc.)
- Stores patterns in `dealer_site_schemas` table

### 3. Pattern Storage

- Stores site-specific schemas in `dealer_site_schemas`
- Can register reusable patterns in `extraction_pattern_registry`
- Patterns are automatically reused for similar sites
- Each pattern includes confidence scores and sample values

### 4. Comprehensive Extraction

- Uses learned patterns to extract all data
- Extracts vehicles, images, descriptions, prices, etc.
- Queues data for processing via `scrape-multi-source`
- Handles pagination automatically

## Response Format

```json
{
  "success": true,
  "result": {
    "organization_id": "uuid",
    "website": "https://example.com",
    "site_structure": {
      "domain": "example.com",
      "site_type": "dealer",
      "platform": "DealerFire",
      "page_types": [...],
      "listing_patterns": [...]
    },
    "extraction_patterns": [
      {
        "field_name": "price",
        "selectors": [".price", ".amount"],
        "extraction_method": "dom",
        "confidence": 0.9
      }
    ],
    "learned_patterns_stored": true,
    "vehicles_found": 45,
    "vehicles_extracted": 45,
    "vehicles_created": 45,
    "images_found": 230,
    "next_steps": [...]
  }
}
```

## Pattern Reuse

Once patterns are learned for a site:

1. **Automatic reuse**: Future runs use stored patterns (unless `force_rediscover: true`)
2. **Similar sites**: Reusable patterns can be applied to similar sites
3. **Pattern evolution**: Patterns can be updated when sites change
4. **Confidence tracking**: Success rates tracked for pattern quality

## Benefits

✅ **Adaptive**: Reshapes itself for each site structure  
✅ **Learning**: Gets smarter with each run  
✅ **Reusable**: Patterns stored and reused automatically  
✅ **Comprehensive**: Extracts everything (vehicles, images, data)  
✅ **Single-org focus**: One at a time, full extraction  
✅ **No batch issues**: No small test batches causing problems  

## Integration

This tool integrates with:

- `scrape-multi-source`: Uses learned patterns for extraction
- `process-import-queue`: Processes extracted data
- `dealer_site_schemas`: Stores learned patterns
- `extraction_pattern_registry`: Stores reusable patterns

## Example Workflow

1. Run discovery for organization A
   - Learns site structure
   - Learns extraction patterns
   - Stores patterns
   - Extracts all data

2. Run discovery for organization B (similar site)
   - Reuses patterns from organization A if similar
   - Learns site-specific adaptations
   - Stores new patterns
   - Extracts all data

3. Run discovery for organization A again
   - Uses stored patterns (faster)
   - Updates patterns if site changed
   - Extracts new/updated data

## Notes

- Uses Firecrawl for robust scraping (handles JS, bot protection)
- Uses LLM (GPT-4o) for intelligent pattern learning
- Patterns are stored per domain, so similar sites benefit
- Force rediscovery useful when site structure changes
- Extraction is comprehensive - gets everything, not just inventory

