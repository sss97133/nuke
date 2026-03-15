/**
 * Barn Finds listing extractor
 *
 * WordPress site – direct fetch first (no Firecrawl). Fallback to Firecrawl if blocked.
 * Parses: title, Asking/High Bid, Chassis # (VIN), Mileage, Location, Seller, description.
 *
 * POST { url: "https://barnfinds.com/bf-exclusive-1990-ford-f-150-lariat-4x4/" }
 * POST { url, use_firecrawl: true }  – force Firecrawl
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { firecrawlScrape } from "../_shared/firecrawl.ts";
import { normalizeListingUrlKey } from "../_shared/listingUrl.ts";
import { normalizeVehicleFields } from "../_shared/normalizeVehicle.ts";
import { qualityGate } from "../_shared/extractionQualityGate.ts";
import { resolveExistingVehicleId, discoveryUrlIlikePattern } from "../_shared/resolveVehicleForListing.ts";

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

function parseFromMarkdown(md: string, url: string): Record<string, unknown> {
  const data: Record<string, unknown> = { url, title: null, year: null, make: null, model: null, vin: null, mileage: null, sale_price: null, asking_price: null, high_bid: null, location: null, seller: null, description: null };
  const lines = md.split("\n").map((l) => l.trim()).filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("# ")) {
      data.title = line.replace(/^#\s+/, "").trim();
      // Match year-make-model from title, handling prefixes like "Original Paint Survivor: 1955 Jeep CJ5"
      const titleMatch = data.title && String(data.title).match(/(?:^|:\s*)(\d{4})\s+(.+?)(?:\s+[×x]\s*\d+)?$/i);
      if (titleMatch) {
        data.year = parseInt(titleMatch[1], 10);
        const rest = titleMatch[2];
        const parts = rest.split(/\s+/);
        if (parts.length >= 1) data.make = parts[0];
        if (parts.length >= 2) data.model = parts.slice(1).join(" ");
      }
      continue;
    }
    if (/^Asking:\s*\$?([\d,]+)/i.test(line)) {
      const m = line.match(/^Asking:\s*\$?([\d,]+)/i);
      if (m) data.asking_price = parseInt(m[1].replace(/,/g, ""), 10);
      continue;
    }
    if (/^High Bid:\s*\$?([\d,]+)/i.test(line)) {
      const m = line.match(/^High Bid:\s*\$?([\d,]+)/i);
      if (m) data.high_bid = parseInt(m[1].replace(/,/g, ""), 10);
      continue;
    }
    if (/Chassis\s*#?:\s*([A-HJ-NPR-Z0-9]{17})/i.test(line)) {
      const m = line.match(/Chassis\s*#?:\s*([A-HJ-NPR-Z0-9]{17})/i);
      if (m) data.vin = m[1].toUpperCase();
      continue;
    }
    if (/Mileage:\s*([\d,]+)/i.test(line)) {
      const m = line.match(/Mileage:\s*([\d,]+)/i);
      if (m) data.mileage = parseInt(m[1].replace(/,/g, ""), 10);
      continue;
    }
    if (/^Location:\s*\[?([^\]]+)\]?/i.test(line)) {
      const m = line.match(/^Location:\s*\[?([^\]]+)\]?/i);
      if (m) data.location = m[1].trim();
      continue;
    }
    if (/^Seller:\s*(.+)/i.test(line)) {
      const m = line.match(/^Seller:\s*(.+)/i);
      if (m) data.seller = m[1].trim();
      continue;
    }
  }

  const price = Number(data.sale_price) || Number(data.asking_price) || Number(data.high_bid) || null;
  if (price) data.sale_price = price;
  if (!data.vin && md) {
    const vinMatch = md.match(/\b([A-HJ-NPR-Z0-9]{17})\b/g);
    if (vinMatch && vinMatch.length >= 1) data.vin = vinMatch[0].toUpperCase();
  }
  const descStart = md.indexOf("If you've been looking");
  if (descStart === -1) data.description = md.slice(0, 2000).trim();
  else data.description = md.slice(descStart, descStart + 3000).trim();
  return data;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const url = (body.url || "").trim().replace(/\/$/, "");
    const useFirecrawl = body.use_firecrawl === true;

    if (!url || !url.includes("barnfinds.com")) {
      return new Response(JSON.stringify({ success: false, error: "url required (barnfinds.com)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let markdown: string | null = null;
    if (!useFirecrawl) {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15000) });
      if (res.ok) {
        const html = await res.text();
        // Extract h1 title separately (it's outside entry-content on Barn Finds)
        const h1Match = html.match(/<h1[^>]*class="entry-title"[^>]*>([\s\S]*?)<\/h1>/i) || html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
        const h1Title = h1Match ? h1Match[1].replace(/<[^>]+>/g, "").trim() : "";
        // Match entry-content first (Barn Finds WordPress structure), then fallback
        const mainMatch = html.match(/<div[^>]*class="entry-content"[^>]*>([\s\S]+?)<\/div>\s*(?:<div class="(?:author|post-tags|sharing)|<\/article)/i)
          || html.match(/<main[^>]*>([\s\S]+?)<\/main>/i)
          || html.match(/<article[^>]*>([\s\S]+?)<\/article>/i)
          || html.match(/<div[^>]*class="entry-content"[^>]*>([\s\S]+)/i);
        const content = mainMatch ? mainMatch[1] : html;
        const strip = content.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
        let text = strip.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "# $1\n").replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n").replace(/<p[^>]*>/gi, "\n").replace(/<li[^>]*>/gi, "\n- ").replace(/<\/p>|<\/li>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&\#8217;/g, "'").replace(/&\#8220;|&\#8221;/g, '"').replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
        // Prepend h1 as markdown heading if not already present
        if (h1Title && !text.startsWith("# ")) {
          text = `# ${h1Title}\n${text}`;
        }
        markdown = text;
      }
    }

    if (!markdown) {
      const key = Deno.env.get("FIRECRAWL_API_KEY");
      if (key) {
        const result = await firecrawlScrape({ url, formats: ["markdown"], onlyMainContent: true }, { timeoutMs: 25000 });
        markdown = result?.data?.markdown ?? null;
      }
    }

    if (!markdown) {
      return new Response(JSON.stringify({ success: false, error: "Could not fetch or parse page" }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed = parseFromMarkdown(markdown, url);
    const year = parsed.year as number | null;
    const make = (parsed.make as string) || null;
    const model = (parsed.model as string) || null;
    const vin = (parsed.vin as string) || null;
    const salePrice = parsed.sale_price != null ? Number(parsed.sale_price) : null;
    const title = (parsed.title as string) || null;
    if (!year && !vin && !title) {
      return new Response(JSON.stringify({ success: false, error: "No vehicle data extracted" }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const platform = "barnfinds";
    const slug = url.replace(/^https?:\/\/[^/]+\//, "").replace(/\/$/, "");
    // Skip ILIKE pattern (causes full table scan timeout on 800K+ vehicles)
    // Barn Finds URLs are consistent, so exact match is sufficient
    const { vehicleId } = await resolveExistingVehicleId(supabase, {
      url,
      platform,
      discoveryUrlIlikePattern: null,
    });

    const listingUrlKey = normalizeListingUrlKey(url);
    const norm = normalizeVehicleFields({ make, model, year });
    const vehicleRow = {
      discovery_url: url,
      discovery_source: platform,
      year: norm.year ?? year ?? undefined,
      make: norm.make ?? make,
      model: norm.model ?? model,
      vin: vin || undefined,
      sale_price: salePrice ?? undefined,
      title: title || undefined,
      profile_origin: "barnfinds",
      source: "barnfinds",
      is_public: true,
      status: "active",
    };

    // Quality gate: validate before writing to vehicles
    const gateResult = qualityGate(vehicleRow, { source: 'barnfinds', sourceType: 'marketplace' });
    if (gateResult.action === 'reject') {
      console.warn(`[barnfinds] Quality gate rejected (score=${gateResult.score}): ${gateResult.issues.join(', ')}`);
      return new Response(JSON.stringify({
        success: false,
        error: 'Quality gate rejected extraction',
        quality_score: gateResult.score,
        quality_issues: gateResult.issues,
      }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    Object.assign(vehicleRow, gateResult.cleaned);

    let finalVehicleId: string;
    if (vehicleId) {
      await supabase.from("vehicles").update(vehicleRow).eq("id", vehicleId);
      finalVehicleId = vehicleId;
    } else {
      const { data: inserted, error: insErr } = await supabase.from("vehicles").insert(vehicleRow).select("id").maybeSingle();
      if (insErr) throw new Error(insErr?.message || String(insErr));
      if (!inserted) throw new Error("Vehicle insert returned no data");
      finalVehicleId = inserted.id;
    }

    await supabase.from("vehicle_events").upsert(
      {
        vehicle_id: finalVehicleId,
        source_platform: platform,
        event_type: "listing",
        source_url: url,
        source_listing_id: listingUrlKey || slug,
        event_status: "active",
        metadata: { seller: parsed.seller, location: parsed.location, source: "extract-barn-finds-listing" },
      },
      { onConflict: "source_platform,source_listing_id" }
    );

    return new Response(JSON.stringify({ success: true, vehicle_id: finalVehicleId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[extract-barn-finds-listing]", e);
    return new Response(JSON.stringify({ success: false, error: e?.message ?? String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
