/**
 * ENRICH BULK — Multi-strategy high-throughput vehicle enrichment
 *
 * Strategies (pass as "strategy" in body):
 *
 *   vin_decode          — NHTSA batch VIN decode (body_style, engine, transmission, fuel, HP, doors)
 *   mine_descriptions   — Regex extraction from descriptions (VIN, mileage, color, engine, trans, body_style)
 *   cross_reference     — Pull sale_price, asking_price, description from vehicle_events + snapshots
 *   derive_fields       — Compute country_of_origin, body_style from make/model
 *   estimate_hp         — HP estimation from displacement + known engine families
 *   backfill_location   — Parse listing_location, pull from events, reverse-geocode iPhoto GPS
 *   smart_primary_image — Score vehicle images and pick best hero shot
 *   vin_link_suggestions — Find VIN-linked records, suggest enrichment candidates (no auto-merge)
 *   stats               — Show enrichment gaps across all sources
 *
 * Designed for cron: each invocation processes a batch and returns stats.
 * Target: 500-1000 vehicles per invocation depending on strategy.
 *
 * Deploy: supabase functions deploy enrich-bulk --no-verify-jwt
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function okJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ─── NHTSA VIN Decode ────────────────────────────────────────────────

interface NHTSAResult {
  VIN: string;
  BodyClass: string;
  TransmissionStyle: string;
  DisplacementL: string;
  EngineCylinders: string;
  EngineConfiguration: string;
  EngineHP: string;
  FuelTypePrimary: string;
  DriveType: string;
  Doors: string;
  Make: string;
  Model: string;
  ModelYear: string;
  PlantCountry: string;
  Series: string;
  Trim: string;
  GVWR: string;
  ErrorCode: string;
  [key: string]: string;
}

async function decodeSingleVin(vin: string): Promise<NHTSAResult | null> {
  try {
    const resp = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${vin}?format=json`,
      { signal: AbortSignal.timeout(15000) }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.Results?.[0] || null;
  } catch {
    return null;
  }
}

async function decodeVinsConcurrently(
  vins: { id: string; vin: string }[],
  concurrency: number
): Promise<{ id: string; vin: string; result: NHTSAResult }[]> {
  const results: { id: string; vin: string; result: NHTSAResult }[] = [];
  for (let i = 0; i < vins.length; i += concurrency) {
    const chunk = vins.slice(i, i + concurrency);
    const decoded = await Promise.all(
      chunk.map(async (c) => {
        const result = await decodeSingleVin(c.vin);
        return result ? { id: c.id, vin: c.vin, result } : null;
      })
    );
    for (const d of decoded) {
      if (d) results.push(d);
    }
  }
  return results;
}

async function handleVinDecode(
  supabase: ReturnType<typeof createClient>,
  body: Record<string, unknown>
) {
  const limit = Math.min(Number(body.limit) || 200, 500);
  const concurrency = Math.min(Number(body.concurrency) || 20, 50);

  // Get vehicles with 17-char VINs missing fields NHTSA can provide
  // Use source filter if provided for index usage, otherwise scan by VIN pattern
  const source = body.source ? String(body.source) : null;
  let query = supabase.from("vehicles")
    .select("id, vin, body_style, engine_type, horsepower, origin_metadata")
    .is("deleted_at", null)
    .not("vin", "is", null)
    .or("body_style.is.null,engine_type.is.null,horsepower.is.null")
    .limit(limit);

  if (source) {
    query = query.eq("discovery_source", source);
  }

  const { data: rawCandidates, error } = await query;

  if (error) throw new Error(`Fetch error: ${error.message}`);

  // Filter in JS: 17-char valid VIN, not already decoded
  const candidates = (rawCandidates || []).filter((v: any) =>
    v.vin?.length === 17 &&
    /^[1-9A-HJ-NPR-Z][A-HJ-NPR-Z0-9]{16}$/.test(v.vin) &&
    !v.origin_metadata?.vin_decoded
  );

  if (!candidates.length) return okJson({ success: true, strategy: "vin_decode", message: "No candidates", processed: 0 });

  const results = { total: candidates.length, updated: 0, skipped: 0, errors: 0, fields: {} as Record<string, number> };

  // Decode all VINs concurrently (individual NHTSA API calls)
  const decoded = await decodeVinsConcurrently(candidates, concurrency);

  // Process results: build update patch for each vehicle
  const allUpdates: { id: string; patch: Record<string, unknown> }[] = [];

  for (const { id, result } of decoded) {
    const cand = candidates.find((c: any) => c.id === id);
    const hasData = result.BodyClass || result.TransmissionStyle || result.EngineHP || result.DisplacementL;
    const patch: Record<string, unknown> = {};

    if (result.BodyClass && result.BodyClass !== "Not Applicable" && !cand?.body_style) {
      patch.body_style = result.BodyClass;
      results.fields.body_style = (results.fields.body_style || 0) + 1;
    }
    if (result.TransmissionStyle && !cand?.transmission) {
      patch.transmission = result.TransmissionStyle;
      results.fields.transmission = (results.fields.transmission || 0) + 1;
    }
    if (result.DisplacementL && result.DisplacementL !== "0" && !cand?.engine_type) {
      const cyl = result.EngineCylinders || "";
      const config = result.EngineConfiguration || "";
      patch.engine_type = `${result.DisplacementL}L ${config} ${cyl}cyl`.replace(/\s+/g, " ").trim();
      patch.displacement = result.DisplacementL;
      results.fields.engine_type = (results.fields.engine_type || 0) + 1;
    }
    if (result.EngineHP && result.EngineHP !== "0" && !cand?.horsepower) {
      const hp = parseInt(result.EngineHP, 10);
      if (hp > 0) { patch.horsepower = hp; results.fields.horsepower = (results.fields.horsepower || 0) + 1; }
    }
    if (result.FuelTypePrimary) {
      patch.fuel_type = result.FuelTypePrimary;
      results.fields.fuel_type = (results.fields.fuel_type || 0) + 1;
    }
    if (result.Doors && result.Doors !== "0") {
      const doors = parseInt(result.Doors, 10);
      if (doors > 0) { patch.doors = doors; results.fields.doors = (results.fields.doors || 0) + 1; }
    }
    if (result.Trim) {
      patch.trim = result.Trim;
      results.fields.trim = (results.fields.trim || 0) + 1;
    }
    if (result.DriveType) {
      patch.drivetrain = result.DriveType;
      results.fields.drivetrain = (results.fields.drivetrain || 0) + 1;
    }

    // Mark as VIN decoded + plant country in origin_metadata
    const meta = { ...(cand?.origin_metadata || {}), vin_decoded: true };
    if (result.PlantCountry) meta.plant_country = result.PlantCountry;
    patch.origin_metadata = meta;

    allUpdates.push({ id, patch });
    if (hasData) results.updated++;
    else results.skipped++;
  }

  // Mark VINs that NHTSA couldn't decode (no response) as decoded too
  const decodedIds = new Set(decoded.map(d => d.id));
  for (const c of candidates) {
    if (!decodedIds.has(c.id)) {
      allUpdates.push({
        id: c.id,
        patch: { origin_metadata: { ...(c.origin_metadata || {}), vin_decoded: true } },
      });
      results.skipped++;
    }
  }

  // Apply all updates concurrently (20 at a time via PostgREST)
  for (let i = 0; i < allUpdates.length; i += 20) {
    const chunk = allUpdates.slice(i, i + 20);
    await Promise.all(
      chunk.map(({ id, patch }) =>
        supabase.from("vehicles").update(patch).eq("id", id)
      )
    );
  }

  return okJson({ success: true, strategy: "vin_decode", ...results });
}

// ─── Description Mining ──────────────────────────────────────────────

// VIN check digit validation (position 9)
function isValidVinCheckDigit(vin: string): boolean {
  const transliteration: Record<string, number> = {
    A:1,B:2,C:3,D:4,E:5,F:6,G:7,H:8,J:1,K:2,L:3,M:4,N:5,P:7,R:9,
    S:2,T:3,U:4,V:5,W:6,X:7,Y:8,Z:9,
  };
  const weights = [8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2];
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const c = vin[i];
    const val = /\d/.test(c) ? parseInt(c, 10) : (transliteration[c] || 0);
    sum += val * weights[i];
  }
  const remainder = sum % 11;
  const checkChar = remainder === 10 ? "X" : String(remainder);
  return vin[8] === checkChar;
}

async function handleMineDescriptions(
  supabase: ReturnType<typeof createClient>,
  body: Record<string, unknown>
) {
  const limit = Math.min(Number(body.limit) || 200, 500);
  const source = body.source ? String(body.source) : null;
  const results = {
    total: 0, source: source || "all",
    mileage_set: 0, trans_set: 0, body_set: 0,
    vin_set: 0, color_set: 0, engine_set: 0,
  };

  // Fetch vehicles with descriptions that need fields
  let query = supabase.from("vehicles")
    .select("id, description, model, mileage, transmission, body_style, vin, color, engine_type")
    .is("deleted_at", null)
    .not("description", "is", null)
    .limit(limit);

  if (source) query = query.eq("discovery_source", source);

  // Filter to vehicles missing at least one mineable field
  query = query.or("mileage.is.null,transmission.is.null,body_style.is.null,vin.is.null,color.is.null,engine_type.is.null");

  const { data: vehicles, error } = await query;
  if (error) throw new Error(`Fetch error: ${error.message}`);
  if (!vehicles?.length) return okJson({ ...results, message: "No candidates" });

  results.total = vehicles.length;

  // Mine fields locally in JS and batch update
  const TRANS_PATTERNS: [RegExp, string][] = [
    [/(\d-speed\s+manual)/i, "$1"],
    [/(\d-speed\s+automatic)/i, "$1"],
    [/\bmanual\s+transmission/i, "Manual"],
    [/\bautomatic\s+transmission/i, "Automatic"],
    [/\bPDK\b/i, "PDK"],
    [/\bCVT\b/i, "CVT"],
    [/\bDSG\b/i, "DSG"],
    [/\bSMG\b/i, "SMG"],
    [/\bTiptronic\b/i, "Tiptronic"],
  ];

  const BODY_PATTERNS: [RegExp, string][] = [
    [/\b(coupe|coupé|berlinetta|fastback)\b/i, "Coupe"],
    [/\b(convertible|cabriolet|roadster|spider|spyder|drophead|volante|targa|speedster)\b/i, "Convertible"],
    [/\b(sedan|saloon|berlina)\b/i, "Sedan"],
    [/\b(wagon|estate|touring|avant|sportwagen|allroad)\b/i, "Wagon"],
    [/\b(hatchback)\b/i, "Hatchback"],
    [/\b(pickup|truck)\b/i, "Truck"],
    [/\bSUV\b/i, "SUV"],
    [/\b(van|minivan|bus)\b/i, "Van"],
  ];

  const MILEAGE_RE = /(\d[\d,]*\d)\s+(?:actual\s+)?(?:original\s+)?miles/i;

  // VIN patterns: "VIN: ...", "Chassis #...", "VIN ...", or standalone 17-char
  const VIN_PATTERNS = [
    /VIN[:#\s]+([A-HJ-NPR-Z0-9]{17})\b/i,
    /Chassis\s*#?\s*:?\s*([A-HJ-NPR-Z0-9]{17})\b/i,
    /Serial\s*#?\s*:?\s*([A-HJ-NPR-Z0-9]{17})\b/i,
    /\b([A-HJ-NPR-Z0-9]{17})\b/,  // standalone 17-char — validated by check digit
  ];

  // Color patterns: common colors + contextual phrases
  const COLOR_WORDS = "black|white|silver|gray|grey|red|blue|green|yellow|gold|orange|brown|tan|beige|cream|maroon|burgundy|navy|bronze|copper|champagne|pearl|ivory|charcoal|gunmetal|platinum|midnight|arctic|alpine|british racing green|guards red|signal red|arrow blue|rally red|hugger orange|cranberry|aqua|teal|purple|lavender|lime|olive|rust|wine|pewter|slate|denim|cobalt|emerald|saffron|papaya|rosso corsa|azzurro|giallo|grigio|nero|bianco|verde|argento|blu|rosa";
  const COLOR_RE = new RegExp(`(?:painted\\s+(?:in\\s+)?|finished\\s+in\\s+|exterior\\s+(?:is\\s+|in\\s+|color\\s+(?:is\\s+)?)?|color[:\\s]+)((?:${COLOR_WORDS})(?:\\s+(?:metallic|pearl|mica|mist|frost|crystal|clearcoat))?)\\b`, "i");
  const SIMPLE_COLOR_RE = new RegExp(`\\b(${COLOR_WORDS})\\s+(?:exterior|paint|finish)\\b`, "i");

  // Engine patterns
  const ENGINE_PATTERNS = [
    /\b(\d\.\d)\s*(?:L|liter|litre)\s*(V\d+|inline[- ]?\d+|flat[- ]?\d+|I\d+|H\d+)?/i,
    /\b(V[68]|V10|V12|I[46]|flat[- ]?[46]|inline[- ]?[46]|straight[- ]?[46])\b/i,
    /\b(\d{3})\s*(?:ci|cid|cubic[- ]?inch)/i,
  ];

  // Process each vehicle and build updates
  const updates: { id: string; patch: Record<string, unknown> }[] = [];

  for (const v of vehicles) {
    const desc = v.description || "";
    const model = v.model || "";
    const searchText = model + " " + desc.slice(0, 2000);
    const patch: Record<string, unknown> = {};

    // VIN extraction (only if vehicle has no VIN)
    if (!v.vin) {
      for (const re of VIN_PATTERNS) {
        const m = desc.match(re);
        if (m && m[1]) {
          const candidate = m[1].toUpperCase();
          // Validate: must start with 1-9 or A-Z, check digit validates
          if (/^[1-9A-HJ-NPR-Z]/.test(candidate) && isValidVinCheckDigit(candidate)) {
            patch.vin = candidate;
            results.vin_set++;
            break;
          }
        }
      }
    }

    // Color extraction (only if vehicle has no color)
    if (!v.color) {
      const cm = desc.match(COLOR_RE) || desc.match(SIMPLE_COLOR_RE);
      if (cm && cm[1]) {
        // Capitalize first letter of each word
        patch.color = cm[1].trim().replace(/\b\w/g, (c: string) => c.toUpperCase());
        results.color_set++;
      }
    }

    // Engine extraction (only if vehicle has no engine_type)
    if (!v.engine_type) {
      for (const re of ENGINE_PATTERNS) {
        const m = desc.match(re);
        if (m) {
          if (re === ENGINE_PATTERNS[0]) {
            // "X.XL V8" pattern
            patch.engine_type = `${m[1]}L${m[2] ? " " + m[2] : ""}`.trim();
          } else if (re === ENGINE_PATTERNS[2]) {
            // "XXXci" pattern — convert to liters
            const ci = parseInt(m[1], 10);
            const liters = (ci * 0.016387).toFixed(1);
            patch.engine_type = `${liters}L (${ci}ci)`;
          } else {
            // "V8" / "inline-6" pattern
            patch.engine_type = m[1];
          }
          results.engine_set++;
          break;
        }
      }
    }

    if (!v.mileage) {
      const m = desc.match(MILEAGE_RE);
      if (m) {
        const miles = parseInt(m[1].replace(/,/g, ""), 10);
        if (miles > 0 && miles < 1000000) {
          patch.mileage = miles;
          results.mileage_set++;
        }
      }
    }

    if (!v.transmission) {
      for (const [re, replacement] of TRANS_PATTERNS) {
        const m = desc.match(re);
        if (m) {
          patch.transmission = replacement.startsWith("$") ? m[1] : replacement;
          results.trans_set++;
          break;
        }
      }
    }

    if (!v.body_style) {
      for (const [re, value] of BODY_PATTERNS) {
        if (re.test(searchText)) {
          patch.body_style = value;
          results.body_set++;
          break;
        }
      }
    }

    if (Object.keys(patch).length > 0) {
      updates.push({ id: v.id, patch });
    }
  }

  // Apply updates concurrently (20 at a time)
  for (let i = 0; i < updates.length; i += 20) {
    const chunk = updates.slice(i, i + 20);
    await Promise.all(
      chunk.map(({ id, patch }) =>
        supabase.from("vehicles").update(patch).eq("id", id)
      )
    );
  }

  return okJson({ success: true, strategy: "mine_descriptions", ...results, updates_applied: updates.length });
}

// ─── Cross Reference ─────────────────────────────────────────────────

async function handleCrossReference(
  supabase: ReturnType<typeof createClient>,
  body: Record<string, unknown>
) {
  const limit = Math.min(Number(body.limit) || 200, 500);
  const results = { sale_price_from_bat: 0, sale_price_from_ext: 0, asking_price_set: 0, description_set: 0, total: 0 };

  // 1. Get vehicle_events (bat) with final_price that aren't on the vehicle yet
  const { data: batListings } = await supabase
    .from("vehicle_events")
    .select("vehicle_id, final_price")
    .eq("source_platform", "bat")
    .not("final_price", "is", null)
    .gt("final_price", 0)
    .not("vehicle_id", "is", null)
    .limit(limit);

  if (batListings?.length) {
    // Check which vehicles need sale_price
    const vehicleIds = batListings.map(b => b.vehicle_id);
    const { data: vehicles } = await supabase
      .from("vehicles")
      .select("id")
      .in("id", vehicleIds)
      .is("sale_price", null)
      .is("deleted_at", null);

    if (vehicles?.length) {
      const needsPrice = new Set(vehicles.map(v => v.id));
      const updates = batListings.filter(b => needsPrice.has(b.vehicle_id));
      for (let i = 0; i < updates.length; i += 20) {
        const chunk = updates.slice(i, i + 20);
        await Promise.all(
          chunk.map(({ vehicle_id, final_price }: any) =>
            supabase.from("vehicles").update({ sale_price: final_price }).eq("id", vehicle_id)
          )
        );
      }
      results.sale_price_from_bat = updates.length;
    }
  }

  // 2. Get vehicle_events with final_price (non-bat platforms)
  const { data: extListings } = await supabase
    .from("vehicle_events")
    .select("vehicle_id, final_price")
    .not("final_price", "is", null)
    .gt("final_price", 0)
    .not("vehicle_id", "is", null)
    .limit(limit);

  if (extListings?.length) {
    const vehicleIds = [...new Set(extListings.map(e => e.vehicle_id))];
    const { data: vehicles } = await supabase
      .from("vehicles")
      .select("id")
      .in("id", vehicleIds)
      .is("sale_price", null)
      .is("deleted_at", null);

    if (vehicles?.length) {
      const needsPrice = new Set(vehicles.map(v => v.id));
      const updates = extListings.filter(e => needsPrice.has(e.vehicle_id));
      // De-dupe by vehicle_id (take first)
      const seen = new Set<string>();
      const deduped = updates.filter(e => {
        if (seen.has(e.vehicle_id)) return false;
        seen.add(e.vehicle_id);
        return true;
      });
      for (let i = 0; i < deduped.length; i += 20) {
        const chunk = deduped.slice(i, i + 20);
        await Promise.all(
          chunk.map(({ vehicle_id, final_price }) =>
            supabase.from("vehicles").update({ sale_price: Math.round(Number(final_price)) }).eq("id", vehicle_id)
          )
        );
      }
      results.sale_price_from_ext = deduped.length;
    }
  }

  // 3. Backfill asking_price from listing events
  {
    const { data: listingEvents } = await supabase
      .from("vehicle_events")
      .select("vehicle_id, metadata")
      .eq("event_type", "listing")
      .not("vehicle_id", "is", null)
      .not("metadata", "is", null)
      .limit(limit);

    if (listingEvents?.length) {
      const withPrice = listingEvents.filter((e: any) =>
        e.metadata?.asking_price && Number(e.metadata.asking_price) > 0
      );
      if (withPrice.length) {
        const vehicleIds = [...new Set(withPrice.map((e: any) => e.vehicle_id))];
        const { data: vehicles } = await supabase
          .from("vehicles")
          .select("id")
          .in("id", vehicleIds)
          .is("asking_price", null)
          .is("sale_price", null)
          .is("deleted_at", null);

        if (vehicles?.length) {
          const needsPrice = new Set(vehicles.map((v: any) => v.id));
          const updates = withPrice.filter((e: any) => needsPrice.has(e.vehicle_id));
          const seen = new Set<string>();
          const deduped = updates.filter((e: any) => {
            if (seen.has(e.vehicle_id)) return false;
            seen.add(e.vehicle_id);
            return true;
          });
          for (let i = 0; i < deduped.length; i += 20) {
            await Promise.all(
              deduped.slice(i, i + 20).map((e: any) =>
                supabase.from("vehicles").update({
                  asking_price: Math.round(Number(e.metadata.asking_price)),
                }).eq("id", e.vehicle_id)
              )
            );
          }
          results.asking_price_set = deduped.length;
        }
      }
    }
  }

  // 4. Backfill description from listing_page_snapshots
  {
    const { data: snapshots } = await supabase.rpc("execute_sql", {
      query: `
        SELECT DISTINCT ON (lps.vehicle_id) lps.vehicle_id,
          COALESCE(
            lps.metadata->>'description',
            left(lps.markdown_content, 2000)
          ) as desc_text
        FROM listing_page_snapshots lps
        JOIN vehicles v ON v.id = lps.vehicle_id
        WHERE v.description IS NULL AND v.deleted_at IS NULL
          AND lps.vehicle_id IS NOT NULL
          AND (lps.metadata->>'description' IS NOT NULL OR lps.markdown_content IS NOT NULL)
        ORDER BY lps.vehicle_id, lps.created_at DESC
        LIMIT ${limit}
      `,
    });

    const rows = Array.isArray(snapshots) ? snapshots : [];
    if (rows.length) {
      for (let i = 0; i < rows.length; i += 20) {
        await Promise.all(
          rows.slice(i, i + 20).map((r: any) =>
            supabase.from("vehicles").update({
              description: r.desc_text?.slice(0, 10000),
            }).eq("id", r.vehicle_id)
          )
        );
      }
      results.description_set = rows.length;
    }
  }

  results.total = results.sale_price_from_bat + results.sale_price_from_ext + results.asking_price_set + results.description_set;
  return okJson({ success: true, strategy: "cross_reference", ...results });
}

// ─── Derived Fields ──────────────────────────────────────────────────

const MAKE_COUNTRY: Record<string, string> = {
  // USA
  ford: "USA", chevrolet: "USA", dodge: "USA", plymouth: "USA", pontiac: "USA",
  cadillac: "USA", lincoln: "USA", buick: "USA", chrysler: "USA", jeep: "USA",
  gmc: "USA", oldsmobile: "USA", mercury: "USA", shelby: "USA", tesla: "USA",
  corvette: "USA", ram: "USA", hummer: "USA", saturn: "USA", studebaker: "USA",
  packard: "USA", hudson: "USA", nash: "USA", desoto: "USA", tucker: "USA",
  duesenberg: "USA", cord: "USA", auburn: "USA", "pierce-arrow": "USA",
  // Germany
  bmw: "Germany", mercedes: "Germany", "mercedes-benz": "Germany", porsche: "Germany",
  audi: "Germany", volkswagen: "Germany", vw: "Germany", opel: "Germany",
  maybach: "Germany",
  // UK
  "rolls-royce": "UK", bentley: "UK", jaguar: "UK", "aston martin": "UK",
  "land rover": "UK", lotus: "UK", mclaren: "UK", mg: "UK", triumph: "UK",
  "austin-healey": "UK", morgan: "UK", tvr: "UK", "ac": "UK", sunbeam: "UK",
  rover: "UK", mini: "UK",
  // Italy
  ferrari: "Italy", lamborghini: "Italy", maserati: "Italy", "alfa romeo": "Italy",
  fiat: "Italy", lancia: "Italy", "de tomaso": "Italy", pagani: "Italy",
  iso: "Italy", bizzarrini: "Italy",
  // Japan
  toyota: "Japan", honda: "Japan", nissan: "Japan", mazda: "Japan", subaru: "Japan",
  mitsubishi: "Japan", lexus: "Japan", infiniti: "Japan", acura: "Japan",
  datsun: "Japan", suzuki: "Japan",
  // France
  bugatti: "France", citroen: "France", citroën: "France", peugeot: "France",
  renault: "France", alpine: "France", delahaye: "France",
  // Sweden
  volvo: "Sweden", saab: "Sweden", koenigsegg: "Sweden",
  // Korea
  hyundai: "Korea", kia: "Korea", genesis: "Korea",
};

async function handleDeriveFields(
  supabase: ReturnType<typeof createClient>,
  body: Record<string, unknown>
) {
  const limit = Math.min(Number(body.limit) || 200, 500);
  const source = body.source ? String(body.source) : null;
  const results = { source: source || "all", body_style_inferred: 0, country_set: 0, total: 0 };

  const BODY_PATTERNS: [RegExp, string][] = [
    [/\b(coupe|coupé|berlinetta|fastback)\b/i, "Coupe"],
    [/\b(convertible|cabriolet|roadster|spider|spyder|drophead|volante|targa|speedster|barchetta)\b/i, "Convertible"],
    [/\b(sedan|saloon|berlina|limousine)\b/i, "Sedan"],
    [/\b(wagon|estate|touring|avant|sportwagen|allroad|variant|kombi)\b/i, "Wagon"],
    [/\b(hatchback)\b/i, "Hatchback"],
    [/\b(pickup|truck|raptor|f-150|f-250|f-350|silverado|sierra|ram|ranger|tacoma|tundra|k10|k20|k30|c10|c20|c30|k1500|k2500|k3500|c1500|c2500|c3500|s10|s15|colorado|canyon|el camino|ranchero|power wagon|dakota|comanche|luv|d100|d150|d200|d250|w100|w150|w200|w250)\b/i, "Truck"],
    [/\b(suv|wrangler|bronco|blazer|tahoe|suburban|4runner|land cruiser|defender|range rover|cayenne|urus|x5|q7|gls|k5|scout|jimmy|ramcharger|trailblazer|yukon|expedition|explorer|cherokee|grand cherokee|wagoneer|fj40|fj60|fj80|trooper|samurai)\b/i, "SUV"],
    [/\b(van|minivan|bus|transporter|vanagon|westfalia)\b/i, "Van"],
  ];

  // 1. Fetch vehicles missing body_style with a model name
  let bodyQuery = supabase
    .from("vehicles")
    .select("id, model")
    .is("deleted_at", null)
    .is("body_style", null)
    .not("model", "is", null)
    .limit(limit);
  if (source) bodyQuery = bodyQuery.eq("discovery_source", source);
  const { data: bodyVehicles } = await bodyQuery;

  if (bodyVehicles?.length) {
    const updates: { id: string; body_style: string }[] = [];
    for (const v of bodyVehicles) {
      for (const [re, value] of BODY_PATTERNS) {
        if (re.test(v.model)) {
          updates.push({ id: v.id, body_style: value });
          results.body_style_inferred++;
          break;
        }
      }
    }
    for (let i = 0; i < updates.length; i += 20) {
      await Promise.all(
        updates.slice(i, i + 20).map(({ id, body_style }) =>
          supabase.from("vehicles").update({ body_style }).eq("id", id)
        )
      );
    }
  }

  // 2. Fetch vehicles needing country_of_origin
  let countryQuery = supabase
    .from("vehicles")
    .select("id, make, origin_metadata")
    .is("deleted_at", null)
    .not("make", "is", null)
    .limit(limit);
  if (source) countryQuery = countryQuery.eq("discovery_source", source);
  const { data: countryVehicles } = await countryQuery;

  if (countryVehicles?.length) {
    const updates: { id: string; origin_metadata: Record<string, unknown> }[] = [];
    for (const v of countryVehicles) {
      if (v.origin_metadata?.country_of_origin) continue;
      const country = MAKE_COUNTRY[v.make.toLowerCase()];
      if (country) {
        updates.push({
          id: v.id,
          origin_metadata: { ...(v.origin_metadata || {}), country_of_origin: country },
        });
        results.country_set++;
      }
    }
    for (let i = 0; i < updates.length; i += 20) {
      await Promise.all(
        updates.slice(i, i + 20).map(({ id, origin_metadata }) =>
          supabase.from("vehicles").update({ origin_metadata }).eq("id", id)
        )
      );
    }
  }

  results.total = results.body_style_inferred + results.country_set;
  return okJson({ success: true, strategy: "derive_fields", ...results });
}

// ─── HP Estimation ──────────────────────────────────────────────────

// ── Known Engine Families: stock HP by make/displacement/year ──
// Data from factory ratings (SAE net where available, gross pre-1972)
// Format: { make_pattern, disp_min, disp_max, year_min, year_max, hp_net, torque, notes, is_truck }
interface KnownEngine {
  make: RegExp;
  model?: RegExp;       // optional model pattern for precision
  dispMin: number;      // displacement L min
  dispMax: number;      // displacement L max
  yearMin: number;
  yearMax: number;
  hp: number;           // SAE net HP (or gross-adjusted for pre-72)
  torque?: number;      // lb-ft
  isTruck: boolean;     // truck/van/SUV tune
  rpoCode?: string;     // RPO/engine code
  fuelSys?: string;     // "carb"|"tbi"|"mpfi"|"sefi" — overrides year-based EFI detection
  notes?: string;
}

const KNOWN_ENGINES: KnownEngine[] = [
  // ── Chevy 350 SBC (5.7L) ──
  { make: /chevrolet|chevy|corvette|camaro|pontiac|gmc/i, dispMin: 5.6, dispMax: 5.8, yearMin: 1967, yearMax: 1971, hp: 250, isTruck: false, fuelSys: "carb", rpoCode: "L48", notes: "350/295 gross ≈ 250 net, Rochester 4V" },
  { make: /chevrolet|chevy|corvette|camaro/i, dispMin: 5.6, dispMax: 5.8, yearMin: 1970, yearMax: 1973, hp: 280, isTruck: false, fuelSys: "carb", rpoCode: "LT-1", notes: "370 gross → ~280 net, high-perf solid lifter, Holley 4V" },
  { make: /chevrolet|chevy/i, dispMin: 5.6, dispMax: 5.8, yearMin: 1972, yearMax: 1975, hp: 175, isTruck: false, fuelSys: "carb", rpoCode: "L48", notes: "Malaise era, 8.5:1 CR, net rated, Rochester Q-jet" },
  { make: /chevrolet|chevy|corvette/i, dispMin: 5.6, dispMax: 5.8, yearMin: 1975, yearMax: 1981, hp: 180, isTruck: false, fuelSys: "carb", rpoCode: "L48/L82", notes: "165-195 net, Rochester Q-jet, HEI ignition" },
  // Chevy 350 carb truck (pre-TBI, through 1986)
  { make: /chevrolet|chevy|gmc/i, dispMin: 5.6, dispMax: 5.8, yearMin: 1973, yearMax: 1987, hp: 175, isTruck: true, fuelSys: "carb", notes: "Carb truck 350, Rochester 4V, 160-175hp, single exhaust" },
  { make: /chevrolet|chevy|corvette|camaro|pontiac/i, dispMin: 5.6, dispMax: 5.8, yearMin: 1985, yearMax: 1992, hp: 240, isTruck: false, fuelSys: "mpfi", rpoCode: "L98", notes: "TPI 230-250hp, Corvette/F-body, tuned-port injection" },
  { make: /chevrolet|chevy|corvette|camaro|pontiac/i, dispMin: 5.6, dispMax: 5.8, yearMin: 1992, yearMax: 1998, hp: 290, isTruck: false, fuelSys: "mpfi", rpoCode: "LT1", notes: "275-300hp, Corvette top end, sequential fuel injection" },
  { make: /chevrolet|chevy|corvette/i, model: /lt4|z06/i, dispMin: 5.6, dispMax: 5.8, yearMin: 1996, yearMax: 1998, hp: 330, isTruck: false, fuelSys: "mpfi", rpoCode: "LT4", notes: "330hp, hot rod LT1" },
  // Chevy 350 TRUCK TBI ('87+) — GM trucks got TBI in 1987 model year
  { make: /chevrolet|chevy|gmc/i, dispMin: 5.6, dispMax: 5.8, yearMin: 1987, yearMax: 1995, hp: 210, isTruck: true, fuelSys: "tbi", rpoCode: "L05", notes: "TBI truck 350 (1987+), swirl heads, 190-210hp" },
  { make: /chevrolet|chevy|gmc/i, dispMin: 5.6, dispMax: 5.8, yearMin: 1996, yearMax: 2002, hp: 255, isTruck: true, fuelSys: "mpfi", rpoCode: "L31", notes: "Vortec 5700, MPFI, truck/SUV" },

  // ── Chevy 305 SBC (5.0L) ──
  { make: /chevrolet|chevy|pontiac/i, dispMin: 4.9, dispMax: 5.1, yearMin: 1976, yearMax: 1987, hp: 155, isTruck: false, fuelSys: "carb", rpoCode: "LG3/LG4", notes: "150-165hp, economy 305, Rochester 2V/4V" },
  { make: /chevrolet|chevy|pontiac|camaro/i, dispMin: 4.9, dispMax: 5.1, yearMin: 1987, yearMax: 1993, hp: 190, isTruck: false, fuelSys: "mpfi", rpoCode: "LB9", notes: "TPI 305, 190-215hp" },
  // 305 truck TBI
  { make: /chevrolet|chevy|gmc/i, dispMin: 4.9, dispMax: 5.1, yearMin: 1987, yearMax: 1995, hp: 170, isTruck: true, fuelSys: "tbi", notes: "TBI truck 305, 170hp" },

  // ── Chevy 400 SBC (6.6L) ──
  { make: /chevrolet|chevy/i, dispMin: 6.5, dispMax: 6.7, yearMin: 1970, yearMax: 1981, hp: 175, isTruck: false, fuelSys: "carb", notes: "6.6L SBC, torque motor, 150-180 net, Rochester Q-jet" },

  // ── Chevy 454 BBC (7.4L) ──
  { make: /chevrolet|chevy|corvette|gmc/i, dispMin: 7.3, dispMax: 7.5, yearMin: 1970, yearMax: 1976, hp: 270, isTruck: false, fuelSys: "carb", rpoCode: "LS4/LS5", notes: "390 gross → ~270 net, Holley/Rochester 4V" },
  // 454 truck CARB — kept Rochester Q-jet through ~1991 on HD/cab-chassis
  { make: /chevrolet|chevy|gmc/i, dispMin: 7.3, dispMax: 7.5, yearMin: 1976, yearMax: 1991, hp: 230, isTruck: true, fuelSys: "carb", notes: "Truck 454 carb, Rochester Q-jet, 230hp. HD/cab-chassis kept carb through ~1991" },
  // 454 truck TBI (1992+)
  { make: /chevrolet|chevy|gmc/i, dispMin: 7.3, dispMax: 7.5, yearMin: 1992, yearMax: 1996, hp: 250, isTruck: true, fuelSys: "tbi", rpoCode: "L19", notes: "Truck 454 TBI, 250hp (1992+ got TBI)" },
  // 454 truck Vortec MPFI
  { make: /chevrolet|chevy|gmc/i, dispMin: 7.3, dispMax: 7.5, yearMin: 1996, yearMax: 2001, hp: 290, isTruck: true, fuelSys: "mpfi", rpoCode: "L29", notes: "Vortec 7400 MPFI, 290hp" },

  // ── Ford 302 / 5.0L ──
  { make: /ford|mercury|lincoln/i, dispMin: 4.9, dispMax: 5.1, yearMin: 1968, yearMax: 1972, hp: 175, isTruck: false, fuelSys: "carb", notes: "302 2V, 210 gross ≈ 175 net, Autolite/Motorcraft 2V" },
  { make: /ford|mustang/i, model: /boss/i, dispMin: 4.9, dispMax: 5.1, yearMin: 1969, yearMax: 1971, hp: 240, isTruck: false, fuelSys: "carb", rpoCode: "Boss 302", notes: "290 gross ≈ 240 net, canted-valve heads, Holley 780" },
  { make: /ford|mercury/i, dispMin: 4.9, dispMax: 5.1, yearMin: 1972, yearMax: 1982, hp: 135, isTruck: false, fuelSys: "carb", notes: "Malaise 302, 130-140 net, Motorcraft 2V" },
  { make: /ford|mustang|mercury/i, dispMin: 4.9, dispMax: 5.1, yearMin: 1982, yearMax: 1986, hp: 175, isTruck: false, fuelSys: "carb", rpoCode: "302 HO", notes: "157-210hp, Holley 4V, roller cam from 85" },
  { make: /ford|mustang/i, dispMin: 4.9, dispMax: 5.1, yearMin: 1986, yearMax: 1993, hp: 225, isTruck: false, fuelSys: "sefi", rpoCode: "302 HO EFI", notes: "SEFI 5.0, Mustang GT, 215-225hp, speed-density then MAF from 89" },
  { make: /ford|mustang/i, model: /cobra/i, dispMin: 4.9, dispMax: 5.1, yearMin: 1993, yearMax: 1996, hp: 235, isTruck: false, fuelSys: "sefi", notes: "Cobra 302, GT40 heads, SEFI" },
  // Ford 302 TRUCK — EFI from ~1985, but some kept carbs into mid-80s
  { make: /ford/i, dispMin: 4.9, dispMax: 5.1, yearMin: 1975, yearMax: 1985, hp: 140, isTruck: true, fuelSys: "carb", notes: "F-150/Bronco 302 carb, 130-140hp, Motorcraft 2V" },
  { make: /ford/i, dispMin: 4.9, dispMax: 5.1, yearMin: 1985, yearMax: 1996, hp: 195, isTruck: true, fuelSys: "sefi", notes: "F-150/Bronco 302 EFI, 185-205hp truck tune" },

  // ── Ford 351W (5.8L) ──
  { make: /ford|mercury|lincoln/i, dispMin: 5.7, dispMax: 5.9, yearMin: 1969, yearMax: 1974, hp: 220, isTruck: false, fuelSys: "carb", notes: "351W 2V/4V, 175-250 net range, Autolite/Motorcraft" },
  { make: /ford|mercury/i, dispMin: 5.7, dispMax: 5.9, yearMin: 1975, yearMax: 1996, hp: 185, isTruck: false, fuelSys: "carb", notes: "Emissions 351W, 150-200 net (carb through ~87, EFI after)" },

  // ── Ford 289 (4.7L) ──
  { make: /ford|mustang|mercury|shelby/i, dispMin: 4.6, dispMax: 4.8, yearMin: 1963, yearMax: 1968, hp: 200, isTruck: false, fuelSys: "carb", notes: "225 gross ≈ 200 net avg, Autolite 2V/4V" },
  { make: /ford|mustang|shelby/i, model: /hipo|hi-po|k-code|gt350/i, dispMin: 4.6, dispMax: 4.8, yearMin: 1965, yearMax: 1968, hp: 240, isTruck: false, fuelSys: "carb", notes: "289 HiPo, 271 gross ≈ 240 net, Autolite 4V" },

  // ── Ford Coyote 5.0 ──
  { make: /ford|mustang/i, dispMin: 4.9, dispMax: 5.1, yearMin: 2011, yearMax: 2017, hp: 420, isTruck: false, fuelSys: "mpfi", notes: "Coyote Gen 1/2, DOHC 32V" },
  { make: /ford|mustang/i, dispMin: 4.9, dispMax: 5.1, yearMin: 2018, yearMax: 2026, hp: 460, isTruck: false, fuelSys: "mpfi", notes: "Coyote Gen 3, 460-480hp, dual injection" },
  { make: /ford/i, dispMin: 4.9, dispMax: 5.1, yearMin: 2011, yearMax: 2026, hp: 395, isTruck: true, fuelSys: "mpfi", notes: "Coyote F-150, 385-400hp" },

  // ── Mopar 360 / 5.9L ──
  { make: /dodge|plymouth|chrysler|mopar/i, dispMin: 5.8, dispMax: 6.0, yearMin: 1971, yearMax: 1975, hp: 195, isTruck: false, fuelSys: "carb", notes: "LA 360, 175-245 net, Carter Thermoquad" },
  { make: /dodge|plymouth|chrysler/i, dispMin: 5.8, dispMax: 6.0, yearMin: 1975, yearMax: 1981, hp: 185, isTruck: false, fuelSys: "carb", notes: "Lean Burn era 360, carb + electronic spark" },
  { make: /dodge|chrysler|ram/i, dispMin: 5.8, dispMax: 6.0, yearMin: 1981, yearMax: 1992, hp: 175, isTruck: true, fuelSys: "carb", notes: "Truck 360, 170-180hp, carb (some TBI late)" },
  { make: /dodge|ram|chrysler/i, dispMin: 5.8, dispMax: 6.0, yearMin: 1993, yearMax: 1997, hp: 230, isTruck: true, fuelSys: "mpfi", rpoCode: "Magnum", notes: "5.9 Magnum MPFI, truck" },
  { make: /dodge|ram|chrysler/i, dispMin: 5.8, dispMax: 6.0, yearMin: 1998, yearMax: 2003, hp: 245, isTruck: true, fuelSys: "mpfi", rpoCode: "Magnum", notes: "5.9 Magnum updated, 245hp" },

  // ── Mopar 318 (5.2L) ──
  { make: /dodge|plymouth|chrysler/i, dispMin: 5.1, dispMax: 5.3, yearMin: 1967, yearMax: 1981, hp: 155, isTruck: false, fuelSys: "carb", notes: "LA 318, 150-230 gross, ~155 net avg, Carter 2V" },
  { make: /dodge|chrysler|ram/i, dispMin: 5.1, dispMax: 5.3, yearMin: 1981, yearMax: 1992, hp: 140, isTruck: true, fuelSys: "carb", notes: "Truck 318, carb, 130-145hp" },
  { make: /dodge|chrysler|ram/i, dispMin: 5.1, dispMax: 5.3, yearMin: 1992, yearMax: 2003, hp: 220, isTruck: true, fuelSys: "mpfi", rpoCode: "Magnum", notes: "5.2 Magnum MPFI, truck" },

  // ── Mopar 440 (7.2L) ──
  { make: /dodge|plymouth|chrysler/i, dispMin: 7.1, dispMax: 7.3, yearMin: 1966, yearMax: 1978, hp: 280, isTruck: false, fuelSys: "carb", notes: "375 gross ≈ 280 net, Carter AVS/Thermoquad, Six Pack higher" },

  // ── Mopar HEMI 426 (7.0L) ──
  { make: /dodge|plymouth|chrysler/i, dispMin: 6.9, dispMax: 7.1, yearMin: 1964, yearMax: 1971, hp: 350, isTruck: false, fuelSys: "carb", rpoCode: "426 Hemi", notes: "425 gross, likely 350+ net, dual Carter AFB 4V" },

  // ── Pontiac 455 (7.5L) ──
  { make: /pontiac/i, dispMin: 7.4, dispMax: 7.6, yearMin: 1970, yearMax: 1977, hp: 260, isTruck: false, fuelSys: "carb", notes: "325-370 gross, ~260 net avg, Rochester Q-jet" },

  // ── Pontiac 400 (6.6L) ──
  { make: /pontiac/i, dispMin: 6.5, dispMax: 6.7, yearMin: 1967, yearMax: 1979, hp: 250, isTruck: false, fuelSys: "carb", notes: "290-370 gross, ~250 net avg, Rochester Q-jet" },

  // ── Buick 455 (7.5L) ──
  { make: /buick/i, dispMin: 7.4, dispMax: 7.6, yearMin: 1970, yearMax: 1976, hp: 250, isTruck: false, fuelSys: "carb", notes: "Buick 455, torque-biased, Rochester Q-jet" },

  // ── Olds 455 (7.5L) ──
  { make: /oldsmobile|olds/i, dispMin: 7.4, dispMax: 7.6, yearMin: 1968, yearMax: 1976, hp: 260, isTruck: false, fuelSys: "carb", notes: "Rocket 455, Rochester Q-jet" },

  // ── GM LS Family (all MPFI) ──
  { make: /chevrolet|chevy|corvette|camaro|pontiac|gmc|cadillac/i, model: /ls1|z28|ss|corvette|trans am|firebird/i, dispMin: 5.6, dispMax: 5.8, yearMin: 1997, yearMax: 2005, hp: 325, isTruck: false, fuelSys: "mpfi", rpoCode: "LS1", notes: "LS1 5.7L, 305-350hp" },
  { make: /chevrolet|chevy|corvette/i, model: /z06/i, dispMin: 5.6, dispMax: 5.8, yearMin: 2001, yearMax: 2005, hp: 385, isTruck: false, fuelSys: "mpfi", rpoCode: "LS6", notes: "LS6 Z06" },
  { make: /chevrolet|chevy|gmc|cadillac|hummer/i, dispMin: 5.2, dispMax: 5.4, yearMin: 1999, yearMax: 2013, hp: 295, isTruck: true, fuelSys: "mpfi", rpoCode: "LM7/L59", notes: "Vortec 5300, truck/SUV 285-310hp" },
  { make: /chevrolet|chevy|gmc|cadillac/i, dispMin: 5.9, dispMax: 6.3, yearMin: 2005, yearMax: 2013, hp: 400, isTruck: false, fuelSys: "mpfi", rpoCode: "LS2/LS3", notes: "LS2 400hp, LS3 430hp" },
  { make: /chevrolet|chevy|gmc/i, dispMin: 5.9, dispMax: 6.3, yearMin: 2007, yearMax: 2013, hp: 360, isTruck: true, fuelSys: "mpfi", rpoCode: "L92/L9H", notes: "Vortec 6200, truck" },
  { make: /chevrolet|chevy|corvette|camaro/i, model: /ls7|z06/i, dispMin: 7.0, dispMax: 7.1, yearMin: 2006, yearMax: 2013, hp: 505, isTruck: false, fuelSys: "mpfi", rpoCode: "LS7", notes: "7.0L Z06" },
  { make: /chevrolet|chevy|corvette|camaro|cadillac/i, model: /zl1|cts-v|lsa/i, dispMin: 6.1, dispMax: 6.3, yearMin: 2009, yearMax: 2015, hp: 556, isTruck: false, fuelSys: "mpfi", rpoCode: "LSA", notes: "Supercharged LSA, 556hp" },

  // ── GM LT/Gen V (all MPFI/DI) ──
  { make: /chevrolet|chevy|corvette|camaro/i, dispMin: 6.1, dispMax: 6.3, yearMin: 2014, yearMax: 2026, hp: 460, isTruck: false, fuelSys: "mpfi", rpoCode: "LT1", notes: "Gen V LT1, 455-460hp, direct injection" },
  { make: /chevrolet|chevy|gmc|cadillac/i, dispMin: 5.2, dispMax: 5.4, yearMin: 2014, yearMax: 2026, hp: 355, isTruck: true, fuelSys: "mpfi", rpoCode: "L83/L84", notes: "EcoTec3 5.3, truck 355hp, AFM/DFM" },
  { make: /chevrolet|chevy|gmc|cadillac/i, dispMin: 6.1, dispMax: 6.3, yearMin: 2014, yearMax: 2026, hp: 420, isTruck: true, fuelSys: "mpfi", rpoCode: "L86/L87", notes: "EcoTec3 6.2, truck 420hp" },

  // ── Toyota ──
  { make: /toyota/i, model: /supra/i, dispMin: 2.9, dispMax: 3.1, yearMin: 1993, yearMax: 2002, hp: 320, isTruck: false, fuelSys: "mpfi", rpoCode: "2JZ-GTE", notes: "Twin-turbo 2JZ, sequential twin-turbo" },
  { make: /toyota/i, model: /land cruiser|4runner/i, dispMin: 4.6, dispMax: 4.8, yearMin: 2008, yearMax: 2022, hp: 381, isTruck: true, fuelSys: "mpfi", notes: "1UR-FE V8, dual VVT-i" },

  // ── BMW ──
  { make: /bmw/i, model: /m3|m4/i, dispMin: 2.9, dispMax: 3.1, yearMin: 2014, yearMax: 2026, hp: 425, isTruck: false, fuelSys: "mpfi", notes: "S55/S58 twin-turbo I6" },
  { make: /bmw/i, model: /m5/i, dispMin: 4.3, dispMax: 4.5, yearMin: 2012, yearMax: 2026, hp: 560, isTruck: false, fuelSys: "mpfi", notes: "S63 twin-turbo V8" },

  // ── Porsche ──
  { make: /porsche/i, model: /911.*turbo/i, dispMin: 3.7, dispMax: 3.9, yearMin: 2012, yearMax: 2026, hp: 540, isTruck: false, fuelSys: "mpfi", notes: "991/992 Turbo" },
  { make: /porsche/i, model: /911/i, dispMin: 2.9, dispMax: 3.1, yearMin: 2017, yearMax: 2026, hp: 379, isTruck: false, fuelSys: "mpfi", notes: "992 Carrera 3.0 twin-turbo" },
  { make: /porsche/i, model: /911/i, dispMin: 3.5, dispMax: 3.7, yearMin: 1999, yearMax: 2012, hp: 325, isTruck: false, fuelSys: "mpfi", notes: "996/997 3.6L" },
  { make: /porsche/i, model: /cayenne/i, dispMin: 4.7, dispMax: 4.9, yearMin: 2010, yearMax: 2018, hp: 400, isTruck: true, fuelSys: "mpfi", notes: "Cayenne 4.8 turbo" },

  // ── Mercedes ──
  { make: /mercedes/i, model: /amg.*63|63.*amg|c63|e63|s63|g63/i, dispMin: 3.9, dispMax: 4.1, yearMin: 2015, yearMax: 2026, hp: 503, isTruck: false, fuelSys: "mpfi", notes: "M177/M178 twin-turbo V8" },

  // ── Dodge/Chrysler HEMI 5.7/6.1/6.2/6.4 ──
  { make: /dodge|chrysler|ram|jeep/i, dispMin: 5.6, dispMax: 5.8, yearMin: 2003, yearMax: 2026, hp: 370, isTruck: false, fuelSys: "mpfi", rpoCode: "5.7 Hemi", notes: "Modern 5.7 Hemi, 345-395hp car, MDS" },
  { make: /dodge|chrysler|ram|jeep/i, dispMin: 5.6, dispMax: 5.8, yearMin: 2003, yearMax: 2026, hp: 395, isTruck: true, fuelSys: "mpfi", rpoCode: "5.7 Hemi", notes: "Modern 5.7 Hemi truck (Ram)" },
  { make: /dodge|chrysler|jeep/i, model: /srt|392|scat/i, dispMin: 6.3, dispMax: 6.5, yearMin: 2011, yearMax: 2026, hp: 485, isTruck: false, fuelSys: "mpfi", rpoCode: "6.4 Hemi", notes: "392 Hemi, 470-485hp" },
  { make: /dodge/i, model: /hellcat|demon|redeye/i, dispMin: 6.1, dispMax: 6.3, yearMin: 2015, yearMax: 2026, hp: 717, isTruck: false, fuelSys: "mpfi", rpoCode: "Hellcat", notes: "Supercharged 6.2, 707-840hp" },
];

// ── Mileage & Age Degradation Model ──
// Based on engineering literature: ~0.75% HP loss per year of age, ~0.4% per 10K km (~6200 mi)
// Pre-EFI cars degrade faster due to carb/ignition wear
// Trucks degrade less (lower stress, lower RPM operation)
function degradeHP(
  stockHP: number, year: number, mileage: number | null, bodyStyle: string,
  hasEFI: boolean
): { current_hp_min: number; current_hp_max: number } {
  const age = Math.max(0, 2025 - year);
  const miles = mileage || (age * 8000); // assume 8K mi/yr if unknown

  // Base degradation rate per year
  const ageRateMin = hasEFI ? 0.004 : 0.006;  // EFI degrades slower (no carb/points drift)
  const ageRateMax = hasEFI ? 0.008 : 0.012;

  // Mileage degradation per 10K miles
  const mileRateMin = 0.002;
  const mileRateMax = 0.005;

  // Age factor (capped at 40% loss)
  const ageFactorMin = Math.max(0.60, 1 - (age * ageRateMax));
  const ageFactorMax = Math.max(0.75, 1 - (age * ageRateMin));

  // Mileage factor (capped at 30% loss)
  const mileFactor10k = miles / 10000;
  const mileFactorMin = Math.max(0.70, 1 - (mileFactor10k * mileRateMax));
  const mileFactorMax = Math.max(0.85, 1 - (mileFactor10k * mileRateMin));

  // Combine: HP_current = stock * age_factor * mileage_factor
  const currentMin = Math.round(stockHP * ageFactorMin * mileFactorMin);
  const currentMax = Math.round(stockHP * ageFactorMax * mileFactorMax);

  return { current_hp_min: currentMin, current_hp_max: currentMax };
}

// ── Ignition System Impact Model ──
// HEI systems: 5000-5500 RPM ceiling, 10-25 HP loss when worn
// Points: worse, 15-30 HP loss when worn, ~3500 RPM practical limit
// EFI+coil-on-plug: minimal degradation
function ignitionImpact(year: number, make: string, mileage: number | null, knownFuelSys?: string): {
  system: string; hp_loss_min: number; hp_loss_max: number; rpm_ceiling: number; notes: string;
} {
  const miles = mileage || ((2025 - year) * 8000);
  const makeLower = (make || "").toLowerCase();
  const isGM = /chevrolet|chevy|gmc|pontiac|buick|oldsmobile|cadillac/i.test(makeLower);

  // If we KNOW the fuel system is carb, this vehicle has a distributor ignition
  // regardless of year (e.g. 1989 454 cab-chassis with Rochester carb still has HEI)
  const isKnownCarb = knownFuelSys === "carb";

  // Post-2000: coil-on-plug, near-zero ignition loss
  if (year >= 2000 && !isKnownCarb) {
    return { system: "coil-on-plug", hp_loss_min: 0, hp_loss_max: 2, rpm_ceiling: 7000, notes: "Modern COP ignition, negligible degradation" };
  }

  // 1987-2000 (GM) / 1985-2000 (Ford): EFI with distributor or DIS
  // BUT: some late-80s/early-90s HD trucks kept carbs — if knownFuelSys says carb, skip to HEI
  const efiCutoff = isGM ? 1987 : 1985;
  if (year >= efiCutoff && !isKnownCarb) {
    const worn = miles > 100000;
    return {
      system: "EFI/DIS",
      hp_loss_min: worn ? 3 : 0,
      hp_loss_max: worn ? 10 : 3,
      rpm_ceiling: 6500,
      notes: worn ? "High-mileage EFI, possible coil/sensor degradation" : "EFI ignition in good range",
    };
  }

  // 1975-1987 (GM) / 1975-1985 (Ford): HEI/Duraspark/Lean Burn era
  // Also catches late-model carb trucks (e.g. 1989 454 with Rochester → still HEI)
  if (year >= 1975 || isKnownCarb) {
    const isGM = /chevrolet|chevy|gmc|pontiac|buick|oldsmobile|cadillac/i.test(makeLower);
    const isMopar = /dodge|plymouth|chrysler/i.test(makeLower);
    const worn = miles > 60000;

    if (isGM) {
      return {
        system: "HEI",
        hp_loss_min: worn ? 10 : 2,
        hp_loss_max: worn ? 25 : 8,
        rpm_ceiling: worn ? 4500 : 5500,
        notes: worn
          ? "Worn HEI: module heat degradation, cap carbon tracking, coil weakness. 10-25 HP loss. Effective rev limit ~4500 RPM."
          : "Stock HEI in service range. Module + coil OK under 60K mi. 5500 RPM ceiling from coil saturation limits.",
      };
    }
    if (isMopar) {
      return {
        system: "Lean Burn/Electronic",
        hp_loss_min: worn ? 8 : 2,
        hp_loss_max: worn ? 20 : 8,
        rpm_ceiling: worn ? 4500 : 5000,
        notes: worn
          ? "Chrysler electronic ignition worn: computer drift, pickup coil degradation"
          : "Chrysler electronic ignition, more reliable than Lean Burn computer",
      };
    }
    // Ford Duraspark
    return {
      system: "Duraspark",
      hp_loss_min: worn ? 8 : 2,
      hp_loss_max: worn ? 20 : 8,
      rpm_ceiling: worn ? 4500 : 5500,
      notes: worn ? "Worn Duraspark: module failure mode similar to HEI" : "Ford Duraspark in service range",
    };
  }

  // Pre-1975: breaker points
  const worn = miles > 30000; // points need frequent service
  return {
    system: "breaker points",
    hp_loss_min: worn ? 15 : 5,
    hp_loss_max: worn ? 30 : 15,
    rpm_ceiling: worn ? 3500 : 5000,
    notes: worn
      ? "Points ignition at high miles: dwell scatter, timing drift, weak spark above 3500 RPM. 15-30 HP loss. Last tuned?"
      : "Points ignition in tune: still loses 5-15 HP vs electronic at high RPM from mechanical jitter",
  };
}

// ── Truck Performance Profile ──
// Where trucks lose HP vs car versions of same engine:
// - Restrictive cast-iron log exhaust manifolds: -10 to -20 HP
// - Mild cam (low-RPM torque, early intake closing): -15 to -30 HP
// - Lower compression ratio (regular fuel): -5 to -15 HP
// - Conservative ECU tune (detonation margin): -5 to -15 HP
// - Restrictive intake manifold (long runners): -5 to -10 HP
// Total: 20-90 HP less than car version of same block
function truckDerating(
  year: number, displacement: number, knownFuelSys?: string
): { hp_loss: number; peak_rpm: number; torque_rpm: number; notes: string } {
  // Modern trucks (2010+) are closer to car tune
  if (year >= 2010 && knownFuelSys !== "carb") {
    return {
      hp_loss: 30,
      peak_rpm: 5200,
      torque_rpm: 3000,
      notes: "Modern truck: cam/tune optimized 2000-3500 RPM. Peak HP -30 vs car. Headers, intake would recover 15-20 HP.",
    };
  }
  // 1996-2010: MPFI/Vortec trucks
  if (year >= 1996 && knownFuelSys !== "carb" && knownFuelSys !== "tbi") {
    return {
      hp_loss: 45,
      peak_rpm: 4600,
      torque_rpm: 2800,
      notes: "EFI truck: Vortec/Magnum heads flow well but cam is mild. Log manifolds cost 10-15 HP. Total -45 HP vs car version.",
    };
  }
  // 1987-1996: TBI trucks (GM got TBI in '87 model year)
  // Some exceptions: 454 HD/cab-chassis kept Rochester carb through ~1991
  if ((year >= 1987 && knownFuelSys === "tbi") || (year >= 1987 && !knownFuelSys && displacement < 6.5)) {
    return {
      hp_loss: 60,
      peak_rpm: 3800,
      torque_rpm: 2400,
      notes: "TBI truck (1987+): swirl-port heads (-20 CFM vs car), mild cam, log manifolds. Peak HP at only 3800 RPM. -60 HP vs car.",
    };
  }
  // Pre-1987 OR known carb trucks (including late-model carb exceptions like 1989 454 cab-chassis)
  const bigBlock = displacement > 6.0;
  return {
    hp_loss: bigBlock ? 40 : 50,
    peak_rpm: 3600,
    torque_rpm: 2200,
    notes: bigBlock
      ? "Carbureted big-block truck: Rochester Q-jet 4V, displacement compensates. Single exhaust, mild cam. Still makes torque."
      : "Carbureted small-block truck: restrictive exhaust, 2-barrel carb, mild cam. Struggles above 3600 RPM.",
  };
}

// Base HP/L ranges: [minHPL, maxHPL] by fuel, aspiration, era
const HPL_TABLE: Record<string, Record<string, [number, number]>> = {
  "gasoline_na": {
    "0-1970": [30, 70], "1970-1980": [25, 55], "1980-1990": [35, 70],
    "1990-2010": [45, 100], "2010-9999": [50, 105],
  },
  "gasoline_turbo": {
    "0-1990": [55, 100], "1990-2010": [65, 130], "2010-9999": [70, 160],
  },
  "gasoline_supercharged": {
    "0-2000": [60, 100], "2000-9999": [75, 130],
  },
  "diesel_na": { "0-1990": [20, 40], "1990-9999": [27, 45] },
  "diesel_turbo": { "0-2000": [35, 65], "2000-9999": [50, 100] },
};

const BODY_HP_MOD: Record<string, [number, number]> = {
  truck: [0.70, 0.90], suv: [0.80, 0.95], van: [0.75, 0.90],
  sedan: [0.85, 1.00], coupe: [0.90, 1.10], convertible: [0.90, 1.10],
  hatchback: [0.85, 1.00], wagon: [0.85, 1.00],
};

const TRIM_HP_MOD: Record<string, [number, number]> = {
  base: [0.85, 0.95], sport: [1.00, 1.10], gt: [1.05, 1.15],
  ss: [1.10, 1.20], rs: [1.10, 1.20], "type r": [1.15, 1.25],
  amg: [1.15, 1.30], " m ": [1.10, 1.25], sti: [1.10, 1.20],
  srt: [1.15, 1.30], shelby: [1.15, 1.30], hellcat: [1.20, 1.35],
  raptor: [1.10, 1.20], nismo: [1.10, 1.20], trd: [1.00, 1.10],
  limited: [0.90, 1.00], touring: [0.90, 1.00], luxury: [0.90, 1.00],
};

function detectAspiration(engineType: string, model: string, trim: string): string {
  const s = (engineType + " " + model + " " + trim).toLowerCase();
  if (/turbo|tdi|tfsi|ecoboost|tsi|biturbo|twin.?turbo|mdi|tdci/i.test(s)) return "turbo";
  if (/supercharg|kompressor|roots|blower|hellcat/i.test(s)) return "supercharged";
  return "na";
}

function lookupHPL(fuel: string, aspiration: string, year: number): [number, number] | null {
  const fuelKey = (fuel || "gasoline").toLowerCase().includes("diesel") ? "diesel" : "gasoline";
  const aspKey = aspiration === "supercharged" ? "supercharged" : aspiration === "turbo" ? "turbo" : "na";
  const tableKey = `${fuelKey}_${aspKey}`;
  const table = HPL_TABLE[tableKey];
  if (!table) return HPL_TABLE[`${fuelKey}_na`] ? lookupHPL(fuel, "na", year) : null;

  for (const [range, hpl] of Object.entries(table)) {
    const [lo, hi] = range.split("-").map(Number);
    if (year >= lo && year < hi) return hpl;
  }
  // Default to last era
  const entries = Object.values(table);
  return entries[entries.length - 1] || null;
}

// Try known engine family first (high confidence), fall back to HPL algorithm
function lookupKnownEngine(
  make: string, model: string, displacement: number, year: number, bodyStyle: string
): KnownEngine | null {
  const bs = (bodyStyle || "").toLowerCase();
  const isTruck = /truck|pickup|suv|van/i.test(bs);

  // Score candidates: more specific matches score higher
  let bestMatch: KnownEngine | null = null;
  let bestScore = 0;

  for (const eng of KNOWN_ENGINES) {
    if (!eng.make.test(make || "")) continue;
    if (displacement < eng.dispMin || displacement > eng.dispMax) continue;
    if (year < eng.yearMin || year > eng.yearMax) continue;

    let score = 1; // base match

    // Truck/car match bonus
    if (eng.isTruck === isTruck) score += 3;
    else if (isTruck && !eng.isTruck) score -= 1; // truck with car rating is less accurate

    // Model pattern match is highest priority
    if (eng.model) {
      if (eng.model.test(model || "")) score += 10;
      else continue; // if engine specifies model pattern, must match
    }

    // Tighter year range = more specific = better
    const yearSpan = eng.yearMax - eng.yearMin;
    if (yearSpan <= 5) score += 2;
    else if (yearSpan <= 10) score += 1;

    if (score > bestScore) {
      bestScore = score;
      bestMatch = eng;
    }
  }

  return bestMatch;
}

interface HPEstimate {
  hp_min: number;
  hp_max: number;
  hp_avg: number;
  confidence: number;
  method: string;
  stock_hp?: number;
  current_hp_min?: number;
  current_hp_max?: number;
  engine_code?: string;
  engine_notes?: string;
  ignition?: {
    system: string;
    hp_loss_min: number;
    hp_loss_max: number;
    rpm_ceiling: number;
    notes: string;
  };
  truck_profile?: {
    hp_loss: number;
    peak_rpm: number;
    torque_rpm: number;
    notes: string;
  };
}

function estimateHP(
  displacement: number, year: number, fuel: string,
  engineType: string, model: string, trim: string, bodyStyle: string,
  make: string, mileage: number | null
): HPEstimate | null {
  if (!displacement || displacement <= 0) return null;

  // ── Method 1: Known engine family lookup (high confidence) ──
  const known = lookupKnownEngine(make || "", model || "", displacement, year || 0, bodyStyle || "");
  if (known) {
    // Use the known engine's fuel system to determine EFI vs carb — not just year
    // A 1989 454 cab-chassis truck had a Rochester carb; a 1987 350 truck had TBI
    const hasEFI = known.fuelSys
      ? known.fuelSys !== "carb"  // trust the known engine data
      : (year >= 1987 || /efi|tpi|tbi|mpfi|injection|sefi/i.test(engineType || ""));
    const degraded = degradeHP(known.hp, year || 2000, mileage, bodyStyle || "", hasEFI);
    const ignition = ignitionImpact(year || 2000, make || "", mileage, known.fuelSys);

    const result: HPEstimate = {
      hp_min: degraded.current_hp_min,
      hp_max: degraded.current_hp_max,
      hp_avg: Math.round((degraded.current_hp_min + degraded.current_hp_max) / 2),
      confidence: 0.85, // known engine = high confidence
      method: "known_engine_family",
      stock_hp: known.hp,
      current_hp_min: degraded.current_hp_min,
      current_hp_max: degraded.current_hp_max,
      engine_code: known.rpoCode,
      engine_notes: known.notes,
      ignition,
    };

    // Store fuel system info
    if (known.fuelSys) {
      result.engine_notes = (result.engine_notes || "") + " [" + known.fuelSys.toUpperCase() + "]";
    }

    // Truck profile if applicable
    const isTruck = /truck|pickup|suv|van/i.test(bodyStyle || "");
    if (isTruck) {
      result.truck_profile = truckDerating(year || 2000, displacement, known.fuelSys);
    }

    // Adjust confidence based on available info
    if (mileage) result.confidence += 0.05;
    if (trim) result.confidence += 0.05;
    result.confidence = Math.min(result.confidence, 0.95);

    return result;
  }

  // ── Method 2: HP/L algorithm (lower confidence fallback) ──
  const aspiration = detectAspiration(engineType || "", model || "", trim || "");
  const baseHPL = lookupHPL(fuel, aspiration, year || 2000);
  if (!baseHPL) return null;

  let [minHPL, maxHPL] = baseHPL;

  // Apply body style modifier
  const bs = (bodyStyle || "").toLowerCase();
  for (const [key, [lo, hi]] of Object.entries(BODY_HP_MOD)) {
    if (bs.includes(key)) { minHPL *= lo; maxHPL *= hi; break; }
  }

  // Apply trim modifier
  const trimLower = (trim || "").toLowerCase() + " " + (model || "").toLowerCase();
  for (const [key, [lo, hi]] of Object.entries(TRIM_HP_MOD)) {
    if (trimLower.includes(key)) { minHPL *= lo; maxHPL *= hi; break; }
  }

  const hpMin = Math.round(displacement * minHPL);
  const hpMax = Math.round(displacement * maxHPL);
  const hpAvg = Math.round((hpMin + hpMax) / 2);

  // Confidence based on available inputs
  let confidence = 0.30;
  if (year) confidence += 0.15;
  if (aspiration !== "na" || engineType) confidence += 0.20;
  if (fuel) confidence += 0.10;
  if (bodyStyle) confidence += 0.10;
  if (trim) confidence += 0.10;

  const result: HPEstimate = {
    hp_min: hpMin, hp_max: hpMax, hp_avg: hpAvg,
    confidence: Math.min(confidence, 1.0),
    method: "displacement_hpl_algorithm",
  };

  // Still add ignition data for older cars
  if (year && year < 2000) {
    result.ignition = ignitionImpact(year, make || "", mileage, undefined);
  }

  const isTruck = /truck|pickup|suv|van/i.test(bodyStyle || "");
  if (isTruck && year) {
    result.truck_profile = truckDerating(year, displacement, undefined);
  }

  return result;
}

async function handleEstimateHP(
  supabase: ReturnType<typeof createClient>,
  body: Record<string, unknown>
) {
  const limit = Math.min(Number(body.limit) || 200, 500);
  const source = String(body.source || "bat");
  const results = {
    source, total: 0, estimated: 0, skipped: 0,
    known_engine_matches: 0, hpl_fallback: 0,
  };

  // Fetch vehicles from source — all filtering in JS to avoid pooler timeout
  const { data: rawVehicles, error } = await supabase
    .from("vehicles")
    .select("id, displacement, year, fuel_type, engine_type, model, trim, body_style, horsepower, make, mileage, origin_metadata")
    .eq("discovery_source", source)
    .is("deleted_at", null)
    .limit(limit * 5);

  const vehicles = (rawVehicles || []).filter(
    (v: any) => v.displacement && parseFloat(v.displacement) > 0 &&
      v.horsepower == null && !v.origin_metadata?.hp_estimated
  ).slice(0, limit);

  if (error) throw new Error(`Fetch error: ${error.message}`);
  if (!vehicles?.length) return okJson({ ...results, message: "No candidates with displacement but no HP" });

  results.total = vehicles.length;
  const updates: { id: string; patch: Record<string, unknown> }[] = [];

  for (const v of vehicles) {
    const disp = parseFloat(v.displacement);
    if (!disp || disp <= 0) { results.skipped++; continue; }

    const est = estimateHP(
      disp, v.year, v.fuel_type, v.engine_type, v.model, v.trim, v.body_style,
      v.make, v.mileage ? parseInt(String(v.mileage), 10) : null
    );
    if (!est) { results.skipped++; continue; }

    // Track method breakdown
    if (est.method === "known_engine_family") results.known_engine_matches++;
    else results.hpl_fallback++;

    // Build rich HP metadata
    const hpMeta: Record<string, unknown> = {
      hp_estimated: true,
      hp_min: est.hp_min,
      hp_max: est.hp_max,
      hp_avg: est.hp_avg,
      hp_confidence: est.confidence,
      hp_method: est.method,
    };

    // Cross-validate with engine bay analysis if available
    const eba = v.origin_metadata?.engine_bay_analysis;
    if (eba?.engine_family) {
      const ebaFamily = String(eba.engine_family).toUpperCase();
      const estCode = (est.engine_code || "").toUpperCase();
      const estNotes = (est.engine_notes || "").toUpperCase();
      // Check if engine bay family matches HP estimation engine
      const familyMatch = estCode.includes(ebaFamily) || estNotes.includes(ebaFamily) ||
        (ebaFamily === "SBC" && /SBC|350|305|327|400/.test(estCode + estNotes)) ||
        (ebaFamily === "BBC" && /BBC|454|396|427|502/.test(estCode + estNotes)) ||
        (ebaFamily === "LS" && /LS|LS1|LS2|LS3|LS6|LS7|LSA|LSX/.test(estCode + estNotes));
      hpMeta.engine_bay_validated = familyMatch;
      if (familyMatch) {
        // Boost confidence when vision confirms data
        est.confidence = Math.min(est.confidence + 0.05, 0.98);
        hpMeta.hp_confidence = est.confidence;
        hpMeta.engine_bay_validation_note = `Engine bay vision confirms ${eba.engine_family}`;
      } else if (eba.engine_family !== "unknown" && eba.engine_family !== "other") {
        // Flag conflict for review
        hpMeta.engine_bay_conflict = `Vision says ${eba.engine_family}, HP model used ${est.engine_code || est.method}`;
      }
      // Cross-check fuel system
      if (eba.fuel_system_type && est.engine_notes) {
        const ebaFuel = String(eba.fuel_system_type).toLowerCase();
        const estFuel = est.engine_notes.toLowerCase();
        if ((ebaFuel === "carburetor" && estFuel.includes("tbi")) ||
            (ebaFuel === "tbi" && estFuel.includes("carb"))) {
          hpMeta.fuel_system_conflict = `Vision: ${eba.fuel_system_type}, HP model: ${est.engine_notes}`;
        }
      }
    }

    // Known engine enrichment
    if (est.stock_hp) hpMeta.stock_hp = est.stock_hp;
    if (est.current_hp_min) hpMeta.current_hp_min = est.current_hp_min;
    if (est.current_hp_max) hpMeta.current_hp_max = est.current_hp_max;
    if (est.engine_code) hpMeta.engine_code = est.engine_code;
    if (est.engine_notes) hpMeta.engine_notes = est.engine_notes;

    // Ignition system data
    if (est.ignition) {
      hpMeta.ignition_system = est.ignition.system;
      hpMeta.ignition_hp_loss = `${est.ignition.hp_loss_min}-${est.ignition.hp_loss_max}`;
      hpMeta.ignition_rpm_ceiling = est.ignition.rpm_ceiling;
      hpMeta.ignition_notes = est.ignition.notes;
    }

    // Truck performance profile
    if (est.truck_profile) {
      hpMeta.truck_hp_loss_vs_car = est.truck_profile.hp_loss;
      hpMeta.truck_peak_rpm = est.truck_profile.peak_rpm;
      hpMeta.truck_torque_rpm = est.truck_profile.torque_rpm;
      hpMeta.truck_notes = est.truck_profile.notes;
    }

    updates.push({
      id: v.id,
      patch: {
        origin_metadata: { ...(v.origin_metadata || {}), ...hpMeta },
      },
    });
    results.estimated++;
  }

  // Apply updates (20 concurrent)
  for (let i = 0; i < updates.length; i += 20) {
    await Promise.all(
      updates.slice(i, i + 20).map(({ id, patch }) =>
        supabase.from("vehicles").update(patch).eq("id", id)
      )
    );
  }

  return okJson({ success: true, strategy: "estimate_hp", ...results });
}

// ─── Backfill Location ──────────────────────────────────────────────

// US state abbreviation to full name (for validation)
const US_STATES: Record<string, string> = {
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",CO:"Colorado",
  CT:"Connecticut",DE:"Delaware",FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",
  IL:"Illinois",IN:"Indiana",IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",
  ME:"Maine",MD:"Maryland",MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",
  MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",
  NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",OK:"Oklahoma",
  OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",SD:"South Dakota",
  TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",VA:"Virginia",WA:"Washington",
  WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming",DC:"District of Columbia",
};

// Metro lookup table: lat/lng → city, state (for iPhoto GPS reverse geocode)
const US_METROS: { lat: number; lng: number; city: string; state: string; radius: number }[] = [
  { lat: 33.45, lng: -112.07, city: "Phoenix", state: "AZ", radius: 0.5 },
  { lat: 34.05, lng: -118.24, city: "Los Angeles", state: "CA", radius: 0.6 },
  { lat: 37.77, lng: -122.42, city: "San Francisco", state: "CA", radius: 0.3 },
  { lat: 32.72, lng: -117.16, city: "San Diego", state: "CA", radius: 0.4 },
  { lat: 37.34, lng: -121.89, city: "San Jose", state: "CA", radius: 0.3 },
  { lat: 33.83, lng: -117.91, city: "Anaheim", state: "CA", radius: 0.3 },
  { lat: 38.58, lng: -121.49, city: "Sacramento", state: "CA", radius: 0.3 },
  { lat: 39.74, lng: -104.99, city: "Denver", state: "CO", radius: 0.4 },
  { lat: 25.76, lng: -80.19, city: "Miami", state: "FL", radius: 0.4 },
  { lat: 28.54, lng: -81.38, city: "Orlando", state: "FL", radius: 0.4 },
  { lat: 27.95, lng: -82.46, city: "Tampa", state: "FL", radius: 0.4 },
  { lat: 30.33, lng: -81.66, city: "Jacksonville", state: "FL", radius: 0.3 },
  { lat: 33.75, lng: -84.39, city: "Atlanta", state: "GA", radius: 0.5 },
  { lat: 41.88, lng: -87.63, city: "Chicago", state: "IL", radius: 0.5 },
  { lat: 39.77, lng: -86.16, city: "Indianapolis", state: "IN", radius: 0.3 },
  { lat: 39.10, lng: -94.58, city: "Kansas City", state: "MO", radius: 0.3 },
  { lat: 38.25, lng: -85.76, city: "Louisville", state: "KY", radius: 0.3 },
  { lat: 29.95, lng: -90.07, city: "New Orleans", state: "LA", radius: 0.3 },
  { lat: 42.36, lng: -71.06, city: "Boston", state: "MA", radius: 0.3 },
  { lat: 39.29, lng: -76.61, city: "Baltimore", state: "MD", radius: 0.3 },
  { lat: 42.33, lng: -83.05, city: "Detroit", state: "MI", radius: 0.4 },
  { lat: 44.98, lng: -93.27, city: "Minneapolis", state: "MN", radius: 0.4 },
  { lat: 35.15, lng: -90.05, city: "Memphis", state: "TN", radius: 0.3 },
  { lat: 36.16, lng: -86.78, city: "Nashville", state: "TN", radius: 0.3 },
  { lat: 35.23, lng: -80.84, city: "Charlotte", state: "NC", radius: 0.3 },
  { lat: 35.78, lng: -78.64, city: "Raleigh", state: "NC", radius: 0.3 },
  { lat: 41.26, lng: -95.94, city: "Omaha", state: "NE", radius: 0.3 },
  { lat: 36.17, lng: -115.14, city: "Las Vegas", state: "NV", radius: 0.4 },
  { lat: 40.71, lng: -74.01, city: "New York", state: "NY", radius: 0.3 },
  { lat: 39.96, lng: -75.17, city: "Philadelphia", state: "PA", radius: 0.4 },
  { lat: 40.44, lng: -80.00, city: "Pittsburgh", state: "PA", radius: 0.3 },
  { lat: 45.52, lng: -122.68, city: "Portland", state: "OR", radius: 0.3 },
  { lat: 33.45, lng: -111.94, city: "Scottsdale", state: "AZ", radius: 0.2 },
  { lat: 47.61, lng: -122.33, city: "Seattle", state: "WA", radius: 0.3 },
  { lat: 38.63, lng: -90.20, city: "St. Louis", state: "MO", radius: 0.4 },
  { lat: 32.78, lng: -96.80, city: "Dallas", state: "TX", radius: 0.5 },
  { lat: 29.76, lng: -95.37, city: "Houston", state: "TX", radius: 0.5 },
  { lat: 29.42, lng: -98.49, city: "San Antonio", state: "TX", radius: 0.4 },
  { lat: 30.27, lng: -97.74, city: "Austin", state: "TX", radius: 0.3 },
  { lat: 32.45, lng: -100.45, city: "Abilene", state: "TX", radius: 0.3 },
  { lat: 40.76, lng: -111.89, city: "Salt Lake City", state: "UT", radius: 0.3 },
  { lat: 38.91, lng: -77.04, city: "Washington", state: "DC", radius: 0.3 },
  { lat: 43.04, lng: -87.91, city: "Milwaukee", state: "WI", radius: 0.3 },
  { lat: 39.10, lng: -84.51, city: "Cincinnati", state: "OH", radius: 0.3 },
  { lat: 41.50, lng: -81.69, city: "Cleveland", state: "OH", radius: 0.3 },
  { lat: 39.96, lng: -82.99, city: "Columbus", state: "OH", radius: 0.3 },
  { lat: 36.12, lng: -97.07, city: "Stillwater", state: "OK", radius: 0.3 },
  { lat: 35.47, lng: -97.52, city: "Oklahoma City", state: "OK", radius: 0.3 },
  { lat: 36.15, lng: -95.99, city: "Tulsa", state: "OK", radius: 0.3 },
  { lat: 37.69, lng: -97.34, city: "Wichita", state: "KS", radius: 0.3 },
  { lat: 26.12, lng: -80.14, city: "Fort Lauderdale", state: "FL", radius: 0.3 },
  { lat: 33.52, lng: -86.80, city: "Birmingham", state: "AL", radius: 0.3 },
  { lat: 32.37, lng: -86.30, city: "Montgomery", state: "AL", radius: 0.3 },
];

function reverseGeocodeMetro(lat: number, lng: number): { city: string; state: string } | null {
  let best: typeof US_METROS[0] | null = null;
  let bestDist = Infinity;
  for (const m of US_METROS) {
    const dist = Math.sqrt((lat - m.lat) ** 2 + (lng - m.lng) ** 2);
    if (dist < m.radius && dist < bestDist) {
      bestDist = dist;
      best = m;
    }
  }
  return best ? { city: best.city, state: best.state } : null;
}

async function handleBackfillLocation(
  supabase: ReturnType<typeof createClient>,
  body: Record<string, unknown>
) {
  const limit = Math.min(Number(body.limit) || 200, 500);
  const results = {
    total: 0,
    listing_location_parsed: 0,
    event_location_pulled: 0,
    gps_geocoded: 0,
  };

  // Pass 1: Parse listing_location into city/state
  {
    const { data: vehicles } = await supabase
      .from("vehicles")
      .select("id, listing_location")
      .is("deleted_at", null)
      .is("city", null)
      .not("listing_location", "is", null)
      .limit(limit);

    if (vehicles?.length) {
      const updates: { id: string; patch: Record<string, unknown> }[] = [];
      for (const v of vehicles) {
        const loc = (v.listing_location || "").trim();
        // Match "City, ST" or "City, State"
        const m = loc.match(/^([A-Za-z\s.'-]+),\s*([A-Z]{2})\b/) ||
                  loc.match(/^([A-Za-z\s.'-]+),\s*([A-Za-z\s]+)$/);
        if (m) {
          const city = m[1].trim();
          const stateRaw = m[2].trim();
          // Validate state: either 2-letter abbreviation or full state name
          const stateAbbr = stateRaw.length === 2 ? stateRaw.toUpperCase() : null;
          const stateFromName = Object.entries(US_STATES).find(
            ([, name]) => name.toLowerCase() === stateRaw.toLowerCase()
          )?.[0];
          const state = stateAbbr && US_STATES[stateAbbr] ? stateAbbr :
                        stateFromName ? stateFromName : null;
          if (city && state) {
            updates.push({ id: v.id, patch: { city, state } });
            results.listing_location_parsed++;
          }
        }
      }
      for (let i = 0; i < updates.length; i += 20) {
        await Promise.all(
          updates.slice(i, i + 20).map(({ id, patch }) =>
            supabase.from("vehicles").update(patch).eq("id", id)
          )
        );
      }
    }
  }

  // Pass 2: Pull location from vehicle_events metadata
  {
    const { data: events } = await supabase.rpc("execute_sql", {
      query: `
        SELECT DISTINCT ON (ve.vehicle_id) ve.vehicle_id,
          ve.metadata->>'location_city' as city,
          ve.metadata->>'location_state' as state
        FROM vehicle_events ve
        JOIN vehicles v ON v.id = ve.vehicle_id
        WHERE v.city IS NULL AND v.deleted_at IS NULL
          AND ve.metadata->>'location_city' IS NOT NULL
          AND ve.metadata->>'location_state' IS NOT NULL
        ORDER BY ve.vehicle_id, ve.created_at DESC
        LIMIT ${limit}
      `,
    });

    const rows = Array.isArray(events) ? events : [];
    if (rows.length) {
      for (let i = 0; i < rows.length; i += 20) {
        const chunk = rows.slice(i, i + 20);
        await Promise.all(
          chunk.map((r: any) =>
            supabase.from("vehicles").update({
              city: r.city,
              state: r.state,
            }).eq("id", r.vehicle_id)
          )
        );
      }
      results.event_location_pulled = rows.length;
    }
  }

  // Pass 3: Reverse geocode iPhoto GPS coordinates
  {
    const { data: gpsVehicles } = await supabase.rpc("execute_sql", {
      query: `
        SELECT DISTINCT ON (vi.vehicle_id) vi.vehicle_id,
          vi.gps_latitude as lat, vi.gps_longitude as lng
        FROM vehicle_images vi
        JOIN vehicles v ON v.id = vi.vehicle_id
        WHERE v.city IS NULL AND v.deleted_at IS NULL
          AND vi.gps_latitude IS NOT NULL AND vi.gps_longitude IS NOT NULL
          AND vi.gps_latitude BETWEEN 24.0 AND 50.0
          AND vi.gps_longitude BETWEEN -125.0 AND -66.0
        ORDER BY vi.vehicle_id, vi.created_at DESC
        LIMIT ${limit}
      `,
    });

    const gpsRows = Array.isArray(gpsVehicles) ? gpsVehicles : [];
    if (gpsRows.length) {
      const updates: { id: string; city: string; state: string }[] = [];
      for (const r of gpsRows) {
        const loc = reverseGeocodeMetro(parseFloat(r.lat), parseFloat(r.lng));
        if (loc) {
          updates.push({ id: r.vehicle_id, ...loc });
        }
      }
      for (let i = 0; i < updates.length; i += 20) {
        await Promise.all(
          updates.slice(i, i + 20).map(({ id, city, state }) =>
            supabase.from("vehicles").update({ city, state }).eq("id", id)
          )
        );
      }
      results.gps_geocoded = updates.length;
    }
  }

  results.total = results.listing_location_parsed + results.event_location_pulled + results.gps_geocoded;
  return okJson({ success: true, strategy: "backfill_location", ...results });
}

// ─── Smart Primary Image ────────────────────────────────────────────

async function handleSmartPrimaryImage(
  supabase: ReturnType<typeof createClient>,
  body: Record<string, unknown>
) {
  const limit = Math.min(Number(body.limit) || 100, 500);
  const results = { total: 0, updated: 0, skipped: 0 };

  // Find vehicles with images but potentially bad primaries
  const { data: vehicles } = await supabase
    .from("vehicles")
    .select("id, primary_image_url")
    .is("deleted_at", null)
    .not("primary_image_url", "is", null)
    .gt("image_count", 1)
    .limit(limit);

  if (!vehicles?.length) return okJson({ ...results, message: "No candidates" });
  results.total = vehicles.length;

  for (const v of vehicles) {
    // Get all images for this vehicle with scoring-relevant fields
    const { data: images } = await supabase
      .from("vehicle_images")
      .select("id, image_url, angle, source, display_order, is_duplicate, photo_quality_score")
      .eq("vehicle_id", v.id)
      .limit(50);

    if (!images?.length || images.length < 2) { results.skipped++; continue; }

    // Score each image
    let bestImage: typeof images[0] | null = null;
    let bestScore = -Infinity;

    for (const img of images) {
      let score = 0;
      const angle = (img.angle || "").toLowerCase();

      // Exterior front is ideal hero shot
      if (angle.includes("ext_front") || angle.includes("exterior_front")) score += 100;
      else if (angle.includes("exterior") || angle.includes("ext_")) score += 50;

      // BaT hero shot (first image from BaT import)
      if ((img.source === "bat_import" || img.source === "bat") && img.display_order === 0) score += 40;

      // Good quality
      if (img.photo_quality_score && img.photo_quality_score >= 4) score += 20;
      else if (img.photo_quality_score && img.photo_quality_score >= 3) score += 10;

      // Penalize bad angles
      if (angle.includes("receipt") || angle.includes("document") || angle.includes("detail") || angle.includes("paperwork")) score -= 50;
      if (angle.includes("dashboard") || angle.includes("odometer")) score -= 30;

      // Penalize duplicates
      if (img.is_duplicate) score -= 100;

      if (score > bestScore) {
        bestScore = score;
        bestImage = img;
      }
    }

    // Only update if the best candidate is different from current primary
    if (bestImage && bestImage.image_url !== v.primary_image_url && bestScore > 0) {
      await supabase.from("vehicles").update({
        primary_image_url: bestImage.image_url,
      }).eq("id", v.id);
      results.updated++;
    } else {
      results.skipped++;
    }
  }

  return okJson({ success: true, strategy: "smart_primary_image", ...results });
}

// ─── VIN Link Suggestions ───────────────────────────────────────────

async function handleVinLinkSuggestions(
  supabase: ReturnType<typeof createClient>,
  body: Record<string, unknown>
) {
  const limit = Math.min(Number(body.limit) || 100, 500);
  const results = { total: 0, suggestions_created: 0 };

  // Find VINs that appear on multiple vehicles
  const { data: dupeVins } = await supabase.rpc("execute_sql", {
    query: `
      SELECT vin, array_agg(id ORDER BY data_quality_score DESC NULLS LAST) as vehicle_ids,
             count(*) as cnt
      FROM vehicles
      WHERE vin IS NOT NULL AND length(vin) = 17 AND deleted_at IS NULL
        AND status IN ('active', 'inactive', 'pending', 'discovered')
      GROUP BY vin
      HAVING count(*) > 1
      LIMIT ${limit}
    `,
  });

  const rows = Array.isArray(dupeVins) ? dupeVins : [];
  if (!rows.length) return okJson({ ...results, message: "No VIN duplicates found" });

  results.total = rows.length;

  for (const row of rows) {
    const ids: string[] = row.vehicle_ids || [];
    if (ids.length < 2) continue;

    // Fetch all records sharing this VIN
    const { data: vehicles } = await supabase
      .from("vehicles")
      .select("id, year, make, model, vin, description, color, engine_type, mileage, sale_price, city, state, image_count, data_quality_score, discovery_source, origin_metadata")
      .in("id", ids);

    if (!vehicles?.length || vehicles.length < 2) continue;

    // Find the richest record (highest quality score)
    const sorted = vehicles.sort((a: any, b: any) => (b.data_quality_score || 0) - (a.data_quality_score || 0));
    const richest = sorted[0];

    // For each other record, note what fields the richest has that they don't
    for (let i = 1; i < sorted.length; i++) {
      const target = sorted[i];
      // Skip if already has enrichment candidate
      if (target.origin_metadata?.enrichment_candidate) continue;

      const enrichable: string[] = [];
      const fields = ["description", "color", "engine_type", "mileage", "sale_price", "city", "state"];
      for (const f of fields) {
        if (!target[f] && richest[f]) enrichable.push(f);
      }
      if (richest.image_count > (target.image_count || 0)) enrichable.push("images");

      if (enrichable.length > 0) {
        await supabase.from("vehicles").update({
          origin_metadata: {
            ...(target.origin_metadata || {}),
            enrichment_candidate: {
              source_vehicle_id: richest.id,
              source_quality_score: richest.data_quality_score,
              enrichable_fields: enrichable,
              source_discovery: richest.discovery_source,
              flagged_at: new Date().toISOString(),
            },
          },
        }).eq("id", target.id);
        results.suggestions_created++;
      }
    }
  }

  return okJson({ success: true, strategy: "vin_link_suggestions", ...results });
}

// ─── Stats ───────────────────────────────────────────────────────────

async function handleStats(supabase: ReturnType<typeof createClient>) {
  // Get approximate total from pg stats (instant)
  const { data: totalR } = await supabase.rpc("execute_sql", {
    query: `SELECT n_live_tup as total FROM pg_stat_user_tables WHERE relname = 'vehicles'`,
  });
  const total = Array.isArray(totalR) ? Number(totalR[0]?.total) : 0;

  // Count by source using indexed discovery_source column (fast)
  const sources = ["bat", "bat_core", "carsandbids", "mecum", "barrett-jackson", "bonhams", "PCARMARKET", "gooding"];
  const sourceCounts: Record<string, number> = {};

  await Promise.all(sources.map(async (src) => {
    const { count } = await supabase
      .from("vehicles")
      .select("id", { count: "exact", head: true })
      .eq("discovery_source", src)
      .is("deleted_at", null);
    sourceCounts[src] = count || 0;
  }));

  // Sample field coverage from top 4 sources (200 each via PostgREST)
  const fields = ["vin", "body_style", "engine_type", "transmission", "mileage", "color", "sale_price", "horsepower", "description"];
  const fieldCoverage: Record<string, Record<string, number>> = {};

  await Promise.all(sources.slice(0, 5).map(async (src) => {
    const { data } = await supabase
      .from("vehicles")
      .select("vin, body_style, engine_type, transmission, mileage, color, sale_price, horsepower, description")
      .eq("discovery_source", src)
      .is("deleted_at", null)
      .limit(200);

    if (data?.length) {
      const coverage: Record<string, number> = {};
      for (const f of fields) {
        const filled = data.filter((v: any) => v[f] != null).length;
        coverage[f] = Math.round((filled / data.length) * 100);
      }
      fieldCoverage[src] = coverage;
    }
  }));

  return okJson({
    success: true,
    strategy: "stats",
    total,
    sources: sourceCounts,
    field_coverage_pct: fieldCoverage,
    note: "Field coverage sampled from 200 vehicles per source",
  });
}

// ─── Main Handler ────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const strategy = body.strategy || "stats";

    console.log(`[ENRICH-BULK] Strategy: ${strategy}, limit: ${body.limit || "default"}`);

    let response: Response;

    // deno-lint-ignore no-explicit-any
    const STRATEGY_MAP: Record<string, (s: any, b: Record<string, unknown>) => Promise<Response>> = {
      vin_decode: handleVinDecode,
      mine_descriptions: handleMineDescriptions,
      cross_reference: handleCrossReference,
      derive_fields: handleDeriveFields,
      estimate_hp: handleEstimateHP,
      backfill_location: handleBackfillLocation,
      smart_primary_image: handleSmartPrimaryImage,
      vin_link_suggestions: handleVinLinkSuggestions,
    };

    switch (strategy) {
      case "stats":
        response = await handleStats(supabase);
        break;
      case "all": {
        const allResults: Record<string, unknown> = { strategy: "all", source: body.source };
        for (const [s, handler] of Object.entries(STRATEGY_MAP)) {
          try {
            const r = await handler(supabase, body);
            const text = await r.text();
            allResults[s] = JSON.parse(text);
          } catch (e: unknown) {
            allResults[s] = { error: e instanceof Error ? e.message : String(e) };
          }
        }
        response = okJson({ success: true, ...allResults });
        break;
      }
      default: {
        const handler = STRATEGY_MAP[strategy];
        if (!handler) {
          return okJson({
            success: false,
            error: `Unknown strategy: ${strategy}`,
            available: [...Object.keys(STRATEGY_MAP), "stats", "all"],
          }, 400);
        }
        response = await handler(supabase, body);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[ENRICH-BULK] ${strategy} completed in ${duration}ms`);

    // Inject duration into response
    const text = await response.text();
    const data = JSON.parse(text);
    data.duration_ms = duration;

    return okJson(data, response.status);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : (typeof e === "object" && e !== null ? JSON.stringify(e) : String(e));
    console.error("[ENRICH-BULK] Error:", msg);
    return okJson({ success: false, error: msg, duration_ms: Date.now() - startTime }, 500);
  }
});
