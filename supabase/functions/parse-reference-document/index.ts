import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ExtractionResult {
  specifications: {
    dimensions?: {
      wheelbase?: number;
      length?: number;
      width?: number;
      height?: number;
      ground_clearance?: number;
      [key: string]: any;
    };
    weights?: {
      curb_weight?: number;
      gvwr?: number;
      payload?: number;
      towing_capacity?: number;
      [key: string]: any;
    };
    engines?: Array<{
      code?: string;
      displacement_cid?: number;
      displacement_liters?: number;
      configuration?: string;
      horsepower?: number;
      torque?: number;
      rpm_hp?: string;
      rpm_torque?: string;
      bore_stroke?: string;
      compression_ratio?: string;
    }>;
    transmissions?: Array<{
      type?: string;
      speeds?: number;
      notes?: string;
    }>;
    fuel_economy?: {
      city?: number;
      highway?: number;
      combined?: number;
    };
    capacities?: {
      fuel_tank_gallons?: number;
      oil_quarts?: number;
      coolant_quarts?: number;
    };
  };
  colors: Array<{
    code: string;
    name: string;
    color_family?: string;
    is_two_tone?: boolean;
    is_metallic?: boolean;
  }>;
  options: Array<{
    rpo_code?: string;
    description: string;
    category?: string;
  }>;
  trim_levels: Array<{
    name: string;
    code?: string;
    description?: string;
    features?: string[];
  }>;
  emblems: Array<{
    type: string;
    variant: string;
    placements: string[];
    style_notes?: string;
  }>;
  meta: {
    year_published?: number;
    publisher?: string;
    document_number?: string;
    print_date?: string;
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { documentId } = await req.json();
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    
    // Get document
    const { data: doc, error: docError } = await supabase
      .from('library_documents')
      .select(`
        *,
        reference_libraries!inner (
          year,
          make,
          series,
          body_style
        )
      `)
      .eq('id', documentId)
      .single();
    
    if (docError || !doc) {
      throw new Error('Document not found');
    }
    
    // Extract using OpenAI
    const extracted = await extractWithOpenAI(doc.file_url);
    
    // Store extraction for review
    const { data: extraction, error: insertError } = await supabase
      .from('document_extractions')
      .insert({
        document_id: documentId,
        extracted_data: extracted,
        status: 'pending_review',
        extracted_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (insertError) {
      throw insertError;
    }
    
    return new Response(JSON.stringify({
      success: true,
      extraction_id: extraction.id,
      summary: {
        engines_found: extracted.specifications?.engines?.length || 0,
        colors_found: extracted.colors?.length || 0,
        options_found: extracted.options?.length || 0,
        specs_extracted: Object.keys(extracted.specifications || {}).length
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    return new Response(JSON.stringify({ 
      error: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function extractWithOpenAI(fileUrl: string): Promise<ExtractionResult> {
  const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY');
  
  const prompt = `You are analyzing a vintage GM truck brochure. Extract ALL specifications, options, and data.

Return a comprehensive JSON object with:

1. specifications:
   - dimensions (wheelbase, length, width, height in inches)
   - weights (curb weight, GVWR, payload, towing in lbs)
   - engines (all available engines with CID, HP, torque, RPM ranges, bore/stroke, compression)
   - transmissions (all available transmissions with speeds and type)
   - fuel_economy (city, highway, combined MPG if shown)
   - capacities (fuel tank gallons, oil quarts, coolant)

2. colors: Array of all paint colors with:
   - code (GM numeric code, e.g., "70")
   - name (e.g., "Cardinal Red")
   - color_family ("red", "blue", etc.)
   - is_two_tone (if two-tone only)
   - is_metallic (if metallic finish)

3. options: All RPO codes and options
   - rpo_code (e.g., "Z62", "YE9")
   - description
   - category ("engine", "transmission", "interior", "exterior", "chassis")

4. trim_levels: All trim packages
   - name (e.g., "Cheyenne", "Sierra Grande", "Custom")
   - code (RPO if shown)
   - features (what's included)

5. emblems: Identify GM emblems shown
   - type ("bowtie", "shield", "script")
   - variant (describe the specific design)
   - placements (where it appears on vehicle)

6. meta:
   - year_published
   - publisher ("General Motors", etc.)
   - document_number (if shown)
   - print_date

Be EXTREMELY thorough. Extract EVERY number, EVERY color, EVERY option.
For tables, capture ALL rows and columns.
Pay special attention to footnotes and disclaimers.

Return valid JSON only.`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: fileUrl } }
        ]
      }],
      response_format: { type: 'json_object' },
      max_tokens: 4000
    })
  });
  
  const data = await response.json();
  return JSON.parse(data.choices[0].message.content);
}

