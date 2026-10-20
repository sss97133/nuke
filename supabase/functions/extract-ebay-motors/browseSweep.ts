/**
 * The eBay Browse intake, in the owner's order: tier 1 (1964-1973), tier 2 (1974-1991), then the rest.
 *
 *   sweep   search category 6001 per tier (Year aspect filter, newest first), stop at items already held, rank the new ones
 *           private-first, getItem each within the day's quota, and land it:
 *             listing_page_snapshots row (the raw getItem JSON, the capture)
 *             ingest (explicit fields, enrich:false)            -> the vehicle, its photos, duplicate matching
 *             ingest-observation via writeObservation (listing)  -> the observation, gap-fill
 *             vehicle_events listing episode by key              -> what the listings readers show
 *           A listing whose identity is incomplete, or that ingest rejects, is kept as an unresolved observation.
 *   revisit the oldest-checked live listings: gone (404) or past its end date -> `ended` (never a sale); a changed price is logged.
 *
 * Every write result is read: a failed write is an error in the run's report and a non-2xx answer.
 */
import { writeObservation } from "../_shared/observationWriter.ts";
import { writeVehicleEventByKey } from "../_shared/vehicleEventWrite.ts";
import { mustWrite, softWrite } from "../_shared/writeResult.ts";
import { identityConflict } from "../_shared/identityMatch.ts";
import { recordRevision } from "../_shared/revision.ts";
import { htmlToText } from "../_shared/htmlToText.ts";
import { endedRow } from "../poll-listing-feeds/removal.ts";
import { aspectFilterFor, BrowseClient, ItemGone, QuotaExceeded, yearAspect } from "./browseApi.ts";
import { CLASS_RANK, classifySeller, linkVin, listingKey, TIERS, toLanding, type SellerClass } from "./browseMap.ts";
import { projectSecretKey } from "../_shared/supabaseKeys.ts";
import { landPlace, newPlaceCtx } from "./browsePlace.ts";
import { deletedLookup, handleHashes, tombstoneItem } from "./deletedMembers.ts";

export const PLATFORM = "ebay_motors";
const METHOD = "ebay_browse_api_v1";

export interface SweepOptions {
  tiers?: number[];            // default all, in order
  maxSearchPages?: number;     // per tier per run
  maxItems?: number;           // getItem calls per run
  reserveCalls?: number;       // left for revisits
  blindCap?: number;           // calls allowed when eBay will not report the remaining quota
  dryRun?: boolean;            // search and classify only; no getItem, no writes
  concurrency?: number;
}

export interface Report {
  action: string; ok: boolean; stopped: string | null; calls: number; remaining_before: number | null; remaining_after: number | null;
  year_aspect: string | null;
  per_tier: Record<string, { seen: number; held: number; new: number; fetched: number; landed: number }>;
  by_class: Record<string, number>; landed: number; blips: number; rejected: number; ingest_created: number; ingest_matched: number; linked_by_vin?: number; vin_conflicts?: number;
  places?: Record<string, number>;
  errors: string[];
}
export const emptyReport = (action: string): Report => ({
  action, ok: true, stopped: null, calls: 0, remaining_before: null, remaining_after: null, year_aspect: null, per_tier: {}, by_class: {},
  landed: 0, blips: 0, rejected: 0, ingest_created: 0, ingest_matched: 0, errors: [],
});

const itemUrl = (key: string) => `https://www.ebay.com/itm/${key}`;
const placeCtx = newPlaceCtx();   // us_states and checked city points, read once per warm instance

export async function heldKeys(supabase: any, keys: string[]): Promise<Set<string>> {
  const held = new Set<string>();
  if (!keys.length) return held;
  const r = mustWrite("held snapshots read", await supabase.from("listing_page_snapshots").select("listing_url")
    .eq("platform", PLATFORM).eq("success", true).in("listing_url", keys.map(itemUrl)).limit(1000));
  for (const row of r.data ?? []) held.add(String(row.listing_url).split("/").pop()!);
  return held;
}

async function callIngest(input: Record<string, unknown>): Promise<{ status: string; vehicle_id?: string | null; reason?: string; error?: string }> {
  const secret = projectSecretKey() ?? "";
  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/ingest`, { // guardrail-allow: raw-fetch (our own function)
    method: "POST", headers: { Authorization: `Bearer ${secret}`, apikey: secret, "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  const j = await r.json().catch(() => ({ status: "error", error: `ingest HTTP ${r.status} (non-JSON body)` }));
  return j;
}

/** Land one fetched item. Returns what happened; throws only on a write the run must not continue past. */
export interface LandOpts {
  /** The capture is already stored (retain.ts stored the Firecrawl response): link it instead of inserting a getItem snapshot. */
  snapshotId?: string | null;
  /** Provenance label on the listing episode: 'ebay-browse-api' (default) or 'ebay-firecrawl'. */
  source?: string;
  /** Extra attributed facts for the observation's raw data and the episode's metadata (card text, listed label, ...). */
  extra?: Record<string, unknown>;
  method?: string;
}

export async function landItem(supabase: any, raw: any, rep: Report, now = new Date().toISOString(), opts: LandOpts = {}): Promise<"landed" | "blip" | "rejected" | "skipped"> {
  // 0. a member eBay says deleted their account stays gone: their handle (and, on a listing they sold, the seller object and the
  //    description's contact details) is redacted before anything is stored (deletedMembers.ts). No answer, no landing.
  try { raw = (await tombstoneItem(deletedLookup(supabase), raw)).raw; }
  catch (e) { rep.errors.push(`deleted-member check ${String(raw?.itemId).slice(0, 40)}: ${(e as Error).message}`.slice(0, 300)); return "skipped"; }
  const landing = toLanding(raw, htmlToText, opts.source);
  if (!landing) { rep.errors.push(`item without a numeric id: ${String(raw?.itemId).slice(0, 40)}`); return "skipped"; }

  // 1. the capture: the raw getItem JSON, kept whole (the Firecrawl door has already stored its page and passes the id)
  let snapshotId: string | null = opts.snapshotId ?? null;
  if (!opts.snapshotId) {
    const body = JSON.stringify(raw);
    const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const handles = await handleHashes(body);   // the members the body names, by hash: a later deletion request finds it without reading it
    const snap = await supabase.from("listing_page_snapshots").insert({
      platform: PLATFORM, listing_url: landing.url, fetched_at: now, fetch_method: "ebay_browse_getItem", http_status: 200, success: true,
      html: body, html_sha256: sha, content_length: body.length, metadata: { api: "buy/browse/v1/item", marketplace: raw.listingMarketplaceId ?? null, caller: "extract-ebay-motors",
        member_handles_sha256: handles.member, seller_handles_sha256: handles.seller },
    }).select("id").maybeSingle();
    snapshotId = snap.data?.id ?? null;
    if (snap.error && String(snap.error.code) !== "23505") mustWrite(`snapshot ${landing.listingKey}`, snap);
  }

  // 2. the vehicle, through ingest (identity gate, VIN/URL duplicate matching, photos)
  let vehicleId: string | null = null;
  let outcome: "landed" | "blip" | "rejected" = "landed";
  // 2a. a VIN already held by a vehicle decides first (a car that sold on BaT and is now on eBay is one record):
  //     same car (identityMatch: VIN, make, year, model words agree) -> link to it, fill-only, no new vehicle;
  //     a different car under the same VIN, or two holders -> a revision item and an unresolved listing, never a new vehicle.
  //     Only a VIN strong for the car's era may pick a vehicle (linkVin); a weak one stays a claim on the observation and the
  //     listing goes to ingest, which links on the listing URL only and never on year/make/model.
  // 2a0. a listing id already linked to a vehicle stays on that vehicle (a second capture of the same item)
  let vinBlocked = false;
  const linked = await supabase.from("vehicle_events").select("vehicle_id").eq("source_platform", PLATFORM)
    .eq("source_listing_id", landing.listingKey).not("vehicle_id", "is", null).limit(2);
  if (linked.error) { rep.errors.push(`listing lookup ${landing.listingKey}: ${linked.error.message}`); return "skipped"; }
  const linkedIds = [...new Set((linked.data ?? []).map((r: any) => r.vehicle_id))];
  if (linkedIds.length === 1) vehicleId = linkedIds[0] as string;
  const strong = vehicleId ? null : linkVin(landing.vin.vin, landing.year);
  const heldVin = strong ? landing.vin.vin : null;
  if (strong && heldVin) {
    const held = await supabase.from("vehicles").select("id,year,make,model,vin").in("vin", strong.keys).limit(3);
    if (held.error) { rep.errors.push(`vin lookup ${landing.listingKey}: ${held.error.message}`); return "skipped"; }
    const rows = held.data ?? [];
    const incoming = { year: landing.year, make: landing.make, model: landing.model, vin: rows.length === 1 ? rows[0].vin : heldVin };
    const conflict = rows.length > 1 ? `${rows.length} vehicles hold vin ${heldVin}` : rows.length === 1 ? identityConflict(rows[0], incoming) : null;
    if (rows.length === 1 && !conflict) {
      vehicleId = rows[0].id; rep.linked_by_vin = (rep.linked_by_vin ?? 0) + 1;
    } else if (conflict) {
      vinBlocked = true; rep.vin_conflicts = (rep.vin_conflicts ?? 0) + 1;
      await recordRevision(supabase, { url: landing.url, missing: ["identity_match"], reason: "bad_data", next_action: "relink", raised_by: "extract-ebay-motors",
        vehicle_id: rows[0]?.id ?? null, snapshot_id: snapshotId, detail: { reason: "different_car", detail: conflict, vin: heldVin, holders: rows.map((r: any) => r.id) } });
    }
  }
  if (vinBlocked) { outcome = "blip"; rep.blips++; }
  else if (vehicleId) { /* linked above */ }
  else if (landing.ingestInput) {
    const res = await callIngest(landing.ingestInput);
    if ((res.status === "created" || res.status === "matched" || res.status === "duplicate") && res.vehicle_id) {
      vehicleId = res.vehicle_id;
      if (res.status === "created") rep.ingest_created++; else rep.ingest_matched++;
    } else {
      outcome = "rejected"; rep.rejected++;
      rep.errors.push(`ingest ${res.status} for ${landing.listingKey}: ${(res.reason ?? res.error ?? "").slice(0, 160)}`);
      // an ingest *error* (not a deliberate rejection) is a failure of the run; a rejection is kept as an unresolved observation below
      if (res.status === "error") return "rejected";
    }
  } else { outcome = "blip"; rep.blips++; }

  // 3. the observation (vehicleId null => an unresolved listing, retained and not guessed)
  const obs = await writeObservation(supabase, {
    vehicleId, unresolved: vehicleId === null,
    source: { platform: PLATFORM, url: landing.url, sourceIdentifier: landing.listingKey },
    fields: landing.obsFields, observationKind: "listing", extractionMethod: opts.method ?? METHOD, observedAt: now,
    // a VIN too weak to pick a vehicle is too weak to write onto one: it stays a claim on this row
    ...(landing.vin.vin && !linkVin(landing.vin.vin, landing.year) ? { testimonyOnly: ["vin"] } : {}),
    contentText: landing.descriptionText || raw.title,
    rawData: {
      snapshot_id: snapshotId, item_id: raw.itemId, title: raw.title, category_path: raw.categoryPath ?? null, condition: raw.condition ?? null,
      price: landing.price, location: raw.itemLocation ?? null, seller: raw.seller ?? null, seller_class_claim: landing.seller,
      buying_options: raw.buyingOptions ?? [], listing_posted_at: landing.postedAt, listing_ends_at: landing.endsAt,
      image_urls: landing.images, specifics: raw.localizedAspects ?? [], listing_vin: landing.vin, ...(opts.extra ?? {}),
    },
  } as any);
  if (obs.errors?.length) rep.errors.push(`observation ${landing.listingKey}: ${obs.errors.slice(0, 2).join("; ")}`);

  // 4. the listing episode, and the asking price in the price log
  if (vehicleId && obs.observationId) {
    const ev = await writeVehicleEventByKey(supabase, {
      vehicle_id: vehicleId, source_platform: PLATFORM, source_listing_id: landing.listingKey, source_url: landing.url,
      event_type: "listing", event_status: "active", ...(landing.price.amount != null ? { current_price: landing.price.amount } : {}),
      metadata: { ...landing.eventMetadata, ...(opts.extra ? { page: opts.extra } : {}), observation_id: obs.observationId, snapshot_id: snapshotId, source_observed_at: now, last_checked_at: now },
    }, { preserveEventStatus: true, sourceObservedAt: now });
    if (ev.action === "error") rep.errors.push(`listing event ${landing.listingKey}: ${ev.error}`);
    if (landing.price.amount != null) {
      softWrite(`price log ${landing.listingKey}`, await supabase.from("vehicle_price_history").insert({
        vehicle_id: vehicleId, price_type: "asking", value: landing.price.amount, source: PLATFORM, as_of: now, confidence: 70,
        proof_type: "listing", proof_url: landing.url, notes: `ebay item ${landing.listingKey}`,
      }), rep.errors);
    }
  } else if (vehicleId) {
    rep.errors.push(`listing event ${landing.listingKey}: no observation id, episode not written`);
  }

  // 5. where the listing says the car is (browsePlace.ts), on the capture's clock; Browse captures only
  if (vehicleId && (opts.source ?? "ebay-browse-api") === "ebay-browse-api") {
    try {
      const p = await landPlace(supabase, placeCtx, { vehicleId, url: landing.url, observedAt: now, loc: raw.itemLocation,
        description: landing.descriptionText, observationId: obs.observationId ?? null, snapshotId });
      const k = p.disputed ? "disputed" : p.outcome === "written" ? `written_${p.grain}` : p.outcome;
      rep.places = { ...(rep.places ?? {}), [k]: (rep.places?.[k] ?? 0) + 1 };
    } catch (e) {
      rep.errors.push(`place ${landing.listingKey}: ${(e as Error).message}`.slice(0, 300));
    }
  }
  if (outcome === "landed") rep.landed++;
  return outcome;
}

export async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

export async function sweep(supabase: any, client: BrowseClient, o: SweepOptions = {}): Promise<Report> {
  const rep = emptyReport(o.dryRun ? "sweep_dry_run" : "sweep");
  const maxPages = o.maxSearchPages ?? 3, maxItems = o.maxItems ?? 25, reserve = o.reserveCalls ?? 400, conc = o.concurrency ?? 3;
  try {
    const q = await client.remainingToday();
    rep.remaining_before = q?.remaining ?? null;
    let budget = q ? q.remaining - reserve : (o.blindCap ?? 60);
    if (budget < 5) { rep.stopped = `quota: ${q?.remaining ?? "?"} calls left, ${reserve} reserved for revisits`; return rep; }
    const spend = () => budget - client.calls;

    const ya = yearAspect(await client.aspectRefinements());
    if (!ya) { rep.ok = false; rep.errors.push("category 6001 refinements list no Year aspect"); return rep; }
    rep.year_aspect = ya.name;

    type Cand = { key: string; id: string; cls: SellerClass; tier: number };
    const cands: Cand[] = [];
    for (const tier of TIERS.filter((t) => !o.tiers || o.tiers.includes(t.id))) {
      const years = tier.years.filter((y) => ya.counts.size === 0 || (ya.counts.get(y) ?? 0) > 0);
      const t = (rep.per_tier[tier.id] = { seen: 0, held: 0, new: 0, fetched: 0, landed: 0 });
      if (!years.length) continue;
      for (let page = 0; page < maxPages && spend() > 1; page++) {
        const res = await client.search({ aspectFilter: aspectFilterFor(ya.name, years), offset: page * 200, limit: 200 });
        const sums = res.itemSummaries.filter((s) => s.itemId && listingKey(s));
        t.seen += sums.length;
        const held = await heldKeys(supabase, sums.map((s) => listingKey(s)!));
        const fresh = sums.filter((s) => !held.has(listingKey(s)!));
        t.held += sums.length - fresh.length; t.new += fresh.length;
        for (const s of fresh) {
          const cls = classifySeller(s).class; rep.by_class[cls] = (rep.by_class[cls] ?? 0) + 1;
          if (!cands.some((c) => c.key === listingKey(s))) cands.push({ key: listingKey(s)!, id: s.itemId!, cls, tier: tier.id });
        }
        if (fresh.length === 0 || !res.next || (page + 1) * 200 >= 9800) break;   // reached what we already hold
      }
    }
    if (o.dryRun) { rep.stopped = "dry run"; return rep; }

    // tier first (the owner's order), private-first inside a tier, newest-first inside a class (search order is kept by the stable sort)
    cands.sort((a, b) => a.tier - b.tier || CLASS_RANK[a.cls] - CLASS_RANK[b.cls]);
    const todo = cands.slice(0, Math.min(maxItems, Math.max(0, spend())));
    await pool(todo, conc, async (c) => {
      if (client.calls >= budget + 2) return;
      try {
        const raw = await client.getItem(c.id);
        rep.per_tier[c.tier].fetched++;
        const r = await landItem(supabase, raw, rep);
        if (r === "landed") rep.per_tier[c.tier].landed++;
      } catch (e) {
        if (e instanceof QuotaExceeded) throw e;
        if (e instanceof ItemGone) return;           // listed, then gone before we read it: nothing to land
        rep.errors.push(`${c.key}: ${(e as Error).message}`.slice(0, 300));
      }
    });
    if (cands.length > todo.length) rep.stopped = `budget: ${cands.length - todo.length} new listings wait for the next run`;
  } catch (e) {
    if (e instanceof QuotaExceeded) rep.stopped = `quota: ${e.message}`;
    else { rep.ok = false; rep.errors.push((e as Error).message.slice(0, 400)); }
  }
  rep.calls = client.calls;
  const after = await client.remainingToday().catch(() => null);
  rep.remaining_after = after?.remaining ?? null;
  if (rep.errors.length) rep.ok = false;
  return rep;
}

/** Daily pass over live listings: oldest-checked first. */
export async function revisit(supabase: any, client: BrowseClient, o: { max?: number; concurrency?: number } = {}): Promise<Report> {
  const rep = emptyReport("revisit");
  const max = o.max ?? 150;
  try {
    const q = await client.remainingToday();
    rep.remaining_before = q?.remaining ?? null;
    const limit = Math.min(max, q ? q.remaining - 5 : 40);
    if (limit < 1) { rep.stopped = "quota"; return rep; }
    const live = mustWrite("live listings read", await supabase.from("vehicle_events")
      .select("id,vehicle_id,source_listing_id,source_url,current_price,metadata")
      .eq("source_platform", PLATFORM).eq("event_type", "listing").neq("event_status", "ended")
      .order("updated_at", { ascending: true }).limit(limit));
    const now = new Date().toISOString();
    await pool(live.data ?? [], o.concurrency ?? 3, async (row: any) => {
      const key = String(row.source_listing_id);
      const itemId = row.metadata?.item_id || `v1|${key}|0`;
      try {
        let raw: any = null, gone = false;
        try { raw = await client.getItem(itemId); } catch (e) { if (e instanceof ItemGone) gone = true; else throw e; }
        const pastEnd = raw?.itemEndDate && Date.parse(raw.itemEndDate) < Date.now();
        if (gone || pastEnd) {
          const patch = endedRow({ vehicle_id: row.vehicle_id, source_listing_id: key, source_url: row.source_url },
            { status: gone ? 404 : 200, observed_at: now, snapshot_id: null });
          const w = await writeVehicleEventByKey(supabase, { ...patch, source_platform: PLATFORM }, { sourceObservedAt: now });
          if (w.action === "error") rep.errors.push(`ended ${key}: ${w.error}`); else rep.landed++;
          return;
        }
        const price = Number(raw?.buyingOptions?.includes("AUCTION") ? raw?.currentBidPrice?.value : raw?.price?.value);
        const changed = Number.isFinite(price) && price > 0 && Number(row.current_price) !== price;
        const w = await writeVehicleEventByKey(supabase, {
          vehicle_id: row.vehicle_id, source_platform: PLATFORM, source_listing_id: key, source_url: row.source_url, event_type: "listing", updated_at: now,
          ...(changed ? { current_price: price } : {}),
          metadata: { last_checked_at: now, ...(changed ? { price_changed_at: now, price_before: row.current_price ?? null } : {}), bid_count: raw?.bidCount ?? null },
        }, { preserveEventStatus: true, sourceObservedAt: now });
        if (w.action === "error") rep.errors.push(`revisit ${key}: ${w.error}`);
        if (changed) {
          softWrite(`price log ${key}`, await supabase.from("vehicle_price_history").insert({
            vehicle_id: row.vehicle_id, price_type: "asking", value: price, source: PLATFORM, as_of: now, confidence: 70,
            proof_type: "listing", proof_url: row.source_url, notes: `ebay item ${key} revisit`,
          }), rep.errors);
          rep.ingest_matched++;   // counts price changes in the report
        }
      } catch (e) {
        if (e instanceof QuotaExceeded) throw e;
        rep.errors.push(`${key}: ${(e as Error).message}`.slice(0, 300));
      }
    });
  } catch (e) {
    if (e instanceof QuotaExceeded) rep.stopped = `quota: ${e.message}`;
    else { rep.ok = false; rep.errors.push((e as Error).message.slice(0, 400)); }
  }
  rep.calls = client.calls;
  if (rep.errors.length) rep.ok = false;
  return rep;
}
