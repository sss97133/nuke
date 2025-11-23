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
    
    // Get ALL documents from the same library (for multi-page brochures)
    // Process all pages/images together - no time window, just same library + type
    const { data: allDocs, error: docsError } = await supabase
      .from('library_documents')
      .select('id, file_url, title, uploaded_at')
      .eq('library_id', doc.library_id)
      .eq('document_type', doc.document_type)
      .order('uploaded_at', { ascending: true });
    
    if (docsError) {
      console.error('Error fetching related documents:', docsError);
    }
    
    console.log(`Found ${allDocs?.length || 0} documents in library ${doc.library_id} for processing`);
    
    // Return immediately - process in background
    // This allows users to navigate away without losing progress
    processExtractionInBackground(allDocs || [], documentId, doc.library_id);
    
    return new Response(JSON.stringify({
      success: true,
      message: `Processing ${allDocs?.length || 0} pages in background. Check review page in a few minutes!`,
      pages_queued: allDocs?.length || 0
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

// Process extraction in background (non-blocking)
async function processExtractionInBackground(
  allDocs: Array<{id: string, file_url: string, title: string}>,
  documentId: string,
  libraryId: string
) {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
  
  try {
    console.log(`[Background] Starting extraction for ${allDocs.length} pages`);
    
    // Extract from all pages/images
    const allExtractions: ExtractionResult[] = [];
    for (let i = 0; i < allDocs.length; i++) {
      const pageDoc = allDocs[i];
      try {
        console.log(`[Background] Processing page ${i + 1}/${allDocs.length}: ${pageDoc.title}`);
        const extracted = await extractWithOpenAI(pageDoc.file_url);
        allExtractions.push(extracted);
      } catch (error) {
        console.error(`[Background] Failed to extract from ${pageDoc.title}:`, error);
        // Continue with other pages
      }
    }
    
    console.log(`[Background] Completed extraction from ${allExtractions.length} pages`);
    
    // Merge all extractions into one comprehensive result
    const merged = mergeExtractions(allExtractions);
    
    // Store extraction for review
    const { data: extraction, error: insertError } = await supabase
      .from('document_extractions')
      .insert({
        document_id: documentId,
        extracted_data: merged,
        status: 'pending_review',
        extracted_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (insertError) {
      console.error('[Background] Failed to save extraction:', insertError);
      throw insertError;
    }
    
    console.log(`[Background] Extraction saved: ${extraction.id} with ${allExtractions.length} pages processed`);
    
  } catch (error) {
    console.error('[Background] Extraction failed:', error);
    // Still try to save a partial extraction
    try {
      await supabase
        .from('document_extractions')
        .insert({
          document_id: documentId,
          extracted_data: { error: 'Extraction failed', message: error.message },
          status: 'rejected',
          extracted_at: new Date().toISOString()
        });
    } catch (e) {
      console.error('[Background] Failed to save error record:', e);
    }
  }
}

// Merge multiple page extractions into one comprehensive result
function mergeExtractions(extractions: ExtractionResult[]): ExtractionResult {
  if (extractions.length === 0) {
    return {
      specifications: {},
      colors: [],
      options: [],
      trim_levels: [],
      emblems: [],
      meta: {}
    };
  }
  
  if (extractions.length === 1) {
    return extractions[0];
  }
  
  // Merge arrays, deduplicate by key fields
  const merged: ExtractionResult = {
    specifications: {},
    colors: [],
    options: [],
    trim_levels: [],
    emblems: [],
    meta: {}
  };
  
  // Merge specifications (take first non-null value)
  for (const ext of extractions) {
    if (ext.specifications) {
      if (!merged.specifications.dimensions && ext.specifications.dimensions) {
        merged.specifications.dimensions = ext.specifications.dimensions;
      }
      if (!merged.specifications.weights && ext.specifications.weights) {
        merged.specifications.weights = ext.specifications.weights;
      }
      if (!merged.specifications.engines && ext.specifications.engines) {
        merged.specifications.engines = ext.specifications.engines;
      } else if (ext.specifications.engines && merged.specifications.engines) {
        // Merge engines, deduplicate by code
        const engineMap = new Map();
        [...merged.specifications.engines, ...ext.specifications.engines].forEach(eng => {
          const key = eng.code || eng.displacement_cid || eng.displacement_liters || JSON.stringify(eng);
          if (!engineMap.has(key)) {
            engineMap.set(key, eng);
          }
        });
        merged.specifications.engines = Array.from(engineMap.values());
      }
      if (!merged.specifications.transmissions && ext.specifications.transmissions) {
        merged.specifications.transmissions = ext.specifications.transmissions;
      }
      if (!merged.specifications.fuel_economy && ext.specifications.fuel_economy) {
        merged.specifications.fuel_economy = ext.specifications.fuel_economy;
      }
      if (!merged.specifications.capacities && ext.specifications.capacities) {
        merged.specifications.capacities = ext.specifications.capacities;
      }
    }
  }
  
  // Merge colors (deduplicate by code)
  const colorMap = new Map();
  for (const ext of extractions) {
    if (ext.colors) {
      ext.colors.forEach(color => {
        const key = color.code || color.name;
        if (!colorMap.has(key)) {
          colorMap.set(key, color);
        }
      });
    }
  }
  merged.colors = Array.from(colorMap.values());
  
  // Merge options (deduplicate by RPO code or description)
  const optionMap = new Map();
  for (const ext of extractions) {
    if (ext.options) {
      ext.options.forEach(opt => {
        const key = opt.rpo_code || opt.description;
        if (!optionMap.has(key)) {
          optionMap.set(key, opt);
        }
      });
    }
  }
  merged.options = Array.from(optionMap.values());
  
  // Merge trim levels (deduplicate by name or code)
  const trimMap = new Map();
  for (const ext of extractions) {
    if (ext.trim_levels) {
      ext.trim_levels.forEach(trim => {
        const key = trim.code || trim.name;
        if (!trimMap.has(key)) {
          trimMap.set(key, trim);
        }
      });
    }
  }
  merged.trim_levels = Array.from(trimMap.values());
  
  // Merge emblems
  const emblemMap = new Map();
  for (const ext of extractions) {
    if (ext.emblems) {
      ext.emblems.forEach(emblem => {
        const key = `${emblem.type}-${emblem.variant}`;
        if (!emblemMap.has(key)) {
          emblemMap.set(key, emblem);
        }
      });
    }
  }
  merged.emblems = Array.from(emblemMap.values());
  
  // Merge meta (take most complete)
  for (const ext of extractions) {
    if (ext.meta) {
      merged.meta = { ...merged.meta, ...ext.meta };
    }
  }
  
  return merged;
}

