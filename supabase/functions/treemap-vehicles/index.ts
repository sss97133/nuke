import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface VehicleAgg {
  make: string | null;
  model: string | null;
  year: number | null;
  source: string | null;
  count: number;
  total_value: number;
  avg_value: number;
}

// Normalize source names to canonical form
function normalizeSource(raw: string | null): string {
  if (!raw) return "Other";
  const lower = raw.toLowerCase().trim();

  // Map variations to canonical names
  const sourceMap: Record<string, string> = {
    "bat": "Bring a Trailer",
    "bringatrailer": "Bring a Trailer",
    "bring a trailer": "Bring a Trailer",
    "bring-a-trailer": "Bring a Trailer",
    "gooding": "Gooding & Co",
    "gooding & co": "Gooding & Co",
    "gooding & company": "Gooding & Co",
    "rm sothebys": "RM Sotheby's",
    "rm sotheby's": "RM Sotheby's",
    "rm-sothebys": "RM Sotheby's",
    "rmsothebys": "RM Sotheby's",
    "cars & bids": "Cars & Bids",
    "cars and bids": "Cars & Bids",
    "cars-and-bids": "Cars & Bids",
    "carsandbids": "Cars & Bids",
    "barrett-jackson": "Barrett-Jackson",
    "barrett jackson": "Barrett-Jackson",
    "barrettjackson": "Barrett-Jackson",
    "mecum": "Mecum",
    "mecum auctions": "Mecum",
    "bonhams": "Bonhams",
    "pcarmarket": "PCarMarket",
    "collecting-cars": "Collecting Cars",
    "collecting cars": "Collecting Cars",
    "hagerty": "Hagerty",
    "dupont registry": "DuPont Registry",
    "dupont-registry": "DuPont Registry",
    "hemmings": "Hemmings",
    "classic.com": "Classic.com",
    "classic-com": "Classic.com",
    "broad arrow": "Broad Arrow",
    "broad-arrow": "Broad Arrow",
    "broadarrow": "Broad Arrow",
    "sbx cars": "SBX Cars",
    "sbx-cars": "SBX Cars",
    "user submission": "Other",
    "unknown": "Other",
    "unknown source": "Other",
    "other": "Other",
  };

  return sourceMap[lower] || (raw.charAt(0).toUpperCase() + raw.slice(1));
}

// Normalize make names to proper case
function normalizeMake(raw: string | null): string | null {
  if (!raw || raw.trim() === "") return null;

  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();

  // Special case mappings for makes with specific capitalization
  const makeMap: Record<string, string> = {
    // Abbreviations / acronyms
    "bmw": "BMW",
    "vw": "Volkswagen",
    "volkswagen": "Volkswagen",
    "gmc": "GMC",
    "mg": "MG",
    "tvr": "TVR",
    "ac": "AC",
    "aar": "AAR",
    "aar-toyota": "AAR-Toyota",

    // Multi-word makes
    "am general": "AM General",
    "de tomaso": "De Tomaso",
    "detomaso": "De Tomaso",

    // Alfa Romeo variations
    "alfa romeo": "Alfa Romeo",
    "alfaromeo": "Alfa Romeo",
    "alfa-romeo": "Alfa Romeo",
    "alfa": "Alfa Romeo", // Partial name

    // Aston Martin variations
    "aston martin": "Aston Martin",
    "astonmartin": "Aston Martin",
    "aston-martin": "Aston Martin",
    "aston": "Aston Martin", // Partial name

    // Land Rover
    "land rover": "Land Rover",
    "landrover": "Land Rover",
    "land-rover": "Land Rover",

    // Mercedes-Benz
    "mercedes-benz": "Mercedes-Benz",
    "mercedes benz": "Mercedes-Benz",
    "mercedesbenz": "Mercedes-Benz",
    "mercedes": "Mercedes-Benz",
    "mercedes-simplex": "Mercedes-Simplex",

    // Rolls-Royce
    "rolls-royce": "Rolls-Royce",
    "rolls royce": "Rolls-Royce",
    "rollsroyce": "Rolls-Royce",

    // McLaren
    "mclaren": "McLaren",
    "mc laren": "McLaren",

    // Other special cases
    "harley-davidson": "Harley-Davidson",
    "harley davidson": "Harley-Davidson",
    "isotta fraschini": "Isotta Fraschini",
    "hispano-suiza": "Hispano-Suiza",
    "avions voisin": "Avions Voisin",
    "talbot-lago": "Talbot-Lago",
  };

  if (makeMap[lower]) return makeMap[lower];

  // Default: proper case
  const separator = trimmed.includes('-') ? '-' : ' ';
  return trimmed.split(/[\s-]+/).map(word =>
    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  ).join(separator);
}

// Normalize model names
function normalizeModel(raw: string | null): string | null {
  if (!raw || raw.trim() === "") return null;
  return raw.trim();
}

// Check if a make name is valid (not a parsing error)
function isValidMake(make: string | null): boolean {
  if (!make) return false;

  const lower = make.toLowerCase().trim();

  // Filter out mileage values that ended up in make field
  if (/^\d/.test(lower)) return false; // Starts with number
  if (/mile/i.test(lower)) return false; // Contains "mile"
  if (/^\.[0-9]/.test(lower)) return false; // Starts with decimal

  // Filter out obvious non-makes (common first names, etc)
  const invalidMakes = new Set([
    'john', 'jeff', 'mike', 'jim', 'bob', 'tom', 'bill', 'dan', 'joe', 'ben',
    'no', 'the', 'a', 'an', 'and', 'or', 'for', 'from', 'with', 'at', 'by',
    'reserve', 'bid', 'sold', 'buy', 'sale', 'auction', 'listing',
    'bug', 'ts', '.5', 'original-owner,', 'original-owner', 'one-owner',
    'no-reserve', 'modified', 'restored', 'unrestored', 'barn-find', 'project'
  ]);

  if (invalidMakes.has(lower)) return false;

  // Filter out patterns that look like listing descriptors
  if (/owner/i.test(lower)) return false;
  if (/reserve/i.test(lower)) return false;
  if (/modif/i.test(lower)) return false;
  if (/restor/i.test(lower)) return false;

  // Must be at least 2 characters (except known 2-char makes)
  const valid2Char = new Set(['mg', 'ac', 'vw']);
  if (lower.length < 2 || (lower.length === 2 && !valid2Char.has(lower))) return false;

  return true;
}

// Get all variations of a source name for filtering
function getSourceVariations(canonical: string): string[] {
  const variations: Record<string, string[]> = {
    "Bring a Trailer": ["bat", "bringatrailer", "bring a trailer", "bring-a-trailer"],
    "Gooding & Co": ["gooding", "gooding & co", "gooding & company"],
    "RM Sotheby's": ["rm sothebys", "rm sotheby's", "rm-sothebys", "rmsothebys"],
    "Cars & Bids": ["cars & bids", "cars and bids", "cars-and-bids", "carsandbids"],
    "Barrett-Jackson": ["barrett-jackson", "barrett jackson", "barrettjackson"],
    "Mecum": ["mecum", "mecum auctions"],
    "Bonhams": ["bonhams"],
    "PCarMarket": ["pcarmarket"],
    "Collecting Cars": ["collecting-cars", "collecting cars"],
    "Hagerty": ["hagerty"],
    "DuPont Registry": ["dupont registry", "dupont-registry"],
    "Hemmings": ["hemmings"],
    "Classic.com": ["classic.com", "classic-com"],
  };

  return variations[canonical] || [canonical.toLowerCase()];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const source = url.searchParams.get("source");
    const make = url.searchParams.get("make");
    const model = url.searchParams.get("model");
    const year = url.searchParams.get("year");

    const supabase = createClient(supabaseUrl, supabaseKey);

    // At year level, fetch individual vehicles with more fields
    const selectFields = year
      ? "id,source,auction_source,platform_source,make,model,year,sale_price,sold_price,listing_title,bat_listing_title"
      : "source,auction_source,platform_source,make,model,year,sale_price,sold_price";

    let queryBuilder = supabase
      .from("vehicles")
      .select(selectFields)
      .or("sale_price.gt.0,sold_price.gt.0")
      .is("deleted_at", null)
      .order("sale_price", { ascending: false, nullsFirst: false })
      .limit(year ? 500 : 100000); // Limit individual vehicles

    // Filters
    if (source) {
      // Filter by source - need to handle normalized source names
      const sourceVariations = getSourceVariations(source);
      if (sourceVariations.length > 0) {
        const orClauses = sourceVariations.map(s =>
          `auction_source.ilike.%${s}%,platform_source.ilike.%${s}%`
        ).join(",");
        queryBuilder = queryBuilder.or(orClauses);
      }
      // When drilling into a source, exclude null makes
      queryBuilder = queryBuilder.not("make", "is", null);
    }
    if (make) {
      queryBuilder = queryBuilder.ilike("make", `%${make}%`);
      // When drilling into a make, exclude null models
      queryBuilder = queryBuilder.not("model", "is", null);
    }
    if (model) {
      queryBuilder = queryBuilder.ilike("model", model);
    }
    if (year && year !== "Unknown Year") {
      queryBuilder = queryBuilder.eq("year", parseInt(year));
    }

    const { data: vehicles, error } = await queryBuilder;

    if (error) {
      console.error("Query error:", error);
      throw error;
    }

    // Aggregate in memory with normalization
    const data: VehicleAgg[] = [];
    const aggMap = new Map<string, VehicleAgg>();

    // Max realistic price - highest auction sale ever was ~$70M (Ferrari 250 GTO)
    const MAX_SANE_PRICE = 100000000; // $100M

    (vehicles || []).forEach((v: any) => {
      // Get price and skip obviously wrong data (data entry errors)
      const price = v.sale_price || v.sold_price || 0;
      if (price > MAX_SANE_PRICE) return; // Skip billion-dollar typos

      // Prefer auction_source over generic "source" field and normalize
      const rawSrc = v.auction_source || v.platform_source || v.source;
      const src = normalizeSource(rawSrc);

      // Normalize make and model, skip invalid makes
      const normalizedMake = normalizeMake(v.make);
      if (!isValidMake(normalizedMake)) return; // Skip invalid makes

      const normalizedModel = normalizeModel(v.model);

      const key = `${src}|${normalizedMake}|${normalizedModel}|${v.year}`;

      if (!aggMap.has(key)) {
        aggMap.set(key, {
          source: src,
          make: normalizedMake,
          model: normalizedModel,
          year: v.year,
          count: 0,
          total_value: 0,
          avg_value: 0
        });
      }

      const agg = aggMap.get(key)!;
      agg.count++;
      agg.total_value += price;
    });

    // Calculate averages and convert to array
    aggMap.forEach((agg) => {
      agg.avg_value = agg.count > 0 ? Math.round(agg.total_value / agg.count) : 0;
      data.push(agg);
    });

    // Sort by value
    data.sort((a, b) => b.total_value - a.total_value);

    // Build hierarchical structure based on filter level
    let hierarchy: any;
    let stats: any;

    if (!source) {
      // Top level: group by source
      const bySource: Record<string, any> = {};
      let totalValue = 0;
      let totalCount = 0;

      data.forEach((row) => {
        const src = row.source || "Other";
        if (!bySource[src]) {
          bySource[src] = { name: src, value: 0, count: 0, children: {} };
        }
        bySource[src].value += Number(row.total_value);
        bySource[src].count += row.count;
        totalValue += Number(row.total_value);
        totalCount += row.count;

        // Also track makes within each source (skip null makes)
        if (row.make) {
          const makeName = row.make;
          if (!bySource[src].children[makeName]) {
            bySource[src].children[makeName] = { name: makeName, value: 0, count: 0 };
          }
          bySource[src].children[makeName].value += Number(row.total_value);
          bySource[src].children[makeName].count += row.count;
        }
      });

      // Convert to array format - FLAT children only (no nested grandchildren)
      const sourceArray = Object.values(bySource)
        .map((s: any) => ({
          name: s.name,
          value: s.value,
          count: s.count
          // No children - keep it flat for treemap leaves
        }))
        .filter((s: any) =>
          s.value > 0 && // Must have value
          (s.name !== "Other" || s.value > totalValue * 0.01) // Keep "Other" only if > 1%
        )
        .sort((a, b) => b.value - a.value);

      hierarchy = {
        name: "All Vehicles",
        value: totalValue,
        count: totalCount,
        children: sourceArray
      };

      stats = { totalValue, totalCount, level: "sources" };

    } else if (!make) {
      // Source selected: group by make (already filtered to non-null makes in query)
      const byMake: Record<string, any> = {};
      let totalValue = 0;
      let totalCount = 0;

      data.forEach((row) => {
        // Skip rows without make (shouldn't happen due to query filter, but be safe)
        if (!row.make) return;

        const makeName = row.make;
        if (!byMake[makeName]) {
          byMake[makeName] = { name: makeName, value: 0, count: 0, children: {} };
        }
        byMake[makeName].value += Number(row.total_value);
        byMake[makeName].count += row.count;
        totalValue += Number(row.total_value);
        totalCount += row.count;

        // Track models within each make (skip null models)
        if (row.model) {
          const modelName = row.model;
          if (!byMake[makeName].children[modelName]) {
            byMake[makeName].children[modelName] = { name: modelName, value: 0, count: 0 };
          }
          byMake[makeName].children[modelName].value += Number(row.total_value);
          byMake[makeName].children[modelName].count += row.count;
        }
      });

      hierarchy = {
        name: normalizeSource(source),
        value: totalValue,
        count: totalCount,
        children: Object.values(byMake)
          .map((m: any) => ({
            name: m.name,
            value: m.value,
            count: m.count
            // No nested children - flat for treemap
          }))
          .filter((m: any) => m.value > 0)
          .sort((a, b) => b.value - a.value)
      };

      stats = { totalValue, totalCount, level: "makes", source: normalizeSource(source) };

    } else if (!model) {
      // Make selected: group by model (already filtered to non-null models in query)
      const byModel: Record<string, any> = {};
      let totalValue = 0;
      let totalCount = 0;

      data.forEach((row) => {
        // Skip rows without model (shouldn't happen due to query filter, but be safe)
        if (!row.model) return;

        const modelName = row.model;
        if (!byModel[modelName]) {
          byModel[modelName] = { name: modelName, value: 0, count: 0, children: {} };
        }
        byModel[modelName].value += Number(row.total_value);
        byModel[modelName].count += row.count;
        totalValue += Number(row.total_value);
        totalCount += row.count;

        // Track years within each model
        const yearName = row.year ? String(row.year) : "Other";
        if (!byModel[modelName].children[yearName]) {
          byModel[modelName].children[yearName] = { name: yearName, value: 0, count: 0 };
        }
        byModel[modelName].children[yearName].value += Number(row.total_value);
        byModel[modelName].children[yearName].count += row.count;
      });

      const normalizedSource = normalizeSource(source);
      hierarchy = {
        name: `${normalizedSource} › ${make}`,
        value: totalValue,
        count: totalCount,
        children: Object.values(byModel)
          .map((m: any) => ({
            name: m.name,
            value: m.value,
            count: m.count
            // No nested children - flat for treemap
          }))
          .filter((m: any) => m.value > 0)
          .sort((a, b) => b.value - a.value)
      };

      stats = { totalValue, totalCount, level: "models", source: normalizedSource, make };

    } else if (!year) {
      // Model selected: group by year
      const byYear: Record<string, any> = {};
      let totalValue = 0;
      let totalCount = 0;

      data.forEach((row) => {
        const yearName = row.year ? String(row.year) : "Other";
        if (!byYear[yearName]) {
          byYear[yearName] = { name: yearName, value: 0, count: 0, avg: 0 };
        }
        byYear[yearName].value += Number(row.total_value);
        byYear[yearName].count += row.count;
        totalValue += Number(row.total_value);
        totalCount += row.count;
      });

      Object.values(byYear).forEach((y: any) => {
        y.avg = y.count > 0 ? Math.round(y.value / y.count) : 0;
      });

      const normalizedSource = normalizeSource(source);
      hierarchy = {
        name: `${normalizedSource} › ${make} › ${model}`,
        value: totalValue,
        count: totalCount,
        children: Object.values(byYear)
          .filter((y: any) => y.value > 0)
          .sort((a: any, b: any) => b.value - a.value)
      };

      stats = { totalValue, totalCount, level: "years", source: normalizedSource, make, model };

    } else {
      // Year selected: show individual vehicles
      let totalValue = 0;
      const vehicleList: any[] = [];

      (vehicles || []).forEach((v: any) => {
        const price = v.sale_price || v.sold_price || 0;
        const normalizedMake = normalizeMake(v.make) || '';
        const normalizedModel = normalizeModel(v.model) || '';
        const title = v.listing_title || v.bat_listing_title || `${v.year || ''} ${normalizedMake} ${normalizedModel}`.trim() || 'Vehicle';
        totalValue += price;
        vehicleList.push({
          id: v.id,
          name: title.length > 40 ? title.slice(0, 40) + '…' : title,
          fullName: title,
          value: price,
          count: 1,
          year: v.year,
          make: normalizedMake,
          model: normalizedModel,
          isVehicle: true
        });
      });

      // Sort by price descending
      vehicleList.sort((a, b) => b.value - a.value);

      const normalizedSource = normalizeSource(source);
      hierarchy = {
        name: `${normalizedSource} › ${make} › ${model} › ${year}`,
        value: totalValue,
        count: vehicleList.length,
        children: vehicleList.slice(0, 200) // Limit to 200 vehicles
      };

      stats = { totalValue, totalCount: vehicleList.length, level: "vehicles", source: normalizedSource, make, model, year };
    }

    return new Response(
      JSON.stringify({
        hierarchy,
        stats,
        filters: { source, make, model },
        generated_at: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
