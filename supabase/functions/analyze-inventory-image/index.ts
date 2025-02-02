import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { pipeline } from "@huggingface/transformers";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const formData = await req.formData()
    const imageFile = formData.get('image')

    if (!imageFile) {
      throw new Error('No image provided')
    }

    // Create image classification pipeline using WebGPU
    const classifier = await pipeline(
      "image-classification",
      "onnx-community/mobilenetv4_conv_small.e2400_r224_in1k",
      { device: "webgpu" }
    );

    // Convert FormData file to URL for the classifier
    const imageUrl = URL.createObjectURL(imageFile);
    
    // Analyze image
    const results = await classifier(imageUrl);
    
    console.log('AI Classification results:', results);

    return new Response(
      JSON.stringify({
        success: true,
        classifications: results
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )
  } catch (error) {
    console.error('Error analyzing image:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    )
  }
})