import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * AUTO SITE MAPPER
 * 
 * Automatically analyzes automotive websites and generates DOM extraction patterns
 * Solves: "How do I map thousands of sites without doing it manually?"
 * 
 * Process:
 * 1. Crawl site structure to find vehicle listings
 * 2. Analyze DOM patterns using AI
 * 3. Generate extraction schemas
 * 4. Test extraction on sample pages
 * 5. Create reliable extraction patterns
 */

interface SiteMappingResult {
  site_url: string;
  site_type: 'dealer' | 'auction' | 'marketplace' | 'classified' | 'unknown';
  listing_pattern: string; // URL pattern for vehicle listings
  extraction_schema: {
    selectors: Record<string, string>;
    patterns: Record<string, string>;
    required_fields: string[];
    optional_fields: string[];
  };
  confidence_score: number;
  test_results: {
    sample_urls: string[];
    extraction_success_rate: number;
    field_coverage: number;
  };
  mapping_metadata: {
    platform_detected?: string; // DealerFire, DealerSocket, WordPress, etc.
    cms_type?: string;
    pagination_pattern?: string;
    rate_limits?: any;
  };
}

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    const { action, params = {} } = await req.json();
    
    switch (action) {
      case 'map_single_site':
        return await mapSingleSite(params.site_url);
      
      case 'map_batch_sites':
        return await mapBatchSites(params.site_urls || []);
      
      case 'discover_and_map':
        return await discoverAndMap(params);
      
      case 'test_extraction_pattern':
        return await testExtractionPattern(params);
      
      case 'generate_extraction_schema':
        return await generateExtractionSchema(params);
      
      default:
        return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
    }
  } catch (error) {
    console.error('Auto site mapper error:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }), { status: 500 });
  }
});

async function mapSingleSite(siteUrl: string): Promise<Response> {
  console.log(`🗺️ Auto-mapping site: ${siteUrl}`);
  
  // Step 1: Crawl site structure
  const siteStructure = await analyzeSiteStructure(siteUrl);
  
  // Step 2: Find vehicle listing patterns
  const listingPatterns = await findVehicleListingPatterns(siteUrl, siteStructure);
  
  // Step 3: Analyze sample listings for DOM patterns
  const domAnalysis = await analyzeDOMPatterns(listingPatterns.sample_urls);
  
  // Step 4: Generate extraction schema using AI
  const extractionSchema = await generateSchemaFromDOM(domAnalysis, siteUrl);
  
  // Step 5: Test extraction on samples
  const testResults = await testExtractionOnSamples(extractionSchema, listingPatterns.sample_urls);
  
  const result: SiteMappingResult = {
    site_url: siteUrl,
    site_type: detectSiteType(siteStructure, domAnalysis),
    listing_pattern: listingPatterns.url_pattern,
    extraction_schema: extractionSchema,
    confidence_score: calculateConfidenceScore(testResults),
    test_results: testResults,
    mapping_metadata: {
      platform_detected: detectPlatform(siteStructure),
      cms_type: detectCMS(siteStructure),
      pagination_pattern: listingPatterns.pagination_pattern,
      rate_limits: siteStructure.rate_limits
    }
  };
  
  // Store the mapping for reuse
  await storeSiteMapping(result);
  
  return new Response(JSON.stringify({
    success: true,
    data: result,
    recommendations: generateMappingRecommendations(result),
    timestamp: new Date().toISOString()
  }));
}

async function mapBatchSites(siteUrls: string[]): Promise<Response> {
  console.log(`🗺️ Auto-mapping ${siteUrls.length} sites in batch...`);
  
  const results = [];
  const errors = [];
  
  for (const siteUrl of siteUrls) {
    try {
      const mappingResponse = await mapSingleSite(siteUrl);
      const mappingData = await mappingResponse.json();
      results.push(mappingData.data);
      
      // Delay between sites to be respectful
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(`Failed to map ${siteUrl}:`, error);
      errors.push({ site_url: siteUrl, error: error.message });
    }
  }
  
  const summary = {
    total_sites: siteUrls.length,
    successfully_mapped: results.length,
    failed_mappings: errors.length,
    average_confidence: results.reduce((sum, r) => sum + r.confidence_score, 0) / results.length,
    high_confidence_sites: results.filter(r => r.confidence_score > 0.8).length,
    platforms_detected: [...new Set(results.map(r => r.mapping_metadata.platform_detected).filter(Boolean))]
  };
  
  return new Response(JSON.stringify({
    success: true,
    data: {
      site_mappings: results,
      mapping_errors: errors,
      summary
    },
    recommendations: generateBatchRecommendations(summary, results),
    timestamp: new Date().toISOString()
  }));
}

async function discoverAndMap(params: any): Promise<Response> {
  const { 
    search_terms = ['used cars', 'classic cars', 'auto dealer'],
    geographic_focus = ['US'],
    max_sites = 100
  } = params;
  
  console.log(`🔍 Auto-discovering automotive sites...`);
  
  // Step 1: Discover automotive sites
  const discoveredSites = await discoverAutomotiveSites(search_terms, geographic_focus, max_sites);
  
  // Step 2: Filter for mappable sites
  const mappableSites = await filterMappableSites(discoveredSites);
  
  // Step 3: Map the discovered sites
  const mappingResponse = await mapBatchSites(mappableSites.map(s => s.url));
  const mappingData = await mappingResponse.json();
  
  return new Response(JSON.stringify({
    success: true,
    data: {
      discovery_results: {
        total_discovered: discoveredSites.length,
        mappable_sites: mappableSites.length,
        filtered_out: discoveredSites.length - mappableSites.length
      },
      mapping_results: mappingData.data,
      discovered_sites: discoveredSites,
      mappable_sites: mappableSites
    },
    timestamp: new Date().toISOString()
  }));
}

// Helper functions for site analysis

async function analyzeSiteStructure(siteUrl: string) {
  // Use Firecrawl to get site structure
  const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
  if (!firecrawlKey) {
    throw new Error('Firecrawl API key not configured');
  }
  
  const response = await fetch('https://api.firecrawl.dev/v0/crawl', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${firecrawlKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: siteUrl,
      crawlerOptions: {
        includes: ['*/inventory/*', '*/vehicles/*', '*/listings/*', '*/cars/*'],
        limit: 10
      }
    })
  });
  
  const crawlData = await response.json();
  
  return {
    homepage_structure: crawlData,
    navigation_patterns: extractNavigationPatterns(crawlData),
    url_patterns: extractURLPatterns(crawlData),
    platform_indicators: detectPlatformIndicators(crawlData),
    rate_limits: { detected_limits: [] }
  };
}

async function findVehicleListingPatterns(siteUrl: string, siteStructure: any) {
  const vehicleUrls = siteStructure.url_patterns?.vehicle_urls || [];
  
  // Sample 5-10 vehicle URLs for pattern analysis
  const sampleUrls = vehicleUrls.slice(0, 10);
  
  return {
    url_pattern: extractCommonURLPattern(vehicleUrls),
    sample_urls: sampleUrls,
    pagination_pattern: siteStructure.navigation_patterns?.pagination || null,
    total_listings_estimate: vehicleUrls.length * 10 // estimate based on sample
  };
}

async function analyzeDOMPatterns(sampleUrls: string[]) {
  const domPatterns = [];
  
  for (const url of sampleUrls.slice(0, 3)) { // Analyze 3 samples
    try {
      const pageStructure = await getPageStructure(url);
      domPatterns.push(pageStructure);
    } catch (error) {
      console.warn(`Failed to analyze ${url}:`, error);
    }
  }
  
  return {
    common_patterns: findCommonDOMPatterns(domPatterns),
    field_locations: mapFieldLocations(domPatterns),
    extraction_confidence: calculateDOMConfidence(domPatterns)
  };
}

async function generateSchemaFromDOM(domAnalysis: any, siteUrl: string) {
  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openaiKey) {
    throw new Error('OpenAI API key not configured');
  }
  
  // Use AI to generate extraction schema from DOM patterns
  const prompt = `You are an expert at creating web scraping patterns. Analyze this automotive website's DOM structure and create extraction selectors.

Site: ${siteUrl}
DOM Patterns: ${JSON.stringify(domAnalysis, null, 2)}

Create extraction schema for these vehicle fields:
- year, make, model, trim
- price, mileage, condition  
- description, features
- images (main gallery)
- dealer/seller info
- location, contact info

Return JSON schema:
{
  "selectors": {
    "year": "CSS selector for year",
    "make": "CSS selector for make", 
    "model": "CSS selector for model",
    "price": "CSS selector for price",
    "mileage": "CSS selector for mileage",
    "description": "CSS selector for description",
    "images": "CSS selector for image gallery",
    "dealer_name": "CSS selector for dealer",
    "location": "CSS selector for location"
  },
  "patterns": {
    "price_regex": "regex to extract price from text",
    "mileage_regex": "regex to extract mileage",
    "year_regex": "regex to extract year"
  },
  "required_fields": ["year", "make", "model"],
  "optional_fields": ["trim", "features", "condition"],
  "confidence_estimate": 0.0-1.0
}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'user', content: prompt }
      ],
      max_tokens: 1000,
      temperature: 0.1,
      response_format: { type: "json_object" }
    })
  });
  
  const data = await response.json();
  return JSON.parse(data.choices[0].message.content);
}

async function testExtractionOnSamples(schema: any, sampleUrls: string[]) {
  let successfulExtractions = 0;
  let totalFields = 0;
  let extractedFields = 0;
  
  for (const url of sampleUrls.slice(0, 3)) {
    try {
      const extractionResult = await testSingleExtraction(url, schema);
      if (extractionResult.success) successfulExtractions++;
      
      totalFields += schema.required_fields.length + schema.optional_fields.length;
      extractedFields += extractionResult.fields_extracted;
    } catch (error) {
      console.warn(`Test extraction failed for ${url}:`, error);
    }
  }
  
  return {
    sample_urls: sampleUrls.slice(0, 3),
    extraction_success_rate: successfulExtractions / Math.min(3, sampleUrls.length),
    field_coverage: extractedFields / totalFields,
    total_tests: Math.min(3, sampleUrls.length)
  };
}

async function testSingleExtraction(url: string, schema: any) {
  // Use Firecrawl to extract using the generated schema
  const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
  
  const response = await fetch('https://api.firecrawl.dev/v0/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${firecrawlKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: url,
      formats: ['extract'],
      extract: {
        schema: schema.selectors
      }
    })
  });
  
  const result = await response.json();
  
  const fieldsExtracted = Object.values(result.extract || {}).filter(v => v && v !== '').length;
  
  return {
    success: response.ok && fieldsExtracted > 0,
    fields_extracted: fieldsExtracted,
    extraction_data: result.extract,
    raw_response: result
  };
}

async function storeSiteMapping(mapping: SiteMappingResult) {
  // Store in data_source_registry for reuse
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );
  
  await supabase
    .from('data_source_registry')
    .upsert({
      source_name: extractDomainName(mapping.site_url),
      source_url: mapping.site_url,
      source_type: mapping.site_type,
      extraction_schema: mapping.extraction_schema,
      confidence_score: Math.round(mapping.confidence_score * 100),
      last_tested: new Date().toISOString(),
      test_results: mapping.test_results,
      metadata: mapping.mapping_metadata
    }, {
      onConflict: 'source_url'
    });
}

// Site discovery functions

async function discoverAutomotiveSites(searchTerms: string[], geoFocus: string[], maxSites: number) {
  const sites = [];
  
  for (const term of searchTerms) {
    for (const geo of geoFocus) {
      try {
        const searchResults = await searchForAutomotiveSites(`${term} ${geo}`, maxSites / (searchTerms.length * geoFocus.length));
        sites.push(...searchResults);
      } catch (error) {
        console.warn(`Search failed for ${term} ${geo}:`, error);
      }
    }
  }
  
  // Deduplicate by domain
  const uniqueSites = Array.from(
    new Map(sites.map(site => [extractDomainName(site.url), site])).values()
  );
  
  return uniqueSites;
}

async function searchForAutomotiveSites(query: string, limit: number) {
  // Mock implementation - would use Google Custom Search API or similar
  const mockSites = [
    { url: 'https://dealer1.dealerfire.com', title: 'Auto Dealer 1', snippet: 'Used cars for sale' },
    { url: 'https://dealer2.dealersocket.com', title: 'Auto Dealer 2', snippet: 'New and used vehicles' },
    { url: 'https://classiccars.com', title: 'Classic Cars', snippet: 'Classic and vintage automobiles' }
  ];
  
  return mockSites.slice(0, limit);
}

async function filterMappableSites(sites: any[]) {
  const mappableSites = [];
  
  for (const site of sites) {
    try {
      const isMappable = await checkIfSiteMappable(site.url);
      if (isMappable.mappable) {
        mappableSites.push({
          ...site,
          mappability_score: isMappable.score,
          estimated_listings: isMappable.estimated_listings
        });
      }
    } catch (error) {
      console.warn(`Failed to check mappability of ${site.url}:`, error);
    }
  }
  
  return mappableSites.sort((a, b) => b.mappability_score - a.mappability_score);
}

async function checkIfSiteMappable(siteUrl: string) {
  // Quick check if site has vehicle listings and is scrapable
  const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
  
  const response = await fetch('https://api.firecrawl.dev/v0/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${firecrawlKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: siteUrl,
      formats: ['markdown']
    })
  });
  
  const result = await response.json();
  const content = result.markdown || '';
  
  // Check for automotive indicators
  const automotiveIndicators = [
    'vehicles', 'cars', 'trucks', 'inventory', 'for sale', 'price', 'mileage', 'year', 'make', 'model'
  ];
  
  const indicatorMatches = automotiveIndicators.filter(indicator => 
    content.toLowerCase().includes(indicator)
  ).length;
  
  const mappabilityScore = indicatorMatches / automotiveIndicators.length;
  
  return {
    mappable: mappabilityScore > 0.3,
    score: mappabilityScore,
    estimated_listings: estimateListingCount(content),
    indicators_found: indicatorMatches
  };
}

// Helper functions

function extractDomainName(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url;
  }
}

function detectSiteType(structure: any, domAnalysis: any): 'dealer' | 'auction' | 'marketplace' | 'classified' | 'unknown' {
  const indicators = {
    dealer: ['inventory', 'new cars', 'used cars', 'dealership'],
    auction: ['bid', 'auction', 'bidding', 'lot'],
    marketplace: ['marketplace', 'listings', 'classified'],
    classified: ['craigslist', 'autotrader', 'classified']
  };
  
  // Mock detection logic
  return 'dealer';
}

function detectPlatform(structure: any): string {
  // Detect common automotive CMS platforms
  const platformIndicators = {
    'DealerFire': ['dealerfire', 'df-'],
    'DealerSocket': ['dealersocket', 'ddc-'],
    'AutoTrader': ['autotrader'],
    'WordPress': ['wp-content', 'wordpress'],
    'Custom': []
  };
  
  return 'DealerFire'; // Mock
}

function detectCMS(structure: any): string {
  return 'WordPress'; // Mock
}

function calculateConfidenceScore(testResults: any): number {
  return (testResults.extraction_success_rate + testResults.field_coverage) / 2;
}

function generateMappingRecommendations(result: SiteMappingResult): string[] {
  const recommendations = [];
  
  if (result.confidence_score > 0.8) {
    recommendations.push('✅ High confidence mapping - ready for production extraction');
  } else if (result.confidence_score > 0.6) {
    recommendations.push('⚠️ Medium confidence - test on larger sample before production');
  } else {
    recommendations.push('❌ Low confidence - manual review required');
  }
  
  if (result.test_results.field_coverage < 0.7) {
    recommendations.push('🔍 Field coverage low - may need manual selector refinement');
  }
  
  return recommendations;
}

function generateBatchRecommendations(summary: any, results: any[]): string[] {
  const recommendations = [];
  
  if (summary.high_confidence_sites > summary.total_sites * 0.5) {
    recommendations.push(`✅ ${summary.high_confidence_sites} sites ready for automated extraction`);
  }
  
  if (summary.platforms_detected.length > 0) {
    recommendations.push(`🔧 Detected platforms: ${summary.platforms_detected.join(', ')} - can create specialized extractors`);
  }
  
  return recommendations;
}

// Mock implementations for complex functions
async function getPageStructure(url: string) {
  return { dom_structure: 'mock', selectors: {} };
}

function findCommonDOMPatterns(domPatterns: any[]) {
  return { price_selectors: ['.price'], title_selectors: ['.title'] };
}

function mapFieldLocations(domPatterns: any[]) {
  return { year: '.year', make: '.make', model: '.model' };
}

function calculateDOMConfidence(domPatterns: any[]): number {
  return 0.8; // Mock
}

function extractNavigationPatterns(crawlData: any) {
  return { pagination: null };
}

function extractURLPatterns(crawlData: any) {
  return { vehicle_urls: [] };
}

function detectPlatformIndicators(crawlData: any) {
  return { platform: 'unknown' };
}

function extractCommonURLPattern(urls: string[]): string {
  return '/inventory/vehicles/*'; // Mock pattern
}

function estimateListingCount(content: string): number {
  return Math.floor(Math.random() * 1000) + 100; // Mock estimate
}
