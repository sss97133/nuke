/**
 * INTELLIGENT WORK DETECTOR
 * 
 * Analyzes vehicle images to extract:
 * 1. Work type (upholstery, paint, engine, etc.)
 * 2. Work date (from EXIF or visual clues)
 * 3. Work location (from GPS or image context)
 * 4. Components worked on
 * 
 * Then probabilistically matches to organizations and sends approval requests.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface WorkExtraction {
  work_type: string;
  work_description: string;
  components: string[];
  detected_date?: string;
  location_address?: string;
  location_lat?: number;
  location_lng?: number;
  confidence: number;
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

    const { image_id, vehicle_id, image_url } = await req.json();

    if (!image_id || !vehicle_id || !image_url) {
      throw new Error('Missing required parameters: image_id, vehicle_id, image_url');
    }

    console.log(`[Intelligent Work Detector] Analyzing image ${image_id} for vehicle ${vehicle_id}`);

    // Step 1: Get image metadata (EXIF, GPS, etc.)
    const { data: imageData, error: imageError } = await supabase
      .from('vehicle_images')
      .select('id, image_url, exif_data, latitude, longitude, taken_at, created_at')
      .eq('id', image_id)
      .single();

    if (imageError || !imageData) {
      throw new Error(`Image not found: ${imageError?.message}`);
    }

    // Step 2: Extract location from EXIF/GPS
    const location = {
      address: null as string | null,
      lat: imageData.latitude || imageData.exif_data?.GPS?.Latitude || null,
      lng: imageData.longitude || imageData.exif_data?.GPS?.Longitude || null,
    };

    // Step 3: Extract date from EXIF or taken_at
    const detectedDate = imageData.taken_at 
      ? new Date(imageData.taken_at).toISOString().split('T')[0]
      : imageData.exif_data?.DateTimeOriginal 
      ? new Date(imageData.exif_data.DateTimeOriginal).toISOString().split('T')[0]
      : new Date(imageData.created_at).toISOString().split('T')[0];

    // Step 4: AI Vision Analysis - Extract work type and details
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) {
      throw new Error('OPENAI_API_KEY not configured');
    }

    const aiPrompt = `Analyze this vehicle work photo and extract structured work information.

CRITICAL: Extract the following with high precision:

1. **Work Type**: What type of work is being performed?
   - upholstery (seats, interior, headliner, door panels)
   - paint (body paint, custom paint, touch-up)
   - engine (engine work, rebuild, repair)
   - body_work (body repair, panel replacement, fabrication)
   - transmission (transmission work)
   - suspension (suspension work)
   - electrical (wiring, electrical work)
   - detailing (cleaning, polishing, detailing)
   - other (specify)

2. **Work Description**: 1-2 sentence description of what work is visible

3. **Components**: List specific vehicle components being worked on
   - For upholstery: ['seats', 'door_panels', 'headliner', 'carpet', etc.]
   - For paint: ['body', 'hood', 'doors', 'fenders', etc.]
   - For engine: ['engine', 'intake', 'exhaust', etc.]

4. **Date Clues**: Look for any visual clues about when work was done
   - Signs, calendars, receipts visible
   - Vehicle condition (before/after)
   - Tools/equipment that suggest timeframe

5. **Location Clues**: Any visible location indicators
   - Shop signs, business names
   - Address numbers
   - Distinctive features

Return ONLY valid JSON:
{
  "work_type": "upholstery",
  "work_description": "Interior seat reupholstery with custom fabric",
  "components": ["seats", "door_panels"],
  "date_clues": "No visible date clues",
  "location_clues": "Shop environment visible",
  "confidence": 0.95
}`;

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
        max_tokens: 500,
        temperature: 0.2, // Low temperature for factual extraction
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

    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Invalid JSON response from AI');
    }

    const workExtraction: WorkExtraction = JSON.parse(jsonMatch[0]);

    // Step 5: Calculate confidence scores
    const workTypeConfidence = workExtraction.confidence || 0.8;
    const dateConfidence = imageData.taken_at ? 0.9 : imageData.exif_data?.DateTimeOriginal ? 0.7 : 0.5;
    const locationConfidence = location.lat && location.lng ? 0.9 : 0.5;
    const overallConfidence = (workTypeConfidence * 0.6 + dateConfidence * 0.2 + locationConfidence * 0.2);

    // Step 6: Save work extraction
    const { data: extraction, error: extractionError } = await supabase
      .from('image_work_extractions')
      .insert({
        image_id,
        vehicle_id,
        detected_work_type: workExtraction.work_type,
        detected_work_description: workExtraction.work_description,
        detected_components: workExtraction.components || [],
        detected_date: detectedDate,
        detected_location_address: location.address,
        detected_location_lat: location.lat,
        detected_location_lng: location.lng,
        work_type_confidence: workTypeConfidence,
        date_confidence: dateConfidence,
        location_confidence: locationConfidence,
        overall_confidence: overallConfidence,
        ai_analysis: aiData,
        extraction_method: 'ai_vision',
        status: 'extracted',
        processed_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (extractionError) {
      throw extractionError;
    }

    console.log(`[Intelligent Work Detector] Work extracted: ${workExtraction.work_type} (confidence: ${overallConfidence})`);

    // Step 7: Run probabilistic matching
    const { data: matches, error: matchError } = await supabase.rpc('match_work_to_organizations', {
      p_work_extraction_id: extraction.id,
    });

    if (matchError) {
      console.error('[Intelligent Work Detector] Matching error:', matchError);
    } else {
      console.log(`[Intelligent Work Detector] Found ${matches?.length || 0} potential matches`);
      
      // Step 8: For high-probability matches (>=90%), auto-send notifications
      // For 70-89%, queue for review
      if (matches && matches.length > 0) {
        for (const match of matches) {
          if (match.match_probability >= 90) {
            // High confidence - send notification immediately
            await supabase
              .from('work_organization_matches')
              .update({
                notification_status: 'sent',
                notification_sent_at: new Date().toISOString(),
              })
              .eq('id', match.id);
            
            // TODO: Send actual notification (email, in-app, etc.)
            console.log(`[Intelligent Work Detector] High-confidence match (${match.match_probability}%): ${match.business_name}`);
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        extraction: {
          id: extraction.id,
          work_type: workExtraction.work_type,
          work_description: workExtraction.work_description,
          confidence: overallConfidence,
        },
        matches: matches || [],
        message: `Extracted ${workExtraction.work_type} work. Found ${matches?.length || 0} potential organization matches.`,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error: any) {
    console.error('[Intelligent Work Detector] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to extract work data' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

