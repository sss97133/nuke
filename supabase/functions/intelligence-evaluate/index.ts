/**
 * INTELLIGENCE EVALUATE
 *
 * Gateway between SOURCE and FRAMEWORK layers.
 * Evaluates extracted data and returns APPROVE/DOUBT/REJECT decision.
 *
 * Usage:
 *   POST /intelligence-evaluate
 *   {
 *     "extracted_data": { year, make, model, vin, sale_price, ... },
 *     "source_url": "https://...",
 *     "source_capture_id": "uuid",  // optional
 *     "persist_decision": true       // optional, default true
 *   }
 *
 * Returns:
 *   {
 *     "decision": "APPROVE" | "DOUBT" | "REJECT",
 *     "decision_id": "uuid",
 *     "can_proceed": true | false,
 *     "field_decisions": [...],
 *     "doubts": [...],
 *     "reject_reasons": [...]
 *   }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  evaluateExtraction,
  createDoubtQueueItem,
  type IntelligenceResult,
  type ValidationContext
} from "../_shared/intelligence-layer.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface EvaluateRequest {
  extracted_data: Record<string, any>;
  source_url?: string;
  source_capture_id?: string;
  persist_decision?: boolean;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: EvaluateRequest = await req.json();
    const {
      extracted_data,
      source_url,
      source_capture_id,
      persist_decision = true
    } = body;

    if (!extracted_data) {
      return new Response(
        JSON.stringify({ error: 'extracted_data is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract domain from URL
    let sourceDomain: string | undefined;
    if (source_url) {
      try {
        sourceDomain = new URL(source_url).hostname.replace(/^www\./, '');
      } catch {
        // Invalid URL, continue without domain
      }
    }

    // Build validation context
    const context: ValidationContext = {
      source_url,
      source_domain: sourceDomain,
      claimed_year: extracted_data.year ? Number(extracted_data.year) : undefined,
      claimed_make: extracted_data.make,
      claimed_model: extracted_data.model
    };

    // Run intelligence evaluation
    const result: IntelligenceResult = evaluateExtraction(extracted_data, context);

    // Determine if extraction can proceed to FRAMEWORK
    // APPROVE = yes, DOUBT = no (needs research first), REJECT = no (invalid)
    const canProceed = result.overall_decision === 'APPROVE';

    // Persist decision if requested
    let decisionId: string | undefined;
    if (persist_decision) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );

      // Insert intelligence decision
      const { data: decision, error: decisionError } = await supabase
        .from('intelligence_decisions')
        .insert({
          source_capture_id,
          source_url,
          source_domain: sourceDomain,
          overall_decision: result.overall_decision,
          approve_count: result.approve_count,
          doubt_count: result.doubt_count,
          reject_count: result.reject_count,
          field_decisions: result.field_decisions,
          reject_reasons: result.reject_reasons
        })
        .select('id')
        .single();

      if (decisionError) {
        console.error('Failed to persist decision:', decisionError);
      } else {
        decisionId = decision.id;

        // Queue doubts for research
        if (result.doubts_requiring_research.length > 0) {
          const doubtItems = result.doubts_requiring_research.map(d =>
            createDoubtQueueItem(source_capture_id || decisionId!, d)
          );

          const doubtInserts = doubtItems.map(item => ({
            intelligence_decision_id: decisionId,
            field_name: item.field,
            field_value: item.value,
            doubt_type: item.doubt_type,
            priority: item.priority,
            reason: item.reason,
            evidence: item.evidence
          }));

          const { error: doubtError } = await supabase
            .from('doubt_queue')
            .insert(doubtInserts);

          if (doubtError) {
            console.error('Failed to queue doubts:', doubtError);
          }
        }
      }
    }

    // Build response
    const response = {
      decision: result.overall_decision,
      decision_id: decisionId,
      can_proceed: canProceed,
      field_decisions: result.field_decisions,
      doubts: result.doubts_requiring_research.map(d => ({
        field: d.field,
        value: d.value,
        reason: d.reason,
        doubt_type: d.doubt_type,
        priority: d.evidence?.priority
      })),
      reject_reasons: result.reject_reasons,
      summary: {
        approved: result.approve_count,
        doubted: result.doubt_count,
        rejected: result.reject_count
      },
      timestamp: result.timestamp
    };

    // Log for monitoring
    console.log(`Intelligence: ${result.overall_decision} | URL: ${source_url || 'N/A'} | A:${result.approve_count} D:${result.doubt_count} R:${result.reject_count}`);

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Intelligence evaluation error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
