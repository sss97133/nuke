/**
 * AI Proofreading and Backfilling Service
 * 
 * Processes pending import_queue items through AI proofreading,
 * backfills missing data, and re-scrapes to fill in blanks.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ProofreadRequest {
  batch_size?: number;
  vehicle_ids?: string[];
  queue_ids?: string[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body: ProofreadRequest = await req.json().catch(() => ({}));
    const { batch_size = 50, vehicle_ids, queue_ids } = body;

    // Get items to process
    let itemsToProcess: any[] = [];

    if (vehicle_ids && vehicle_ids.length > 0) {
      // Process specific vehicles
      const { data: vehicles, error } = await supabase
        .from('vehicles')
        .select('id, discovery_url, origin_metadata, year, make, model, description, status')
        .in('id', vehicle_ids)
        .eq('status', 'pending');

      if (error) throw new Error(`Failed to fetch vehicles: ${error.message}`);
      itemsToProcess = (vehicles || []).map(v => ({
        type: 'vehicle',
        id: v.id,
        url: v.discovery_url,
        data: v
      }));
    } else if (queue_ids && queue_ids.length > 0) {
      // Process specific queue items
      const { data: queueItems, error } = await supabase
        .from('import_queue')
        .select('*')
        .in('id', queue_ids)
        .eq('status', 'pending');

      if (error) throw new Error(`Failed to fetch queue items: ${error.message}`);
      itemsToProcess = (queueItems || []).map(q => ({
        type: 'queue',
        id: q.id,
        url: q.listing_url,
        data: q
      }));
    } else {
      // Get pending items from import_queue
      const { data: queueItems, error } = await supabase
        .from('import_queue')
        .select('*')
        .eq('status', 'pending')
        .lt('attempts', 3)
        .order('created_at', { ascending: true })
        .limit(batch_size);

      if (error) throw new Error(`Failed to fetch queue: ${error.message}`);
      itemsToProcess = (queueItems || []).map(q => ({
        type: 'queue',
        id: q.id,
        url: q.listing_url,
        data: q
      }));
    }

    if (itemsToProcess.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No items to process',
        processed: 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`Processing ${itemsToProcess.length} items through AI proofreading...`);

    const results = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      backfilled: 0,
      vehicles_updated: [] as string[]
    };

    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) {
      const errorMsg = 'OPENAI_API_KEY not configured. Please set it in Supabase Dashboard > Edge Functions > Secrets.';
      console.error(`❌ ${errorMsg}`);
      return new Response(JSON.stringify({
        success: false,
        error: errorMsg,
        processed: 0,
        succeeded: 0,
        failed: 0,
        backfilled: 0,
        vehicles_updated: []
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    for (const item of itemsToProcess) {
      try {
        console.log(`Processing ${item.type} ${item.id}: ${item.url}`);

        // Step 1: Re-scrape the URL
        let html = '';
        const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY');
        
        if (firecrawlApiKey) {
          try {
            const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${firecrawlApiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                url: item.url,
                formats: ['html'],
                waitFor: 1000
              }),
              signal: AbortSignal.timeout(15000)
            });

            if (firecrawlResponse.ok) {
              const firecrawlData = await firecrawlResponse.json();
              if (firecrawlData.success && firecrawlData.data?.html) {
                html = firecrawlData.data.html;
              }
            }
          } catch (e) {
            console.warn('Firecrawl failed, trying direct fetch');
          }
        }

        if (!html) {
          const response = await fetch(item.url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
            signal: AbortSignal.timeout(10000)
          });
          html = await response.text();
        }

        // Remove "Pending Organization Assignments" HTML
        html = html.replace(/<div[^>]*style="[^"]*padding:\s*12px[^"]*background:\s*rgb\(254,\s*243,\s*199\)[^"]*"[^>]*>[\s\S]*?REJECT<\/div>/gi, '');

        const doc = new DOMParser().parseFromString(html, 'text/html');
        const textContent = doc.body?.textContent || html.replace(/<[^>]+>/g, ' ').substring(0, 30000);

        // Step 2: Get current vehicle data
        let vehicleId = item.data.vehicle_id || item.data.id;
        if (item.type === 'queue' && !vehicleId) {
          // Check if vehicle exists for this URL
          const { data: existing } = await supabase
            .from('vehicles')
            .select('id')
            .eq('discovery_url', item.url)
            .single();
          vehicleId = existing?.id;
        }

        let currentData: any = {};
        if (vehicleId) {
          const { data: vehicle } = await supabase
            .from('vehicles')
            .select('*')
            .eq('id', vehicleId)
            .single();
          currentData = vehicle || {};
        } else {
          // Use queue item data
          currentData = {
            year: item.data.listing_year,
            make: item.data.listing_make,
            model: item.data.listing_model,
            description: item.data.raw_data?.description || ''
          };
        }

        // Step 3: AI Proofreading and Backfilling
        const proofreadPrompt = `You are an expert vehicle data proofreader and backfiller. Review the scraped data and current vehicle record, then fill in missing information.

CURRENT VEHICLE DATA:
${JSON.stringify(currentData, null, 2)}

SCRAPED PAGE CONTENT (first 30k chars):
${textContent}

TASK:
1. Review the current vehicle data for accuracy
2. Extract missing fields from the scraped content
3. Backfill any gaps in the data
4. Identify if this is a TRUCK (pickup, C/K series, etc.)
5. Normalize make/model/series/trim according to GM truck nomenclature

Return JSON with:
{
  "year": corrected or extracted year,
  "make": normalized make (Chevrolet/GMC),
  "model": normalized model (C/K, Blazer, Suburban, etc.),
  "series": extracted series (C10, K10, C20, K20, etc.),
  "trim": extracted trim (Cheyenne, Silverado, etc.),
  "vin": VIN if found,
  "mileage": mileage if found,
  "asking_price": price if found,
  "color": color if found,
  "transmission": transmission if found,
  "drivetrain": drivetrain if found,
  "engine": engine if found,
  "body_type": body type (Truck, SUV, etc.),
  "description": improved description with backfilled details,
  "is_truck": true/false,
  "confidence": 0.0-1.0,
  "backfilled_fields": ["field1", "field2"],
  "corrections": ["correction1", "correction2"]
}

CRITICAL: Only include fields that are actually found or can be confidently inferred. Set confidence based on data quality.`;

        const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o',
            messages: [
              {
                role: 'system',
                content: 'You are an expert vehicle data specialist. Return only valid JSON.'
              },
              {
                role: 'user',
                content: proofreadPrompt
              }
            ],
            response_format: { type: 'json_object' },
            temperature: 0.1,
            max_tokens: 2000
          })
        });

        if (!aiResponse.ok) {
          throw new Error(`AI API error: ${aiResponse.status}`);
        }

        const aiData = await aiResponse.json();
        const proofreadData = JSON.parse(aiData.choices[0].message.content);

        // Step 4: Update vehicle or create if needed
        if (vehicleId) {
          const updateData: any = {};
          
          // Only update fields that were backfilled or corrected
          if (proofreadData.backfilled_fields) {
            for (const field of proofreadData.backfilled_fields) {
              if (proofreadData[field] !== null && proofreadData[field] !== undefined) {
                updateData[field] = proofreadData[field];
              }
            }
          }

          // Always update description if improved
          if (proofreadData.description && proofreadData.description.length > (currentData.description?.length || 0)) {
            updateData.description = proofreadData.description;
          }

          if (Object.keys(updateData).length > 0) {
            await supabase
              .from('vehicles')
              .update(updateData)
              .eq('id', vehicleId);
            
            results.backfilled++;
            results.vehicles_updated.push(vehicleId);
            console.log(`✅ Backfilled ${Object.keys(updateData).length} fields for vehicle ${vehicleId}`);
          }
        } else if (item.type === 'queue') {
          // Process through normal import queue flow
          await supabase.functions.invoke('process-import-queue', {
            body: { batch_size: 1, source_id: item.data.source_id }
          });
        }

        // Mark queue item as processed
        if (item.type === 'queue') {
          await supabase
            .from('import_queue')
            .update({
              status: 'complete',
              processed_at: new Date().toISOString()
            })
            .eq('id', item.id);
        }

        results.succeeded++;
        results.processed++;

      } catch (error: any) {
        console.error(`Failed to process ${item.id}:`, error);
        results.failed++;
        results.processed++;

        // Mark as failed if queue item
        if (item.type === 'queue') {
          await supabase
            .from('import_queue')
            .update({
              status: 'failed',
              error_message: error.message,
              processed_at: new Date().toISOString()
            })
            .eq('id', item.id);
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      processed: results.processed,
      succeeded: results.succeeded,
      failed: results.failed,
      backfilled: results.backfilled,
      vehicles_updated: results.vehicles_updated,
      updated: results.backfilled // Alias for compatibility
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('Proofread error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

