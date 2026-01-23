import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

/**
 * INTELLIGENT ORGANIZATION INGESTION AGENT
 * 
 * Fully automated agent that:
 * 1. Takes a URL (that's it - no questions)
 * 2. Inspects site structure using LLM + Firecrawl
 * 3. Maps DOM structure and extraction points intelligently
 * 4. Learns and stores patterns for reuse
 * 5. Extracts all data accurately
 * 6. Fills database automatically
 * 
 * Uses API keys from Edge Function secrets (OPENAI_API_KEY, FIRECRAWL_API_KEY)
 * Runs on Supabase compute cloud
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DEALER_INSPIRE_ALGOLIA_APP_ID = 'YL5AFXM3DW';
const DEALER_INSPIRE_ALGOLIA_SEARCH_KEY = '59d32b7b5842f84284e044c7ca465498';

interface IngestRequest {
  url: string;
  force_rediscover?: boolean;
}

interface SiteStructure {
  domain: string;
  site_type: string;
  platform?: string;
  cms?: string;
  page_types: PageType[];
  listing_patterns: ListingPattern[];
  pagination_pattern?: string;
  data_sources?: Record<string, any>;
}

interface PageType {
  type: string;
  url_pattern: string;
  sample_urls: string[];
  structure_hints: string[];
}

interface ListingPattern {
  pattern_type: 'url' | 'dom' | 'api';
  pattern: string;
  confidence: number;
  sample_matches: string[];
}

interface DealerInspireAlgoliaConfig {
  app_id: string;
  search_key: string;
  index_name: string;
  query_url: string;
}

interface ExtractionPattern {
  field_name: string;
  selectors: string[];
  regex_patterns?: string[];
  extraction_method: 'dom' | 'llm' | 'api' | 'hybrid';
  confidence: number;
  sample_values: any[];
}

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url, force_rediscover = false }: IngestRequest = await req.json();

    if (!url) {
      return new Response(
        JSON.stringify({ error: 'url required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    console.log(`\n🤖 INTELLIGENT INGESTION AGENT`);
    console.log('='.repeat(70));
    console.log(`URL: ${url}\n`);

    // Step 1: Create/find organization
    console.log('📋 Step 1: Creating/finding organization...');
    const organizationId = await createOrFindOrganization(supabase, url);
    console.log(`✅ Organization ID: ${organizationId}\n`);

    // Step 2: Check for existing patterns
    let existingPatterns: any = null;
    if (!force_rediscover) {
      const domain = new URL(url).hostname;
      const { data: patterns } = await supabase
        .from('source_site_schemas')
        .select('*')
        .eq('domain', domain)
        .maybeSingle();
      
      if (patterns) {
        existingPatterns = patterns;
        console.log(`✅ Found existing patterns for ${domain}\n`);
      }
    }

    // Step 3: Inspect site structure (LLM + Firecrawl)
    console.log('🔍 Step 2: Inspecting site structure...');
    const siteStructure = await discoverSiteStructure(url, existingPatterns, supabase);
    console.log(`✅ Discovered ${siteStructure.page_types.length} page types`);
    console.log(`   Site type: ${siteStructure.site_type}`);
    if (siteStructure.platform) console.log(`   Platform: ${siteStructure.platform}\n`);

    // Step 4: Learn extraction patterns (LLM-powered DOM mapping)
    console.log('🧠 Step 3: Learning extraction patterns (DOM mapping)...');
    const extractionPatterns = await learnExtractionPatterns(
      url,
      siteStructure,
      existingPatterns,
      supabase
    );
    console.log(`✅ Learned ${extractionPatterns.length} extraction patterns\n`);

    // Step 5: Store patterns for reuse
    console.log('💾 Step 4: Storing learned patterns...');
    await storeLearnedPatterns(url, siteStructure, extractionPatterns, supabase);
    console.log(`✅ Patterns stored\n`);

    // Step 6: Extract all data using learned patterns
    console.log('📦 Step 5: Extracting data using learned patterns...');
    const extractionResult = await extractAllData(
      organizationId,
      url,
      siteStructure,
      extractionPatterns,
      supabase
    );
    console.log(`✅ Extraction complete:`);
    console.log(`   - Vehicles found: ${extractionResult.vehicles_found}`);
    console.log(`   - Vehicles extracted: ${extractionResult.vehicles_extracted}`);
    console.log(`   - Vehicles created: ${extractionResult.vehicles_created}`);
    console.log(`   - Images found: ${extractionResult.images_found}\n`);

    return new Response(
      JSON.stringify({
        success: true,
        organization_id: organizationId,
        website: url,
        site_structure: siteStructure,
        extraction_patterns: extractionPatterns.length,
        vehicles_found: extractionResult.vehicles_found,
        vehicles_created: extractionResult.vehicles_created,
        images_found: extractionResult.images_found,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * Create or find organization by website URL
 */
async function createOrFindOrganization(supabase: any, url: string): Promise<string> {
  const domain = new URL(url).hostname;
  
  // Check if organization exists
  const { data: existing } = await supabase
    .from('businesses')
    .select('id')
    .eq('website', url)
    .maybeSingle();

  if (existing) {
    return existing.id;
  }

  // Extract basic org info from homepage
  try {
    const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
      },
      body: JSON.stringify({
        url,
        formats: ['html', 'markdown'],
        onlyMainContent: false,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (firecrawlResponse.ok) {
      const firecrawlData = await firecrawlResponse.json();
      const html = firecrawlData.data?.html || '';
      const markdown = firecrawlData.data?.markdown || '';

      // Use LLM to extract organization name and basic info
      if (OPENAI_API_KEY) {
        const orgPrompt = `Extract organization information from this website:

URL: ${url}
Markdown (first 2000 chars): ${markdown.substring(0, 2000)}

Extract:
1. Organization/business name (prioritize logo alt text, header text, title tag)
2. Brief description (1-2 sentences, exclude footer boilerplate)

Return JSON:
{
  "business_name": "Company Name",
  "description": "Brief description"
}`;

        const llmResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o',
            messages: [
              {
                role: 'system',
                content: 'You are an expert at extracting business information from websites. Return only valid JSON.',
              },
              {
                role: 'user',
                content: orgPrompt,
              },
            ],
            temperature: 0.3,
            response_format: { type: 'json_object' },
          }),
          signal: AbortSignal.timeout(30000),
        });

        if (llmResponse.ok) {
          const llmData = await llmResponse.json();
          const orgInfo = JSON.parse(llmData.choices[0].message.content);
          
          const { data: newOrg, error: insertError } = await supabase
            .from('businesses')
            .insert({
              website: url,
              business_name: orgInfo.business_name || domain,
              description: orgInfo.description,
              metadata: {
                source: 'automated_ingestion',
                extracted_at: new Date().toISOString(),
              },
            })
            .select('id')
            .single();

          if (!insertError && newOrg) {
            return newOrg.id;
          }
        }
      }
    }
  } catch (error: any) {
    console.warn('Org extraction failed, using domain as name:', error.message);
  }

  // Fallback: Create org with domain as name
  const { data: newOrg, error: insertError } = await supabase
    .from('businesses')
    .insert({
      website: url,
      business_name: domain,
      metadata: {
        source: 'automated_ingestion',
        extracted_at: new Date().toISOString(),
      },
    })
    .select('id')
    .single();

  if (insertError || !newOrg) {
    throw new Error(`Failed to create organization: ${insertError?.message}`);
  }

  return newOrg.id;
}

function buildDealerInspireIndexCandidates(hostname: string): string[] {
  const host = hostname.replace(/^www\./, '').toLowerCase();
  const parts = host.split('.');
  if (parts.length < 2) return [];
  const base = parts.slice(0, -1).join('.');
  const compact = base.replace(/[^a-z0-9]+/g, '');
  const underscored = base.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const dashed = base.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const slugs = [compact, underscored, dashed].filter(Boolean);
  return Array.from(new Set(slugs)).map((slug) => `${slug}_production_inventory`);
}

function buildDealerInspireQueryUrl(indexName: string): string {
  const host = `${DEALER_INSPIRE_ALGOLIA_APP_ID.toLowerCase()}-dsn.algolia.net`;
  return `https://${host}/1/indexes/${indexName}/query?x-algolia-application-id=${DEALER_INSPIRE_ALGOLIA_APP_ID}&x-algolia-api-key=${DEALER_INSPIRE_ALGOLIA_SEARCH_KEY}`;
}

async function probeDealerInspireIndex(indexName: string): Promise<boolean> {
  const queryUrl = buildDealerInspireQueryUrl(indexName);
  try {
    const resp = await fetch(queryUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params: 'hitsPerPage=1&page=0' }),
      signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) return false;
    const data = await resp.json().catch(() => null);
    return !!data && typeof data.nbHits === 'number' && Array.isArray(data.hits);
  } catch {
    return false;
  }
}

async function resolveDealerInspireConfig(siteUrl: string): Promise<DealerInspireAlgoliaConfig | null> {
  try {
    const host = new URL(siteUrl).hostname;
    const candidates = buildDealerInspireIndexCandidates(host);
    for (const indexName of candidates) {
      const ok = await probeDealerInspireIndex(indexName);
      if (!ok) continue;
      return {
        app_id: DEALER_INSPIRE_ALGOLIA_APP_ID,
        search_key: DEALER_INSPIRE_ALGOLIA_SEARCH_KEY,
        index_name: indexName,
        query_url: buildDealerInspireQueryUrl(indexName),
      };
    }
  } catch {
    // ignore
  }
  return null;
}

function buildDealerInspireExtractionPatterns(): ExtractionPattern[] {
  const makePattern = (field: string): ExtractionPattern => ({
    field_name: field,
    selectors: [`algolia.${field}`],
    extraction_method: 'api',
    confidence: 0.95,
    sample_values: [],
  });

  return [
    makePattern('year'),
    makePattern('make'),
    makePattern('model'),
    makePattern('trim'),
    makePattern('vin'),
    makePattern('miles'),
    makePattern('our_price'),
    makePattern('msrp'),
    makePattern('engine_description'),
    makePattern('drivetrain'),
    makePattern('transmission_description'),
    makePattern('ext_color'),
    makePattern('int_color'),
    makePattern('features'),
  ];
}

function resolveInventoryUrl(siteUrl: string, inventoryPage?: PageType): string {
  const sample = inventoryPage?.sample_urls?.[0];
  if (sample) return sample;
  try {
    const u = new URL(siteUrl);
    const path = u.pathname.toLowerCase();
    if (/(used-vehicles|inventory|vehicles)/i.test(path)) {
      return u.toString();
    }
    return `${u.origin}/inventory`;
  } catch {
    return `${siteUrl.replace(/\/$/, '')}/inventory`;
  }
}

/**
 * Discover site structure using LLM + Firecrawl
 */
async function discoverSiteStructure(
  siteUrl: string,
  existingPatterns: any,
  supabase: any
): Promise<SiteStructure> {
  const domain = new URL(siteUrl).hostname;

  if (existingPatterns?.schema_data) {
    return {
      domain,
      site_type: existingPatterns.site_type || 'unknown',
      platform: existingPatterns.schema_data?.platform,
      cms: existingPatterns.schema_data?.cms,
      page_types: existingPatterns.schema_data?.page_types || [],
      listing_patterns: existingPatterns.schema_data?.listing_patterns || [],
      pagination_pattern: existingPatterns.schema_data?.pagination_pattern,
      data_sources: existingPatterns.schema_data?.data_sources || undefined,
    };
  }

  const dealerInspireConfig = await resolveDealerInspireConfig(siteUrl);
  if (dealerInspireConfig) {
    const sitePath = (() => {
      try {
        const u = new URL(siteUrl);
        return u.pathname.replace(/\/$/, '') || '/inventory';
      } catch {
        return '/inventory';
      }
    })();
    return {
      domain,
      site_type: 'dealer_website',
      platform: 'DealerInspire',
      page_types: [
        {
          type: 'inventory',
          url_pattern: sitePath,
          sample_urls: [siteUrl],
          structure_hints: ['Algolia-backed inventory results'],
        },
        {
          type: 'vehicle_detail',
          url_pattern: '/inventory/',
          sample_urls: [],
          structure_hints: ['DealerInspire VDP pages under /inventory/'],
        },
      ],
      listing_patterns: [
        {
          pattern_type: 'api',
          pattern: dealerInspireConfig.query_url,
          confidence: 0.95,
          sample_matches: [dealerInspireConfig.index_name],
        },
      ],
      pagination_pattern: 'page={n}',
      data_sources: { algolia: dealerInspireConfig },
    };
  }

  try {
    const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
      },
      body: JSON.stringify({
        url: siteUrl,
        formats: ['html', 'markdown'],
        onlyMainContent: false,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!firecrawlResponse.ok) {
      throw new Error(`Firecrawl failed: ${firecrawlResponse.status}`);
    }

    const firecrawlData = await firecrawlResponse.json();
    const html = firecrawlData.data?.html || '';
    const markdown = firecrawlData.data?.markdown || '';

    if (OPENAI_API_KEY) {
      const structurePrompt = `Analyze this website and identify its structure:

URL: ${siteUrl}
Markdown preview (first 3000 chars): ${markdown.substring(0, 3000)}

Extract:
1. Site type (dealer_website, auction_house, marketplace, etc.)
2. Platform/CMS if detectable
3. Page types (inventory, vehicle_detail, about, contact, etc.)
4. URL patterns for vehicle listings (e.g., /for-sale/, /inventory/, /vehicles/)
5. Pagination pattern if any

Return JSON:
{
  "site_type": "dealer_website",
  "platform": "DealerFire",
  "cms": "WordPress",
  "page_types": [
    {
      "type": "inventory",
      "url_pattern": "/inventory",
      "sample_urls": ["..."],
      "structure_hints": ["..."]
    }
  ],
  "listing_patterns": [
    {
      "pattern_type": "url",
      "pattern": "/for-sale/.*",
      "confidence": 0.9,
      "sample_matches": ["..."]
    }
  ],
  "pagination_pattern": "?page={n}"
}`;

      const llmResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: 'You are an expert web scraping analyst. Analyze websites and extract structural patterns. Return only valid JSON.',
            },
            {
              role: 'user',
              content: structurePrompt,
            },
          ],
          temperature: 0.3,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (llmResponse.ok) {
        const llmData = await llmResponse.json();
        const structure = JSON.parse(llmData.choices[0].message.content);
        return {
          domain,
          ...structure,
        };
      }
    }

    return {
      domain,
      site_type: 'unknown',
      page_types: [{
        type: 'inventory',
        url_pattern: '/inventory',
        sample_urls: [],
        structure_hints: [],
      }],
      listing_patterns: [],
    };
  } catch (error: any) {
    console.warn('Structure discovery failed, using fallback:', error.message);
    return {
      domain,
      site_type: 'unknown',
      page_types: [],
      listing_patterns: [],
    };
  }
}

/**
 * Learn extraction patterns using LLM (DOM mapping)
 */
async function learnExtractionPatterns(
  siteUrl: string,
  siteStructure: SiteStructure,
  existingPatterns: any,
  supabase: any
): Promise<ExtractionPattern[]> {
  if (existingPatterns?.schema_data?.extraction_patterns) {
    return existingPatterns.schema_data.extraction_patterns;
  }

  if (siteStructure.data_sources?.algolia) {
    return buildDealerInspireExtractionPatterns();
  }

  if (!OPENAI_API_KEY || siteStructure.page_types.length === 0) {
    return [];
  }

  try {
    const samplePage = siteStructure.page_types.find((pt) => 
      pt.type === 'vehicle_detail' || pt.type === 'inventory'
    );
    
    if (!samplePage || samplePage.sample_urls.length === 0) {
      // Try to find a vehicle listing URL from the homepage
      const inventoryUrl = `${siteUrl}/inventory` || `${siteUrl}/for-sale`;
      
      const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
        },
        body: JSON.stringify({
          url: inventoryUrl,
          formats: ['html', 'markdown'],
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (firecrawlResponse.ok) {
        const firecrawlData = await firecrawlResponse.json();
        const markdown = firecrawlData.data?.markdown || '';
        const html = firecrawlData.data?.html || '';

        const patternPrompt = `Analyze this vehicle listing page and identify extraction patterns:

URL: ${inventoryUrl}
Markdown (first 4000 chars): ${markdown.substring(0, 4000)}

For each field (year, make, model, price, mileage, VIN, description, images), identify:
1. CSS selectors that work (provide multiple fallbacks)
2. Regex patterns if needed
3. Extraction method (dom, llm, hybrid)
4. Confidence level (0.0-1.0)

Return JSON:
{
  "patterns": [
    {
      "field_name": "price",
      "selectors": [".price", ".amount", "[data-price]"],
      "regex_patterns": ["/\\$([\\d,]+)/"],
      "extraction_method": "dom",
      "confidence": 0.9,
      "sample_values": ["$45,000"]
    }
  ]
}`;

        const llmResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o',
            messages: [
              {
                role: 'system',
                content: 'You are an expert web scraping pattern analyst. Identify extraction patterns from HTML. Return JSON with a "patterns" array.',
              },
              {
                role: 'user',
                content: patternPrompt,
              },
            ],
            temperature: 0.3,
            response_format: { type: 'json_object' },
          }),
          signal: AbortSignal.timeout(30000),
        });

        if (llmResponse.ok) {
          const llmData = await llmResponse.json();
          const response = JSON.parse(llmData.choices[0].message.content);
          return Array.isArray(response.patterns) ? response.patterns : (response.patterns || []);
        }
      }
    } else {
      const sampleUrl = samplePage.sample_urls[0];
      
      const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
        },
        body: JSON.stringify({
          url: sampleUrl,
          formats: ['html', 'markdown'],
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (firecrawlResponse.ok) {
        const firecrawlData = await firecrawlResponse.json();
        const markdown = firecrawlData.data?.markdown || '';

        const patternPrompt = `Analyze this vehicle listing page and identify extraction patterns:

URL: ${sampleUrl}
Markdown (first 4000 chars): ${markdown.substring(0, 4000)}

For each field (year, make, model, price, mileage, VIN, description, images), identify:
1. CSS selectors that work (provide multiple fallbacks)
2. Regex patterns if needed
3. Extraction method (dom, llm, hybrid)
4. Confidence level (0.0-1.0)

Return JSON:
{
  "patterns": [
    {
      "field_name": "price",
      "selectors": [".price", ".amount", "[data-price]"],
      "regex_patterns": ["/\\$([\\d,]+)/"],
      "extraction_method": "dom",
      "confidence": 0.9,
      "sample_values": ["$45,000"]
    }
  ]
}`;

        const llmResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o',
            messages: [
              {
                role: 'system',
                content: 'You are an expert web scraping pattern analyst. Identify extraction patterns from HTML. Return JSON with a "patterns" array.',
              },
              {
                role: 'user',
                content: patternPrompt,
              },
            ],
            temperature: 0.3,
            response_format: { type: 'json_object' },
          }),
          signal: AbortSignal.timeout(30000),
        });

        if (llmResponse.ok) {
          const llmData = await llmResponse.json();
          const response = JSON.parse(llmData.choices[0].message.content);
          return Array.isArray(response.patterns) ? response.patterns : (response.patterns || []);
        }
      }
    }
  } catch (error: any) {
    console.warn('Pattern learning failed:', error.message);
  }

  return [];
}

/**
 * Store learned patterns for reuse
 */
async function storeLearnedPatterns(
  siteUrl: string,
  siteStructure: SiteStructure,
  extractionPatterns: ExtractionPattern[],
  supabase: any
): Promise<void> {
  try {
    const domain = new URL(siteUrl).hostname;

    const schemaData = {
      site_type: siteStructure.site_type,
      platform: siteStructure.platform,
      cms: siteStructure.cms,
      page_types: siteStructure.page_types,
      listing_patterns: siteStructure.listing_patterns,
      pagination_pattern: siteStructure.pagination_pattern,
      extraction_patterns: extractionPatterns,
      data_sources: siteStructure.data_sources,
      discovered_at: new Date().toISOString(),
    };

    await supabase
      .from('source_site_schemas')
      .upsert({
        domain,
        site_name: domain,
        site_type: siteStructure.site_type || 'dealer_website',
        schema_data: schemaData,
        cataloged_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'domain',
      });
  } catch (error: any) {
    console.warn('Failed to store patterns:', error.message);
  }
}

/**
 * Extract all data using learned patterns
 */
async function extractAllData(
  organizationId: string,
  siteUrl: string,
  siteStructure: SiteStructure,
  extractionPatterns: ExtractionPattern[],
  supabase: any
): Promise<{
  vehicles_found: number;
  vehicles_extracted: number;
  vehicles_created: number;
  images_found: number;
}> {
  // Find inventory URL
  const inventoryPage = siteStructure.page_types.find((pt) => pt.type === 'inventory');
  const inventoryUrl = resolveInventoryUrl(siteUrl, inventoryPage);
  
  const isMotoriousUrl = inventoryUrl.toLowerCase().includes('motorious.com') || 
                         inventoryUrl.toLowerCase().includes('buy.motorious.com');
  const sourceType = isMotoriousUrl ? 'marketplace' : 'dealer_website';

  let vehiclesQueued = 0;
  let vehiclesFound = 0;

  // Scrape and queue listings using scrape-multi-source
  try {
    console.log(`   Scraping inventory from: ${inventoryUrl}`);
    const scrapeResponse = await fetch(`${SUPABASE_URL}/functions/v1/scrape-multi-source`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        source_url: inventoryUrl,
        source_type: sourceType,
        organization_id: organizationId,
        max_results: 500,
        use_llm_extraction: true,
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (scrapeResponse.ok) {
      const scrapeData = await scrapeResponse.json();
      vehiclesFound = scrapeData.listings_found || 0;
      vehiclesQueued = scrapeData.listings_queued || 0;
      console.log(`   ✅ Queued ${vehiclesQueued} listings for processing`);
    } else {
      const errorText = await scrapeResponse.text();
      console.warn(`   ⚠️  Scraping failed: ${scrapeResponse.status} - ${errorText.substring(0, 200)}`);
    }
  } catch (error: any) {
    console.warn(`   ⚠️  Scraping error: ${error.message}`);
  }

  // Process import queue to create vehicle profiles
  let vehiclesCreated = 0;
  if (vehiclesQueued > 0) {
    try {
      console.log(`   Processing import queue...`);
      const processResponse = await fetch(`${SUPABASE_URL}/functions/v1/process-import-queue`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          batch_size: 50,
          organization_id: organizationId,
        }),
        signal: AbortSignal.timeout(120000),
      });

      if (processResponse.ok) {
        const processData = await processResponse.json();
        vehiclesCreated = processData.vehicles_created || 0;
        console.log(`   ✅ Created ${vehiclesCreated} vehicle profiles`);
      }
    } catch (error: any) {
      console.warn(`   ⚠️  Queue processing error: ${error.message}`);
    }
  }

  // Count images
  const { count: imageCount } = await supabase
    .from('vehicle_images')
    .select('*', { count: 'exact', head: true })
    .in('vehicle_id', 
      (await supabase
        .from('organization_vehicles')
        .select('vehicle_id')
        .eq('organization_id', organizationId)
      ).data?.map((v: any) => v.vehicle_id) || []
    );

  return {
    vehicles_found: vehiclesFound,
    vehicles_extracted: vehiclesQueued,
    vehicles_created: vehiclesCreated,
    images_found: imageCount || 0,
  };
}
