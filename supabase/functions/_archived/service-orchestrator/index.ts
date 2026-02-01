/**
 * SERVICE ORCHESTRATOR
 * 
 * Processes queued service executions
 * - Fetches queued services
 * - Executes via appropriate adapter
 * - Stores results as field evidence
 * - Updates form completions
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getAdapter } from '../_shared/serviceAdapters.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    const { limit = 10 } = await req.json().catch(() => ({ limit: 10 }));

    console.log(`🎯 Service Orchestrator running (limit: ${limit})`);

    // Fetch queued services
    const { data: queued, error: fetchError } = await supabase
      .from('service_executions')
      .select(`
        *,
        service_integrations (*),
        vehicles (*)
      `)
      .eq('status', 'queued')
      .limit(limit);

    if (fetchError) {
      throw fetchError;
    }

    if (!queued || queued.length === 0) {
      console.log('No queued services to process');
      return new Response(
        JSON.stringify({ message: 'No services to process', processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${queued.length} queued services`);

    let processed = 0;
    let failed = 0;

    for (const execution of queued) {
      try {
        console.log(`\n📋 Processing: ${execution.service_key} for vehicle ${execution.vehicle_id}`);

        // Get adapter
        const adapter = getAdapter(execution.service_key);
        if (!adapter) {
          console.warn(`No adapter found for ${execution.service_key}`);
          await supabase
            .from('service_executions')
            .update({
              status: 'failed',
              error_message: 'No adapter available',
              updated_at: new Date().toISOString()
            })
            .eq('id', execution.id);
          failed++;
          continue;
        }

        // Check if can execute
        const canExecute = await adapter.canExecute(execution.vehicles);
        if (!canExecute) {
          console.warn(`Cannot execute ${execution.service_key} - requirements not met`);
          await supabase
            .from('service_executions')
            .update({
              status: 'failed',
              error_message: 'Requirements not met',
              updated_at: new Date().toISOString()
            })
            .eq('id', execution.id);
          failed++;
          continue;
        }

        // Mark as executing
        await supabase
          .from('service_executions')
          .update({
            status: 'executing',
            started_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', execution.id);

        // Execute service
        console.log(`  ⚙️ Executing ${execution.service_key}...`);
        const result = await adapter.execute(execution.vehicles, execution.request_data);

        if (!result.success) {
          console.error(`  ❌ Execution failed: ${result.error}`);
          await supabase
            .from('service_executions')
            .update({
              status: 'failed',
              error_message: result.error,
              response_data: result,
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('id', execution.id);
          failed++;
          continue;
        }

        console.log(`  ✅ Execution successful`);

        // Store field evidence
        if (result.fields && Object.keys(result.fields).length > 0) {
          console.log(`  📊 Storing ${Object.keys(result.fields).length} fields as evidence...`);
          
          const evidenceRecords = Object.entries(result.fields).map(([fieldName, value]) => ({
            vehicle_id: execution.vehicle_id,
            field_name: fieldName,
            value_text: String(value),
            value_number: typeof value === 'number' ? value : null,
            source_type: execution.service_key,
            source_id: execution.id,
            confidence_score: result.confidence || 85,
            extraction_model: execution.service_integrations?.provider || 'service',
            metadata: {
              service_execution_id: execution.id,
              service_key: execution.service_key,
              extracted_at: new Date().toISOString()
            }
          }));

          const { error: evidenceError } = await supabase
            .from('vehicle_field_evidence')
            .upsert(evidenceRecords, { 
              onConflict: 'vehicle_id,field_name,source_type,source_id',
              ignoreDuplicates: false
            });

          if (evidenceError) {
            console.error('  ⚠️ Error storing evidence:', evidenceError.message);
          } else {
            console.log(`  ✅ Evidence stored`);
          }
        }

        // Create/update form completion
        console.log(`  📝 Updating form completion...`);
        const { error: formError } = await supabase
          .from('vehicle_form_completions')
          .upsert({
            vehicle_id: execution.vehicle_id,
            form_type: execution.service_key,
            status: 'complete',
            completeness_pct: 100,
            fields_extracted: result.fields ? 
              Object.fromEntries(Object.keys(result.fields).map(k => [k, true])) : {},
            source_id: execution.id,
            source_type: 'service_execution',
            provider: execution.service_integrations?.provider,
            extracted_at: new Date().toISOString(),
            service_execution_id: execution.id
          }, {
            onConflict: 'vehicle_id,form_type'
          });

        if (formError) {
          console.error('  ⚠️ Error updating form completion:', formError.message);
        } else {
          console.log(`  ✅ Form completion updated`);
        }

        // Mark execution as complete
        await supabase
          .from('service_executions')
          .update({
            status: 'completed',
            response_data: result,
            fields_populated: result.fields,
            documents_created: result.documents || [],
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', execution.id);

        processed++;
        console.log(`  ✅ Service execution complete`);

      } catch (error: any) {
        console.error(`Error processing service ${execution.id}:`, error.message);
        
        await supabase
          .from('service_executions')
          .update({
            status: 'failed',
            error_message: error.message,
            retry_count: (execution.retry_count || 0) + 1,
            updated_at: new Date().toISOString()
          })
          .eq('id', execution.id);
        
        failed++;
      }
    }

    console.log(`\n✅ Orchestrator complete: ${processed} processed, ${failed} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        processed,
        failed,
        total: queued.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Orchestrator error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

