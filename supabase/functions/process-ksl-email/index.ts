/**
 * PROCESS KSL EMAIL
 *
 * Parses KSL Classifieds saved-search notification emails,
 * extracts all vehicle listings, deduplicates via ksl_ingestion_log,
 * and queues new listings into import_queue for extraction.
 *
 * Called by inbound-email when ksl@nuke.ag receives mail.
 *
 * Deploy: supabase functions deploy process-ksl-email --no-verify-jwt
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ─── Types ──────────────────────────────────────────────────────

interface KSLListing {
  ksl_listing_id: string;
  title: string;
  year: number | null;
  make: string | null;
  model: string | null;
  price: number | null;
  price_raw: string | null;
  location: string | null;
  url: string;
  image_url: string | null;
  description_snippet: string | null;
  tier: "vintage" | "modern" | "current" | null;
}

// ─── Parsing ────────────────────────────────────────────────────

const MULTI_WORD_MAKES = [
  "Land Rover", "Aston Martin", "Alfa Romeo", "Mercedes-Benz", "Mercedes Benz",
  "AM General", "De Tomaso", "Rolls-Royce", "Rolls Royce", "Austin-Healey",
  "Austin Healey",
];

function parseTitle(title: string): { year: number | null; make: string | null; model: string | null } {
  const cleaned = title.trim();
  const yearMatch = cleaned.match(/^(\d{4})\s+(.+)/);
  if (!yearMatch) return { year: null, make: null, model: null };

  const year = parseInt(yearMatch[1], 10);
  if (year < 1900 || year > 2030) return { year: null, make: null, model: null };

  const remainder = yearMatch[2].trim();

  for (const mwm of MULTI_WORD_MAKES) {
    if (remainder.toLowerCase().startsWith(mwm.toLowerCase())) {
      return { year, make: mwm, model: remainder.slice(mwm.length).trim() || null };
    }
  }

  const parts = remainder.split(/\s+/);
  return { year, make: parts[0] || null, model: parts.slice(1).join(" ") || null };
}

function parsePrice(priceStr: string | null): number | null {
  if (!priceStr) return null;
  const cleaned = priceStr.replace(/[$,]/g, "").trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function detectTier(subject: string, years: number[]): "vintage" | "modern" | "current" | null {
  const s = subject.toLowerCase();
  if (s.includes("1900") || s.includes("1999") || s.includes("vintage") || s.includes("classic")) return "vintage";
  if (s.includes("2000") || s.includes("2013")) return "modern";
  if (s.includes("2014") || s.includes("present") || s.includes("2024") || s.includes("2025") || s.includes("2026")) return "current";

  if (years.length > 0) {
    const avg = years.reduce((a, b) => a + b, 0) / years.length;
    if (avg < 2000) return "vintage";
    if (avg < 2014) return "modern";
    return "current";
  }
  return null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseKSLEmail(html: string, subject: string): { listings: KSLListing[]; searchName: string | null; tier: string | null } {
  const listings: KSLListing[] = [];
  const years: number[] = [];

  // Extract search name from subject
  const searchNameMatch = subject.match(/(?:saved search|matches for)[:\s]+(.+)/i);
  const searchName = searchNameMatch ? searchNameMatch[1].trim() : null;

  // Strategy 1: Find all KSL listing URLs
  const foundIds = new Set<string>();

  // Extract <a> tags with KSL listing hrefs
  const linkRegex = /<a[^>]*href=["']?(https?:\/\/(?:cars\.)?ksl\.com\/(?:auto\/|cars\/)?listing\/(\d+))[^"']*["']?[^>]*>([\s\S]*?)<\/a>/gi;
  const byId = new Map<string, { url: string; innerHtml: string }>();
  let linkMatch;

  while ((linkMatch = linkRegex.exec(html)) !== null) {
    const id = linkMatch[2];
    const existing = byId.get(id);
    if (!existing || linkMatch[3].length > existing.innerHtml.length) {
      byId.set(id, { url: linkMatch[1], innerHtml: linkMatch[3] });
    }
    foundIds.add(id);
  }

  // Also find bare URLs not in <a> tags
  const urlRegex = /https?:\/\/(?:cars\.)?ksl\.com\/(?:auto\/|cars\/)?listing\/(\d+)/g;
  let urlMatch;
  while ((urlMatch = urlRegex.exec(html)) !== null) {
    if (!byId.has(urlMatch[1])) {
      byId.set(urlMatch[1], { url: urlMatch[0], innerHtml: "" });
    }
  }

  // Build listing objects
  for (const [id, data] of byId) {
    const titleText = stripHtml(data.innerHtml);

    // Extract title pattern (YYYY Make Model), stop at price/dash delimiters
    const titleMatch = titleText.match(/(\d{4}\s+\S+(?:\s+\S+)*)/);
    let title = titleMatch ? titleMatch[1].trim() : titleText.slice(0, 100).trim();
    // Truncate at " - " or " $" to avoid price/location bleeding into title
    title = title.split(/\s+-\s+|\s+\$/)[0].trim();

    const { year, make, model } = parseTitle(title);
    if (year) years.push(year);

    // Extract price
    const priceMatch = data.innerHtml.match(/\$([0-9,]+(?:\.\d{2})?)/);
    const priceRaw = priceMatch ? `$${priceMatch[1]}` : null;

    // Extract location (City, ST)
    const locationMatch = data.innerHtml.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),\s*([A-Z]{2})/);
    const location = locationMatch ? `${locationMatch[1]}, ${locationMatch[2]}` : null;

    // Extract image URL
    const imgMatch = data.innerHtml.match(/(?:src|background-image)[=:]\s*["']?(https?:\/\/[^"'\s)]+)/i);
    const imageUrl = imgMatch ? imgMatch[1] : null;

    listings.push({
      ksl_listing_id: id,
      title: title || `KSL Listing ${id}`,
      year,
      make,
      model,
      price: parsePrice(priceRaw),
      price_raw: priceRaw,
      location,
      url: data.url,
      image_url: imageUrl,
      description_snippet: null,
      tier: null,
    });
  }

  // Strategy 2: Plain text fallback if no <a> tags found
  if (listings.length === 0) {
    const plainText = stripHtml(html);
    // Look for KSL listing URLs in plain text
    const textUrlRegex = /https?:\/\/(?:cars\.)?ksl\.com\/(?:auto\/|cars\/)?listing\/(\d+)/g;
    let textUrl;
    while ((textUrl = textUrlRegex.exec(plainText)) !== null) {
      if (!foundIds.has(textUrl[1])) {
        foundIds.add(textUrl[1]);
        listings.push({
          ksl_listing_id: textUrl[1],
          title: `KSL Listing ${textUrl[1]}`,
          year: null, make: null, model: null,
          price: null, price_raw: null, location: null,
          url: textUrl[0], image_url: null, description_snippet: null, tier: null,
        });
      }
    }
  }

  // Assign tier
  const tier = detectTier(subject, years);
  for (const listing of listings) {
    listing.tier = tier;
  }

  return { listings, searchName, tier };
}

// ─── Main Handler ──────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { from, to, subject, html, text, messageId } = body;

    console.log(`[ksl-email] From: ${from} | Subject: ${(subject || "").slice(0, 100)}`);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Parse KSL email
    const emailBody = html || text || "";
    if (!emailBody) {
      console.warn("[ksl-email] No email body");
      return new Response(JSON.stringify({ success: true, listings: 0, reason: "no_body" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { listings, searchName, tier } = parseKSLEmail(emailBody, subject || "");
    console.log(`[ksl-email] Parsed ${listings.length} listings. Tier: ${tier}. Search: ${searchName}`);

    if (listings.length === 0) {
      return new Response(JSON.stringify({
        success: true, listings_found: 0, tier, search_name: searchName,
        message: "No KSL listing URLs found in email",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Process each listing
    let queued = 0;
    let duplicates = 0;
    let errors = 0;

    for (const listing of listings) {
      try {
        // Check for duplicate
        const { data: existing } = await supabase
          .from("ksl_ingestion_log")
          .select("id")
          .eq("ksl_listing_id", listing.ksl_listing_id)
          .limit(1)
          .maybeSingle();

        if (existing) {
          duplicates++;
          await supabase.from("ksl_ingestion_log").insert({
            ksl_listing_id: listing.ksl_listing_id,
            email_subject: subject,
            tier: listing.tier,
            search_name: searchName,
            listing_url: listing.url,
            price: listing.price,
            raw_title: listing.title,
            year: listing.year,
            make: listing.make,
            model: listing.model,
            location: listing.location,
            image_url: listing.image_url,
            status: "duplicate",
          });
          continue;
        }

        // Queue into import_queue
        const { data: imported, error: importError } = await supabase
          .from("import_queue")
          .upsert({
            listing_url: listing.url,
            listing_title: listing.title,
            listing_year: listing.year,
            listing_make: listing.make,
            listing_model: listing.model,
            listing_price: listing.price,
            thumbnail_url: listing.image_url,
            status: "pending",
            priority: 6, // High priority — email alerts are timely
            raw_data: {
              source: "ksl_email",
              ksl_listing_id: listing.ksl_listing_id,
              tier: listing.tier,
              search_name: searchName,
              location: listing.location,
              price_raw: listing.price_raw,
              email_subject: subject,
              message_id: messageId,
              ingested_at: new Date().toISOString(),
            },
          }, { onConflict: "listing_url", ignoreDuplicates: true })
          .select("id")
          .maybeSingle();

        if (importError) {
          console.error(`[ksl-email] import_queue error for ${listing.ksl_listing_id}:`, importError.message);
          errors++;
          await supabase.from("ksl_ingestion_log").insert({
            ksl_listing_id: listing.ksl_listing_id,
            email_subject: subject,
            tier: listing.tier,
            search_name: searchName,
            listing_url: listing.url,
            price: listing.price,
            raw_title: listing.title,
            year: listing.year,
            make: listing.make,
            model: listing.model,
            location: listing.location,
            image_url: listing.image_url,
            status: "error",
          });
          continue;
        }

        queued++;
        await supabase.from("ksl_ingestion_log").insert({
          ksl_listing_id: listing.ksl_listing_id,
          email_subject: subject,
          tier: listing.tier,
          search_name: searchName,
          listing_url: listing.url,
          price: listing.price,
          raw_title: listing.title,
          year: listing.year,
          make: listing.make,
          model: listing.model,
          location: listing.location,
          image_url: listing.image_url,
          import_queue_id: imported?.id || null,
          status: "queued",
        });

      } catch (listingErr) {
        console.error(`[ksl-email] Error processing listing ${listing.ksl_listing_id}:`, listingErr);
        errors++;
      }
    }

    const result = {
      success: true,
      source: "ksl",
      tier,
      search_name: searchName,
      listings_found: listings.length,
      queued,
      duplicates,
      errors,
    };

    console.log(`[ksl-email] Done: ${JSON.stringify(result)}`);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error("[ksl-email] Error:", error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 200, // Don't trigger retries
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
