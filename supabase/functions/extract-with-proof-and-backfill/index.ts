/**
 * Unified Extraction Flow: Extract → AI Proof → Re-extract Missing Data
 * 
 * Orchestrates the complete extraction pipeline:
 * 1. Multi-strategy extraction (Source Adapter → Firecrawl → LLM → DOM)
 * 2. AI proofreading and validation
 * 3. Re-extraction of missing data
 * 
 * All API keys should be in edge function secrets (OPENAI_API_KEY, FIRECRAWL_API_KEY)
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ExtractionRequest {
  url: string;
  source_type?: string;
  organization_id?: string;
  skip_proofreading?: boolean; // Skip AI proofreading step
  skip_re_extraction?: boolean; // Skip re-extraction step
}

interface ExtractionResult {
  success: boolean;
  data: any;
  confidence: number;
  extraction_method: string;
  missing_fields: string[];
  proofreading_applied: boolean;
  re_extraction_applied: boolean;
  error?: string;
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

    const body: ExtractionRequest = await req.json();
    const { 
      url, 
      source_type = 'dealer_website',
      organization_id,
      skip_proofreading = false,
      skip_re_extraction = false
    } = body;

    if (!url) {
      return new Response(
        JSON.stringify({ error: 'URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`🔍 Starting unified extraction for: ${url}`);

    // STEP 1: Multi-Strategy Extraction
    const extractionResult = await performMultiStrategyExtraction(url, source_type, supabase);
    
    if (!extractionResult.success) {
      return new Response(
        JSON.stringify(extractionResult),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`✅ Initial extraction completed (method: ${extractionResult.extraction_method}, confidence: ${extractionResult.confidence})`);

    // STEP 2: AI Proofreading (if enabled)
    let proofreadingResult = extractionResult;
    if (!skip_proofreading) {
      proofreadingResult = await performAIProofreading(
        url, 
        extractionResult.data, 
        extractionResult.extraction_method,
        supabase
      );
      console.log(`✅ AI Proofreading completed (confidence: ${proofreadingResult.confidence}, missing fields: ${proofreadingResult.missing_fields.length})`);
    }

    // STEP 3: Re-extract Missing Data (if confidence low and re-extraction enabled)
    let finalResult = proofreadingResult;
    if (!skip_re_extraction && proofreadingResult.confidence < 0.8 && proofreadingResult.missing_fields.length > 0) {
      finalResult = await performReExtraction(
        url,
        proofreadingResult.data,
        proofreadingResult.missing_fields,
        supabase
      );
      console.log(`✅ Re-extraction completed (confidence: ${finalResult.confidence})`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        ...finalResult,
        extraction_method: extractionResult.extraction_method,
        proofreading_applied: !skip_proofreading,
        re_extraction_applied: !skip_re_extraction && proofreadingResult.confidence < 0.8
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Unified extraction error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        confidence: 0
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * STEP 1: Multi-Strategy Extraction
 * Tries multiple extraction methods in order of preference
 */
async function performMultiStrategyExtraction(
  url: string,
  sourceType: string,
  supabase: any
): Promise<ExtractionResult> {
  
  // Strategy 1: Source-specific adapter (if exists)
  // TODO: Implement source adapters for Craigslist, Classic.com, DealerFire, etc.
  // For now, skip this step
  
  // Strategy 2: scrape-multi-source (Firecrawl + Schema + LLM fallback)
  try {
    console.log('🔥 Trying scrape-multi-source (Firecrawl + Schema)...');
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    
    const response = await fetch(`${supabaseUrl}/functions/v1/scrape-multi-source`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`
      },
      body: JSON.stringify({
        source_url: url,
        source_type: sourceType,
        use_llm_extraction: true,
        max_listings: 1, // Single listing extraction
        extract_listings: true,
        extract_dealer_info: true
      })
    });

    if (response.ok) {
      const result = await response.json();
      if (result.success && result.listings && result.listings.length > 0) {
        const listing = result.listings[0];
        
        // Calculate confidence based on data completeness
        const confidence = calculateDataCompleteness(listing);
        
        return {
          success: true,
          data: listing,
          confidence,
          extraction_method: 'firecrawl_schema',
          missing_fields: identifyMissingFields(listing),
          proofreading_applied: false,
          re_extraction_applied: false
        };
      }
    }
  } catch (error: any) {
    console.warn(`⚠️ scrape-multi-source failed: ${error.message}`);
  }

  // Strategy 3: extract-vehicle-data-ai (Pure LLM extraction)
  try {
    console.log('🤖 Trying extract-vehicle-data-ai (LLM)...');
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    
    const response = await fetch(`${supabaseUrl}/functions/v1/extract-vehicle-data-ai`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`
      },
      body: JSON.stringify({
        url: url
      })
    });

    if (response.ok) {
      const result = await response.json();
      if (result.success && result.data) {
        const confidence = result.confidence || calculateDataCompleteness(result.data);
        
        return {
          success: true,
          data: result.data,
          confidence,
          extraction_method: 'llm_extraction',
          missing_fields: identifyMissingFields(result.data),
          proofreading_applied: false,
          re_extraction_applied: false
        };
      }
    }
  } catch (error: any) {
    console.warn(`⚠️ extract-vehicle-data-ai failed: ${error.message}`);
  }

  // Strategy 4: scrape-vehicle (DOM + Regex - last resort)
  try {
    console.log('📄 Trying scrape-vehicle (DOM + Regex)...');
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    
    const response = await fetch(`${supabaseUrl}/functions/v1/scrape-vehicle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`
      },
      body: JSON.stringify({
        url: url
      })
    });

    if (response.ok) {
      const result = await response.json();
      if (result.success && result.data) {
        const confidence = calculateDataCompleteness(result.data);
        
        return {
          success: true,
          data: result.data,
          confidence,
          extraction_method: 'dom_regex',
          missing_fields: identifyMissingFields(result.data),
          proofreading_applied: false,
          re_extraction_applied: false
        };
      }
    }
  } catch (error: any) {
    console.warn(`⚠️ scrape-vehicle failed: ${error.message}`);
  }

  // All strategies failed
  return {
    success: false,
    data: {},
    confidence: 0,
    extraction_method: 'none',
    missing_fields: [],
    proofreading_applied: false,
    re_extraction_applied: false,
    error: 'All extraction strategies failed'
  };
}

/**
 * STEP 2: AI Proofreading
 * Uses ai-proofread-pending logic to validate and improve extraction
 */
async function performAIProofreading(
  url: string,
  extractedData: any,
  extractionMethod: string,
  supabase: any
): Promise<ExtractionResult> {
  
  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openaiKey) {
    console.warn('⚠️ OPENAI_API_KEY not configured, skipping proofreading');
    return {
      success: true,
      data: extractedData,
      confidence: calculateDataCompleteness(extractedData),
      extraction_method: extractionMethod,
      missing_fields: identifyMissingFields(extractedData),
      proofreading_applied: false,
      re_extraction_applied: false
    };
  }

  try {
    // Get fresh HTML content for proofreading
    let html = '';
    const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY');
    
    if (firecrawlApiKey) {
      try {
        const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${firecrawlApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: url,
            formats: ['html', 'markdown'],
            pageOptions: { waitFor: 2000 }
          }),
          signal: AbortSignal.timeout(15000)
        });

        if (firecrawlResponse.ok) {
          const firecrawlData = await firecrawlResponse.json();
          if (firecrawlData.success && firecrawlData.data?.html) {
            html = firecrawlData.data.html;
          }
        }
      } catch (e) {
        console.warn('Firecrawl failed, trying direct fetch');
      }
    }

    if (!html) {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        signal: AbortSignal.timeout(10000)
      });
      html = await response.text();
    }

    // Extract text content
    const textContent = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .substring(0, 30000);

    // AI Proofreading prompt
    const proofreadPrompt = `You are an expert vehicle data proofreader. Review the extracted data and improve it.

EXTRACTED DATA:
${JSON.stringify(extractedData, null, 2)}

SOURCE PAGE CONTENT (first 30k chars):
${textContent}

TASK:
1. Validate the extracted data for accuracy
2. Fill in any missing critical fields (VIN, year, make, model, price, mileage)
3. Normalize data formats (make, model, series, trim)
4. Identify any errors or inconsistencies

Return JSON:
{
  "corrected_data": {
    "vin": "corrected or null",
    "year": number or null,
    "make": "normalized make",
    "model": "normalized model",
    "series": "series if found",
    "trim": "trim if found",
    "price": number or null,
    "asking_price": number or null,
    "mileage": number or null,
    "color": "color if found",
    "transmission": "transmission if found",
    "drivetrain": "drivetrain if found",
    "engine": "engine if found",
    "description": "improved description",
    ... (all other fields)
  },
  "confidence": 0.0-1.0,
  "missing_fields": ["list of critical fields still missing"],
  "corrections": ["list of corrections made"]
}`;

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
            content: 'You are an expert vehicle data specialist. Return only valid JSON.'
          },
          {
            role: 'user',
            content: proofreadPrompt
          }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 2000
      })
    });

    if (!aiResponse.ok) {
      throw new Error(`AI API error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const proofreadResult = JSON.parse(aiData.choices[0].message.content);

    // Merge corrected data with original (prioritize corrections)
    const mergedData = {
      ...extractedData,
      ...proofreadResult.corrected_data
    };

    return {
      success: true,
      data: mergedData,
      confidence: proofreadResult.confidence || calculateDataCompleteness(mergedData),
      extraction_method: extractionMethod,
      missing_fields: proofreadResult.missing_fields || identifyMissingFields(mergedData),
      proofreading_applied: true,
      re_extraction_applied: false
    };

  } catch (error: any) {
    console.error('AI proofreading failed:', error);
    // Return original data if proofreading fails
    return {
      success: true,
      data: extractedData,
      confidence: calculateDataCompleteness(extractedData),
      extraction_method: extractionMethod,
      missing_fields: identifyMissingFields(extractedData),
      proofreading_applied: false,
      re_extraction_applied: false
    };
  }
}

/**
 * STEP 3: Re-extract Missing Data
 * Targeted re-extraction of missing critical fields
 */
async function performReExtraction(
  url: string,
  currentData: any,
  missingFields: string[],
  supabase: any
): Promise<ExtractionResult> {
  
  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openaiKey || missingFields.length === 0) {
    return {
      success: true,
      data: currentData,
      confidence: calculateDataCompleteness(currentData),
      extraction_method: 'none',
      missing_fields: missingFields,
      proofreading_applied: false,
      re_extraction_applied: false
    };
  }

  try {
    // Get fresh HTML
    let html = '';
    const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY');
    
    if (firecrawlApiKey) {
      const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${firecrawlApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: url,
          formats: ['html', 'markdown'],
          pageOptions: { waitFor: 2000 }
        }),
        signal: AbortSignal.timeout(15000)
      });

      if (firecrawlResponse.ok) {
        const firecrawlData = await firecrawlResponse.json();
        if (firecrawlData.success && firecrawlData.data?.html) {
          html = firecrawlData.data.html;
        }
        if (firecrawlData.success && firecrawlData.data?.markdown) {
          html = firecrawlData.data.markdown;
        }
      }
    }

    if (!html) {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        signal: AbortSignal.timeout(10000)
      });
      html = await response.text();
    }

    const textContent = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .substring(0, 30000);

    // Targeted re-extraction prompt
    const reExtractPrompt = `You are extracting specific missing vehicle data fields.

CURRENT DATA:
${JSON.stringify(currentData, null, 2)}

MISSING FIELDS TO EXTRACT:
${missingFields.join(', ')}

SOURCE PAGE CONTENT:
${textContent}

Extract ONLY the missing fields. Return JSON:
{
  "extracted_fields": {
    "field1": "value1",
    "field2": "value2",
    ... (only fields from missing_fields list)
  },
  "confidence": 0.0-1.0,
  "still_missing": ["fields that still couldn't be found"]
}`;

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
            content: 'You are an expert vehicle data extractor. Return only valid JSON with the requested fields.'
          },
          {
            role: 'user',
            content: reExtractPrompt
          }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 1000
      })
    });

    if (!aiResponse.ok) {
      throw new Error(`AI API error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const reExtractResult = JSON.parse(aiData.choices[0].message.content);

    // Merge re-extracted fields
    const finalData = {
      ...currentData,
      ...reExtractResult.extracted_fields
    };

    return {
      success: true,
      data: finalData,
      confidence: reExtractResult.confidence || calculateDataCompleteness(finalData),
      extraction_method: 're_extraction',
      missing_fields: reExtractResult.still_missing || identifyMissingFields(finalData),
      proofreading_applied: true,
      re_extraction_applied: true
    };

  } catch (error: any) {
    console.error('Re-extraction failed:', error);
    return {
      success: true,
      data: currentData,
      confidence: calculateDataCompleteness(currentData),
      extraction_method: 'none',
      missing_fields: missingFields,
      proofreading_applied: true,
      re_extraction_applied: false
    };
  }
}

/**
 * Calculate data completeness confidence score
 */
function calculateDataCompleteness(data: any): number {
  const criticalFields = ['vin', 'year', 'make', 'model', 'price', 'mileage'];
  const optionalFields = ['trim', 'series', 'color', 'transmission', 'drivetrain', 'engine', 'description'];
  
  let score = 0;
  let maxScore = criticalFields.length * 2 + optionalFields.length; // Critical fields weighted 2x
  
  // Check critical fields
  for (const field of criticalFields) {
    if (data[field] !== null && data[field] !== undefined && data[field] !== '') {
      score += 2;
    }
  }
  
  // Check optional fields
  for (const field of optionalFields) {
    if (data[field] !== null && data[field] !== undefined && data[field] !== '') {
      score += 1;
    }
  }
  
  return Math.min(score / maxScore, 1.0);
}

/**
 * Identify missing critical fields
 */
function identifyMissingFields(data: any): string[] {
  const criticalFields = ['vin', 'year', 'make', 'model', 'price', 'mileage'];
  const missing: string[] = [];
  
  for (const field of criticalFields) {
    if (!data[field] || data[field] === null || data[field] === undefined || data[field] === '') {
      missing.push(field);
    }
  }
  
  return missing;
}

