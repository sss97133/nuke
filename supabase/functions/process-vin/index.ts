import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { HfInference } from 'https://esm.sh/@huggingface/inference@2.3.2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const hf = new HfInference(Deno.env.get('HUGGING_FACE_ACCESS_TOKEN'));

    const formData = await req.formData();
    const image = formData.get('image');

    if (!image) {
      throw new Error('No image provided');
    }

    // Use OCR model to extract text from image
    const result = await hf.textGeneration({
      model: 'gpt-4o-mini',
      inputs: [
        {
          role: 'system',
          content: 'You are a VIN decoder. Extract the VIN from the image and verify its validity. Return only the VIN number if valid, or null if invalid.'
        },
        {
          role: 'user',
          content: [
            {
              type: 'image',
              data: await image.arrayBuffer()
            }
          ]
        }
      ]
    });

    // Verify VIN using NHTSA database
    const vinData = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${result.generated_text}?format=json`);
    const vinInfo = await vinData.json();

    return new Response(
      JSON.stringify({ 
        vin: result.generated_text,
        data: vinInfo.Results 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error processing VIN:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});