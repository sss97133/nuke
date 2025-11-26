/**
 * Test Gemini API Connection
 * Simple test to verify Gemini API works from edge functions
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

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
          error: 'GEMINI_API_KEY not found in edge function environment variables',
          message: 'Please set GEMINI_API_KEY in Supabase Dashboard > Edge Functions > Secrets'
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log('🧪 Testing Gemini API...');
    console.log(`API Key: ${GEMINI_API_KEY.substring(0, 10)}...${GEMINI_API_KEY.substring(GEMINI_API_KEY.length - 4)}`);

    // List available models first to find what actually works
    console.log('📡 Listing available Gemini models...');
    const listResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`
    );
    
    let modelName = 'gemini-1.5-flash';
    let allModels: string[] = [];
    
    if (listResponse.ok) {
      try {
        const modelsData = await listResponse.json();
        const models = modelsData?.models || [];
        
        if (models.length > 0) {
          // Log all available models for debugging
          allModels = models.map((m: any) => m.name?.replace('models/', '') || '').filter(Boolean);
          console.log(`Found ${allModels.length} available models`);
          console.log(`Sample models: ${allModels.slice(0, 10).join(', ')}`);
          
          // Find a flash model (better free tier) that supports generateContent
          const flashModel = models.find((m: any) => 
            m.supportedGenerationMethods?.includes('generateContent') &&
            m.name && (m.name.includes('flash') || m.name.includes('1.5-flash'))
          );
          
          if (flashModel) {
            modelName = flashModel.name.replace('models/', '');
            console.log(`✅ Found Flash model: ${modelName}`);
          } else {
            // Try to find gemini-pro or gemini-1.5-pro
            const proModel = models.find((m: any) => 
              m.supportedGenerationMethods?.includes('generateContent') &&
              m.name && (m.name.includes('gemini-pro') || m.name.includes('gemini-1.5-pro'))
            );
            
            if (proModel) {
              modelName = proModel.name.replace('models/', '');
              console.log(`✅ Found Pro model: ${modelName}`);
            } else {
              // Use first available model that supports generateContent (not VEO)
              const anyModel = models.find((m: any) => 
                m.supportedGenerationMethods?.includes('generateContent') &&
                m.name && !m.name.includes('veo') && !m.name.includes('exp')
              );
              if (anyModel) {
                modelName = anyModel.name.replace('models/', '');
                console.log(`⚠️  Using available model: ${modelName}`);
              }
            }
          }
        }
      } catch (e: any) {
        console.log(`⚠️  Error parsing models: ${e.message}`);
      }
    } else {
      const errorText = await listResponse.text();
      console.log(`⚠️  Could not list models: ${listResponse.status} - ${errorText}`);
    }
    
    console.log(`📡 Making test API call with model: ${modelName}...`);
    
    let response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: 'Say "Hello, Gemini API is working!" in exactly 5 words.'
            }]
          }],
          generationConfig: {
            maxOutputTokens: 50,
            temperature: 0.1
          }
        })
      }
    );

    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ API Error: HTTP ${response.status}`);
      console.error(`Response: ${errorText}`);
      
      return new Response(
        JSON.stringify({
          success: false,
          error: `Gemini API error: HTTP ${response.status}`,
          details: errorText,
          status: response.status,
          modelTried: modelName,
          availableModels: allModels.slice(0, 20) // Include first 20 for debugging
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    const data = await response.json();
    
    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Unexpected response format',
          response: data
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    const answer = data.candidates[0].content.parts[0].text;
    
    console.log('✅ SUCCESS! Gemini API is working!');
    console.log(`Response: "${answer.trim()}"`);

    // Test 2: Vision API (optional - with sample image)
    let visionTest = null;
    try {
      console.log('🖼️  Testing Gemini Vision API...');
      
      const testImageUrl = 'https://via.placeholder.com/300x200.png';
      const imageResponse = await fetch(testImageUrl);
      const imageBuffer = await imageResponse.arrayBuffer();
      const base64Image = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)));
      
      const visionResponse = await fetch(
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
                  text: 'What do you see in this image? Describe it in one sentence.'
                },
                {
                  inlineData: {
                    mimeType: 'image/png',
                    data: base64Image
                  }
                }
              ]
            }],
            generationConfig: {
              maxOutputTokens: 100,
              temperature: 0.3
            }
          })
        }
      );

      if (visionResponse.ok) {
        const visionData = await visionResponse.json();
        const visionAnswer = visionData.candidates[0].content.parts[0].text;
        visionTest = {
          success: true,
          response: visionAnswer.trim()
        };
        console.log(`✅ Vision API Response: "${visionAnswer.trim()}"`);
      } else {
        visionTest = {
          success: false,
          error: `HTTP ${visionResponse.status}`
        };
      }
    } catch (visionError: any) {
      visionTest = {
        success: false,
        error: visionError.message
      };
      console.log(`⚠️  Vision test failed: ${visionError.message}`);
    }

    const result = {
      success: true,
      text: {
        success: true,
        response: answer.trim(),
        finishReason: data.candidates[0].finishReason,
        usageMetadata: data.usageMetadata
      },
      vision: visionTest,
      metadata: {
        model: modelName,
        apiKeyConfigured: true,
        apiKeyPreview: `${GEMINI_API_KEY.substring(0, 10)}...${GEMINI_API_KEY.substring(GEMINI_API_KEY.length - 4)}`
      }
    };

    console.log('✅ All tests complete!');

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

