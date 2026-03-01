/**
 * BACKFILL VIN FROM SNAPSHOTS
 *
 * Finds vehicles with missing VINs, searches their archived HTML snapshots
 * in listing_page_snapshots, and extracts VINs using regex parsing.
 * No LLM needed — pure structured extraction from cached HTML.
 *
 * Uses a single SQL join to batch-find snapshots, then parses VINs in-memory.
 *
 * POST /functions/v1/backfill-vin-from-snapshots
 * Body: {
 *   "batch_size": number,     // default 50, max 200
 *   "dry_run": boolean,       // preview without writing
 *   "platform": string,       // filter to one platform (optional)
 *   "offset": number,         // pagination offset (default 0)
 *   "decode": boolean         // also call NHTSA decode after finding VIN (default false)
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const VERSION = "backfill-vin-from-snapshots:1.1.0";

// Valid VIN characters (no I, O, Q)
const VIN_CHARS = "A-HJ-NPR-Z0-9";

/**
 * Extract VIN from HTML using multiple platform-aware strategies.
 * Returns the first valid VIN found, or null.
 */
function extractVinFromHtml(html: string, platform: string): string | null {
  if (!html || html.length < 100) return null;

  const candidates: string[] = [];

  // === STRATEGY 1: BaT Listing Details section ===
  if (platform === "bat") {
    const detailsMatch = html.match(
      /<strong>Listing Details<\/strong>\s*<ul>([\s\S]*?)<\/ul>/i
    );
    if (detailsMatch?.[1]) {
      const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
      let m: RegExpExecArray | null;
      while ((m = liRe.exec(detailsMatch[1])) !== null) {
        const text = m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        const idMatch = text.match(
          new RegExp(
            `^(?:VIN|Chassis|Serial)\\s*[:;]?\\s*([${VIN_CHARS}]{5,17})\\b`,
            "i"
          )
        );
        if (idMatch?.[1]) candidates.push(idMatch[1].toUpperCase().trim());
      }
    }

    // Chassis link pattern
    const chassisLink = html.match(
      new RegExp(
        `Chassis\\s*:?\\s*<a[^>]*>([${VIN_CHARS}]{5,17})<\\/a>`,
        "i"
      )
    );
    if (chassisLink?.[1]) candidates.push(chassisLink[1].toUpperCase().trim());
  }

  // === STRATEGY 2: Mecum __NEXT_DATA__ JSON ===
  if (platform === "mecum") {
    const nextData = html.match(
      /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
    );
    if (nextData?.[1]) {
      try {
        const nd = JSON.parse(nextData[1]);
        const post = nd?.props?.pageProps?.post || nd?.props?.pageProps?.lot;
        if (post?.vinSerial) {
          candidates.push(post.vinSerial.toUpperCase().trim());
        }
      } catch {
        /* ignore */
      }
    }
  }

  // === STRATEGY 3: JSON-LD structured data ===
  const jsonLdMatches = html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  for (const jm of jsonLdMatches) {
    try {
      const ld = JSON.parse(jm[1]);
      const vinField =
        ld.vehicleIdentificationNumber || ld.serialNumber || ld.vin;
      if (vinField && typeof vinField === "string") {
        const clean = vinField.toUpperCase().trim();
        if (clean.length >= 5 && clean.length <= 17) {
          candidates.push(clean);
        }
      }
    } catch {
      /* ignore */
    }
  }

  // === STRATEGY 4: Generic VIN label patterns ===
  const vinLabelPatterns = [
    new RegExp(
      `\\bVIN\\s*(?:#|number)?\\s*[:;=]?\\s*([${VIN_CHARS}]{11,17})\\b`,
      "gi"
    ),
    new RegExp(
      `\\bVehicle\\s+Identification\\s+Number\\s*[:;]?\\s*([${VIN_CHARS}]{11,17})\\b`,
      "gi"
    ),
    new RegExp(
      `\\bChassis\\s+(?:No\\.?\\s*)?[:;]?\\s*([${VIN_CHARS}]{5,17})\\b`,
      "gi"
    ),
    new RegExp(
      `\\bSerial\\s+(?:No\\.?\\s*|Number\\s*)?[:;]?\\s*([${VIN_CHARS}]{5,17})\\b`,
      "gi"
    ),
  ];

  for (const re of vinLabelPatterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      candidates.push(m[1].toUpperCase().trim());
    }
  }

  // === STRATEGY 5: Standalone 17-char VIN in text ===
  const textContent = html.replace(/<[^>]+>/g, " ");
  const standaloneVin = new RegExp(
    `(?:^|[\\s"'>:;,])([${VIN_CHARS}]{17})(?=[\\s"'<:;,.]|$)`,
    "g"
  );
  let sm: RegExpExecArray | null;
  while ((sm = standaloneVin.exec(textContent)) !== null) {
    const candidate = sm[1].toUpperCase().trim();
    const digitCount = (candidate.match(/\d/g) || []).length;
    const letterCount = (candidate.match(/[A-Z]/g) || []).length;
    if (digitCount >= 4 && letterCount >= 4) {
      candidates.push(candidate);
    }
  }

  // === VALIDATE ===
  // Filter out common false positives (English words that look like short VINs)
  const FALSE_POSITIVES = new Set([
    "USAGE", "SUPER", "TURBO", "PARTS", "CLEAN", "GREAT", "FRESH",
    "PRESS", "LEVER", "PANEL", "BRAKE", "START", "STEEL", "BLACK",
    "WHITE", "GREEN", "CREAM", "BEAUT", "ALERT", "CHECK", "FIXED",
    "NEWER", "UPPER", "UNDER", "WATER", "EXTRA", "WHEEL", "GLASS",
    "FRAME", "VALVE", "GAUGE", "HATCH", "TRUNK", "SEATS", "BUMPER",
    "FENDER", "CHROME", "SERIAL", "NUMBER", "MANUAL", "CUSTOM",
    "BETWEEN", "AFTER", "BEFORE", "WHERE", "THERE", "THESE", "THEIR",
    "ABOUT", "BEING", "COULD", "EVERY", "FIRST", "NEVER", "SINCE",
    "STILL", "THOSE", "UNTIL", "WHICH", "WHILE", "WOULD", "PLACE",
    "POWER", "SPEED", "STOCK", "TITLE", "TRACK", "PAINT", "PRICE",
    "LIGHT", "MATCH", "METAL", "MOUNT", "NOTED", "OFFER", "OTHER",
    "OWNER", "RIGHT", "ROUND", "SHEET", "SHOWN", "SMALL", "SOUND",
    "SPARE", "SPLIT", "STATE", "STORE", "STYLE", "THIRD", "THREE",
    "SPORT", "DRIVE", "SEDAN", "COUPE", "TRUCK",
  ]);

  // Prefer 17-char VINs first
  for (const vin of candidates) {
    if (vin.length === 17 && /^[A-HJ-NPR-Z0-9]{17}$/i.test(vin) && !/[IOQ]/i.test(vin)) {
      return vin;
    }
  }
  // Accept shorter chassis numbers (but filter false positives)
  for (const vin of candidates) {
    if (vin.length >= 5 && vin.length < 17 && /^[A-HJ-NPR-Z0-9]+$/i.test(vin)) {
      if (FALSE_POSITIVES.has(vin)) continue;
      return vin;
    }
  }

  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body =
      req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const batchSize = Math.min(Math.max(Number(body.batch_size) || 50, 1), 200);
    const dryRun = body.dry_run === true;
    const platformFilter = body.platform || null;
    const offset = Number(body.offset) || 0;
    const decode = body.decode === true;

    console.log(
      `[vin-backfill] batch=${batchSize} dry=${dryRun} platform=${platformFilter} offset=${offset} decode=${decode}`
    );

    // Use a single SQL query to find vehicles + their snapshots in one join.
    // This avoids N+1 and handles trailing-slash mismatches server-side.
    const platformWhere = platformFilter
      ? `AND s.platform = '${platformFilter.replace(/'/g, "''")}'`
      : "";

    const { data: rows, error: qErr } = await supabase.rpc(
      "backfill_vin_find_candidates",
      {
        p_batch_size: batchSize,
        p_offset: offset,
        p_platform: platformFilter || null,
      }
    );

    // If the RPC doesn't exist yet, fall back to individual queries
    if (qErr?.message?.includes("not exist") || qErr?.message?.includes("does not exist")) {
      console.log("[vin-backfill] RPC not found, using fallback query approach");
      return await fallbackApproach(supabase, { batchSize, dryRun, platformFilter, offset, decode, startTime });
    }
    if (qErr) throw new Error(`RPC query failed: ${qErr.message}`);

    if (!rows || rows.length === 0) {
      return okJson({
        success: true,
        message: "No candidates found (vehicles with missing VINs + available snapshots)",
        processed: 0,
        duration_ms: Date.now() - startTime,
      });
    }

    console.log(`[vin-backfill] Found ${rows.length} candidates with snapshots`);

    return await processRows(supabase, rows, { dryRun, decode, startTime });
  } catch (e: any) {
    console.error("[vin-backfill] Error:", e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

/**
 * Fallback: individual PostgREST queries when RPC doesn't exist.
 * Handles URL normalization (trailing slash) via .in() with both variants.
 */
async function fallbackApproach(
  supabase: any,
  opts: { batchSize: number; dryRun: boolean; platformFilter: string | null; offset: number; decode: boolean; startTime: number }
) {
  const { batchSize, dryRun, platformFilter, offset, decode, startTime } = opts;

  // Find vehicles with no VIN that have a listing URL
  let query = supabase
    .from("vehicles")
    .select("id, year, make, model, bat_auction_url, listing_url, discovery_url")
    .is("vin", null)
    .is("deleted_at", null)
    .or("bat_auction_url.not.is.null,listing_url.not.is.null,discovery_url.not.is.null")
    .order("created_at", { ascending: false })
    .range(offset, offset + batchSize - 1);

  const { data: vehicles, error: vErr } = await query;
  if (vErr) throw new Error(`Vehicle query failed: ${vErr.message}`);
  if (!vehicles || vehicles.length === 0) {
    return okJson({ success: true, message: "No candidates", processed: 0, duration_ms: Date.now() - startTime });
  }

  // Build rows by looking up snapshots per vehicle
  const rows: any[] = [];
  for (const v of vehicles) {
    const rawUrls = [v.bat_auction_url, v.listing_url, v.discovery_url].filter(Boolean) as string[];
    if (rawUrls.length === 0) continue;

    // Build URL variants (with/without trailing slash, http/https)
    const urlVariants: string[] = [];
    for (let url of rawUrls) {
      url = url.replace(/\/(contact|error\.[^/]+|feed|amp|embed|comments|trackback|page\/\d+)\/?.*$/i, "");
      const u = url.replace(/\/$/, "");
      urlVariants.push(u, u + "/");
      const https = u.replace(/^http:/, "https:");
      urlVariants.push(https, https + "/");
    }

    let snapQuery = supabase
      .from("listing_page_snapshots")
      .select("html, platform")
      .in("listing_url", [...new Set(urlVariants)])
      .eq("success", true)
      .not("html", "is", null)
      .order("fetched_at", { ascending: false })
      .limit(1);

    if (platformFilter) {
      snapQuery = snapQuery.eq("platform", platformFilter);
    }

    const { data: snaps } = await snapQuery;
    if (snaps?.[0]?.html && snaps[0].html.length > 200) {
      rows.push({
        vehicle_id: v.id,
        vehicle_year: v.year,
        vehicle_make: v.make,
        vehicle_model: v.model,
        snapshot_html: snaps[0].html,
        snapshot_platform: snaps[0].platform,
      });
    }
  }

  return await processRows(supabase, rows, { dryRun, decode, startTime, totalChecked: vehicles.length, nextOffset: offset + batchSize });
}

/**
 * Process found rows: extract VINs from HTML and update vehicles.
 */
async function processRows(
  supabase: any,
  rows: any[],
  opts: { dryRun: boolean; decode: boolean; startTime: number; totalChecked?: number; nextOffset?: number }
) {
  const { dryRun, decode, startTime } = opts;

  let found = 0;
  let noVinInHtml = 0;
  let updated = 0;
  let errors = 0;
  let duplicateVins = 0;
  const sampleResults: any[] = [];

  for (const row of rows) {
    try {
      const platform = row.snapshot_platform || "unknown";
      const vin = extractVinFromHtml(row.snapshot_html, platform);

      if (!vin) {
        noVinInHtml++;
        continue;
      }

      found++;
      const ymm = `${row.vehicle_year || "?"} ${row.vehicle_make || "?"} ${row.vehicle_model || "?"}`;

      if (dryRun) {
        if (sampleResults.length < 30) {
          sampleResults.push({
            id: row.vehicle_id,
            ymm,
            vin_found: vin,
            platform,
            status: "dry_run",
          });
        }
        continue;
      }

      // Update vehicle
      const { error: uErr } = await supabase
        .from("vehicles")
        .update({
          vin,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.vehicle_id);

      if (uErr) {
        if (uErr.message?.includes("unique") || uErr.message?.includes("duplicate")) {
          duplicateVins++;
          if (sampleResults.length < 20) {
            sampleResults.push({
              id: row.vehicle_id,
              ymm,
              vin_found: vin,
              platform,
              status: "duplicate_vin",
            });
          }
        } else {
          errors++;
          if (sampleResults.length < 10) {
            sampleResults.push({ id: row.vehicle_id, ymm, status: "error", error: uErr.message });
          }
        }
        continue;
      }

      updated++;
      if (sampleResults.length < 30) {
        sampleResults.push({
          id: row.vehicle_id,
          ymm,
          vin_found: vin,
          platform,
          status: "updated",
        });
      }

      // Optionally trigger NHTSA decode
      if (decode && vin.length === 17) {
        try {
          const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
          const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
          fetch(`${supabaseUrl}/functions/v1/decode-vin-and-update`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${serviceKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ vehicle_id: row.vehicle_id, vin }),
          }).catch(() => {});
        } catch {
          /* ignore */
        }
      }
    } catch (e: any) {
      errors++;
      if (sampleResults.length < 5) {
        sampleResults.push({ id: row.vehicle_id, status: "error", error: e?.message });
      }
    }
  }

  return okJson({
    success: true,
    version: VERSION,
    dry_run: dryRun,
    decode,
    candidates_with_snapshots: rows.length,
    vehicles_checked: opts.totalChecked ?? rows.length,
    vins_found: found,
    vins_updated: updated,
    no_vin_in_html: noVinInHtml,
    duplicate_vins: duplicateVins,
    errors,
    sample_results: sampleResults,
    duration_ms: Date.now() - startTime,
    next_offset: opts.nextOffset,
  });
}

function okJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
