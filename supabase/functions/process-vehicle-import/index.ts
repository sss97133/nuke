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
    const { data, fileType } = await req.json();
    const apiKey = Deno.env.get('PERPLEXITY_API_KEY');

    if (!apiKey) {
      throw new Error('PERPLEXITY_API_KEY is not configured');
    }

    // Normalize the data using Perplexity AI
    const prompt = `Analyze and normalize this vehicle data to match this structure:
    {
      make: string,
      model: string,
      year: number,
      vin?: string,
      notes?: string
    }
    
    Raw data: ${JSON.stringify(data)}
    File type: ${fileType}
    
    Return ONLY a JSON array of normalized vehicles. Each vehicle must have at least make, model, and year.`;

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

    const aiResponse = await response.json();
    console.log('AI Response:', aiResponse);

    let normalizedData;
    try {
      const content = aiResponse.choices[0].message.content;
      normalizedData = JSON.parse(content.trim());
    } catch (error) {
      console.error('Error parsing AI response:', error);
      throw new Error('Failed to normalize vehicle data');
    }

    return new Response(
      JSON.stringify({ vehicles: normalizedData }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error processing import:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});