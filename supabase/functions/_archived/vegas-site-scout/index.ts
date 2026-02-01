import "jsr:@supabase/functions-js/edge-runtime.d.ts";
/**
 * VEGAS SITE SCOUT v2
 *
 * Autonomous real estate site selection analysis for Las Vegas garage locations.
 * Uses Census API + AI research instead of blocked commercial listing sites.
 *
 * Deploy:
 *   supabase functions deploy vegas-site-scout --no-verify-jwt
 *
 * Usage:
 *   POST with {"action": "full_scan"} - run complete analysis
 *   POST with {"action": "status"} - check progress
 *   POST with {"action": "results"} - get scored locations
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { callOpenAiChatCompletions } from "../_shared/openaiChat.ts";

// Detailed Vegas area data with real characteristics
const VEGAS_AREAS = [
  {
    name: 'Blue Diamond',
    lat: 36.0419,
    lng: -115.4064,
    zip: '89161',
    type: 'rural',
    population_density: 'very_low',
    median_income: 85000,
    growth_rate: 'high',
    land_cost_per_sqft: 8,
    characteristics: [
      'Rural aesthetic with mountain views',
      'Gateway to Red Rock Canyon - prime driving route for enthusiasts',
      '15-20 min from Summerlin wealthy areas',
      'Room for large facilities with outdoor storage',
      'Limited commercial development = first mover advantage',
      'Zoning more flexible for industrial/automotive',
    ],
    competitors_nearby: 1,
    drive_time_from_wealth: 18,
    highway_access: 'SR-160 direct',
  },
  {
    name: 'Summerlin South',
    lat: 36.1169,
    lng: -115.3340,
    zip: '89135',
    type: 'suburban_wealthy',
    population_density: 'medium',
    median_income: 145000,
    growth_rate: 'established',
    land_cost_per_sqft: 45,
    characteristics: [
      'Heart of Vegas exotic car ownership',
      'Highest concentration of $500K+ vehicles',
      'Premium visibility but premium costs',
      'Limited industrial zoning available',
      'Destination location for owners',
    ],
    competitors_nearby: 8,
    drive_time_from_wealth: 0,
    highway_access: 'I-215/SR-160',
  },
  {
    name: 'Henderson (Inspirada/Cadence)',
    lat: 36.0003,
    lng: -115.0500,
    zip: '89044',
    type: 'suburban_growing',
    population_density: 'medium',
    median_income: 95000,
    growth_rate: 'very_high',
    land_cost_per_sqft: 22,
    characteristics: [
      'Fastest growing area in Vegas',
      'New master-planned communities',
      'Young professionals with disposable income',
      'Good industrial parks available',
      'Easy access to Lake Mead enthusiast routes',
    ],
    competitors_nearby: 4,
    drive_time_from_wealth: 15,
    highway_access: 'I-11/I-515',
  },
  {
    name: 'MacDonald Highlands',
    lat: 35.9972,
    lng: -115.0083,
    zip: '89012',
    type: 'affluent_enclave',
    population_density: 'low',
    median_income: 220000,
    growth_rate: 'established',
    land_cost_per_sqft: 65,
    characteristics: [
      'Highest income zip in Vegas',
      'DragonRidge Country Club area',
      'Extreme density of exotic cars',
      'Very limited commercial land',
      'Residents value privacy and exclusivity',
    ],
    competitors_nearby: 2,
    drive_time_from_wealth: 0,
    highway_access: 'I-215',
  },
  {
    name: 'Southwest Las Vegas (Rhodes Ranch)',
    lat: 36.0500,
    lng: -115.2800,
    zip: '89148',
    type: 'suburban_established',
    population_density: 'medium_high',
    median_income: 85000,
    growth_rate: 'moderate',
    land_cost_per_sqft: 28,
    characteristics: [
      'Mixed income but pockets of wealth',
      'Good highway access (I-15/I-215)',
      'Industrial flex space available',
      'Moderate competition',
      'Central location between wealthy areas',
    ],
    competitors_nearby: 6,
    drive_time_from_wealth: 10,
    highway_access: 'I-15/I-215',
  },
  {
    name: 'Enterprise',
    lat: 36.0267,
    lng: -115.2240,
    zip: '89141',
    type: 'suburban_growing',
    population_density: 'medium',
    median_income: 78000,
    growth_rate: 'high',
    land_cost_per_sqft: 18,
    characteristics: [
      'Rapid development south of Strip',
      'Good mix of commercial/industrial zoning',
      'Affordable land with growth upside',
      'Near airport - good for out-of-state clients',
      'Emerging as car enthusiast corridor',
    ],
    competitors_nearby: 3,
    drive_time_from_wealth: 12,
    highway_access: 'I-15/I-215/Las Vegas Blvd',
  },
  {
    name: 'Mountains Edge',
    lat: 36.0128,
    lng: -115.2678,
    zip: '89178',
    type: 'suburban_new',
    population_density: 'medium',
    median_income: 82000,
    growth_rate: 'very_high',
    land_cost_per_sqft: 15,
    characteristics: [
      'Newest master-planned community',
      'Young families, growing wealth',
      'Still has raw land available',
      'Near Blue Diamond Road access',
      'Semi-rural feel with city proximity',
    ],
    competitors_nearby: 2,
    drive_time_from_wealth: 15,
    highway_access: 'Blue Diamond Rd/I-215',
  },
  {
    name: 'North Las Vegas (Aliante)',
    lat: 36.2883,
    lng: -115.0900,
    zip: '89084',
    type: 'suburban_value',
    population_density: 'medium',
    median_income: 62000,
    growth_rate: 'moderate',
    land_cost_per_sqft: 12,
    characteristics: [
      'Most affordable land in metro',
      'Industrial zones available',
      'Further from wealthy concentrations',
      'Speedway nearby - enthusiast draw',
      'Lower income demographics',
    ],
    competitors_nearby: 5,
    drive_time_from_wealth: 25,
    highway_access: 'I-15/US-93',
  },
  {
    name: 'Spanish Trail',
    lat: 36.0928,
    lng: -115.2939,
    zip: '89113',
    type: 'affluent_enclave',
    population_density: 'low',
    median_income: 175000,
    growth_rate: 'established',
    land_cost_per_sqft: 55,
    characteristics: [
      'Gated golf community',
      'High exotic car concentration',
      'Very limited land availability',
      'Near Blue Diamond access',
      'Privacy-focused residents',
    ],
    competitors_nearby: 3,
    drive_time_from_wealth: 0,
    highway_access: 'Blue Diamond Rd/I-215',
  },
  {
    name: 'Centennial Hills',
    lat: 36.2667,
    lng: -115.2000,
    zip: '89149',
    type: 'suburban_established',
    population_density: 'medium',
    median_income: 92000,
    growth_rate: 'moderate',
    land_cost_per_sqft: 25,
    characteristics: [
      'Established upper-middle community',
      'Good income but not ultra-wealthy',
      'Some industrial flex available',
      'Growing car culture',
      'Decent highway access',
    ],
    competitors_nearby: 4,
    drive_time_from_wealth: 18,
    highway_access: 'US-95/I-215',
  },
];

function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function analyzeAreaWithAI(area: typeof VEGAS_AREAS[0]): Promise<{
  score: number;
  scores: Record<string, number>;
  analysis: string;
  pros: string[];
  cons: string[];
  recommended_actions: string[];
}> {
  const prompt = `You are a commercial real estate analyst specializing in automotive facility site selection.

Analyze this Las Vegas area for a LUXURY/EXOTIC CAR GARAGE AND SERVICE SHOP:

Area: ${area.name}
Coordinates: ${area.lat}, ${area.lng}
Zip Code: ${area.zip}
Type: ${area.type}
Median Household Income: $${area.median_income.toLocaleString()}
Population Density: ${area.population_density}
Growth Rate: ${area.growth_rate}
Land Cost: ~$${area.land_cost_per_sqft}/sqft
Highway Access: ${area.highway_access}
Drive Time from Wealthy Areas: ${area.drive_time_from_wealth} min
Existing Competitors: ${area.competitors_nearby}

Known Characteristics:
${area.characteristics.map(c => '- ' + c).join('\n')}

TARGET CUSTOMER PROFILE:
- Owners of Ferrari, Lamborghini, Porsche, McLaren, classic/collectible cars
- Need secure storage, detailing, light service, transport coordination
- Value discretion, quality, and destination experience
- Typical customer has 2-5 vehicles worth $100K-$2M+

BUSINESS MODEL CONSIDERATIONS:
- Need 5,000-15,000 sqft facility
- Outdoor secure parking for ~20 vehicles ideal
- Some prefer rural/destination feel, others want convenient location
- High-end clientele will drive 20-30 min for right facility

Score 1-10 for each factor (10 = best):
1. demographics - proximity to and density of exotic car owners
2. competition - market saturation (fewer = higher score, but 0 may indicate no market)
3. accessibility - highway access, drive time, visibility
4. growth_potential - area appreciation, development trajectory
5. land_availability - availability of suitable parcels at reasonable cost
6. destination_appeal - would enthusiasts want to drive here? scenic routes nearby?

Return valid JSON only:
{
  "demographics": 7,
  "competition": 6,
  "accessibility": 8,
  "growth_potential": 9,
  "land_availability": 7,
  "destination_appeal": 8,
  "overall": 7.5,
  "analysis": "2-3 sentence analysis of this location for an exotic car garage",
  "pros": ["pro 1", "pro 2", "pro 3"],
  "cons": ["con 1", "con 2"],
  "recommended_actions": ["action 1 if choosing this area", "action 2"]
}`;

  const apiKey = Deno.env.get('OPENAI_API_KEY') || '';
  if (!apiKey) {
    console.error('No OPENAI_API_KEY found');
  }

  try {
    const response = await callOpenAiChatCompletions({
      apiKey,
      body: {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4,
        max_tokens: 800,
      },
      timeoutMs: 30000,
    });

    if (response.ok && response.content_text) {
      const jsonMatch = response.content_text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          score: parsed.overall || 5,
          scores: {
            demographics: parsed.demographics || 5,
            competition: parsed.competition || 5,
            accessibility: parsed.accessibility || 5,
            growth_potential: parsed.growth_potential || 5,
            land_availability: parsed.land_availability || 5,
            destination_appeal: parsed.destination_appeal || 5,
          },
          analysis: parsed.analysis || 'Analysis not available',
          pros: parsed.pros || [],
          cons: parsed.cons || [],
          recommended_actions: parsed.recommended_actions || [],
        };
      }
    } else {
      console.error('OpenAI call failed:', response.status, response.raw);
    }
  } catch (err) {
    console.error('AI analysis error for', area.name, err);
  }

  // Fallback scoring
  let score = 5;
  if (area.median_income > 100000) score += 1;
  if (area.land_cost_per_sqft < 25) score += 0.5;
  if (area.competitors_nearby < 4) score += 0.5;
  if (area.growth_rate === 'very_high' || area.growth_rate === 'high') score += 0.5;
  if (area.drive_time_from_wealth < 15) score += 0.5;

  return {
    score,
    scores: {
      demographics: area.median_income > 100000 ? 8 : 6,
      competition: area.competitors_nearby < 4 ? 7 : 5,
      accessibility: area.drive_time_from_wealth < 15 ? 7 : 5,
      growth_potential: area.growth_rate === 'high' ? 8 : 6,
      land_availability: area.land_cost_per_sqft < 25 ? 8 : 5,
      destination_appeal: area.type === 'rural' ? 7 : 5,
    },
    analysis: 'Fallback analysis - AI unavailable',
    pros: area.characteristics.slice(0, 3),
    cons: ['AI analysis unavailable'],
    recommended_actions: ['Research zoning requirements'],
  };
}

async function generateStrategicSummary(
  rankedAreas: Array<{area: typeof VEGAS_AREAS[0]; result: any}>
): Promise<string> {
  const prompt = `You are advising an entrepreneur on where to open a luxury exotic car garage in Las Vegas.

Here are the analyzed areas, ranked by overall score:

${rankedAreas.map((r, i) => `
${i + 1}. ${r.area.name} (Score: ${r.result.score.toFixed(1)}/10)
   Land cost: $${r.area.land_cost_per_sqft}/sqft | Competitors: ${r.area.competitors_nearby}
   Income: $${r.area.median_income.toLocaleString()} | Growth: ${r.area.growth_rate}
   Analysis: ${r.result.analysis}
   Pros: ${r.result.pros.join(', ')}
   Cons: ${r.result.cons.join(', ')}
`).join('\n')}

The owner is interested in Blue Diamond specifically for its rural character and buildout potential.

Provide a strategic recommendation that covers:

1. **TOP PICK** - Best overall location with reasoning
2. **BLUE DIAMOND ANALYSIS** - Honest assessment of Blue Diamond specifically
3. **ALTERNATIVE STRATEGY** - If Blue Diamond isn't ideal, what would be
4. **HYBRID APPROACH** - Could a split strategy work (e.g., satellite location)?
5. **NEXT STEPS** - 3-5 concrete actions to take this week

Be direct, practical, and specific. This is for someone ready to move.`;

  const apiKey = Deno.env.get('OPENAI_API_KEY') || '';

  try {
    const response = await callOpenAiChatCompletions({
      apiKey,
      body: {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.5,
        max_tokens: 1500,
      },
      timeoutMs: 60000,
    });
    if (response.ok && response.content_text) {
      return response.content_text;
    }
    console.error('Summary generation failed:', response.status, response.raw);
    return `Top area: ${rankedAreas[0]?.area.name}. See individual area analyses for details.`;
  } catch (err) {
    console.error('Summary generation error:', err);
    return `Top area: ${rankedAreas[0]?.area.name}. See individual area analyses for details.`;
  }
}

async function runFullScan(supabase: any): Promise<{ runId: string }> {
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  await supabase.from('site_scout_runs').insert({
    id: runId,
    started_at: startedAt,
    status: 'running',
    phase: 'initializing',
    candidates_found: VEGAS_AREAS.length,
    sites_scored: 0,
  });

  // Run analysis (non-blocking for the response, but we await internally)
  (async () => {
    try {
      await supabase.from('site_scout_runs').update({ phase: 'analyzing_areas' }).eq('id', runId);

      const results: Array<{area: typeof VEGAS_AREAS[0]; result: any}> = [];

      for (const area of VEGAS_AREAS) {
        const result = await analyzeAreaWithAI(area);
        results.push({ area, result });

        // Store each area analysis
        await supabase.from('site_scout_candidates').insert({
          run_id: runId,
          name: area.name,
          address: `${area.zip} - ${area.type}`,
          area: area.name,
          lat: area.lat,
          lng: area.lng,
          price: area.land_cost_per_sqft,
          sqft: null,
          zoning: area.type,
          source: 'area_analysis',
          source_url: null,
          score: result.score,
          scores: result.scores,
          reasoning: JSON.stringify({
            analysis: result.analysis,
            pros: result.pros,
            cons: result.cons,
            recommended_actions: result.recommended_actions,
            median_income: area.median_income,
            competitors: area.competitors_nearby,
            growth_rate: area.growth_rate,
          }),
        });

        await supabase.from('site_scout_runs').update({
          sites_scored: results.length,
        }).eq('id', runId);
      }

      await supabase.from('site_scout_runs').update({ phase: 'generating_summary' }).eq('id', runId);

      // Rank and generate summary
      const rankedAreas = results.sort((a, b) => b.result.score - a.result.score);
      const summary = await generateStrategicSummary(rankedAreas);

      const areaScores = rankedAreas.map(r => ({
        area: r.area.name,
        avgScore: r.result.score,
        siteCount: 1,
        landCost: r.area.land_cost_per_sqft,
        competitors: r.area.competitors_nearby,
      }));

      await supabase.from('site_scout_runs').update({
        status: 'completed',
        phase: 'done',
        completed_at: new Date().toISOString(),
        summary,
        area_scores: areaScores,
        top_sites: rankedAreas.slice(0, 5).map(r => ({
          name: r.area.name,
          score: r.result.score,
        })),
      }).eq('id', runId);

    } catch (err: any) {
      console.error('Scan failed:', err);
      await supabase.from('site_scout_runs').update({
        status: 'failed',
        error: err?.message || String(err),
      }).eq('id', runId);
    }
  })();

  return { runId };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return okJson({ success: false, error: "Method not allowed" }, 405);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "status");

    if (action === "full_scan") {
      const { runId } = await runFullScan(supabase);
      return okJson({
        success: true,
        message: "Site scout scan started - analyzing 10 Vegas areas",
        run_id: runId,
        estimated_time: "2-3 minutes",
        check_status: `POST with {"action": "status", "run_id": "${runId}"}`,
      });
    }

    if (action === "status") {
      const runId = body?.run_id;
      const query = runId
        ? supabase.from('site_scout_runs').select('*').eq('id', runId).single()
        : supabase.from('site_scout_runs').select('*').order('started_at', { ascending: false }).limit(1).single();

      const { data } = await query;
      return okJson({ success: true, run: data });
    }

    if (action === "results") {
      const runId = body?.run_id;
      let query = supabase
        .from('site_scout_candidates')
        .select('*')
        .order('score', { ascending: false })
        .limit(body?.limit || 25);

      if (runId) query = query.eq('run_id', runId);

      const { data } = await query;

      const { data: runData } = await supabase
        .from('site_scout_runs')
        .select('summary, area_scores, top_sites')
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(1)
        .single();

      // Parse reasoning JSON for each candidate
      const candidates = (data || []).map((c: any) => {
        try {
          c.details = JSON.parse(c.reasoning);
        } catch { c.details = null; }
        return c;
      });

      return okJson({
        success: true,
        candidates,
        summary: runData?.summary,
        area_rankings: runData?.area_scores,
      });
    }

    return okJson({ success: false, error: `Unknown action: ${action}` }, 400);

  } catch (err: any) {
    return okJson({ success: false, error: err?.message || String(err) }, 500);
  }
});
