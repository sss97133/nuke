/**
 * Barn Finds listing extractor
 *
 * WordPress site, direct fetch only (no Firecrawl). A post is an editorial write-up of a car listed elsewhere; parseArticle.ts
 * reads the headline identity, the article text, the quoted price and place, photos and comments.
 *
 * POST { url: "https://barnfinds.com/bf-exclusive-1990-ford-f-150-lariat-4x4/" }
 * POST { action: "batch", limit?: number }  – land unlanded barnfinds source_targets under a polite throttle
 *   (>= 2 s between fetches, stops on 403/429, time-boxed); run by the barnfinds-intake-batch pg_cron job.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { normalizeListingUrlKey } from "../_shared/listingUrl.ts";
import { normalizeVehicleFields } from "../_shared/normalizeVehicle.ts";
import { qualityGate } from "../_shared/extractionQualityGate.ts";
import { resolveExistingVehicleId, discoveryUrlIlikePattern } from "../_shared/resolveVehicleForListing.ts";
import { writeObservation } from "../_shared/observationWriter.ts";
import { requireWriteAuth } from "../_shared/writeGuard.ts";
import { projectSecretKey } from "../_shared/supabaseKeys.ts";
import { writeVehicleEventByKey } from "../_shared/vehicleEventWrite.ts";
import { parseBarnFindsPost } from "./parseArticle.ts";

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

type Supabase = any;
type Outcome = { status: number; body: Record<string, unknown>; blocked?: boolean };

const MIN_GAP_MS = 2000; // <= 1 request per 2 s to barnfinds.com
const BATCH_BUDGET_MS = 110_000;
const BATCH_MAX = 50;

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

async function extractOne(supabase: Supabase, url: string): Promise<Outcome> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15000) });
  if (res.status === 403 || res.status === 429) {
    return { status: 429, blocked: true, body: { success: false, error: `barnfinds.com answered ${res.status}` } };
  }
  if (res.status === 404 || res.status === 410) return { status: 422, body: { success: false, error: `page gone (${res.status})` } };
  if (!res.ok) return { status: 502, body: { success: false, error: `barnfinds.com answered ${res.status}` } };
  const html = await res.text();
  await archiveSnapshot(supabase, url, html, res.status);

  const post = parseBarnFindsPost(html);
  const { year, make, model, vin, title } = post;
  // A post with no year in its headline is an article about cars (round-ups, news), not one car.
  if (!year || !make) return { status: 422, body: { success: false, error: "No single vehicle in the headline" } };

  const platform = "barnfinds";
  const slug = url.replace(/^https?:\/\/[^/]+\//, "").replace(/\/$/, "");
  // Skip ILIKE pattern (causes full table scan timeout on 800K+ vehicles)
  // Barn Finds URLs are consistent, so exact match is sufficient
  const { vehicleId } = await resolveExistingVehicleId(supabase, { url, platform, discoveryUrlIlikePattern: null });

  const listingUrlKey = normalizeListingUrlKey(url);
  const norm = normalizeVehicleFields({ make, model, year });
  const vehicleRow: Record<string, unknown> = {
    discovery_url: url,
    discovery_source: platform,
    year: norm.year ?? year,
    make: norm.make ?? make,
    model: norm.model ?? model,
    vin: vin || undefined,
    title: title || undefined,
    profile_origin: "barnfinds",
    source: "barnfinds",
    is_public: true,
    status: "active",
  };
  // The article is a description of the car, written by Barn Finds: set it on a new vehicle or one without a description, never over another description.
  if (post.articleText) {
    if (!vehicleId) vehicleRow.description = post.articleText;
    else {
      const { data: cur } = await supabase.from("vehicles").select("description").eq("id", vehicleId).maybeSingle();
      if (cur && !cur.description) vehicleRow.description = post.articleText;
    }
  }

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

  // Testimony: the whole article is the observation's text; the identity fields are what the headline states.
  // An asking price is not a sale: it goes on the event (current_price), never as sale_price.
  const obsFields: Record<string, any> = { year, make, model };
  if (vin) obsFields.vin = vin;
  const observedAt = new Date().toISOString();
  const obs = await writeObservation(supabase, {
    vehicleId: finalVehicleId,
    source: { platform: "barnfinds", url, trustScore: 0.55 },
    fields: obsFields,
    observationKind: "listing",
    extractionMethod: "html_parse",
    observedAt,
    contentText: post.articleText,
    rawData: {
      title, asking_price: post.askingPrice, price_text: post.priceText, location: post.location, listing_platform: post.listingPlatform,
      tipster: post.tipster, published_at: post.publishedAt, modified_at: post.modifiedAt, image_count: post.imageUrls.length, comment_count: post.comments.length,
    },
  }).catch((e: any) => {
    console.warn(`[BARNFINDS] observationWriter error for ${finalVehicleId}: ${e?.message}`);
    return null;
  });

  // The listing key is partial-unique, so upsert/onConflict cannot reach it: write by key (_shared/vehicleEventWrite.ts).
  const event = await writeVehicleEventByKey(supabase, {
    vehicle_id: finalVehicleId,
    source_platform: platform,
    event_type: "listing",
    source_url: url,
    source_listing_id: listingUrlKey || slug,
    // The post is an article about a listing elsewhere; whether that listing is still open is not stated.
    event_status: "unknown",
    started_at: post.publishedAt ?? undefined,
    current_price: post.askingPrice ?? null, // null on purpose: a reland must clear a price an older parse got wrong
    comment_count: post.comments.length,
    extracted_at: observedAt,
    extraction_method: "html_parse",
    extraction_source: "extract-barn-finds-listing",
    metadata: {
      source: "extract-barn-finds-listing",
      kind: "editorial_post_about_listing",
      started_at_basis: "barnfinds post published",
      published_at: post.publishedAt,
      modified_at: post.modifiedAt,
      price_text: post.priceText,
      price_is_seller_asking_quoted_in_prose: post.askingPrice != null,
      obo: post.obo,
      seller_listing_platform: post.listingPlatform,
      seller_location_claim: post.location,
      tipster: post.tipster,
      photo_count: post.imageUrls.length,
    },
  });
  if (event.action === "error") throw new Error(`vehicle_events write failed: ${event.error}`);

  // Photos: external references to the post's own images.
  let imagesSaved = 0;
  if (post.imageUrls.length > 0) {
    await supabase.from("vehicle_images").delete().eq("vehicle_id", finalVehicleId).eq("source", platform);
    const rows = post.imageUrls.slice(0, 100).map((imgUrl, i) => ({
      vehicle_id: finalVehicleId,
      image_url: imgUrl,
      source: platform,
      source_url: imgUrl,
      is_external: true,
      approval_status: "auto_approved",
      is_approved: true,
      redaction_level: "none",
      position: i,
      display_order: i,
      is_primary: i === 0,
      exif_data: { source_url: url, discovery_url: url, imported_from: platform },
    }));
    const { data: ins, error: imgErr } = await supabase.from("vehicle_images").insert(rows).select("id");
    if (imgErr) console.warn(`[barnfinds] image save ${url}: ${imgErr.message}`);
    else imagesSaved = ins?.length ?? 0;
  }

  // Comments: the readers' thread, one row per comment, deduped by (vehicle_id, content_hash).
  let commentsSaved = 0;
  if (post.comments.length > 0) {
    const rows = [];
    for (const c of post.comments) {
      if (!c.author || !c.postedAtAssumedUtc) continue; // author_username and posted_at are NOT NULL
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`barnfinds:${c.id}:${c.text}`));
      rows.push({
        vehicle_id: finalVehicleId,
        platform,
        comment_type: "observation", // the table allows bid, sold, question, answer, observation...; a reader's remark is an observation
        posted_at: c.postedAtAssumedUtc,
        sequence_number: rows.length,
        author_username: c.author,
        comment_text: c.text,
        word_count: c.text.split(/\s+/).length,
        comment_likes: c.likes,
        source_url: `${url}#comment-${c.id}`,
        content_hash: Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join(""),
        raw_html: c.html,
      });
    }
    const { data: ins, error: cErr } = await supabase.from("auction_comments").upsert(rows, { onConflict: "vehicle_id,content_hash", ignoreDuplicates: true }).select("id");
    if (cErr) console.warn(`[barnfinds] comment save ${url}: ${cErr.message}`);
    else commentsSaved = ins?.length ?? 0;
  }

  return { status: 200, body: { success: true, vehicle_id: finalVehicleId, event: event.action, observation_id: obs?.observationId ?? null, images_saved: imagesSaved, comments_saved: commentsSaved } };
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
      out = await extractOne(supabase, t.listing_url.replace(/\/+$/, ""));
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
    const out = await extractOne(supabase, url);
    return json(out.body, out.status);
  } catch (e: any) {
    console.error("[extract-barn-finds-listing]", e);
    return json({ success: false, error: "extraction failed; see function logs" }, 500);
  }
});
