import { serve } from 'https://deno.fresh.run/std@v9.6.1/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  vin?: string;
  make?: string;
  model?: string;
  year?: number;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { vin, make, model, year } = await req.json() as RequestBody;
    
    if (!make || !model || !year) {
      return new Response(
        JSON.stringify({ error: 'Missing required vehicle information' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Construct search query
    const searchQuery = `${year} ${make} ${model} ${vin || ''} history listing sale auction`;
    console.log('Searching for vehicle history with query:', searchQuery);

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
            content: 'You are a vehicle history expert. Extract and summarize historical information about vehicles from auction listings and sales data. Focus on previous sales, condition reports, modifications, and notable history. Return data in a structured format.'
          },
          {
            role: 'user',
            content: `Find historical information about this vehicle: ${searchQuery}. Format the response as JSON with these fields: previousSales (array of objects with date, price, source), modifications (array of strings), notableHistory (string), and conditionNotes (string).`
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
    console.log('Received response from Perplexity:', data);

    // Extract the historical data from the AI response
    let historicalData;
    try {
      const content = data.choices[0].message.content;
      historicalData = JSON.parse(content);
    } catch (error) {
      console.error('Error parsing AI response:', error);
      historicalData = {
        error: 'Could not parse vehicle history data',
        rawResponse: data.choices[0].message.content
      };
    }

    // Update the vehicle record in the database
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { error: updateError } = await supabaseClient
      .from('vehicles')
      .update({ historical_data: historicalData })
      .eq('vin', vin)
      .eq('make', make)
      .eq('model', model)
      .eq('year', year);

    if (updateError) {
      console.error('Error updating vehicle history:', updateError);
    }

    return new Response(
      JSON.stringify(historicalData),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error processing request:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to process vehicle history search' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});