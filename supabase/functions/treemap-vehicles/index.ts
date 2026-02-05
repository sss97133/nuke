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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const viewMode = url.searchParams.get("view") || "source";
    const source = url.searchParams.get("source");
    const make = url.searchParams.get("make");
    const model = url.searchParams.get("model");
    const year = url.searchParams.get("year");

    const supabase = createClient(supabaseUrl, supabaseKey);

    let hierarchy: any;
    let stats: any;

    // BRAND VIEW: Brand → Model → Year
    if (viewMode === "brand") {
      if (!make) {
        // Top level: all brands
        const { data, error } = await supabase.rpc("treemap_by_brand");
        if (error) throw error;

        const children = (data || []).map((r: any) => ({
          name: r.name,
          value: Number(r.value),
          count: Number(r.count)
        }));

        const totalValue = children.reduce((s: number, c: any) => s + c.value, 0);
        const totalCount = children.reduce((s: number, c: any) => s + c.count, 0);

        hierarchy = { name: "All Brands", value: totalValue, count: totalCount, children };
        stats = { totalValue, totalCount, level: "brands" };

      } else if (!model) {
        // Models for a brand
        const { data, error } = await supabase.rpc("treemap_models_by_brand", { p_make: make });
        if (error) throw error;

        const children = (data || []).map((r: any) => ({
          name: r.name,
          value: Number(r.value),
          count: Number(r.count)
        }));

        const totalValue = children.reduce((s: number, c: any) => s + c.value, 0);
        const totalCount = children.reduce((s: number, c: any) => s + c.count, 0);

        hierarchy = { name: make, value: totalValue, count: totalCount, children };
        stats = { totalValue, totalCount, level: "models", make };

      } else if (!year) {
        // Years for a brand + model
        const { data, error } = await supabase.rpc("treemap_years", {
          p_source: null,
          p_make: make,
          p_model: model
        });
        if (error) throw error;

        const children = (data || []).map((r: any) => ({
          name: r.name,
          value: Number(r.value),
          count: Number(r.count)
        }));

        const totalValue = children.reduce((s: number, c: any) => s + c.value, 0);
        const totalCount = children.reduce((s: number, c: any) => s + c.count, 0);

        hierarchy = { name: `${make} › ${model}`, value: totalValue, count: totalCount, children };
        stats = { totalValue, totalCount, level: "years", make, model };

      } else {
        // Individual vehicles
        const yearNum = parseInt(year);
        const { data: vehicles, error } = await supabase
          .from("vehicles")
          .select("id, listing_title, bat_listing_title, year, make, model, sale_price, sold_price")
          .or("sale_price.gt.0,sold_price.gt.0")
          .is("deleted_at", null)
          .eq("year", yearNum)
          .ilike("make", make)
          .ilike("model", model)
          .order("sale_price", { ascending: false })
          .limit(200);

        if (error) throw error;

        let totalValue = 0;
        const children = (vehicles || []).map((v: any) => {
          const price = v.sale_price || v.sold_price || 0;
          totalValue += price;
          const title = v.listing_title || v.bat_listing_title || `${v.year} ${v.make} ${v.model}`;
          return {
            id: v.id,
            name: title.length > 40 ? title.slice(0, 40) + '…' : title,
            fullName: title,
            value: price,
            count: 1,
            isVehicle: true
          };
        });

        hierarchy = { name: `${make} › ${model} › ${year}`, value: totalValue, count: children.length, children };
        stats = { totalValue, totalCount: children.length, level: "vehicles", make, model, year };
      }

    // SOURCE VIEW (default): Source → Make → Model → Year
    } else if (!source) {
      // Top level: all sources
      const { data, error } = await supabase.rpc("treemap_by_source");
      if (error) throw error;

      const children = (data || []).map((r: any) => ({
        name: r.name,
        value: Number(r.value),
        count: Number(r.count)
      }));

      const totalValue = children.reduce((s: number, c: any) => s + c.value, 0);
      const totalCount = children.reduce((s: number, c: any) => s + c.count, 0);

      hierarchy = { name: "All Vehicles", value: totalValue, count: totalCount, children };
      stats = { totalValue, totalCount, level: "sources" };

    } else if (!make) {
      // Makes for a source
      const { data, error } = await supabase.rpc("treemap_makes_by_source", { p_source: source });
      if (error) throw error;

      const children = (data || []).map((r: any) => ({
        name: r.name,
        value: Number(r.value),
        count: Number(r.count)
      }));

      const totalValue = children.reduce((s: number, c: any) => s + c.value, 0);
      const totalCount = children.reduce((s: number, c: any) => s + c.count, 0);

      hierarchy = { name: normalizeSource(source), value: totalValue, count: totalCount, children };
      stats = { totalValue, totalCount, level: "makes", source: normalizeSource(source) };

    } else if (!model) {
      // Models for a source + make
      const { data, error } = await supabase.rpc("treemap_models", { p_source: source, p_make: make });
      if (error) throw error;

      const children = (data || []).map((r: any) => ({
        name: r.name,
        value: Number(r.value),
        count: Number(r.count)
      }));

      const totalValue = children.reduce((s: number, c: any) => s + c.value, 0);
      const totalCount = children.reduce((s: number, c: any) => s + c.count, 0);

      hierarchy = { name: `${normalizeSource(source)} › ${make}`, value: totalValue, count: totalCount, children };
      stats = { totalValue, totalCount, level: "models", source: normalizeSource(source), make };

    } else if (!year) {
      // Years for source + make + model
      const { data, error } = await supabase.rpc("treemap_years", {
        p_source: source,
        p_make: make,
        p_model: model
      });
      if (error) throw error;

      const children = (data || []).map((r: any) => ({
        name: r.name,
        value: Number(r.value),
        count: Number(r.count)
      }));

      const totalValue = children.reduce((s: number, c: any) => s + c.value, 0);
      const totalCount = children.reduce((s: number, c: any) => s + c.count, 0);

      hierarchy = { name: `${normalizeSource(source)} › ${make} › ${model}`, value: totalValue, count: totalCount, children };
      stats = { totalValue, totalCount, level: "years", source: normalizeSource(source), make, model };

    } else {
      // Individual vehicles
      const yearNum = parseInt(year);
      const sourceVariations = getSourceVariations(source);

      const { data: vehicles, error } = await supabase
        .from("vehicles")
        .select("id, listing_title, bat_listing_title, year, make, model, sale_price, sold_price, auction_source")
        .or("sale_price.gt.0,sold_price.gt.0")
        .is("deleted_at", null)
        .eq("year", yearNum)
        .ilike("make", make)
        .ilike("model", model)
        .order("sale_price", { ascending: false })
        .limit(500);

      if (error) throw error;

      const filtered = (vehicles || []).filter((v: any) => {
        const vSrc = (v.auction_source || "").toLowerCase();
        return sourceVariations.includes(vSrc);
      });

      let totalValue = 0;
      const children = filtered.slice(0, 200).map((v: any) => {
        const price = v.sale_price || v.sold_price || 0;
        totalValue += price;
        const title = v.listing_title || v.bat_listing_title || `${v.year} ${v.make} ${v.model}`;
        return {
          id: v.id,
          name: title.length > 40 ? title.slice(0, 40) + '…' : title,
          fullName: title,
          value: price,
          count: 1,
          isVehicle: true
        };
      });

      hierarchy = { name: `${normalizeSource(source)} › ${make} › ${model} › ${year}`, value: totalValue, count: children.length, children };
      stats = { totalValue, totalCount: children.length, level: "vehicles", source: normalizeSource(source), make, model, year };
    }

    return new Response(
      JSON.stringify({ hierarchy, stats, filters: { source, make, model, year }, generated_at: new Date().toISOString() }),
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
