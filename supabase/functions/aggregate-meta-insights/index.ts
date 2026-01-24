/**
 * Aggregate Meta Insights
 *
 * Analyzes meta_analysis from all comment_discoveries to identify:
 * - Commonly missing data patterns
 * - Schema improvement opportunities
 * - Data source recommendations
 * - Confidence patterns by vehicle segment
 *
 * This is the "self-learning loop" aggregator - it tells us what
 * additional data the system needs to improve market analysis.
 *
 * POST /functions/v1/aggregate-meta-insights
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, serviceKey);

    // Get all discoveries with meta_analysis
    const { data: discoveries, error } = await supabase
      .from("comment_discoveries")
      .select("vehicle_id, raw_extraction, sale_price, overall_sentiment")
      .not("raw_extraction->meta_analysis", "is", null)
      .limit(1000);

    if (error) throw error;

    if (!discoveries || discoveries.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: "No discoveries with meta_analysis found yet",
        analyzed: 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Aggregate patterns
    const missingDataCounts: Record<string, number> = {};
    const recommendedSourcesCounts: Record<string, number> = {};
    const unansweredQuestionsCounts: Record<string, number> = {};
    const analysisGapsCounts: Record<string, number> = {};
    const confidenceScores = {
      sentiment: { high: 0, medium: 0, low: 0 },
      price_assessment: { high: 0, medium: 0, low: 0 },
      authenticity: { high: 0, medium: 0, low: 0 },
      condition: { high: 0, medium: 0, low: 0 },
    };
    const dataQualityScores: number[] = [];
    const typicality = { typical: 0, atypical: 0, outlier: 0 };

    for (const d of discoveries) {
      const meta = d.raw_extraction?.meta_analysis;
      if (!meta) continue;

      // Count missing data patterns
      if (Array.isArray(meta.missing_data)) {
        for (const item of meta.missing_data) {
          const normalized = normalizePattern(item);
          missingDataCounts[normalized] = (missingDataCounts[normalized] || 0) + 1;
        }
      }

      // Count recommended sources
      if (Array.isArray(meta.recommended_sources)) {
        for (const item of meta.recommended_sources) {
          const normalized = normalizePattern(item);
          recommendedSourcesCounts[normalized] = (recommendedSourcesCounts[normalized] || 0) + 1;
        }
      }

      // Count unanswered questions
      if (Array.isArray(meta.unanswerable_questions)) {
        for (const item of meta.unanswerable_questions) {
          const normalized = normalizePattern(item);
          unansweredQuestionsCounts[normalized] = (unansweredQuestionsCounts[normalized] || 0) + 1;
        }
      }

      // Count analysis gaps
      if (Array.isArray(meta.analysis_gaps)) {
        for (const item of meta.analysis_gaps) {
          const normalized = normalizePattern(item);
          analysisGapsCounts[normalized] = (analysisGapsCounts[normalized] || 0) + 1;
        }
      }

      // Aggregate confidence ratings
      if (meta.confidence_ratings) {
        for (const [key, value] of Object.entries(meta.confidence_ratings)) {
          if (confidenceScores[key as keyof typeof confidenceScores]) {
            const level = value as string;
            if (level === "high" || level === "medium" || level === "low") {
              confidenceScores[key as keyof typeof confidenceScores][level]++;
            }
          }
        }
      }

      // Aggregate data quality scores
      if (typeof meta.data_quality_score === "number") {
        dataQualityScores.push(meta.data_quality_score);
      }

      // Aggregate typicality
      if (meta.segment_typicality) {
        const t = meta.segment_typicality as keyof typeof typicality;
        if (typicality[t] !== undefined) {
          typicality[t]++;
        }
      }
    }

    // Sort and get top patterns
    const topMissingData = sortByCount(missingDataCounts, 15);
    const topRecommendedSources = sortByCount(recommendedSourcesCounts, 10);
    const topUnansweredQuestions = sortByCount(unansweredQuestionsCounts, 10);
    const topAnalysisGaps = sortByCount(analysisGapsCounts, 10);

    const avgDataQuality = dataQualityScores.length > 0
      ? dataQualityScores.reduce((a, b) => a + b, 0) / dataQualityScores.length
      : null;

    // Generate schema recommendations based on patterns
    const schemaRecommendations = generateSchemaRecommendations(topMissingData, topRecommendedSources);

    return new Response(JSON.stringify({
      success: true,
      analyzed: discoveries.length,
      insights: {
        top_missing_data: topMissingData,
        top_recommended_sources: topRecommendedSources,
        top_unanswered_questions: topUnansweredQuestions,
        top_analysis_gaps: topAnalysisGaps,
        confidence_distribution: confidenceScores,
        average_data_quality: avgDataQuality,
        typicality_distribution: typicality,
      },
      schema_recommendations: schemaRecommendations,
      action_items: generateActionItems(topMissingData, topRecommendedSources),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e: any) {
    return new Response(JSON.stringify({
      success: false,
      error: e.message,
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});

function normalizePattern(text: string): string {
  // Normalize similar patterns for aggregation
  const lower = text.toLowerCase().trim();

  // Service records variations
  if (lower.includes("service record") || lower.includes("maintenance history") || lower.includes("maintenance record")) {
    return "Service/maintenance records";
  }

  // Owner history variations
  if (lower.includes("owner") && (lower.includes("history") || lower.includes("prior") || lower.includes("previous"))) {
    return "Prior owner history";
  }

  // VIN/Carfax variations
  if (lower.includes("carfax") || lower.includes("autocheck") || lower.includes("vehicle history report")) {
    return "Vehicle history report (Carfax/AutoCheck)";
  }

  // Comparable sales variations
  if (lower.includes("comparable") || lower.includes("similar") && lower.includes("sale")) {
    return "Comparable sales data";
  }

  // Market data variations
  if (lower.includes("market") && (lower.includes("data") || lower.includes("price") || lower.includes("trend"))) {
    return "Market pricing data";
  }

  // Keep original if no match (truncate for display)
  return text.length > 60 ? text.substring(0, 60) + "..." : text;
}

function sortByCount(counts: Record<string, number>, limit: number): Array<{pattern: string, count: number, percentage: number}> {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([pattern, count]) => ({
      pattern,
      count,
      percentage: Math.round((count / total) * 100),
    }));
}

function generateSchemaRecommendations(missingData: any[], sources: any[]): string[] {
  const recommendations: string[] = [];

  for (const item of missingData) {
    if (item.pattern.includes("Service") || item.pattern.includes("maintenance")) {
      recommendations.push("Add `service_records` table with: date, shop, work_done, mileage, cost");
    }
    if (item.pattern.includes("owner history")) {
      recommendations.push("Add `ownership_history` table with: owner_number, acquired_date, sold_date, location");
    }
    if (item.pattern.includes("Comparable")) {
      recommendations.push("Add `price_comparables` view joining similar vehicles by make/model/year/condition");
    }
  }

  return [...new Set(recommendations)]; // Dedupe
}

function generateActionItems(missingData: any[], sources: any[]): string[] {
  const actions: string[] = [];

  // High priority: frequently missing data that has clear sources
  for (const item of missingData.slice(0, 3)) {
    if (item.pattern.includes("Service")) {
      actions.push("Priority: Integrate with shop management systems for service record import");
    }
    if (item.pattern.includes("Vehicle history report")) {
      actions.push("Priority: Add Carfax/AutoCheck API integration for VIN lookups");
    }
    if (item.pattern.includes("Comparable")) {
      actions.push("Priority: Build comparable sales aggregation from existing auction_events");
    }
  }

  return [...new Set(actions)];
}
