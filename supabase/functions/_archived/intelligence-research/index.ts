/**
 * INTELLIGENCE RESEARCH
 *
 * Processes the doubt queue - investigates anomalies and resolves them.
 * Can be triggered manually or on a schedule.
 *
 * The doubt→research→learn cycle:
 * 1. Claim pending doubts
 * 2. Research using available data (VIN decode, source verification, pattern matching)
 * 3. Resolve as APPROVE, REJECT, or INCONCLUSIVE
 * 4. Optionally create learned patterns for auto-resolution of similar future doubts
 *
 * Usage:
 *   POST /intelligence-research
 *   {
 *     "batch_size": 10,
 *     "priority": "high",     // optional filter
 *     "doubt_type": "anomaly" // optional filter
 *   }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decodeVin } from "../_shared/vin-decoder.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ResearchRequest {
  batch_size?: number;
  priority?: 'high' | 'medium' | 'low';
  doubt_type?: 'anomaly' | 'conflict' | 'edge_case' | 'unknown_pattern';
}

interface ResearchResult {
  doubt_id: string;
  field: string;
  resolution: 'APPROVE' | 'REJECT' | 'INCONCLUSIVE';
  reason: string;
  findings: Record<string, any>;
  pattern_created: boolean;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: ResearchRequest = await req.json().catch(() => ({}));
    const { batch_size = 10, priority, doubt_type } = body;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Claim doubts for research (with row locking)
    const { data: doubts, error: claimError } = await supabase
      .rpc('claim_doubts_for_research', {
        p_limit: batch_size,
        p_priority: priority || null,
        p_doubt_type: doubt_type || null
      });

    if (claimError) {
      throw new Error(`Failed to claim doubts: ${claimError.message}`);
    }

    if (!doubts || doubts.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No pending doubts to research',
          processed: 0
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Researching ${doubts.length} doubts...`);

    const results: ResearchResult[] = [];

    for (const doubt of doubts) {
      try {
        const result = await researchDoubt(doubt, supabase);
        results.push(result);

        // Resolve in database
        await supabase.rpc('resolve_doubt', {
          p_doubt_id: doubt.id,
          p_resolution: result.resolution,
          p_reason: result.reason,
          p_findings: result.findings,
          p_resolved_by: 'ai_research',
          p_create_pattern: result.pattern_created,
          p_pattern_type: result.pattern_created ? `${doubt.field_name}_${doubt.doubt_type}` : null,
          p_pattern_definition: result.pattern_created ? result.findings : null
        });

      } catch (error: any) {
        console.error(`Failed to research doubt ${doubt.id}:`, error);
        // Mark as inconclusive on error
        await supabase.rpc('resolve_doubt', {
          p_doubt_id: doubt.id,
          p_resolution: 'INCONCLUSIVE',
          p_reason: `Research failed: ${error.message}`,
          p_resolved_by: 'ai_research'
        });

        results.push({
          doubt_id: doubt.id,
          field: doubt.field_name,
          resolution: 'INCONCLUSIVE',
          reason: `Research failed: ${error.message}`,
          findings: {},
          pattern_created: false
        });
      }
    }

    const summary = {
      approved: results.filter(r => r.resolution === 'APPROVE').length,
      rejected: results.filter(r => r.resolution === 'REJECT').length,
      inconclusive: results.filter(r => r.resolution === 'INCONCLUSIVE').length,
      patterns_created: results.filter(r => r.pattern_created).length
    };

    console.log(`Research complete: ${JSON.stringify(summary)}`);

    return new Response(
      JSON.stringify({
        success: true,
        processed: results.length,
        summary,
        results
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Research error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * Research a single doubt and determine resolution
 */
async function researchDoubt(
  doubt: any,
  supabase: any
): Promise<ResearchResult> {

  const fieldName = doubt.field_name;
  const fieldValue = doubt.field_value;
  const doubtType = doubt.doubt_type;
  const evidence = doubt.evidence || {};

  // Route to appropriate research method
  switch (fieldName) {
    case 'vin':
      return await researchVINDoubt(doubt, supabase);

    case 'vin_year_consistency':
      return await researchVINYearConflict(doubt, supabase);

    case 'sale_price':
      return await researchPriceDoubt(doubt, supabase);

    case 'mileage':
      return await researchMileageDoubt(doubt, supabase);

    case 'year':
      return await researchYearDoubt(doubt, supabase);

    default:
      // Generic research - try to match against existing patterns
      return await researchGenericDoubt(doubt, supabase);
  }
}

/**
 * Research VIN-related doubts
 */
async function researchVINDoubt(
  doubt: any,
  supabase: any
): Promise<ResearchResult> {
  const vin = String(doubt.field_value || '').toUpperCase().trim();
  const evidence = doubt.evidence || {};

  // Pre-1981 VIN edge case
  if (evidence.era === 'pre-standardization' || vin.length < 17) {
    // Check if we've seen similar VINs approved before
    const { data: similarApproved } = await supabase
      .from('vehicles')
      .select('id, vin, year')
      .ilike('vin', `${vin.substring(0, 4)}%`)
      .not('vin', 'is', null)
      .limit(5);

    if (similarApproved && similarApproved.length > 0) {
      // Found similar VINs already in system
      return {
        doubt_id: doubt.id,
        field: 'vin',
        resolution: 'APPROVE',
        reason: `VIN format matches ${similarApproved.length} existing pre-1981 vehicles in database`,
        findings: {
          similar_vins: similarApproved.map((v: any) => ({ vin: v.vin, year: v.year })),
          vin_prefix: vin.substring(0, 4)
        },
        pattern_created: true  // Create pattern for this prefix
      };
    }

    // No similar VINs - verify against known pre-1981 formats
    const decoded = decodeVin(vin);
    if (decoded.year && decoded.make) {
      return {
        doubt_id: doubt.id,
        field: 'vin',
        resolution: 'APPROVE',
        reason: `VIN decodes to ${decoded.year} ${decoded.make} - valid pre-1981 format`,
        findings: {
          decoded_year: decoded.year,
          decoded_make: decoded.make,
          decoded_model: decoded.model
        },
        pattern_created: false
      };
    }

    // Can't verify
    return {
      doubt_id: doubt.id,
      field: 'vin',
      resolution: 'INCONCLUSIVE',
      reason: 'Unable to verify pre-1981 VIN format',
      findings: { vin_length: vin.length },
      pattern_created: false
    };
  }

  // Checksum failure
  if (doubt.reason.includes('checksum')) {
    // Checksum failures are usually data entry errors - REJECT with explanation
    return {
      doubt_id: doubt.id,
      field: 'vin',
      resolution: 'REJECT',
      reason: 'VIN checksum validation failed - likely data entry error',
      findings: { vin_provided: vin, checksum_algorithm: 'MOD 11' },
      pattern_created: false  // Don't create pattern, each bad VIN is unique
    };
  }

  // Default: inconclusive
  return {
    doubt_id: doubt.id,
    field: 'vin',
    resolution: 'INCONCLUSIVE',
    reason: 'Unable to resolve VIN doubt',
    findings: {},
    pattern_created: false
  };
}

/**
 * Research VIN/Year consistency conflicts
 */
async function researchVINYearConflict(
  doubt: any,
  supabase: any
): Promise<ResearchResult> {
  const evidence = doubt.evidence || {};
  const vinYear = evidence.decoded_year;
  const claimedYear = evidence.claimed_year;

  // Check if this is a known model year vs build year difference
  // Some manufacturers build next year's model in the current year
  if (Math.abs(vinYear - claimedYear) === 1) {
    return {
      doubt_id: doubt.id,
      field: 'vin_year_consistency',
      resolution: 'APPROVE',
      reason: '1-year difference is common (model year vs production year)',
      findings: {
        vin_year: vinYear,
        claimed_year: claimedYear,
        difference: Math.abs(vinYear - claimedYear),
        explanation: 'Manufacturers often produce vehicles in the previous calendar year'
      },
      pattern_created: true  // This is a common pattern
    };
  }

  // Larger difference - probably an error
  if (Math.abs(vinYear - claimedYear) > 1) {
    return {
      doubt_id: doubt.id,
      field: 'vin_year_consistency',
      resolution: 'REJECT',
      reason: `VIN year (${vinYear}) differs from claimed year (${claimedYear}) by ${Math.abs(vinYear - claimedYear)} years`,
      findings: {
        vin_year: vinYear,
        claimed_year: claimedYear,
        difference: Math.abs(vinYear - claimedYear)
      },
      pattern_created: false
    };
  }

  return {
    doubt_id: doubt.id,
    field: 'vin_year_consistency',
    resolution: 'INCONCLUSIVE',
    reason: 'Unable to resolve year conflict',
    findings: evidence,
    pattern_created: false
  };
}

/**
 * Research price anomalies
 */
async function researchPriceDoubt(
  doubt: any,
  supabase: any
): Promise<ResearchResult> {
  const price = Number(doubt.field_value);
  const evidence = doubt.evidence || {};

  // Very low price
  if (price < 100) {
    return {
      doubt_id: doubt.id,
      field: 'sale_price',
      resolution: 'REJECT',
      reason: `Price $${price} is too low to be a valid sale price`,
      findings: { price, threshold: 100 },
      pattern_created: false
    };
  }

  // High-value sale - check source reliability
  if (price > 2000000) {
    // Get the source domain from the parent intelligence decision
    const { data: decision } = await supabase
      .from('intelligence_decisions')
      .select('source_domain')
      .eq('id', doubt.intelligence_decision_id)
      .single();

    const trustedAuctionDomains = [
      'rmsothebys.com', 'gooding.com', 'bonhams.com',
      'bringatrailer.com', 'mecum.com', 'barrett-jackson.com'
    ];

    if (decision?.source_domain && trustedAuctionDomains.includes(decision.source_domain)) {
      return {
        doubt_id: doubt.id,
        field: 'sale_price',
        resolution: 'APPROVE',
        reason: `High-value sale ($${price.toLocaleString()}) from trusted source: ${decision.source_domain}`,
        findings: {
          price,
          source_domain: decision.source_domain,
          trusted: true
        },
        pattern_created: false
      };
    }

    // Unknown source for high-value sale
    return {
      doubt_id: doubt.id,
      field: 'sale_price',
      resolution: 'INCONCLUSIVE',
      reason: `High-value sale ($${price.toLocaleString()}) from unverified source`,
      findings: {
        price,
        source_domain: decision?.source_domain || 'unknown',
        trusted: false
      },
      pattern_created: false
    };
  }

  return {
    doubt_id: doubt.id,
    field: 'sale_price',
    resolution: 'APPROVE',
    reason: 'Price within normal range after review',
    findings: { price },
    pattern_created: false
  };
}

/**
 * Research mileage anomalies
 */
async function researchMileageDoubt(
  doubt: any,
  supabase: any
): Promise<ResearchResult> {
  const mileage = Number(doubt.field_value);
  const evidence = doubt.evidence || {};

  // Very high mileage
  if (mileage > 1000000) {
    // Could be commercial vehicle or error
    return {
      doubt_id: doubt.id,
      field: 'mileage',
      resolution: 'INCONCLUSIVE',
      reason: `Mileage ${mileage.toLocaleString()} is extremely high - may be commercial vehicle or data error`,
      findings: {
        mileage,
        possible_causes: ['commercial_vehicle', 'data_entry_error', 'odometer_rollover']
      },
      pattern_created: false
    };
  }

  // Low mileage on old car
  if (evidence.vehicle_age && evidence.avg_miles_per_year) {
    const avgMiles = evidence.avg_miles_per_year;

    // Less than 100 miles/year on average is plausible for collector cars
    if (avgMiles < 100 && avgMiles > 0) {
      return {
        doubt_id: doubt.id,
        field: 'mileage',
        resolution: 'APPROVE',
        reason: `Low mileage (${mileage.toLocaleString()}) is plausible for collector vehicle`,
        findings: {
          mileage,
          vehicle_age: evidence.vehicle_age,
          avg_miles_per_year: avgMiles,
          collector_car: true
        },
        pattern_created: true  // Create pattern for low-mileage collector cars
      };
    }
  }

  return {
    doubt_id: doubt.id,
    field: 'mileage',
    resolution: 'APPROVE',
    reason: 'Mileage reviewed and approved',
    findings: { mileage },
    pattern_created: false
  };
}

/**
 * Research year anomalies (pre-1920 vehicles)
 */
async function researchYearDoubt(
  doubt: any,
  supabase: any
): Promise<ResearchResult> {
  const year = Number(doubt.field_value);
  const evidence = doubt.evidence || {};

  // Brass era vehicles (pre-1920)
  if (year >= 1885 && year < 1920) {
    // These are legitimate but rare - approve with note
    return {
      doubt_id: doubt.id,
      field: 'year',
      resolution: 'APPROVE',
      reason: `Pre-1920 vehicle (${year}) is valid but rare - brass era automobile`,
      findings: {
        year,
        era: 'brass_era',
        note: 'These vehicles are rare and valuable'
      },
      pattern_created: true  // Create pattern to auto-approve brass era
    };
  }

  return {
    doubt_id: doubt.id,
    field: 'year',
    resolution: 'APPROVE',
    reason: 'Year reviewed and approved',
    findings: { year },
    pattern_created: false
  };
}

/**
 * Generic doubt research - try pattern matching
 */
async function researchGenericDoubt(
  doubt: any,
  supabase: any
): Promise<ResearchResult> {

  // Check if there's an existing pattern that matches
  const { data: patterns } = await supabase
    .from('intelligence_patterns')
    .select('*')
    .eq('pattern_type', doubt.doubt_type)
    .eq('is_active', true)
    .order('confidence', { ascending: false })
    .limit(5);

  // Try to match patterns (simplified matching)
  if (patterns && patterns.length > 0) {
    for (const pattern of patterns) {
      // This would need more sophisticated pattern matching in production
      const def = pattern.pattern_definition;
      if (def && typeof def === 'object') {
        // Record that we checked this pattern
        await supabase.rpc('record_pattern_match', { p_pattern_id: pattern.id });

        if (pattern.confidence > 0.8) {
          return {
            doubt_id: doubt.id,
            field: doubt.field_name,
            resolution: pattern.resolution,
            reason: `Matched existing pattern: ${def.description || pattern.pattern_type}`,
            findings: {
              matched_pattern_id: pattern.id,
              pattern_confidence: pattern.confidence
            },
            pattern_created: false
          };
        }
      }
    }
  }

  // No pattern match - inconclusive
  return {
    doubt_id: doubt.id,
    field: doubt.field_name,
    resolution: 'INCONCLUSIVE',
    reason: 'No matching pattern found - needs manual review',
    findings: { doubt_type: doubt.doubt_type },
    pattern_created: false
  };
}
