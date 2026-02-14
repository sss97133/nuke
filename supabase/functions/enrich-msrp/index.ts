import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SERVICE_ROLE_KEY") ??
  "";

type ReqBody = {
  vehicle_id?: string;
  batch?: boolean;
  limit?: number;
};

type EnrichResult = {
  vehicle_id: string;
  msrp: number | null;
  msrp_source: string | null;
  strategy: string;
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

/**
 * Strategy 1: Check oem_trim_levels for matching year/make/model/trim
 */
async function tryOemLookup(
  supabase: ReturnType<typeof createClient>,
  year: number | null,
  make: string | null,
  model: string | null,
  trim: string | null,
): Promise<number | null> {
  if (!make || !model) return null;

  // Use the smart lookup RPC that handles messy model names
  // (e.g. "Boss 302 Mustang Fastback" matches model_family "Mustang")
  const { data, error } = await supabase.rpc("lookup_oem_msrp", {
    p_make: make,
    p_model: model,
    p_year: year,
    p_trim: trim,
  });

  if (error) {
    console.warn(`[enrich-msrp] OEM lookup RPC error: ${error.message}`);
    return null;
  }

  // RPC returns an array with 0 or 1 rows
  const row = Array.isArray(data) ? data[0] : data;
  return row?.base_msrp_usd ?? null;
}

/**
 * Strategy 2: Parse MSRP from vehicle description text
 */
function tryDescriptionParse(description: string | null): number | null {
  if (!description) return null;

  // Common MSRP patterns in listing descriptions
  const patterns = [
    /(?:original\s+)?msrp[:\s]+\$?([\d,]+)/i,
    /sticker\s+price[:\s]+\$?([\d,]+)/i,
    /(?:original|base)\s+(?:list|retail)\s+price[:\s]+\$?([\d,]+)/i,
    /msrp\s+(?:of|was|is)\s+\$?([\d,]+)/i,
    /\$([\d,]+)\s+(?:original\s+)?msrp/i,
    /\$([\d,]+)\s+(?:when\s+new|new)/i,
    /priced\s+(?:at|from)\s+\$?([\d,]+)\s+(?:new|when\s+new)/i,
    /new\s+(?:for|at)\s+\$?([\d,]+)/i,
    /(?:window\s+sticker|monroney)[:\s]+\$?([\d,]+)/i,
    /msrp\s+(?:when\s+new|of)\s+\$?([\d,]+)/i,
  ];

  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (match) {
      const value = parseInt(match[1].replace(/,/g, ""), 10);
      // Sanity check: MSRP should be between $1,000 and $5,000,000
      if (value >= 1000 && value <= 5_000_000) {
        return value;
      }
    }
  }

  return null;
}

/**
 * Strategy 3: Use model market stats as AI estimate
 * Uses median sale price from get_model_market_stats RPC
 */
async function tryMarketEstimate(
  supabase: ReturnType<typeof createClient>,
  make: string | null,
  model: string | null,
): Promise<number | null> {
  if (!make || !model) return null;

  const { data, error } = await supabase.rpc("get_model_market_stats", {
    p_make: make,
    p_model: model,
  });

  if (error || !data) return null;

  const stats = data as { median_price?: number; avg_price?: number; total_listings?: number };

  // Only use as estimate if we have enough data points
  if ((stats.total_listings ?? 0) < 3) return null;

  // Prefer median, fall back to average
  const price = stats.median_price ?? stats.avg_price;
  if (price && price > 0) {
    return Math.round(price);
  }

  return null;
}

/**
 * Enrich a single vehicle's MSRP using cascading strategies.
 * skipMarketEstimate: skip the slow RPC-based market estimate (used in batch mode)
 */
async function enrichVehicleMsrp(
  supabase: ReturnType<typeof createClient>,
  vehicleId: string,
  skipMarketEstimate = false,
): Promise<EnrichResult> {
  const result: EnrichResult = {
    vehicle_id: vehicleId,
    msrp: null,
    msrp_source: null,
    strategy: "none",
  };

  // Fetch vehicle data
  const { data: vehicle, error } = await supabase
    .from("vehicles")
    .select("id, year, make, model, trim, description, msrp, msrp_source")
    .eq("id", vehicleId)
    .maybeSingle();

  if (error || !vehicle) {
    result.strategy = "error";
    return result;
  }

  // Skip if MSRP already set by user or OEM (don't overwrite authoritative sources)
  if (vehicle.msrp && (vehicle.msrp_source === "user" || vehicle.msrp_source === "oem")) {
    result.msrp = vehicle.msrp;
    result.msrp_source = vehicle.msrp_source;
    result.strategy = "already_set";
    return result;
  }

  // Strategy 1: OEM trim lookup
  const oemMsrp = await tryOemLookup(supabase, vehicle.year, vehicle.make, vehicle.model, vehicle.trim);
  if (oemMsrp) {
    result.msrp = oemMsrp;
    result.msrp_source = "oem";
    result.strategy = "oem_lookup";
  }

  // Strategy 2: Parse from description
  if (!result.msrp) {
    const parsedMsrp = tryDescriptionParse(vehicle.description);
    if (parsedMsrp) {
      result.msrp = parsedMsrp;
      result.msrp_source = "listing_parsed";
      result.strategy = "description_parse";
    }
  }

  // Strategy 3: Market estimate (lowest confidence — only if nothing better)
  // Skipped in batch mode because the RPC is slow per-vehicle
  if (!result.msrp && !skipMarketEstimate) {
    const estimatedMsrp = await tryMarketEstimate(supabase, vehicle.make, vehicle.model);
    if (estimatedMsrp) {
      result.msrp = estimatedMsrp;
      result.msrp_source = "ai_estimated";
      result.strategy = "market_estimate";
    }
  }

  // Write to DB if we found something
  if (result.msrp) {
    const { error: updateError } = await supabase
      .from("vehicles")
      .update({
        msrp: result.msrp,
        msrp_source: result.msrp_source,
      })
      .eq("id", vehicleId);

    if (updateError) {
      console.error(`[enrich-msrp] Update failed for ${vehicleId}:`, updateError.message);
      result.strategy = `${result.strategy}_write_failed`;
    }
  }

  return result;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "Method Not Allowed" });

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(500, { ok: false, error: "Supabase env vars not configured" });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const body = (await req.json().catch(() => ({}))) as Partial<ReqBody>;

    // Single vehicle mode
    if (body.vehicle_id) {
      const vehicleId = String(body.vehicle_id).trim();
      if (!vehicleId) return json(400, { ok: false, error: "Invalid vehicle_id" });

      const result = await enrichVehicleMsrp(supabase, vehicleId);
      return json(200, { ok: true, result });
    }

    // Batch mode — find vehicles missing MSRP and enrich them
    if (body.batch) {
      const limit = Math.min(body.limit ?? 50, 200);

      // Use RPC to find vehicles with clean makes that match our OEM data
      // This avoids wasting time on garbage "30k-Mile" or "Modified" makes
      const { data: vehicles, error } = await supabase.rpc("find_vehicles_for_msrp_enrichment", {
        p_limit: limit,
      });

      // Fallback to simple query if RPC doesn't exist yet
      if (error && error.message?.includes("function") && error.message?.includes("does not exist")) {
        const { data: fallbackVehicles, error: fbErr } = await supabase
          .from("vehicles")
          .select("id")
          .is("msrp", null)
          .not("make", "is", null)
          .not("model", "is", null)
          .order("created_at", { ascending: false })
          .limit(limit);
        if (fbErr) return json(500, { ok: false, error: fbErr.message });
        if (!fallbackVehicles || fallbackVehicles.length === 0) {
          return json(200, { ok: true, message: "No vehicles to enrich", results: [] });
        }
        // Use fallback
        const fbResults: EnrichResult[] = [];
        let fbEnriched = 0;
        for (const v of fallbackVehicles) {
          const result = await enrichVehicleMsrp(supabase, v.id, true);
          fbResults.push(result);
          if (result.msrp) fbEnriched++;
        }
        return json(200, { ok: true, processed: fallbackVehicles.length, enriched: fbEnriched, results: fbResults });
      }

      if (error) return json(500, { ok: false, error: error.message });
      if (!vehicles || vehicles.length === 0) {
        return json(200, { ok: true, message: "No vehicles to enrich", results: [] });
      }

      const results: EnrichResult[] = [];
      let enriched = 0;

      for (const v of vehicles) {
        const result = await enrichVehicleMsrp(supabase, v.id, true);
        results.push(result);
        if (result.msrp) enriched++;
      }

      return json(200, {
        ok: true,
        processed: vehicles.length,
        enriched,
        results,
      });
    }

    return json(400, { ok: false, error: "Provide vehicle_id or batch: true" });
  } catch (e: any) {
    console.error("[enrich-msrp] Error:", e);
    return json(500, { ok: false, error: String(e?.message || e) });
  }
});
