/**
 * EXTRACT BARRETT-JACKSON
 *
 * Firecrawl-based extractor for Barrett-Jackson auction pages.
 * Parses structured data directly from markdown + HTML — no AI needed.
 *
 * BJ pages have clean labeled fields in the markdown:
 *   1966Year, CHEVROLETMake, EL CAMINOModel, etc.
 *
 * Images come from Azure CDN URLs in the raw HTML:
 *   https://BarrettJacksonCDN.azureedge.net/staging/carlist/items/fullsize/cars/{id}/{id}_*.jpg
 *
 * Actions:
 *   POST { "url": "..." }                  — Extract single URL
 *   POST { "action": "batch_from_queue", "limit": 10 }  — Process queue items
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function okJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// --- Parsing helpers ---

interface BJVehicle {
  url: string;
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  style: string | null;
  vin: string | null;
  transmission: string | null;
  engine: string | null;
  cylinders: number | null;
  exterior_color: string | null;
  interior_color: string | null;
  sale_price: number | null;
  description: string | null;
  auction_name: string | null;
  lot_number: string | null;
  status: string | null;
  image_urls: string[];
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function parseMarkdown(markdown: string, url: string): BJVehicle {
  const vehicle: BJVehicle = {
    url,
    title: null,
    year: null,
    make: null,
    model: null,
    style: null,
    vin: null,
    transmission: null,
    engine: null,
    cylinders: null,
    exterior_color: null,
    interior_color: null,
    sale_price: null,
    description: null,
    auction_name: null,
    lot_number: null,
    status: null,
    image_urls: [],
  };

  // Extract title: "# 1966 CHEVROLET EL CAMINO PICKUP"
  const titleMatch = markdown.match(
    /^#\s+(\d{4}\s+[A-Z][A-Z\s\-\/\d]+?)$/m
  );
  if (titleMatch) {
    vehicle.title = titleCase(titleMatch[1].trim());
  }

  // Extract labeled fields from the Details section
  // Pattern: "1966Year", "CHEVROLETMake", "EL CAMINOModel", etc.
  const fieldPatterns: [RegExp, keyof BJVehicle][] = [
    [/(\d{4})Year/m, "year"],
    [/([A-Z][A-Z\s\-\.\/]+?)Make/m, "make"],
    [/([A-Z][A-Z\s\-\.\/\d]+?)Model/m, "model"],
    [/([A-Z][A-Z\s\-\.\/]+?)Style/m, "style"],
    [/(\d+)Cylinders?/m, "cylinders"],
    [/([A-Z][A-Z\s\-\.\/\d]+?)Transmission/m, "transmission"],
    [/([A-Z\d][A-Z\s\-\.\/\d]+?)Engine Size/m, "engine"],
    [/([A-Z][A-Z\s\-\.\/]+?)Exterior Color/m, "exterior_color"],
    [/([A-Z][A-Z\s\-\.\/]+?)Interior Color/m, "interior_color"],
    [/([A-Z0-9]+)Vin/m, "vin"],
  ];

  for (const [pattern, field] of fieldPatterns) {
    const match = markdown.match(pattern);
    if (match) {
      const val = match[1].trim();
      if (field === "year") {
        vehicle.year = parseInt(val, 10);
      } else if (field === "cylinders") {
        vehicle.cylinders = parseInt(val, 10);
      } else if (
        field === "make" ||
        field === "model" ||
        field === "style" ||
        field === "exterior_color" ||
        field === "interior_color" ||
        field === "transmission"
      ) {
        vehicle[field] = titleCase(val);
      } else if (field === "engine" || field === "vin") {
        vehicle[field] = val;
      }
    }
  }

  // Extract sale price — BJ often requires login to view price
  // Look for specific patterns near "Sold for" or "Hammer Price"
  const pricePatterns = [
    /Sold\s+for\s+\$([0-9,]+)/i,
    /Hammer\s+Price[:\s]+\$([0-9,]+)/i,
    /Final\s+Price[:\s]+\$([0-9,]+)/i,
    /Sale\s+Price[:\s]+\$([0-9,]+)/i,
  ];
  for (const pattern of pricePatterns) {
    const priceMatch = markdown.match(pattern);
    if (priceMatch) {
      const price = parseInt(priceMatch[1].replace(/,/g, ""), 10);
      if (price >= 1000 && price < 100_000_000) {
        vehicle.sale_price = price;
        break;
      }
    }
  }

  // Extract auction name from URL or page content
  const auctionMatch = url.match(
    /barrett-jackson\.com\/([a-z\-]+-\d{4})\//i
  );
  if (auctionMatch) {
    vehicle.auction_name = titleCase(auctionMatch[1].replace(/-/g, " "));
  }

  // Extract status: "Sold", "No Sale", etc.
  const statusMatch = markdown.match(
    /Status:\s*(Sold|No Sale|Upcoming|Withdrawn)/i
  );
  if (statusMatch) {
    vehicle.status = statusMatch[1];
  }

  // Lot number from URL slug
  const lotMatch = url.match(/-(\d{4,})$/);
  if (lotMatch) {
    vehicle.lot_number = lotMatch[1];
  }

  // Extract description
  const descMatch = markdown.match(
    /### Description[\s\S]*?## Details\s+([\s\S]+?)(?=\n##|\n###|!\[|$)/
  );
  if (descMatch) {
    vehicle.description = descMatch[1].trim().slice(0, 5000);
  } else {
    // Try alternate pattern
    const altDesc = markdown.match(
      /## Details\s+(This \d{4}[\s\S]+?)(?=\n##|\n###|\n!\[|$)/
    );
    if (altDesc) {
      vehicle.description = altDesc[1].trim().slice(0, 5000);
    }
  }

  return vehicle;
}

function extractImageUrls(html: string): string[] {
  const urls = new Set<string>();
  // Azure CDN image URLs
  const cdnRegex =
    /https:\/\/BarrettJacksonCDN\.azureedge\.net\/staging\/carlist\/items\/fullsize\/cars\/[^"'\s]+\.(jpg|jpeg|png|webp)/gi;
  let m;
  while ((m = cdnRegex.exec(html)) !== null) {
    urls.add(m[0]);
  }
  return [...urls];
}

// --- Firecrawl helper ---

async function scrapeWithFirecrawl(
  url: string
): Promise<{ markdown: string; html: string; metadata: Record<string, string> }> {
  const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY not set");

  const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      formats: ["markdown", "rawHtml"],
      waitFor: 3000,
      timeout: 30000,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firecrawl error ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  if (!data.success) {
    throw new Error(`Firecrawl failed: ${JSON.stringify(data).slice(0, 200)}`);
  }

  return {
    markdown: data.data?.markdown || "",
    html: data.data?.rawHtml || "",
    metadata: data.data?.metadata || {},
  };
}

// --- Save vehicle ---

async function saveVehicle(
  supabase: ReturnType<typeof createClient>,
  vehicle: BJVehicle
): Promise<{ vehicleId: string; isNew: boolean }> {
  // Check if vehicle already exists by URL
  const { data: existing } = await supabase
    .from("vehicles")
    .select("id")
    .or(
      `vin.eq.${vehicle.vin && vehicle.vin.length >= 5 ? String(vehicle.vin).replace(/[",().\\]/g, '') : "IMPOSSIBLE"},` +
      `make.eq.${vehicle.make ? String(vehicle.make).replace(/[",().\\]/g, '') : "IMPOSSIBLE"}`
    )
    .eq("year", vehicle.year || 0)
    .limit(1)
    .maybeSingle();

  // Also check import_queue for existing vehicle_id
  const { data: queueEntry } = await supabase
    .from("import_queue")
    .select("vehicle_id")
    .eq("listing_url", vehicle.url)
    .not("vehicle_id", "is", null)
    .limit(1)
    .maybeSingle();

  const existingId = queueEntry?.vehicle_id || existing?.id;

  const vehicleData = {
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    vin: vehicle.vin && vehicle.vin.length >= 5 ? vehicle.vin : null,
    transmission: vehicle.transmission,
    engine: vehicle.engine,
    exterior_color: vehicle.exterior_color,
    interior_color: vehicle.interior_color,
    sale_price: vehicle.sale_price,
    description: vehicle.description,
    ...(vehicle.style ? { body_style: vehicle.style } : {}),
  };

  let vehicleId: string;
  let isNew = false;

  if (existingId) {
    // Update existing
    await supabase
      .from("vehicles")
      .update(vehicleData)
      .eq("id", existingId);
    vehicleId = existingId;
  } else {
    // Insert new
    const { data: inserted, error: insertErr } = await supabase
      .from("vehicles")
      .insert(vehicleData)
      .select("id")
      .single();

    if (insertErr) throw insertErr;
    vehicleId = inserted.id;
    isNew = true;
  }

  // Save images
  if (vehicle.image_urls.length > 0) {
    const imageRows = vehicle.image_urls.map((url, idx) => ({
      vehicle_id: vehicleId,
      url,
      position: idx,
    }));

    // Upsert by (vehicle_id, url) to avoid duplicates
    for (const row of imageRows) {
      await supabase
        .from("vehicle_images")
        .upsert(row, { onConflict: "vehicle_id,url" })
        .select("id");
    }
  }

  // Create auction event
  await supabase.from("auction_events").upsert(
    {
      vehicle_id: vehicleId,
      platform: "barrett-jackson",
      auction_url: vehicle.url,
      status: vehicle.status?.toLowerCase() === "sold" ? "sold" : "listed",
      ...(vehicle.sale_price ? { sale_price: vehicle.sale_price } : {}),
      ...(vehicle.auction_name ? { auction_name: vehicle.auction_name } : {}),
      ...(vehicle.lot_number ? { lot_number: vehicle.lot_number } : {}),
    },
    { onConflict: "vehicle_id,platform,auction_url" }
  );

  return { vehicleId, isNew };
}

// --- Main handler ---

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body =
      req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body.action || "extract";
    const url = body.url as string | undefined;

    // Single URL extraction
    if (action === "extract" && url) {
      if (!url.includes("barrett-jackson.com")) {
        return okJson({ success: false, error: "Not a Barrett-Jackson URL" }, 400);
      }

      console.log(`[BJ] Extracting: ${url}`);
      const { markdown, html } = await scrapeWithFirecrawl(url);
      const vehicle = parseMarkdown(markdown, url);
      vehicle.image_urls = extractImageUrls(html);

      console.log(
        `[BJ] Parsed: ${vehicle.year} ${vehicle.make} ${vehicle.model}, ` +
          `${vehicle.image_urls.length} images`
      );

      const { vehicleId, isNew } = await saveVehicle(supabase, vehicle);

      // Update queue entry if exists
      await supabase
        .from("import_queue")
        .update({
          status: "complete",
          vehicle_id: vehicleId,
          error_message: null,
        })
        .eq("listing_url", url);

      return okJson({
        success: true,
        vehicle_id: vehicleId,
        is_new: isNew,
        vehicle: {
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          vin: vehicle.vin,
          sale_price: vehicle.sale_price,
          images: vehicle.image_urls.length,
          auction: vehicle.auction_name,
          status: vehicle.status,
        },
      });
    }

    // Batch from queue
    if (action === "batch_from_queue") {
      const rawLimit = Number(body.limit);
      const limit = Math.min(
        Number.isFinite(rawLimit) && rawLimit > 0
          ? Math.floor(rawLimit)
          : 10,
        50
      );

      // Claim pending BJ items
      const { data: items, error: claimErr } = await supabase
        .from("import_queue")
        .select("id, listing_url")
        .eq("status", "pending")
        .like("listing_url", "%barrett-jackson.com%")
        .order("created_at", { ascending: true })
        .limit(limit);

      if (claimErr) throw claimErr;
      if (!items?.length) {
        return okJson({ success: true, message: "No BJ items in queue", processed: 0 });
      }

      // Mark as processing
      const ids = items.map((i: { id: string }) => i.id);
      await supabase
        .from("import_queue")
        .update({ status: "processing", locked_at: new Date().toISOString() })
        .in("id", ids);

      const results = {
        total: items.length,
        success: 0,
        failed: 0,
        created: 0,
        updated: 0,
        errors: [] as string[],
      };

      for (const item of items) {
        try {
          const { markdown, html } = await scrapeWithFirecrawl(
            item.listing_url
          );
          const vehicle = parseMarkdown(markdown, item.listing_url);
          vehicle.image_urls = extractImageUrls(html);

          if (!vehicle.year && !vehicle.make) {
            // Couldn't parse - mark as failed
            await supabase
              .from("import_queue")
              .update({
                status: "failed",
                error_message: "Could not parse vehicle data from page",
                attempts: 1,
              })
              .eq("id", item.id);
            results.failed++;
            continue;
          }

          const { vehicleId, isNew } = await saveVehicle(supabase, vehicle);

          await supabase
            .from("import_queue")
            .update({
              status: "complete",
              vehicle_id: vehicleId,
              error_message: null,
            })
            .eq("id", item.id);

          results.success++;
          if (isNew) results.created++;
          else results.updated++;

          // Small delay between Firecrawl calls
          await new Promise((r) => setTimeout(r, 1000));
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          results.failed++;
          if (results.errors.length < 5) {
            results.errors.push(`${item.listing_url}: ${msg}`);
          }

          await supabase
            .from("import_queue")
            .update({
              status: "failed",
              error_message: msg.slice(0, 500),
            })
            .eq("id", item.id);
        }
      }

      return okJson({ success: true, ...results });
    }

    // Stats action
    if (action === "stats") {
      const { data: stats } = await supabase.rpc("execute_sql", {
        query: `
          SELECT
            count(*) FILTER (WHERE status = 'pending') as pending,
            count(*) FILTER (WHERE status = 'complete') as complete,
            count(*) FILTER (WHERE status = 'failed') as failed,
            count(*) FILTER (WHERE status = 'processing') as processing
          FROM import_queue
          WHERE listing_url LIKE '%barrett-jackson.com%'
        `,
      });

      return okJson({
        success: true,
        stats: Array.isArray(stats) ? stats[0] : {},
      });
    }

    return okJson(
      {
        success: false,
        error: "Provide url or action (extract, batch_from_queue, stats)",
      },
      400
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[BJ] Error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
