/**
 * DETAILED COMPONENT EXTRACTOR - Stage 2 Processing
 * 
 * After basic work detection, this extracts:
 * - Specific parts/components visible
 * - Condition of each part
 * - Brands/logos visible
 * - Materials and finishes
 * - Damage/rust/wear assessment
 * 
 * Stores in: ai_component_detections table
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ComponentDetection {
  component_name: string;
  component_category: string;
  confidence: number;
  condition?: string;
  condition_details?: string;
  brand?: string;
  material?: string;
  location?: string;
  bounding_box?: { x: number; y: number; width: number; height: number };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    const { image_id, vehicle_id, image_url, work_extraction_id } = await req.json();

    if (!image_id || !vehicle_id || !image_url) {
      throw new Error('Missing required parameters: image_id, vehicle_id, image_url');
    }

    console.log(`[Detailed Component Extractor] Processing image ${image_id} (Stage 2)`);

    // Get work extraction context if available
    let workContext = null;
    if (work_extraction_id) {
      const { data: workData } = await supabase
        .from('image_work_extractions')
        .select('detected_work_type, detected_work_description, detected_components')
        .eq('id', work_extraction_id)
        .single();
      
      workContext = workData;
    }

    // Get vehicle context
    const { data: vehicleData } = await supabase
      .from('vehicles')
      .select('year, make, model, body_style')
      .eq('id', vehicle_id)
      .single();

    // AI Vision Analysis - Extract detailed components
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) {
      throw new Error('OPENAI_API_KEY not configured');
    }

    const contextInfo = vehicleData 
      ? `Vehicle: ${vehicleData.year} ${vehicleData.make} ${vehicleData.model} ${vehicleData.body_style || ''}`
      : '';

    const workInfo = workContext
      ? `\nWork Context: ${workContext.detected_work_type} - ${workContext.detected_work_description}\nComponents mentioned: ${workContext.detected_components?.join(', ') || 'none'}`
      : '';

    const aiPrompt = `Analyze this vehicle image in DETAIL. Extract ALL visible components, parts, and details.

${contextInfo}${workInfo}

CRITICAL: Extract EVERYTHING visible with high precision:

1. **Components/Parts**: List EVERY part visible (be specific):
   - Engine: alternator, carburetor, distributor, air filter, etc.
   - Body: fender, door, hood, bumper, grille, headlight, taillight, etc.
   - Interior: seat, dashboard, steering wheel, door panel, etc.
   - Suspension: shock, spring, control arm, etc.
   - Wheels: wheel, tire, brake caliper, rotor, etc.

2. **Condition**: For each component, assess condition:
   - excellent, good, fair, poor
   - rust, corrosion, damage, wear, scratches, dents
   - new, restored, original, aftermarket, custom

3. **Brands/Logos**: Any visible brand names, logos, or manufacturer markings

4. **Materials**: Material type (metal, plastic, leather, vinyl, chrome, etc.)

5. **Location**: Where on vehicle (front_left, driver_side, engine_bay, etc.)

Return ONLY valid JSON array:
[
  {
    "component_name": "brake caliper",
    "component_category": "braking",
    "confidence": 0.95,
    "condition": "good",
    "condition_details": "Minor surface rust, functional",
    "brand": "Wilwood",
    "material": "aluminum",
    "location": "front_left"
  },
  {
    "component_name": "fender",
    "component_category": "body",
    "confidence": 0.90,
    "condition": "fair",
    "condition_details": "Some scratches and minor dents",
    "brand": null,
    "material": "steel",
    "location": "driver_side"
  }
]

Be COMPREHENSIVE. List EVERYTHING you can see.`;

    const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: aiPrompt },
              {
                type: 'image_url',
                image_url: { url: image_url, detail: 'high' },
              },
            ],
          },
        ],
        max_tokens: 2000,
        temperature: 0.2,
      }),
    });

    if (!aiResponse.ok) {
      const error = await aiResponse.text();
      throw new Error(`OpenAI API error: ${error}`);
    }

    const aiData = await aiResponse.json();
    const content = aiData.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from OpenAI');
    }

    // Parse JSON array from response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('Invalid JSON response from AI');
    }

    const components: ComponentDetection[] = JSON.parse(jsonMatch[0]);

    console.log(`[Detailed Component Extractor] Found ${components.length} components`);

    // Store each component in ai_component_detections
    const insertPromises = components.map(comp => 
      supabase
        .from('ai_component_detections')
        .insert({
          vehicle_image_id: image_id,
          component_name: comp.component_name,
          component_category: comp.component_category || 'other',
          confidence_score: comp.confidence,
          ai_reasoning: `Condition: ${comp.condition || 'unknown'}. ${comp.condition_details || ''}. Brand: ${comp.brand || 'none'}. Material: ${comp.material || 'unknown'}. Location: ${comp.location || 'unknown'}`,
          quadrant: comp.location || null,
          bounding_box: comp.bounding_box || null,
          detection_timestamp: new Date().toISOString(),
          ai_model: 'gpt-4o',
        })
    );

    const results = await Promise.all(insertPromises);
    const errors = results.filter(r => r.error);
    
    if (errors.length > 0) {
      console.error('[Detailed Component Extractor] Some insertions failed:', errors);
    }

    const successCount = results.length - errors.length;

    // Update work extraction to mark as detailed extraction complete
    if (work_extraction_id) {
      await supabase
        .from('image_work_extractions')
        .update({
          status: 'detailed_extracted',
          processed_at: new Date().toISOString(),
        })
        .eq('id', work_extraction_id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        components_extracted: successCount,
        components: components.map(c => ({
          name: c.component_name,
          category: c.component_category,
          condition: c.condition,
          confidence: c.confidence,
        })),
        message: `Extracted ${successCount} detailed components.`,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error: any) {
    console.error('[Detailed Component Extractor] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to extract detailed components' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

