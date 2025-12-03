/**
 * Process Backfill Queue Edge Function
 * Automatically re-extracts data for vehicles when:
 * - Scrapers are improved
 * - Quality scores are low
 * - Manual audits flag missing data
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BackfillJob {
  id: string;
  vehicle_id: string;
  field_names: string[];
  reason: string;
  source_url: string;
  priority: number;
  quality_score: number;
  scraper_version_id?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get pending jobs (prioritize by priority then quality score)
    const { data: jobs, error: jobsError } = await supabase
      .from('backfill_queue')
      .select('*')
      .eq('status', 'pending')
      .order('priority', { ascending: true })  // Lower number = higher priority
      .order('quality_score', { ascending: true })  // Worst quality first
      .limit(10);  // Process 10 at a time

    if (jobsError) {
      throw new Error(`Failed to fetch jobs: ${jobsError.message}`);
    }

    if (!jobs || jobs.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No pending backfill jobs',
        processed: 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`Processing ${jobs.length} backfill jobs...`);

    const results = [];

    for (const job of jobs) {
      console.log(`\n🔄 Processing job ${job.id} (vehicle: ${job.vehicle_id}, reason: ${job.reason})`);

      // Mark as processing
      await supabase
        .from('backfill_queue')
        .update({ 
          status: 'processing',
          started_at: new Date().toISOString()
        })
        .eq('id', job.id);

      try {
        // Get current vehicle data
        const { data: oldVehicle, error: vehicleError } = await supabase
          .from('vehicles')
          .select('*')
          .eq('id', job.vehicle_id)
          .single();

        if (vehicleError || !oldVehicle) {
          throw new Error(`Vehicle not found: ${vehicleError?.message}`);
        }

        // Re-scrape the listing
        console.log(`  🌐 Scraping: ${job.source_url}`);
        const scrapeResponse = await fetch(`${supabaseUrl}/functions/v1/scrape-vehicle`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseKey}`
          },
          body: JSON.stringify({ url: job.source_url })
        });

        if (!scrapeResponse.ok) {
          throw new Error(`Scrape failed: ${scrapeResponse.statusText}`);
        }

        const scrapeResult = await scrapeResponse.json();

        if (!scrapeResult?.success) {
          throw new Error(scrapeResult?.error || 'Scrape returned no data');
        }

        const newData = scrapeResult.data;

        // Compare old vs new data
        const changes: Record<string, { old: any, new: any }> = {};
        const fieldsToCheck = job.field_names.length > 0 
          ? job.field_names 
          : ['vin', 'mileage', 'transmission', 'engine', 'exterior_color', 'interior_color', 'drivetrain', 'seller_name'];

        for (const field of fieldsToCheck) {
          const oldValue = oldVehicle[field];
          const newValue = newData[field];

          if (!oldValue && newValue) {
            // NEW DATA FOUND!
            console.log(`  ✨ ${field}: (none) → "${newValue}"`);
            changes[field] = { old: null, new: newValue };
          } else if (oldValue && newValue && oldValue !== newValue) {
            // DATA CHANGED
            console.log(`  🔄 ${field}: "${oldValue}" → "${newValue}"`);
            changes[field] = { old: oldValue, new: newValue };
          }
        }

        if (Object.keys(changes).length === 0) {
          console.log('  ℹ️  No changes detected');

          await supabase
            .from('backfill_queue')
            .update({
              status: 'completed',
              changes_detected: {},
              fields_updated: [],
              processed_at: new Date().toISOString()
            })
            .eq('id', job.id);

          results.push({ 
            id: job.id, 
            vehicle_id: job.vehicle_id,
            success: true, 
            changes: 0 
          });
          continue;
        }

        // Apply updates to vehicle
        const updates = Object.fromEntries(
          Object.entries(changes).map(([k, v]) => [k, v.new])
        );

        const { error: updateError } = await supabase
          .from('vehicles')
          .update(updates)
          .eq('id', job.vehicle_id);

        if (updateError) {
          throw new Error(`Failed to update vehicle: ${updateError.message}`);
        }

        console.log(`  ✅ Updated ${Object.keys(changes).length} fields`);

        // Log extraction metadata for each changed field
        for (const [field, { new: newVal }] of Object.entries(changes)) {
          const confidenceScore = field === 'seller_name' && String(newVal).split(' ').length === 1 
            ? 0.3  // Low confidence for first-name-only
            : 0.9; // High confidence for everything else

          await supabase.from('extraction_metadata').insert({
            vehicle_id: job.vehicle_id,
            field_name: field,
            field_value: String(newVal),
            extraction_method: 'automated_backfill',
            scraper_version: job.scraper_version_id || 'backfill_v1',
            source_url: job.source_url,
            confidence_score: confidenceScore,
            validation_status: confidenceScore < 0.6 ? 'low_confidence' : 'unvalidated',
            raw_extraction_data: { backfill_job_id: job.id, full_scrape: newData }
          });
        }

        // Recalculate quality score
        await supabase.rpc('calculate_vehicle_quality_score', {
          p_vehicle_id: job.vehicle_id
        });

        // Mark job as completed
        await supabase
          .from('backfill_queue')
          .update({
            status: 'completed',
            changes_detected: changes,
            fields_updated: Object.keys(changes),
            extraction_result: newData,
            processed_at: new Date().toISOString()
          })
          .eq('id', job.id);

        results.push({ 
          id: job.id, 
          vehicle_id: job.vehicle_id,
          success: true, 
          changes: Object.keys(changes).length,
          fields: Object.keys(changes)
        });

        console.log(`  ✅ Backfill completed`);

      } catch (error: any) {
        console.error(`  ❌ Error: ${error.message}`);

        await supabase
          .from('backfill_queue')
          .update({
            status: 'failed',
            error_message: error.message,
            processed_at: new Date().toISOString()
          })
          .eq('id', job.id);

        results.push({ 
          id: job.id, 
          vehicle_id: job.vehicle_id,
          success: false, 
          error: error.message 
        });
      }
    }

    // Summary
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const totalChanges = results.reduce((sum, r) => sum + (r.changes || 0), 0);

    console.log(`\n📊 Summary: ${successful} succeeded, ${failed} failed, ${totalChanges} total changes`);

    return new Response(JSON.stringify({
      success: true,
      processed: results.length,
      successful,
      failed,
      total_changes: totalChanges,
      results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('Function error:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

