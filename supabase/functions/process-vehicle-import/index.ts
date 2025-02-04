import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import "https://deno.land/x/xhr@0.1.0/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🔄 Processing vehicle import request...');
    
    const { data, fileType } = await req.json();
    const apiKey = Deno.env.get('PERPLEXITY_API_KEY');

    if (!apiKey) {
      console.error('❌ PERPLEXITY_API_KEY is not configured');
      throw new Error('PERPLEXITY_API_KEY is not configured');
    }

    console.log(`📄 Processing ${fileType} data...`);
    console.log('📊 Raw data sample:', JSON.stringify(data).substring(0, 200) + '...');

    // Normalize the data using Perplexity AI
    const prompt = `Analyze and normalize this vehicle data to match this structure:
    {
      make: string (required),
      model: string (required),
      year: number (required),
      vin?: string (optional),
      notes?: string (optional)
    }
    
    Raw data: ${JSON.stringify(data)}
    File type: ${fileType}
    
    Return ONLY a JSON array of normalized vehicles. Each vehicle must have at least make, model, and year.
    Do not include any explanatory text, just the JSON array.`;

    console.log('🤖 Sending request to Perplexity API...');
    
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.1-sonar-small-128k-online',
        messages: [
          {
            role: 'system',
            content: 'You are a data normalization expert. Return only valid JSON arrays of vehicle data.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.2,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      console.error('❌ Perplexity API error:', response.status, response.statusText);
      const errorText = await response.text();
      console.error('Error details:', errorText);
      throw new Error(`Perplexity API error: ${response.statusText}`);
    }

    const aiResponse = await response.json();
    console.log('✅ Received response from Perplexity API');

    let normalizedData;
    try {
      const content = aiResponse.choices[0].message.content;
      // Clean the content string to ensure it only contains the JSON array
      const jsonStr = content.trim().replace(/```json\n?|\n?```/g, '').trim();
      console.log('🔍 Cleaned JSON string:', jsonStr);
      normalizedData = JSON.parse(jsonStr);
      
      // Validate the normalized data
      if (!Array.isArray(normalizedData)) {
        throw new Error('Response is not an array');
      }
      
      normalizedData.forEach((vehicle, index) => {
        if (!vehicle.make || !vehicle.model || !vehicle.year) {
          throw new Error(`Vehicle at index ${index} is missing required fields`);
        }
        if (typeof vehicle.year !== 'number') {
          throw new Error(`Vehicle at index ${index} has invalid year type`);
        }
      });
      
      console.log('✅ Successfully normalized vehicle data');
      console.log('📊 Sample of normalized data:', JSON.stringify(normalizedData[0]));
      
    } catch (error) {
      console.error('❌ Error parsing AI response:', error);
      console.error('Raw content:', aiResponse.choices[0]?.message?.content);
      throw new Error('Failed to parse normalized vehicle data');
    }

    return new Response(
      JSON.stringify({ vehicles: normalizedData }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Error processing vehicle import:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to normalize vehicle data',
        details: error.message 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});