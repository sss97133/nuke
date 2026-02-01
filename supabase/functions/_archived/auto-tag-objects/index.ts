import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

interface DetectedObject {
  object_class: string;
  description: string;
  confidence: number;
  bounding_box: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  attributes?: Record<string, any>;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          persistSession: false,
          detectSessionInUrl: false
        }
      }
    );

    const { image_url, image_id, vehicle_id, user_id, timestamp } = await req.json();

    if (!image_url || !image_id) {
      throw new Error('Missing image_url or image_id');
    }

    console.log('🎯 Auto-tagging objects in image:', image_id);

    // 1. Detect objects in image using OpenAI Vision
    const detectedObjects = await detectObjectsWithVision(image_url);
    console.log(`Found ${detectedObjects.length} objects`);

    // 2. For vehicle objects, cross-reference with user's fleet at timestamp
    const enrichedObjects = await enrichWithVehicleContext(
      detectedObjects,
      user_id,
      timestamp,
      supabase
    );

    // 3. Create auto-tags in database
    const createdTags = [];
    for (const obj of enrichedObjects) {
      const tagData = {
        image_id,
        vehicle_id: vehicle_id || null,
        tag_text: obj.description,
        tag_type: obj.object_class,
        x_position: obj.bounding_box.x,
        y_position: obj.bounding_box.y,
        width: obj.bounding_box.width,
        height: obj.bounding_box.height,
        confidence_score: obj.confidence,
        auto_generated: true,
        verified: false,
        linked_vehicle_id: obj.linked_vehicle_id || null,
        object_class: obj.object_class,
        detection_metadata: {
          model: 'gpt-4o',
          attributes: obj.attributes,
          temporal_match: obj.temporal_match || false,
          attribute_matches: obj.attribute_matches || 0
        }
      };

      const { data, error } = await supabase
        .from('vehicle_image_tags')
        .insert(tagData)
        .select()
        .single();

      if (!error && data) {
        createdTags.push(data);
      } else if (error) {
        console.error('Error creating tag:', error);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        detected_objects: detectedObjects.length,
        created_tags: createdTags.length,
        tags: createdTags
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (error) {
    console.error('Error in auto-tag-objects:', error);
    return new Response(
      JSON.stringify({
        error: error.message,
        success: false
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      }
    );
  }
});

async function detectObjectsWithVision(imageUrl: string): Promise<DetectedObject[]> {
  const openAiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openAiKey) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  const prompt = `Analyze this image and detect ALL visible objects with bounding boxes.

Focus on:
- VEHICLES (cars, trucks, SUVs, trailers - describe year, make, model, color)
- CLOTHING/APPAREL (shirts, hats, jackets - describe brand logos, text)
- LOGOS/BRANDS (visible brand names, store names, company logos)
- PEOPLE (describe generally, no identifying features)
- EQUIPMENT/TOOLS (trailers, hauling equipment, branded tools)

For EACH object, provide:
{
  "object_class": "vehicle" | "clothing" | "logo" | "person" | "equipment" | "trailer",
  "description": "detailed description (e.g., 'white 1990s Chevrolet Suburban', 'red Snap-on hat', 'U-Haul trailer')",
  "confidence": 0-100,
  "bounding_box": { "x": 0-100, "y": 0-100, "width": 0-100, "height": 0-100 },
  "attributes": {
    // For vehicles: { "color": "white", "make": "Chevrolet", "model": "Suburban", "year_range": "1990-1999" }
    // For clothing: { "brand": "Snap-on", "item": "hat", "color": "red" }
    // For logos/brands: { "brand": "U-Haul", "type": "rental_company" }
  }
}

Return JSON array of detected objects. Be thorough - detect EVERYTHING visible.`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openAiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are an expert at object detection and vehicle identification. Provide precise bounding boxes and detailed descriptions.'
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } }
          ]
        }
      ],
      max_tokens: 2000,
      response_format: { type: 'json_object' }
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.statusText}`);
  }

  const data = await response.json();
  const content = JSON.parse(data.choices[0].message.content);
  
  return content.objects || content.detected_objects || [];
}

async function enrichWithVehicleContext(
  objects: DetectedObject[],
  userId: string,
  timestamp: string,
  supabase: any
): Promise<any[]> {
  if (!userId || !timestamp) {
    return objects.map(obj => ({ ...obj, temporal_match: false }));
  }

  // Query vehicles owned at timestamp
  const { data: ownedVehicles, error } = await supabase
    .rpc('get_vehicles_at_timestamp', {
      p_user_id: userId,
      p_timestamp: timestamp
    });

  if (error || !ownedVehicles) {
    console.warn('Could not fetch owned vehicles:', error);
    return objects.map(obj => ({ ...obj, temporal_match: false }));
  }

  console.log(`User owned ${ownedVehicles.length} vehicles at ${timestamp}`);

  // Enrich vehicle objects with ownership matches
  return objects.map(obj => {
    if (obj.object_class === 'vehicle' && obj.attributes) {
      const matches = matchVehicleAttributes(obj.attributes, ownedVehicles);
      
      if (matches.bestMatch) {
        const match = matches.bestMatch;
        const attributeMatches = matches.matchCount;
        const attributeTotal = matches.totalAttributes;
        
        // Calculate confidence boost
        const temporalMatch = true;
        const aiConfidence = obj.confidence;
        
        // Use our database function logic
        let boostedConfidence = aiConfidence;
        if (temporalMatch) {
          boostedConfidence *= 1.2; // 20% boost
        }
        if (attributeTotal > 0) {
          boostedConfidence *= (1.0 + (attributeMatches / attributeTotal) * 0.3);
        }
        boostedConfidence = Math.min(boostedConfidence, 99.99); // Cap at 99.99

        return {
          ...obj,
          linked_vehicle_id: match.vehicle_id,
          temporal_match: true,
          attribute_matches: attributeMatches,
          attribute_total: attributeTotal,
          confidence: Math.round(boostedConfidence * 100) / 100,
          description: `${obj.description} (${match.year} ${match.make} ${match.model})`
        };
      }
    }

    return { ...obj, temporal_match: false };
  });
}

function matchVehicleAttributes(detectedAttrs: any, ownedVehicles: any[]): any {
  let bestMatch = null;
  let bestScore = 0;
  let bestMatchCount = 0;

  for (const vehicle of ownedVehicles) {
    let score = 0;
    let matchCount = 0;
    const totalAttributes = 3; // color, make, model

    // Color match
    if (detectedAttrs.color && vehicle.color) {
      if (detectedAttrs.color.toLowerCase() === vehicle.color.toLowerCase()) {
        score += 2;
        matchCount++;
      }
    }

    // Make match
    if (detectedAttrs.make && vehicle.make) {
      if (detectedAttrs.make.toLowerCase().includes(vehicle.make.toLowerCase()) ||
          vehicle.make.toLowerCase().includes(detectedAttrs.make.toLowerCase())) {
        score += 3;
        matchCount++;
      }
    }

    // Model match
    if (detectedAttrs.model && vehicle.model) {
      if (detectedAttrs.model.toLowerCase().includes(vehicle.model.toLowerCase()) ||
          vehicle.model.toLowerCase().includes(detectedAttrs.model.toLowerCase())) {
        score += 3;
        matchCount++;
      }
    }

    // Year range match (fuzzy)
    if (detectedAttrs.year_range && vehicle.year) {
      const yearRange = detectedAttrs.year_range.split('-').map((y: string) => parseInt(y));
      if (yearRange.length === 2 && vehicle.year >= yearRange[0] && vehicle.year <= yearRange[1]) {
        score += 1;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = vehicle;
      bestMatchCount = matchCount;
    }
  }

  return {
    bestMatch,
    matchCount: bestMatchCount,
    totalAttributes: 3
  };
}

