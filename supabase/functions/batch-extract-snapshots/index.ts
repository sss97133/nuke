/**
 * BATCH EXTRACT SNAPSHOTS v2 — Full structured extraction (NO LLM)
 *
 * Parses archived HTML snapshots using regex/JSON/structured parsing.
 * Supports: BaT, Barrett-Jackson, Mecum, Cars & Bids, Bonhams
 *
 * POST /functions/v1/batch-extract-snapshots
 * Body: {
 *   "batch_size": number,       // default 50, max 200
 *   "platform": string,         // "bat", "bonhams", "mecum", "barrett-jackson", "carsandbids"
 *   "dry_run": boolean,
 *   "offset": number,           // for pagination (default 0)
 *   "mode": string,             // "skeleton" | "sparse" | "deep" | "force" (re-extract everything)
 *   "force": boolean            // re-extract even if already processed by this version
 * }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callTier, parseJsonResponse } from "../_shared/agentTiers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VERSION = "batch-extract-snapshots:2.0.0";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startTime = Date.now();
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const batchSize = Math.min(Math.max(Number(body.batch_size) || 50, 1), 200);
    const platform = body.platform || "bat";
    const dryRun = body.dry_run === true;
    const offset = Number(body.offset) || 0;
    const force = body.force === true || body.mode === "force";

    const mode = body.mode || "sparse";
    const useQueue = body.use_queue === true;
    console.log(`[batch-extract] v2 batch=${batchSize} platform=${platform} mode=${mode} dry=${dryRun} offset=${offset} force=${force} queue=${useQueue}`);

    const selectFields = `id, year, make, model, trim, vin, mileage, horsepower, torque, engine_type, engine_displacement, transmission, drivetrain, body_style, color, color_primary, interior_color, description, sale_price, bat_auction_url, discovery_url, listing_url, extractor_version`;

    let vehicles: any[] = [];
    let queueItems: { vehicle_id: string; snapshot_url: string }[] = [];

    if (useQueue) {
      // ============================================================
      // QUEUE MODE: Claim from pre-computed snapshot_extraction_queue
      // Much faster — no OFFSET scanning, no per-vehicle snapshot lookups
      // ============================================================
      const { data: claimed, error: claimErr } = await supabase.rpc("claim_extraction_batch", {
        p_platform: platform,
        p_batch_size: batchSize,
        p_worker_id: `w-${Date.now()}`,
      });
      if (claimErr) throw new Error(`Claim failed: ${claimErr.message}`);
      if (!claimed || claimed.length === 0) {
        return okJson({
          success: true,
          message: "No pending items in queue",
          processed: 0,
          queue_empty: true,
          duration_ms: Date.now() - startTime,
        });
      }
      queueItems = claimed;

      // Fetch vehicle data for claimed items
      const vehicleIds = claimed.map((c: any) => c.vehicle_id);
      const { data: vData, error: vErr } = await supabase
        .from("vehicles")
        .select(selectFields)
        .in("id", vehicleIds);
      if (vErr) throw new Error(`Vehicle fetch failed: ${vErr.message}`);
      vehicles = vData || [];
    } else {
      // ============================================================
      // LEGACY MODE: OFFSET-based scanning (slower for large datasets)
      // ============================================================

      // Platform-to-URL domain mapping
      const platformDomains: Record<string, string> = {
        bat: "bringatrailer",
        bonhams: "bonhams",
        mecum: "mecum",
        "barrett-jackson": "barrett-jackson",
        carsandbids: "carsandbids",
      };
      const domain = platformDomains[platform] || platform;

      // Build URL filter
      let urlFilter: string;
      if (platform === "bat") {
        urlFilter = `bat_auction_url.not.is.null,listing_url.like.*${domain}*,discovery_url.like.*${domain}*`;
      } else {
        urlFilter = `listing_url.like.*${domain}*,discovery_url.like.*${domain}*`;
      }

      // Build mode filter — what's considered "needing extraction"
      let modeFilter: string;
      if (force) {
        modeFilter = `id.not.is.null`;
      } else if (mode === "skeleton") {
        modeFilter = "year.is.null,make.is.null,model.is.null";
      } else if (mode === "sparse") {
        modeFilter = "vin.is.null,mileage.is.null,engine_type.is.null,transmission.is.null,drivetrain.is.null,color.is.null,interior_color.is.null,sale_price.is.null,body_style.is.null,description.is.null,horsepower.is.null";
      } else {
        modeFilter = "vin.is.null,mileage.is.null,horsepower.is.null,engine_type.is.null,engine_displacement.is.null,transmission.is.null,drivetrain.is.null,body_style.is.null,color.is.null,interior_color.is.null,sale_price.is.null,description.is.null";
      }

      let query = supabase
        .from("vehicles")
        .select(selectFields)
        .or(urlFilter)
        .or(modeFilter)
        .is("deleted_at", null)
        .range(offset, offset + batchSize - 1)
        .order("id");

      if (!force) {
        query = query.or(`extractor_version.is.null,extractor_version.neq.${VERSION}`);
      }

      const { data, error: vErr } = await query;
      if (vErr) throw new Error(`Vehicle query failed: ${vErr.message}`);
      vehicles = data || [];
    }

    if (vehicles.length === 0) {
      return okJson({
        success: true,
        message: "No vehicles need extraction",
        processed: 0,
        duration_ms: Date.now() - startTime,
      });
    }

    console.log(`[batch-extract] Found ${vehicles.length} vehicles to process`);

    // Build a map of vehicle_id → snapshot_url from queue items (for queue mode)
    const queueSnapshotMap = new Map<string, string>();
    for (const qi of queueItems) {
      queueSnapshotMap.set(qi.vehicle_id, qi.snapshot_url);
    }

    let extracted = 0;
    let skipped = 0;
    let noSnapshot = 0;
    let errors = 0;
    let fieldsTotal = 0;
    const sampleResults: any[] = [];

    // Helper: read HTML from Supabase Storage when inline html is null
    async function readHtmlFromStorage(storagePath: string): Promise<string | null> {
      try {
        const { data, error } = await supabase.storage
          .from("listing-snapshots")
          .download(storagePath);
        if (error || !data) return null;
        return await data.text();
      } catch {
        return null;
      }
    }

    for (const vehicle of vehicles) {
      try {
        let snapshotHtml: string | null = null;

        let snapshot: any = null; // Full snapshot record for AI fallback

        if (useQueue) {
          // Queue mode: we already know the snapshot URL
          const snapUrl = queueSnapshotMap.get(vehicle.id);
          if (snapUrl) {
            const { data: snaps } = await supabase
              .from("listing_page_snapshots")
              .select("html, html_storage_path, markdown")
              .eq("listing_url", snapUrl)
              .eq("platform", platform)
              .eq("success", true)
              .limit(1);
            snapshot = snaps?.[0] || null;
            if (snapshot?.html && snapshot.html.length > 500) {
              snapshotHtml = snapshot.html;
            } else if (snapshot?.html_storage_path) {
              snapshotHtml = await readHtmlFromStorage(snapshot.html_storage_path);
            }
          }
        } else {
          // Legacy mode: search for snapshot by URL variations
          const rawUrls = [
            vehicle.bat_auction_url,
            vehicle.listing_url,
            vehicle.discovery_url,
          ].filter(Boolean);

          const normalizedUrls = new Set<string>();
          for (let url of rawUrls) {
            url = url.replace(/\/(contact|error\.[^/]+|feed|amp|embed|comments|trackback|page\/\d+)\/?.*$/i, "");
            const u = url.replace(/\/$/, "");

            // Generate www / non-www variants
            // e.g. "https://mecum.com/..." <-> "https://www.mecum.com/..."
            const bases = [u];
            if (u.match(/^https?:\/\/www\./)) {
              // Has www — add variant without www
              bases.push(u.replace(/^(https?:\/\/)www\./, "$1"));
            } else {
              // No www — add variant with www
              bases.push(u.replace(/^(https?:\/\/)/, "$1www."));
            }

            for (const base of bases) {
              const baseSlash = base + "/";
              const https = base.replace(/^http:/, "https:");
              const http = base.replace(/^https:/, "http:");
              normalizedUrls.add(base);
              normalizedUrls.add(baseSlash);
              normalizedUrls.add(https);
              normalizedUrls.add(https + "/");
              normalizedUrls.add(http);
              normalizedUrls.add(http + "/");
              if (platform === "carsandbids") {
                normalizedUrls.add(base.toLowerCase());
                normalizedUrls.add(baseSlash.toLowerCase());
                normalizedUrls.add(https.toLowerCase());
                normalizedUrls.add((https + "/").toLowerCase());
              }
            }
          }

          // First try inline HTML, then fall back to storage
          const { data: snaps } = await supabase
            .from("listing_page_snapshots")
            .select("html, html_storage_path, markdown")
            .in("listing_url", [...normalizedUrls])
            .eq("platform", platform)
            .eq("success", true)
            .order("fetched_at", { ascending: false })
            .limit(1);

          snapshot = snaps?.[0] || null;
          if (snapshot?.html && snapshot.html.length > 500) {
            snapshotHtml = snapshot.html;
          } else if (snapshot?.html_storage_path) {
            snapshotHtml = await readHtmlFromStorage(snapshot.html_storage_path);
          }
        }

        const vehicleUrl = vehicle.listing_url || vehicle.bat_auction_url || vehicle.discovery_url || "";

        if (!snapshotHtml) {
          noSnapshot++;
          // Mark queue item as failed if in queue mode
          if (useQueue) {
            await supabase.from("snapshot_extraction_queue")
              .update({ status: "failed", completed_at: new Date().toISOString() })
              .eq("vehicle_id", vehicle.id);
          }
          continue;
        }

        // Parse based on platform — try regex first, fall back to AI
        let parsed: Record<string, any>;
        const useAI = mode === "ai";

        if (useAI) {
          // AI mode: skip regex entirely, go straight to LLM
          // Prefer markdown over raw HTML (cleaner for LLM)
          const snapshotMarkdown = snapshot?.markdown || null;
          const content = snapshotMarkdown || snapshotHtml;
          parsed = await parseWithAI(content, vehicleUrl, platform);
        } else if (platform === "bat") {
          parsed = parseBatHtml(snapshotHtml);
        } else if (platform === "bonhams") {
          parsed = parseBonhamsHtml(snapshotHtml);
        } else if (platform === "mecum") {
          parsed = parseMecumHtml(snapshotHtml);
        } else if (platform === "barrett-jackson") {
          parsed = parseBarrettJacksonHtml(snapshotHtml);
        } else if (platform === "carsandbids") {
          parsed = parseCarsAndBidsHtml(snapshotHtml);
        } else {
          // Unknown platform: try AI extraction
          const snapshotMarkdown = snapshot?.markdown || null;
          const content = snapshotMarkdown || snapshotHtml;
          parsed = await parseWithAI(content, vehicleUrl, platform);
        }

        // AI FALLBACK: If regex parser returned 0 useful fields, try AI
        if (!useAI && Object.keys(parsed).filter(k => parsed[k] != null).length === 0) {
          const snapshotMarkdown = snapshot?.markdown || null;
          const content = snapshotMarkdown || snapshotHtml;
          if (content && content.length > 500) {
            console.log(`[AI-fallback] Regex returned 0 fields for ${vehicle.id}, trying AI...`);
            parsed = await parseWithAI(content, vehicleUrl, platform);
          }
        }

        // Extract primary image URL from HTML (works for all platforms)
        if (!parsed.primary_image_url && snapshotHtml) {
          const img = extractPrimaryImage(snapshotHtml, platform);
          if (img) parsed.primary_image_url = img;
        }

        // Build update payload — only fill missing fields (unless force mode)
        const updatePayload: Record<string, any> = {};
        const fieldsUpdated: string[] = [];

        const fieldMap: Record<string, string> = {
          year: "year",
          make: "make",
          model: "model",
          trim: "trim",
          vin: "vin",
          mileage: "mileage",
          horsepower: "horsepower",
          torque: "torque",
          engine_type: "engine_type",
          engine_displacement: "engine_displacement",
          transmission: "transmission",
          drivetrain: "drivetrain",
          body_style: "body_style",
          color: "color",
          color_primary: "color_primary",
          interior_color: "interior_color",
          description: "description",
          sale_price: "sale_price",
          primary_image_url: "primary_image_url",
        };

        for (const [parsedKey, dbField] of Object.entries(fieldMap)) {
          const newVal = parsed[parsedKey];
          if (newVal === null || newVal === undefined) continue;
          if (typeof newVal === "string" && newVal.trim() === "") continue;

          const existing = vehicle[dbField];
          const existingEmpty = existing === null || existing === undefined || String(existing).trim() === "";

          if (existingEmpty) {
            updatePayload[dbField] = newVal;
            fieldsUpdated.push(dbField);
          } else if (force) {
            // In force mode, overwrite if our extraction is more specific
            // But don't overwrite good data with worse data
            if (dbField === "vin" && typeof newVal === "string" && newVal.length >= String(existing).length) {
              updatePayload[dbField] = newVal;
              fieldsUpdated.push(dbField);
            }
          } else if (dbField === "trim" && typeof existing === "string" && existing.length > 60) {
            updatePayload[dbField] = newVal;
            fieldsUpdated.push(dbField);
          } else if (dbField === "color" && typeof existing === "string" &&
            (existing.length > 60 || /\b(during|aforementioned|powered by|details include)\b/i.test(existing))) {
            updatePayload[dbField] = newVal;
            fieldsUpdated.push(dbField);
          }
        }

        if (fieldsUpdated.length === 0) {
          skipped++;
          if (!dryRun) {
            await supabase.from("vehicles").update({
              extractor_version: VERSION,
              updated_at: new Date().toISOString(),
            }).eq("id", vehicle.id);
            if (useQueue) {
              await supabase.from("snapshot_extraction_queue")
                .update({ status: "completed", completed_at: new Date().toISOString(), fields_filled: 0 })
                .eq("vehicle_id", vehicle.id);
            }
          }
          continue;
        }

        if (!dryRun) {
          updatePayload.extractor_version = VERSION;
          updatePayload.updated_at = new Date().toISOString();

          let { error: uErr } = await supabase
            .from("vehicles")
            .update(updatePayload)
            .eq("id", vehicle.id);

          // If VIN unique constraint fails, retry without VIN
          if (uErr?.message?.includes("unique constraint") && updatePayload.vin) {
            delete updatePayload.vin;
            const vinIdx = fieldsUpdated.indexOf("vin");
            if (vinIdx >= 0) fieldsUpdated.splice(vinIdx, 1);

            if (fieldsUpdated.length === 0) {
              await supabase.from("vehicles").update({
                extractor_version: VERSION,
                updated_at: new Date().toISOString(),
              }).eq("id", vehicle.id);
              skipped++;
              if (useQueue) {
                await supabase.from("snapshot_extraction_queue")
                  .update({ status: "completed", completed_at: new Date().toISOString(), fields_filled: 0 })
                  .eq("vehicle_id", vehicle.id);
              }
              continue;
            }

            const retry = await supabase
              .from("vehicles")
              .update(updatePayload)
              .eq("id", vehicle.id);
            uErr = retry.error;
          }

          if (uErr) {
            errors++;
            if (sampleResults.length < 5) {
              sampleResults.push({ id: vehicle.id, status: "error", error: uErr.message });
            }
            if (useQueue) {
              await supabase.from("snapshot_extraction_queue")
                .update({ status: "failed", completed_at: new Date().toISOString() })
                .eq("vehicle_id", vehicle.id);
            }
            continue;
          }
        }

        extracted++;
        fieldsTotal += fieldsUpdated.length;
        if (useQueue && !dryRun) {
          await supabase.from("snapshot_extraction_queue")
            .update({ status: "completed", completed_at: new Date().toISOString(), fields_filled: fieldsUpdated.length })
            .eq("vehicle_id", vehicle.id);
        }
        if (sampleResults.length < 10) {
          sampleResults.push({
            id: vehicle.id,
            ymm: `${parsed.year || vehicle.year || "?"} ${parsed.make || vehicle.make || "?"} ${parsed.model || vehicle.model || "?"}`,
            status: dryRun ? "dry_run" : "updated",
            fields: fieldsUpdated,
            parsed_vin: parsed.vin || null,
          });
        }
      } catch (e: any) {
        errors++;
        if (sampleResults.length < 5) {
          sampleResults.push({ id: vehicle.id, status: "error", error: e?.message });
        }
        if (useQueue) {
          await supabase.from("snapshot_extraction_queue")
            .update({ status: "failed", completed_at: new Date().toISOString() })
            .eq("vehicle_id", vehicle.id);
        }
      }
    }

    return okJson({
      success: true,
      version: VERSION,
      dry_run: dryRun,
      platform,
      mode,
      force,
      batch_size: batchSize,
      offset,
      vehicles_found: vehicles.length,
      extracted,
      skipped,
      no_snapshot: noSnapshot,
      errors,
      fields_filled: fieldsTotal,
      sample_results: sampleResults,
      duration_ms: Date.now() - startTime,
      next_offset: offset + batchSize,
    });
  } catch (e: any) {
    console.error("[batch-extract] Error:", e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ============================================================
// UTILITY: VIN validation
// ============================================================

function isValidVin(vin: string): boolean {
  if (!vin || vin.length < 5 || vin.length > 17) return false;
  // Reject common false positives
  if (/^[0]+$/.test(vin)) return false;
  if (/^(test|none|na|n\/a|tbd|unknown)/i.test(vin)) return false;
  // For 17-char VINs, validate character set (no I, O, Q)
  if (vin.length === 17 && !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return false;
  // For shorter chassis/serial numbers, be more permissive
  if (vin.length < 17 && !/^[A-HJ-NPR-Z0-9*\- ]{5,17}$/i.test(vin)) return false;
  return true;
}

function cleanVin(raw: string): string | null {
  const cleaned = raw.replace(/[\s\-–—]/g, "").replace(/[oO]/g, "0").trim();
  return isValidVin(cleaned) ? cleaned : null;
}

// ============================================================
// UTILITY: Year/Make/Model from title strings
// ============================================================

const MAKE_PATTERNS = [
  "Alfa Romeo", "Aston Martin", "Austin-Healey", "De Tomaso", "Land Rover", "Mercedes-Benz",
  "Rolls-Royce", "AC", "Acura", "Audi", "Austin", "BMW", "Bentley", "Buick", "Cadillac",
  "Chevrolet", "Chrysler", "Citroën", "Citroen", "Datsun", "DeLorean", "Dodge", "Ferrari", "Fiat",
  "Ford", "GMC", "Honda", "Hummer", "Hyundai", "Infiniti", "International", "Isuzu",
  "Jaguar", "Jeep", "Kia", "Lamborghini", "Lancia", "Lexus", "Lincoln", "Lotus",
  "Maserati", "Mazda", "McLaren", "Mercury", "MG", "Mini", "Mitsubishi", "Nissan",
  "Oldsmobile", "Opel", "Pagani", "Peugeot", "Plymouth", "Pontiac", "Porsche", "RAM",
  "Renault", "Rezvani", "Rivian", "Saab", "Saturn", "Shelby", "Subaru", "Suzuki", "Tesla",
  "Toyota", "Triumph", "Volkswagen", "Volvo", "Willys",
];

function extractYearMakeModel(title: string): { year?: number; make?: string; model?: string } {
  const result: { year?: number; make?: string; model?: string } = {};
  const yearMatch = title.match(/\b(19\d{2}|20[0-2]\d)\b/);
  if (yearMatch) {
    result.year = parseInt(yearMatch[1]);
    const afterYear = title.slice(title.indexOf(yearMatch[1]) + yearMatch[1].length).trim();
    if (afterYear) {
      for (const make of MAKE_PATTERNS) {
        if (afterYear.toLowerCase().startsWith(make.toLowerCase())) {
          result.make = make;
          const rest = afterYear.slice(make.length).trim();
          if (rest) result.model = rest;
          break;
        }
      }
      if (!result.make) {
        const words = afterYear.split(/\s+/);
        if (words.length >= 2) {
          result.make = words[0];
          result.model = words.slice(1).join(" ");
        } else if (words.length === 1) {
          result.make = words[0];
        }
      }
    }
  }
  return result;
}

function normalizeBodyStyle(raw: string): string | null {
  const bs = raw.trim().toLowerCase();
  const map: Record<string, string> = {
    coupe: "Coupe", coupé: "Coupe",
    convertible: "Convertible", cabriolet: "Convertible",
    roadster: "Roadster",
    sedan: "Sedan", saloon: "Sedan",
    wagon: "Wagon", estate: "Wagon",
    hatchback: "Hatchback",
    truck: "Truck", pickup: "Truck",
    suv: "SUV",
    van: "Van",
    targa: "Targa",
    speedster: "Speedster",
  };
  for (const [key, val] of Object.entries(map)) {
    if (bs.includes(key)) return val;
  }
  return null;
}

function normalizeDrivetrain(raw: string): string | null {
  if (/\b(?:4x4|4wd|four.wheel.drive)\b/i.test(raw)) return "4WD";
  if (/\bawd\b|all.wheel.drive/i.test(raw)) return "AWD";
  if (/\bfwd\b|front.wheel.drive/i.test(raw)) return "FWD";
  if (/\brwd\b|rear.wheel.drive/i.test(raw)) return "RWD";
  return null;
}

// ============================================================
// 0. UNIVERSAL AI EXTRACTOR — Haiku-powered, works on any platform
// ============================================================

const AI_EXTRACTION_SYSTEM = `You are a vehicle data extraction expert. Extract structured data from the provided listing page content.

Return ONLY a JSON object with these fields (use null for missing data):
{
  "year": number or null,
  "make": "string or null",
  "model": "string or null",
  "trim": "string or null",
  "vin": "string or null (17 chars, no I/O/Q)",
  "mileage": number or null,
  "engine_type": "string or null (e.g. '5.7L V8')",
  "engine_displacement": "string or null (e.g. '5.7L')",
  "horsepower": number or null,
  "torque": number or null,
  "transmission": "string or null (e.g. '4-Speed Manual')",
  "drivetrain": "string or null (RWD/FWD/AWD/4WD)",
  "body_style": "string or null (e.g. 'Coupe', 'Convertible')",
  "color": "string or null (exterior color)",
  "interior_color": "string or null",
  "sale_price": number or null (final hammer/sold price in USD, no commas),
  "lot_number": "string or null",
  "description": "string or null (2-4 sentence summary of the vehicle)"
}

Rules:
- Extract ONLY from the provided content. Never guess or hallucinate.
- VINs must be exactly 17 characters, alphanumeric, no I/O/Q.
- Prices should be numbers only (no $ or commas). Use the SOLD/HAMMER price, not bid or estimate.
- For mileage, convert "XXk miles" to the full number.
- If "Reserve Not Met" or "Not Sold", sale_price should be null.
- Description should summarize the vehicle, not copy the entire listing text.`;

async function parseWithAI(content: string, url: string, platform: string): Promise<Record<string, any>> {
  try {
    // Truncate content to ~15K chars for cost efficiency
    const truncated = content.length > 15000 ? content.slice(0, 15000) + "\n[truncated]" : content;

    const userMsg = `Platform: ${platform}\nURL: ${url}\n\nListing content:\n${truncated}`;

    const result = await callTier("haiku", AI_EXTRACTION_SYSTEM, userMsg, {
      maxTokens: 1024,
      temperature: 0.0,
    });

    const parsed = parseJsonResponse<Record<string, any>>(result.content);

    // Log cost for monitoring
    console.log(`[AI] ${platform} cost=$${result.costCents.toFixed(4)} tokens=${result.inputTokens}+${result.outputTokens} dur=${result.durationMs}ms`);

    // Clean up the parsed result
    const cleaned: Record<string, any> = {};
    for (const [key, val] of Object.entries(parsed)) {
      if (val === null || val === undefined || val === "null" || val === "") continue;
      if (typeof val === "string" && val.trim() === "") continue;
      cleaned[key] = val;
    }
    return cleaned;
  } catch (e) {
    console.error(`[AI] extraction failed for ${url}: ${(e as Error).message?.slice(0, 200)}`);
    return {};
  }
}

// ============================================================
// 1. BARRETT-JACKSON PARSER — Next.js RSC data extraction
// ============================================================

function parseBarrettJacksonHtml(html: string): Record<string, any> {
  const result: Record<string, any> = {};

  // Strategy 1: Full RSC data (newer snapshots ~2024+)
  // Barrett-Jackson embeds vehicle data in self.__next_f.push() calls
  const vinChunkMatch = html.match(/"year"\s*:\s*"(\d{4})"\s*,\s*"make"\s*:\s*"([^"]+)"\s*,\s*"model"\s*:\s*"([^"]+)"\s*,\s*"style"\s*:\s*"([^"]*)"/);
  if (vinChunkMatch) {
    result.year = parseInt(vinChunkMatch[1]);
    result.make = titleCase(vinChunkMatch[2]);
    result.model = titleCase(vinChunkMatch[3]);
    const style = vinChunkMatch[4];
    if (style) {
      result.trim = titleCase(style);
      const bs = normalizeBodyStyle(style);
      if (bs) result.body_style = bs;
    }
  }

  // Strategy 2: Rendered H1 tag (works on CSR shell pages too)
  // Format: <h1 class="...">1967 CHEVROLET CORVETTE </h1>
  if (!result.year || !result.make) {
    const h1Match = html.match(/<h1[^>]*class=["'][^"']*font-black[^"']*["'][^>]*>([^<]+)<\/h1>/i);
    if (h1Match?.[1]) {
      const ymm = extractYearMakeModel(h1Match[1].trim());
      if (!result.year && ymm.year) result.year = ymm.year;
      if (!result.make && ymm.make) result.make = titleCase(ymm.make);
      if (!result.model && ymm.model) result.model = titleCase(ymm.model);
    }
  }

  // Strategy 3: Title tag fallback
  if (!result.year || !result.make) {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch?.[1]) {
      const cleaned = titleMatch[1].replace(/\s*-\s*Vehicle\s*\|.*$/i, "").trim();
      const ymm = extractYearMakeModel(cleaned);
      if (!result.year && ymm.year) result.year = ymm.year;
      if (!result.make && ymm.make) result.make = titleCase(ymm.make);
      if (!result.model && ymm.model) result.model = titleCase(ymm.model);
    }
  }

  // Extract sold status from badges
  if (html.includes(">Sold<")) {
    // Vehicle was sold (useful for filtering)
  }
  // No reserve
  if (html.includes(">No reserve<") || html.includes(">No Reserve<")) {
    // No reserve auction
  }

  // VIN
  const vinMatch = html.match(/"vin"\s*:\s*"([A-HJ-NPR-Z0-9]{11,17})"/i);
  if (vinMatch?.[1]) {
    const v = cleanVin(vinMatch[1]);
    if (v) result.vin = v;
  }

  // Colors
  const extColorMatch = html.match(/"exterior_color"\s*:\s*"([^"]+)"/);
  if (extColorMatch?.[1] && extColorMatch[1].length > 0) {
    result.color = titleCase(extColorMatch[1]);
  }

  const intColorMatch = html.match(/"interior_color"\s*:\s*"([^"]+)"/);
  if (intColorMatch?.[1] && intColorMatch[1].length > 0) {
    result.interior_color = titleCase(intColorMatch[1]);
  }

  // Engine
  const engineMatch = html.match(/"engine_size"\s*:\s*"([^"]+)"/);
  if (engineMatch?.[1] && engineMatch[1].length > 0) {
    result.engine_type = engineMatch[1];
    const dispMatch = engineMatch[1].match(/([\d.]+)\s*-?\s*(?:liter|litre|l)\b/i);
    if (dispMatch) result.engine_displacement = `${dispMatch[1]}L`;
  }

  // Cylinders → supplement engine_type
  const cylMatch = html.match(/"number_of_cylinders"\s*:\s*"(\d+)"/);
  if (cylMatch?.[1]) {
    const cyl = parseInt(cylMatch[1]);
    if (result.engine_type) {
      result.engine_type = `${result.engine_type} ${cyl}-cylinder`;
    } else {
      result.engine_type = `${cyl}-cylinder`;
    }
  }

  // Transmission
  const transMatch = html.match(/"transmission_type_name"\s*:\s*"([^"]+)"/);
  if (transMatch?.[1] && transMatch[1].length > 0) {
    result.transmission = titleCase(transMatch[1]);
  }

  // Sale price (hammer price)
  const hammerMatch = html.match(/"hammerPrice"\s*:\s*"?(\d+)"?/);
  if (hammerMatch?.[1]) {
    const price = parseInt(hammerMatch[1]);
    if (price > 0) result.sale_price = price;
  }
  // Also look for "hammer_price" variant
  if (!result.sale_price) {
    const hp2 = html.match(/"hammer_price"\s*:\s*"?(\d+)"?/);
    if (hp2?.[1]) {
      const price = parseInt(hp2[1]);
      if (price > 0) result.sale_price = price;
    }
  }

  // Reserve type
  const reserveMatch = html.match(/"reserve_type_name"\s*:\s*"([^"]+)"/);
  if (reserveMatch?.[1]?.toLowerCase().includes("no reserve")) {
    // No reserve flag (could be useful for metadata later)
  }

  // Lot number (for reference)
  const lotMatch = html.match(/"lot_number"\s*:\s*"?(\d+)"?/);

  // Description from og:description or meta description
  if (!result.description) {
    const ogDesc = html.match(/<meta[^>]*(?:property=["']og:description["']|name=["']description["'])[^>]*content=["']([^"']{40,})["']/i);
    if (ogDesc?.[1]) {
      result.description = decodeHtmlEntities(ogDesc[1]).slice(0, 2000);
    }
  }

  // Fallback: og:title for year/make/model
  if (!result.year || !result.make) {
    const ogTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i) ||
      html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
    if (ogTitle?.[1]) {
      const cleaned = ogTitle[1].replace(/\s*[-|–].*$/, "").trim();
      const ymm = extractYearMakeModel(cleaned);
      if (!result.year && ymm.year) result.year = ymm.year;
      if (!result.make && ymm.make) result.make = ymm.make;
      if (!result.model && ymm.model) result.model = ymm.model;
    }
  }

  // Mileage from description text
  if (!result.mileage && result.description) {
    const miMatch = result.description.match(/([\d,]+)\s*(?:actual\s+)?miles?\b/i);
    if (miMatch) {
      const mi = parseInt(miMatch[1].replace(/,/g, ""));
      if (mi > 0 && mi < 1_000_000) result.mileage = mi;
    }
  }

  // Drivetrain from description
  if (!result.drivetrain && result.description) {
    const dt = normalizeDrivetrain(result.description);
    if (dt) result.drivetrain = dt;
  }

  return result;
}

// ============================================================
// 2. MECUM PARSER — __NEXT_DATA__ GraphQL extraction
// ============================================================

function parseMecumHtml(html: string): Record<string, any> {
  const result: Record<string, any> = {};

  // Mecum uses __NEXT_DATA__ with GraphQL-shaped data
  const nextData = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (nextData?.[1]) {
    try {
      const nd = JSON.parse(nextData[1]);

      // Navigate through GraphQL structure to find lot data
      // Multiple possible paths based on page type
      const pageProps = nd?.props?.pageProps;
      let lot: any = null;

      // Try direct lot
      if (pageProps?.lot) lot = pageProps.lot;
      if (pageProps?.post) lot = pageProps.post;

      // Try dehydrated state (Apollo/urql cache)
      if (!lot && pageProps?.dehydratedState?.queries) {
        for (const q of pageProps.dehydratedState.queries) {
          const data = q?.state?.data;
          if (data?.lot) { lot = data.lot; break; }
          if (data?.lotBy) { lot = data.lotBy; break; }
        }
      }

      // Try __APOLLO_STATE__ style
      if (!lot) {
        const apolloMatch = html.match(/__APOLLO_STATE__\s*=\s*({[\s\S]*?});\s*<\/script>/i);
        if (apolloMatch?.[1]) {
          try {
            const apollo = JSON.parse(apolloMatch[1]);
            for (const [key, val] of Object.entries(apollo)) {
              if (key.startsWith("Lot:") && typeof val === "object" && val !== null) {
                lot = val;
                break;
              }
            }
          } catch { /* ignore */ }
        }
      }

      if (lot) {
        // Title → year/make/model
        const lotTitle = lot.title || lot.name || "";
        if (lotTitle) {
          const ymm = extractYearMakeModel(lotTitle);
          if (ymm.year) result.year = ymm.year;
          if (ymm.make) result.make = ymm.make;
          if (ymm.model) result.model = ymm.model;
        }

        // VIN / Serial
        const vinRaw = lot.vinSerial || lot.vin || lot.serialNumber || "";
        if (vinRaw) {
          const v = cleanVin(vinRaw);
          if (v) result.vin = v;
        }

        // Transmission
        if (lot.transmission && lot.transmission.trim()) {
          result.transmission = lot.transmission.trim();
        }

        // Color
        if (lot.color && lot.color.trim()) {
          result.color = lot.color.trim();
        }

        // Interior
        if (lot.interior && lot.interior.trim()) {
          result.interior_color = lot.interior.trim();
        }

        // Engine from lotSeries or engine field
        if (lot.lotSeries && lot.lotSeries.trim()) {
          result.engine_type = lot.lotSeries.trim();
        }
        if (lot.engine && lot.engine.trim() && !result.engine_type) {
          result.engine_type = lot.engine.trim();
        }

        // Mileage / Odometer
        const odo = lot.odometer || lot.mileage;
        if (odo) {
          const mi = parseInt(String(odo).replace(/[^0-9]/g, ""));
          if (mi > 0 && mi < 1_000_000) result.mileage = mi;
        }

        // Sale price (hammer price)
        const hammer = lot.hammerPrice || lot.salePrice || lot.soldPrice;
        if (hammer) {
          const price = parseInt(String(hammer).replace(/[^0-9]/g, ""));
          if (price > 0) result.sale_price = price;
        }

        // Low/High estimates (take midpoint as supplementary info)
        const low = lot.lowEstimate ? parseInt(String(lot.lowEstimate).replace(/[^0-9]/g, "")) : 0;
        const high = lot.highEstimate ? parseInt(String(lot.highEstimate).replace(/[^0-9]/g, "")) : 0;

        // Description
        const content = lot.content || lot.description || lot.excerpt || "";
        if (content) {
          const desc = content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
          if (desc.length > 40) result.description = desc.slice(0, 2000);
        }

        // HP from description or title
        if (result.description) {
          const hpMatch = result.description.match(/(\d{2,4})\s*(?:hp|bhp|horsepower)/i);
          if (hpMatch) result.horsepower = parseInt(hpMatch[1]);
        }

        // Engine displacement from description or engine type
        const engText = result.engine_type || result.description || "";
        if (engText) {
          const dispMatch = engText.match(/([\d.]+)\s*-?\s*(?:liter|litre|l)\b/i);
          if (dispMatch) result.engine_displacement = `${dispMatch[1]}L`;
          const ciMatch = engText.match(/(\d{2,3})(?:ci|cubic[- ]?inch)/i);
          if (ciMatch && !result.engine_displacement) result.engine_displacement = `${ciMatch[1]}ci`;
          const ccMatch = engText.match(/(\d{3,5})\s*cc/i);
          if (ccMatch && !result.engine_displacement) result.engine_displacement = `${ccMatch[1]}cc`;
        }

        // Drivetrain from description
        if (result.description) {
          const dt = normalizeDrivetrain(result.description);
          if (dt) result.drivetrain = dt;
        }

        // Body style from title or description
        const titleAndDesc = `${lotTitle} ${result.description || ""}`;
        const bs = normalizeBodyStyle(titleAndDesc);
        if (bs) result.body_style = bs;
      }
    } catch (e) {
      console.warn("[mecum-parse] JSON parse error:", e);
    }
  }

  // Fallback: regex extraction from raw HTML if __NEXT_DATA__ parse failed
  if (!result.year) {
    const ogTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (ogTitle?.[1]) {
      const cleaned = ogTitle[1].replace(/\s*\|.*$/, "").trim();
      const ymm = extractYearMakeModel(cleaned);
      if (ymm.year) result.year = ymm.year;
      if (ymm.make) result.make = ymm.make;
      if (ymm.model) result.model = ymm.model;
    }
  }

  // Fallback: look for VIN in raw HTML
  if (!result.vin) {
    const vinMatch = html.match(/\bVIN\s*[:;]?\s*([A-HJ-NPR-Z0-9]{11,17})\b/i);
    if (vinMatch?.[1]) {
      const v = cleanVin(vinMatch[1]);
      if (v) result.vin = v;
    }
  }

  // Hammer price from raw JSON in HTML
  if (!result.sale_price) {
    const hpMatch = html.match(/"hammerPrice"\s*:\s*"(\d+)"/);
    if (hpMatch?.[1]) {
      const price = parseInt(hpMatch[1]);
      if (price > 0) result.sale_price = price;
    }
  }

  return result;
}

// ============================================================
// 3. CARS & BIDS PARSER — Clean dt/dd structured extraction
// ============================================================

function parseCarsAndBidsHtml(html: string): Record<string, any> {
  const result: Record<string, any> = {};

  // Title: <h1>YYYY Make Model</h1>
  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (h1Match?.[1]) {
    const cleaned = h1Match[1].trim();
    const ymm = extractYearMakeModel(cleaned);
    if (ymm.year) result.year = ymm.year;
    if (ymm.make) result.make = ymm.make;
    if (ymm.model) result.model = ymm.model;
  }

  // Subtitle / trim: <h2>descriptor text</h2>
  const h2Match = html.match(/<h2[^>]*>\s*([^<]+?)\s*<\/h2>/i);
  if (h2Match?.[1]) {
    const sub = h2Match[1].trim();
    if (sub.length > 5 && sub.length < 200 && !sub.includes("Cars & Bids")) {
      result.trim = sub;
    }
  }

  // Quick facts: <dt>Label</dt><dd>Value</dd> pairs
  // Note: the quick-facts div may contain nested divs, so we use a broader match
  const quickFacts = html.match(/<div[^>]*class=["'][^"']*quick-facts[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<div[^>]*class=["']detail/i) ||
    html.match(/<div[^>]*class=["'][^"']*quick-facts[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  if (quickFacts?.[1]) {
    const facts = parseQuickFacts(quickFacts[1]);

    // Make/Model from quick facts (more reliable than h1)
    // Clean "Save" button text that leaks into dd values
    if (facts["Make"]) result.make = facts["Make"].replace(/\s*Save\s*$/, "").trim();
    if (facts["Model"]) result.model = facts["Model"].replace(/\s*Save\s*$/, "").trim();

    // VIN
    if (facts["VIN"]) {
      const v = cleanVin(facts["VIN"]);
      if (v) result.vin = v;
    }

    // Mileage: "3,600 Miles Shown - TMU" or "25,000 Miles"
    if (facts["Mileage"]) {
      const miMatch = facts["Mileage"].match(/([\d,]+)\s*(?:miles?)/i);
      if (miMatch) {
        const mi = parseInt(miMatch[1].replace(/,/g, ""));
        if (mi > 0 && mi < 1_000_000) result.mileage = mi;
      }
    }

    // Engine: "2.4L Turbocharged I4"
    if (facts["Engine"]) {
      result.engine_type = facts["Engine"];
      const dispMatch = facts["Engine"].match(/([\d.]+)\s*[Ll]\b/);
      if (dispMatch) result.engine_displacement = `${dispMatch[1]}L`;
      const hpMatch = facts["Engine"].match(/(\d{2,4})\s*(?:hp|bhp)/i);
      if (hpMatch) result.horsepower = parseInt(hpMatch[1]);
    }

    // Drivetrain: "Rear-wheel drive"
    if (facts["Drivetrain"]) {
      const dt = normalizeDrivetrain(facts["Drivetrain"]);
      if (dt) result.drivetrain = dt;
    }

    // Transmission: "Manual (5-Speed)"
    if (facts["Transmission"]) {
      result.transmission = facts["Transmission"];
    }

    // Body Style: "Coupe"
    if (facts["Body Style"]) {
      const bs = normalizeBodyStyle(facts["Body Style"]);
      if (bs) result.body_style = bs;
      else result.body_style = facts["Body Style"];
    }

    // Colors
    if (facts["Exterior Color"]) result.color = facts["Exterior Color"];
    if (facts["Interior Color"]) result.interior_color = facts["Interior Color"];
  }

  // Description from detail sections
  const descSections = [
    html.match(/<div[^>]*class=["'][^"']*detail-highlights[^"']*["'][^>]*>[\s\S]*?<div[^>]*class=["'][^"']*detail-body["'][^>]*>([\s\S]*?)<\/div>/i),
    html.match(/<div[^>]*class=["'][^"']*detail-section\b[^"']*["'][^>]*>[\s\S]*?<div[^>]*class=["'][^"']*detail-body["'][^>]*>([\s\S]*?)<\/div>/i),
  ];
  for (const dm of descSections) {
    if (dm?.[1] && !result.description) {
      const text = dm[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (text.length > 40) result.description = text.slice(0, 2000);
    }
  }

  // Sale price: multiple patterns
  // Pattern 1: "Sold for $XX,XXX"
  const soldMatch = html.match(/Sold\s+(?:for\s+)?\$([\d,]+)/i);
  if (soldMatch) {
    result.sale_price = parseInt(soldMatch[1].replace(/,/g, ""));
  }
  // Pattern 2: bid-value span (C&B specific) — only if auction ended as "Sold"
  if (!result.sale_price) {
    const bidValue = html.match(/class=["']bid-value["'][^>]*>\$([\d,]+)/i);
    const isSold = html.includes("auction-result-sold") || html.includes("status-sold") ||
      /class=["'][^"']*ended[^"']*["'][^>]*>.*?Sold/is.test(html);
    if (bidValue && isSold) {
      result.sale_price = parseInt(bidValue[1].replace(/,/g, ""));
    }
  }
  // Pattern 3: "Final Bid: $XX,XXX" (only if sold)
  if (!result.sale_price) {
    const finalBid = html.match(/Final\s+Bid\s*:?\s*\$([\d,]+)/i);
    if (finalBid && !html.includes("Reserve Not Met")) {
      result.sale_price = parseInt(finalBid[1].replace(/,/g, ""));
    }
  }

  // HP from description
  if (!result.horsepower && result.description) {
    const hpMatch = result.description.match(/(\d{2,4})\s*-?\s*(?:hp|bhp|horsepower)/i);
    if (hpMatch) result.horsepower = parseInt(hpMatch[1]);
  }

  // Torque from description
  if (!result.torque && result.description) {
    const tqMatch = result.description.match(/(\d{2,4})\s*(?:lb[- ]?ft|pound[- ]?feet)/i);
    if (tqMatch) result.torque = parseInt(tqMatch[1]);
  }

  return result;
}

function parseQuickFacts(html: string): Record<string, string> {
  const facts: Record<string, string> = {};
  // Match <dt>Label</dt><dd ...>Value</dd> pairs
  const dtDdRe = /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi;
  let m: RegExpExecArray | null;
  while ((m = dtDdRe.exec(html)) !== null) {
    const label = m[1].replace(/<[^>]+>/g, "").trim();
    let value = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    // Strip "Save" / "Follow" button text that leaks through
    value = value.replace(/\s*(Save|Follow|Contact)\s*$/i, "").trim();
    if (label && value) {
      facts[label] = value;
    }
  }
  return facts;
}

// ============================================================
// 4. BRING A TRAILER PARSER — Enhanced with better VIN extraction
// ============================================================

function parseBatHtml(html: string): Record<string, any> {
  const result: Record<string, any> = {};

  // --- Title parsing ---
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch?.[1]) {
    const title = titleMatch[1].trim();

    // Sale price from title: "sold for $33,250 on..."
    const priceInTitle = title.match(/sold for \$([\d,]+)/i);
    if (priceInTitle) {
      result.sale_price = parseInt(priceInTitle[1].replace(/,/g, ""));
    }

    // Year, make, model from "YYYY Make Model for sale on BaT..."
    const mainPart = title.split(/\s+for sale on BaT/i)[0] || "";
    const ymm = extractYearMakeModel(mainPart);
    if (ymm.year) result.year = ymm.year;
    if (ymm.make) result.make = ymm.make;
    if (ymm.model) result.model = ymm.model;
  }

  // --- Listing Details section (the richest structured data) ---
  const detailsMatch = html.match(/<strong>Listing Details<\/strong>\s*<ul>([\s\S]*?)<\/ul>/i);
  if (detailsMatch?.[1]) {
    const items: string[] = [];
    const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let m: RegExpExecArray | null;
    while ((m = liRe.exec(detailsMatch[1])) !== null) {
      const text = m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (text) items.push(text);
    }

    for (const item of items) {
      // VIN / Chassis / Serial / Body Number
      if (/^(?:chassis|vin|serial|body\s*(?:number|#|no))/i.test(item)) {
        const vinVal = item.replace(/^(?:chassis|vin|serial|body\s*(?:number|#|no))\s*[:;#]?\s*/i, "").trim();
        const v = cleanVin(vinVal);
        if (v) result.vin = v;
      }

      // Mileage
      if (/\bmiles?\b/i.test(item) && !result.mileage) {
        const miMatch = item.match(/([\d,.]+)\s*k?\s*miles?/i);
        if (miMatch) {
          let mi = miMatch[1].replace(/,/g, "");
          if (/k\s*miles?/i.test(item)) {
            mi = String(parseFloat(mi) * 1000);
          }
          const parsed = parseInt(mi);
          if (parsed > 0 && parsed < 1_000_000) result.mileage = parsed;
        }
      }

      // Engine
      if (/(?:engine|liter|litre|cubic|inline|flat|v\d|cylinder|turbo|supercharg|twin.?cam|dohc|sohc|hemi|\d+ci\b)/i.test(item)
        && !/(transmission|gearbox|speed)/i.test(item)
        && !result.engine_type) {
        result.engine_type = item;
        const dispMatch = item.match(/([\d.]+)\s*-?\s*(?:liter|litre|l\b)/i);
        if (dispMatch) result.engine_displacement = `${dispMatch[1]}L`;
        const ccMatch = item.match(/(\d{3,5})\s*cc/i);
        if (ccMatch) result.engine_displacement = `${ccMatch[1]}cc`;
        const ciMatch = item.match(/(\d{2,3})(?:ci|cubic[- ]?inch)/i);
        if (ciMatch && !result.engine_displacement) result.engine_displacement = `${ciMatch[1]}ci`;
        const hpMatch = item.match(/(\d{2,4})\s*(?:hp|horsepower|bhp)/i);
        if (hpMatch) result.horsepower = parseInt(hpMatch[1]);
      }

      // Horsepower standalone
      if (/(\d{2,4})\s*(?:hp|horsepower|bhp)\b/i.test(item) && !result.horsepower) {
        const hpMatch = item.match(/(\d{2,4})\s*(?:hp|horsepower|bhp)/i);
        if (hpMatch) result.horsepower = parseInt(hpMatch[1]);
      }

      // Torque
      if (/(\d{2,4})\s*(?:lb[- ]?ft|pound[- ]?feet)/i.test(item) && !result.torque) {
        const tqMatch = item.match(/(\d{2,4})\s*(?:lb[- ]?ft|pound[- ]?feet)/i);
        if (tqMatch) result.torque = parseInt(tqMatch[1]);
      }

      // Transmission
      if (/(?:transmission|gearbox|speed\s+(?:manual|automatic|sequential)|(?:manual|auto)\s+transmission|pdk|tiptronic|dsg|cvt|dct)/i.test(item)
        && !result.transmission) {
        result.transmission = item;
      }

      // Drivetrain
      if (/\b(?:4x4|4wd|awd|fwd|rwd|four.wheel.drive|all.wheel.drive|front.wheel.drive|rear.wheel.drive|transfer case)\b/i.test(item)
        && !result.drivetrain) {
        result.drivetrain = normalizeDrivetrain(item) || undefined;
      }

      // Body style
      if (/\b(?:coupe|convertible|roadster|sedan|wagon|hatchback|truck|suv|van|targa|speedster|cabriolet|pickup|estate)\b/i.test(item)
        && !result.body_style && !/(?:engine|transmission|gearbox)/i.test(item)) {
        const bs = normalizeBodyStyle(item);
        if (bs) result.body_style = bs;
      }

      // Color / Paint
      if (/\b(?:paint|repaint|refinish|exterior|color)\b/i.test(item) && !result.color) {
        const colorClean = item
          .replace(/\b(?:repainted|refinished|in|over|original|factory|oem)\b/gi, "")
          .replace(/\b(?:paint|exterior|color|finish)\b/gi, "")
          .trim();
        if (colorClean.length > 1 && colorClean.length < 50) result.color = colorClean;
      }

      // Interior / Upholstery
      if (/\b(?:upholstery|interior|leather|vinyl|cloth|alcantara|seats)\b/i.test(item) && !result.interior_color) {
        const intClean = item
          .replace(/\b(?:original|factory|oem|with|and)\b/gi, "")
          .replace(/\b(?:upholstery|interior)\b/gi, "")
          .trim();
        if (intClean.length > 1 && intClean.length < 60) result.interior_color = intClean;
      }
    }
  }

  // --- VIN from Chassis link (very common BaT pattern) ---
  if (!result.vin) {
    const chassisLink = html.match(/Chassis\s*:?\s*<a[^>]*>([A-HJ-NPR-Z0-9*\-\s]{5,20})<\/a>/i);
    if (chassisLink?.[1]) {
      const v = cleanVin(chassisLink[1]);
      if (v) result.vin = v;
    }
  }

  // --- VIN from "Chassis: XXXXX" in listing details (no link) ---
  if (!result.vin) {
    const chassisText = html.match(/(?:Chassis|Serial|Body\s*(?:Number|No|#))\s*[:;]?\s*([A-HJ-NPR-Z0-9*\-\s]{5,20})\b/i);
    if (chassisText?.[1]) {
      const v = cleanVin(chassisText[1]);
      if (v) result.vin = v;
    }
  }

  // --- VIN standalone 17-char in body text ---
  if (!result.vin) {
    const vinStandalone = html.match(/\bVIN\s*[:;]?\s*([A-HJ-NPR-Z0-9]{11,17})\b/i);
    if (vinStandalone?.[1]) {
      const v = cleanVin(vinStandalone[1]);
      if (v) result.vin = v;
    }
  }

  // --- VIN from "identification number" text (like the Willys example: "assigned identification number NCS103610") ---
  if (!result.vin) {
    const idNumMatch = html.match(/identification\s+number\s+([A-HJ-NPR-Z0-9]{5,17})\b/i);
    if (idNumMatch?.[1]) {
      const v = cleanVin(idNumMatch[1]);
      if (v) result.vin = v;
    }
  }

  // --- Post excerpt for description ---
  if (!result.description) {
    const excerptMatch =
      html.match(/<div[^>]*class=["'][^"']*post-excerpt[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
      html.match(/<div[^>]*class=["'][^"']*post-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    if (excerptMatch?.[1]) {
      const text = excerptMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (text.length > 40 && !text.includes("for sale on BaT")) {
        result.description = text.slice(0, 2000);
      }
    }
  }

  // --- Sale price from Sold text ---
  if (!result.sale_price) {
    const soldMatch = html.match(/Sold\s+(?:by\s+\S+\s+)?(?:to\s+\S+\s+)?for\s+(?:USD\s+)?\$([\d,]+)/i);
    if (soldMatch) {
      result.sale_price = parseInt(soldMatch[1].replace(/,/g, ""));
    }
  }

  // --- Also check "Bid to $XX,XXX" for ended-but-not-sold auctions ---
  if (!result.sale_price) {
    const bidTo = html.match(/Bid\s+to\s+\$([\d,]+)/i);
    // Don't set as sale_price since it wasn't sold — BaT shows "Bid to" for reserve-not-met
  }

  // --- Body style from title if not found ---
  if (!result.body_style && titleMatch?.[1]) {
    const bs = normalizeBodyStyle(titleMatch[1]);
    if (bs) result.body_style = bs;
  }

  // --- Drivetrain from title if not found ---
  if (!result.drivetrain && titleMatch?.[1]) {
    const dt = normalizeDrivetrain(titleMatch[1]);
    if (dt) result.drivetrain = dt;
  }

  // --- HP from description if not found ---
  if (!result.horsepower && result.description) {
    const hpMatch = result.description.match(/(\d{2,4})\s*-?\s*(?:hp|bhp|horsepower)/i);
    if (hpMatch) result.horsepower = parseInt(hpMatch[1]);
  }

  return result;
}

// ============================================================
// 5. BONHAMS PARSER — JSON-LD + deep regex
// ============================================================

function parseBonhamsHtml(html: string): Record<string, any> {
  const result: Record<string, any> = {};

  // JSON-LD (primary source)
  const jsonLdMatch = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (jsonLdMatch?.[1]) {
    try {
      const ld = JSON.parse(jsonLdMatch[1]);
      if (ld.name) {
        const ymm = extractYearMakeModel(ld.name);
        if (ymm.year) result.year = ymm.year;
        if (ymm.make) result.make = ymm.make;
        if (ymm.model) result.model = ymm.model;
      }
      if (ld.description) result.description = ld.description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 2000);
      if (ld.offers?.price) result.sale_price = parseInt(String(ld.offers.price).replace(/[^0-9]/g, ""));
      if (ld.offers?.priceCurrency) { /* could track currency */ }
    } catch { /* ignore */ }
  }

  // Title fallback
  if (!result.year) {
    const ogTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (ogTitle?.[1]) {
      const ymm = extractYearMakeModel(ogTitle[1]);
      if (ymm.year) result.year = ymm.year;
      if (ymm.make) result.make = ymm.make;
      if (ymm.model) result.model = ymm.model;
    }
  }

  // VIN
  const vinMatch = html.match(/\bVIN\s*[:;]?\s*([A-HJ-NPR-Z0-9]{11,17})\b/i);
  if (vinMatch?.[1]) {
    const v = cleanVin(vinMatch[1]);
    if (v) result.vin = v;
  }

  // Chassis number (very common for Bonhams — older/European cars)
  if (!result.vin) {
    const chassisMatch = html.match(/\bChassis\s+(?:No\.?\s*)?[:;]?\s*([A-HJ-NPR-Z0-9*\-\s]{5,20})\b/i);
    if (chassisMatch?.[1]) {
      const v = cleanVin(chassisMatch[1]);
      if (v) result.vin = v;
    }
  }

  // Engine number as supplementary (not VIN, but useful)
  if (!result.vin) {
    const engineNoMatch = html.match(/\bEngine\s+(?:No\.?\s*)?[:;]?\s*([A-Z0-9\-]{5,15})\b/i);
    // Don't use engine number as VIN
  }

  // ── Sale price fallback: "Sold for" text (common in Bonhams SSR pages) ──
  if (!result.sale_price) {
    // Pattern 1: "Sold for US$35,000 inc. premium" or "Sold for £12,000"
    const soldForMatch = html.match(/Sold\s+for\s+(?:US)?\s*([£€$CHF]*)\s*([\d,]+)/i);
    if (soldForMatch?.[2]) {
      const price = parseInt(soldForMatch[2].replace(/,/g, ""));
      if (price > 0) result.sale_price = price;
    }
  }
  if (!result.sale_price) {
    // Pattern 2: hammerPrice in JSON (some pages have this in inline scripts)
    const hammerMatch = html.match(/"hammerPrice"\s*:\s*"?(\d+)"?/);
    if (hammerMatch?.[1]) {
      const price = parseInt(hammerMatch[1]);
      if (price > 0) result.sale_price = price;
    }
  }
  if (!result.sale_price) {
    // Pattern 3: "hammer_price" variant
    const hp2 = html.match(/"hammer_price"\s*:\s*"?(\d+)"?/);
    if (hp2?.[1]) {
      const price = parseInt(hp2[1]);
      if (price > 0) result.sale_price = price;
    }
  }
  if (!result.sale_price) {
    // Pattern 4: Bonhams auction result JSON: "salePrice" or "soldPrice"
    const spMatch = html.match(/"(?:salePrice|soldPrice)"\s*:\s*"?(\d+)"?/);
    if (spMatch?.[1]) {
      const price = parseInt(spMatch[1]);
      if (price > 0) result.sale_price = price;
    }
  }

  // Engine from description
  if (result.description) {
    if (!result.engine_displacement) {
      const engMatch = result.description.match(/([\d.]+)\s*-?\s*(?:liter|litre|l)\b/i);
      if (engMatch) result.engine_displacement = `${engMatch[1]}L`;
    }
    if (!result.engine_displacement) {
      const ccMatch = result.description.match(/(\d{3,5})\s*cc/i);
      if (ccMatch) result.engine_displacement = `${ccMatch[1]}cc`;
    }
    if (!result.horsepower) {
      const hpMatch = result.description.match(/(\d{2,4})\s*(?:hp|bhp|horsepower)/i);
      if (hpMatch) result.horsepower = parseInt(hpMatch[1]);
    }
    if (!result.mileage) {
      const miMatch = result.description.match(/([\d,]+)\s*(?:miles?|kilometers?|km)\b/i);
      if (miMatch) {
        let mi = parseInt(miMatch[1].replace(/,/g, ""));
        if (/kilometers?|km/i.test(miMatch[0])) mi = Math.round(mi * 0.621371);
        if (mi > 0 && mi < 1_000_000) result.mileage = mi;
      }
    }
    if (!result.transmission) {
      if (/\bmanual\b/i.test(result.description) && /\b(?:speed|gear)\b/i.test(result.description)) {
        const tmMatch = result.description.match(/(\d)-speed\s+manual/i);
        if (tmMatch) result.transmission = `${tmMatch[1]}-speed Manual`;
      } else if (/\bautomatic\b/i.test(result.description)) {
        result.transmission = "Automatic";
      }
    }
    if (!result.drivetrain) {
      const dt = normalizeDrivetrain(result.description);
      if (dt) result.drivetrain = dt;
    }
    if (!result.body_style) {
      const bs = normalizeBodyStyle(result.description);
      if (bs) result.body_style = bs;
    }
  }

  return result;
}

/**
 * Extract primary image URL from HTML via og:image, JSON-LD image, or gallery patterns.
 * Works across all platforms.
 */
function extractPrimaryImage(html: string, platform: string): string | null {
  // 1. og:image meta tag (universal, highest priority)
  const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (ogImage?.[1]) {
    const url = ogImage[1].replace(/&amp;/g, '&');
    if (url.startsWith('http') && !url.includes('logo') && !url.includes('favicon')) return url;
  }

  // 2. JSON-LD image
  const ldMatch = html.match(/"image"\s*:\s*"(https?:\/\/[^"]+)"/);
  if (ldMatch?.[1]) {
    const url = ldMatch[1].replace(/\\\//g, '/');
    if (!url.includes('logo') && !url.includes('favicon')) return url;
  }

  // 3. Platform-specific gallery image patterns
  if (platform === 'bat') {
    const batImg = html.match(/https:\/\/bringatrailer\.com\/wp-content\/uploads\/\d{4}\/\d{2}\/[^"'\s]+\.(?:jpg|jpeg|png|webp)/i);
    if (batImg?.[0]) return batImg[0];
  } else if (platform === 'mecum') {
    const mecumImg = html.match(/https:\/\/(?:www\.)?mecum\.com\/[^"'\s]*\/(?:images?|photos?|gallery)\/[^"'\s]+\.(?:jpg|jpeg|png|webp)/i);
    if (mecumImg?.[0]) return mecumImg[0];
  } else if (platform === 'bonhams') {
    const bonImg = html.match(/https:\/\/[^"'\s]*bonhams[^"'\s]*\.(?:jpg|jpeg|png|webp)/i);
    if (bonImg?.[0] && !bonImg[0].includes('logo')) return bonImg[0];
  } else if (platform === 'barrett-jackson') {
    const bjImg = html.match(/https:\/\/(?:www\.)?barrett-jackson\.com\/[^"'\s]+\.(?:jpg|jpeg|png|webp)/i);
    if (bjImg?.[0] && !bjImg[0].includes('logo')) return bjImg[0];
  }

  return null;
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function titleCase(str: string): string {
  if (!str) return str;
  // If all-caps, title case it. Otherwise leave as-is.
  if (str === str.toUpperCase() && str.length > 3) {
    return str.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return str;
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function okJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
