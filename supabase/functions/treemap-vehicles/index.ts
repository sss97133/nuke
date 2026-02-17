import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Normalize source display names (for breadcrumbs etc)
function normalizeSource(raw: string | null): string {
  if (!raw) return "Other";
  const lower = raw.toLowerCase().trim().replace(/_/g, ' ');
  const map: Record<string, string> = {
    "bat": "Bring a Trailer", "bringatrailer": "Bring a Trailer", "bring a trailer": "Bring a Trailer",
    "gooding": "Gooding & Co", "gooding & co": "Gooding & Co",
    "rm sothebys": "RM Sotheby's", "rm sotheby's": "RM Sotheby's",
    "cars & bids": "Cars & Bids", "cars-and-bids": "Cars & Bids",
    "mecum": "Mecum", "bonhams": "Bonhams", "broad arrow": "Broad Arrow",
    "collecting cars": "Collecting Cars", "collectingcars": "Collecting Cars",
    "sbx cars": "SBX Cars", "pcarmarket": "PCarMarket",
    "classic.com": "Classic.com", "classic": "Classic.com",
  };
  return map[lower] || (raw.charAt(0).toUpperCase() + raw.slice(1).replace(/_/g, ' '));
}

// Map RPC row to child object with rich metrics
function mapChild(r: any) {
  return {
    name: r.name,
    value: Number(r.value || 0),
    count: Number(r.count || 0),
    medianPrice: Number(r.median_price || 0),
    minPrice: Number(r.min_price || 0),
    maxPrice: Number(r.max_price || 0),
    soldCount: Number(r.sold_count || 0),
    auctionCount: Number(r.auction_count || 0),
    avgBids: Number(r.avg_bids || 0),
    avgWatchers: Number(r.avg_watchers || 0),
  };
}

// Map vehicle row to child object
function mapVehicle(v: any) {
  const price = v.sale_price || v.sold_price || 0;
  const title = v.listing_title || v.bat_listing_title || `${v.year} ${v.make} ${v.model}`;
  return {
    id: v.id,
    name: title.length > 40 ? title.slice(0, 40) + '...' : title,
    fullName: title,
    value: price,
    count: 1,
    isVehicle: true,
    bids: v.bat_bids || 0,
    comments: v.bat_comments || 0,
    watchers: v.bat_watchers || 0,
    mileage: v.mileage || null,
    reserveStatus: v.reserve_status || null,
    auctionOutcome: v.auction_outcome || null,
  };
}

function sumChildren(children: any[]) {
  const totalValue = children.reduce((s: number, c: any) => s + c.value, 0);
  const totalCount = children.reduce((s: number, c: any) => s + c.count, 0);
  return { totalValue, totalCount };
}

const VEHICLE_SELECT = "id, listing_title, bat_listing_title, year, make, model, sale_price, sold_price, bat_bids, bat_comments, bat_watchers, mileage, reserve_status, auction_outcome";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const viewMode = url.searchParams.get("view") || "source";
    const source = url.searchParams.get("source");
    const segment = url.searchParams.get("segment");
    const make = url.searchParams.get("make");
    const model = url.searchParams.get("model");
    const year = url.searchParams.get("year");
    const nested = url.searchParams.get("nested") === "true";

    const supabase = createClient(supabaseUrl, supabaseKey);

    let hierarchy: any;
    let stats: any;

    // NESTED MODE: returns 2 levels in one call for treemap display
    if (nested) {
      const { data, error } = await supabase.rpc("treemap_nested", {
        p_view: viewMode,
        p_filter: segment || null,
      });
      if (error) throw error;

      hierarchy = data;
      const children = hierarchy?.children || [];
      const totalValue = children.reduce((s: number, c: any) => s + (c.value || 0), 0);
      const totalCount = children.reduce((s: number, c: any) => s + (c.count || 0), 0);
      stats = { totalValue, totalCount, level: viewMode === "segment" ? "segments" : "brands", nested: true };

      return new Response(
        JSON.stringify({ hierarchy, stats, filters: { segment, make, model, year }, generated_at: new Date().toISOString() }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // SEGMENT VIEW: Segment → Make → Model → Year
    if (viewMode === "segment") {
      if (!segment) {
        const { data, error } = await supabase.rpc("treemap_by_segment");
        if (error) throw error;
        const children = (data || []).map(mapChild);
        const { totalValue, totalCount } = sumChildren(children);
        hierarchy = { name: "All Segments", value: totalValue, count: totalCount, children };
        stats = { totalValue, totalCount, level: "segments" };

      } else if (!make) {
        const { data, error } = await supabase.rpc("treemap_makes_by_segment", { p_segment: segment });
        if (error) throw error;
        const children = (data || []).map(mapChild);
        const { totalValue, totalCount } = sumChildren(children);
        hierarchy = { name: segment, value: totalValue, count: totalCount, children };
        stats = { totalValue, totalCount, level: "makes", segment };

      } else if (!model) {
        const { data, error } = await supabase.rpc("treemap_models_by_brand", { p_make: make });
        if (error) throw error;
        const children = (data || []).map(mapChild);
        const { totalValue, totalCount } = sumChildren(children);
        hierarchy = { name: `${segment} › ${make}`, value: totalValue, count: totalCount, children };
        stats = { totalValue, totalCount, level: "models", segment, make };

      } else if (!year) {
        const { data, error } = await supabase.rpc("treemap_years", { p_source: null, p_make: make, p_model: model });
        if (error) throw error;
        const children = (data || []).map(mapChild);
        const { totalValue, totalCount } = sumChildren(children);
        hierarchy = { name: `${segment} › ${make} › ${model}`, value: totalValue, count: totalCount, children };
        stats = { totalValue, totalCount, level: "years", segment, make, model };

      } else {
        const yearNum = parseInt(year, 10);
        const { data: vehicles, error } = await supabase
          .from("vehicles")
          .select(VEHICLE_SELECT)
          .or("sale_price.gt.0,sold_price.gt.0")
          .is("deleted_at", null)
          .eq("year", yearNum)
          .ilike("make", make)
          .ilike("model", model)
          .order("sale_price", { ascending: false })
          .limit(200);
        if (error) throw error;
        const children = (vehicles || []).map(mapVehicle);
        const totalValue = children.reduce((s, c) => s + c.value, 0);
        hierarchy = { name: `${segment} › ${make} › ${model} › ${year}`, value: totalValue, count: children.length, children };
        stats = { totalValue, totalCount: children.length, level: "vehicles", segment, make, model, year };
      }

    // BRAND VIEW: Brand → Model → Year
    } else if (viewMode === "brand") {
      if (!make) {
        const { data, error } = await supabase.rpc("treemap_by_brand");
        if (error) throw error;
        const children = (data || []).map(mapChild);
        const { totalValue, totalCount } = sumChildren(children);
        hierarchy = { name: "All Brands", value: totalValue, count: totalCount, children };
        stats = { totalValue, totalCount, level: "brands" };

      } else if (!model) {
        const { data, error } = await supabase.rpc("treemap_models_by_brand", { p_make: make });
        if (error) throw error;
        const children = (data || []).map(mapChild);
        const { totalValue, totalCount } = sumChildren(children);
        hierarchy = { name: make, value: totalValue, count: totalCount, children };
        stats = { totalValue, totalCount, level: "models", make };

      } else if (!year) {
        const { data, error } = await supabase.rpc("treemap_years", { p_source: null, p_make: make, p_model: model });
        if (error) throw error;
        const children = (data || []).map(mapChild);
        const { totalValue, totalCount } = sumChildren(children);
        hierarchy = { name: `${make} › ${model}`, value: totalValue, count: totalCount, children };
        stats = { totalValue, totalCount, level: "years", make, model };

      } else {
        const yearNum = parseInt(year, 10);
        const { data: vehicles, error } = await supabase
          .from("vehicles")
          .select(VEHICLE_SELECT)
          .or("sale_price.gt.0,sold_price.gt.0")
          .is("deleted_at", null)
          .eq("year", yearNum)
          .ilike("make", make)
          .ilike("model", model)
          .order("sale_price", { ascending: false })
          .limit(200);
        if (error) throw error;
        const children = (vehicles || []).map(mapVehicle);
        const totalValue = children.reduce((s, c) => s + c.value, 0);
        hierarchy = { name: `${make} › ${model} › ${year}`, value: totalValue, count: children.length, children };
        stats = { totalValue, totalCount: children.length, level: "vehicles", make, model, year };
      }

    // SOURCE VIEW (default): Source → Make → Model → Year
    } else if (!source) {
      const { data, error } = await supabase.rpc("treemap_by_source");
      if (error) throw error;
      const children = (data || []).map(mapChild);
      const { totalValue, totalCount } = sumChildren(children);
      hierarchy = { name: "All Vehicles", value: totalValue, count: totalCount, children };
      stats = { totalValue, totalCount, level: "sources" };

    } else if (!make) {
      const { data, error } = await supabase.rpc("treemap_makes_by_source", { p_source: source });
      if (error) throw error;
      const children = (data || []).map(mapChild);
      const { totalValue, totalCount } = sumChildren(children);
      hierarchy = { name: normalizeSource(source), value: totalValue, count: totalCount, children };
      stats = { totalValue, totalCount, level: "makes", source: normalizeSource(source) };

    } else if (!model) {
      const { data, error } = await supabase.rpc("treemap_models", { p_source: source, p_make: make });
      if (error) throw error;
      const children = (data || []).map(mapChild);
      const { totalValue, totalCount } = sumChildren(children);
      hierarchy = { name: `${normalizeSource(source)} › ${make}`, value: totalValue, count: totalCount, children };
      stats = { totalValue, totalCount, level: "models", source: normalizeSource(source), make };

    } else if (!year) {
      const { data, error } = await supabase.rpc("treemap_years", { p_source: source, p_make: make, p_model: model });
      if (error) throw error;
      const children = (data || []).map(mapChild);
      const { totalValue, totalCount } = sumChildren(children);
      hierarchy = { name: `${normalizeSource(source)} › ${make} › ${model}`, value: totalValue, count: totalCount, children };
      stats = { totalValue, totalCount, level: "years", source: normalizeSource(source), make, model };

    } else {
      const yearNum = parseInt(year, 10);
      const sourceVariations = getSourceVariations(source);
      const { data: vehicles, error } = await supabase
        .from("vehicles")
        .select(VEHICLE_SELECT + ", auction_source")
        .or("sale_price.gt.0,sold_price.gt.0")
        .is("deleted_at", null)
        .eq("year", yearNum)
        .ilike("make", make)
        .ilike("model", model)
        .in("auction_source", sourceVariations)
        .order("sale_price", { ascending: false })
        .limit(200);
      if (error) throw error;
      const children = (vehicles || []).map(mapVehicle);
      const totalValue = children.reduce((s, c) => s + c.value, 0);
      hierarchy = { name: `${normalizeSource(source)} › ${make} › ${model} › ${year}`, value: totalValue, count: children.length, children };
      stats = { totalValue, totalCount: children.length, level: "vehicles", source: normalizeSource(source), make, model, year };
    }

    const isTopLevel = !source && !segment && !make && !model && !year;
    const cacheMaxAge = isTopLevel ? 300 : 60;

    return new Response(
      JSON.stringify({ hierarchy, stats, filters: { source, segment, make, model, year }, generated_at: new Date().toISOString() }),
      { headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": `public, max-age=${cacheMaxAge}, s-maxage=${cacheMaxAge}` } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function getSourceVariations(canonical: string): string[] {
  const lower = canonical.toLowerCase();
  const map: Record<string, string[]> = {
    "bring a trailer": ["bat", "bringatrailer", "bring a trailer"],
    "gooding & co": ["gooding", "gooding & co"],
    "rm sotheby's": ["rm sothebys", "rm sotheby's"],
    "cars & bids": ["cars & bids", "cars-and-bids"],
    "collecting cars": ["collecting_cars", "collecting cars"],
    "barrett-jackson": ["barrett-jackson"],
    "mecum": ["mecum"],
    "bonhams": ["bonhams"],
    "broad arrow": ["broad arrow"],
    "sbx cars": ["sbx cars"],
    "pcarmarket": ["pcarmarket"],
    "hagerty": ["hagerty"],
    "hemmings": ["hemmings"],
    "classic.com": ["classic.com"],
  };
  return map[lower] || [lower];
}
