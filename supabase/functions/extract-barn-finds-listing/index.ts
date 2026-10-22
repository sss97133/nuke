/**
 * Barn Finds listing extractor
 *
 * WordPress site, direct fetch only (no Firecrawl). A post is an editorial write-up of a car listed elsewhere; parseArticle.ts
 * reads the headline identity, the article text, the quoted price and place, photos and comments.
 *
 * POST { url: "https://barnfinds.com/bf-exclusive-1990-ford-f-150-lariat-4x4/" }
 * POST { action: "batch", limit?: number }  – land unlanded barnfinds source_targets under a polite throttle
 *   (>= 2 s between fetches, stops on 403/429, time-boxed); run by the barnfinds-intake-batch pg_cron job. Each run ends
 *   with a bounded bind_pending sweep.
 * POST { action: "cite_snapshots", after?: fetched_at, limit?: number, dry_run?: boolean } – backfill citations from the
 *   kept pages (no fetch); returns next_after for the next call.
 * POST { action: "bind_pending", limit?: number } – recent posts whose cited listing was not held: bind any now held.
 *
 * Barn Finds is a curator: a post cites the seller's listing (citations.ts). When that listing is held the post lands on the
 * listing's vehicle (bind.ts); otherwise on a vehicle of its own, with the cited listing's blip, until the listing lands.
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
import { articleAndComments, type BarnFindsPost, parseBarnFindsPost } from "./parseArticle.ts";
import { bindableSubject, type CitedListing, citedListings, type ListingLink } from "./citations.ts";
import { type Binding, bindToListing, citationMetadata, identityAgrees, mergePostVehicle, resolveCitedListing } from "./bind.ts";
import { fetchHeldImageUrls, insertMissingVehicleImages } from "../_shared/vehicleImageWrite.ts";
import { landIdentifierClaims } from "../_shared/landIdentifierClaims.ts";

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
  return await landPost(supabase, url, html);
}

async function landPost(supabase: Supabase, url: string, html: string): Promise<Outcome> {
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

  // The listing the post links to is the car's own record: when we hold it, the post lands on that vehicle.
  const { article, comments: thread } = articleAndComments(html);
  const cites = citedListings(article, thread);
  const subject = bindableSubject(cites);
  const binding = await bindToListing(supabase, { postUrl: url, postVehicleId: vehicleId, cites, subject, identity: { year: norm.year ?? year, make: norm.make ?? make } });
  const listingVehicleId = binding.state === "bound" ? binding.target_vehicle_id : null;
  const observedAt = new Date().toISOString();
  const citation = citationMetadata(cites, subject, binding, observedAt);
  const featuredBy = { curator: "barnfinds", post_url: url, author: post.author, published_at: post.publishedAt, comment_count: post.comments.length };

  let finalVehicleId: string;
  if (listingVehicleId) {
    // The listing's vehicle keeps its own identity and description; the post's headline and prose stay on its observation.
    finalVehicleId = listingVehicleId;
  } else {
    const landed = await upsertPostVehicle(supabase, { url, platform, vehicleId, post, norm });
    if ("rejected" in landed) return landed.rejected;
    finalVehicleId = landed.id;
  }
  return await writePost(supabase, { url, slug, platform, listingUrlKey, post, finalVehicleId, bound: !!listingVehicleId, cites, subject, binding, citation, featuredBy, observedAt });
}

async function upsertPostVehicle(supabase: Supabase, o: { url: string; platform: string; vehicleId: string | null; post: BarnFindsPost; norm: Record<string, any> }): Promise<{ id: string } | { rejected: Outcome }> {
  const { url, platform, vehicleId, post, norm } = o;
  const { year, make, model, vin, title } = post;
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
    return { rejected: { status: 422, body: { success: false, error: "Quality gate rejected extraction", quality_score: gateResult.score, quality_issues: gateResult.issues } } };
  }
  Object.assign(vehicleRow, gateResult.cleaned);

  if (vehicleId) {
    await supabase.from("vehicles").update(vehicleRow).eq("id", vehicleId);
    return { id: vehicleId };
  }
  const { data: inserted, error: insErr } = await supabase.from("vehicles").insert(vehicleRow).select("id").maybeSingle();
  if (insErr) throw new Error(insErr?.message || String(insErr));
  if (!inserted) throw new Error("Vehicle insert returned no data");
  await landIdentifierClaims(supabase, { vehicleId: inserted.id, text: (vehicleRow as any).description, sourceUrl: (vehicleRow as any).listing_url ?? (vehicleRow as any).discovery_url, title: (vehicleRow as any).listing_title ?? null, extractor: "extract-barn-finds-listing" });
  return { id: inserted.id };
}

interface PostWrite {
  url: string; slug: string; platform: string; listingUrlKey: string | null; post: BarnFindsPost; finalVehicleId: string;
  /** The post landed on the vehicle of the listing it cites (not a vehicle of its own). */
  bound: boolean;
  cites: CitedListing[]; subject: (CitedListing & ListingLink) | null; binding: Binding;
  citation: Record<string, unknown>; featuredBy: Record<string, unknown>; observedAt: string;
}

async function writePost(supabase: Supabase, o: PostWrite): Promise<Outcome> {
  const { url, slug, platform, listingUrlKey, post, finalVehicleId, bound, observedAt } = o;
  const { year, make, model, vin, title } = post;

  // Testimony: the whole article is the observation's text; the identity fields are what the headline states.
  // An asking price is not a sale: it goes on the event (current_price), never as sale_price.
  // On a listing's vehicle the headline identity stays on this row: the listing's own record names the car.
  const obsFields: Record<string, any> = { year, make, model };
  if (vin) obsFields.vin = vin;
  const obs = await writeObservation(supabase, {
    vehicleId: finalVehicleId,
    source: { platform: "barnfinds", url, trustScore: 0.55 },
    fields: obsFields,
    observationKind: "listing",
    extractionMethod: "html_parse",
    observedAt,
    contentText: post.articleText,
    testimonyOnly: bound ? Object.keys(obsFields) : undefined,
    rawData: {
      title, asking_price: post.askingPrice, price_text: post.priceText, location: post.location, listing_platform: post.listingPlatform,
      tipster: post.tipster, author: post.author, published_at: post.publishedAt, modified_at: post.modifiedAt, image_count: post.imageUrls.length,
      comment_count: post.comments.length, featured_by: o.featuredBy, ...o.citation,
      ...(bound ? { image_urls: post.imageUrls.slice(0, 100) } : {}),
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
    // null on purpose: a reland must clear a price an older parse got wrong. On a listing's vehicle the listing's own episode
    // carries its price; the post's mentions stay in price_mentions, attributed to the prose.
    current_price: bound ? null : post.askingPrice ?? null,
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
      // current_price is set only from a mention the sentence calls asking; every mention is kept with its kind and sentence
      price_kind: post.askingPrice != null || post.foreignPrice ? "asking" : post.priceMentions.length ? "unknown" : null,
      // price_currency: the currency the seller's ask is stated in. current_price is only ever a USD ask; a non-USD ask keeps
      // the seller's own amount (null when the prose gives only the writer's USD conversion) and the derived USD figure here.
      price_currency: post.foreignPrice ? post.foreignPrice.currency : post.askingPrice != null ? "USD" : null,
      price_original_amount: post.foreignPrice ? post.foreignPrice.originalAmount : null,
      price_usd_derived: post.foreignPrice ? post.foreignPrice.usdDerived : null,
      price_usd_derived_basis: post.foreignPrice?.usdDerived != null ? "writer's own conversion quoted in the post; rate and date not stated" : null,
      price_source_sentence: post.priceSentence,
      price_mentions: post.priceMentions,
      obo: post.obo,
      seller_listing_platform: post.listingPlatform,
      seller_location_claim: post.location,
      tipster: post.tipster,
      author: post.author,
      photo_count: post.imageUrls.length,
      // Barn Finds chose this car: an editorial feature of the cited listing, with the readers' comment count.
      citation_role: "editorial_feature",
      featured_by: o.featuredBy,
      ...(bound ? { current_price_withheld: post.askingPrice != null ? "the cited listing's own episode carries its price" : null } : {}),
      ...o.citation,
    },
  });
  if (event.action === "error") throw new Error(`vehicle_events write failed: ${event.error}`);

  // The cited listing we do not hold yet: its blip, through the shared observation writer. The link is the only thing read:
  // no field is claimed for it. When that platform's intake later reads the listing, the pending-bind sweep folds this
  // vehicle into the listing's and the listing's own observation supersedes this one.
  let citedBlip: string | null = null;
  if (o.binding.state === "target_not_held" && o.subject) {
    const s = o.subject;
    const blip = await writeObservation(supabase, {
      vehicleId: finalVehicleId,
      source: { platform: s.platform, url: s.url, sourceIdentifier: s.listing_key ?? s.url },
      fields: {},
      observationKind: "listing",
      extractionMethod: "barnfinds_outbound_link",
      observedAt,
      rawData: {
        listing_read: false, basis: "Barn Finds' article links to this listing for the car it features; the listing itself was not read",
        cited_by: { curator: "barnfinds", post_url: url, published_at: post.publishedAt, anchor_text: s.anchor_text, raw_url: s.raw_url },
      },
    }).catch((e: any) => { console.warn(`[barnfinds] cited listing blip ${s.url}: ${e?.message}`); return null; });
    citedBlip = blip?.observationId ?? null;
  }

  // Photos: external references to the post's own images. On a listing's vehicle they are copies of the listing's gallery,
  // so they stay on the observation (image_urls) and the listing's own photos stand.
  let imagesSaved = 0;
  if (!bound && post.imageUrls.length > 0) {
    // Rows are never deleted: they carry the vision gate state, ids that analyses point at, and history. Insert the URLs the
    // vehicle does not hold; a photo that left the page is marked superseded.
    const wanted = post.imageUrls.slice(0, 100);
    const held = await fetchHeldImageUrls(supabase, finalVehicleId);
    const rows = wanted.map((imgUrl, i) => ({
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
      is_primary: i === 0 && held.size === 0,
      exif_data: { source_url: url, discovery_url: url, imported_from: platform },
    }));
    const { data: ins, error: imgErr } = await insertMissingVehicleImages(supabase, finalVehicleId, rows, { select: "id" });
    if (imgErr) console.warn(`[barnfinds] image save ${url}: ${imgErr.message}`);
    else imagesSaved = ins?.length ?? 0;
    const { data: mine } = await supabase.from("vehicle_images").select("id, image_url").eq("vehicle_id", finalVehicleId).eq("source", platform).or("is_superseded.is.null,is_superseded.eq.false");
    const gone = (mine ?? []).filter((r: { image_url: string }) => !wanted.includes(r.image_url)).map((r: { id: string }) => r.id);
    if (gone.length > 0) {
      const { error: supErr } = await supabase.from("vehicle_images").update({ is_superseded: true, superseded_at: new Date().toISOString() }).in("id", gone);
      if (supErr) console.warn(`[barnfinds] image supersede ${url}: ${supErr.message}`);
    }
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

  return { status: 200, body: {
    success: true, vehicle_id: finalVehicleId, event: event.action, observation_id: obs?.observationId ?? null, images_saved: imagesSaved, comments_saved: commentsSaved,
    bind_state: o.binding.state, cited_listing: o.citation.cited_listing, merge: o.binding.merge, cited_listing_blip: citedBlip,
  } };
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
  const pending = Date.now() - started < BATCH_BUDGET_MS ? await bindPending(supabase, 15) : null;
  return { success: true, cursor, ...tally, pending_binds: pending, elapsed_ms: Date.now() - started };
}

const bump = (m: Record<string, number>, k: string | null | undefined) => { const key = k ?? "unknown"; m[key] = (m[key] ?? 0) + 1; };

/**
 * Recent posts whose cited listing was not held when they landed: look again, and when the listing's platform intake has
 * since landed it, fold the post's vehicle into the listing's. Oldest check first; bounded per run.
 */
async function bindPending(supabase: Supabase, max: number) {
  const since = new Date(Date.now() - 60 * 86400e3).toISOString();
  const { data, error } = await supabase.from("vehicle_events").select("id, vehicle_id, source_url, metadata")
    .eq("source_platform", "barnfinds").gte("created_at", since).eq("metadata->>bind_state", "target_not_held")
    .order("metadata->>bind_checked_at", { ascending: true }).limit(max);
  if (error) return { error: error.message };
  const out = { checked: 0, bound: 0, merge_held: 0, errors: [] as string[] };
  for (const ev of data ?? []) {
    out.checked++;
    const now = new Date().toISOString();
    const link = ev.metadata?.cited_listing as ListingLink | null;
    const patch: Record<string, unknown> = { ...ev.metadata, bind_checked_at: now };
    if (link?.platform && link.url) {
      const r = await resolveCitedListing(supabase, link);
      if (r.error) out.errors.push(r.error);
      if (r.held && r.held.id !== ev.vehicle_id) {
        const { data: pv } = await supabase.from("vehicles").select("year, make").eq("id", ev.vehicle_id).maybeSingle();
        if (pv && identityAgrees(pv, r.held)) {
          const merge = await mergePostVehicle(supabase, { primaryId: r.held.id, dupId: ev.vehicle_id, postUrl: ev.source_url, subject: link, via: r.held.via });
          if (merge.outcome === "merged") {
            out.bound++;
            Object.assign(patch, { bind_state: "bound", bound_vehicle_via: r.held.via, bind_merge: { outcome: "merged", proposal_id: (merge.detail as any)?.proposal_id ?? null } });
          } else {
            out.merge_held++;
            Object.assign(patch, { bind_state: "merge_held", bind_detail: merge });
          }
        }
      }
    }
    const upd = await supabase.from("vehicle_events").update({ metadata: patch, ...(patch.bind_state === "bound" ? { current_price: null } : {}) }).eq("id", ev.id);
    if (upd.error) out.errors.push(upd.error.message);
  }
  return out;
}

/**
 * Backfill from the pages already kept (listing_page_snapshots, no fetch): read each post's links, record them on its event,
 * and fold the post's vehicle into the listing's vehicle where the listing is held. Walks snapshots by fetched_at.
 */
async function citeSnapshots(supabase: Supabase, o: { after?: string | null; limit?: number; dryRun?: boolean }) {
  const limit = Math.min(Math.max(Number(o.limit) || 25, 1), 60);
  const snaps = await supabase.from("listing_page_snapshots").select("id, listing_url, fetched_at, html")
    .eq("platform", "barnfinds").eq("success", true).gt("fetched_at", o.after ?? "1970-01-01T00:00:00Z")
    .order("fetched_at", { ascending: true }).limit(limit);
  if (snaps.error) return { success: false, error: `snapshot read: ${snaps.error.message}` };
  const t = {
    snapshots: 0, no_html: 0, no_event: 0, posts: 0, subject_live: {} as Record<string, number>, subject_replaced: {} as Record<string, number>,
    no_subject: 0, reference_links: {} as Record<string, number>, reader_links: {} as Record<string, number>,
    bind: {} as Record<string, number>, held: {} as Record<string, number>, merged: 0, already_on_listing: 0, errors: [] as string[],
  };
  let next: string | null = o.after ?? null;
  for (const s of snaps.data ?? []) {
    t.snapshots++;
    next = s.fetched_at;
    if (!s.html) { t.no_html++; continue; }
    const url = String(s.listing_url).replace(/\/+$/, "");
    const ev = await supabase.from("vehicle_events").select("id, vehicle_id, metadata, current_price").eq("source_platform", "barnfinds").in("source_url", [url, `${url}/`]).limit(1);
    if (ev.error) { t.errors.push(`event read ${url}: ${ev.error.message}`); continue; }
    const row = ev.data?.[0];
    if (!row?.vehicle_id) { t.no_event++; continue; }
    t.posts++;
    const post = parseBarnFindsPost(s.html);
    const { article, comments: thread } = articleAndComments(s.html);
    const cites = citedListings(article, thread);
    const subject = bindableSubject(cites);
    const replaced = cites.find((c) => c.role === "subject" && c.link_state !== "live");
    if (subject) bump(t.subject_live, subject.platform);
    else if (replaced) bump(t.subject_replaced, replaced.named_platform);
    else t.no_subject++;
    for (const c of cites) if (c.role === "reference" && c.platform) bump(t.reference_links, c.platform); else if (c.role === "reader") bump(t.reader_links, c.platform);
    if (o.dryRun) continue;
    const norm = normalizeVehicleFields({ make: post.make, year: post.year });
    const binding = await bindToListing(supabase, { postUrl: url, postVehicleId: row.vehicle_id, cites, subject, identity: { year: norm.year ?? post.year, make: norm.make ?? post.make } });
    bump(t.bind, binding.state);
    if (subject && binding.target_vehicle_id) bump(t.held, subject.platform);
    if (binding.merge?.outcome === "merged") t.merged++;
    else if (binding.state === "bound") t.already_on_listing++;
    if (binding.merge && binding.merge.outcome === "error") t.errors.push(`merge ${url}: ${JSON.stringify(binding.merge.detail).slice(0, 200)}`);
    const bound = binding.state === "bound";
    const metadata = {
      ...(row.metadata ?? {}), ...citationMetadata(cites, subject, binding, new Date().toISOString()),
      citation_role: "editorial_feature", author: post.author, citations_from_snapshot: s.id,
      featured_by: { curator: "barnfinds", post_url: url, author: post.author, published_at: post.publishedAt, comment_count: post.comments.length },
      ...(bound && row.current_price != null ? { current_price_withheld: "the cited listing's own episode carries its price" } : {}),
    };
    const upd = await supabase.from("vehicle_events").update({ metadata, ...(bound ? { current_price: null } : {}) }).eq("id", row.id);
    if (upd.error) t.errors.push(`event update ${url}: ${upd.error.message}`);
  }
  return { success: true, next_after: next, done: (snaps.data ?? []).length < limit, ...t };
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
    if (body.action === "cite_snapshots") return json(await citeSnapshots(supabase, { after: body.after ?? null, limit: body.limit, dryRun: body.dry_run === true }));
    if (body.action === "bind_pending") return json(await bindPending(supabase, Math.min(Math.max(Number(body.limit) || 15, 1), 50)));

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
