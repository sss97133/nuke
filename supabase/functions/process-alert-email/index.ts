/**
 * PROCESS ALERT EMAIL
 *
 * Universal inbound email handler for vehicle listing alert notifications.
 * Receives webhook POSTs from SendGrid Inbound Parse (or Postmark),
 * detects the source site, extracts listing URLs, and queues them for extraction.
 *
 * Supported alert sources:
 * - KSL Classifieds
 * - Craigslist
 * - Bring a Trailer (BaT)
 * - Hemmings
 * - eBay Motors
 * - Cars.com
 * - AutoTrader
 * - Hagerty Marketplace
 * - Facebook Marketplace (if they email)
 * - CarGurus
 * - ClassicCars.com
 * - Any unknown source (best-effort URL extraction)
 *
 * Webhook setup:
 * 1. Create dedicated Gmail: nuke.vehicle.alerts@gmail.com
 * 2. Subscribe to saved-search alerts on each site
 * 3. Forward all mail to SendGrid Inbound Parse address
 * 4. SendGrid POSTs to: https://[project].supabase.co/functions/v1/process-alert-email
 *
 * Deploy: supabase functions deploy process-alert-email --no-verify-jwt
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ─── Source Detection ─────────────────────────────────────────────

interface SourceConfig {
  slug: string;
  displayName: string;
  senderPatterns: RegExp[];
  urlPatterns: RegExp[];
  /** Optional: extract year/make/model/price from subject or body */
  parseHints?: (
    subject: string,
    text: string
  ) => Partial<{
    year: number;
    make: string;
    model: string;
    price: number;
    title: string;
  }>;
}

const SOURCES: SourceConfig[] = [
  {
    slug: "ksl",
    displayName: "KSL Classifieds",
    senderPatterns: [/ksl\.com/i, /ksl classifieds/i],
    urlPatterns: [
      /https?:\/\/(?:www\.)?ksl\.com\/auto\/listing\/\d+/gi,
      /https?:\/\/(?:www\.)?ksl\.com\/cars\/listing\/\d+/gi,
      /https?:\/\/(?:www\.)?ksl\.com\/[^\s"'<>]*?listing[^\s"'<>]*/gi,
    ],
    parseHints: (subject, text) => {
      const m = (subject + " " + text).match(
        /(\d{4})\s+([A-Za-z]+)\s+([A-Za-z0-9]+)/
      );
      if (m)
        return {
          year: parseInt(m[1]),
          make: m[2],
          model: m[3],
          title: m[0],
        };
      return {};
    },
  },
  {
    slug: "craigslist",
    displayName: "Craigslist",
    senderPatterns: [/craigslist\.org/i, /robot@craigslist/i],
    urlPatterns: [
      /https?:\/\/[a-z]+\.craigslist\.org\/[a-z]+\/d\/[^\s"'<>]+\.html/gi,
      /https?:\/\/[a-z]+\.craigslist\.org\/[a-z]+\/\d+\.html/gi,
    ],
  },
  {
    slug: "bat",
    displayName: "Bring a Trailer",
    senderPatterns: [/bringatrailer\.com/i, /bat.*@/i],
    urlPatterns: [
      /https?:\/\/(?:www\.)?bringatrailer\.com\/listing\/[^\s"'<>]+/gi,
      /https?:\/\/(?:www\.)?bringatrailer\.com\/auction\/[^\s"'<>]+/gi,
    ],
    parseHints: (subject) => {
      // BaT subjects: "New Listing: 1967 Chevrolet Chevelle SS 396"
      const m = subject.match(/(\d{4})\s+(.+?)(?:\s*[-–|]|$)/);
      if (m) {
        const parts = m[2].trim().split(/\s+/);
        return {
          year: parseInt(m[1]),
          make: parts[0],
          model: parts.slice(1).join(" "),
          title: `${m[1]} ${m[2].trim()}`,
        };
      }
      return {};
    },
  },
  {
    slug: "hemmings",
    displayName: "Hemmings",
    senderPatterns: [/hemmings\.com/i],
    urlPatterns: [
      /https?:\/\/(?:www\.)?hemmings\.com\/classifieds\/[^\s"'<>]+/gi,
      /https?:\/\/(?:www\.)?hemmings\.com\/stories\/[^\s"'<>]+/gi,
    ],
  },
  {
    slug: "ebay",
    displayName: "eBay Motors",
    senderPatterns: [/ebay\.com/i, /ebay@/i],
    urlPatterns: [
      /https?:\/\/(?:www\.)?ebay\.com\/itm\/\d+/gi,
      /https?:\/\/(?:www\.)?ebay\.com\/itm\/[^\s"'<>]+/gi,
    ],
  },
  {
    slug: "carscom",
    displayName: "Cars.com",
    senderPatterns: [/cars\.com/i],
    urlPatterns: [
      /https?:\/\/(?:www\.)?cars\.com\/vehicledetail\/[^\s"'<>]+/gi,
      /https?:\/\/(?:www\.)?cars\.com\/[^\s"'<>]*?detail[^\s"'<>]*/gi,
    ],
  },
  {
    slug: "autotrader",
    displayName: "AutoTrader",
    senderPatterns: [/autotrader\.com/i],
    urlPatterns: [
      /https?:\/\/(?:www\.)?autotrader\.com\/cars-for-sale\/vehicledetails[^\s"'<>]+/gi,
      /https?:\/\/(?:www\.)?autotrader\.com\/[^\s"'<>]*?listing[^\s"'<>]*/gi,
    ],
  },
  {
    slug: "hagerty",
    displayName: "Hagerty Marketplace",
    senderPatterns: [/hagerty\.com/i],
    urlPatterns: [
      /https?:\/\/(?:www\.)?hagerty\.com\/marketplace\/[^\s"'<>]+/gi,
    ],
  },
  {
    slug: "cargurus",
    displayName: "CarGurus",
    senderPatterns: [/cargurus\.com/i],
    urlPatterns: [
      /https?:\/\/(?:www\.)?cargurus\.com\/Cars\/[^\s"'<>]+/gi,
      /https?:\/\/(?:www\.)?cargurus\.com\/[^\s"'<>]*?listing[^\s"'<>]*/gi,
    ],
  },
  {
    slug: "classiccars",
    displayName: "ClassicCars.com",
    senderPatterns: [/classiccars\.com/i],
    urlPatterns: [
      /https?:\/\/(?:www\.)?classiccars\.com\/listings\/[^\s"'<>]+/gi,
    ],
  },
  {
    slug: "facebook",
    displayName: "Facebook Marketplace",
    senderPatterns: [/facebook\.com/i, /facebookmail\.com/i],
    urlPatterns: [
      /https?:\/\/(?:www\.)?facebook\.com\/marketplace\/item\/\d+/gi,
    ],
  },
  {
    slug: "pcarmarket",
    displayName: "PCAR Market",
    senderPatterns: [/pcarmarket\.com/i],
    urlPatterns: [
      /https?:\/\/(?:www\.)?pcarmarket\.com\/auction\/[^\s"'<>]+/gi,
    ],
  },
  {
    slug: "carsandbids",
    displayName: "Cars & Bids",
    senderPatterns: [/carsandbids\.com/i],
    urlPatterns: [
      /https?:\/\/(?:www\.)?carsandbids\.com\/auctions\/[^\s"'<>]+/gi,
    ],
  },
];

// ─── URL Extraction ────────────────────────────────────────────────

function detectSource(
  from: string,
  subject: string
): SourceConfig | null {
  for (const source of SOURCES) {
    for (const pattern of source.senderPatterns) {
      if (pattern.test(from) || pattern.test(subject)) {
        return source;
      }
    }
  }
  return null;
}

function extractUrls(
  source: SourceConfig | null,
  html: string,
  text: string
): string[] {
  const combined = html + "\n" + text;
  const urls = new Set<string>();

  if (source) {
    // Use source-specific patterns
    for (const pattern of source.urlPatterns) {
      // Reset lastIndex for global patterns
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(combined)) !== null) {
        urls.add(cleanUrl(match[0]));
      }
    }
  }

  // If no source-specific URLs found, do best-effort extraction
  // Look for any URL that looks like a vehicle listing
  if (urls.size === 0) {
    const genericPatterns = [
      /https?:\/\/[^\s"'<>]+(?:listing|vehicle|auction|item|detail|classified)[^\s"'<>]*/gi,
      /https?:\/\/[^\s"'<>]+(?:\/cars\/|\/auto\/|\/motors\/|\/for-sale\/)[^\s"'<>]*/gi,
    ];
    for (const pattern of genericPatterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(combined)) !== null) {
        const url = cleanUrl(match[0]);
        // Skip image/tracking/unsubscribe URLs
        if (!isJunkUrl(url)) {
          urls.add(url);
        }
      }
    }
  }

  return [...urls];
}

function cleanUrl(url: string): string {
  // Remove trailing punctuation, quote chars, HTML artifacts
  return url
    .replace(/[)"'>\]]+$/, "")
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/g, "/")
    .split("#")[0] // Remove fragment
    .split("?utm_")[0] // Remove UTM tracking (keep other params)
    .replace(/\/+$/, ""); // Remove trailing slashes
}

function isJunkUrl(url: string): boolean {
  const junkPatterns = [
    /unsubscribe/i,
    /email-preferences/i,
    /manage.*notifications/i,
    /click\..*\.com/i, // Tracking redirects
    /\.png$/i,
    /\.jpg$/i,
    /\.gif$/i,
    /\.svg$/i,
    /\.css$/i,
    /\.js$/i,
    /pixel/i,
    /tracking/i,
    /beacon/i,
    /open\..*\.com/i,
    /fonts\.googleapis/i,
    /schema\.org/i,
  ];
  return junkPatterns.some((p) => p.test(url));
}

// ─── Hint Parsing ──────────────────────────────────────────────────

function parseYearMakeModel(
  subject: string,
  text: string
): Partial<{ year: number; make: string; model: string; title: string; price: number }> {
  // Try to extract year/make/model from subject
  // Common patterns: "1967 Chevrolet Chevelle", "2003 Porsche 911"
  const patterns = [
    /(\d{4})\s+([A-Z][a-z]+(?:\s*-\s*[A-Z][a-z]+)?)\s+([A-Za-z0-9][\w\s-]+)/,
    /(\d{4})\s+(\w+)\s+(\w+)/,
  ];

  for (const pattern of patterns) {
    const match = subject.match(pattern);
    if (match) {
      const year = parseInt(match[1]);
      if (year >= 1900 && year <= 2030) {
        return {
          year,
          make: match[2],
          model: match[3].trim(),
          title: match[0].trim(),
        };
      }
    }
  }

  // Try price from subject or first few lines
  const priceMatch = (subject + " " + text.slice(0, 500)).match(
    /\$([0-9,]+)/
  );
  const price = priceMatch
    ? parseInt(priceMatch[1].replace(/,/g, ""))
    : undefined;
  if (price && price > 100 && price < 100_000_000) {
    return { price };
  }

  return {};
}

// ─── Main Handler ──────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Parse incoming webhook (SendGrid = form-data, Postmark/generic = JSON)
    const contentType = req.headers.get("content-type") || "";

    let from = "";
    let to = "";
    let subject = "";
    let html = "";
    let text = "";
    let messageId = "";

    if (contentType.includes("multipart/form-data")) {
      // SendGrid Inbound Parse
      const formData = await req.formData();
      from = formData.get("from")?.toString() || "";
      to = formData.get("to")?.toString() || "";
      subject = formData.get("subject")?.toString() || "";
      html = formData.get("html")?.toString() || "";
      text = formData.get("text")?.toString() || "";
      messageId = formData.get("Message-Id")?.toString() || "";

      // SendGrid also provides envelope, headers, etc.
      const envelope = formData.get("envelope")?.toString();
      if (envelope) {
        try {
          const env = JSON.parse(envelope);
          if (!from && env.from) from = env.from;
        } catch (_) {
          /* ignore */
        }
      }
    } else if (contentType.includes("application/json")) {
      // Postmark or JSON format
      const body = await req.json();
      from = body.From || body.from || body.sender || "";
      to = body.To || body.to || body.recipient || "";
      subject = body.Subject || body.subject || "";
      html = body.HtmlBody || body.html || body.body_html || "";
      text = body.TextBody || body.text || body.body_plain || body.stripped_text || "";
      messageId = body.MessageID || body.messageId || body["Message-Id"] || "";
    } else {
      // Try JSON anyway (some services send without proper content-type)
      try {
        const body = await req.json();
        from = body.from || body.From || body.sender || "";
        subject = body.subject || body.Subject || "";
        html = body.html || body.HtmlBody || "";
        text = body.text || body.TextBody || body.body_plain || "";
        messageId = body.messageId || body.MessageID || "";
      } catch (_) {
        return new Response(
          JSON.stringify({
            error: "Unsupported content type. Send multipart/form-data or JSON.",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    console.log(
      `[alert-email] From: ${from.slice(0, 80)} | Subject: ${subject.slice(0, 100)} | MsgID: ${messageId.slice(0, 40)}`
    );

    // Detect source
    const source = detectSource(from, subject);
    const sourceName = source?.displayName || "unknown";
    console.log(`[alert-email] Detected source: ${sourceName}`);

    // Extract URLs
    const urls = extractUrls(source, html, text);
    console.log(`[alert-email] Extracted ${urls.length} listing URL(s)`);

    if (urls.length === 0) {
      // Log the email for debugging but don't fail
      await supabase.from("alert_email_log").insert({
        from_address: from.slice(0, 500),
        subject: subject.slice(0, 500),
        source_slug: source?.slug || "unknown",
        urls_found: 0,
        message_id: messageId || null,
        status: "no_urls",
        raw_snippet: (text || html).slice(0, 2000),
      }).then(() => {}, () => {}); // ignore errors if table doesn't exist yet

      return new Response(
        JSON.stringify({
          success: true,
          source: sourceName,
          urls_found: 0,
          queued: 0,
          message: "No listing URLs found in email",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse hints (year/make/model/price) from subject/body
    const hints = source?.parseHints
      ? source.parseHints(subject, text)
      : parseYearMakeModel(subject, text);

    // Queue each URL into import_queue
    const rows = urls.map((url) => ({
      listing_url: url,
      listing_title: hints.title || subject.slice(0, 200) || null,
      listing_year: hints.year || null,
      listing_make: hints.make || null,
      listing_model: hints.model || null,
      listing_price: hints.price || null,
      status: "pending",
      priority: 5, // Medium-high priority for email alerts (they're timely)
      raw_data: {
        alert_source: source?.slug || "unknown",
        alert_from: from.slice(0, 200),
        alert_subject: subject.slice(0, 300),
        alert_message_id: messageId || null,
        ingested_via: "email_alert",
        ingested_at: new Date().toISOString(),
      },
    }));

    // Upsert to handle duplicates (listing_url is unique)
    const { data: inserted, error: insertError } = await supabase
      .from("import_queue")
      .upsert(rows, {
        onConflict: "listing_url",
        ignoreDuplicates: true,
      })
      .select("id, listing_url, status");

    if (insertError) {
      console.error(`[alert-email] Insert error: ${insertError.message}`);
      // Don't fail the webhook - SendGrid will retry
    }

    const queuedCount = inserted?.length || 0;
    const dedupedCount = urls.length - queuedCount;

    console.log(
      `[alert-email] Queued: ${queuedCount}, Deduped: ${dedupedCount} from ${sourceName}`
    );

    // Log the email
    await supabase.from("alert_email_log").insert({
      from_address: from.slice(0, 500),
      subject: subject.slice(0, 500),
      source_slug: source?.slug || "unknown",
      urls_found: urls.length,
      urls_queued: queuedCount,
      urls_deduped: dedupedCount,
      message_id: messageId || null,
      status: "processed",
      urls: urls,
    }).then(() => {}, () => {}); // ignore errors if table doesn't exist yet

    return new Response(
      JSON.stringify({
        success: true,
        source: sourceName,
        urls_found: urls.length,
        queued: queuedCount,
        deduped: dedupedCount,
        urls,
        hints,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[alert-email] Error:", error);
    // Return 200 even on error so SendGrid doesn't retry endlessly
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
