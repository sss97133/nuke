/**
 * COMPUTE ORG SELLER STATS — Organization-level seller analytics
 *
 * Aggregates listing data, sale prices, engagement metrics, and sentiment
 * for organizations that sell vehicles on auction platforms.
 *
 * POST /functions/v1/compute-org-seller-stats
 * Body: {
 *   "business_id": "uuid",            // Single org
 *   "business_ids": ["uuid", ...],    // Batch (max 50)
 *   "all": true,                      // Compute for all orgs with listings
 *   "force": false                    // Re-compute even if recent
 * }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function median(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function computeStatsForOrg(
  supabase: ReturnType<typeof createClient>,
  orgId: string
): Promise<Record<string, unknown>> {
  // 1. Get all vehicle events for this org
  const { data: listings, error: listErr } = await supabase
    .from("vehicle_events")
    .select(
      "id, vehicle_id, event_status, final_price, bid_count, started_at, ended_at, view_count, watcher_count, source_platform"
    )
    .eq("source_organization_id", orgId);

  if (listErr) throw new Error(`Listings query failed: ${listErr.message}`);
  if (!listings || listings.length === 0) {
    return { organization_id: orgId, total_listings: 0, skipped: true };
  }

  const vehicleIds = [...new Set(listings.map((l) => l.vehicle_id))];

  // 2. Get vehicle data for category breakdown
  const vehicleData: Record<
    string,
    { make: string; model: string; year: number; source_listing_category: string }
  > = {};
  for (let i = 0; i < vehicleIds.length; i += 20) {
    const batch = vehicleIds.slice(i, i + 20);
    const { data: vehicles } = await supabase
      .from("vehicles")
      .select("id, make, model, year, source_listing_category")
      .in("id", batch);
    for (const v of vehicles || []) {
      vehicleData[v.id] = v;
    }
  }

  // 3. Get auction events for comment counts and duration
  const auctionData: Record<
    string,
    { comments_count: number; auction_duration_hours: number; total_bids: number }
  > = {};
  for (let i = 0; i < vehicleIds.length; i += 20) {
    const batch = vehicleIds.slice(i, i + 20);
    const { data: events } = await supabase
      .from("auction_events")
      .select("vehicle_id, comments_count, auction_duration_hours, total_bids")
      .in("vehicle_id", batch);
    for (const e of events || []) {
      auctionData[e.vehicle_id] = e;
    }
  }

  // 4. Get comment discoveries for sentiment
  const sentimentData: Record<string, { sentiment_score: number }> = {};
  for (let i = 0; i < vehicleIds.length; i += 20) {
    const batch = vehicleIds.slice(i, i + 20);
    const { data: discoveries } = await supabase
      .from("comment_discoveries")
      .select("vehicle_id, sentiment_score, raw_extraction")
      .in("vehicle_id", batch);
    for (const d of discoveries || []) {
      sentimentData[d.vehicle_id] = { sentiment_score: d.sentiment_score };
    }
  }

  // === Compute metrics ===

  const sold = listings.filter((l) => l.event_status === "sold");
  const unsold = listings.filter(
    (l) => l.event_status === "ended" || l.event_status === "cancelled"
  );
  const active = listings.filter(
    (l) => l.event_status === "active" || l.event_status === "pending"
  );

  // Sale prices
  const salePrices = sold
    .map((l) => Number(l.final_price))
    .filter((p) => p > 0);

  // Bid counts
  const bidCounts = listings
    .map((l) => Number(l.bid_count || 0))
    .filter((b) => b >= 0);

  // Comment counts from auction_events
  const commentCounts = vehicleIds
    .map((vid) => auctionData[vid]?.comments_count || 0)
    .filter((c) => c >= 0);

  // View counts
  const viewCounts = listings
    .map((l) => Number(l.view_count || 0))
    .filter((v) => v > 0);

  // Auction durations
  const durations = vehicleIds
    .map((vid) => auctionData[vid]?.auction_duration_hours)
    .filter((d): d is number => d != null && d > 0);

  // Timeline
  const dates = listings
    .map((l) => l.started_at || l.ended_at)
    .filter(Boolean)
    .map((d) => new Date(d).getTime())
    .sort((a, b) => a - b);

  const firstListingDate = dates.length > 0 ? new Date(dates[0]).toISOString() : null;
  const lastListingDate =
    dates.length > 0 ? new Date(dates[dates.length - 1]).toISOString() : null;

  // Listing frequency (avg days between listings)
  let listingFrequencyDays: number | null = null;
  if (dates.length >= 2) {
    const spanDays =
      (dates[dates.length - 1] - dates[0]) / (1000 * 60 * 60 * 24);
    listingFrequencyDays = Math.round((spanDays / (dates.length - 1)) * 10) / 10;
  }

  // Category breakdown
  const makeCounts: Record<string, number> = {};
  const catCounts: Record<string, number> = {};
  for (const vid of vehicleIds) {
    const v = vehicleData[vid];
    if (v?.make) makeCounts[v.make] = (makeCounts[v.make] || 0) + 1;
    if (v?.source_listing_category)
      catCounts[v.source_listing_category] =
        (catCounts[v.source_listing_category] || 0) + 1;
  }

  const primaryMakes = Object.entries(makeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([k]) => k);

  const primaryCategories = Object.entries(catCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([k]) => k);

  // Sentiment
  const sentimentScores = Object.values(sentimentData)
    .map((s) => s.sentiment_score)
    .filter((s) => s != null);

  const avgSentiment =
    sentimentScores.length > 0
      ? Math.round(
          (sentimentScores.reduce((a, b) => a + b, 0) / sentimentScores.length) *
            1000
        ) / 1000
      : null;

  const sellThroughRate =
    sold.length + unsold.length > 0
      ? Math.round((sold.length / (sold.length + unsold.length)) * 1000) / 1000
      : null;

  const stats = {
    organization_id: orgId,
    total_listings: listings.length,
    total_sold: sold.length,
    total_unsold: unsold.length,
    active_listings: active.length,
    sell_through_rate: sellThroughRate,
    total_gross_sales:
      salePrices.length > 0 ? salePrices.reduce((a, b) => a + b, 0) : null,
    avg_sale_price:
      salePrices.length > 0
        ? Math.round(salePrices.reduce((a, b) => a + b, 0) / salePrices.length)
        : null,
    median_sale_price: median(salePrices),
    highest_sale_price: salePrices.length > 0 ? Math.max(...salePrices) : null,
    lowest_sale_price: salePrices.length > 0 ? Math.min(...salePrices) : null,
    avg_bid_count:
      bidCounts.length > 0
        ? Math.round(
            (bidCounts.reduce((a, b) => a + b, 0) / bidCounts.length) * 10
          ) / 10
        : null,
    avg_comment_count:
      commentCounts.length > 0
        ? Math.round(
            (commentCounts.reduce((a, b) => a + b, 0) / commentCounts.length) *
              10
          ) / 10
        : null,
    avg_view_count:
      viewCounts.length > 0
        ? Math.round(
            viewCounts.reduce((a, b) => a + b, 0) / viewCounts.length
          )
        : null,
    avg_auction_duration_hours:
      durations.length > 0
        ? Math.round(
            (durations.reduce((a, b) => a + b, 0) / durations.length) * 10
          ) / 10
        : null,
    first_listing_date: firstListingDate,
    last_listing_date: lastListingDate,
    listing_frequency_days: listingFrequencyDays,
    primary_categories: primaryCategories.length > 0 ? primaryCategories : null,
    primary_makes: primaryMakes.length > 0 ? primaryMakes : null,
    avg_sentiment_score: avgSentiment,
    calculated_at: new Date().toISOString(),
  };

  // Upsert
  const { error: upsertErr } = await supabase
    .from("organization_seller_stats")
    .upsert(stats, { onConflict: "organization_id" });

  if (upsertErr) throw new Error(`Upsert failed: ${upsertErr.message}`);

  return stats;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body = await req.json().catch(() => ({}));
    const {
      business_id,
      business_ids,
      all: computeAll,
      force,
    } = body;

    let orgIds: string[] = [];

    if (business_id) {
      orgIds = [business_id];
    } else if (business_ids && Array.isArray(business_ids)) {
      orgIds = business_ids.slice(0, 50);
    } else if (computeAll) {
      // Find all orgs that have vehicle events
      const { data: orgs } = await supabase
        .from("vehicle_events")
        .select("source_organization_id")
        .limit(1000);

      orgIds = [...new Set((orgs || []).map((o: any) => o.source_organization_id))];
    } else {
      return new Response(
        JSON.stringify({
          error:
            'Provide business_id, business_ids[], or all:true',
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Skip recently computed unless force
    if (!force) {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data: recent } = await supabase
        .from("organization_seller_stats")
        .select("organization_id")
        .in("organization_id", orgIds)
        .gte("calculated_at", oneHourAgo);

      const recentIds = new Set(
        (recent || []).map((r: any) => r.organization_id)
      );
      const skipped = orgIds.filter((id) => recentIds.has(id));
      orgIds = orgIds.filter((id) => !recentIds.has(id));

      if (skipped.length > 0) {
        console.log(
          `Skipping ${skipped.length} orgs computed within last hour`
        );
      }
    }

    const results: Array<Record<string, unknown>> = [];
    const errors: string[] = [];

    for (const orgId of orgIds) {
      try {
        const stats = await computeStatsForOrg(supabase, orgId);
        results.push(stats);
      } catch (err: any) {
        console.error(`Error computing stats for ${orgId}:`, err.message);
        errors.push(`${orgId}: ${err.message}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        computed: results.length,
        skipped: results.filter((r) => r.skipped).length,
        errors: errors.length > 0 ? errors : undefined,
        results,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
