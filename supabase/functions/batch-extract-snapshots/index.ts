/**
 * BATCH EXTRACT SNAPSHOTS — Fast structured extraction (NO LLM)
 *
 * Parses archived HTML snapshots using regex/structured parsing.
 * Can process 50+ vehicles per invocation in ~5-10 seconds.
 *
 * POST /functions/v1/batch-extract-snapshots
 * Body: {
 *   "batch_size": number,       // default 50, max 200
 *   "platform": string,         // "bat" (default), "bonhams", "mecum", "barrett-jackson"
 *   "dry_run": boolean,
 *   "offset": number            // for pagination (default 0)
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VERSION = "batch-extract-snapshots:1.1.0";

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

    const mode = body.mode || "skeleton";
    console.log(`[batch-extract] batch=${batchSize} platform=${platform} mode=${mode} dry=${dryRun} offset=${offset}`);

    // Step 1: Find vehicles that need extraction and have a URL matching this platform
    // Platform-to-URL domain mapping
    const platformDomains: Record<string, string> = {
      bat: "bringatrailer",
      bonhams: "bonhams",
      mecum: "mecum",
      "barrett-jackson": "barrett-jackson",
    };
    const domain = platformDomains[platform] || platform;

    const selectFields = `id, year, make, model, trim, vin, mileage, horsepower, torque, engine_type, engine_displacement, transmission, drivetrain, body_style, color, color_primary, interior_color, description, sale_price, bat_auction_url, discovery_url, listing_url, extractor_version`;

    // Build URL filter: check bat_auction_url (for BaT), listing_url, and discovery_url
    let urlFilter: string;
    if (platform === "bat") {
      urlFilter = `bat_auction_url.not.is.null,listing_url.like.*${domain}*,discovery_url.like.*${domain}*`;
    } else {
      urlFilter = `listing_url.like.*${domain}*,discovery_url.like.*${domain}*`;
    }

    // Build mode filter
    let modeFilter: string;
    if (mode === "skeleton") {
      modeFilter = "year.is.null,make.is.null,model.is.null";
    } else if (mode === "sparse") {
      modeFilter = "trim.is.null,vin.is.null,mileage.is.null,horsepower.is.null,engine_type.is.null,transmission.is.null,drivetrain.is.null,body_style.is.null,color.is.null,interior_color.is.null";
    } else {
      modeFilter = "trim.is.null,vin.is.null,mileage.is.null,horsepower.is.null,engine_type.is.null,transmission.is.null,drivetrain.is.null,body_style.is.null,color.is.null,interior_color.is.null,engine_displacement.is.null";
    }

    // PostgREST: multiple .or() calls are ANDed together
    // (has platform URL) AND (not yet processed) AND (missing fields per mode)
    let query = supabase
      .from("vehicles")
      .select(selectFields)
      .or(urlFilter)
      .or(`extractor_version.is.null,extractor_version.neq.${VERSION}`)
      .or(modeFilter)
      .is("deleted_at", null)
      .range(offset, offset + batchSize - 1)
      .order("id");

    const { data: vehicles, error: vErr } = await query;
    if (vErr) throw new Error(`Vehicle query failed: ${vErr.message}`);

    if (!vehicles || vehicles.length === 0) {
      return okJson({
        success: true,
        message: "No vehicles need extraction",
        processed: 0,
        duration_ms: Date.now() - startTime,
      });
    }

    console.log(`[batch-extract] Found ${vehicles.length} vehicles to process`);

    let extracted = 0;
    let skipped = 0;
    let noSnapshot = 0;
    let errors = 0;
    let fieldsTotal = 0;
    const sampleResults: any[] = [];

    for (const vehicle of vehicles) {
      try {
        // Step 2: Find snapshot for this vehicle
        // Normalize URLs: try http/https variants and with/without trailing slash
        const rawUrls = [
          vehicle.bat_auction_url,
          vehicle.listing_url,
          vehicle.discovery_url,
        ].filter(Boolean);

        const normalizedUrls = new Set<string>();
        for (let url of rawUrls) {
          // Strip known junk suffixes from BaT URLs
          url = url.replace(/\/(contact|error\.[^/]+|feed|amp|embed|comments|trackback|page\/\d+)\/?.*$/i, "");
          const u = url.replace(/\/$/, ""); // strip trailing slash
          const uSlash = u + "/";
          const https = u.replace(/^http:/, "https:");
          const http = u.replace(/^https:/, "http:");
          normalizedUrls.add(u);
          normalizedUrls.add(uSlash);
          normalizedUrls.add(https);
          normalizedUrls.add(https + "/");
          normalizedUrls.add(http);
          normalizedUrls.add(http + "/");
        }
        const uniqueUrls = [...normalizedUrls];

        let snapshotHtml: string | null = null;
        // Batch lookup: use `in` filter for all URL variants at once
        const { data: snaps } = await supabase
          .from("listing_page_snapshots")
          .select("html")
          .in("listing_url", uniqueUrls)
          .eq("platform", platform)
          .eq("success", true)
          .not("html", "is", null)
          .order("fetched_at", { ascending: false })
          .limit(1);

        if (snaps?.[0]?.html && snaps[0].html.length > 500) {
          snapshotHtml = snaps[0].html;
        }

        if (!snapshotHtml) {
          noSnapshot++;
          continue;
        }

        // Step 3: Parse structurally based on platform
        let parsed: Record<string, any>;
        if (platform === "bat") {
          parsed = parseBatHtml(snapshotHtml);
        } else if (platform === "bonhams") {
          parsed = parseBonhamsHtml(snapshotHtml);
        } else if (platform === "mecum") {
          parsed = parseMecumHtml(snapshotHtml);
        } else if (platform === "barrett-jackson") {
          parsed = parseBarrettJacksonHtml(snapshotHtml);
        } else {
          skipped++;
          continue;
        }

        // Step 4: Build update payload (only fill missing fields)
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
        };

        for (const [parsedKey, dbField] of Object.entries(fieldMap)) {
          const newVal = parsed[parsedKey];
          if (newVal === null || newVal === undefined) continue;
          if (typeof newVal === "string" && newVal.trim() === "") continue;

          const existing = vehicle[dbField];
          // Only fill if currently empty/null, or if existing is bad data
          if (existing === null || existing === undefined || String(existing).trim() === "") {
            updatePayload[dbField] = newVal;
            fieldsUpdated.push(dbField);
          } else if (dbField === "trim" && typeof existing === "string" && existing.length > 60) {
            // Replace overly long trims
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
          // Still mark as processed to avoid re-checking
          if (!dryRun) {
            await supabase.from("vehicles").update({
              extractor_version: VERSION,
              updated_at: new Date().toISOString(),
            }).eq("id", vehicle.id);
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
              // Only VIN was being updated, mark as processed and skip
              await supabase.from("vehicles").update({
                extractor_version: VERSION,
                updated_at: new Date().toISOString(),
              }).eq("id", vehicle.id);
              skipped++;
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
            continue;
          }
        }

        extracted++;
        fieldsTotal += fieldsUpdated.length;
        if (sampleResults.length < 10) {
          sampleResults.push({
            id: vehicle.id,
            ymm: `${vehicle.year || parsed.year || "?"} ${vehicle.make || parsed.make || "?"} ${vehicle.model || parsed.model || "?"}`,
            status: dryRun ? "dry_run" : "updated",
            fields: fieldsUpdated,
          });
        }
      } catch (e: any) {
        errors++;
        if (sampleResults.length < 5) {
          sampleResults.push({ id: vehicle.id, status: "error", error: e?.message });
        }
      }
    }

    return okJson({
      success: true,
      dry_run: dryRun,
      platform,
      mode,
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
// PLATFORM PARSERS — Pure regex, no LLM
// ============================================================

function parseBatHtml(html: string): Record<string, any> {
  const result: Record<string, any> = {};

  // --- Title parsing: "Year Make Model [Trim] for sale on BaT Auctions" ---
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch?.[1]) {
    const title = titleMatch[1].trim();

    // Extract sale price from title: "sold for $33,250 on August..."
    const priceInTitle = title.match(/sold for \$([\d,]+)/i);
    if (priceInTitle) {
      result.sale_price = parseInt(priceInTitle[1].replace(/,/g, ""));
    }

    // Extract year, make, model from before "for sale on BaT"
    const mainPart = title.split(/\s+for sale on BaT/i)[0] || "";
    const yearMatch = mainPart.match(/\b(19\d{2}|20[0-2]\d)\b/);
    if (yearMatch) {
      result.year = parseInt(yearMatch[1]);
      // Everything after the year is make + model + trim
      const afterYear = mainPart.slice(mainPart.indexOf(yearMatch[1]) + yearMatch[1].length).trim();
      if (afterYear) {
        // Common makes to help split
        const makePatterns = [
          "Alfa Romeo", "Aston Martin", "Austin-Healey", "De Tomaso", "Land Rover", "Mercedes-Benz",
          "Rolls-Royce", "AC", "Acura", "Audi", "Austin", "BMW", "Bentley", "Buick", "Cadillac",
          "Chevrolet", "Chrysler", "Citroën", "Datsun", "DeLorean", "Dodge", "Ferrari", "Fiat",
          "Ford", "GMC", "Honda", "Hummer", "Hyundai", "Infiniti", "International", "Isuzu",
          "Jaguar", "Jeep", "Kia", "Lamborghini", "Lancia", "Lexus", "Lincoln", "Lotus",
          "Maserati", "Mazda", "McLaren", "Mercury", "MG", "Mini", "Mitsubishi", "Nissan",
          "Oldsmobile", "Opel", "Pagani", "Peugeot", "Plymouth", "Pontiac", "Porsche", "RAM",
          "Renault", "Rivian", "Saab", "Saturn", "Shelby", "Subaru", "Suzuki", "Tesla",
          "Toyota", "Triumph", "Volkswagen", "Volvo", "Willys",
        ];

        for (const make of makePatterns) {
          if (afterYear.toLowerCase().startsWith(make.toLowerCase())) {
            result.make = make;
            const rest = afterYear.slice(make.length).trim();
            if (rest) {
              // First word(s) = model, rest might be trim/variant
              result.model = rest;
            }
            break;
          }
        }

        // If no known make matched, take first word as make
        if (!result.make) {
          const words = afterYear.split(/\s+/);
          if (words.length >= 2) {
            // Check for hyphenated/compound makes
            if (words[0] === "Willys" && words[1] === "Overland") {
              result.make = "Willys-Overland";
              result.model = words.slice(2).join(" ");
            } else {
              result.make = words[0];
              result.model = words.slice(1).join(" ");
            }
          }
        }
      }
    }
  }

  // --- Listing Details section ---
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
      if (/^(?:chassis|vin|serial)/i.test(item)) {
        const vinVal = item.replace(/^(?:chassis|vin|serial)\s*[:;]?\s*/i, "").trim();
        if (vinVal.length >= 5 && vinVal.length <= 17) {
          result.vin = vinVal;
        }
      }

      // Mileage
      if (/\bmiles?\b/i.test(item) && !result.mileage) {
        // Patterns: "7k Miles", "25,000 Miles", "~10k Miles Shown", "125k Miles Indicated"
        const miMatch = item.match(/([\d,.]+)\s*k?\s*miles?/i);
        if (miMatch) {
          let mi = miMatch[1].replace(/,/g, "");
          if (/k\s*miles?/i.test(item) && !mi.includes(".")) {
            mi = String(parseFloat(mi) * 1000);
          } else if (/k\s*miles?/i.test(item) && mi.includes(".")) {
            mi = String(parseFloat(mi) * 1000);
          }
          const parsed = parseInt(mi);
          if (parsed > 0 && parsed < 1_000_000) result.mileage = parsed;
        }
      }

      // Engine
      if (/(?:engine|liter|litre|cubic|inline|flat|v\d|cylinder|turbo|supercharg|twin.?cam|dohc|sohc|hemi)/i.test(item)
        && !/(transmission|gearbox|speed)/i.test(item)
        && !result.engine_type) {
        result.engine_type = item;

        // Try to extract displacement
        const dispMatch = item.match(/([\d.]+)\s*-?\s*(?:liter|litre|l\b)/i);
        if (dispMatch) result.engine_displacement = `${dispMatch[1]}L`;

        const ccMatch = item.match(/(\d{3,5})\s*cc/i);
        if (ccMatch) result.engine_displacement = `${ccMatch[1]}cc`;

        // Try to extract HP
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
        if (/\b(?:4x4|4wd|four.wheel.drive)\b/i.test(item)) result.drivetrain = "4WD";
        else if (/\bawd\b|all.wheel.drive/i.test(item)) result.drivetrain = "AWD";
        else if (/\bfwd\b|front.wheel.drive/i.test(item)) result.drivetrain = "FWD";
        else if (/\brwd\b|rear.wheel.drive/i.test(item)) result.drivetrain = "RWD";
      }

      // Body style keywords
      if (/\b(?:coupe|convertible|roadster|sedan|wagon|hatchback|truck|suv|van|targa|speedster|cabriolet|pickup|estate)\b/i.test(item)
        && !result.body_style && !/(?:engine|transmission|gearbox)/i.test(item)) {
        const bsMatch = item.match(/\b(coupe|convertible|roadster|sedan|wagon|hatchback|truck|suv|van|targa|speedster|cabriolet|pickup|estate)\b/i);
        if (bsMatch) {
          let bs = bsMatch[1];
          bs = bs.charAt(0).toUpperCase() + bs.slice(1).toLowerCase();
          if (bs === "Cabriolet") bs = "Convertible";
          if (bs === "Estate") bs = "Wagon";
          if (bs === "Pickup") bs = "Truck";
          result.body_style = bs;
        }
      }

      // Color / Paint
      if (/\b(?:paint|repaint|refinish|exterior|color)\b/i.test(item) && !result.color) {
        // Extract color from "Repainted [Color]" or "[Color] Paint" etc.
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

  // --- VIN from Chassis link (common BaT pattern) ---
  if (!result.vin) {
    const chassisLink = html.match(/Chassis\s*:?\s*<a[^>]*>([A-HJ-NPR-Z0-9]{5,17})<\/a>/i);
    if (chassisLink?.[1]) result.vin = chassisLink[1];
  }

  // --- Also check for VIN in a standalone pattern ---
  if (!result.vin) {
    const vinStandalone = html.match(/\bVIN\s*[:;]?\s*([A-HJ-NPR-Z0-9]{11,17})\b/i);
    if (vinStandalone?.[1]) result.vin = vinStandalone[1];
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

  // --- Sale price from history section ---
  if (!result.sale_price) {
    const soldMatch = html.match(/Sold\s+(?:by\s+\S+\s+)?(?:to\s+\S+\s+)?for\s+(?:USD\s+)?\$([\d,]+)/i);
    if (soldMatch) {
      result.sale_price = parseInt(soldMatch[1].replace(/,/g, ""));
    }
  }

  // --- Body style from title if not found in listing details ---
  if (!result.body_style && titleMatch?.[1]) {
    const title = titleMatch[1];
    const bsTitleMatch = title.match(/\b(Coupe|Convertible|Roadster|Sedan|Wagon|Hatchback|Truck|SUV|Van|Targa|Speedster|Pickup|Cabriolet)\b/i);
    if (bsTitleMatch) {
      let bs = bsTitleMatch[1];
      bs = bs.charAt(0).toUpperCase() + bs.slice(1).toLowerCase();
      if (bs === "Cabriolet") bs = "Convertible";
      if (bs === "Pickup") bs = "Truck";
      result.body_style = bs;
    }
  }

  // --- Drivetrain from title if not found ---
  if (!result.drivetrain && titleMatch?.[1]) {
    const title = titleMatch[1];
    if (/\b4x4\b/i.test(title) || /\b4WD\b/.test(title)) result.drivetrain = "4WD";
    else if (/\bAWD\b/.test(title)) result.drivetrain = "AWD";
  }

  return result;
}

function parseBonhamsHtml(html: string): Record<string, any> {
  const result: Record<string, any> = {};

  // JSON-LD
  const jsonLdMatch = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (jsonLdMatch?.[1]) {
    try {
      const ld = JSON.parse(jsonLdMatch[1]);
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

  // Chassis
  const chassisMatch = html.match(/\bChassis\s+(?:No\.?\s*)?[:;]?\s*([A-HJ-NPR-Z0-9]{5,17})\b/i);
  if (chassisMatch?.[1]) result.vin = chassisMatch[1];

  // Engine from description keywords
  if (result.description) {
    const engMatch = result.description.match(/([\d.]+)\s*-?\s*(?:liter|litre|l)\b/i);
    if (engMatch) result.engine_displacement = `${engMatch[1]}L`;

    const hpMatch = result.description.match(/(\d{2,4})\s*(?:hp|bhp|horsepower)/i);
    if (hpMatch) result.horsepower = parseInt(hpMatch[1]);

    const miMatch = result.description.match(/([\d,]+)\s*miles?\b/i);
    if (miMatch) {
      const mi = parseInt(miMatch[1].replace(/,/g, ""));
      if (mi > 0 && mi < 1_000_000) result.mileage = mi;
    }
  }

  return result;
}

function parseMecumHtml(html: string): Record<string, any> {
  const result: Record<string, any> = {};

  // __NEXT_DATA__
  const nextData = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (nextData?.[1]) {
    try {
      const nd = JSON.parse(nextData[1]);
      const post = nd?.props?.pageProps?.post || nd?.props?.pageProps?.lot;
      if (post) {
        if (post.title) {
          const yearMatch = post.title.match(/\b(19\d{2}|20[0-2]\d)\b/);
          if (yearMatch) result.year = parseInt(yearMatch[1]);
        }
        if (post.vinSerial) result.vin = post.vinSerial;
        if (post.transmission) result.transmission = post.transmission;
        if (post.color) result.color = post.color;
        if (post.interior) result.interior_color = post.interior;
        if (post.content) {
          const desc = post.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
          result.description = desc.slice(0, 2000);
        }
        if (post.lotSeries) result.engine_type = post.lotSeries;
      }
    } catch { /* fallback */ }
  }

  return result;
}

function parseBarrettJacksonHtml(html: string): Record<string, any> {
  const result: Record<string, any> = {};

  // JSON-LD
  const jsonLdMatch = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (jsonLdMatch?.[1]) {
    try {
      const ld = JSON.parse(jsonLdMatch[1]);
      if (ld.name) {
        const yearMatch = ld.name.match(/\b(19\d{2}|20[0-2]\d)\b/);
        if (yearMatch) result.year = parseInt(yearMatch[1]);
      }
      if (ld.description) result.description = ld.description.slice(0, 2000);
    } catch { /* ignore */ }
  }

  // og:title
  const ogTitle = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  if (ogTitle?.[1]) {
    const yearMatch = ogTitle[1].match(/\b(19\d{2}|20[0-2]\d)\b/);
    if (yearMatch && !result.year) result.year = parseInt(yearMatch[1]);
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
