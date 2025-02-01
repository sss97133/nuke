import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import "https://deno.land/x/xhr@0.1.0/mod.ts";

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

  const apiKey = Deno.env.get('PERPLEXITY_API_KEY');
  if (!apiKey) {
    console.error('PERPLEXITY_API_KEY is not set');
    return new Response(
      JSON.stringify({ error: 'API key configuration error' }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }

  try {
    const { vehicleData } = await req.json() as { vehicleData: VehicleData };
    console.log('Analyzing vehicle data:', JSON.stringify(vehicleData, null, 2));

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

    console.log('Sending request to Perplexity API');
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
      console.error('Perplexity API error:', response.status, response.statusText);
      const errorText = await response.text();
      console.error('Error details:', errorText);
      throw new Error(`Perplexity API error: ${response.statusText}`);
    }

    const data = await response.json();
    console.log('Received analysis from Perplexity:', JSON.stringify(data, null, 2));

    let analysis;
    try {
      const content = data.choices[0].message.content;
      analysis = JSON.parse(content);
      console.log('Parsed analysis:', JSON.stringify(analysis, null, 2));
    } catch (error) {
      console.error('Error parsing AI response:', error);
      console.error('Raw content:', data.choices[0]?.message?.content);
      throw new Error('Failed to parse vehicle analysis');
    }

    return new Response(
      JSON.stringify(analysis),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error analyzing vehicle data:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to analyze vehicle data',
        details: error.message 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});