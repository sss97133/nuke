/**
 * Extract Using Cataloged Structure
 * 
 * Uses pre-cataloged site structure to systematically extract data.
 * Knows what fields exist and where they are before extracting.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ExtractRequest {
  url: string;
  use_catalog?: boolean; // Default: true - use catalog if available
  fallback_to_ai?: boolean; // Default: true - fallback if no catalog
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

    const body: ExtractRequest = await req.json();
    const { url, use_catalog = true, fallback_to_ai = true } = body;

    if (!url) {
      return new Response(
        JSON.stringify({ error: 'URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`🔍 Extracting from: ${url}`);

    // Step 1: Get cataloged structure
    const domain = new URL(url).hostname.replace(/^www\./, '');
    let schema: any = null;
    let extractionMethod = 'ai_fallback';

    if (use_catalog) {
      console.log(`🔍 Looking for catalog with domain: ${domain}`);
      // Try to get valid catalog first, but fall back to any catalog if none found
      let { data: catalogSchema, error: catalogError } = await supabase
        .from('dealer_site_schemas')
        .select('schema_data, site_type, domain, is_valid, extraction_confidence')
        .eq('domain', domain)
        .eq('is_valid', true)
        .maybeSingle();

      // If no valid catalog found, try any catalog (even if confidence is lower)
      if (!catalogSchema) {
        console.log(`⚠️  No valid catalog found, trying any catalog for ${domain}`);
        const { data: anyCatalog, error: anyError } = await supabase
          .from('dealer_site_schemas')
          .select('schema_data, site_type, domain, is_valid, extraction_confidence')
          .eq('domain', domain)
          .order('extraction_confidence', { ascending: false })
          .limit(1)
          .maybeSingle();
        
        if (anyCatalog) {
          catalogSchema = anyCatalog;
          catalogError = anyError;
          console.log(`⚠️  Using catalog with lower confidence: ${(catalogSchema.extraction_confidence * 100).toFixed(1)}%`);
        }
      }

      if (catalogError) {
        console.error('❌ Error querying catalog:', catalogError);
      }

      if (catalogSchema && catalogSchema.schema_data) {
        schema = catalogSchema.schema_data;
        extractionMethod = 'catalog_guided';
        console.log(`✅ Using cataloged structure for ${domain}`);
      } else {
        console.log(`⚠️  No catalog found for domain: ${domain}`);
        // Check what domains exist
        const { data: allSchemas } = await supabase
          .from('dealer_site_schemas')
          .select('domain, is_valid')
          .limit(10);
        console.log(`📋 Available catalogs:`, allSchemas);
      }
    }

    // Step 2: Extract using catalog or fallback
    let extractedData: any = {};
    
    if (schema) {
      extractedData = await extractUsingCatalog(url, schema, supabase);
      
      // Step 2b: AI backfill for missing fields
      const validation = validateExtraction(extractedData, schema);
      if (validation.missing_required.length > 0 || validation.missing_optional.length > 0) {
        console.log(`⚠️  Missing fields detected, using AI to fill in blanks...`);
        const aiBackfill = await aiBackfillMissingFields(url, extractedData, schema, supabase);
        extractedData = { ...extractedData, ...aiBackfill };
      }
    } else if (fallback_to_ai) {
      console.log(`⚠️  No catalog found, using AI extraction fallback`);
      extractionMethod = 'ai_fallback';
      // Call existing extraction function
      const { data: aiResult } = await supabase.functions.invoke('extract-with-proof-and-backfill', {
        body: { url }
      });
      extractedData = aiResult?.data || {};
    } else {
      throw new Error('No catalog available and fallback disabled');
    }

    // Step 3: Validate against catalog (if available)
    let validation: any = null;
    if (schema) {
      validation = validateExtraction(extractedData, schema);
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: extractedData,
        extraction_method: extractionMethod,
        schema_used: schema ? domain : null,
        validation: validation,
        completeness: calculateCompleteness(extractedData, schema),
        ai_backfill_used: validation?.missing_required?.length > 0 || validation?.missing_optional?.length > 0,
        team_data_extracted: extractedData.team_members ? extractedData.team_members.length : 0
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Extraction error:', error);
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
 * Extract data using cataloged schema
 */
async function extractUsingCatalog(
  url: string,
  schema: any,
  supabase: any
): Promise<any> {
  
  // Get page content
  const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
  if (!firecrawlKey) {
    throw new Error('FIRECRAWL_API_KEY required');
  }

  const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${firecrawlKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: url,
      formats: ['html'],
      waitFor: 2000 // Wait for JS to load
    })
  });

  if (!firecrawlResponse.ok) {
    throw new Error(`Firecrawl failed: ${firecrawlResponse.status}`);
  }

  const firecrawlData = await firecrawlResponse.json();
  if (!firecrawlData.success) {
    throw new Error('Firecrawl extraction failed');
  }

  const html = firecrawlData.data.html;
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // Get first page type (assume profile page for now)
  const pageType = Object.values(schema.page_types || {})[0] as any;
  if (!pageType || !pageType.fields) {
    throw new Error('No fields defined in schema');
  }

  const extracted: any = {};

  // Extract each field using cataloged structure
  // If cataloging worked, we trust it completely - just follow the catalog
  for (const [fieldName, fieldConfig] of Object.entries(pageType.fields) as [string, any][]) {
    let value: any = null;

    // Use verified selectors first (these were confirmed by cataloging)
    if (fieldConfig.verified_selectors?.length > 0) {
      for (const selector of fieldConfig.verified_selectors) {
        try {
          const element = doc.querySelector(selector);
          if (element) {
            if (fieldName.includes('logo') || fieldName.includes('image') || fieldName.includes('url')) {
              value = element.getAttribute('src') || element.getAttribute('href');
            } else {
              value = element.textContent?.trim();
              
              // Clean up common footer boilerplate
              if (value && (fieldName === 'description' || fieldName === 'email')) {
                // Remove DealerFire/DealerSocket boilerplate
                value = value.replace(/Next-Generation Engine.*?DealerFire.*/gi, '').trim();
                value = value.replace(/Part of the DealerSocket.*/gi, '').trim();
                value = value.replace(/Copyright.*Privacy.*Sitemap.*/gi, '').trim();
                value = value.replace(/Powered by DealerFire.*/gi, '').trim();
                // Remove common email placeholder text
                if (fieldName === 'email') {
                  value = value.replace(/[^\w@.-]/g, ''); // Keep only email chars
                }
              }
            }
            if (value) break;
          }
        } catch (err) {
          // Invalid selector, skip
        }
      }
    }

    // Use verified patterns if selector didn't work (also confirmed by cataloging)
    if (!value && fieldConfig.verified_patterns?.length > 0) {
      for (const pattern of fieldConfig.verified_patterns) {
        try {
          const regex = new RegExp(pattern, 'i');
          const match = html.match(regex);
          if (match && match[1]) {
            value = match[1].trim();
            break;
          }
        } catch (err) {
          // Invalid pattern, skip
        }
      }
    }

    // That's it - if cataloging worked, these should work
    // No fallbacks - trust the catalog
    if (value) {
      extracted[fieldName] = value;
    }
  }

  // Also extract team members even if not in schema (gold mine data!)
  if (!extracted.team_members && !extracted.employees) {
    const teamMembers = await extractTeamMembers(doc, html);
    if (teamMembers.length > 0) {
      extracted.team_members = teamMembers;
      console.log(`✅ Extracted ${teamMembers.length} team members`);
    }
  }

  return extracted;
}

/**
 * Extract team members from team structure patterns
 * Looks for <ul class="teams"> and employee listings - GOLD MINE DATA!
 */
async function extractTeamMembers(doc: any, html: string): Promise<Array<{name: string; job_title?: string; department?: string}>> {
  const teamMembers: Array<{name: string; job_title?: string; department?: string}> = [];
  
  try {
    // Method 1: Look for <ul class="teams"> or similar team structure
    const teamLists = doc.querySelectorAll('ul.teams, ul[class*="team"], .team-section, section.team, ul[class*="list-unstyled"]');
    
    // Department keywords to identify departments
    const departmentKeywords = ['Management', 'SALES', 'SERVICE', 'AUTO SPA', 'STORAGE', 'ADMINISTRATION', 'EVENTS', 'MOTORCLUB', 'Parts', 'Sales', 'Service', 'Admin'];
    
    for (const teamList of Array.from(teamLists)) {
      const listText = (teamList as any).textContent || '';
      
      // Method 2: Look for employee grid/listings - this is where the gold is!
      // Pattern: <div class="row __inline-block-grid"> or similar with employee cards
      const employeeGrids = doc.querySelectorAll('.row.__inline-block-grid, .team-grid, .employee-list, [class*="team-member"], [class*="employee-card"], [class*="__inline-block-grid"]');
      
      for (const grid of Array.from(employeeGrids)) {
        const gridText = (grid as any).textContent || '';
        
        // Extract employee name + title patterns
        // Common formats: "Jeremy Scates President/CoFounder", "Dan Hyland Service Manager"
        const employeePatterns = [
          // Pattern: Name Title (most common) - matches "First Last Title"
          /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s+([A-Z][^A-Z\n\r]{3,50})/g,
          // Pattern with slash: "Name Title1/Title2"
          /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s+([A-Z][a-z]+(?:\/[A-Z][a-z]+)*[^A-Z\n\r]{0,30})/g,
        ];
        
        for (const pattern of employeePatterns) {
          const matches = Array.from(gridText.matchAll(pattern));
          for (const match of matches) {
            const fullText = match[0].trim();
            
            // Skip if it's just a department header
            const isDepartmentHeader = departmentKeywords.some(dept => 
              fullText.toUpperCase().includes(dept.toUpperCase()) && 
              fullText.split(/\s+/).length <= 4
            );
            if (isDepartmentHeader) {
              continue;
            }
            
            const name = match[1].trim();
            const title = match[2]?.trim();
            
            // Determine department from context (look at parent elements)
            let department: string | undefined;
            let currentElement: any = grid;
            for (let i = 0; i < 5 && currentElement; i++) {
              const parentText = (currentElement.textContent || '').toUpperCase();
              for (const dept of departmentKeywords) {
                if (parentText.includes(dept.toUpperCase()) && 
                    parentText.indexOf(dept.toUpperCase()) < 200) { // Close to the start
                  department = dept;
                  break;
                }
              }
              if (department) break;
              currentElement = currentElement.parentElement;
            }
            
            // Skip if name is too short or looks like a title
            if (name.length < 4 || !title || title.length < 3) continue;
            
            // Skip common false positives
            const firstWord = name.split(' ')[0];
            if (['View', 'Click', 'Call', 'Visit', 'Get', 'See', 'Learn', 'All', 'Team'].includes(firstWord)) {
              continue;
            }
            
            // Validate it looks like a real name + title
            if (name.split(' ').length >= 2 && title.split(/\s+/).length >= 1) {
              teamMembers.push({
                name: name,
                job_title: title,
                department: department
              });
            }
          }
        }
      }
    }
    
    // Method 3: Direct text parsing from team sections in HTML
    const teamSectionPattern = /<[^>]*class="[^"]*(?:team|employee)[^"]*"[^>]*>([\s\S]{0,5000})<\/[^>]+>/gi;
    const teamMatches = Array.from(html.matchAll(teamSectionPattern));
    
    for (const match of teamMatches) {
      const sectionHtml = match[1];
      // Extract employee name + title patterns from HTML
      const nameTitlePattern = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s+([A-Z][a-z]+(?:\s+[A-Z\/][a-z]+)*)/g;
      const nameTitleMatches = Array.from(sectionHtml.matchAll(nameTitlePattern));
      
      for (const nameMatch of nameTitleMatches) {
        const name = nameMatch[1].trim();
        const title = nameMatch[2]?.trim();
        
        if (name.length >= 4 && title && title.length >= 3 && name.split(' ').length >= 2) {
          // Check if already added
          const exists = teamMembers.some(m => m.name === name && m.job_title === title);
          if (!exists) {
            teamMembers.push({
              name: name,
              job_title: title,
              department: undefined
            });
          }
        }
      }
    }
    
    // Deduplicate by name + title
    const unique = teamMembers.filter((member, index, self) =>
      index === self.findIndex(m => 
        m.name.toLowerCase() === member.name.toLowerCase() && 
        m.job_title?.toLowerCase() === member.job_title?.toLowerCase()
      )
    );
    
    console.log(`✅ Extracted ${unique.length} unique team members from page`);
    return unique;
    
  } catch (error) {
    console.error('Error extracting team members:', error);
    return [];
  }
}

/**
 * Validate extracted data against schema
 */
function validateExtraction(extracted: any, schema: any): {
  is_complete: boolean;
  missing_required: string[];
  missing_optional: string[];
  completeness_score: number;
} {
  const pageType = Object.values(schema.page_types || {})[0] as any;
  const requiredFields = schema.required_fields || [];
  const availableFields = schema.available_fields || [];

  const missingRequired = requiredFields.filter((f: string) => !extracted[f]);
  const missingOptional = availableFields.filter((f: string) => 
    !requiredFields.includes(f) && !extracted[f]
  );

  const extractedCount = Object.keys(extracted).length;
  const totalFields = availableFields.length;
  const completenessScore = totalFields > 0 ? extractedCount / totalFields : 0;

  return {
    is_complete: missingRequired.length === 0,
    missing_required: missingRequired,
    missing_optional: missingOptional,
    completeness_score: completenessScore
  };
}

/**
 * Calculate data completeness
 */
function calculateCompleteness(extracted: any, schema: any | null): number {
  if (!schema) {
    // Basic completeness check
    const criticalFields = ['name', 'logo', 'license'];
    const found = criticalFields.filter(f => extracted[f]);
    return found.length / criticalFields.length;
  }

  const validation = validateExtraction(extracted, schema);
  return validation.completeness_score;
}

/**
 * Use AI to backfill missing fields from the page HTML
 */
async function aiBackfillMissingFields(
  url: string,
  currentData: any,
  schema: any,
  supabase: any
): Promise<any> {
  
  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
  
  if (!openaiKey || !firecrawlKey) {
    console.log('⚠️  API keys missing, skipping AI backfill');
    return {};
  }

  // Get page content
  const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${firecrawlKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: url,
      formats: ['markdown'],
      waitFor: 2000
    })
  });

  if (!firecrawlResponse.ok) {
    console.log('⚠️  Firecrawl failed for AI backfill, skipping');
    return {};
  }

  const firecrawlData = await firecrawlResponse.json();
  if (!firecrawlData.success || !firecrawlData.data.markdown) {
    console.log('⚠️  No markdown content for AI backfill, skipping');
    return {};
  }

  const pageType = Object.values(schema.page_types || {})[0] as any;
  const availableFields = schema.available_fields || [];
  const requiredFields = schema.required_fields || [];
  
  // Determine missing fields
  const missingFields = availableFields.filter((field: string) => !currentData[field]);
  const missingRequired = missingFields.filter((f: string) => requiredFields.includes(f));
  
  if (missingFields.length === 0) {
    return {};
  }

  const fieldDescriptions: any = {};
  if (pageType?.fields) {
    for (const field of missingFields) {
      if (pageType.fields[field]) {
        fieldDescriptions[field] = pageType.fields[field];
      }
    }
  }

  const backfillPrompt = `You are extracting dealer/business information from a webpage.

URL: ${url}

ALREADY EXTRACTED DATA:
${JSON.stringify(currentData, null, 2)}

MISSING FIELDS TO EXTRACT:
${missingFields.map((f: string) => `- ${f}${requiredFields.includes(f) ? ' (REQUIRED)' : ' (OPTIONAL)'}`).join('\n')}

PAGE CONTENT (first 100k chars):
${firecrawlData.data.markdown.substring(0, 100000)}

SPECIAL INSTRUCTIONS:
1. **Address**: Look for patterns like "123 Street Name, City, State ZIP" or in elements like ".module-container", ".department-hours", ".address", etc.
   Extract: address (full street), city, state, zip separately.

2. **Phone**: Look for phone numbers in various formats: (629) 312-1110, 629-312-1110, etc.
   Often found in contact sections, header, footer, or department hours sections.

3. **Services**: Extract from:
   - Navigation menu links (look for service-related links like "Auto Spa", "Storage", "Events", "Consignment")
   - Paragraphs mentioning services (e.g., "Auto Spa Consignment Events Storage")
   - Service sections or pages
   Return as array: ["Service 1", "Service 2", ...]

4. **Team/Employees** - GOLD MINE DATA! Extract ALL team members found:
   
   First, look for team/department structure patterns:
   - <ul class="teams"> or <ul class="teams list-unstyled"> - these list departments/teams
   - Department categories like: "Management", "SALES", "SERVICE", "AUTO SPA", "STORAGE", "ADMINISTRATION", "EVENTS"
   
   Then extract individual employees:
   - Look for employee listings in patterns like:
     - <div class="row __inline-block-grid"> with employee cards
     - Team member items with name + title format: "Jeremy Scates President/CoFounder"
     - Employee cards/sections with structured data
   
   For EACH person found, extract:
   - name (full name like "Jeremy Scates", "Dan Hyland", "Chad Bray")
   - job_title (e.g., "President/CoFounder", "Service Manager", "Buyer", "Controller", "Partner")
   - department (extract from context: "Management", "Sales", "Service", "Auto Spa", "Storage", "Administration", "Events", etc.)
   
   Return as array: [{"name": "John Doe", "job_title": "President", "department": "Management"}, ...]
   
   This is valuable technician data - extract thoroughly from all team sections!
   Data is for internal records only - not shown publicly, used for future email outreach.

5. **Dealer License**: Often NOT on website - may need to look up business records separately.
   Only extract if explicitly found.

6. **Email**: Look for contact@, info@, sales@ patterns or contact forms.

Extract ONLY the missing fields. Return JSON:
{
  "field_name": "extracted value",
  ...
}

Return ONLY valid JSON with the missing fields.`;

  try {
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
            content: 'You are a data extraction assistant. Extract only the requested missing fields. Return only valid JSON.'
          },
          {
            role: 'user',
            content: backfillPrompt
          }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 2000
      })
    });

    if (!aiResponse.ok) {
      console.log('⚠️  AI backfill request failed');
      return {};
    }

    const aiData = await aiResponse.json();
    const backfillData = JSON.parse(aiData.choices[0].message.content);
    
    // If team_members was extracted, ensure it's in the right format
    if (backfillData.team_members && !Array.isArray(backfillData.team_members)) {
      // Try to parse if it's a string
      try {
        backfillData.team_members = typeof backfillData.team_members === 'string' 
          ? JSON.parse(backfillData.team_members) 
          : [];
      } catch {
        backfillData.team_members = [];
      }
    }
    
    console.log(`✅ AI backfilled ${Object.keys(backfillData).length} missing fields`);
    if (backfillData.team_members && Array.isArray(backfillData.team_members)) {
      console.log(`   Including ${backfillData.team_members.length} team members`);
    }
    return backfillData;
    
  } catch (error) {
    console.error('AI backfill error:', error);
    return {};
  }
}

