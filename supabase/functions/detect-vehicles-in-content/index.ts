import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface VehicleDetection {
  make?: string;
  model?: string;
  year?: number;
  color?: string;
  license_plate?: string;
  vin?: string;
  is_primary_focus: boolean;
  distinctive_features?: string[];
  confidence: number;
}

interface DetectionRequest {
  content_id: string;
  image_urls: string[];
  organization_id?: string;
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

    const request: DetectionRequest = await req.json();
    const { content_id, image_urls, organization_id } = request;

    if (!content_id || !image_urls || image_urls.length === 0) {
      throw new Error('content_id and image_urls are required');
    }

    console.log(`[detect-vehicles-in-content] Analyzing ${image_urls.length} images for content ${content_id}`);

    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) {
      throw new Error('OPENAI_API_KEY not configured');
    }

    // 1. Analyze each image for vehicles
    const allDetections: VehicleDetection[] = [];

    for (const imageUrl of image_urls) {
      try {
        const detection = await analyzeImageForVehicles(imageUrl, openaiKey);
        if (detection && detection.vehicles && detection.vehicles.length > 0) {
          allDetections.push(...detection.vehicles);
        }
      } catch (error: any) {
        console.warn(`[detect-vehicles-in-content] Error analyzing image ${imageUrl}: ${error.message}`);
      }
    }

    if (allDetections.length === 0) {
      console.log(`[detect-vehicles-in-content] No vehicles detected in content ${content_id}`);
      
      // Update content status
      await supabase
        .from('user_content')
        .update({
          status: 'no_vehicle',
          vehicle_detection_confidence: 0,
          updated_at: new Date().toISOString()
        })
        .eq('id', content_id);

      return new Response(
        JSON.stringify({ success: true, vehicles_detected: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[detect-vehicles-in-content] Detected ${allDetections.length} vehicles`);

    // 2. Match detected vehicles to database
    const linksCreated = [];
    const primaryVehicle = allDetections.find(v => v.is_primary_focus) || allDetections[0];

    for (const detection of allDetections) {
      try {
        const matches = await findVehicleMatches(detection, organization_id, supabase);
        
        for (const match of matches) {
          if (match.confidence >= 0.5) {
            // Create content_vehicle_link
            const { data: link, error: linkError } = await supabase
              .from('content_vehicle_links')
              .insert({
                content_id: content_id,
                vehicle_id: match.vehicle_id,
                link_type: detection.is_primary_focus ? 'primary' : 'secondary',
                confidence: match.confidence,
                detection_method: 'image_analysis',
                detected_vehicle_data: detection
              })
              .select('id')
              .single();

            if (linkError && linkError.code !== '23505') { // Ignore duplicate key errors
              console.warn(`[detect-vehicles-in-content] Error creating link: ${linkError.message}`);
            } else if (!linkError) {
              linksCreated.push({
                vehicle_id: match.vehicle_id,
                confidence: match.confidence,
                link_type: detection.is_primary_focus ? 'primary' : 'secondary'
              });
            }
          }
        }
      } catch (error: any) {
        console.warn(`[detect-vehicles-in-content] Error matching vehicle: ${error.message}`);
      }
    }

    // 3. Update content record
    const maxConfidence = Math.max(...allDetections.map(v => v.confidence));
    const primaryLink = linksCreated.find(l => l.link_type === 'primary');
    
    await supabase
      .from('user_content')
      .update({
        primary_vehicle_id: primaryLink?.vehicle_id || null,
        vehicle_detection_confidence: maxConfidence,
        status: linksCreated.length > 0 ? 'verified' : 'pending_review',
        detected_vehicle_data: {
          detections: allDetections,
          links_created: linksCreated.length
        },
        updated_at: new Date().toISOString()
      })
      .eq('id', content_id);

    console.log(`[detect-vehicles-in-content] Created ${linksCreated.length} vehicle links for content ${content_id}`);

    return new Response(
      JSON.stringify({
        success: true,
        vehicles_detected: allDetections.length,
        links_created: linksCreated.length,
        links: linksCreated
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('[detect-vehicles-in-content] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function analyzeImageForVehicles(
  imageUrl: string,
  openaiKey: string
): Promise<{ vehicles: VehicleDetection[] } | null> {
  const prompt = `Analyze this Instagram post image and identify any vehicles visible.

Extract:
1. **Vehicle Count**: How many distinct vehicles are visible?
2. **For Each Vehicle**:
   - Make (e.g., "Porsche", "Ferrari", "BMW")
   - Model (e.g., "911", "Testarossa", "M3")
   - Year (if visible or estimable from design cues)
   - Color
   - Distinctive features (modifications, damage, custom paint, widebody kits, etc.)
   - License plate (if visible - extract full plate)
   - VIN tag (if visible - extract 17-character VIN)
   - Position in image (primary focus vs background)

3. **Context Clues**:
   - Location indicators (signs, landmarks)
   - Event type (car show, restoration, delivery)
   - Other vehicles visible (for context)

4. **Confidence**: How confident are you in each identification? (0.0-1.0)

Return JSON:
{
  "vehicles": [
    {
      "make": "Porsche",
      "model": "911",
      "year": 1973,
      "color": "Orange",
      "license_plate": "ABC1234",
      "vin": null,
      "is_primary_focus": true,
      "distinctive_features": ["RWB widebody", "custom wheels"],
      "confidence": 0.95
    }
  ],
  "context": {
    "location": "Car show",
    "event_type": "showcase"
  }
}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: { url: imageUrl, detail: 'high' }
            }
          ]
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 2000
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content;

  if (!content) {
    throw new Error('No content in OpenAI response');
  }

  try {
    const result = JSON.parse(content);
    return result;
  } catch (parseError) {
    console.warn('[detect-vehicles-in-content] Failed to parse OpenAI response:', content);
    return null;
  }
}

async function findVehicleMatches(
  detection: VehicleDetection,
  organizationId: string | undefined,
  supabase: any
): Promise<Array<{ vehicle_id: string; confidence: number }>> {
  const matches: Array<{ vehicle_id: string; confidence: number }> = [];

  // Build search query
  let query = supabase.from('vehicles').select('id, make, model, year, color, license_plate, vin');

  // VIN match (highest confidence - instant match)
  if (detection.vin) {
    const { data: vinMatch } = await supabase
      .from('vehicles')
      .select('id')
      .eq('vin', detection.vin.toUpperCase())
      .maybeSingle();

    if (vinMatch) {
      matches.push({ vehicle_id: vinMatch.id, confidence: 1.0 });
      return matches; // VIN match is definitive
    }
  }

  // License plate match (high confidence)
  if (detection.license_plate) {
    const normalizedPlate = detection.license_plate.replace(/[\s-]/g, '').toUpperCase();
    const { data: plateMatches } = await supabase
      .from('vehicles')
      .select('id, make, model, year, color')
      .ilike('license_plate', `%${normalizedPlate}%`);

    if (plateMatches && plateMatches.length > 0) {
      for (const vehicle of plateMatches) {
        let confidence = 0.85; // Base confidence for license plate match

        // Boost confidence if make/model/year also match
        if (detection.make && vehicle.make?.toLowerCase() === detection.make.toLowerCase()) {
          confidence += 0.05;
        }
        if (detection.model && vehicle.model?.toLowerCase() === detection.model.toLowerCase()) {
          confidence += 0.05;
        }
        if (detection.year && vehicle.year && Math.abs(vehicle.year - detection.year) <= 2) {
          confidence += 0.05;
        }

        matches.push({ vehicle_id: vehicle.id, confidence: Math.min(confidence, 1.0) });
      }
    }
  }

  // Make/model/year match
  if (detection.make && detection.model) {
    let makeModelQuery = supabase
      .from('vehicles')
      .select('id, make, model, year, color, license_plate')
      .ilike('make', detection.make)
      .ilike('model', detection.model);

    if (detection.year) {
      makeModelQuery = makeModelQuery
        .gte('year', detection.year - 2)
        .lte('year', detection.year + 2);
    }

    // If organization_id provided, boost vehicles linked to that org
    if (organizationId) {
      // Get vehicles linked to this organization
      const { data: orgVehicles } = await supabase
        .from('organization_vehicles')
        .select('vehicle_id')
        .eq('organization_id', organizationId)
        .eq('status', 'active');

      if (orgVehicles && orgVehicles.length > 0) {
        const orgVehicleIds = orgVehicles.map(ov => ov.vehicle_id);
        makeModelQuery = makeModelQuery.in('id', orgVehicleIds);
      }
    }

    const { data: makeModelMatches } = await makeModelQuery.limit(10);

    if (makeModelMatches) {
      for (const vehicle of makeModelMatches) {
        let confidence = 0.6; // Base confidence for make/model match

        // Year match boost
        if (detection.year && vehicle.year && Math.abs(vehicle.year - detection.year) <= 2) {
          confidence += 0.15;
        } else if (detection.year && vehicle.year) {
          confidence += 0.05; // Partial year match
        }

        // Color match boost
        if (detection.color && vehicle.color?.toLowerCase() === detection.color.toLowerCase()) {
          confidence += 0.1;
        }

        // Organization relationship boost
        if (organizationId) {
          confidence += 0.2;
        }

        matches.push({ vehicle_id: vehicle.id, confidence: Math.min(confidence, 1.0) });
      }
    }
  }

  // Sort by confidence and return top matches
  return matches
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5); // Top 5 matches
}

