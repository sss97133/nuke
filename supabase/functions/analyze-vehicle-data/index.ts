import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface VehicleData {
  make: string;
  model: string;
  year: number;
  historical_data?: {
    previousSales?: Array<{ date?: string; price?: string; source?: string; }>;
    modifications?: string[];
    notableHistory?: string;
    conditionNotes?: string;
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { vehicleData } = await req.json() as { vehicleData: VehicleData };
    
    console.log('Analyzing vehicle data:', vehicleData);

    const prompt = `As a classic car expert, analyze this vehicle:
    ${vehicleData.year} ${vehicleData.make} ${vehicleData.model}
    
    Historical Data:
    ${JSON.stringify(vehicleData.historical_data, null, 2)}
    
    Provide a detailed market analysis including:
    1. What makes this vehicle special or unique
    2. Current market position and value trends
    3. Comparable sales analysis
    4. Investment potential
    5. Key factors affecting value
    
    Format the response as JSON with these fields:
    {
      "marketAnalysis": string (overall market position),
      "uniqueFeatures": string[] (list of special attributes),
      "valueFactors": string[] (key elements affecting price),
      "investmentOutlook": string (future value prediction),
      "priceAnalysis": {
        "estimatedValue": number,
        "confidence": number,
        "trendDirection": "up" | "down" | "stable",
        "comparableSales": Array<{price: number, date: string, notes: string}>
      }
    }`;

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('PERPLEXITY_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.1-sonar-small-128k-online',
        messages: [
          {
            role: 'system',
            content: 'You are an expert classic car appraiser with deep knowledge of market trends and vehicle valuations.'
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
      throw new Error(`Perplexity API error: ${response.statusText}`);
    }

    const data = await response.json();
    console.log('Received analysis from Perplexity:', data);

    let analysis;
    try {
      const content = data.choices[0].message.content;
      analysis = JSON.parse(content);
    } catch (error) {
      console.error('Error parsing AI response:', error);
      throw new Error('Failed to parse vehicle analysis');
    }

    return new Response(
      JSON.stringify(analysis),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error analyzing vehicle data:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to analyze vehicle data' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});