/**
 * PROCESS ORPHAN SNAPSHOTS — Create/update vehicles from unmatched snapshots
 *
 * Starts from listing_page_snapshots, finds ones without matching vehicle records,
 * parses HTML structurally, and creates or links vehicle records.
 *
 * POST /functions/v1/process-orphan-snapshots
 * Body: {
 *   "batch_size": number,       // default 50, max 200
 *   "platform": string,         // "bat" (default), "bonhams", "mecum", "barrett-jackson"
 *   "dry_run": boolean,
 *   "offset": number
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VERSION = "orphan-snapshot:1.0.0";

serve(async (req) => {
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

    console.log(`[orphan-snap] batch=${batchSize} platform=${platform} dry=${dryRun} offset=${offset}`);

    // Step 1: Get snapshots that haven't been processed yet
    // We track processed snapshots by marking them in a separate column or by checking vehicle existence
    const { data: snapshots, error: sErr } = await supabase
      .from("listing_page_snapshots")
      .select("id, listing_url, fetched_at")
      .eq("platform", platform)
      .eq("success", true)
      .not("html", "is", null)
      .is("vehicle_id", null) // not yet linked to a vehicle
      .order("fetched_at", { ascending: false })
      .range(offset, offset + batchSize - 1);

    if (sErr) {
      // If vehicle_id column doesn't exist, try without that filter
      if (sErr.message?.includes("vehicle_id")) {
        return await processWithoutVehicleId(supabase, { batchSize, platform, dryRun, offset, startTime });
      }
      throw new Error(`Snapshot query failed: ${sErr.message}`);
    }

    if (!snapshots || snapshots.length === 0) {
      return okJson({
        success: true,
        message: "No unprocessed snapshots found",
        processed: 0,
        duration_ms: Date.now() - startTime,
      });
    }

    return await processSnapshots(supabase, snapshots, { platform, dryRun, offset, batchSize, startTime });
  } catch (e: any) {
    console.error("[orphan-snap] Error:", e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function processWithoutVehicleId(
  supabase: any,
  opts: { batchSize: number; platform: string; dryRun: boolean; offset: number; startTime: number }
) {
  // Fallback: get snapshots and check for matching vehicles manually
  const { data: snapshots, error: sErr } = await supabase
    .from("listing_page_snapshots")
    .select("id, listing_url, fetched_at")
    .eq("platform", opts.platform)
    .eq("success", true)
    .not("html", "is", null)
    .order("id")
    .range(opts.offset, opts.offset + opts.batchSize - 1);

  if (sErr) throw new Error(`Snapshot query failed: ${sErr.message}`);
  if (!snapshots?.length) {
    return okJson({ success: true, message: "No snapshots at this offset", processed: 0, duration_ms: Date.now() - opts.startTime });
  }

  return await processSnapshots(supabase, snapshots, opts);
}

async function processSnapshots(
  supabase: any,
  snapshots: any[],
  opts: { platform: string; dryRun: boolean; offset: number; batchSize: number; startTime: number }
) {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let alreadyLinked = 0;
  let errors = 0;
  let fieldsTotal = 0;
  const sampleResults: any[] = [];

  // Deduplicate by URL (snapshots table may have multiple entries per URL)
  const seenUrls = new Set<string>();

  for (const snapshot of snapshots) {
    const baseUrl = normalizeUrl(snapshot.listing_url);
    if (seenUrls.has(baseUrl)) {
      skipped++;
      continue;
    }
    seenUrls.add(baseUrl);

    try {
      // Check if a vehicle already exists for this URL
      const urlVariants = getUrlVariants(snapshot.listing_url);

      let existingVehicle: any = null;
      for (const url of urlVariants) {
        const { data: found } = await supabase
          .from("vehicles")
          .select("id, year, make, model, trim, vin, mileage, horsepower, torque, engine_type, engine_displacement, transmission, drivetrain, body_style, color, interior_color, description, sale_price, extractor_version")
          .or(`bat_auction_url.eq.${url},listing_url.eq.${url},discovery_url.eq.${url}`)
          .limit(1)
          .maybeSingle();

        if (found) {
          existingVehicle = found;
          break;
        }
      }

      // Fetch the HTML
      const { data: snapData } = await supabase
        .from("listing_page_snapshots")
        .select("html")
        .eq("id", snapshot.id)
        .single();

      if (!snapData?.html || snapData.html.length < 500) {
        skipped++;
        continue;
      }

      // Parse the HTML
      const parsed = opts.platform === "bat" ? parseBatHtml(snapData.html) : parseGenericHtml(snapData.html);

      if (!parsed.year && !parsed.make && !parsed.model && !parsed.description) {
        skipped++;
        continue;
      }

      if (existingVehicle) {
        // Vehicle exists — update missing fields
        if (existingVehicle.extractor_version === VERSION) {
          alreadyLinked++;
          continue;
        }

        const updatePayload: Record<string, any> = {};
        const fieldsUpdated: string[] = [];

        for (const [key, val] of Object.entries(parsed)) {
          if (val === null || val === undefined) continue;
          if (typeof val === "string" && val.trim() === "") continue;
          const existing = existingVehicle[key];
          if (existing === null || existing === undefined || String(existing).trim() === "") {
            updatePayload[key] = val;
            fieldsUpdated.push(key);
          }
        }

        if (!opts.dryRun) {
          updatePayload.extractor_version = VERSION;
          updatePayload.updated_at = new Date().toISOString();

          let { error: uErr } = await supabase
            .from("vehicles")
            .update(updatePayload)
            .eq("id", existingVehicle.id);

          // Handle VIN constraint
          if (uErr?.message?.includes("unique constraint") && updatePayload.vin) {
            delete updatePayload.vin;
            const idx = fieldsUpdated.indexOf("vin");
            if (idx >= 0) fieldsUpdated.splice(idx, 1);

            const retry = await supabase.from("vehicles").update(updatePayload).eq("id", existingVehicle.id);
            uErr = retry.error;
          }

          if (uErr) {
            errors++;
            continue;
          }
        }

        updated++;
        fieldsTotal += fieldsUpdated.length;
        if (sampleResults.length < 10) {
          sampleResults.push({
            action: "updated",
            url: snapshot.listing_url.slice(0, 80),
            ymm: `${parsed.year || existingVehicle.year || "?"} ${parsed.make || existingVehicle.make || "?"} ${parsed.model || existingVehicle.model || "?"}`,
            fields: fieldsUpdated,
          });
        }
      } else {
        // No vehicle exists — create one
        if (!opts.dryRun) {
          const newVehicle: Record<string, any> = {
            ...parsed,
            bat_auction_url: opts.platform === "bat" ? normalizeUrl(snapshot.listing_url) : null,
            listing_url: snapshot.listing_url,
            source: "User Submission",
            extractor_version: VERSION,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };

          // Remove null fields
          for (const [k, v] of Object.entries(newVehicle)) {
            if (v === null || v === undefined) delete newVehicle[k];
          }

          let { error: iErr } = await supabase
            .from("vehicles")
            .insert(newVehicle);

          // Handle VIN constraint
          if (iErr?.message?.includes("unique constraint") && newVehicle.vin) {
            delete newVehicle.vin;
            const retry = await supabase.from("vehicles").insert(newVehicle);
            iErr = retry.error;
          }

          if (iErr) {
            errors++;
            if (sampleResults.length < 5) {
              sampleResults.push({
                action: "create_error",
                url: snapshot.listing_url.slice(0, 80),
                error: iErr.message,
              });
            }
            continue;
          }
        }

        created++;
        fieldsTotal += Object.keys(parsed).filter(k => parsed[k] !== null && parsed[k] !== undefined).length;
        if (sampleResults.length < 10) {
          sampleResults.push({
            action: opts.dryRun ? "would_create" : "created",
            url: snapshot.listing_url.slice(0, 80),
            ymm: `${parsed.year || "?"} ${parsed.make || "?"} ${parsed.model || "?"}`,
            fields: Object.keys(parsed).filter(k => parsed[k] !== null),
          });
        }
      }
    } catch (e: any) {
      errors++;
      if (sampleResults.length < 5) {
        sampleResults.push({ action: "error", url: snapshot.listing_url?.slice(0, 80), error: e?.message });
      }
    }
  }

  return okJson({
    success: true,
    dry_run: opts.dryRun,
    platform: opts.platform,
    batch_size: opts.batchSize,
    offset: opts.offset,
    snapshots_checked: snapshots.length,
    created,
    updated,
    already_linked: alreadyLinked,
    skipped,
    errors,
    fields_filled: fieldsTotal,
    sample_results: sampleResults,
    duration_ms: Date.now() - opts.startTime,
    next_offset: opts.offset + opts.batchSize,
  });
}

function normalizeUrl(url: string): string {
  return url
    .replace(/\/(contact|error\.[^/]+|feed|amp|embed|comments|trackback|page\/\d+)\/?.*$/i, "")
    .replace(/\/$/, "");
}

function getUrlVariants(url: string): string[] {
  const base = normalizeUrl(url);
  const https = base.replace(/^http:/, "https:");
  const http = base.replace(/^https:/, "http:");
  return [base, base + "/", https, https + "/", http, http + "/"];
}

// ============================================================
// BaT HTML PARSER (same as batch-extract-snapshots)
// ============================================================
function parseBatHtml(html: string): Record<string, any> {
  const result: Record<string, any> = {};

  // Title parsing
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch?.[1]) {
    const title = titleMatch[1].trim();

    const priceInTitle = title.match(/sold for \$([\d,]+)/i);
    if (priceInTitle) result.sale_price = parseInt(priceInTitle[1].replace(/,/g, ""));

    const mainPart = title.split(/\s+for sale on BaT/i)[0] || "";
    const yearMatch = mainPart.match(/\b(19\d{2}|20[0-2]\d)\b/);
    if (yearMatch) {
      result.year = parseInt(yearMatch[1]);
      const afterYear = mainPart.slice(mainPart.indexOf(yearMatch[1]) + yearMatch[1].length).trim();
      if (afterYear) {
        const makePatterns = [
          "Alfa Romeo", "Aston Martin", "Austin-Healey", "De Tomaso", "Land Rover", "Mercedes-Benz",
          "Rolls-Royce", "AC", "Acura", "Audi", "Austin", "BMW", "Bentley", "Buick", "Cadillac",
          "Chevrolet", "Chrysler", "Datsun", "DeLorean", "Dodge", "Ferrari", "Fiat",
          "Ford", "GMC", "Honda", "Hummer", "Hyundai", "Infiniti", "International", "Isuzu",
          "Jaguar", "Jeep", "Kia", "Lamborghini", "Lancia", "Lexus", "Lincoln", "Lotus",
          "Maserati", "Mazda", "McLaren", "Mercury", "MG", "Mini", "Mitsubishi", "Nissan",
          "Oldsmobile", "Opel", "Pagani", "Peugeot", "Plymouth", "Pontiac", "Porsche", "RAM",
          "Renault", "Rivian", "Saab", "Saturn", "Shelby", "Subaru", "Suzuki", "Tesla",
          "Toyota", "Triumph", "Volkswagen", "Volvo", "Willys", "Willys-Overland",
        ];

        for (const make of makePatterns) {
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
            result.model = words[0];
          }
        }
      }
    }
  }

  // Listing Details
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
      // VIN / Chassis
      if (/^(?:chassis|vin|serial)/i.test(item) && !result.vin) {
        const vinVal = item.replace(/^(?:chassis|vin|serial)\s*[:;]?\s*/i, "").trim();
        if (vinVal.length >= 5 && vinVal.length <= 17) result.vin = vinVal;
      }

      // Mileage
      if (/\bmiles?\b/i.test(item) && !result.mileage) {
        const miMatch = item.match(/([\d,.]+)\s*k?\s*miles?/i);
        if (miMatch) {
          let mi = miMatch[1].replace(/,/g, "");
          if (/k\s*miles?/i.test(item)) mi = String(parseFloat(mi) * 1000);
          const parsed = parseInt(mi);
          if (parsed > 0 && parsed < 1_000_000) result.mileage = parsed;
        }
      }

      // Engine
      if (/(?:engine|liter|litre|cubic|inline|flat|v\d|cylinder|turbo|supercharg)/i.test(item)
        && !/(transmission|gearbox|speed)/i.test(item) && !result.engine_type) {
        result.engine_type = item;
        const dispMatch = item.match(/([\d.]+)\s*-?\s*(?:liter|litre|l\b)/i);
        if (dispMatch) result.engine_displacement = `${dispMatch[1]}L`;
        const hpMatch = item.match(/(\d{2,4})\s*(?:hp|horsepower|bhp)/i);
        if (hpMatch) result.horsepower = parseInt(hpMatch[1]);
      }

      // HP standalone
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
      if (/(?:transmission|gearbox|speed\s+(?:manual|automatic)|pdk|tiptronic|dsg|cvt)/i.test(item) && !result.transmission) {
        result.transmission = item;
      }

      // Drivetrain
      if (/\b(?:4x4|4wd|awd|fwd|rwd|four.wheel.drive|all.wheel.drive|transfer case)\b/i.test(item) && !result.drivetrain) {
        if (/\b(?:4x4|4wd|four.wheel.drive)\b/i.test(item)) result.drivetrain = "4WD";
        else if (/\bawd\b|all.wheel.drive/i.test(item)) result.drivetrain = "AWD";
        else if (/\bfwd\b|front.wheel.drive/i.test(item)) result.drivetrain = "FWD";
        else if (/\brwd\b|rear.wheel.drive/i.test(item)) result.drivetrain = "RWD";
      }

      // Body style
      if (/\b(?:coupe|convertible|roadster|sedan|wagon|hatchback|truck|suv|van|targa|speedster|cabriolet|pickup)\b/i.test(item)
        && !result.body_style && !/(?:engine|transmission)/i.test(item)) {
        const bsMatch = item.match(/\b(coupe|convertible|roadster|sedan|wagon|hatchback|truck|suv|van|targa|speedster|cabriolet|pickup)\b/i);
        if (bsMatch) {
          let bs = bsMatch[1].charAt(0).toUpperCase() + bsMatch[1].slice(1).toLowerCase();
          if (bs === "Cabriolet") bs = "Convertible";
          if (bs === "Pickup") bs = "Truck";
          result.body_style = bs;
        }
      }

      // Color
      if (/\b(?:paint|repaint|refinish|exterior|color)\b/i.test(item) && !result.color) {
        const colorClean = item
          .replace(/\b(?:repainted|refinished|in|over|original|factory)\b/gi, "")
          .replace(/\b(?:paint|exterior|color|finish)\b/gi, "")
          .trim();
        if (colorClean.length > 1 && colorClean.length < 50) result.color = colorClean;
      }

      // Interior
      if (/\b(?:upholstery|interior|leather|vinyl|cloth|alcantara)\b/i.test(item) && !result.interior_color) {
        const intClean = item
          .replace(/\b(?:original|factory)\b/gi, "")
          .replace(/\b(?:upholstery|interior)\b/gi, "")
          .trim();
        if (intClean.length > 1 && intClean.length < 60) result.interior_color = intClean;
      }
    }
  }

  // VIN from Chassis link
  if (!result.vin) {
    const chassisLink = html.match(/Chassis\s*:?\s*<a[^>]*>([A-HJ-NPR-Z0-9]{5,17})<\/a>/i);
    if (chassisLink?.[1]) result.vin = chassisLink[1];
  }

  // Description
  if (!result.description) {
    const excerptMatch = html.match(/<div[^>]*class=["'][^"']*post-excerpt[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    if (excerptMatch?.[1]) {
      const text = excerptMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (text.length > 40) result.description = text.slice(0, 2000);
    }
  }

  // Sale price from history
  if (!result.sale_price) {
    const soldMatch = html.match(/Sold\s+(?:by\s+\S+\s+)?(?:to\s+\S+\s+)?for\s+(?:USD\s+)?\$([\d,]+)/i);
    if (soldMatch) result.sale_price = parseInt(soldMatch[1].replace(/,/g, ""));
  }

  // Body style from title
  if (!result.body_style && titleMatch) {
    const title = titleMatch[1] || "";
    const bs = title.match(/\b(Coupe|Convertible|Roadster|Sedan|Wagon|Hatchback|Truck|SUV|Targa|Speedster|Pickup)\b/i);
    if (bs) result.body_style = bs[1].charAt(0).toUpperCase() + bs[1].slice(1).toLowerCase();
  }

  // Drivetrain from title
  if (!result.drivetrain && titleMatch) {
    const title = titleMatch[1] || "";
    if (/\b4x4\b/i.test(title)) result.drivetrain = "4WD";
    else if (/\bAWD\b/.test(title)) result.drivetrain = "AWD";
  }

  return result;
}

function parseGenericHtml(html: string): Record<string, any> {
  const result: Record<string, any> = {};

  // JSON-LD
  const jsonLd = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (jsonLd?.[1]) {
    try {
      const ld = JSON.parse(jsonLd[1]);
      if (ld.name) {
        const yearMatch = ld.name.match(/\b(19\d{2}|20[0-2]\d)\b/);
        if (yearMatch) result.year = parseInt(yearMatch[1]);
      }
      if (ld.description) result.description = ld.description.slice(0, 2000);
      if (ld.offers?.price) result.sale_price = parseInt(String(ld.offers.price).replace(/[^0-9]/g, ""));
    } catch { /* ignore */ }
  }

  // VIN
  const vinMatch = html.match(/\bVIN\s*[:;]?\s*([A-HJ-NPR-Z0-9]{11,17})\b/i);
  if (vinMatch?.[1]) result.vin = vinMatch[1];

  return result;
}

function okJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
