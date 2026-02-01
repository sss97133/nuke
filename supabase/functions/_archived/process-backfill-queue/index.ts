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

        // ============================================
        // FORENSIC SYSTEM INTEGRATION
        // ============================================
        console.log(`  🔬 Processing through forensic system...`);

        // 1. Process scraped data through forensic analysis
        const { data: forensicResult, error: forensicError } = await supabase.rpc(
          'process_scraped_data_forensically',
          {
            p_vehicle_id: job.vehicle_id,
            p_scraped_data: newData,
            p_source_url: job.source_url,
            p_scraper_name: job.scraper_name || 'scrape-vehicle',
            p_context: {}
          }
        );

        if (forensicError) {
          console.error(`  ⚠️  Forensic analysis error: ${forensicError.message}`);
        }

        // 2. Build consensus for critical fields
        const criticalFields = ['vin', 'year', 'make', 'model', 'drivetrain', 'series', 'trim', 'transmission'];
        const consensusResults = [];

        for (const field of criticalFields) {
          if (newData[field]) {
            const { data: consensus, error: consensusError } = await supabase.rpc('build_field_consensus', {
              p_vehicle_id: job.vehicle_id,
              p_field_name: field,
              p_auto_assign: true  // Auto-assign if confidence >= 80%
            });
            
            if (!consensusError && consensus) {
              consensusResults.push({ field, ...consensus });
              if (consensus.auto_assigned) {
                console.log(`  ✅ ${field}: "${consensus.consensus_value}" (${consensus.consensus_confidence}% confidence)`);
              } else if (consensus.consensus_confidence < 70) {
                console.log(`  ⚠️  ${field}: Low confidence (${consensus.consensus_confidence}%) - needs review`);
              }
            }
          }
        }

        // 3. Detect anomalies
        const { data: anomalies, error: anomalyError } = await supabase.rpc('detect_data_anomalies', {
          p_vehicle_id: job.vehicle_id
        });

        if (!anomalyError && anomalies && anomalies.length > 0) {
          console.log(`  🚨 ${anomalies.length} anomalies detected:`);
          for (const anomaly of anomalies.slice(0, 3)) {  // Show first 3
            console.log(`     - ${anomaly.field}: ${anomaly.anomaly} [${anomaly.severity}]`);
          }
        }

        // 4. Get updated vehicle state (after forensic updates)
        const { data: updatedVehicle, error: fetchError } = await supabase
          .from('vehicles')
          .select('*')
          .eq('id', job.vehicle_id)
          .single();

        if (fetchError) {
          throw new Error(`Failed to fetch updated vehicle: ${fetchError.message}`);
        }

        // 5. Track changes for logging
        const changes: Record<string, { old: any, new: any }> = {};
        const fieldsToCheck = job.field_names.length > 0 
          ? job.field_names 
          : ['vin', 'year', 'make', 'model', 'drivetrain', 'series', 'trim', 'transmission', 'mileage'];

        for (const field of fieldsToCheck) {
          const oldValue = oldVehicle[field];
          const newValue = updatedVehicle?.[field];

          if (!oldValue && newValue) {
            changes[field] = { old: null, new: newValue };
          } else if (oldValue && newValue && oldValue !== newValue) {
            changes[field] = { old: oldValue, new: newValue };
          }
        }

        // 6. Log forensic summary
        console.log(`\n  📊 FORENSIC SUMMARY:`);
        console.log(`     Evidence collected: ${forensicResult?.evidence_collected || 0}`);
        console.log(`     Consensus built: ${consensusResults.length}`);
        console.log(`     Anomalies found: ${anomalies?.length || 0}`);
        console.log(`     Fields updated: ${Object.keys(changes).length}`);

        if (Object.keys(changes).length === 0) {
          console.log('  ℹ️  No changes after forensic analysis');
          
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
            changes: 0,
            forensic_summary: {
              evidence: forensicResult?.evidence_collected || 0,
              consensus: consensusResults.length,
              anomalies: anomalies?.length || 0
            }
          });
          continue;
        }

        console.log(`  ✅ Forensic system updated ${Object.keys(changes).length} fields`);

        // Log extraction metadata for audit trail
        for (const [field, { new: newVal }] of Object.entries(changes)) {
          await supabase.from('extraction_metadata').insert({
            vehicle_id: job.vehicle_id,
            field_name: field,
            field_value: String(newVal),
            extraction_method: 'forensic_backfill',
            scraper_version: job.scraper_version_id || 'backfill_v1',
            source_url: job.source_url,
            confidence_score: 0.9,  // High confidence after forensic validation
            validation_status: 'forensic_validated',
            raw_extraction_data: { 
              backfill_job_id: job.id, 
              forensic_evidence: forensicResult?.evidence_collected || 0,
              anomalies: anomalies?.length || 0
            }
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

