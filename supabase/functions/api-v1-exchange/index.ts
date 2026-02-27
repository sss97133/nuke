/**
 * api-v1-exchange
 *
 * Unified read API for the market exchange. Returns fund + vehicle offering data
 * without calling the slow market_segment_stats RPC (uses cached stats in metadata).
 *
 * Routes (all GET or POST with action):
 *   GET  /api-v1-exchange                        → full snapshot (funds + offerings)
 *   GET  /api-v1-exchange?action=funds            → all active market funds + stats
 *   GET  /api-v1-exchange?action=fund&symbol=PORS → single fund + stats + holdings
 *   GET  /api-v1-exchange?action=offerings        → all trading vehicle offerings
 *   GET  /api-v1-exchange?action=holdings         → caller's holdings (requires auth)
 *
 * POST /api-v1-exchange  { action, ...params }   → same actions via body
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface FundWithStats {
  id: string;
  symbol: string;
  fund_type: string;
  status: string;
  nav_share_price: number;
  total_shares_outstanding: number;
  total_aum_usd: number;
  segment_id: string;
  segment: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    manager_type: string;
    year_min: number | null;
    year_max: number | null;
    makes: string[] | null;
    model_keywords: string[] | null;
  } | null;
  stats: {
    vehicle_count: number;
    market_cap_usd: number;
    change_7d_pct: number | null;
    change_30d_pct: number | null;
    stats_updated_at: string | null;
  };
}

interface VehicleOffering {
  id: string;
  vehicle_id: string;
  status: string;
  current_share_price: number;
  total_shares: number;
  vehicle: {
    id: string;
    year: number | null;
    make: string | null;
    model: string | null;
    vin: string | null;
    nuke_estimate: number | null;
    sale_price: number | null;
    primary_image_url: string | null;
  } | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractStats(metadata: Record<string, unknown> | null) {
  return {
    vehicle_count: Number(metadata?.vehicle_count ?? 0),
    market_cap_usd: Number(metadata?.market_cap_usd ?? 0),
    change_7d_pct: metadata?.change_7d_pct != null ? Number(metadata.change_7d_pct) : null,
    change_30d_pct: metadata?.change_30d_pct != null ? Number(metadata.change_30d_pct) : null,
    stats_updated_at: (metadata?.stats_updated_at as string) ?? null,
  };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async function getFunds(supabase: ReturnType<typeof createClient>): Promise<FundWithStats[]> {
  const { data, error } = await supabase
    .from("market_funds")
    .select(`
      id, symbol, fund_type, status,
      nav_share_price, total_shares_outstanding, total_aum_usd,
      segment_id, metadata,
      segment:market_segments (
        id, slug, name, description, manager_type,
        year_min, year_max, makes, model_keywords
      )
    `)
    .eq("status", "active")
    .order("symbol");

  if (error) throw error;

  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    symbol: r.symbol as string,
    fund_type: r.fund_type as string,
    status: r.status as string,
    nav_share_price: Number(r.nav_share_price),
    total_shares_outstanding: Number(r.total_shares_outstanding),
    total_aum_usd: Number(r.total_aum_usd),
    segment_id: r.segment_id as string,
    segment: r.segment as FundWithStats["segment"],
    stats: extractStats(r.metadata as Record<string, unknown> | null),
  }));
}

async function getOfferings(supabase: ReturnType<typeof createClient>): Promise<VehicleOffering[]> {
  const { data, error } = await supabase
    .from("vehicle_offerings")
    .select(`
      id, vehicle_id, status, current_share_price, total_shares,
      vehicle:vehicles (
        id, year, make, model, vin, nuke_estimate, sale_price,
        primary_image_url
      )
    `)
    .eq("status", "trading")
    .order("created_at");

  if (error) throw error;

  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    vehicle_id: r.vehicle_id as string,
    status: r.status as string,
    current_share_price: Number(r.current_share_price),
    total_shares: Number(r.total_shares),
    vehicle: r.vehicle as VehicleOffering["vehicle"],
  }));
}

async function getUserHoldings(
  supabase: ReturnType<typeof createClient>,
  userId: string,
) {
  const [vehicleHoldings, fundHoldings] = await Promise.all([
    supabase
      .from("share_holdings")
      .select(`
        id, offering_id, shares_owned, entry_price, current_mark,
        unrealized_gain_loss, unrealized_gain_loss_pct,
        offering:vehicle_offerings (
          id, current_share_price, status,
          vehicle:vehicles (id, year, make, model, primary_image_url)
        )
      `)
      .eq("holder_id", userId)
      .gt("shares_owned", 0),

    supabase
      .from("market_fund_holdings")
      .select(`
        id, fund_id, shares_owned, entry_nav, current_nav,
        unrealized_gain_loss_usd, unrealized_gain_loss_pct,
        fund:market_funds (id, symbol, nav_share_price, status)
      `)
      .eq("user_id", userId)
      .gt("shares_owned", 0),
  ]);

  if (vehicleHoldings.error) throw vehicleHoldings.error;
  if (fundHoldings.error) throw fundHoldings.error;

  return {
    vehicle_holdings: vehicleHoldings.data ?? [],
    fund_holdings: fundHoldings.data ?? [],
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  let action = url.searchParams.get("action") ?? "snapshot";
  let params: Record<string, string> = {};

  // Merge URL params
  url.searchParams.forEach((v, k) => { if (k !== "action") params[k] = v; });

  // Merge body params for POST
  if (req.method === "POST") {
    try {
      const body = await req.json();
      if (body?.action) action = body.action;
      Object.assign(params, body);
      delete params.action;
    } catch {
      // ignore
    }
  }

  // Auth: for user-specific actions, extract user from JWT
  // For public data (funds, offerings, snapshot), allow anon
  const authHeader = req.headers.get("authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const supabaseService = createClient(supabaseUrl, serviceKey);

  try {
    // ── snapshot: full exchange state ───────────────────────────────────────
    if (action === "snapshot" || action === "full") {
      const [funds, offerings] = await Promise.all([
        getFunds(supabaseService),
        getOfferings(supabaseService),
      ]);

      return json({
        funds,
        offerings,
        generated_at: new Date().toISOString(),
      });
    }

    // ── funds list ──────────────────────────────────────────────────────────
    if (action === "funds") {
      const funds = await getFunds(supabaseService);
      return json({ funds, generated_at: new Date().toISOString() });
    }

    // ── single fund by symbol ───────────────────────────────────────────────
    if (action === "fund") {
      const symbol = (params.symbol as string)?.toUpperCase();
      if (!symbol) return json({ error: "symbol required" }, 400);

      const funds = await getFunds(supabaseService);
      const fund = funds.find((f) => f.symbol === symbol);
      if (!fund) return json({ error: `Fund not found: ${symbol}` }, 404);

      return json({ fund, generated_at: new Date().toISOString() });
    }

    // ── vehicle offerings ───────────────────────────────────────────────────
    if (action === "offerings") {
      const offerings = await getOfferings(supabaseService);
      return json({ offerings, generated_at: new Date().toISOString() });
    }

    // ── user holdings (auth required) ───────────────────────────────────────
    if (action === "holdings") {
      if (!authHeader) return json({ error: "Authorization required" }, 401);

      const supabaseUser = createClient(supabaseUrl, anonKey, {
        global: { headers: { authorization: authHeader } },
      });

      const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
      if (authError || !user) return json({ error: "Invalid token" }, 401);

      const holdings = await getUserHoldings(supabaseService, user.id);
      return json({ ...holdings, generated_at: new Date().toISOString() });
    }

    return json({ error: `Unknown action: ${action}` }, 400);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("api-v1-exchange error:", msg);
    return json({ error: msg }, 500);
  }
});
