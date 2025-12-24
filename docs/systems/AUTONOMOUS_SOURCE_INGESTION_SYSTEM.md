# Autonomous Source Discovery & Ingestion System

## The Goal

**You trigger once** → **System does everything**:
1. Discovers new automotive sources
2. Researches their structure
3. Maps fields to database schema
4. Builds ingestion scrapers
5. Executes ingestion
6. Monitors and improves

**No manual DOM mapping. No manual field mapping. No manual scraper building.**

---

## Architecture

### Core Agent: `autonomous-source-ingestion-agent`

**Single entry point** that orchestrates the entire pipeline:

```typescript
// You just trigger this:
POST /functions/v1/autonomous-source-ingestion-agent
{
  "trigger": "discover_and_ingest",
  "source_hint": "dupontregistry.com" // Optional: you can hint a source
  // OR
  "discovery_mode": "auto", // Discovers sources automatically
  "target_count": 10 // How many new sources to discover and ingest
}
```

**What it does automatically:**

```
1. SOURCE DISCOVERY
   ↓
2. STRUCTURE ANALYSIS (AI-powered)
   ↓
3. FIELD MAPPING (AI-powered)
   ↓
4. SCRAPER GENERATION (AI-powered)
   ↓
5. VALIDATION & TESTING
   ↓
6. INGESTION EXECUTION
   ↓
7. MONITORING & IMPROVEMENT
```

---

## Phase 1: Autonomous Source Discovery

### Discovery Strategies

**1. Search Engine Discovery**
```typescript
async function discoverSourcesViaSearch(): Promise<SourceCandidate[]> {
  // Search for automotive marketplaces/auctions
  const queries = [
    "luxury car marketplace",
    "exotic car auction",
    "classic car dealer directory",
    "used car marketplace",
    "car auction platform"
  ];
  
  // Use Google/Bing APIs or web scraping
  // Extract domain names from results
  // Filter for automotive sites
  // Return candidates with metadata
}
```

**2. Directory Crawling**
```typescript
async function discoverFromDirectories(): Promise<SourceCandidate[]> {
  // Known directories:
  // - Automotive marketplace lists
  // - Auction house directories
  // - Dealer aggregator sites
  // Extract all domains
}
```

**3. Referral Discovery**
```typescript
async function discoverFromReferrals(): Promise<SourceCandidate[]> {
  // From existing sources:
  // - Extract links to other marketplaces
  // - Find "similar sites" sections
  // - Track cross-references
}
```

**4. User Hints**
```typescript
// You can provide hints:
{
  "source_hint": "dupontregistry.com",
  "source_type": "marketplace" // optional
}
```

### Source Candidate Structure

```typescript
interface SourceCandidate {
  domain: string;
  url: string;
  source_type: 'marketplace' | 'auction_house' | 'dealer' | 'classified' | 'unknown';
  estimated_listings: number | null;
  discovery_method: 'search' | 'directory' | 'referral' | 'hint';
  confidence: number; // 0-1
  metadata: {
    title?: string;
    description?: string;
    has_listings?: boolean;
    requires_auth?: boolean;
  };
}
```

---

## Phase 2: Autonomous Structure Analysis

### AI-Powered Site Analysis

**Uses existing `catalog-dealer-site-structure` pattern:**

```typescript
async function analyzeSourceStructure(
  sourceUrl: string,
  supabase: any
): Promise<SourceStructure> {
  // 1. Crawl site with Firecrawl
  const { html, markdown } = await crawlSite(sourceUrl);
  
  // 2. AI Analysis (using existing catalog-dealer-site-structure pattern)
  const structure = await analyzeSiteStructureWithAI(sourceUrl, html, markdown);
  
  // Returns:
  return {
    site_type: 'marketplace' | 'auction_house' | 'dealer',
    listing_pattern: '/autos/listing/{year}/{make}/{model}/{id}',
    pagination_pattern: '/autos/results/all?page={n}',
    page_types: {
      listing_page: { /* DOM selectors */ },
      browse_page: { /* DOM selectors */ },
      dealer_profile: { /* DOM selectors */ }
    },
    fields_available: ['year', 'make', 'model', 'price', 'mileage', ...],
    extraction_confidence: 0.85
  };
}
```

**AI Prompt (enhanced from existing):**

```typescript
const analysisPrompt = `You are an expert at analyzing automotive websites for data extraction.

Site: ${sourceUrl}

Analyze this site and determine:
1. Site type (marketplace, auction_house, dealer, classified)
2. URL patterns for vehicle listings
3. URL patterns for browse/search pages
4. URL patterns for dealer profiles (if applicable)
5. DOM structure for vehicle data extraction
6. Pagination patterns
7. Authentication requirements
8. Rate limiting considerations

For vehicle listings, identify selectors for:
- year, make, model, trim
- price, mileage, condition
- VIN (if available)
- description, features
- images (gallery)
- seller/dealer info
- location
- auction details (if applicable)

For browse pages, identify:
- How to extract listing URLs
- Pagination mechanism
- Filters available

For dealer profiles (if applicable):
- Dealer name, website, contact
- Inventory links
- Social media links

Return comprehensive JSON schema with selectors, patterns, and confidence scores.`;
```

---

## Phase 3: Autonomous Field Mapping

### AI-Powered Database Schema Mapping

**Automatically maps extracted fields to database schema:**

```typescript
async function mapFieldsToDatabase(
  extractedFields: string[],
  sourceStructure: SourceStructure,
  supabase: any
): Promise<FieldMapping> {
  // Get database schema
  const vehicleSchema = await getVehicleSchema(supabase);
  const organizationSchema = await getOrganizationSchema(supabase);
  
  // AI-powered mapping
  const mapping = await aiMapFields({
    extracted_fields: extractedFields,
    vehicle_schema: vehicleSchema,
    organization_schema: organizationSchema,
    source_type: sourceStructure.site_type
  });
  
  // Returns:
  return {
    vehicle_fields: {
      'year': { db_field: 'year', confidence: 0.95, transform: null },
      'make': { db_field: 'make', confidence: 0.95, transform: null },
      'model': { db_field: 'model', confidence: 0.90, transform: null },
      'price': { db_field: 'asking_price', confidence: 0.90, transform: 'parseCurrency' },
      'mileage': { db_field: 'mileage', confidence: 0.85, transform: 'parseNumber' },
      // ...
    },
    raw_data_fields: {
      'lot_number': { path: 'raw_data.lot_number', confidence: 0.80 },
      'auction_status': { path: 'raw_data.auction_status', confidence: 0.75 },
      // Fields that don't map directly go to raw_data
    },
    organization_fields: {
      'dealer_name': { db_field: 'business_name', confidence: 0.90 },
      'dealer_website': { db_field: 'website', confidence: 0.95 },
      // ...
    },
    confidence_score: 0.88
  };
}
```

**AI Mapping Prompt:**

```typescript
const mappingPrompt = `You are mapping extracted fields from an automotive website to a database schema.

EXTRACTED FIELDS:
${JSON.stringify(extractedFields, null, 2)}

DATABASE SCHEMA:
${JSON.stringify(vehicleSchema, null, 2)}

SOURCE TYPE: ${sourceStructure.site_type}

Task:
1. Map each extracted field to the appropriate database field
2. Identify fields that should go to raw_data JSONB
3. Identify fields that create organizations
4. Suggest data transformations (parseCurrency, parseNumber, etc.)
5. Assign confidence scores

Consider:
- Field name similarity
- Data type compatibility
- Source type context (auction vs marketplace vs dealer)
- Provenance tracking (use *_source, *_confidence fields)

Return JSON mapping with confidence scores.`;
```

---

## Phase 4: Autonomous Scraper Generation

### Code Generation

**Generates scraper Edge Function automatically:**

```typescript
async function generateScraper(
  sourceCandidate: SourceCandidate,
  sourceStructure: SourceStructure,
  fieldMapping: FieldMapping,
  supabase: any
): Promise<ScraperCode> {
  // Use AI to generate scraper code
  const scraperCode = await aiGenerateScraper({
    source: sourceCandidate,
    structure: sourceStructure,
    mapping: fieldMapping,
    template: getScraperTemplate() // Base template from existing scrapers
  });
  
  // Returns TypeScript code for Edge Function
  return {
    function_name: `scrape-${sourceCandidate.domain.replace(/\./g, '-')}`,
    code: scraperCode,
    dependencies: ['firecrawl', 'dom-parser', 'supabase'],
    test_cases: generateTestCases(sourceStructure)
  };
}
```

**Scraper Template (based on existing patterns):**

```typescript
// Template uses existing scrape-sbxcars / scrape-multi-source patterns
const template = `
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Auto-generated scraper for ${sourceCandidate.domain}
// Generated: ${new Date().toISOString()}

serve(async (req) => {
  // Discovery logic
  // Extraction logic
  // Queue population logic
  // Uses fieldMapping to map to database
});
`;
```

**AI Code Generation Prompt:**

```typescript
const codePrompt = `You are generating a Supabase Edge Function scraper for an automotive website.

SOURCE: ${sourceCandidate.domain}
STRUCTURE: ${JSON.stringify(sourceStructure, null, 2)}
FIELD MAPPING: ${JSON.stringify(fieldMapping, null, 2)}

Generate TypeScript code that:
1. Discovers all vehicle listings (using structure.listing_pattern)
2. Scrapes each listing (using structure.page_types.listing_page selectors)
3. Maps extracted data to database (using fieldMapping)
4. Adds to import_queue table
5. Handles pagination, rate limiting, errors

Use existing scraper patterns from the codebase:
- scrape-sbxcars for auction sites
- scrape-multi-source for general sites
- Follow same structure and error handling

Return complete, production-ready TypeScript code.`;
```

---

## Phase 5: Validation & Testing

### Automated Testing

```typescript
async function validateScraper(
  scraperCode: ScraperCode,
  sourceStructure: SourceStructure,
  supabase: any
): Promise<ValidationResult> {
  // 1. Deploy scraper to test environment
  const deployed = await deployScraper(scraperCode);
  
  // 2. Test on sample URLs
  const testResults = await testOnSamples(
    deployed.function_url,
    sourceStructure.sample_urls
  );
  
  // 3. Validate extracted data
  const validation = await validateExtractedData(
    testResults.extracted_data,
    sourceStructure.expected_fields
  );
  
  return {
    deployed: true,
    test_success_rate: testResults.success_rate,
    field_coverage: validation.field_coverage,
    data_quality: validation.data_quality,
    confidence: calculateOverallConfidence(testResults, validation),
    issues: validation.issues,
    recommendations: generateRecommendations(validation)
  };
}
```

---

## Phase 6: Ingestion Execution

### Automatic Queue Population & Processing

```typescript
async function executeIngestion(
  sourceCandidate: SourceCandidate,
  scraperCode: ScraperCode,
  supabase: any
): Promise<IngestionResult> {
  // 1. Create scrape source
  const sourceId = await createScrapeSource(sourceCandidate, supabase);
  
  // 2. Run discovery scraper
  const discovery = await invokeScraper(scraperCode.function_name, {
    action: 'discover',
    max_listings: null // Discover all
  });
  
  // 3. Populate import_queue
  const queued = discovery.listings_found;
  
  // 4. Start processing (via existing process-import-queue)
  await triggerProcessing(sourceId);
  
  return {
    source_id: sourceId,
    listings_discovered: discovery.listings_found,
    listings_queued: queued,
    processing_started: true,
    estimated_completion: calculateCompletionTime(queued)
  };
}
```

---

## Phase 7: Monitoring & Improvement

### Continuous Learning

```typescript
async function monitorAndImprove(
  sourceId: string,
  supabase: any
): Promise<ImprovementResult> {
  // 1. Monitor extraction success rate
  const health = await checkSourceHealth(sourceId, supabase);
  
  // 2. Identify failures
  const failures = await analyzeFailures(sourceId, supabase);
  
  // 3. Auto-update selectors if site changed
  if (health.success_rate < 0.8) {
    const updatedStructure = await reanalyzeStructure(sourceId, supabase);
    const updatedScraper = await updateScraper(sourceId, updatedStructure, supabase);
    return { updated: true, improvements: updatedScraper.changes };
  }
  
  return { updated: false, health };
}
```

---

## Complete Flow

### Single Command Execution

```typescript
// You just do this:
POST /functions/v1/autonomous-source-ingestion-agent
{
  "mode": "discover_and_ingest",
  "target_count": 10, // Discover and ingest 10 new sources
  "source_hints": ["dupontregistry.com"] // Optional hints
}

// System automatically:
// 1. Discovers sources (or uses hints)
// 2. Analyzes structure (AI)
// 3. Maps fields (AI)
// 4. Generates scrapers (AI)
// 5. Tests and validates
// 6. Deploys and executes
// 7. Monitors and improves

// Returns:
{
  "sources_discovered": 10,
  "sources_analyzed": 10,
  "scrapers_generated": 10,
  "scrapers_deployed": 10,
  "ingestion_started": 10,
  "estimated_vehicles": 150000,
  "estimated_completion": "2025-12-31T00:00:00Z"
}
```

---

## Database Schema

### New Tables

```sql
-- Source candidates (discovered but not yet ingested)
CREATE TABLE source_candidates (
  id UUID PRIMARY KEY,
  domain TEXT UNIQUE,
  url TEXT,
  source_type TEXT,
  estimated_listings INTEGER,
  discovery_method TEXT,
  confidence DECIMAL,
  metadata JSONB,
  status TEXT, -- 'discovered', 'analyzing', 'mapped', 'generated', 'testing', 'deployed', 'ingesting', 'complete'
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);

-- Source structures (AI analysis results)
CREATE TABLE source_structures (
  id UUID PRIMARY KEY,
  source_candidate_id UUID REFERENCES source_candidates(id),
  structure_data JSONB, -- Full structure analysis
  extraction_schema JSONB, -- DOM selectors, patterns
  confidence_score DECIMAL,
  analyzed_at TIMESTAMPTZ
);

-- Field mappings (AI mapping results)
CREATE TABLE field_mappings (
  id UUID PRIMARY KEY,
  source_structure_id UUID REFERENCES source_structures(id),
  mapping_data JSONB, -- Field mapping to database schema
  confidence_score DECIMAL,
  mapped_at TIMESTAMPTZ
);

-- Generated scrapers
CREATE TABLE generated_scrapers (
  id UUID PRIMARY KEY,
  source_candidate_id UUID REFERENCES source_candidates(id),
  function_name TEXT,
  code TEXT, -- Generated TypeScript code
  validation_results JSONB,
  deployed_at TIMESTAMPTZ,
  status TEXT -- 'generated', 'testing', 'validated', 'deployed', 'failed'
);

-- Ingestion jobs
CREATE TABLE ingestion_jobs (
  id UUID PRIMARY KEY,
  source_candidate_id UUID REFERENCES source_candidates(id),
  scraper_id UUID REFERENCES generated_scrapers(id),
  source_id UUID REFERENCES scrape_sources(id),
  status TEXT,
  listings_discovered INTEGER,
  listings_queued INTEGER,
  listings_processed INTEGER,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
```

---

## Implementation Priority

### Phase 1: Core Agent (Week 1)
- [ ] Build `autonomous-source-ingestion-agent` Edge Function
- [ ] Source discovery (search + hints)
- [ ] Structure analysis (use existing `catalog-dealer-site-structure`)
- [ ] Field mapping (AI-powered)
- [ ] Basic scraper generation

### Phase 2: Code Generation (Week 2)
- [ ] Scraper code generation (AI)
- [ ] Template system
- [ ] Code validation
- [ ] Auto-deployment

### Phase 3: Testing & Validation (Week 3)
- [ ] Automated testing
- [ ] Data quality validation
- [ ] Confidence scoring
- [ ] Auto-improvement

### Phase 4: Execution & Monitoring (Week 4)
- [ ] Queue population
- [ ] Processing orchestration
- [ ] Health monitoring
- [ ] Auto-updates

---

## Example: duPont Registry (Autonomous)

**What you do:**
```bash
curl -X POST .../autonomous-source-ingestion-agent \
  -d '{"source_hint": "dupontregistry.com"}'
```

**What system does automatically:**

1. **Discovers**: Finds duPont Registry, identifies it as marketplace
2. **Analyzes**: Crawls site, identifies listing patterns, DOM structure
3. **Maps**: Maps fields to database schema (year→year, price→asking_price, etc.)
4. **Generates**: Creates `scrape-dupontregistry` Edge Function
5. **Tests**: Validates on sample listings
6. **Deploys**: Deploys scraper
7. **Executes**: Discovers 14,821 listings, queues them, starts processing
8. **Monitors**: Tracks progress, fixes issues automatically

**Result**: 14,821 vehicles ingested with zero manual work.

---

## Summary

**You trigger once** → **System does everything**

- ✅ Discovers sources automatically
- ✅ Analyzes structure with AI
- ✅ Maps fields with AI
- ✅ Generates scrapers with AI
- ✅ Tests and validates
- ✅ Deploys and executes
- ✅ Monitors and improves

**No manual mapping. No manual coding. Just results.**

