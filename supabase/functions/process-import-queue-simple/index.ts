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
    console.log('🚀 Simple process-import-queue called');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { batch_size = 3, priority_only = true } = await req.json() || {};

    console.log(`📦 Processing batch of ${batch_size} items (priority_only: ${priority_only})`);

    // Get queue items
    let query = supabase
      .from('import_queue')
      .select('*')
      .order('priority', { ascending: false })
      .limit(batch_size);

    if (priority_only) {
      query = query.gte('priority', 10);
    }

    const { data: queueItems, error: queueError } = await query;

    if (queueError) {
      throw new Error(`Queue fetch error: ${queueError.message}`);
    }

    if (!queueItems || queueItems.length === 0) {
      console.log('📭 No queue items to process');
      return new Response(JSON.stringify({
        success: true,
        processed: 0,
        message: 'No items in queue'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`📋 Found ${queueItems.length} items to process`);

    // Do Firecrawl + AI extraction directly in this function
    const processedItems = [];

    for (const item of queueItems) {
      console.log(`🔄 Processing: ${item.listing_url}`);

      try {
        // Step 1: Firecrawl extraction
        const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY');
        if (!firecrawlApiKey) {
          throw new Error('FIRECRAWL_API_KEY not found');
        }

        const firecrawlResponse = await fetch('https://api.firecrawl.dev/v0/scrape', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${firecrawlApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            url: item.listing_url,
            formats: ['markdown'],
            onlyMainContent: true,
            waitFor: 3000
          })
        });

        if (!firecrawlResponse.ok) {
          throw new Error(`Firecrawl ${firecrawlResponse.status}: ${firecrawlResponse.statusText}`);
        }

        const firecrawlData = await firecrawlResponse.json();
        if (!firecrawlData.success) {
          throw new Error(`Firecrawl failed: ${firecrawlData.error || 'Unknown error'}`);
        }

        console.log(`📄 Firecrawl extracted content for: ${item.listing_url}`);

        // Step 2: AI extraction with Claude
        const claudeApiKey = Deno.env.get('NUKE_CLAUDE_API') || Deno.env.get('anthropic_api_key') || Deno.env.get('ANTHROPIC_API_KEY');
        if (!claudeApiKey) {
          throw new Error('Claude API key not found');
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
            max_tokens: 1000,
            messages: [{
              role: 'user',
              content: `Extract vehicle info from: ${item.listing_url}

Content: ${(firecrawlData.data.markdown || '').substring(0, 8000)}

Return JSON only:
{
  "year": number,
  "make": "string",
  "model": "string",
  "asking_price": number,
  "mileage": number,
  "description": "string"
}`
            }]
          })
        });

        if (!claudeResponse.ok) {
          throw new Error(`Claude ${claudeResponse.status}`);
        }

        const claudeData = await claudeResponse.json();
        const responseText = claudeData.content?.[0]?.text;

        if (!responseText) {
          throw new Error('No Claude response');
        }

        let vehicleData;
        try {
          vehicleData = JSON.parse(responseText);
        } catch {
          throw new Error('Invalid Claude JSON response');
        }

        console.log(`🤖 AI extracted: ${vehicleData.year} ${vehicleData.make} ${vehicleData.model}`);

        // Step 3: Save to database
        const { data: newVehicle, error: dbError } = await supabase
          .from('vehicles')
          .insert({
            year: vehicleData.year || null,
            make: vehicleData.make || null,
            model: vehicleData.model || null,
            asking_price: vehicleData.asking_price || null,
            mileage: vehicleData.mileage || null,
            description: vehicleData.description || null,
            discovery_url: item.listing_url,
            source: 'process_import_queue_simple',
            created_at: new Date().toISOString()
          })
          .select('id')
          .single();

        if (dbError) {
          throw new Error(`DB error: ${dbError.message}`);
        }

        console.log(`💾 Vehicle saved: ID ${newVehicle.id}`);

        processedItems.push({
          id: item.id,
          url: item.listing_url,
          success: true,
          vehicleId: newVehicle.id
        });

        // Remove from queue after successful processing
        await supabase
          .from('import_queue')
          .delete()
          .eq('id', item.id);

      } catch (error: any) {
        console.error(`❌ Processing failed for ${item.listing_url}:`, error.message);
        processedItems.push({
          id: item.id,
          url: item.listing_url,
          success: false,
          error: error.message
        });
      }
    }

    const successCount = processedItems.filter(item => item.success).length;

    console.log(`🎯 Batch complete: ${successCount}/${processedItems.length} successful`);

    return new Response(JSON.stringify({
      success: true,
      processed: processedItems.length,
      successful: successCount,
      items: processedItems
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('❌ Process queue error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});