/** Project retained aggregate CC testimony into its existing auction episode owner. */
import { normalizeListingUrlKey } from "../_shared/listingUrl.ts";
import { writeVehicleEventByKey } from "../_shared/vehicleEventWrite.ts";
import type { ObservationPost } from "./boards.ts";
import type { CcNativeCapture } from "./ccBidCapture.ts";

const METHOD = "cc_typesense_board_bid_v1";
const PLATFORM = "collecting_cars";
const hash = async (body: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)))].map(b => b.toString(16).padStart(2, "0")).join("");
const endOf = (d: any) => typeof d?.dtStageEndsUTC === "string" ? Date.parse(d.dtStageEndsUTC.replace(" ", "T") + "Z") : NaN;
function nativeMatches(d: any, p: ObservationPost) {
  const f = p.structured_data;
  return d?.lotType === "car" && d.stage === "live" && p.source_url === `https://collectingcars.com/for-sale/${d.slug}`
    && String(d.auctionId) === f.auction_id && d.currentBid === f.amount && (d.noBids ?? null) === f.bid_count
    && typeof d.currencyCode === "string" && d.currencyCode.toUpperCase() === f.currency
    && Number.isFinite(endOf(d)) && endOf(d) === Date.parse(String(f.ends));
}
export async function ccEpisodeRow(p: ObservationPost, native: CcNativeCapture | undefined, o: any, s: any, now: number) {
  const fail = () => { throw Error("CC episode testimony/identity/capture parity refused"); };
  const f = p.structured_data, capture = o?.extraction_metadata?.source_capture;
  if (p.source_slug !== "collecting-cars" || p.kind !== "bid" || p.extraction_method !== METHOD
    || !nativeMatches(native?.document, p) || Date.parse(native?.receivedAt ?? "") !== Date.parse(p.observed_at)
    || !o || o.kind !== "bid" || o.is_superseded !== false || o.extraction_method !== METHOD
    || o.vehicle_id !== p.vehicle_id || o.source_url !== p.source_url || o.source_identifier !== p.source_identifier
    || ["amount", "currency", "bid_count", "auction_id", "ends", "clock"].some(k => o.structured_data?.[k] !== f[k])
    || !Number.isFinite(Date.parse(o.observed_at)) || Date.parse(o.observed_at) > Date.parse(p.observed_at)
    || Date.parse(p.observed_at) > now || Date.parse(String(f.ends)) <= now
    || !s || o.raw_source_ref !== `listing_page_snapshots:${s.id}` || s.platform !== "collecting-cars"
    || s.listing_url !== p.source_url || s.success !== true || s.http_status !== 200
    || s.metadata?.capture_kind !== "typesense_native_document"
    || s.metadata?.representation !== "complete_selected_document_json_not_wire_response"
    || capture?.snapshot_id !== s.id || capture?.html_sha256 !== s.html_sha256 || capture?.source_url !== p.source_url
    || Date.parse(capture?.fetched_at) !== Date.parse(o.observed_at) || Date.parse(s.fetched_at) !== Date.parse(o.observed_at)
    || typeof s.html !== "string" || new TextEncoder().encode(s.html).length > 2_097_152
    || await hash(s.html) !== s.html_sha256 || !nativeMatches(JSON.parse(s.html), p)) fail();
  return { vehicle_id: p.vehicle_id, source_platform: PLATFORM, source_listing_id: normalizeListingUrlKey(p.source_url),
    source_url: p.source_url, event_type: "auction", event_status: "active", current_price: f.amount,
    high_bid: Number(f.bid_count) > 0 ? f.amount : null, bid_count: f.bid_count, currency_code: f.currency, ended_at: f.ends,
    metadata: { auction_observation_id: o.id, source_observed_at: o.observed_at,
      auction_snapshot_id: s.id, raw_source_ref: o.raw_source_ref, capture_kind: "auction_bid_snapshot",
      listing_ends_at: f.ends, auction_id: f.auction_id, source_event_time: null, source_capture: capture } };
}

export async function projectCcEpisodes(db: any, posts: ObservationPost[], nativeOf: Map<string, CcNativeCapture | undefined>, deadline: number,
  writer = writeVehicleEventByKey) {
  const out = { candidates: posts.length, projected: 0, unchanged: 0, deferred: 0, refused: 0, errors: [] as string[] };
  const signal = () => { if (Date.now() >= deadline) throw Error("CC episode deadline"); return AbortSignal.timeout(Math.max(1, Math.min(5000, deadline - Date.now()))); };
  if (!posts.length) return out;
  if (Date.now() >= deadline - 2000) { out.deferred = posts.length; return out; }
  try {
    const src = await db.from("observation_sources").select("id").eq("slug", "collecting-cars").maybeSingle().abortSignal(signal());
    if (src.error || !src.data?.id) throw Error("CC canonical source unavailable");
    const observations = new Map<string, any[]>(), events = new Map<string, any[]>();
    for (let i = 0; i < posts.length; i += 100) {
      const chunk = posts.slice(i, i + 100);
      const [obs, ep] = await Promise.all([
        db.from("vehicle_observations").select("id,vehicle_id,source_identifier,source_url,kind,extraction_method,observed_at,structured_data,raw_source_ref,extraction_metadata,is_superseded")
          .eq("source_id", src.data.id).eq("kind", "bid").eq("is_superseded", false).in("source_identifier", chunk.map(p => p.source_identifier)).limit(1000).abortSignal(signal()),
        db.from("vehicle_events").select("vehicle_id,source_listing_id,source_url,event_type,event_status,current_price,high_bid,currency_code,bid_count,ended_at,sold_at,identity_check,source_suspect,metadata")
          .eq("source_platform", PLATFORM).in("source_listing_id", chunk.map(p => normalizeListingUrlKey(p.source_url))).limit(1000).abortSignal(signal()),
      ]);
      if (obs.error || ep.error || obs.data?.length === 1000 || ep.data?.length === 1000) throw Error("CC episode bounded ownership read failed");
      for (const o of obs.data ?? []) observations.set(o.source_identifier, [...(observations.get(o.source_identifier) ?? []), o]);
      for (const e of ep.data ?? []) events.set(e.source_listing_id, [...(events.get(e.source_listing_id) ?? []), e]);
    }
    let attempts = 0;
    for (const p of [...posts].sort((a, b) => Date.parse(String(a.structured_data.ends)) - Date.parse(String(b.structured_data.ends)))) {
      const rows = observations.get(p.source_identifier) ?? [], episodes = events.get(normalizeListingUrlKey(p.source_url)!) ?? [];
      const o = rows.length === 1 ? rows[0] : null;
      if (!o?.raw_source_ref?.startsWith("listing_page_snapshots:")) { out.deferred++; continue; }
      if (episodes.length > 1 || episodes.some(e => e.vehicle_id !== p.vehicle_id || e.source_url !== p.source_url || e.event_type !== "auction")) { out.refused++; continue; }
      const e = episodes[0];
      if (e && (!['active', 'live'].includes(e.event_status) || e.sold_at != null
        || e.identity_check === 'mismatch' || (e.source_suspect?.length ?? 0) > 0
        || Date.parse(String(e.metadata?.source_observed_at)) > Date.parse(o.observed_at))) { out.refused++; continue; }
      if (e?.metadata?.auction_observation_id === o.id && Number(e.current_price) === p.structured_data.amount
        && (Number(p.structured_data.bid_count) > 0 ? Number(e.high_bid) === p.structured_data.amount : e.high_bid == null)
        && e.currency_code === p.structured_data.currency && e.bid_count === p.structured_data.bid_count
        && Date.parse(e.ended_at) === Date.parse(String(p.structured_data.ends))) { out.unchanged++; continue; }
      if (attempts >= 20 || Date.now() >= deadline - 2000) { out.deferred++; continue; }
      attempts++;
      try {
        const snapshotId = o.raw_source_ref.slice("listing_page_snapshots:".length);
        if (!/^[0-9a-f-]{36}$/i.test(snapshotId)) throw Error("CC snapshot reference invalid");
        const [raw, owner] = await Promise.all([
          db.from("listing_page_snapshots").select("id,platform,listing_url,fetched_at,html,html_sha256,http_status,success,metadata").eq("id", snapshotId).maybeSingle().abortSignal(signal()),
          db.from("vehicles").select("id,listing_url,status,deleted_at,merged_into_vehicle_id").eq("id", p.vehicle_id).maybeSingle().abortSignal(signal()),
        ]);
        if (raw.error || owner.error || !owner.data || owner.data.deleted_at || owner.data.merged_into_vehicle_id
          || owner.data.status === "merged" || owner.data.listing_url !== p.source_url) throw Error("CC current listing owner refused");
        const row = await ccEpisodeRow(p, nativeOf.get(p.source_url), o, raw.data, Date.now());
        const bounded = { from: (table: string) => ({
          select: (columns: string) => db.from(table).select(columns).abortSignal(signal()),
          insert: (value: any) => db.from(table).insert(value).abortSignal(signal()),
          update: (value: any) => db.from(table).update(value).abortSignal(signal()),
        }) };
        const result = await writer(bounded, row, { writer: "sync-live-auctions:cc-canonical-snapshot", preserveEventStatus: true,
          sourceObservedAt: o.observed_at, compactMetadataCas: true, activeAuction: { sourceUrl: p.source_url, now: new Date().toISOString() } });
        if (result.action === "error") throw Error(result.error);
        if (result.action === "skipped") out.deferred++; else out.projected++;
      } catch (err) { out.refused++; out.errors.push(String((err as Error).message).slice(0, 200)); }
    }
  } catch (err) { out.errors.push(String((err as Error).message).slice(0, 200)); out.deferred = posts.length - out.projected - out.unchanged - out.refused; }
  return out;
}
