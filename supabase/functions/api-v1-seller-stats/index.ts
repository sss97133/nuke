/**
 * API v1 - Seller Stats Endpoint
 *
 * Dealer-level BaT hammer revenue for a seller handle (e.g. "VivaLasVegasAutos").
 * Thin wrapper over the get_seller_stats() RPC (migration
 * 20260705000000_bat_seller_revenue_dedup.sql) -- dedupes bat_listings by
 * normalized listing URL, matches seller by case-insensitive seller_username,
 * excludes self-purchases. See that migration's header comment for the
 * root-cause writeup (trailing-slash re-scrape duplicates + unpopulated
 * seller_external_identity_id FK).
 *
 * Authentication: Bearer token (Supabase JWT) or API key. Seller revenue
 * derived from BaT public auction results -- no auth required for reads,
 * same posture as api-v1-comps.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { corsHeaders } from "../_shared/cors.ts";
import { authenticateRequest } from "../_shared/apiKeyAuth.ts";

const headers = {
  ...corsHeaders,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fire-and-forget auth for rate-limiting; don't block the data query.
    const authPromise = authenticateRequest(req, supabase, {
      endpoint: "seller-stats",
    }).catch(() => {});

    const url = new URL(req.url);
    // deno-lint-ignore no-explicit-any
    let body: Record<string, any> = {};
    if (req.method === "POST") {
      try {
        body = await req.json();
      } catch {
        /* empty body ok */
      }
    }
    const p = (key: string) =>
      url.searchParams.get(key) ?? body[key]?.toString() ?? null;

    const handle = p("handle");
    const since = p("since");
    const until = p("until");

    if (!handle) {
      return jsonResponse({ error: "handle parameter is required" }, 400);
    }

    const rpcRes = await fetch( // guardrail-allow: raw-fetch — internal Supabase REST RPC
      `${supabaseUrl}/rest/v1/rpc/get_seller_stats`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseKey}`,
          apikey: supabaseKey,
        },
        body: JSON.stringify({
          p_handle: handle,
          p_since: since || null,
          p_until: until || null,
        }),
        signal: AbortSignal.timeout(10000),
      },
    );

    if (!rpcRes.ok) {
      const errText = await rpcRes.text();
      console.error("get_seller_stats RPC failed:", rpcRes.status, errText.slice(0, 300));
      return jsonResponse({ error: "Failed to fetch seller stats" }, 502);
    }

    const rows = await rpcRes.json();
    authPromise.catch(() => {});

    if (!Array.isArray(rows) || rows.length === 0) {
      return jsonResponse({
        handle,
        sales_count: 0,
        total_hammer_usd: 0,
        message: "No BaT seller identity or sold listings found for this handle.",
      });
    }

    const r = rows[0];
    return jsonResponse({
      handle: r.bat_username,
      matched_identity_ids: r.matched_identity_ids ?? [],
      sales_count: r.sales_count,
      total_hammer_usd: r.total_hammer_usd,
      avg_hammer_usd: r.avg_hammer_usd,
      self_purchases_excluded: r.self_purchases_excluded,
      self_purchase_usd: r.self_purchase_usd,
      duplicate_rows_collapsed: r.duplicate_rows_collapsed,
      first_sale: r.first_sale,
      last_sale: r.last_sale,
      as_of: r.as_of,
      query: { handle, since: since ?? null, until: until ?? null },
    });
  } catch (err) {
    console.error("Seller stats API error:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
