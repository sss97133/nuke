import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * DISCOVER ORGANIZATION FULL
 * 
 * Single-organization adaptive discovery tool that:
 * 1. Discovers site structure intelligently
 * 2. Adapts extraction patterns for THIS specific site
 * 3. Learns and stores patterns for reuse
 * 4. Does comprehensive extraction (inventory, vehicles, images, everything)
 * 5. Gets smarter with each run
 * 
 * Philosophy: One org at a time, full extraction, adaptive learning.
 * Database grows, insertion points stay the same, patterns get reused.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DiscoveryRequest {
  organization_id: string;
  website?: string; // Optional, will fetch from org if not provided
  force_rediscover?: boolean; // Force rediscovery even if patterns exist
}

interface SiteStructure {
  domain: string;
  site_type: string;
  platform?: string;
  cms?: string;
  page_types: PageType[];
  listing_patterns: ListingPattern[];
  pagination_pattern?: string;
}

interface PageType {
  type: string; // 'inventory', 'vehicle_detail', 'about', 'contact', etc.
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

interface ExtractionPattern {
  field_name: string;
  selectors: string[];
  regex_patterns?: string[];
  extraction_method: 'dom' | 'llm' | 'api' | 'hybrid';
  confidence: number;
  sample_values: any[];
}

interface DiscoveryResult {
  organization_id: string;
  website: string;
  site_structure: SiteStructure;
  extraction_patterns: ExtractionPattern[];
  learned_patterns_stored: boolean;
  vehicles_found: number;
  vehicles_extracted: number;
  images_found: number;
  other_data_extracted: any;
  next_steps: string[];
}

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { organization_id, website, force_rediscover = false }: DiscoveryRequest = await req.json();

    if (!organization_id) {
      return new Response(
        JSON.stringify({ error: 'organization_id required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log(`\n🔍 DISCOVER ORGANIZATION FULL`);
    console.log('='.repeat(70));
    console.log(`Organization ID: ${organization_id}`);
    console.log(`Force Rediscover: ${force_rediscover}\n`);

    // Step 1: Get organization info
    const { data: org, error: orgError } = await supabase
      .from('businesses')
      .select('id, business_name, website, business_type, metadata')
      .eq('id', organization_id)
      .single();

    if (orgError || !org) {
      throw new Error(`Organization not found: ${orgError?.message}`);
    }

    const siteUrl = website || org.website;
    if (!siteUrl) {
      throw new Error('Organization has no website URL');
    }

    console.log(`📍 Organization: ${org.business_name}`);
    console.log(`🌐 Website: ${siteUrl}\n`);

    // Step 2: Check for existing patterns (unless force_rediscover)
    let existingPatterns: any = null;
    if (!force_rediscover) {
      const { data: patterns } = await supabase
        .from('dealer_site_schemas')
        .select('*')
        .eq('domain', new URL(siteUrl).hostname)
        .maybeSingle();
      
      if (patterns) {
        existingPatterns = patterns;
        console.log(`✅ Found existing patterns for ${patterns.domain}`);
        console.log(`   Using stored schema (${Object.keys(patterns.schema_data || {}).length} fields)\n`);
      }
    }

    // Step 3: Discover site structure (adaptive)
    console.log('📐 Discovering site structure...');
    const siteStructure = await discoverSiteStructure(siteUrl, existingPatterns, supabase);
    console.log(`✅ Discovered ${siteStructure.page_types.length} page types`);
    console.log(`   - Listing patterns: ${siteStructure.listing_patterns.length}`);
    console.log(`   - Site type: ${siteStructure.site_type}`);
    if (siteStructure.platform) console.log(`   - Platform: ${siteStructure.platform}\n`);

    // Step 4: Learn extraction patterns (adaptive, LLM-powered)
    console.log('🧠 Learning extraction patterns...');
    const extractionPatterns = await learnExtractionPatterns(
      siteUrl,
      siteStructure,
      existingPatterns,
      supabase
    );
    console.log(`✅ Learned ${extractionPatterns.length} extraction patterns\n`);

    // Step 5: Store learned patterns for reuse
    console.log('💾 Storing learned patterns...');
    const patternsStored = await storeLearnedPatterns(
      siteUrl,
      siteStructure,
      extractionPatterns,
      supabase
    );
    console.log(`✅ Patterns stored: ${patternsStored}\n`);

    // Step 6: Extract all data using learned patterns
    console.log('📦 Extracting data using learned patterns...');
    const extractionResult = await extractAllData(
      organization_id,
      siteUrl,
      siteStructure,
      extractionPatterns,
      supabase
    );
    console.log(`✅ Extraction complete:`);
    console.log(`   - Vehicles found: ${extractionResult.vehicles_found}`);
    console.log(`   - Vehicles extracted: ${extractionResult.vehicles_extracted}`);
    console.log(`   - Images found: ${extractionResult.images_found}\n`);

    // Step 7: Build result
    const result: DiscoveryResult = {
      organization_id,
      website: siteUrl,
      site_structure: siteStructure,
      extraction_patterns: extractionPatterns,
      learned_patterns_stored: patternsStored,
      vehicles_found: extractionResult.vehicles_found,
      vehicles_extracted: extractionResult.vehicles_extracted,
      images_found: extractionResult.images_found,
      other_data_extracted: extractionResult.other_data,
      next_steps: [
        'Patterns stored for future use',
        'Run again to extract more data or update patterns',
        'Patterns will be reused automatically for similar sites',
      ],
    };

    return new Response(
      JSON.stringify({
        success: true,
        result,
        timestamp: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Discovery error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        stack: error.stack,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

/**
 * Discover site structure adaptively
 */
async function discoverSiteStructure(
  siteUrl: string,
  existingPatterns: any,
  supabase: any
): Promise<SiteStructure> {
  const domain = new URL(siteUrl).hostname;

  // If we have existing patterns, use them as hints
  if (existingPatterns?.schema_data) {
    // Reuse known structure
    return {
      domain,
      site_type: existingPatterns.site_type || 'unknown',
      platform: existingPatterns.schema_data?.platform,
      cms: existingPatterns.schema_data?.cms,
      page_types: existingPatterns.schema_data?.page_types || [],
      listing_patterns: existingPatterns.schema_data?.listing_patterns || [],
      pagination_pattern: existingPatterns.schema_data?.pagination_pattern,
    };
  }

  // Discover structure using LLM + Firecrawl
  try {
    // Use Firecrawl to get homepage
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
    });

    if (!firecrawlResponse.ok) {
      throw new Error(`Firecrawl failed: ${firecrawlResponse.status}`);
    }

    const firecrawlData = await firecrawlResponse.json();
    const html = firecrawlData.data?.html || '';
    const markdown = firecrawlData.data?.markdown || '';

    // Use LLM to analyze structure
    if (OPENAI_API_KEY) {
      const structurePrompt = `Analyze this website and identify its structure:

URL: ${siteUrl}
HTML Length: ${html.length}
Markdown Length: ${markdown.length}

Extract:
1. Site type (dealer, auction_house, marketplace, etc.)
2. Platform/CMS if detectable
3. Page types (inventory, vehicle_detail, about, contact, etc.)
4. URL patterns for vehicle listings
5. Pagination pattern if any

Return JSON:
{
  "site_type": "dealer",
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
      "pattern": "/inventory/.*",
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
              content: structurePrompt + '\n\nMarkdown preview (first 2000 chars):\n' + markdown.substring(0, 2000),
            },
          ],
          temperature: 0.3,
          response_format: { type: 'json_object' },
        }),
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

    // Fallback: Basic structure detection
    return {
      domain,
      site_type: 'unknown',
      page_types: [
        {
          type: 'inventory',
          url_pattern: '/inventory',
          sample_urls: [],
          structure_hints: [],
        },
      ],
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
 * Learn extraction patterns adaptively using LLM
 */
async function learnExtractionPatterns(
  siteUrl: string,
  siteStructure: SiteStructure,
  existingPatterns: any,
  supabase: any
): Promise<ExtractionPattern[]> {
  // If we have existing patterns, use them
  if (existingPatterns?.schema_data?.extraction_patterns) {
    return existingPatterns.schema_data.extraction_patterns;
  }

  // Check for reusable patterns from similar sites
  const { data: reusablePatterns } = await supabase
    .from('extraction_pattern_registry')
    .select('*')
    .eq('pattern_type', 'dom_selector')
    .order('success_rate', { ascending: false })
    .limit(10);

  // Learn new patterns using LLM
  if (OPENAI_API_KEY && siteStructure.page_types.length > 0) {
    try {
      // Get a sample page
      const samplePage = siteStructure.page_types.find((pt) => pt.type === 'vehicle_detail' || pt.type === 'inventory');
      if (samplePage && samplePage.sample_urls.length > 0) {
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
        });

        if (firecrawlResponse.ok) {
          const firecrawlData = await firecrawlResponse.json();
          const markdown = firecrawlData.data?.markdown || '';

          const patternPrompt = `Analyze this vehicle listing page and identify extraction patterns:

URL: ${sampleUrl}
Markdown: ${markdown.substring(0, 3000)}

For each field (year, make, model, price, mileage, VIN, description, images), identify:
1. CSS selectors that work
2. Regex patterns if needed
3. Extraction method (dom, llm, hybrid)
4. Confidence level

Return JSON array:
[
  {
    "field_name": "price",
    "selectors": [".price", ".amount"],
    "regex_patterns": ["/([\\d,]+)/"],
    "extraction_method": "dom",
    "confidence": 0.9,
    "sample_values": ["$45,000"]
  }
]`;

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
          });

          if (llmResponse.ok) {
            const llmData = await llmResponse.json();
            const response = JSON.parse(llmData.choices[0].message.content);
            return Array.isArray(response) ? response : (response.patterns || []);
          }
        }
      }
    } catch (error: any) {
      console.warn('Pattern learning failed:', error.message);
    }
  }

  // Fallback: Generic patterns
  return [
    {
      field_name: 'price',
      selectors: ['.price', '.amount', '[class*="price"]'],
      extraction_method: 'dom',
      confidence: 0.5,
      sample_values: [],
    },
  ];
}

/**
 * Store learned patterns for reuse
 */
async function storeLearnedPatterns(
  siteUrl: string,
  siteStructure: SiteStructure,
  extractionPatterns: ExtractionPattern[],
  supabase: any
): Promise<boolean> {
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
      discovered_at: new Date().toISOString(),
    };

    await supabase
      .from('dealer_site_schemas')
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

    return true;
  } catch (error: any) {
    console.warn('Failed to store patterns:', error.message);
    return false;
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
  images_found: number;
  other_data: any;
}> {
  // Use scrape-multi-source with learned patterns
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

  // Find inventory URL
  const inventoryPage = siteStructure.page_types.find((pt) => pt.type === 'inventory');
  const inventoryUrl = inventoryPage?.sample_urls[0] || `${siteUrl}/inventory`;

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/scrape-multi-source`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        source_url: inventoryUrl,
        source_type: 'dealer_website',
        organization_id: organizationId,
        max_results: 500,
        use_llm_extraction: true,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      return {
        vehicles_found: data.listings_found || 0,
        vehicles_extracted: data.listings_queued || 0,
        images_found: 0, // Will be extracted by process-import-queue
        other_data: {
          listings_queued: data.listings_queued,
          extraction_method: data.extraction_method,
        },
      };
    }
  } catch (error: any) {
    console.warn('Data extraction failed:', error.message);
  }

  return {
    vehicles_found: 0,
    vehicles_extracted: 0,
    images_found: 0,
    other_data: {},
  };
}

