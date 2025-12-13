import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FilterRequest {
  vehicle_id: string;
  image_urls: string[];
  year?: number;
  make?: string;
  model?: string;
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

    const body: FilterRequest = await req.json();
    const { vehicle_id, image_urls, year, make, model } = body;

    if (!vehicle_id || !image_urls || image_urls.length === 0) {
      return new Response(
        JSON.stringify({ error: 'vehicle_id and image_urls required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get vehicle details if not provided
    let vehicleYear = year;
    let vehicleMake = make;
    let vehicleModel = model;

    if (!vehicleYear || !vehicleMake || !vehicleModel) {
      const { data: vehicle, error: vehicleError } = await supabase
        .from('vehicles')
        .select('year, make, model')
        .eq('id', vehicle_id)
        .single();

      if (vehicleError || !vehicle) {
        return new Response(
          JSON.stringify({ error: 'Vehicle not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      vehicleYear = vehicle.year;
      vehicleMake = vehicle.make;
      vehicleModel = vehicle.model;
    }

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      // If no API key, return all images (no filtering)
      return new Response(
        JSON.stringify({
          success: true,
          vehicle_id,
          filtered_images: image_urls,
          matched: image_urls.length,
          rejected: 0,
          message: 'No OpenAI API key - returning all images'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`🔍 Filtering ${image_urls.length} images for ${vehicleYear} ${vehicleMake} ${vehicleModel}...`);

    const matchedImages: string[] = [];
    const rejectedImages: string[] = [];
    const errors: string[] = [];

    // Process images in batches of 5 (OpenAI Vision rate limits)
    const batchSize = 5;
    for (let i = 0; i < image_urls.length; i += batchSize) {
      const batch = image_urls.slice(i, i + batchSize);
      
      for (const imageUrl of batch) {
        try {
          // Use OpenAI Vision to check if image matches the vehicle
          const visionResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${OPENAI_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: 'gpt-4o',
              messages: [
                {
                  role: 'system',
                  content: `You are an expert at identifying vehicles in images. Analyze the image and determine if it shows a ${vehicleYear} ${vehicleMake} ${vehicleModel}. Return ONLY a JSON object with: {"matches": true/false, "confidence": 0.0-1.0, "reason": "brief explanation"}.`
                },
                {
                  role: 'user',
                  content: [
                    {
                      type: 'text',
                      text: `Does this image show a ${vehicleYear} ${vehicleMake} ${vehicleModel}? Look for:
- Year: ${vehicleYear}
- Make: ${vehicleMake}
- Model: ${vehicleModel}

Return JSON: {"matches": true/false, "confidence": 0.0-1.0, "reason": "brief explanation"}.`
                    },
                    {
                      type: 'image_url',
                      image_url: { url: imageUrl }
                    }
                  ]
                }
              ],
              max_tokens: 150,
              temperature: 0.1
            })
          });

          if (!visionResponse.ok) {
            const errorText = await visionResponse.text();
            console.error(`Vision API error for ${imageUrl}: ${errorText}`);
            errors.push(`Vision API error: ${errorText.substring(0, 100)}`);
            // If API fails, include the image (better to have extra than miss valid ones)
            matchedImages.push(imageUrl);
            continue;
          }

          const visionData = await visionResponse.json();
          const content = visionData.choices?.[0]?.message?.content || '{}';
          
          let analysis;
          try {
            analysis = JSON.parse(content);
          } catch (parseError) {
            // If JSON parse fails, try to extract from text
            const matches = content.match(/matches["\s:]+(true|false)/i);
            const confidence = content.match(/confidence["\s:]+([\d.]+)/i);
            analysis = {
              matches: matches ? matches[1].toLowerCase() === 'true' : true,
              confidence: confidence ? parseFloat(confidence[1]) : 0.5,
              reason: content.substring(0, 100)
            };
          }

          if (analysis.matches && (analysis.confidence || 0) >= 0.6) {
            matchedImages.push(imageUrl);
            console.log(`✅ Image matches: ${imageUrl.substring(0, 60)}... (confidence: ${analysis.confidence})`);
          } else {
            rejectedImages.push(imageUrl);
            console.log(`❌ Image rejected: ${imageUrl.substring(0, 60)}... (confidence: ${analysis.confidence || 0}, reason: ${analysis.reason || 'unknown'})`);
          }

          // Rate limiting
          await new Promise(r => setTimeout(r, 200));

        } catch (error: any) {
          console.error(`Error processing image ${imageUrl}: ${error.message}`);
          errors.push(`Error: ${error.message}`);
          // On error, include the image (better to have extra than miss valid ones)
          matchedImages.push(imageUrl);
        }
      }

      // Delay between batches
      if (i + batchSize < image_urls.length) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    console.log(`✅ Filtered: ${matchedImages.length} matched, ${rejectedImages.length} rejected`);

    return new Response(
      JSON.stringify({
        success: true,
        vehicle_id,
        filtered_images: matchedImages,
        rejected_images: rejectedImages,
        matched: matchedImages.length,
        rejected: rejectedImages.length,
        errors: errors.slice(0, 10)
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Filter error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});















