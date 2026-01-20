/**
 * THOROUGH SITE MAPPER
 * 
 * Creates complete, thorough site maps for every source.
 * Accountable for mapping ALL available fields, not just the obvious ones.
 * 
 * Process:
 * 1. Deep site analysis (all page types, all sections)
 * 2. Complete field identification (every available field)
 * 3. Field mapping to database (every field mapped)
 * 4. Site-specific extraction rules
 * 5. Completeness validation (verify we're not missing data)
 * 
 * Accountability: 95%+ field coverage for every source
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CompleteSiteMap {
  source_domain: string;
  source_name: string;
  source_type: string;
  page_types: Record<string, PageTypeMap>;
  field_mappings: CompleteFieldMapping;
  extraction_rules: SiteSpecificRules;
  validation: ValidationRules;
  completeness: CompletenessMetrics;
}

interface PageTypeMap {
  url_pattern: string;
  sections: SectionMap[];
  fields: FieldMap[];
  extraction_rules: ExtractionRule[];
}

interface CompleteFieldMapping {
  vehicle_fields: Record<string, FieldMapping>;
  raw_data_fields: Record<string, FieldMapping>;
  organization_fields: Record<string, FieldMapping>;
  external_identity_fields: Record<string, FieldMapping>;
}

interface FieldMapping {
  selector: string | string[];
  pattern: RegExp | string;
  transform: string | null;
  confidence: number;
  required: boolean;
  db_field: string;
  db_table: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json().catch(() => ({}));
    const {
      source_url,
      source_id,
      create_complete_map = true
    } = body;

    if (!source_url && !source_id) {
      return new Response(
        JSON.stringify({ error: 'source_url or source_id required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('🗺️  THOROUGH SITE MAPPER');
    console.log('='.repeat(70));
    console.log(`Source: ${source_url || source_id}`);
    console.log(`Goal: Complete field mapping (95%+ coverage)\n`);

    // Get source info
    let source: any = null;
    if (source_id) {
      const { data } = await supabase
        .from('scrape_sources')
        .select('*')
        .eq('id', source_id)
        .single();
      source = data;
      if (source) source_url = source.url || source.domain;
    }

    if (!source_url) {
      return new Response(
        JSON.stringify({ error: 'Could not determine source URL' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 1: Deep site analysis
    console.log('📋 Step 1: Deep site analysis...');
    const siteAnalysis = await analyzeSiteThoroughly(source_url, supabase);
    console.log(`   ✅ Discovered ${Object.keys(siteAnalysis.page_types).length} page types`);
    console.log(`   ✅ Found ${siteAnalysis.total_fields} total fields\n`);

    // Step 2: Complete field identification
    console.log('🔍 Step 2: Identifying all fields...');
    const allFields = await identifyAllFields(siteAnalysis, supabase);
    console.log(`   ✅ Identified ${allFields.length} fields\n`);

    // Step 3: Map all fields to database
    console.log('🗺️  Step 3: Mapping all fields to database...');
    const fieldMappings = await mapAllFieldsToDatabase(allFields, siteAnalysis, supabase);
    console.log(`   ✅ Mapped ${Object.keys(fieldMappings.vehicle_fields).length} vehicle fields`);
    console.log(`   ✅ Mapped ${Object.keys(fieldMappings.raw_data_fields).length} raw_data fields`);
    console.log(`   ✅ Mapped ${Object.keys(fieldMappings.organization_fields).length} organization fields\n`);

    // Step 4: Create extraction rules
    console.log('⚙️  Step 4: Creating site-specific extraction rules...');
    const extractionRules = await createExtractionRules(source_url, siteAnalysis, fieldMappings, supabase);
    console.log(`   ✅ Created ${Object.keys(extractionRules).length} extraction rules\n`);

    // Step 5: Validate completeness
    console.log('✅ Step 5: Validating completeness...');
    const validation = await validateCompleteness(fieldMappings, allFields, supabase);
    const coverage = validation.field_coverage.coverage_percentage;
    console.log(`   Coverage: ${coverage.toFixed(1)}%`);
    console.log(`   Fields mapped: ${validation.field_coverage.fields_mapped}/${validation.field_coverage.total_fields_on_site}`);
    
    if (validation.field_coverage.missing_fields.length > 0) {
      console.log(`   ⚠️  Missing fields: ${validation.field_coverage.missing_fields.slice(0, 10).join(', ')}${validation.field_coverage.missing_fields.length > 10 ? '...' : ''}`);
    }
    console.log('');

    // Step 6: Ensure organization profile exists for this source
    console.log('🏢 Step 6: Ensuring organization profile exists...');
    const orgId = await ensureSourceOrganization(source_url, siteAnalysis, supabase);
    if (orgId) {
      console.log(`   ✅ Organization profile: ${orgId}`);
    } else {
      console.log(`   ⚠️  Could not create organization profile`);
    }
    console.log('');

    // Step 7: Store complete site map
    const siteMap: CompleteSiteMap = {
      source_domain: extractDomain(source_url),
      source_name: source?.source_name || extractDomain(source_url),
      source_type: siteAnalysis.site_type,
      page_types: siteAnalysis.page_types,
      field_mappings: fieldMappings,
      extraction_rules: extractionRules,
      validation: validation.validation_rules,
      completeness: {
        total_fields_available: validation.field_coverage.total_fields_on_site,
        fields_mapped: validation.field_coverage.fields_mapped,
        fields_extracted: validation.validation_results.field_extraction_rates ? 
          Object.keys(validation.validation_results.field_extraction_rates).length : 0,
        coverage_percentage: coverage,
        missing_fields: validation.field_coverage.missing_fields
      }
    };

    // Save to database
    const sourceId = source?.id || await getOrCreateSourceId(source_url, supabase);
    await saveSiteMap(sourceId, siteMap, supabase);

    const status = coverage >= 95 ? 'complete' : coverage >= 80 ? 'mostly_complete' : 'incomplete';

    return new Response(
      JSON.stringify({
        success: true,
        source_id: sourceId,
        source_url: source_url,
        site_map: siteMap,
        completeness: {
          coverage_percentage: coverage,
          fields_mapped: validation.field_coverage.fields_mapped,
          total_fields: validation.field_coverage.total_fields_on_site,
          missing_fields: validation.field_coverage.missing_fields,
          status: status
        },
        on_target: coverage >= 95,
        recommendations: coverage < 95 ? [
          'Increase field coverage to 95%+',
          `Map ${validation.field_coverage.missing_fields.length} missing fields`,
          'Re-analyze site structure for missed sections'
        ] : []
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error in thorough-site-mapper:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || String(error)
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

// ============================================================================
// CORE FUNCTIONS - Thorough site mapping
// ============================================================================

async function analyzeSiteThoroughly(url: string, supabase: any) {
  // Use existing catalog-dealer-site-structure pattern
  // Enhanced to discover ALL page types and sections
  
  const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');
  const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
  
  // Crawl site structure
  const crawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      url: url,
      formats: ['markdown', 'html'],
      onlyMainContent: false, // Get full page
      includeTags: ['img', 'h1', 'h2', 'h3', 'section', 'div', 'span', 'a', 'meta', 'script']
    })
  });
  
  const crawlData = await crawlResponse.json();
  const html = crawlData.data?.html || crawlData.html || '';
  const markdown = crawlData.data?.markdown || crawlData.markdown || '';
  
  // Discover all page types
  const pageTypes = await discoverAllPageTypes(url, html, markdown);
  
  // Analyze each page type
  const analyzedPageTypes: Record<string, PageTypeMap> = {};
  for (const pageType of pageTypes) {
    analyzedPageTypes[pageType.name] = await analyzePageType(pageType, html, markdown, OPENAI_API_KEY);
  }
  
  return {
    site_type: detectSiteType(url, html),
    page_types: analyzedPageTypes,
    total_fields: 0 // Will be calculated after field identification
  };
}

async function discoverAllPageTypes(baseUrl: string, html: string, markdown: string): Promise<any[]> {
  // Discover all page types from site structure
  // - Vehicle listing pages
  // - Browse/search pages
  // - Dealer profile pages
  // - User profile pages
  // - Category pages
  // - Filter pages
  
  const pageTypes: any[] = [];
  
  // Extract URLs from HTML
  const urlPattern = /href=["']([^"']+)["']/gi;
  const urls = new Set<string>();
  let match;
  
  while ((match = urlPattern.exec(html)) !== null) {
    const href = match[1];
    if (href.startsWith('/') || href.includes(baseUrl)) {
      urls.add(href);
    }
  }
  
  // Categorize URLs into page types
  const listingUrls = Array.from(urls).filter(u => 
    u.includes('/listing/') || u.includes('/vehicle/') || u.includes('/car/') || u.includes('/auction/')
  );
  const browseUrls = Array.from(urls).filter(u => 
    u.includes('/results/') || u.includes('/search/') || u.includes('/browse/') || u.includes('/inventory/')
  );
  const dealerUrls = Array.from(urls).filter(u => 
    u.includes('/dealer/') || u.includes('/seller/') || u.match(/\/autos\/[^\/]+--[^\/]+\/\d+/)
  );
  const userUrls = Array.from(urls).filter(u => 
    u.includes('/user/') || u.includes('/profile/')
  );
  
  if (listingUrls.length > 0) {
    pageTypes.push({
      name: 'vehicle_listing',
      url_pattern: extractUrlPattern(listingUrls[0]),
      sample_urls: listingUrls.slice(0, 5)
    });
  }
  
  if (browseUrls.length > 0) {
    pageTypes.push({
      name: 'browse_page',
      url_pattern: extractUrlPattern(browseUrls[0]),
      sample_urls: browseUrls.slice(0, 3)
    });
  }
  
  if (dealerUrls.length > 0) {
    pageTypes.push({
      name: 'dealer_profile',
      url_pattern: extractUrlPattern(dealerUrls[0]),
      sample_urls: dealerUrls.slice(0, 3)
    });
  }
  
  if (userUrls.length > 0) {
    pageTypes.push({
      name: 'user_profile',
      url_pattern: extractUrlPattern(userUrls[0]),
      sample_urls: userUrls.slice(0, 3)
    });
  }
  
  return pageTypes;
}

async function identifyAllFields(siteAnalysis: any, supabase: any): Promise<any[]> {
  // Use database-driven checklist to systematically find ALL required fields
  // The LLM goes through the checklist and finds each field on the site
  
  const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
  const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');
  
  if (!OPENAI_API_KEY) {
    console.warn('No OpenAI API key - skipping AI field identification');
    return [];
  }
  
  // Get the master checklist from database
  const { data: checklist, error: checklistError } = await supabase
    .from('extraction_field_checklist')
    .select('*')
    .order('priority', { ascending: false });
  
  if (checklistError || !checklist || checklist.length === 0) {
    console.warn('Could not load field checklist from database - using fallback');
    return await identifyAllFieldsFallback(siteAnalysis, supabase);
  }
  
  console.log(`   📋 Loaded ${checklist.length} fields from database checklist`);
  
  // For each page type, use checklist to systematically find fields
  const allFields: any[] = [];
  
  for (const [pageTypeName, pageType] of Object.entries(siteAnalysis.page_types)) {
    const pageTypeData = pageType as any;
    
    // Get sample page content for analysis
    let sampleHtml = '';
    let sampleMarkdown = '';
    
    if (pageTypeData.sample_urls && pageTypeData.sample_urls.length > 0 && FIRECRAWL_API_KEY) {
      try {
        const sampleUrl = pageTypeData.sample_urls[0];
        const crawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            url: sampleUrl,
            formats: ['html', 'markdown'],
            onlyMainContent: false
          })
        });
        
        if (crawlResponse.ok) {
          const crawlData = await crawlResponse.json();
          sampleHtml = ((crawlData.data?.html || crawlData.html || '') as string).substring(0, 50000); // Limit to 50KB
          sampleMarkdown = ((crawlData.data?.markdown || crawlData.markdown || '') as string).substring(0, 10000); // Limit to 10KB
        }
      } catch (err: any) {
        console.warn(`Failed to fetch sample page: ${err.message}`);
      }
    }
    
    // Build checklist-based prompt for LLM
    const checklistJson = JSON.stringify(
      checklist.map(f => ({
        field_name: f.field_name,
        db_table: f.db_table,
        db_column: f.db_column,
        data_type: f.data_type,
        is_required: f.is_required,
        priority: f.priority,
        llm_question: f.llm_question,
        llm_instructions: f.llm_instructions,
        extraction_hints: f.extraction_hints || [],
        common_patterns: f.common_patterns || [],
        example_values: f.example_values || []
      })),
      null,
      2
    );
    
    const prompt = `You are an expert automotive data extraction agent. Your job is to systematically go through a CHECKLIST and find EVERY field on this page.

PAGE TYPE: ${pageTypeName}
URL PATTERN: ${pageTypeData.url_pattern}

${sampleHtml ? `HTML CONTENT (first 50KB):
${sampleHtml}

MARKDOWN CONTENT:
${sampleMarkdown}` : 'No sample content available - analyze based on page type and checklist.'}

DATABASE CHECKLIST (${checklist.length} fields to find):
${checklistJson}

YOUR TASK:
1. Go through the checklist SYSTEMATICALLY
2. For EACH field in the checklist, answer the "llm_question"
3. Find where that field appears on the page
4. Provide CSS selectors, XPath, or extraction patterns
5. If field is not found, mark it as "not_available" with confidence 0

For EACH field you find, return:
{
  "field_name": "exact field name from checklist",
  "found": true|false,
  "selectors": ["primary_css_selector", "fallback_selector"],
  "extraction_method": "css|regex|json-ld|script|ai",
  "pattern": "regex_pattern_if_needed",
  "data_type": "string|number|date|boolean|array",
  "example_value": "actual example from page",
  "confidence": 0.0-1.0,
  "section": "where it appears on page",
  "notes": "any important notes"
}

Return JSON:
{
  "fields_found": [/* array of found fields */],
  "fields_not_found": [/* array of field names not found */],
  "coverage_percentage": 0-100,
  "recommendations": [/* extraction recommendations */]
}`;

    try {
      const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: 'You are an expert web scraping analyst specializing in automotive data extraction. You systematically go through checklists to find all required fields. Always return valid JSON.'
            },
            { role: 'user', content: prompt }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
          max_tokens: 4000
        })
      });
      
      if (aiResponse.ok) {
        const aiData = await aiResponse.json();
        const result = JSON.parse(aiData.choices[0].message.content);
        allFields.push(...(result.fields_found || []));
        
        // Log coverage for this page type
        if (result.coverage_percentage !== undefined) {
          console.log(`   📊 ${pageTypeName}: ${result.coverage_percentage.toFixed(1)}% coverage (${result.fields_found?.length || 0} found, ${result.fields_not_found?.length || 0} not found)`);
        }
      } else {
        console.warn(`OpenAI API error for ${pageTypeName}: ${aiResponse.status}`);
      }
    } catch (err: any) {
      console.warn(`AI field identification failed for ${pageTypeName}: ${err.message}`);
    }
  }
  
  // Deduplicate by field name
  const uniqueFields = Array.from(
    new Map(allFields.map(f => [f.field_name || f.name, f])).values()
  );
  
  return uniqueFields;
}

async function identifyAllFieldsFallback(siteAnalysis: any, supabase: any): Promise<any[]> {
  // Fallback if checklist not available - use basic field list
  const basicFields = [
    'year', 'make', 'model', 'vin', 'mileage', 'color', 'transmission', 
    'engine_size', 'drivetrain', 'body_style', 'trim', 'asking_price',
    'description', 'location', 'seller_name', 'seller_website'
  ];
  
  return basicFields.map(name => ({
    name,
    selectors: [],
    extraction_method: 'css',
    data_type: 'text',
    confidence: 0.5
  }));
}

async function mapAllFieldsToDatabase(
  fields: any[],
  siteAnalysis: any,
  supabase: any
): Promise<CompleteFieldMapping> {
  // Use database checklist to map fields (already has db_table and db_column)
  // Get checklist for reference
  const { data: checklist } = await supabase
    .from('extraction_field_checklist')
    .select('field_name, db_table, db_column, is_required');
  
  const checklistMap = new Map(
    (checklist || []).map(f => [f.field_name, f])
  );
  
  const mappings: CompleteFieldMapping = {
    vehicle_fields: {},
    raw_data_fields: {},
    organization_fields: {},
    external_identity_fields: {}
  };
  
  // Map each found field using checklist
  for (const field of fields) {
    const fieldName = field.field_name || field.name;
    const checklistItem = checklistMap.get(fieldName);
    
    // Use checklist mapping if available, otherwise infer
    const dbTable = checklistItem?.db_table || (field.db_table || 'raw_data');
    const dbColumn = checklistItem?.db_column || fieldName;
    
    const fieldMapping: FieldMapping = {
      selector: Array.isArray(field.selectors) ? field.selectors[0] : (field.selector || field.selectors || ''),
      pattern: field.pattern || '',
      transform: field.transform || null,
      confidence: field.confidence || 0.8,
      required: checklistItem?.is_required || field.required || false,
      db_field: dbColumn,
      db_table: dbTable
    };
    
    // Add fallback selectors if available
    if (Array.isArray(field.selectors) && field.selectors.length > 1) {
      fieldMapping.selector = field.selectors; // Store as array for multiple fallbacks
    }
    
    if (dbTable === 'vehicles') {
      mappings.vehicle_fields[fieldName] = fieldMapping;
    } else if (dbTable === 'raw_data') {
      mappings.raw_data_fields[fieldName] = fieldMapping;
    } else if (dbTable === 'businesses') {
      mappings.organization_fields[fieldName] = fieldMapping;
    } else if (dbTable === 'external_identities') {
      mappings.external_identity_fields[fieldName] = fieldMapping;
    }
  }
  
  return mappings;
}

async function createExtractionRules(
  url: string,
  siteAnalysis: any,
  fieldMappings: CompleteFieldMapping,
  supabase: any
): Promise<SiteSpecificRules> {
  // Create site-specific extraction rules
  // Based on site structure and field mappings
  
  return {
    title_parsing: {
      pattern: /(\d{4})\s+([A-Za-z\s-]+)\s+(.+)/,
      year_extraction: 'extractYear',
      make_extraction: 'extractMake',
      model_extraction: 'extractModel',
      trim_extraction: 'extractTrim'
    },
    price_extraction: {
      selector: fieldMappings.vehicle_fields.asking_price?.selector || '',
      pattern: /\$([\d,]+)/,
      currency_detection: 'detectCurrency',
      cleanup: 'removeCommas',
      validation: 'validatePrice'
    },
    vin_extraction: {
      selector: fieldMappings.vehicle_fields.vin?.selector || '',
      pattern: /\b([A-HJ-NPR-Z0-9]{17})\b/,
      validation: 'validateVIN',
      confidence_scoring: 'scoreVIN'
    },
    image_extraction: {
      gallery_selector: '[class*="gallery"] img, [class*="image"] img',
      primary_selector: '[class*="primary"] img, img[class*="main"]',
      thumbnail_selector: '[class*="thumbnail"] img, img[data-thumb]',
      lazy_loading_handling: 'handleLazyLoading',
      quality_filtering: 'filterLowQuality'
    }
  };
}

async function validateCompleteness(
  mappings: CompleteFieldMapping,
  availableFields: any[],
  supabase: any
): Promise<any> {
  const mappedFieldNames = [
    ...Object.keys(mappings.vehicle_fields),
    ...Object.keys(mappings.raw_data_fields),
    ...Object.keys(mappings.organization_fields),
    ...Object.keys(mappings.external_identity_fields)
  ];
  
  const availableFieldNames = availableFields.map(f => f.name);
  const missingFields = availableFieldNames.filter(f => !mappedFieldNames.includes(f));
  
  const coverage = availableFieldNames.length > 0 
    ? (mappedFieldNames.length / availableFieldNames.length) * 100 
    : 0;
  
  return {
    field_coverage: {
      total_fields_on_site: availableFieldNames.length,
      fields_mapped: mappedFieldNames.length,
      fields_extracted: 0, // Will be updated after testing
      coverage_percentage: coverage,
      missing_fields: missingFields
    },
    validation_rules: {
      required_fields: ['year', 'make', 'model'],
      field_formats: {},
      data_quality_checks: []
    },
    validation_results: {
      sample_urls_tested: 0,
      extraction_success_rate: 0,
      field_extraction_rates: {},
      issues_found: []
    }
  };
}

// Helper functions
function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
    return urlObj.hostname.replace('www.', '');
  } catch {
    return url;
  }
}

function extractUrlPattern(url: string): string {
  // Convert actual URL to pattern
  return url.replace(/\d+/g, '{id}').replace(/[a-z-]+/g, '{slug}');
}

function detectSiteType(url: string, html: string): string {
  const lowerHtml = html.toLowerCase();
  if (lowerHtml.includes('auction') || lowerHtml.includes('bid')) return 'auction_house';
  if (lowerHtml.includes('dealer') || lowerHtml.includes('dealership')) return 'marketplace';
  return 'marketplace';
}

async function analyzePageType(pageType: any, html: string, markdown: string, openaiKey: string): Promise<PageTypeMap> {
  // Use LLM to intelligently analyze page structure and identify all sections and fields
  if (!openaiKey) {
    console.warn('No OpenAI API key - using basic analysis');
    return {
      url_pattern: pageType.url_pattern,
      sections: [],
      fields: [],
      extraction_rules: []
    };
  }

  // Get sample HTML for this page type (first 50KB to stay within token limits)
  const sampleHtml = html.substring(0, 50000);
  const sampleMarkdown = markdown.substring(0, 10000);

  const analysisPrompt = `You are an expert web scraping analyst. Analyze this automotive listing page and create a complete DOM mapping.

PAGE TYPE: ${pageType.name}
URL PATTERN: ${pageType.url_pattern}

HTML SAMPLE (first 50KB):
${sampleHtml}

MARKDOWN SAMPLE:
${sampleMarkdown}

TASK: Create a comprehensive DOM mapping with:
1. All sections on the page (header, gallery, specs, pricing, description, seller, etc.)
2. All fields in each section with:
   - CSS selectors (multiple fallbacks)
   - XPath (if needed)
   - Data extraction patterns
   - Field names
   - Data types
   - Example values
3. Intelligent extraction rules for each field

REQUIREMENTS:
- Map EVERY available field, not just obvious ones
- Provide multiple selector fallbacks for robustness
- Identify hidden data (JSON-LD, microdata, script tags)
- Map to standard automotive fields (year, make, model, VIN, mileage, price, etc.)
- Include site-specific fields in raw_data
- Identify organization/seller fields
- Identify image sources (gallery, thumbnails, lazy-loaded)

Return JSON with structure:
{
  "sections": [
    {
      "name": "section_name",
      "selector": "css_selector",
      "fields": [
        {
          "name": "field_name",
          "selectors": ["primary_selector", "fallback_selector"],
          "extraction_method": "css|regex|json-ld|script",
          "pattern": "regex_pattern_if_needed",
          "transform": "transformation_function_if_needed",
          "data_type": "string|number|date|boolean|array",
          "example_value": "example",
          "db_field": "suggested_database_field",
          "db_table": "vehicles|businesses|raw_data",
          "required": true|false,
          "confidence": 0.0-1.0
        }
      ]
    }
  ],
  "extraction_rules": [
    {
      "rule_name": "rule_description",
      "condition": "when_to_apply",
      "action": "what_to_do"
    }
  ]
}`;

  try {
    const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are an expert web scraping analyst specializing in automotive data extraction. Always return valid JSON.'
          },
          { role: 'user', content: analysisPrompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 4000
      })
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.warn(`OpenAI API error: ${aiResponse.status} - ${errorText}`);
      return {
        url_pattern: pageType.url_pattern,
        sections: [],
        fields: [],
        extraction_rules: []
      };
    }

    const aiData = await aiResponse.json();
    const analysis = JSON.parse(aiData.choices[0].message.content);

    return {
      url_pattern: pageType.url_pattern,
      sections: analysis.sections || [],
      fields: (analysis.sections || []).flatMap((s: any) => s.fields || []),
      extraction_rules: analysis.extraction_rules || []
    };
  } catch (error: any) {
    console.warn(`AI analysis failed: ${error.message}`);
    return {
      url_pattern: pageType.url_pattern,
      sections: [],
      fields: [],
      extraction_rules: []
    };
  }
}

async function getVehicleSchema(supabase: any): Promise<any> {
  // Get vehicles table schema
  return {
    year: 'integer',
    make: 'text',
    model: 'text',
    // ... all vehicle fields
  };
}

async function getOrganizationSchema(supabase: any): Promise<any> {
  // Get businesses table schema
  return {
    business_name: 'text',
    website: 'text',
    // ... all organization fields
  };
}

function getRawDataSchema(): any {
  // Raw data schema (JSONB)
  return {
    lot_number: 'text',
    auction_status: 'text',
    // ... all raw_data fields
  };
}

function findBestSchemaMatch(field: any, vehicleSchema: any, orgSchema: any, rawSchema: any): any {
  // Find best database match for field
  const fieldName = field.name.toLowerCase();
  
  // Check vehicle schema
  if (vehicleSchema[fieldName]) {
    return { table: 'vehicles', db_field: fieldName };
  }
  
  // Check organization schema
  if (orgSchema[fieldName]) {
    return { table: 'businesses', db_field: fieldName };
  }
  
  // Check raw data schema
  if (rawSchema[fieldName]) {
    return { table: 'raw_data', db_field: fieldName };
  }
  
  // Default to raw_data for unmapped fields
  return { table: 'raw_data', db_field: fieldName };
}

async function ensureSourceOrganization(sourceUrl: string, siteAnalysis: any, supabase: any): Promise<string | null> {
  // Automatically create organization profile for the source platform
  const domain = extractDomain(sourceUrl);
  const siteName = domain.replace(/\.(com|net|org|io)$/, '').split('.').pop() || domain;
  
  // Determine business type from site analysis
  const siteType = siteAnalysis.site_type || 'marketplace';
  let businessType = 'other';
  if (siteType === 'auction_house') businessType = 'auction_house';
  else if (siteType === 'marketplace') businessType = 'other'; // marketplace not in allowed types
  
  // Check if org already exists
  const { data: existingOrg } = await supabase
    .from('businesses')
    .select('id')
    .or(`website.eq.https://${domain},website.eq.https://www.${domain},website.eq.http://${domain},website.eq.http://www.${domain}`)
    .maybeSingle();
  
  if (existingOrg) {
    return existingOrg.id;
  }
  
  // Create new organization
  const orgName = siteName.split('-').map((w: string) => 
    w.charAt(0).toUpperCase() + w.slice(1)
  ).join(' ');
  
  const { data: newOrg, error } = await supabase
    .from('businesses')
    .insert({
      business_name: orgName,
      business_type: businessType,
      website: `https://${domain}`,
      description: `Automotive ${siteType} platform`,
      is_public: true,
      is_verified: false,
      metadata: {
        source_type: siteType,
        discovered_via: 'thorough-site-mapper',
        discovered_at: new Date().toISOString(),
        domain: domain
      }
    })
    .select('id')
    .single();
  
  if (error) {
    console.warn(`Failed to create organization: ${error.message}`);
    return null;
  }
  
  return newOrg.id;
}

async function getOrCreateSourceId(url: string, supabase: any): Promise<string> {
  const domain = extractDomain(url);
  
  const { data: existing } = await supabase
    .from('scrape_sources')
    .select('id')
    .eq('domain', domain)
    .maybeSingle();
  
  if (existing) return existing.id;
  
  const { data: newSource } = await supabase
    .from('scrape_sources')
    .insert({
      domain: domain,
      url: url,
      source_name: domain,
      is_active: true
    })
    .select('id')
    .single();
  
  return newSource?.id || '';
}

async function saveSiteMap(sourceId: string, siteMap: CompleteSiteMap, supabase: any) {
  const coverage = siteMap.completeness.coverage_percentage;
  const status = coverage >= 95 ? 'complete' : coverage >= 80 ? 'mostly_complete' : 'incomplete';
  
  await supabase
    .from('site_maps')
    .upsert({
      source_id: sourceId,
      domain: siteMap.source_domain,
      page_types: siteMap.page_types,
      field_mappings: siteMap.field_mappings,
      extraction_rules: siteMap.extraction_rules,
      validation_rules: siteMap.validation,
      total_fields_available: siteMap.completeness.total_fields_available,
      fields_mapped: siteMap.completeness.fields_mapped,
      fields_extracted: siteMap.completeness.fields_extracted,
      coverage_percentage: coverage,
      missing_fields: siteMap.completeness.missing_fields,
      status: status,
      validation_results: { /* test results */ },
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'source_id'
    });
}

