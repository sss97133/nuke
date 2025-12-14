import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * AI-powered image angle detection
 * Analyzes vehicle images and tags them with specific angles/perspectives
 * Uses OpenAI Vision API to identify: "front quarter driver", "dashboard full view", etc.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageId, imageUrl, vehicleId } = await req.json();

    if (!imageId || !imageUrl) {
      return new Response(
        JSON.stringify({ error: 'imageId and imageUrl required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Analyzing image for angle/perspective: ${imageUrl.substring(0, 100)}`);

    // Call OpenAI Vision API
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    const MIN_INSERT_CONFIDENCE = 80;
    
    const visionResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are a vehicle photography expert analyzing angles and perspectives.

Categorize this image into ONE primary angle from this taxonomy:

CRITICAL GUARDRAILS:
- Do NOT default to a "quarter" or "three-quarter" exterior angle.
- Only choose exterior full-vehicle angles (front_quarter_*, rear_quarter_*, profile_*, front_straight, rear_straight, roof_view) if the FULL vehicle is visible in frame.
- If the image is cropped/close-up, prefer a specific DETAIL angle (wheels_closeup, badges, lights_*, etc.) or the closest non-exterior category.
- If uncertain, lower confidence. It's better to be conservative than wrong.

EXTERIOR:
- front_quarter_driver: Front 3/4 view from driver side
- front_quarter_passenger: Front 3/4 view from passenger side
- rear_quarter_driver: Rear 3/4 view from driver side
- rear_quarter_passenger: Rear 3/4 view from passenger side
- profile_driver: Full side view driver side
- profile_passenger: Full side view passenger side
- front_straight: Head-on front view
- rear_straight: Head-on rear view
- roof_view: Top-down or elevated roof view
- bed_interior: Inside truck bed/cargo area

INTERIOR:
- dash_full: Full dashboard view (gauges, steering wheel, center console)
- driver_seat: Driver seat and door panel
- passenger_seat: Passenger seat and door panel
- rear_seats: Back seats or crew cab
- headliner: Roof interior
- carpet_floor: Floor mats, carpet condition

UNDERCARRIAGE:
- frame_driver_front: Frame rail driver side front
- frame_driver_rear: Frame rail driver side rear
- frame_passenger_front: Frame rail passenger front
- frame_passenger_rear: Frame rail passenger rear
- front_suspension: Front axle, springs, shocks
- rear_suspension: Rear axle, springs, differential
- exhaust_system: Exhaust routing, muffler
- fuel_tank: Fuel tank and mounting

ENGINE_BAY:
- engine_full: Complete engine bay overview
- engine_driver: Engine from driver side
- engine_passenger: Engine from passenger side
- firewall: Firewall and wiring

VIN_PLATES:
- door_jamb_vin: VIN sticker on door jamb
- dash_vin: VIN through windshield
- frame_vin: Frame stamped VIN

DETAILS:
- wheels_closeup: Wheel/tire detail
- badges: Model badges, emblems
- lights_front: Headlights, turn signals
- lights_rear: Tail lights

Also detect:
- Perspective type: wide_angle, standard, portrait, telephoto, super_telephoto
- Estimated focal length (mm)
- Sensor type if detectable: full_frame, aps_c, phone

Return JSON:
{
  "angle": "front_quarter_driver",
  "category": "exterior",
  "confidence": 95,
  "evidence": {
    "full_vehicle_in_frame": true,
    "front_end_visible": true,
    "rear_end_visible": false,
    "side_profile_visible": true
  },
  "perspective": "wide_angle",
  "focal_length": 24,
  "sensor_type": "phone",
  "notes": "Brief description of what's visible"
}`
          },
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: imageUrl }
              },
              {
                type: 'text',
                text: 'What angle/perspective is this vehicle photo? Return only JSON.'
              }
            ]
          }
        ],
        max_tokens: 300
      })
    });

    const visionData = await visionResponse.json();
    const aiResponse = visionData.choices?.[0]?.message?.content || '{}';
    
    // Parse AI response
    const parsed = JSON.parse(aiResponse.replace(/```json\n?/g, '').replace(/```\n?/g, ''));
    
    console.log('AI tagged angle:', parsed);
    
    // Confidence gating + deterministic guardrails
    const ev = parsed?.evidence || {};
    const full = !!ev.full_vehicle_in_frame;
    const angleName = String(parsed?.angle || '');
    let confidence = typeof parsed?.confidence === 'number' ? parsed.confidence : 80;
    
    const fullVehicleAngles = new Set([
      'front_quarter_driver',
      'front_quarter_passenger',
      'rear_quarter_driver',
      'rear_quarter_passenger',
      'profile_driver',
      'profile_passenger',
      'front_straight',
      'rear_straight',
      'roof_view'
    ]);
    
    if (fullVehicleAngles.has(angleName) && !full) {
      confidence = Math.min(confidence, 60);
    }
    
    if (confidence < MIN_INSERT_CONFIDENCE) {
      return new Response(
        JSON.stringify({
          success: true,
          skipped: true,
          reason: `Low confidence (${confidence}) or insufficient evidence for angle`,
          tagging: { ...parsed, confidence }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Find the angle ID
    const { data: angle } = await supabase
      .from('image_coverage_angles')
      .select('id')
      .eq('category', parsed.category)
      .eq('angle_name', parsed.angle)
      .single();

    if (angle) {
      // Tag the image
      await supabase
        .from('vehicle_image_angles')
        .insert({
          image_id: imageId,
          vehicle_id: vehicleId,
          angle_id: angle.id,
          confidence_score: confidence,
          tagged_by: 'ai',
          perspective_type: parsed.perspective,
          focal_length_mm: parsed.focal_length,
          sensor_type: parsed.sensor_type
        });
    }

    return new Response(
      JSON.stringify({
        success: true,
        tagging: parsed
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error tagging image angle:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

