import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('🚀 Comprehensive BAT extraction called');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { listing_url } = await req.json() || {};

    if (!listing_url) {
      throw new Error('listing_url is required');
    }

    console.log(`🔍 Processing: ${listing_url}`);

    // Step 1: Firecrawl extraction
    const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY');
    if (!firecrawlApiKey) {
      throw new Error('FIRECRAWL_API_KEY not found in environment');
    }

    const firecrawlResponse = await fetch('https://api.firecrawl.dev/v0/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${firecrawlApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: listing_url,
        formats: ['markdown', 'html'],
        onlyMainContent: true,
        includeTags: ['img', 'a', 'p', 'h1', 'h2', 'h3', 'div', 'span', 'li'],
        excludeTags: ['nav', 'footer', 'header', 'aside', 'script', 'style'],
        waitFor: 3000
      })
    });

    if (!firecrawlResponse.ok) {
      throw new Error(`Firecrawl API ${firecrawlResponse.status}: ${firecrawlResponse.statusText}`);
    }

    const firecrawlData = await firecrawlResponse.json();

    if (!firecrawlData.success) {
      throw new Error(`Firecrawl extraction failed: ${firecrawlData.error || 'Unknown error'}`);
    }

    console.log('✅ Firecrawl extraction completed');

    // Step 2: AI extraction with Claude
    const claudeApiKey = Deno.env.get('ANTHROPIC_API_KEY') || Deno.env.get('CLAUDE_API_KEY');
    if (!claudeApiKey) {
      throw new Error('ANTHROPIC_API_KEY or CLAUDE_API_KEY not found in environment');
    }

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${claudeApiKey}`,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: `Extract vehicle information from this content:

URL: ${listing_url}
Content: ${firecrawlData.data.markdown || firecrawlData.data.html || ''}

Extract:
- Year (number)
- Make (string)
- Model (string)
- Trim (string, if available)
- Engine (string, if available)
- Mileage (number, if available)
- Price/asking_price (number, if available)
- Description (string summary)

Return ONLY valid JSON:
{
  "year": number,
  "make": "string",
  "model": "string",
  "trim": "string",
  "engine": "string",
  "mileage": number,
  "asking_price": number,
  "description": "string"
}`
        }]
      })
    });

    if (!claudeResponse.ok) {
      throw new Error(`Claude API ${claudeResponse.status}: ${claudeResponse.statusText}`);
    }

    const claudeData = await claudeResponse.json();
    const responseText = claudeData.content?.[0]?.text;

    if (!responseText) {
      throw new Error('No response from Claude API');
    }

    let vehicleData;
    try {
      vehicleData = JSON.parse(responseText);
    } catch (parseError) {
      console.error('❌ Failed to parse Claude response:', responseText);
      throw new Error('Failed to parse AI response');
    }

    console.log('✅ AI extraction completed');

    // Step 3: Save vehicle to database
    const vehicleRecord = {
      year: vehicleData.year || null,
      make: vehicleData.make || null,
      model: vehicleData.model || null,
      trim: vehicleData.trim || null,
      engine: vehicleData.engine || null,
      mileage: vehicleData.mileage || null,
      asking_price: vehicleData.asking_price || null,
      description: vehicleData.description || null,
      discovery_url: listing_url,
      source: 'comprehensive_bat_extraction_working',
      created_at: new Date().toISOString()
    };

    const { data: newVehicle, error: dbError } = await supabase
      .from('vehicles')
      .insert(vehicleRecord)
      .select('id')
      .single();

    if (dbError) {
      throw new Error(`Database error: ${dbError.message}`);
    }

    console.log(`💾 Vehicle saved: ID ${newVehicle.id}`);

    return new Response(JSON.stringify({
      success: true,
      vehicleId: newVehicle.id,
      data: vehicleData
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('❌ Comprehensive extraction error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});