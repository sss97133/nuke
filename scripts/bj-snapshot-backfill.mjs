#!/usr/bin/env node
/**
 * Barrett-Jackson Snapshot Backfill — Snapshot-first parsing
 *
 * Processes BJ snapshots directly from listing_page_snapshots,
 * downloads HTML from Supabase Storage, parses vehicle data,
 * and gap-fills vehicle records.
 *
 * Usage:
 *   dotenvx run -- node scripts/bj-snapshot-backfill.mjs [--batch N] [--dry-run] [--force]
 *
 * Root causes fixed:
 *   1. batch-extract-snapshots stamped extractor_version but got 0 fields
 *      (HTML was in storage, not inline, and storage download timed out in edge fn)
 *   2. www vs non-www URL mismatch between snapshots and vehicles
 */

import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const args = process.argv.slice(2);
const BATCH_SIZE = parseInt(args.find(a => a.startsWith("--batch"))?.split("=")[1] || args[args.indexOf("--batch") + 1]) || 100;
const DRY_RUN = args.includes("--dry-run");
const FORCE = args.includes("--force");
const VERSION = "bj-backfill:1.0.0";

// ========== PARSER UTILITIES ==========

function titleCase(str) {
  return str.replace(/\w\S*/g, (txt) =>
    txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
  );
}

function cleanVin(raw) {
  const cleaned = raw.replace(/[\s\-–—]/g, "").replace(/[oO]/g, "0").trim();
  if (!cleaned || cleaned.length < 5 || cleaned.length > 17) return null;
  if (/^[0]+$/.test(cleaned)) return null;
  if (/^(test|none|na|n\/a|tbd|unknown)/i.test(cleaned)) return null;
  return cleaned;
}

function normalizeBodyStyle(raw) {
  const bs = raw.trim().toLowerCase();
  const collectorMap = {
    "split-window coupe": "Split-Window Coupe",
    "split window coupe": "Split-Window Coupe",
    "gullwing coupe": "Gullwing Coupe",
    "stepside": "Stepside",
    "flareside": "Flareside",
    "fleetside": "Fleetside",
    "styleside": "Styleside",
    "sweptline": "Sweptline",
    "short bed": "Short Bed",
    "short-bed": "Short Bed",
    "long bed": "Long Bed",
    "long-bed": "Long Bed",
    "half-cab": "Half-Cab",
    "half cab": "Half-Cab",
    "2-door hardtop": "2-Door Hardtop",
    "2 door hardtop": "2-Door Hardtop",
    "sport coupe": "2-Door Hardtop",
    "t-top": "T-Top",
    "crew cab": "Crew Cab",
    "panel": "Panel",
  };
  for (const [key, val] of Object.entries(collectorMap)) {
    if (bs.includes(key)) return val;
  }
  const map = {
    coupe: "Coupe", "coupé": "Coupe", convertible: "Convertible",
    cabriolet: "Convertible", roadster: "Roadster", sedan: "Sedan",
    saloon: "Sedan", wagon: "Wagon", estate: "Wagon", hatchback: "Hatchback",
    truck: "Pickup", pickup: "Pickup", suv: "SUV", van: "Van", targa: "Targa",
    speedster: "Speedster", hardtop: "Hardtop", fastback: "Fastback",
  };
  for (const [key, val] of Object.entries(map)) {
    if (bs.includes(key)) return val;
  }
  return null;
}

function extractFacetsFromText(title, make, model, rawStyle, description) {
  const primary = [title, model, rawStyle].filter(Boolean).join(" ");
  const descSafe = (description || "").replace(
    /\b(?:corvette|camaro|chevelle|mustang(?:\s+ii)?|crown\s+victoria|cobra\s+jet)\s+(?:engine|motor|v8|ls\d|lt\d|front\s+end|front\s+suspension|rear\s+end|subframe|brakes|trans(?:mission)?)\b/gi,
    " "
  );
  const full = `${primary} ${descSafe}`;
  let series = null;
  let trim = null;
  let body_style = rawStyle ? normalizeBodyStyle(rawStyle) : null;
  let canonicalModel = model;

  // GM Trucks (C10 / K10 / C20 / K20 / 3100 / Apache / Cameo / Blazer / Suburban)
  const truckCode = primary.match(/\b([CKRV]\s*-?\s*(?:10|15|20|25|30|35|1500|2500|3500)|3100|3600|3800|APACHE|CAMEO)\b/i);
  if (truckCode) {
    const rawCode = truckCode[1].toUpperCase().replace(/[\s-]+/g, "");
    const codeMap = { K15: "K1500", C15: "C1500", K25: "K2500", C25: "C2500", K35: "K3500", C35: "C3500", CAMEO: "Cameo", APACHE: "Apache" };
    series = codeMap[rawCode] || rawCode;
    canonicalModel = series;
    const gmTrims = [
      [/\bCHEYENNE\s+SUPER\b/i, "Cheyenne Super"],
      [/\bCUSTOM\s+DELUXE\b/i, "Custom Deluxe"],
      [/\bSILVERADO\b/i, "Silverado"],
      [/\bCHEYENNE\b/i, "Cheyenne"],
      [/\bSCOTTSDALE\b/i, "Scottsdale"],
      [/\bBIG\s*10\b/i, "Big 10"],
      [/\b454\s*SS\b/i, "454 SS"],
      [/\b(?:CST|CUSTOM\s+SPORT\s+TRUCK)\b/i, "CST"],
      [/\bSIERRA\s+CLASSIC\b/i, "Sierra Classic"],
      [/\bSIERRA\s+GRANDE\b/i, "Sierra Grande"],
      [/\bHIGH\s+SIERRA\b/i, "High Sierra"],
      [/\bCAMEO\s+CARRIER\b/i, "Cameo Carrier"],
    ];
    for (const [re, label] of gmTrims) {
      if (re.test(full)) { trim = label; break; }
    }
    body_style = normalizeBodyStyle(primary) || normalizeBodyStyle(full) || body_style || "Pickup";
  } else if (/\bCHEVELLE\b/i.test(primary)) {
    canonicalModel = "Chevelle";
    if (/\bSS\s*454\b|\b454\s*SS\b/i.test(full)) {
      series = "SS 454";
      trim = /\bLS6\b/i.test(full) ? "SS 454 LS6" : "SS 454";
    } else if (/\bSS\s*396\b|\b396\s*SS\b/i.test(full)) {
      series = "SS 396";
      trim = /\bL78\b/i.test(full) ? "SS 396 L78" : "SS 396";
    } else if (/\bMALIBU\s+SS\b/i.test(full)) {
      series = "Malibu SS";
      trim = "Malibu SS";
    }
    body_style = normalizeBodyStyle(primary) || body_style;
  } else if (/\bBRONCO\b/i.test(primary)) {
    canonicalModel = "Bronco";
    if (/\bU13\b|\bROADSTER\b/i.test(full)) series = "U13 Roadster";
    else if (/\bU14\b|\bHALF[-\s]?CAB\b/i.test(full)) series = "U14 Half-Cab";
    else if (/\bU15\b/i.test(full)) series = "U15 Wagon";
    if (/\bRANGER\b/i.test(full)) trim = "Ranger";
    else if (/\bSPORT\b/i.test(full)) trim = "Sport";
    else if (/\bEDDIE\s+BAUER\b/i.test(full)) trim = "Eddie Bauer";
    else if (/\bXLT\b/i.test(full)) trim = "XLT";
    if (!series && (trim === "Ranger" || trim === "Sport")) series = "U15 Wagon";
    body_style = normalizeBodyStyle(primary) || (series === "U14 Half-Cab" ? "Half-Cab" : series === "U13 Roadster" ? "Roadster" : body_style || "SUV");
  } else if (/\bCORVETTE\b/i.test(primary)) {
    canonicalModel = "Corvette";
    if (/\bSPLIT[-\s]?WINDOW\b/i.test(full)) {
      series = "Sting Ray";
      trim = "Split-Window";
      body_style = "Split-Window Coupe";
    } else if (/\bL88\b/i.test(full)) {
      series = "L88";
      trim = "L88";
    } else if (/\b427\s*\/\s*435\b/i.test(full)) {
      series = "427";
      trim = "427/435";
    } else if (/\b427\b/i.test(primary)) {
      series = "427";
      trim = "427";
    } else if (/\bSTING\s+RAY\b/i.test(full)) {
      series = "Sting Ray";
    } else if (/\bSTINGRAY\b/i.test(full)) {
      series = "Stingray";
    }
    if (!body_style) body_style = normalizeBodyStyle(primary);
  } else if (/\b(?:ROAD\s+RUNNER|SUPERBIRD|GTX|BARRACUDA|'CUDA|CUDA)\b/i.test(primary)) {
    if (/\bSUPERBIRD\b/i.test(primary)) { canonicalModel = "Superbird"; series = "Superbird"; }
    else if (/\bROAD\s+RUNNER\b/i.test(primary)) { canonicalModel = "Road Runner"; series = "Road Runner"; }
    else if (/\bGTX\b/i.test(primary)) { canonicalModel = "GTX"; series = "GTX"; }
    else {
      canonicalModel = "Barracuda";
      if (/\bHEMI\s*'?\s*CUDA\b/i.test(full)) series = "Hemi 'Cuda";
      else if (/\bAAR\s*'?\s*CUDA\b/i.test(full)) series = "AAR 'Cuda";
      else if (/\bFORMULA\s+S\b/i.test(full)) series = "Formula S";
      else if (/\b'?\s*CUDA\b/i.test(primary)) series = "'Cuda";
    }
    if (/\b426\s+HEMI\b|\bHEMI\b/i.test(full)) trim = "426 Hemi";
    else if (/\b440\s*(?:SIX\s+BARREL|6\s*BBL)\b/i.test(full)) trim = "440 Six Barrel";
    else if (/\b440\s*(?:SIX\s+PACK|6\s*PACK)\b/i.test(full)) trim = "440 Six Pack";
    else if (/\bAAR\b/i.test(full)) trim = "AAR";
    else if (/\bFORMULA\s+S\b/i.test(full)) trim = "Formula S";
    body_style = normalizeBodyStyle(primary) || body_style;
  }

  return { model: canonicalModel, series, trim, body_style };
}

function normalizeDrivetrain(raw) {
  if (/\b(?:4x4|4wd|four.wheel.drive)\b/i.test(raw)) return "4WD";
  if (/\bawd\b|all.wheel.drive/i.test(raw)) return "AWD";
  if (/\bfwd\b|front.wheel.drive/i.test(raw)) return "FWD";
  if (/\brwd\b|rear.wheel.drive/i.test(raw)) return "RWD";
  return null;
}

/** Normalize a BJ URL to strip www for matching */
function normalizeBjUrl(url) {
  return url
    .replace(/^https?:\/\/www\./, "https://")
    .replace(/\/$/, "");
}

// ========== BJ HTML PARSER ==========

function parseBarrettJacksonHtml(rawHtml) {
  const result = {};

  // BJ uses Next.js RSC with double-escaped JSON in self.__next_f.push() calls.
  const html = rawHtml.replace(/\\\\"/g, '"').replace(/\\"/g, '"');

  // Strategy 0: RSC JSON title
  const rscTitleMatch = html.match(/"title"\s*:\s*"(\d{4}\s+[^"]+)"/);
  if (rscTitleMatch) {
    result.listing_title = titleCase(rscTitleMatch[1].trim());
  }

  // Strategy 1: Full RSC JSON data (year/make/model/style)
  let rawStyle = null;
  const ymmMatch = html.match(
    /"year"\s*:\s*"(\d{4})"\s*,\s*"make"\s*:\s*"([^"]+)"\s*,\s*"model"\s*:\s*"([^"]+)"\s*,\s*"style"\s*:\s*"([^"]*)"/
  );
  if (ymmMatch) {
    result.year = parseInt(ymmMatch[1]);
    result.make = titleCase(ymmMatch[2]);
    result.model = titleCase(ymmMatch[3]);
    if (ymmMatch[4]) {
      rawStyle = titleCase(ymmMatch[4]);
      const bs = normalizeBodyStyle(ymmMatch[4]);
      if (bs) result.body_style = bs;
    }
  }

  // Strategy 2: H1 tag
  if (!result.year || !result.make) {
    const h1Match = html.match(/<h1[^>]*>(\d{4})\s+([A-Z][A-Z\s]+)<\/h1>/i);
    if (h1Match) {
      if (!result.year) result.year = parseInt(h1Match[1]);
      const words = h1Match[2].trim().split(/\s+/);
      if (!result.make && words.length >= 1) result.make = titleCase(words[0]);
      if (!result.model && words.length >= 2) result.model = titleCase(words.slice(1).join(" "));
    }
  }

  // Strategy 3: Title tag
  if (!result.year || !result.make) {
    const titleMatch = html.match(/<title[^>]*>(\d{4})\s+([^<]+?)\s*-\s*Vehicle/i);
    if (titleMatch) {
      if (!result.year) result.year = parseInt(titleMatch[1]);
      const words = titleMatch[2].trim().split(/\s+/);
      if (!result.make && words.length >= 1) result.make = titleCase(words[0]);
      if (!result.model && words.length >= 2) result.model = titleCase(words.slice(1).join(" "));
    }
  }

  // VIN (accept 5-17 char chassis numbers)
  const vinMatch = html.match(/"vin"\s*:\s*"([^"]{5,17})"/);
  if (vinMatch?.[1]) {
    const v = cleanVin(vinMatch[1]);
    if (v) result.vin = v;
  }

  // Colors
  const extColor = html.match(/"exterior_color"\s*:\s*"([^"]+)"/);
  if (extColor?.[1]?.length > 0) result.color = titleCase(extColor[1]);

  const intColor = html.match(/"interior_color"\s*:\s*"([^"]+)"/);
  if (intColor?.[1]?.length > 0) result.interior_color = titleCase(intColor[1]);

  // Engine
  const engine = html.match(/"engine_size"\s*:\s*"([^"]+)"/);
  if (engine?.[1]?.length > 0) {
    result.engine_type = engine[1];
    const disp = engine[1].match(/([\d.]+)\s*-?\s*(?:liter|litre|l)\b/i);
    if (disp) result.engine_displacement = `${disp[1]}L`;
    const ci = engine[1].match(/(\d{2,3})(?:ci|cubic)/i);
    if (ci && !result.engine_displacement) result.engine_displacement = `${ci[1]}ci`;
  }

  // Cylinders
  const cyl = html.match(/"number_of_cylinders"\s*:\s*"(\d+)"/);
  if (cyl?.[1]) {
    const n = parseInt(cyl[1]);
    result.engine_type = result.engine_type ? `${result.engine_type} ${n}-cylinder` : `${n}-cylinder`;
  }

  // Transmission
  const trans = html.match(/"transmission_type_name"\s*:\s*"([^"]+)"/);
  if (trans?.[1]?.length > 0) result.transmission = titleCase(trans[1]);

  // Sale price (hammer price)
  let hammer = html.match(/"hammerPrice"\s*:\s*"?(\d+)"?/);
  if (!hammer) hammer = html.match(/"hammer_price"\s*:\s*"?(\d+)"?/);
  if (hammer?.[1]) {
    const price = parseInt(hammer[1]);
    if (price > 0) result.sale_price = price;
  }
  // Rendered "SOLD FOR $X" fallback
  if (!result.sale_price) {
    const sold = html.match(/SOLD\s+(?:FOR\s+)?\$([\d,]+)/i);
    if (sold) {
      const price = parseInt(sold[1].replace(/,/g, ""));
      if (price > 0) result.sale_price = price;
    }
  }

  // Full description
  const desc = html.match(/"full_description"\s*:\s*"([^"]{40,})"/);
  if (desc?.[1]) {
    result.description = desc[1].replace(/\\n/g, "\n").replace(/\\t/g, " ").slice(0, 2000);
  }
  // og:description fallback
  if (!result.description) {
    const ogDesc = html.match(/name="description"[^>]*content="([^"]{40,})"/i);
    if (ogDesc?.[1]) result.description = ogDesc[1].slice(0, 2000);
  }

  // Lot number
  const lot = html.match(/"lot_number"\s*:\s*"?(\d+[\.\d]*)"?/);
  if (lot?.[1]) result.lot_number = lot[1];

  // Reserve type
  const reserve = html.match(/"reserve_type_name"\s*:\s*"([^"]+)"/);
  if (reserve?.[1]?.toLowerCase().includes("no reserve")) {
    result.no_reserve = true;
  }

  // Mileage from description
  if (!result.mileage && result.description) {
    const mi = result.description.match(/([\d,]+)\s*(?:actual\s+)?miles?\b/i);
    if (mi) {
      const n = parseInt(mi[1].replace(/,/g, ""));
      if (n > 0 && n < 1_000_000) result.mileage = n;
    }
  }

  // Drivetrain from description
  if (!result.drivetrain && result.description) {
    const dt = normalizeDrivetrain(result.description);
    if (dt) result.drivetrain = dt;
  }

  // Horsepower from description
  if (result.description) {
    const hp = result.description.match(/(\d{2,4})\s*(?:hp|bhp|horsepower)/i);
    if (hp) result.horsepower = parseInt(hp[1]);
  }

  // Extract canonical series, trim_package, and body_style_facet from headline + description
  const facets = extractFacetsFromText(
    result.listing_title,
    result.make,
    result.model,
    rawStyle,
    result.description
  );
  if (facets.model) result.model = facets.model;
  if (facets.series) result.series = facets.series;
  if (facets.trim) result.trim = facets.trim;
  if (facets.body_style) result.body_style = facets.body_style;

  return result;
}

// ========== MAIN BACKFILL ==========

async function main() {
  console.log(`BJ Snapshot Backfill — batch=${BATCH_SIZE} dry_run=${DRY_RUN} force=${FORCE}`);
  const startTime = Date.now();
  let grandParsed = 0, grandUpdated = 0, grandFields = 0, grandErrors = 0;
  let round = 0;

  // PostgREST caps at 1000 rows, so loop until exhausted or BATCH_SIZE reached
  const PAGE_SIZE = Math.min(BATCH_SIZE, 1000);
  const remaining = () => BATCH_SIZE - grandParsed;

  while (remaining() > 0) {
    round++;
    const fetchSize = Math.min(PAGE_SIZE, remaining());

    // 1. Get unparsed BJ snapshots (snapshot-first)
    let query = sb
      .from("listing_page_snapshots")
      .select("id, listing_url, html_storage_path, metadata")
      .eq("platform", "barrett-jackson")
      .eq("success", true)
      .not("html_storage_path", "is", null)
      .order("fetched_at", { ascending: true })
      .limit(fetchSize);

    if (!FORCE) {
      query = query.filter("metadata->>bj_parsed_at", "is", "null");
    }

    const { data: snapshots, error: snapErr } = await query;
    if (snapErr) {
      if (snapErr.message?.includes('fetch failed') || snapErr.details?.includes('fetch failed')) {
        console.log('    Connection error — retrying in 10s...');
        await new Promise(r => setTimeout(r, 10000));
        continue; // retry this round
      }
      console.error("Query error:", snapErr); process.exit(1);
    }
    if (!snapshots?.length) {
      if (round === 1) console.log("No unparsed BJ snapshots.");
      break;
    }

    console.log(`Round ${round}: found ${snapshots.length} snapshots to process`);

    // 2. Collect all snapshot URLs and build normalized lookup
    const allNormUrls = [...new Set(snapshots.map(s => normalizeBjUrl(s.listing_url)))];

    // 3. Find matching vehicles (batched lookups - 10 URLs at a time)
    const vehicleByUrl = new Map();
    const CHUNK = 10;
    const allVehicles = [];
    for (let ci = 0; ci < allNormUrls.length; ci += CHUNK) {
      const chunk = allNormUrls.slice(ci, ci + CHUNK);
      const variants = [];
      for (const url of chunk) {
        variants.push(url);
        variants.push(url + "/");
        variants.push(url.replace("https://", "https://www."));
        variants.push(url.replace("https://", "https://www.") + "/");
      }

      const { data: vBatch } = await sb
        .from("vehicles")
        .select("id, listing_url, discovery_url, vin, description, color, engine_type, engine_displacement, transmission, sale_price, interior_color, body_style, drivetrain, mileage, horsepower, series, trim, listing_title")
        .is("deleted_at", null)
        .or(
          variants.map(u => `listing_url.eq.${u}`).join(",") + "," +
          variants.map(u => `discovery_url.eq.${u}`).join(",")
        )
        .limit(chunk.length * 2);

      if (vBatch) allVehicles.push(...vBatch);
    }

    for (const v of allVehicles) {
      if (v.listing_url) vehicleByUrl.set(normalizeBjUrl(v.listing_url), v);
      if (v.discovery_url) vehicleByUrl.set(normalizeBjUrl(v.discovery_url), v);
    }
    console.log(`  Matched ${allVehicles.length} vehicles`);

    // 4. Process each snapshot
    let parsed = 0, updated = 0, noVehicle = 0, errors = 0, alreadyFull = 0;
    let fieldsTotal = 0;
    const SUB_BATCH = 5; // Download concurrency

    for (let i = 0; i < snapshots.length; i += SUB_BATCH) {
      const batch = snapshots.slice(i, i + SUB_BATCH);

      await Promise.all(batch.map(async (snap) => {
        try {
          // Download HTML from storage
          const { data: blob, error: dlErr } = await sb.storage
            .from("listing-snapshots")
            .download(snap.html_storage_path);

          if (dlErr || !blob) {
            errors++;
            return;
          }

          const html = await blob.text();
          if (html.length < 500) { errors++; return; }

          // Parse
          const fields = parseBarrettJacksonHtml(html);
          const fieldCount = Object.keys(fields).filter(k => fields[k] != null).length;
          parsed++;

          // Find matching vehicle
          const normUrl = normalizeBjUrl(snap.listing_url);
          const vehicle = vehicleByUrl.get(normUrl);

          if (!vehicle) {
            noVehicle++;
            if (!DRY_RUN) {
              await sb.from("listing_page_snapshots").update({
                metadata: { ...(snap.metadata || {}), bj_parsed_at: new Date().toISOString(), bj_parser_version: VERSION, fields_found: fieldCount, vehicle_matched: false },
              }).eq("id", snap.id);
            }
            return;
          }

          // Gap-fill: only set null fields
          const fieldMap = {
            vin: "vin", mileage: "mileage", engine_type: "engine_type",
            engine_displacement: "engine_displacement", transmission: "transmission",
            drivetrain: "drivetrain", body_style: "body_style", color: "color",
            interior_color: "interior_color", description: "description",
            sale_price: "sale_price", horsepower: "horsepower",
            series: "series", trim: "trim", listing_title: "listing_title",
          };

          const updatePayload = {};
          const filledFields = [];
          for (const [parsedKey, dbField] of Object.entries(fieldMap)) {
            const newVal = fields[parsedKey];
            if (newVal == null || (typeof newVal === "string" && newVal.trim() === "")) continue;
            const existing = vehicle[dbField];
            if (existing == null || (typeof existing === "string" && existing.trim() === "")) {
              updatePayload[dbField] = newVal;
              filledFields.push(dbField);
            }
          }

          if (filledFields.length > 0) {
            if (!DRY_RUN) {
              updatePayload.extractor_version = VERSION;
              updatePayload.updated_at = new Date().toISOString();
              const { error: upErr } = await sb.from("vehicles").update(updatePayload).eq("id", vehicle.id);
              if (upErr) {
                if (upErr.message?.includes("unique") && updatePayload.vin) {
                  delete updatePayload.vin;
                  const idx = filledFields.indexOf("vin");
                  if (idx >= 0) filledFields.splice(idx, 1);
                  if (filledFields.length > 0) {
                    await sb.from("vehicles").update(updatePayload).eq("id", vehicle.id);
                  }
                } else {
                  errors++;
                  return;
                }
              }
            }
            updated++;
            fieldsTotal += filledFields.length;
            if (updated <= 20 || updated % 50 === 0) {
              console.log(`  [${grandParsed + parsed}] ${fields.year || "?"} ${fields.make || "?"} ${fields.model || "?"} → ${filledFields.join(", ")}`);
            }
          } else {
            alreadyFull++;
          }

          // Mark snapshot as parsed
          if (!DRY_RUN) {
            await sb.from("listing_page_snapshots").update({
              metadata: {
                ...(snap.metadata || {}),
                bj_parsed_at: new Date().toISOString(),
                bj_parser_version: VERSION,
                fields_found: fieldCount,
                vehicle_matched: true,
                vehicle_id: vehicle.id,
              },
            }).eq("id", snap.id);
          }
        } catch (e) {
          console.log(`  ERR: ${e.message?.slice(0, 100)}`);
          errors++;
        }
      }));

      // Progress every 250 snapshots
      if ((i + SUB_BATCH) % 250 === 0) {
        console.log(`  Progress: ${i + SUB_BATCH}/${snapshots.length} parsed=${parsed} updated=${updated} fields=${fieldsTotal}`);
      }
    }

    grandParsed += parsed;
    grandUpdated += updated;
    grandFields += fieldsTotal;
    grandErrors += errors;

    const roundElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  Round ${round} done: parsed=${parsed} updated=${updated} fields=${fieldsTotal} errors=${errors} noMatch=${noVehicle} full=${alreadyFull} (${roundElapsed}s total)`);

    // If we got fewer than requested, no more snapshots remain
    if (snapshots.length < fetchSize) break;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n=== RESULTS (${elapsed}s, ${round} rounds) ===`);
  console.log(`Snapshots processed: ${grandParsed}`);
  console.log(`Vehicles updated: ${grandUpdated}`);
  console.log(`Fields filled: ${grandFields}`);
  console.log(`Errors: ${grandErrors}`);
}

main().catch(e => { console.error(e); process.exit(1); });
