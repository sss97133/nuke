/**
 * Catalog Dealer Site Structure
 * 
 * Analyzes dealer/auction house sites to catalog their structure:
 * - What fields exist
 * - Where fields are located (selectors, patterns)
 * - Extraction methods
 * - Required vs optional fields
 * 
 * This enables structure-first extraction - know what to extract before extracting
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CatalogRequest {
  url: string;
  site_type?: 'dealer_website' | 'auction_house' | 'directory';
  sample_urls?: string[]; // Additional sample pages to analyze
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

    const body: CatalogRequest = await req.json();
    const { url, site_type = 'dealer_website', sample_urls = [] } = body;

    if (!url) {
      return new Response(
        JSON.stringify({ error: 'URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`📋 Cataloging structure for: ${url}`);

    // Extract domain
    const domain = new URL(url).hostname.replace(/^www\./, '');
    
    // Check if schema already exists
    const { data: existingSchema } = await supabase
      .from('source_site_schemas')
      .select('*')
      .eq('domain', domain)
      .maybeSingle();

    if (existingSchema && existingSchema.is_valid) {
      console.log(`✅ Schema already exists for ${domain}, updating...`);
    }

    // Step 1: Analyze page structure with AI
    const schema = await analyzeSiteStructure(url, site_type, supabase);

    // Step 2: Validate schema completeness
    const validation = validateSchema(schema);

    // Step 3: Store/update schema
    const { data: savedSchema, error: saveError } = await supabase
      .from('source_site_schemas')
      .upsert({
        domain: domain,
        site_name: extractSiteName(url),
        site_type: site_type,
        schema_data: schema,
        extraction_confidence: validation.confidence,
        is_valid: validation.is_valid,
        last_verified_at: new Date().toISOString(),
        cataloged_by: 'ai',
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'domain'
      })
      .select()
      .single();

    if (saveError) {
      throw new Error(`Failed to save schema: ${saveError.message}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        domain: domain,
        schema: schema,
        validation: validation,
        schema_id: savedSchema.id
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Catalog error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * Analyze site structure using AI
 */
async function analyzeSiteStructure(
  url: string,
  siteType: string,
  supabase: any
): Promise<any> {
  
  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');

  if (!openaiKey || !firecrawlKey) {
    throw new Error('OPENAI_API_KEY and FIRECRAWL_API_KEY required');
  }

  // Scrape page with Firecrawl
  const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${firecrawlKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: url,
      formats: ['html', 'markdown'],
      waitFor: 3000 // Wait for JS to load
    })
  });

  if (!firecrawlResponse.ok) {
    const errorText = await firecrawlResponse.text();
    let errorMessage = `Firecrawl failed: ${firecrawlResponse.status}`;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage += ` - ${errorJson.error || errorJson.message || errorText}`;
    } catch {
      errorMessage += ` - ${errorText.substring(0, 200)}`;
    }
    console.error('Firecrawl error:', errorMessage);
    throw new Error(errorMessage);
  }

  const firecrawlData = await firecrawlResponse.json();
  if (!firecrawlData.success) {
    console.error('Firecrawl extraction failed:', firecrawlData.error || firecrawlData);
    throw new Error(`Firecrawl extraction failed: ${firecrawlData.error?.message || JSON.stringify(firecrawlData.error || 'Unknown error')}`);
  }

  const { html, markdown } = firecrawlData.data;
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // AI Analysis Prompt
  const analysisPrompt = `You are a web structure analyst. Analyze this webpage and catalog its structure for data extraction.

URL: ${url}
Site Type: ${siteType}

PAGE CONTENT (first 50k chars):
${markdown?.substring(0, 50000) || html.substring(0, 50000)}

HTML STRUCTURE:
${extractHTMLStructure(html)}

TASK:
Catalog the structure of this page. Identify:
1. What data fields exist (name, logo, license, contact info, etc.)
2. Where each field is located (CSS selectors, regex patterns, HTML structure)
3. What extraction method works best for each field
4. Which fields are required vs optional

Return JSON schema:
{
  "page_types": {
    "profile_page": {
      "url_pattern": "regex pattern matching this page type",
      "fields": {
        "field_name": {
          "selectors": ["css selector 1", "css selector 2"],
          "patterns": ["regex pattern 1", "regex pattern 2"],
          "required": true/false,
          "extraction_method": "dom_selector | regex | ai_extraction",
          "confidence": 0.0-1.0,
          "notes": "additional context"
        }
      }
    }
  },
  "available_fields": ["list of all available field names"],
  "required_fields": ["list of required field names"],
  "extraction_confidence": 0.0-1.0,
  "structure_notes": "any important notes about page structure"
}

For Classic.com dealer profiles, target these fields:
- name (business/dealer name)
- logo_url (logo image)
- dealer_license (license number)
- website (dealer website)
- address, city, state, zip (location)
- phone, email (contact)
- description (business description, EXCLUDE footer text like "Next-Generation Engine", "DealerFire", "DealerSocket", "Copyright", etc.)
- specialties (array of specialties like ["Classic Trucks", "Muscle Cars"])
- services_offered (array of services like ["Sales", "Service", "Parts", "Restoration", "Custom Build"])
- inventory_url (link to inventory)
- services_url (link to services page, if exists)
- team_members (CRITICAL: array of employee objects like [{"name": "John Doe", "job_title": "President", "department": "Management"}, ...])
  Look for patterns like <ul class="teams"> with department filters, and <div class="row __inline-block-grid"> with employee listings

IMPORTANT: Exclude common footer boilerplate text such as:
- "Next-Generation Engine", "DealerFire", "DealerSocket", "Copyright", "Privacy", "Sitemap"
- Generic dealer website platform text
- Copyright notices and legal disclaimers

IMPORTANT: Team/Employee Structure - This is valuable data!
- Look for team/department sections with patterns like:
  - <ul class="teams list-unstyled"> or <ul class="teams">
  - <div class="team-section"> or <section class="team">
  - Department filters/categories: "Management", "SALES", "SERVICE", "AUTO SPA", "STORAGE", "ADMINISTRATION", "EVENTS", etc.
- These sections often contain:
  - Department categories/teams listed first
  - Individual employee cards/items within departments
  - Employee names, job titles, departments
- Look for patterns like:
  - <div class="row __inline-block-grid"> with employee info
  - Employee cards with name + title
  - Team member listings with structure: Name Title

IMPORTANT: Services should be extracted from:
- Navigation menu links (look for links like "Auto Spa", "Storage", "Events", "Consignment", "Service", "Parts")
- Paragraphs explicitly listing services (e.g., <p>Auto Spa Consignment Events Storage</p>)
- Service sections or service pages
- Menu items with class patterns like "menu-link", "menu__link", service-related hrefs
- Return as array: ["Service 1", "Service 2", ...]

IMPORTANT: Address and Contact Info:
- Often found in department hours modules: <div class="module-container mod-department-hours">
- Look for patterns: "Street Address, City, State ZIP" 
- Phone numbers often appear with labels: "Sales: (XXX) XXX-XXXX" or in department hours sections
- Extract address components separately: address (street), city, state, zip

IMPORTANT: Dealer License:
- Often NOT found on dealer websites
- May need to look up business records separately
- Only catalog if license is explicitly visible on the page

Return ONLY valid JSON.`;

  const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are a web structure analyst. Return only valid JSON.'
        },
        {
          role: 'user',
          content: analysisPrompt
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 4000
    })
  });

  if (!aiResponse.ok) {
    throw new Error(`AI analysis failed: ${aiResponse.status}`);
  }

  const aiData = await aiResponse.json();
  const schema = JSON.parse(aiData.choices[0].message.content);

  // Enhance schema with actual HTML analysis
  const enhancedSchema = enhanceSchemaWithHTMLAnalysis(schema, html, doc);

  return enhancedSchema;
}

/**
 * Extract HTML structure summary
 */
function extractHTMLStructure(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  
  const structure = {
    headings: Array.from(doc.querySelectorAll('h1, h2, h3')).map(h => ({
      tag: h.tagName,
      text: h.textContent?.substring(0, 50),
      classes: h.className
    })),
    images: Array.from(doc.querySelectorAll('img')).slice(0, 10).map(img => ({
      src: img.getAttribute('src')?.substring(0, 100),
      alt: img.getAttribute('alt'),
      classes: img.className
    })),
    links: Array.from(doc.querySelectorAll('a[href]')).slice(0, 20).map(a => ({
      href: a.getAttribute('href')?.substring(0, 100),
      text: a.textContent?.substring(0, 50),
      classes: a.className
    })),
    commonSelectors: [
      '.dealer-name', '.dealer-title', '.logo', '.contact', '.address',
      '.phone', '.email', '.website', '.license'
    ].filter(sel => doc.querySelector(sel) !== null)
  };

  return JSON.stringify(structure, null, 2);
}

/**
 * Enhance schema with actual HTML analysis
 */
function enhanceSchemaWithHTMLAnalysis(schema: any, html: string, doc: any): any {
  // Test selectors and patterns from AI analysis
  // Add actual found locations to schema
  
  if (schema.page_types?.profile_page?.fields) {
    const fields = schema.page_types.profile_page.fields;
    
    for (const [fieldName, fieldConfig] of Object.entries(fields) as [string, any][]) {
      // Test selectors
      if (fieldConfig.selectors) {
        const foundSelectors = fieldConfig.selectors.filter((selector: string) => {
          try {
            return doc.querySelector(selector) !== null;
          } catch {
            return false;
          }
        });
        fieldConfig.verified_selectors = foundSelectors;
      }
      
      // Test patterns
      if (fieldConfig.patterns) {
        const foundPatterns = fieldConfig.patterns.filter((pattern: string) => {
          try {
            const regex = new RegExp(pattern, 'i');
            return regex.test(html);
          } catch {
            return false;
          }
        });
        fieldConfig.verified_patterns = foundPatterns;
      }
    }
  }
  
  return schema;
}

/**
 * Validate schema completeness
 */
function validateSchema(schema: any): { is_valid: boolean; confidence: number; issues: string[] } {
  const issues: string[] = [];
  let confidence = 1.0;

  if (!schema.page_types || Object.keys(schema.page_types).length === 0) {
    issues.push('No page types defined');
    confidence -= 0.3;
  }

  if (!schema.available_fields || schema.available_fields.length === 0) {
    issues.push('No available fields cataloged');
    confidence -= 0.3;
  }

  // Check if required fields have extraction methods
  if (schema.required_fields) {
    const pageType = Object.values(schema.page_types || {})[0] as any;
    if (pageType?.fields) {
      for (const requiredField of schema.required_fields) {
        if (!pageType.fields[requiredField]) {
          issues.push(`Required field '${requiredField}' has no extraction config`);
          confidence -= 0.1;
        } else {
          const fieldConfig = pageType.fields[requiredField];
          if (!fieldConfig.selectors?.length && !fieldConfig.patterns?.length) {
            issues.push(`Required field '${requiredField}' has no extraction method`);
            confidence -= 0.1;
          }
        }
      }
    }
  }

  return {
    is_valid: confidence >= 0.7,
    confidence: Math.max(0, confidence),
    issues
  };
}

/**
 * Extract site name from URL
 */
function extractSiteName(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return hostname.split('.')[0];
  } catch {
    return 'unknown';
  }
}

