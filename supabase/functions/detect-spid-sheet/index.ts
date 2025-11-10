import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * SPID SHEET DETECTOR
 * 
 * Detects GM SPID (Service Parts Identification) sheets and extracts:
 * - VIN
 * - Build date/sequence
 * - Paint codes (exterior/interior)
 * - RPO codes (Regular Production Options)
 * - Engine code
 * - Transmission code
 * - Rear axle ratio
 * - All factory options
 */

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageId, imageUrl } = await req.json();

    if (!imageId || !imageUrl) {
      return new Response(
        JSON.stringify({ error: 'imageId and imageUrl required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Analyzing image for SPID sheet: ${imageId}`);

    // Call OpenAI Vision API
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) {
      throw new Error('OPENAI_API_KEY not configured');
    }

    const visionResponse = await fetch('https://api.openai.com/v1/chat/completions', {
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
            content: `You are a GM SPID (Service Parts Identification) sheet expert. Analyze images to detect and extract data from SPID sheets.

SPID sheets are labels found on GM vehicles (usually on the glove box or center console) that contain:
- VIN (17-character alphanumeric)
- Build date and sequence number
- Paint codes (exterior and interior trim codes)
- RPO codes (3-character option codes like G80, KC4, etc.)
- Engine code (e.g., L31, LT1, LS1)
- Transmission code (e.g., 4L60E, TH400)
- Rear axle ratio (e.g., 3.73, 4.10)

Return a JSON object with:
{
  "is_spid_sheet": boolean,
  "confidence": number (0-100),
  "extracted_data": {
    "vin": string | null,
    "build_date": string | null,
    "paint_code_exterior": string | null,
    "paint_code_interior": string | null,
    "rpo_codes": string[],
    "engine_code": string | null,
    "transmission_code": string | null,
    "axle_ratio": string | null
  },
  "raw_text": string
}`
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Analyze this image. Is it a GM SPID sheet? If yes, extract all visible data.'
              },
              {
                type: 'image_url',
                image_url: {
                  url: imageUrl,
                  detail: 'high'
                }
              }
            ]
          }
        ],
        max_tokens: 2000,
        response_format: { type: 'json_object' }
      })
    });

    const visionData = await visionResponse.json();
    
    if (visionData.error) {
      throw new Error(`OpenAI API error: ${visionData.error.message}`);
    }

    const result = JSON.parse(visionData.choices[0].message.content);

    // If SPID sheet detected, update the image record
    if (result.is_spid_sheet && result.confidence >= 70) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );

      // Update image metadata
      await supabase
        .from('vehicle_images')
        .update({
          category: 'document',
          ai_scan_metadata: {
            ...result,
            scanned_at: new Date().toISOString(),
            scan_type: 'spid_sheet'
          }
        })
        .eq('id', imageId);

      // If VIN was extracted, create data validation
      if (result.extracted_data.vin) {
        const { data: image } = await supabase
          .from('vehicle_images')
          .select('vehicle_id')
          .eq('id', imageId)
          .single();

        if (image) {
          await supabase
            .from('data_validations')
            .insert({
              entity_type: 'vehicle',
              entity_id: image.vehicle_id,
              field_name: 'vin',
              field_value: result.extracted_data.vin,
              validation_source: 'spid_sheet',
              confidence_score: result.confidence,
              source_url: imageUrl,
              notes: 'VIN extracted from SPID sheet'
            });
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        ...result
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error detecting SPID sheet:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

