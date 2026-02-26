/**
 * EXTRACT MECUM v2.0
 *
 * Two-tier extraction for Mecum auction pages:
 *   1. PREFERRED: Direct HTTP fetch → parse __NEXT_DATA__ JSON (FREE, all fields)
 *   2. FALLBACK: archiveFetch with Firecrawl → parse markdown (JS-rendered content)
 *
 * __NEXT_DATA__ contains structured data:
 *   - pageProps.post.title, color, interior, transmission, vinSerial, hammerPrice
 *   - Taxonomy edges: year, make, model, saleResult, auction, division
 *   - images array with CDN URLs
 *   - lotSeries (engine/highlight features)
 *
 * All pages archived to listing_page_snapshots via archiveFetch.
 * Quality gate prevents garbage data from entering the database.
 *
 * Actions:
 *   POST { "url": "..." }                            — Extract single URL
 *   POST { "action": "batch_from_queue", "limit": 10 }  — Process queue items
 *   POST { "action": "re_enrich", "limit": 50 }     — Re-enrich existing vehicles
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { archiveFetch } from "../_shared/archiveFetch.ts";
import { qualityGate } from "../_shared/extractionQualityGate.ts";
import { cleanVehicleFields } from "../_shared/pollutionDetector.ts";

const EXTRACTOR_VERSION = "2.0.0";

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

interface MecumVehicle {
  url: string;
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  engine: string | null;
  transmission: string | null;
  exterior_color: string | null;
  interior_color: string | null;
  body_style: string | null;
  mileage: number | null;
  mileage_source: string | null;
  description: string | null;
  highlights: string | null;
  lot_number: string | null;
  auction_name: string | null;
  auction_date: string | null;
  sale_price: number | null;
  high_estimate: number | null;
  low_estimate: number | null;
  status: string | null;
  image_urls: string[];
  extraction_method: "next_data" | "markdown";
}

// ─── Parse description from blocks (HIGHLIGHTS + EQUIPMENT) ─────────────
// post.content is always empty on Mecum — description lives in Gutenberg blocks

function parseBlocksDescription(blocks: any[]): { description: string | null; engine: string | null } {
  const sections: { heading: string; items: string[] }[] = [];
  let specEngine: string | null = null;

  function stripHtml(s: string): string {
    return String(s)
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Flatten blocks recursively, tracking heading→item context
  function walk(blocks: any[], currentSection: string[] | null): void {
    for (const block of blocks) {
      if (!block || typeof block !== "object") continue;
      const name = block.name || "";
      const attrs = block.attributes || {};
      const content = stripHtml(attrs.content || attrs.text || "");

      if (name === "core/heading") {
        if (content) {
          const heading = content.toUpperCase();
          sections.push({ heading, items: [] });
          currentSection = sections[sections.length - 1].items;

          // Detect SPECIFICATIONS ENGINE from label+value pairs
          if (heading === "SPECIFICATIONS") {
            // Engine will appear as a subsequent paragraph
          }
        }
      } else if (name === "core/list-item") {
        if (content && currentSection) {
          currentSection.push(content);
        }
      } else if (name === "core/paragraph" && content) {
        // In SPECIFICATIONS section, label+value pairs come as alternating paragraphs
        // We don't use these for description but note engine
      }

      if (Array.isArray(block.innerBlocks) && block.innerBlocks.length > 0) {
        walk(block.innerBlocks, currentSection);
      }
    }
  }

  walk(blocks, null);

  // Also extract engine from SPECIFICATIONS block label/value pairs
  // Pattern: paragraphs alternate "ENGINE" then "3.0L Inline 6-Cylinder"
  function extractSpecValue(blocks: any[], label: string): string | null {
    let foundLabel = false;
    const flat: string[] = [];
    function walkFlat(bs: any[]) {
      for (const b of bs) {
        if (!b || typeof b !== "object") continue;
        if (b.name === "core/paragraph") {
          const t = stripHtml(b.attributes?.content || "");
          if (t) flat.push(t);
        }
        if (Array.isArray(b.innerBlocks)) walkFlat(b.innerBlocks);
      }
    }
    walkFlat(blocks);
    for (let i = 0; i < flat.length - 1; i++) {
      if (flat[i].toUpperCase() === label.toUpperCase()) {
        return flat[i + 1] || null;
      }
    }
    return null;
  }

  specEngine = extractSpecValue(blocks, "ENGINE");

  const parts: string[] = [];
  const highlights = sections.find((s) => s.heading === "HIGHLIGHTS");
  const equipment = sections.find((s) => s.heading === "EQUIPMENT");

  if (highlights?.items.length) {
    parts.push(highlights.items.map((i) => `• ${i}`).join("\n"));
  }
  if (equipment?.items.length) {
    parts.push("Equipment:\n" + equipment.items.map((i) => `• ${i}`).join("\n"));
  }

  const combined = parts.join("\n\n").trim();
  return {
    description: combined.length > 30 ? combined.slice(0, 5000) : null,
    engine: specEngine,
  };
}

// ─── Title case helper ──────────────────────────────────────────────────

function titleCase(s: string): string {
  const preserveUpper = new Set([
    'BMW', 'AMG', 'GT', 'SS', 'RS', 'GTS', 'GTO', 'GTI', 'GTR',
    'SL', 'SLK', 'SLS', 'CLS', 'CLK', 'SUV', 'TDI', 'TSI',
    'V6', 'V8', 'V10', 'V12', 'I4', 'I6', 'W12', 'HP', 'CI',
    'AWD', 'FWD', 'RWD', '4WD', 'CVT', 'DSG', 'PDK', 'SC', 'SE',
    'LE', 'LT', 'LS', 'LTZ', 'SRT', 'TRD', 'SSR',
    'M3', 'M4', 'M5', 'M6', 'Z3', 'Z4', 'X3', 'X5', 'X6',
    'F1', 'F40', 'F50', 'II', 'III', 'IV', 'VI',
  ]);
  return s
    .split(/\s+/)
    .map(word => {
      const upper = word.toUpperCase();
      if (preserveUpper.has(upper)) return upper;
      if (/^[A-Z]\d+$/i.test(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

// ─── Taxonomy edge helper ───────────────────────────────────────────────

function getEdgeName(obj: any, taxonomyKey: string): string | null {
  const edges = obj?.[taxonomyKey]?.edges;
  if (!Array.isArray(edges) || edges.length === 0) return null;
  return edges[0]?.node?.name ?? null;
}

// ─── Parse __NEXT_DATA__ JSON (preferred, zero-cost) ────────────────────

function parseNextData(html: string, url: string): MecumVehicle | null {
  const nextDataMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!nextDataMatch?.[1]) return null;

  let parsed: any;
  try {
    parsed = JSON.parse(nextDataMatch[1]);
  } catch {
    return null;
  }

  const post = parsed?.props?.pageProps?.post;
  if (!post) return null;

  const vehicle: MecumVehicle = {
    url,
    title: post.title || null,
    year: null,
    make: null,
    model: null,
    vin: post.vinSerial || null,
    engine: post.lotSeries || null, // lotSeries contains engine/features like "348 CI, Air Ride"
    transmission: post.transmission || null,
    exterior_color: post.color || null,
    interior_color: post.interior || null,
    body_style: null,
    mileage: null,
    mileage_source: null,
    description: null,
    highlights: null,
    lot_number: post.lotNumber || null,
    auction_name: null,
    auction_date: null,
    sale_price: null,
    high_estimate: null,
    low_estimate: null,
    status: null,
    image_urls: [],
    extraction_method: "next_data",
  };

  // Year from taxonomy
  const yearStr = getEdgeName(post, "lotYears");
  if (yearStr) vehicle.year = parseInt(yearStr, 10) || null;

  // Make from taxonomy
  const makeStr = getEdgeName(post, "makes");
  if (makeStr) vehicle.make = makeStr;

  // Model from taxonomy
  const modelStr = getEdgeName(post, "models");
  if (modelStr) vehicle.model = modelStr;

  // Fallback: parse year/make/model from title "1960 Chevrolet Parkwood Wagon"
  if ((!vehicle.year || !vehicle.make) && post.title) {
    const titleMatch = post.title.match(/^(\d{4})\s+(\S+)\s+(.+)$/);
    if (titleMatch) {
      if (!vehicle.year) vehicle.year = parseInt(titleMatch[1], 10);
      if (!vehicle.make) vehicle.make = titleMatch[2];
      if (!vehicle.model) vehicle.model = titleMatch[3];
    }
  }

  // Sale result from taxonomy
  const saleResult = getEdgeName(post, "saleResults");
  if (saleResult) {
    vehicle.status = saleResult.toLowerCase(); // "sold", "not sold", "upcoming"
  }

  // Hammer price
  if (post.hammerPrice) {
    const price = parseInt(String(post.hammerPrice).replace(/[,$ ]/g, ""), 10);
    if (price > 0) vehicle.sale_price = price;
  }

  // Estimates
  if (post.lowEstimate) {
    const low = parseInt(String(post.lowEstimate).replace(/[,$ ]/g, ""), 10);
    if (low > 0) vehicle.low_estimate = low;
  }
  if (post.highEstimate) {
    const high = parseInt(String(post.highEstimate).replace(/[,$ ]/g, ""), 10);
    if (high > 0) vehicle.high_estimate = high;
  }

  // Odometer
  if (post.odometer) {
    const miles = parseInt(String(post.odometer).replace(/[, ]/g, ""), 10);
    if (miles > 0 && miles < 10_000_000) {
      vehicle.mileage = miles;
      vehicle.mileage_source = "odometer_field";
    }
  }

  // Auction info from taxonomy
  const auctionEdges = post?.auctionsTax?.edges;
  if (Array.isArray(auctionEdges) && auctionEdges.length > 0) {
    const auctionNode = auctionEdges[0]?.node;
    vehicle.auction_name = auctionNode?.name || null;
  }

  // Run date
  const runDate = getEdgeName(post, "runDates");
  if (runDate) vehicle.auction_date = runDate;

  // Division as body_style hint
  const division = getEdgeName(post, "divisionsTax");
  if (division && division !== "Collector Cars") {
    vehicle.body_style = division; // e.g., "Motorcycles", "Road Art", etc.
  }

  // Description from blocks (HIGHLIGHTS + EQUIPMENT list items)
  // post.content is always empty on Mecum — description lives in Gutenberg blocks
  if (Array.isArray(post.blocks) && post.blocks.length > 0) {
    const { description: blockDesc, engine: blockEngine } = parseBlocksDescription(post.blocks);
    if (blockDesc) vehicle.description = blockDesc;
    // Use block-parsed engine if lotSeries looks wrong (non-engine text)
    if (blockEngine && (!vehicle.engine || vehicle.engine.length > 60)) {
      vehicle.engine = blockEngine;
    }
  }

  // Fallback: post.content (usually empty but check anyway)
  if (!vehicle.description && post.content) {
    const stripped = String(post.content)
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (stripped.length > 30) {
      vehicle.description = stripped.slice(0, 5000);
    }
  }

  // Images
  if (Array.isArray(post.images)) {
    const seen = new Set<string>();
    for (const img of post.images) {
      const imgUrl = img?.url;
      if (!imgUrl || typeof imgUrl !== "string") continue;
      // Deduplicate by base filename
      const key = imgUrl.replace(/\?.*$/, ""); // Strip query params
      if (!seen.has(key)) {
        seen.add(key);
        vehicle.image_urls.push(imgUrl);
      }
    }
  }

  return vehicle;
}

// ─── Parse markdown (fallback when __NEXT_DATA__ not available) ─────────

function parseMarkdown(markdown: string, url: string): MecumVehicle {
  const vehicle: MecumVehicle = {
    url,
    title: null,
    year: null,
    make: null,
    model: null,
    vin: null,
    engine: null,
    transmission: null,
    exterior_color: null,
    interior_color: null,
    body_style: null,
    mileage: null,
    mileage_source: null,
    description: null,
    highlights: null,
    lot_number: null,
    auction_name: null,
    auction_date: null,
    sale_price: null,
    high_estimate: null,
    low_estimate: null,
    status: null,
    image_urls: [],
    extraction_method: "markdown",
  };

  // Title: "# 1964 Chevrolet Chevelle 300"
  const titleMatch = markdown.match(/^# (\d{4})\s+(.+)$/m);
  if (titleMatch) {
    vehicle.year = parseInt(titleMatch[1], 10);
    vehicle.title = titleMatch[0].replace('# ', '');
    const parts = titleMatch[2].trim().split(/\s+/);
    if (parts.length >= 1) vehicle.make = titleCase(parts[0]);
    if (parts.length >= 2) vehicle.model = titleCase(parts.slice(1).join(' '));
  }

  // Lot info: "Lot F109.8//Friday, January 15th//Kissimmee 2021"
  const lotMatch = markdown.match(/^Lot\s+([\w.]+)\/\/(.+?)\/\/(.+)$/m);
  if (lotMatch) {
    vehicle.lot_number = lotMatch[1];
    vehicle.auction_date = lotMatch[2].trim();
    vehicle.auction_name = lotMatch[3].trim();
  }

  // VIN: "VIN / Serial\n\n1G1AP877XCL133135"
  const vinMatch = markdown.match(/VIN\s*\/\s*Serial\s*\n\n([A-Z0-9]+)/i);
  if (vinMatch) vehicle.vin = vinMatch[1];

  // SPECIFICATIONS block — "ENGINE\n\n**350CI**"
  const specRegex = /^([A-Z][A-Z /]+?)\s*\n\n\*\*(.+?)\*\*/gm;
  const specs: Record<string, string> = {};
  let m;
  while ((m = specRegex.exec(markdown)) !== null) {
    specs[m[1].trim()] = m[2].trim();
  }

  if (specs['ENGINE']) vehicle.engine = specs['ENGINE'];
  if (specs['TRANSMISSION']) vehicle.transmission = titleCase(specs['TRANSMISSION']);
  if (specs['EXTERIOR COLOR']) vehicle.exterior_color = titleCase(specs['EXTERIOR COLOR']);
  if (specs['INTERIOR COLOR']) vehicle.interior_color = titleCase(specs['INTERIOR COLOR']);
  if (specs['BODY STYLE']) vehicle.body_style = titleCase(specs['BODY STYLE']);
  if (specs['MAKE']) vehicle.make = titleCase(specs['MAKE']);
  if (specs['MODEL']) vehicle.model = titleCase(specs['MODEL']);

  // Mileage
  const subtitleMileage = markdown.match(/^[^#\n].+?([\d,]+)\s*(?:actual\s+)?[Mm]iles/m);
  if (subtitleMileage) {
    const miles = parseInt(subtitleMileage[1].replace(/,/g, ''), 10);
    if (miles > 0 && miles < 1_000_000) {
      vehicle.mileage = miles;
      vehicle.mileage_source = "subtitle";
    }
  }
  if (!vehicle.mileage) {
    const highlightsMileage = markdown.match(/^- .*([\d,]+)\s*(?:actual\s+)?[Mm]iles/m);
    if (highlightsMileage) {
      const miles = parseInt(highlightsMileage[1].replace(/,/g, ''), 10);
      if (miles > 0 && miles < 1_000_000) {
        vehicle.mileage = miles;
        vehicle.mileage_source = "highlights";
      }
    }
  }

  // Sold status
  if (/!\[sold\]/i.test(markdown)) {
    vehicle.status = 'sold';
  } else if (/!\[bid goes live\]/i.test(markdown) || /!\[upcoming\]/i.test(markdown)) {
    vehicle.status = 'upcoming';
  }

  // HIGHLIGHTS
  const highlightsMatch = markdown.match(/## HIGHLIGHTS\s*\n\n((?:- .+\n?)+)/);
  if (highlightsMatch) vehicle.highlights = highlightsMatch[1].trim();

  // THE STORY (description)
  const storyMatch = markdown.match(/## THE STORY\s*\n\n([\s\S]+?)(?=\n\nInformation found on the website|$)/);
  if (storyMatch) {
    vehicle.description = storyMatch[1].trim().slice(0, 5000);
  } else if (vehicle.highlights) {
    vehicle.description = vehicle.highlights.slice(0, 5000);
  }

  // Images
  const imageSet = new Set<string>();
  const imgRegex = /https:\/\/(?:images|cdn\d?)\.mecum\.com\/[^)\s"]+\.(?:jpg|jpeg|png|webp)[^)\s"]*/gi;
  let imgM;
  while ((imgM = imgRegex.exec(markdown)) !== null) {
    const imgUrl = imgM[0];
    const key = imgUrl.replace(/\?.*$/, "");
    if (!imageSet.has(key)) {
      imageSet.add(key);
      vehicle.image_urls.push(imgUrl);
    }
  }

  return vehicle;
}

// ─── Fetch + parse (tries __NEXT_DATA__ first, falls back to markdown) ──

async function fetchAndParse(url: string, opts?: { skipFirecrawl?: boolean }): Promise<MecumVehicle> {
  // Step 1: Try direct HTTP fetch for __NEXT_DATA__ (free, no Firecrawl)
  const directResult = await archiveFetch(url, {
    platform: "mecum",
    useFirecrawl: false,
    callerName: "extract-mecum",
  });

  if (directResult.html) {
    // Check for 404
    if (directResult.html.includes("404 - PAGE NOT FOUND") || directResult.statusCode === 404) {
      throw new Error("PAGE_NOT_FOUND");
    }

    const fromJson = parseNextData(directResult.html, url);
    if (fromJson && fromJson.year && fromJson.make) {
      console.log(`[MECUM] Parsed via __NEXT_DATA__ (free): ${fromJson.year} ${fromJson.make} ${fromJson.model}`);
      return fromJson;
    }
  }

  // Step 2: Fallback to Firecrawl for JS-rendered content
  if (opts?.skipFirecrawl) {
    throw new Error("SKIP_NO_NEXT_DATA");
  }
  console.log(`[MECUM] __NEXT_DATA__ not found or insufficient, falling back to Firecrawl`);
  const fcResult = await archiveFetch(url, {
    platform: "mecum",
    useFirecrawl: true,
    includeMarkdown: true,
    waitForJs: 5000,
    callerName: "extract-mecum",
    forceRefresh: true, // Don't use the direct-fetch cache we just stored
  });

  if (fcResult.error && !fcResult.html && !fcResult.markdown) {
    throw new Error(`Fetch failed: ${fcResult.error}`);
  }

  // Try __NEXT_DATA__ from Firecrawl HTML too
  if (fcResult.html) {
    const fromJson = parseNextData(fcResult.html, url);
    if (fromJson && fromJson.year && fromJson.make) {
      console.log(`[MECUM] Parsed via __NEXT_DATA__ (Firecrawl HTML): ${fromJson.year} ${fromJson.make} ${fromJson.model}`);
      return fromJson;
    }
  }

  // Final fallback: markdown parsing
  if (fcResult.markdown) {
    if (fcResult.markdown.includes('404 - PAGE NOT FOUND') || fcResult.markdown.includes('no longer available')) {
      throw new Error("PAGE_NOT_FOUND");
    }

    const fromMd = parseMarkdown(fcResult.markdown, url);
    if (fromMd.year || fromMd.make) {
      console.log(`[MECUM] Parsed via markdown fallback: ${fromMd.year} ${fromMd.make} ${fromMd.model}`);
      return fromMd;
    }
  }

  throw new Error("Could not parse vehicle data from page");
}

// ─── Save vehicle ───────────────────────────────────────────────────────

async function saveVehicle(
  supabase: ReturnType<typeof createClient>,
  vehicle: MecumVehicle,
  forceVehicleId?: string,
): Promise<{ vehicleId: string; isNew: boolean; fieldsUpdated: string[]; qualityScore: number }> {
  // Check if vehicle already exists (by URL, queue, or VIN)
  const { data: byUrl } = await supabase
    .from("vehicles")
    .select("id")
    .eq("discovery_url", vehicle.url)
    .limit(1)
    .maybeSingle();

  const { data: queueEntry } = await supabase
    .from("import_queue")
    .select("vehicle_id")
    .eq("listing_url", vehicle.url)
    .not("vehicle_id", "is", null)
    .limit(1)
    .maybeSingle();

  let existingId = forceVehicleId || queueEntry?.vehicle_id || byUrl?.id;

  // Also check by VIN if we have one (prevents duplicate key violation)
  if (!existingId && vehicle.vin && vehicle.vin.length >= 5) {
    const { data: byVin } = await supabase
      .from("vehicles")
      .select("id")
      .eq("vin", vehicle.vin)
      .limit(1)
      .maybeSingle();
    if (byVin?.id) existingId = byVin.id;
  }

  const rawData: Record<string, unknown> = {
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    vin: vehicle.vin && vehicle.vin.length >= 5 ? vehicle.vin : null,
    engine_type: vehicle.engine,
    transmission: vehicle.transmission,
    color: vehicle.exterior_color,
    interior_color: vehicle.interior_color,
    body_style: vehicle.body_style,
    mileage: vehicle.mileage,
    description: vehicle.description,
    sale_price: vehicle.sale_price,
    discovery_url: vehicle.url,
    discovery_source: "mecum",
    listing_source: "mecum",
    source: "mecum",
    extractor_version: EXTRACTOR_VERSION,
  };

  // Clean fields (strip HTML, reject polluted values)
  const cleaned = cleanVehicleFields(rawData, { platform: "mecum" });

  // Quality gate
  const gate = qualityGate(cleaned as Record<string, any>, {
    source: "mecum",
    sourceType: "auction",
  });

  if (gate.action === "reject") {
    console.warn(`[MECUM] Quality gate REJECTED ${vehicle.url}: ${gate.issues.join(", ")}`);
    throw new Error(`Quality gate rejected (score=${gate.score}): ${gate.issues.slice(0, 3).join(", ")}`);
  }

  if (gate.action === "flag_for_review") {
    console.warn(`[MECUM] Quality gate FLAGGED ${vehicle.url} (score=${gate.score}): ${gate.issues.join(", ")}`);
  }

  // Build clean upsert payload (no nulls for updates)
  const cleanData: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(gate.cleaned)) {
    if (v !== null && v !== undefined) cleanData[k] = v;
  }

  let vehicleId: string;
  let isNew = false;
  const fieldsUpdated: string[] = [];

  if (existingId) {
    const { data: existing } = await supabase
      .from("vehicles")
      .select("vin,mileage,color,description,transmission,body_style,engine_type,sale_price,interior_color")
      .eq("id", existingId)
      .maybeSingle();

    if (existing) {
      const trackFields = ["vin", "mileage", "color", "description", "transmission", "body_style", "engine_type", "sale_price", "interior_color"];
      for (const f of trackFields) {
        if (!(existing as any)[f] && cleanData[f]) fieldsUpdated.push(f);
      }
    }

    // Strip identity/source fields that should only be set on insert
    const { discovery_url: _du, discovery_source: _ds, source: _src, listing_source: _ls, ...updateData } = cleanData;

    const { error: updateErr } = await supabase.from("vehicles").update(updateData).eq("id", existingId);
    if (updateErr) {
      // VIN unique constraint violation: another vehicle already has this VIN.
      // Retry without VIN to still update other fields.
      if (updateErr.code === "23505" && updateErr.message?.includes("vin")) {
        console.warn(`[MECUM] VIN conflict for ${existingId} (vin=${cleanData.vin}), retrying without VIN`);
        const { vin: _skipVin, ...dataWithoutVin } = updateData;
        const { error: retryErr } = await supabase.from("vehicles").update(dataWithoutVin).eq("id", existingId);
        if (retryErr) {
          console.error(`[MECUM] Retry update failed for ${existingId}: ${retryErr.message}`);
          throw new Error(`Vehicle update failed: ${retryErr.message}`);
        }
      } else {
        console.error(`[MECUM] Vehicle update failed for ${existingId}: ${updateErr.message} (${updateErr.code})`);
        throw new Error(`Vehicle update failed: ${updateErr.message}`);
      }
    }
    vehicleId = existingId;
  } else {
    const { data: inserted, error: insertErr } = await supabase
      .from("vehicles")
      .insert({ ...cleanData, status: "active" })
      .select("id")
      .maybeSingle();

    if (insertErr) throw new Error(`Vehicle insert failed: ${insertErr.message} (${insertErr.code})`);
    vehicleId = inserted.id;
    isNew = true;
  }

  // Save images (batch insert, skip existing)
  if (vehicle.image_urls.length > 0) {
    const imageLimit = Math.min(vehicle.image_urls.length, 80);
    for (let idx = 0; idx < imageLimit; idx++) {
      const imgUrl = vehicle.image_urls[idx];
      const { data: existingImg } = await supabase
        .from("vehicle_images")
        .select("id")
        .eq("vehicle_id", vehicleId)
        .eq("image_url", imgUrl)
        .limit(1)
        .maybeSingle();
      if (!existingImg) {
        await supabase.from("vehicle_images").insert({
          vehicle_id: vehicleId,
          image_url: imgUrl,
          source: "external_import",
          source_url: imgUrl,
          is_external: true,
          position: idx,
        });
      }
    }
  }

  // Create external_listing (for tracking)
  const { data: existingListing } = await supabase
    .from("external_listings")
    .select("id")
    .eq("vehicle_id", vehicleId)
    .eq("platform", "mecum")
    .eq("url", vehicle.url)
    .limit(1)
    .maybeSingle();

  if (!existingListing) {
    try {
      await supabase.from("external_listings").insert({
        vehicle_id: vehicleId,
        platform: "mecum",
        url: vehicle.url,
        title: vehicle.title,
        listing_type: "auction",
        lot_number: vehicle.lot_number,
        sale_price: vehicle.sale_price,
        status: vehicle.status || "listed",
      });
    } catch { /* non-fatal */ }
  }

  // Create auction event
  const { data: existingEvent } = await supabase
    .from("auction_events")
    .select("id")
    .eq("vehicle_id", vehicleId)
    .eq("source", "mecum")
    .eq("source_url", vehicle.url)
    .limit(1)
    .maybeSingle();

  if (!existingEvent) {
    try {
      await supabase.from("auction_events").insert({
        vehicle_id: vehicleId,
        source: "mecum",
        source_url: vehicle.url,
        outcome: vehicle.status || "listed",
        lot_number: vehicle.lot_number || null,
        sale_price: vehicle.sale_price || null,
      });
    } catch { /* non-fatal */ }
  }

  return { vehicleId, isNew, fieldsUpdated, qualityScore: gate.score };
}

// ─── Main handler ───────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body.action || "extract";
    const url = body.url as string | undefined;

    // ── Single URL extraction ─────────────────────────────────────────
    if (action === "extract" && url) {
      if (!url.includes("mecum.com")) {
        return okJson({ success: false, error: "Not a Mecum URL" }, 400);
      }

      console.log(`[MECUM] Extracting: ${url}`);

      try {
        var vehicle = await fetchAndParse(url);
      } catch (e: any) {
        if (e.message === "PAGE_NOT_FOUND") {
          return okJson({ success: false, error: "Page not found (404 or removed)" }, 410);
        }
        throw e;
      }

      if (!vehicle.year && !vehicle.make) {
        return okJson({ success: false, error: "Could not parse vehicle data from page" }, 422);
      }

      console.log(
        `[MECUM] Parsed: ${vehicle.year} ${vehicle.make} ${vehicle.model}, ` +
          `vin=${vehicle.vin}, mileage=${vehicle.mileage}, sale=$${vehicle.sale_price}, ` +
          `${vehicle.image_urls.length} images, method=${vehicle.extraction_method}`,
      );

      const { vehicleId, isNew, fieldsUpdated, qualityScore } = await saveVehicle(supabase, vehicle);

      // Update queue entry if exists
      await supabase
        .from("import_queue")
        .update({ status: "complete", vehicle_id: vehicleId, error_message: null })
        .eq("listing_url", url);

      return okJson({
        success: true,
        vehicle_id: vehicleId,
        is_new: isNew,
        quality_score: qualityScore,
        extraction_method: vehicle.extraction_method,
        fields_updated: fieldsUpdated,
        vehicle: {
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          vin: vehicle.vin,
          mileage: vehicle.mileage,
          sale_price: vehicle.sale_price,
          description: vehicle.description ? `${vehicle.description.length} chars` : null,
          images: vehicle.image_urls.length,
          auction: vehicle.auction_name,
          status: vehicle.status,
        },
      });
    }

    // ── Batch from queue ──────────────────────────────────────────────
    if (action === "batch_from_queue") {
      const rawLimit = Number(body.limit);
      const limit = Math.min(
        Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 10,
        50,
      );

      const { data: items, error: claimErr } = await supabase
        .from("import_queue")
        .select("id, listing_url")
        .eq("status", "pending")
        .like("listing_url", "%mecum.com%")
        .order("created_at", { ascending: true })
        .limit(limit);

      if (claimErr) throw claimErr;
      if (!items?.length) {
        return okJson({ success: true, message: "No Mecum items in queue", processed: 0 });
      }

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
        next_data_used: 0,
        markdown_fallback: 0,
        errors: [] as string[],
      };

      for (const item of items) {
        try {
          const vehicle = await fetchAndParse(item.listing_url);

          if (!vehicle.year && !vehicle.make) {
            await supabase
              .from("import_queue")
              .update({ status: "failed", error_message: "Could not parse vehicle data", attempts: 1 })
              .eq("id", item.id);
            results.failed++;
            continue;
          }

          const { vehicleId, isNew } = await saveVehicle(supabase, vehicle);

          await supabase
            .from("import_queue")
            .update({ status: "complete", vehicle_id: vehicleId, error_message: null })
            .eq("id", item.id);

          results.success++;
          if (isNew) results.created++;
          else results.updated++;
          if (vehicle.extraction_method === "next_data") results.next_data_used++;
          else results.markdown_fallback++;

          // Light delay between requests
          await new Promise((r) => setTimeout(r, 300));
        } catch (err: any) {
          const msg = err.message === "PAGE_NOT_FOUND" ? "Page removed/404" : (err.message || String(err));
          results.failed++;
          if (results.errors.length < 5) results.errors.push(`${item.listing_url}: ${msg}`);
          await supabase
            .from("import_queue")
            .update({ status: "failed", error_message: msg.slice(0, 500) })
            .eq("id", item.id);
        }
      }

      return okJson({ success: true, ...results });
    }

    // ── Re-enrich existing vehicles ───────────────────────────────────
    if (action === "re_enrich") {
      const rawLimit = Number(body.limit);
      const limit = Math.min(
        Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 15,
        100,
      );
      const concurrency = Math.min(Number(body.concurrency) || 3, 10);

      // Find Mecum candidates via import_queue (avoids full-table-scan timeout on vehicles)
      // Uses import_queue to find pending mecum items that have a vehicle_id already linked,
      // which covers both newly queued items and items reset from 'complete' for backfill.
      const { data: queueItems, error: candErr } = await supabase
        .from("import_queue")
        .select("vehicle_id, listing_url")
        .like("listing_url", "%mecum.com%")
        .in("status", ["pending", "complete"])
        .not("vehicle_id", "is", null)
        .order("processed_at", { ascending: true })
        .limit(limit);

      if (candErr) throw new Error(`Query error: ${candErr.message}`);

      const candidates = (queueItems || [])
        .filter((i: any) => i.listing_url?.includes("mecum.com"))
        .map((i: any) => ({ id: i.vehicle_id as string, discovery_url: i.listing_url as string }));

      if (!candidates?.length) {
        return okJson({ success: true, message: "No Mecum candidates to enrich", processed: 0 });
      }
      if (!candidates?.length) {
        return okJson({ success: true, message: "No Mecum candidates to enrich", processed: 0 });
      }

      const results = {
        total: candidates.length,
        success: 0,
        failed: 0,
        fields_added: 0,
        field_counts: {} as Record<string, number>,
        errors: [] as string[],
      };

      async function processOne(cand: { id: string; discovery_url: string }) {
        try {
          // Skip Firecrawl in re_enrich mode — only process vehicles parseable via free direct fetch
          const vehicle = await fetchAndParse(cand.discovery_url, { skipFirecrawl: true });

          if (!vehicle.year && !vehicle.make) {
            results.failed++;
            return;
          }

          // Pass candidate ID to update the correct vehicle (avoids duplicate URL mismatch)
          const { fieldsUpdated } = await saveVehicle(supabase, vehicle, cand.id);

          results.success++;
          results.fields_added += fieldsUpdated.length;
          for (const f of fieldsUpdated) {
            results.field_counts[f] = (results.field_counts[f] || 0) + 1;
          }
        } catch (err: any) {
          const msg = err.message || String(err);
          // SKIP_NO_NEXT_DATA means this page needs Firecrawl — bump updated_at so it rotates out
          if (msg === "SKIP_NO_NEXT_DATA" || msg === "PAGE_NOT_FOUND") {
            await supabase.from("vehicles").update({ updated_at: new Date().toISOString() }).eq("id", cand.id);
            results.failed++;
            return;
          }
          results.failed++;
          if (results.errors.length < 5) results.errors.push(`${cand.discovery_url}: ${msg.slice(0, 100)}`);
        }
      }

      for (let i = 0; i < candidates.length; i += concurrency) {
        const chunk = candidates.slice(i, i + concurrency);
        await Promise.all(chunk.map(processOne));
      }

      return okJson({ success: true, ...results });
    }

    return okJson(
      { success: false, error: "Provide url or action (extract, batch_from_queue, re_enrich)" },
      400,
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : (typeof e === "object" && e !== null ? JSON.stringify(e) : String(e));
    console.error("[MECUM] Error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
