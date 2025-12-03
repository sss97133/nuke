import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ProcessRequest {
  batch_size?: number;
  priority_only?: boolean;
  source_id?: string;
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

    const body: ProcessRequest = await req.json().catch(() => ({}));
    const { batch_size = 10, priority_only = false, source_id } = body;

    // Get pending items from queue
    let query = supabase
      .from('import_queue')
      .select('*')
      .eq('status', 'pending')
      .lt('attempts', 3)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(batch_size);

    if (priority_only) {
      query = query.gt('priority', 0);
    }

    if (source_id) {
      query = query.eq('source_id', source_id);
    }

    const { data: queueItems, error: queueError } = await query;

    if (queueError) {
      throw new Error(`Failed to fetch queue: ${queueError.message}`);
    }

    if (!queueItems || queueItems.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No items to process',
        processed: 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`Processing ${queueItems.length} queue items`);

    const results = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      duplicates: 0,
      vehicles_created: [] as string[]
    };

    for (const item of queueItems) {
      try {
        // Mark as processing
        await supabase
          .from('import_queue')
          .update({ 
            status: 'processing',
            attempts: item.attempts + 1
          })
          .eq('id', item.id);

        // Check for duplicate by URL
        const { data: existingVehicle } = await supabase
          .from('vehicles')
          .select('id')
          .eq('discovery_url', item.listing_url)
          .single();

        if (existingVehicle) {
          await supabase
            .from('import_queue')
            .update({
              status: 'duplicate',
              vehicle_id: existingVehicle.id,
              processed_at: new Date().toISOString()
            })
            .eq('id', item.id);
          
          results.duplicates++;
          results.processed++;
          continue;
        }

        // Call scrape-vehicle to get full details
        const scrapeResponse = await fetch(
          `${Deno.env.get('SUPABASE_URL')}/functions/v1/scrape-vehicle`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
            },
            body: JSON.stringify({ url: item.listing_url })
          }
        );

        if (!scrapeResponse.ok) {
          throw new Error(`Scrape failed: ${scrapeResponse.status}`);
        }

        const scrapeData = await scrapeResponse.json();

        if (!scrapeData.success) {
          throw new Error(scrapeData.error || 'Scrape returned failure');
        }

        // Get source info for organization linking
        let organizationId = null;
        if (item.source_id) {
          const { data: source } = await supabase
            .from('scrape_sources')
            .select('id')
            .eq('id', item.source_id)
            .single();

          if (source) {
            const { data: org } = await supabase
              .from('organizations')
              .select('id')
              .eq('scrape_source_id', source.id)
              .single();

            if (org) {
              organizationId = org.id;
            }
          }
        }

        // Create vehicle
        const vehicleData = {
          year: scrapeData.data.year || item.listing_year,
          make: scrapeData.data.make || item.listing_make || 'Unknown',
          model: scrapeData.data.model || item.listing_model || 'Unknown',
          trim: scrapeData.data.trim,
          series: scrapeData.data.series,
          body_style: scrapeData.data.body_style,
          drivetrain: scrapeData.data.drivetrain,
          engine_type: scrapeData.data.engine_type,
          vin: scrapeData.data.vin,
          mileage: scrapeData.data.mileage,
          asking_price: scrapeData.data.price || item.listing_price,
          status: 'active',
          is_public: true,
          discovery_url: item.listing_url,
          origin_metadata: {
            ...scrapeData.data,
            source_id: item.source_id,
            queue_id: item.id,
            imported_at: new Date().toISOString()
          },
          selling_organization_id: organizationId,
          import_queue_id: item.id
        };

        const { data: newVehicle, error: vehicleError } = await supabase
          .from('vehicles')
          .insert(vehicleData)
          .select('id')
          .single();

        if (vehicleError) {
          throw new Error(`Vehicle insert failed: ${vehicleError.message}`);
        }

        // Update queue item
        await supabase
          .from('import_queue')
          .update({
            status: 'complete',
            vehicle_id: newVehicle.id,
            processed_at: new Date().toISOString()
          })
          .eq('id', item.id);

        // Create timeline event for listing
        const listedDate = scrapeData.data.listed_date || new Date().toISOString().split('T')[0];
        await supabase
          .from('timeline_events')
          .insert({
            vehicle_id: newVehicle.id,
            event_type: 'auction_listed',
            event_date: listedDate,
            title: 'Listed for Sale',
            description: `Listed on ${new URL(item.listing_url).hostname}`,
            source: 'automated_import',
            metadata: {
              source_url: item.listing_url,
              price: scrapeData.data.price,
              location: scrapeData.data.location
            }
          });

        // Queue images for download
        if (scrapeData.data.images && scrapeData.data.images.length > 0) {
          console.log(`Queuing ${scrapeData.data.images.length} images for vehicle ${newVehicle.id}`);
          
          // Call image backfill for this vehicle
          fetch(
            `${Deno.env.get('SUPABASE_URL')}/functions/v1/backfill-images`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
              },
              body: JSON.stringify({
                vehicle_id: newVehicle.id,
                image_urls: scrapeData.data.images,
                source: 'import_queue',
                run_analysis: true
              })
            }
          ).catch(err => console.error('Image backfill trigger failed:', err));
        }

        results.succeeded++;
        results.vehicles_created.push(newVehicle.id);
        console.log(`Created vehicle ${newVehicle.id} from ${item.listing_url}`);

      } catch (error) {
        console.error(`Failed to process ${item.listing_url}:`, error);

        await supabase
          .from('import_queue')
          .update({
            status: item.attempts >= 2 ? 'failed' : 'pending',
            error_message: error.message,
            processed_at: new Date().toISOString()
          })
          .eq('id', item.id);

        results.failed++;
      }

      results.processed++;
    }

    return new Response(JSON.stringify({
      success: true,
      ...results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Process queue error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

