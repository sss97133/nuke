/**
 * Extract Data from Single Image using Gemini
 * Analyzes an image URL and extracts structured data
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { encode as base64Encode } from 'https://deno.land/std@0.168.0/encoding/base64.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');

    if (!GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'GEMINI_API_KEY not found in edge function environment variables'
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Parse request body
    const { image_url, prompt } = await req.json();

    if (!image_url) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'image_url is required'
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log(`📸 Extracting data from image: ${image_url}`);

    // Use cheapest model: gemini-1.5-flash or gemini-2.5-flash (free tier)
    // Pricing: $0.00/1M input tokens, $0.00/1M output tokens (FREE)
    // These are the cheapest models available
    const listResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`
    );
    
    // Use cheapest model: gemini-1.5-flash or gemini-2.5-flash (free tier)
    let modelName = 'gemini-1.5-flash'; // Cheapest/free model
    
    const modelInfo = {
      name: modelName,
      inputCostPer1M: 0,      // FREE
      outputCostPer1M: 0,     // FREE
      tier: 'free'
    };
    
    if (listResponse.ok) {
      try {
        const modelsData = await listResponse.json();
        const models = modelsData?.models || [];
        
        if (models.length > 0) {
          // Find cheapest flash model (free tier)
          // Priority: gemini-1.5-flash > gemini-2.5-flash > other flash
          const flashModels = models.filter((m: any) => 
            m.supportedGenerationMethods?.includes('generateContent') &&
            m.name && m.name.includes('flash')
          ).sort((a: any, b: any) => {
            // Prefer 1.5-flash over 2.5-flash (both free, but 1.5 is more stable)
            const aIs15 = a.name.includes('1.5-flash');
            const bIs15 = b.name.includes('1.5-flash');
            if (aIs15 && !bIs15) return -1;
            if (!aIs15 && bIs15) return 1;
            return a.name.localeCompare(b.name);
          });
          
          if (flashModels.length > 0) {
            modelName = flashModels[0].name.replace('models/', '');
            modelInfo.name = modelName;
            console.log(`✅ Using cheapest model: ${modelName} (FREE tier)`);
          }
        }
      } catch (e: any) {
        console.log(`⚠️  Could not parse models list: ${e.message}, using default`);
      }
    }

    console.log(`🤖 Using model: ${modelName}`);

    // Download image and convert to base64
    const imageResponse = await fetch(image_url);
    if (!imageResponse.ok) {
      throw new Error(`Failed to fetch image: HTTP ${imageResponse.status}`);
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    const imageBytes = new Uint8Array(imageBuffer);
    
    // Detect MIME type from response headers or URL
    const contentType = imageResponse.headers.get('content-type') || 
                       (image_url.match(/\.(jpg|jpeg)$/i) ? 'image/jpeg' :
                        image_url.match(/\.png$/i) ? 'image/png' :
                        image_url.match(/\.webp$/i) ? 'image/webp' :
                        'image/jpeg'); // default
    
    // Convert to base64 using Deno's built-in encoder (handles large arrays efficiently)
    const base64Image = base64Encode(imageBytes);

    // Optimized context-aware prompt for vehicle images
    // Focuses on: angle (MUST), environment, context, care assessment, seller psychology
    // Designed to maximize value per token while extracting actionable insights
    const extractionPrompt = prompt || `Extract vehicle image metadata. Return compact JSON:
{
  "angle":"exterior_front|exterior_rear|exterior_side|exterior_three_quarter|interior_front_seats|interior_rear_seats|interior_dashboard|interior_door|engine_bay|undercarriage|detail_shot|document|other",
  "environment":"garage|driveway|street|dealership|shop|outdoor_natural|staged_studio|other",
  "context":{
    "background_objects":["item1"],
    "surrounding_area":"brief description",
    "time_of_day":"day|night|dusk|dawn|indoor",
    "weather_visible":true/false,
    "other_vehicles_visible":true/false
  },
  "presentation":{
    "is_positioned":true/false,
    "is_natural":true/false,
    "staging_indicators":["indicator1"],
    "photo_quality":"professional|amateur|cellphone|other"
  },
  "care_assessment":{
    "owner_cares":true/false,
    "evidence":["evidence1"],
    "condition_indicators":["clean","dirty","well_maintained","neglected"],
    "care_level":"high|medium|low|unknown"
  },
  "seller_psychology":{
    "is_staged":true/false,
    "intent":"selling|showcase|documentation|casual",
    "confidence_indicators":["indicator1"],
    "transparency_level":"high|medium|low"
  }
}
Minimize tokens, use compact JSON.`;

    // Call Gemini API
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                text: extractionPrompt
              },
              {
                inlineData: {
                  mimeType: contentType,
                  data: base64Image
                }
              }
            ]
          }],
          generationConfig: {
            maxOutputTokens: 2000,  // Maximum to extract all data
            temperature: 0.1,       // Lower = more consistent, cheaper (less randomness)
            topP: 0.95,            // Focus on most likely tokens
            topK: 40               // Limit token choices (cheaper)
          }
        })
      }
    );

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error(`❌ Gemini API Error: HTTP ${geminiResponse.status}`);
      console.error(`Response: ${errorText}`);
      
      return new Response(
        JSON.stringify({
          success: false,
          error: `Gemini API error: HTTP ${geminiResponse.status}`,
          details: errorText
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    const geminiData = await geminiResponse.json();
    
    if (!geminiData.candidates || !geminiData.candidates[0] || !geminiData.candidates[0].content) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Unexpected response format from Gemini API',
          response: geminiData
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    const extractedText = geminiData.candidates[0].content.parts[0].text;
    
    // Try to parse JSON from response
    let extractedData: any;
    try {
      // Remove markdown code blocks if present
      const cleanedText = extractedText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      extractedData = JSON.parse(cleanedText);
    } catch (parseError) {
      // If not JSON, return as text
      extractedData = {
        raw_response: extractedText,
        note: 'Response was not valid JSON, returning as text'
      };
    }

    const usage = geminiData.usageMetadata || {};
    const inputTokens = usage.promptTokenCount || 0;
    const outputTokens = usage.candidatesTokenCount || 0;
    const totalTokens = usage.totalTokenCount || (inputTokens + outputTokens);
    
    // Calculate costs (FREE for flash models)
    const inputCost = (inputTokens / 1_000_000) * modelInfo.inputCostPer1M;
    const outputCost = (outputTokens / 1_000_000) * modelInfo.outputCostPer1M;
    const totalCost = inputCost + outputCost;
    
    // Calculate images per token budget
    const tokensPerImage = totalTokens;
    const freeTierLimit = 1_500; // Free tier: 1,500 requests/day
    const imagesPerDay = Math.floor(freeTierLimit / tokensPerImage);
    
    const result = {
      success: true,
      extracted_data: extractedData,
      metadata: {
        model: modelName,
        model_tier: modelInfo.tier,
        image_url: image_url,
        tokens: {
          input: inputTokens,
          output: outputTokens,
          total: totalTokens
        },
        cost: {
          input_cost: inputCost,
          output_cost: outputCost,
          total_cost: totalCost,
          currency: 'USD'
        },
        efficiency: {
          tokens_per_image: tokensPerImage,
          images_per_1k_tokens: Math.floor(1000 / tokensPerImage),
          images_per_1m_tokens: Math.floor(1_000_000 / tokensPerImage),
          estimated_images_per_day_free_tier: imagesPerDay
        },
        finish_reason: geminiData.candidates[0].finishReason
      }
    };

    console.log('✅ Extraction complete!');

    return new Response(
      JSON.stringify(result, null, 2),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error: any) {
    console.error('❌ Error:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        stack: error.stack
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

