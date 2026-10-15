/**
 * Barn Finds listing extractor
 *
 * WordPress site – direct fetch first (no Firecrawl). Fallback to Firecrawl if blocked.
 * Parses: title, Asking/High Bid, Chassis # (VIN), Mileage, Location, Seller, description.
 *
 * POST { url: "https://barnfinds.com/bf-exclusive-1990-ford-f-150-lariat-4x4/" }
 * POST { url, use_firecrawl: true }  – force Firecrawl
 * POST { action: "batch", limit?: number }  – land unlanded barnfinds source_targets under a polite throttle
 *   (>= 2 s between fetches, stops on 403/429, time-boxed); run by the barnfinds-intake-batch pg_cron job.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { firecrawlScrape } from "../_shared/firecrawl.ts";
import { normalizeListingUrlKey } from "../_shared/listingUrl.ts";
import { normalizeVehicleFields } from "../_shared/normalizeVehicle.ts";
import { qualityGate } from "../_shared/extractionQualityGate.ts";
import { resolveExistingVehicleId, discoveryUrlIlikePattern } from "../_shared/resolveVehicleForListing.ts";
import { writeObservation } from "../_shared/observationWriter.ts";
import { requireWriteAuth } from "../_shared/writeGuard.ts";
import { projectSecretKey } from "../_shared/supabaseKeys.ts";
import { writeVehicleEventByKey } from "../_shared/vehicleEventWrite.ts";

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

function parseFromMarkdown(md: string, url: string): Record<string, unknown> {
  const data: Record<string, unknown> = { url, title: null, year: null, make: null, model: null, vin: null, mileage: null, sale_price: null, asking_price: null, high_bid: null, location: null, seller: null, description: null };
  const lines = md.split("\n").map((l) => l.trim()).filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("# ")) {
      data.title = line.replace(/^#\s+/, "").trim();
      // Match year-make-model from title, handling prefixes like "Original Paint Survivor: 1955 Jeep CJ5"
      const titleMatch = String(data.title ?? "").match(/(?:^|:\s*)(\d{4})\s+(.+?)(?:\s+[×x]\s*\d+)?$/i);
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

type Supabase = any;
type Outcome = { status: number; body: Record<string, unknown>; blocked?: boolean };

const MIN_GAP_MS = 2000; // <= 1 request per 2 s to barnfinds.com
const BATCH_BUDGET_MS = 110_000;
const BATCH_MAX = 50;

/** Remove tags until none remain, so a nested fragment cannot reassemble one. */
function stripTags(input: string): string {
  let out = input;
  for (let prev = ""; prev !== out; ) {
    prev = out;
    out = out.replace(/<[^>]*>/g, " ");
  }
  return out;
}

function htmlToMarkdown(html: string): string {
  // Extract h1 title separately (it's outside entry-content on Barn Finds)
  const h1Match = html.match(/<h1[^>]*class="entry-title"[^>]*>([\s\S]*?)<\/h1>/i) || html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const h1Title = h1Match ? stripTags(h1Match[1]).replace(/[<>]/g, "").trim() : "";
  // Match entry-content first (Barn Finds WordPress structure), then fallback
  const mainMatch = html.match(/<div[^>]*class="entry-content"[^>]*>([\s\S]+?)<\/div>\s*(?:<div class="(?:author|post-tags|sharing)|<\/article)/i)
    || html.match(/<main[^>]*>([\s\S]+?)<\/main>/i)
    || html.match(/<article[^>]*>([\s\S]+?)<\/article>/i)
    || html.match(/<div[^>]*class="entry-content"[^>]*>([\s\S]+)/i);
  const content = mainMatch ? mainMatch[1] : html;
  // The output is parsed as text and never rendered; tags are stripped until none remain.
  let strip = content;
  for (let prev = ""; prev !== strip; ) {
    prev = strip;
    strip = strip.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  }
  strip = strip.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "# $1\n").replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n").replace(/<p[^>]*>/gi, "\n").replace(/<li[^>]*>/gi, "\n- ").replace(/<\/p>|<\/li>/gi, "\n");
  strip = stripTags(strip);
  let text = strip.replace(/&\#8217;/g, "'").replace(/&\#8220;|&\#8221;/g, '"').replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  // Prepend h1 as markdown heading if not already present
  if (h1Title && !text.startsWith("# ")) text = `# ${h1Title}\n${text}`;
  return text;
}

/** Keep the raw page (the testimony) before it is parsed. A duplicate hash (23505) means the same page is already kept. */
async function archiveSnapshot(supabase: Supabase, url: string, html: string, status: number) {
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(html));
    const sha256 = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
    const { error } = await supabase.from("listing_page_snapshots").insert({
      platform: "barnfinds",
      listing_url: url,
      fetched_at: new Date().toISOString(),
      fetch_method: "direct",
      http_status: status,
      success: true,
      html,
      html_sha256: sha256,
      content_length: html.length,
      metadata: { caller: "extract-barn-finds-listing" },
    });
    if (error && String(error.code) !== "23505") console.warn(`[barnfinds] snapshot ${url}: ${error.message}`);
  } catch (e: any) {
    console.warn(`[barnfinds] snapshot ${url}: ${e?.message}`);
  }
}

async function extractOne(supabase: Supabase, url: string, useFirecrawl: boolean): Promise<Outcome> {
  let markdown: string | null = null;
  if (!useFirecrawl) {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15000) });
    if (res.status === 403 || res.status === 429) {
      return { status: 429, blocked: true, body: { success: false, error: `barnfinds.com answered ${res.status}` } };
    }
    if (res.ok) {
      const html = await res.text();
      await archiveSnapshot(supabase, url, html, res.status);
      markdown = htmlToMarkdown(html);
    }
  }

  if (!markdown) {
    const key = Deno.env.get("FIRECRAWL_API_KEY");
    if (key) {
      const result = await firecrawlScrape({ url, formats: ["markdown"], onlyMainContent: true }, { timeoutMs: 25000 });
      markdown = result?.data?.markdown ?? null;
    }
  }
  if (!markdown) return { status: 422, body: { success: false, error: "Could not fetch or parse page" } };

  const parsed = parseFromMarkdown(markdown, url);
  const year = parsed.year as number | null;
  const make = (parsed.make as string) || null;
  const model = (parsed.model as string) || null;
  const vin = (parsed.vin as string) || null;
  const salePrice = parsed.sale_price != null ? Number(parsed.sale_price) : null;
  const title = (parsed.title as string) || null;
  if (!year && !vin && !title) return { status: 422, body: { success: false, error: "No vehicle data extracted" } };

  const platform = "barnfinds";
  const slug = url.replace(/^https?:\/\/[^/]+\//, "").replace(/\/$/, "");
  // Skip ILIKE pattern (causes full table scan timeout on 800K+ vehicles)
  // Barn Finds URLs are consistent, so exact match is sufficient
  const { vehicleId } = await resolveExistingVehicleId(supabase, { url, platform, discoveryUrlIlikePattern: null });

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
  const gateResult = qualityGate(vehicleRow, { source: "barnfinds", sourceType: "marketplace" });
  if (gateResult.action === "reject") {
    console.warn(`[barnfinds] Quality gate rejected (score=${gateResult.score}): ${gateResult.issues.join(", ")}`);
    return { status: 422, body: { success: false, error: "Quality gate rejected extraction", quality_score: gateResult.score, quality_issues: gateResult.issues } };
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

  const obsFields: Record<string, any> = {};
  if (year) obsFields.year = year;
  if (make) obsFields.make = make;
  if (model) obsFields.model = model;
  if (vin) obsFields.vin = vin;
  if (salePrice) obsFields.sale_price = salePrice;
  const observedAt = new Date().toISOString();
  const obs = await writeObservation(supabase, {
    vehicleId: finalVehicleId,
    source: { platform: "barnfinds", url, trustScore: 0.55 },
    fields: obsFields,
    observationKind: "listing",
    extractionMethod: "markdown_parse",
    observedAt,
  }).catch((e: any) => {
    console.warn(`[BARNFINDS] observationWriter error for ${finalVehicleId}: ${e?.message}`);
    return null;
  });

  // The listing key is partial-unique, so upsert/onConflict cannot reach it: write by key (_shared/vehicleEventWrite.ts).
  const askingPrice = parsed.asking_price != null ? Number(parsed.asking_price) : null;
  const highBid = parsed.high_bid != null ? Number(parsed.high_bid) : null;
  const event = await writeVehicleEventByKey(supabase, {
    vehicle_id: finalVehicleId,
    source_platform: platform,
    event_type: "listing",
    source_url: url,
    source_listing_id: listingUrlKey || slug,
    event_status: "active",
    current_price: highBid ?? askingPrice ?? undefined,
    extracted_at: observedAt,
    extraction_method: "markdown_parse",
    extraction_source: "extract-barn-finds-listing",
    metadata: { seller: parsed.seller, location: parsed.location, asking_price: askingPrice, high_bid: highBid, mileage: parsed.mileage, source: "extract-barn-finds-listing" },
  });
  if (event.action === "error") throw new Error(`vehicle_events write failed: ${event.error}`);

  return { status: 200, body: { success: true, vehicle_id: finalVehicleId, event: event.action, observation_id: obs?.observationId ?? null } };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const TARGETS_TAG = "barnfinds-targets";
const spellings = (u: string) => [u, u.replace(/\/+$/, "")];

/**
 * Land unlanded barnfinds source_targets, one fetch per MIN_GAP_MS. Walks source_targets in id order. A target is skipped
 * if it has a vehicle_event or an import_queue row; each one tried gets an import_queue row (extractor_version
 * TARGETS_TAG, raw_data.target_id), which is also the cursor. The row is inserted as 'processing': a 'pending' insert fires
 * trigger_process_import_queue_url, one HTTP call per row, and the auto-source trigger costs 14 ms a row.
 * Stops at `limit`, at the time box, after 3 failures in a row, and at once on a 403/429.
 */
async function runBatch(supabase: Supabase, limit: number) {
  const started = Date.now();
  const { data: last } = await supabase
    .from("import_queue")
    .select("raw_data")
    .eq("extractor_version", TARGETS_TAG)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  let cursor = Number(last?.raw_data?.target_id) || 0;

  const picked: { id: number; listing_url: string }[] = [];
  for (let page = 0; page < 20 && picked.length < limit; page++) {
    const { data: targets, error: tErr } = await supabase
      .from("source_targets")
      .select("id, listing_url")
      .eq("source_slug", "barnfinds")
      .gt("id", cursor)
      .order("id", { ascending: true })
      .limit(200);
    if (tErr) return { success: false, error: tErr.message };
    if (!targets?.length) break;
    cursor = targets[targets.length - 1].id;
    const queued = new Set<string>();
    const landed = new Set<string>();
    // 25 targets x 2 spellings keeps each request line short; an unread answer must never count as "nothing landed".
    for (let i = 0; i < targets.length; i += 25) {
      const chunk = targets.slice(i, i + 25).flatMap((t: { listing_url: string }) => spellings(t.listing_url));
      const [q, e] = await Promise.all([
        supabase.from("import_queue").select("listing_url").in("listing_url", chunk),
        supabase.from("vehicle_events").select("source_url").eq("source_platform", "barnfinds").in("source_url", chunk),
      ]);
      if (q.error || e.error) return { success: false, error: `landed lookup failed: ${(q.error || e.error)?.message}` };
      for (const r of q.data ?? []) queued.add(String(r.listing_url).replace(/\/+$/, ""));
      for (const r of e.data ?? []) landed.add(String(r.source_url).replace(/\/+$/, ""));
    }
    for (const t of targets) {
      const k = t.listing_url.replace(/\/+$/, "");
      if (!queued.has(k) && !landed.has(k) && picked.length < limit) picked.push(t);
    }
  }

  const tally = { picked: picked.length, complete: 0, skipped: 0, failed: 0, event_inserted: 0, event_updated: 0, stopped: null as string | null };
  let lastFetch = 0;
  let consecutiveFailures = 0;
  for (const t of picked) {
    if (Date.now() - started > BATCH_BUDGET_MS) { tally.stopped = "time_budget"; break; }
    const { data: row, error: claimErr } = await supabase
      .from("import_queue")
      .insert({ listing_url: t.listing_url, status: "processing", extractor_version: TARGETS_TAG, raw_data: { target_id: t.id }, locked_at: new Date().toISOString() })
      .select("id")
      .single();
    if (claimErr || !row) continue; // another run holds this target
    const wait = MIN_GAP_MS - (Date.now() - lastFetch);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastFetch = Date.now();
    const now = new Date().toISOString();
    let out: Outcome;
    try {
      out = await extractOne(supabase, t.listing_url.replace(/\/+$/, ""), false);
    } catch (e: any) {
      out = { status: 500, body: { success: false, error: e?.message ?? String(e) } };
    }
    if (out.blocked) {
      // Back off: free the target for a later run and stop.
      await supabase.from("import_queue").delete().eq("id", row.id);
      tally.stopped = "blocked_by_source";
      break;
    }
    if (out.body.success) {
      tally.complete++;
      consecutiveFailures = 0;
      if (out.body.event === "inserted") tally.event_inserted++; else tally.event_updated++;
      await supabase.from("import_queue").update({ status: "complete", processed_at: now, vehicle_id: out.body.vehicle_id }).eq("id", row.id);
    } else if (out.status === 422) {
      // Not a parseable listing (wanted ad, collection post, quality gate): terminal.
      tally.skipped++;
      consecutiveFailures = 0;
      await supabase.from("import_queue").update({ status: "skipped", processed_at: now, error_message: String(out.body.error).slice(0, 500), failure_category: "extraction_failed" }).eq("id", row.id);
    } else {
      tally.failed++;
      consecutiveFailures++;
      await supabase.from("import_queue").update({ status: "failed", processed_at: now, error_message: String(out.body.error).slice(0, 500), failure_category: "extraction_failed" }).eq("id", row.id);
      if (consecutiveFailures >= 3) { tally.stopped = "3_failures_in_a_row"; break; }
    }
  }
  return { success: true, cursor, ...tally, elapsed_ms: Date.now() - started };
}

Deno.serve(async (req) => {
  // Writes are never anonymous: service key, signed-in user, or nothing (P0.2, 2026-09-27).
  const denied = await requireWriteAuth(req);
  if (denied) return denied;
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", projectSecretKey() ?? "");

    if (body.action === "batch") {
      const limit = Math.min(Math.max(parseInt(body.limit ?? BATCH_MAX, 10) || BATCH_MAX, 1), BATCH_MAX);
      return json(await runBatch(supabase, limit));
    }

    const url = (body.url || "").trim().replace(/\/$/, "");
    let host = "";
    try { host = new URL(url).hostname.toLowerCase(); } catch { /* not a URL */ }
    if (host !== "barnfinds.com" && host !== "www.barnfinds.com") return json({ success: false, error: "url required (barnfinds.com)" }, 400);
    const out = await extractOne(supabase, url, body.use_firecrawl === true);
    return json(out.body, out.status);
  } catch (e: any) {
    console.error("[extract-barn-finds-listing]", e);
    return json({ success: false, error: "extraction failed; see function logs" }, 500);
  }
});
