import { retainFetchedCapture } from "../_shared/archiveFetch.ts";
import { ledgerDecision, type LedgerKnown } from "./ledger.ts";

type Row = Record<string, any>;
type Control = { get(): Row; checkpoint(next: Row): Promise<void> };
const SITEMAPS = Array.from({ length: 5 }, (_, i) => `https://collectingcars.com/sitemap-listings-${i + 1}.xml`);
const PLATFORM = "collecting-cars-history-sitemap";
const MAX_BYTES = 2_097_152;
const URL_RE = /^https:\/\/collectingcars\.com\/for-sale\/[a-zA-Z0-9+-]+\/?$/;
function discoveryUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const u = new URL(value);
    return u.origin === "https://collectingcars.com" && !u.username && !u.password && !u.search && !u.hash
      && /^\/for-sale\/[^/]+\/?$/.test(u.pathname) && !/[\s\x00-\x1f]/.test(value);
  } catch { return false; }
}
const integer = (v: unknown, min = 0): v is number => Number.isSafeInteger(v) && Number(v) >= min;
const hash = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map(n => n.toString(16).padStart(2, "0")).join("");
const clock = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v)) && Date.parse(v) <= Date.now();

/** Publisher sitemap membership is discovery, never an auction state or vehicle identity. */
export function collectingCarsSitemapUrls(xml: string): string[] {
  if (!xml.includes("<urlset") || !xml.includes("</urlset>") || /<!DOCTYPE|<!ENTITY/i.test(xml)
    || new TextEncoder().encode(xml).byteLength > MAX_BYTES) throw Error("cc_sitemap_body_invalid");
  const locs = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map(m => m[1].trim());
  if (!locs.length || locs.some(url => !discoveryUrl(url))) throw Error("cc_sitemap_location_invalid");
  return [...new Set(locs.map(url => url.replace(/\/$/, "")))];
}

/** Curated retained discovery is URL membership only, never native auction testimony. */
export async function admitCollectingCarsRetainedDiscovery(db: any, control: Control, signal: AbortSignal) {
  const manifest = control.get().history_retained_discovery;
  if (manifest == null) return null;
  signal.throwIfAborted();
  if (manifest.version !== 1 || !/^[0-9a-f]{64}$/.test(manifest.origin_sha256 ?? "")
    || !clock(manifest.discovered_at) || !Array.isArray(manifest.urls) || manifest.urls.length < 1 || manifest.urls.length > 20
    || manifest.urls.some((url: unknown) => typeof url !== "string" || !URL_RE.test(url) || url.endsWith("/"))
    || new Set(manifest.urls).size !== manifest.urls.length
    || Object.keys(manifest).some(key => !["version", "origin_sha256", "discovered_at", "urls"].includes(key)))
    throw Error("cc_retained_discovery_manifest_invalid");
  const fingerprint = await hash(JSON.stringify([manifest.version, manifest.origin_sha256, manifest.discovered_at, manifest.urls]));
  const receipt = { scope: "retained_discovery_manifest", origin_sha256: manifest.origin_sha256,
    discovered_at: manifest.discovered_at, source_read_at: null, candidate_urls: manifest.urls.length,
    coverage: "Retained URL discovery only; file provenance is operator-supplied. Native identity, car classification and capture remain unverified." };
  if (control.get().history_retained_discovery_ack === fingerprint) return { ...receipt, acknowledged: true, discovery_slots_used: 0 };
  const write = await db.from("source_targets").upsert(manifest.urls.map((listing_url: string) => ({
    source_slug: "collecting-cars", listing_url, sitemap_file: `retained-discovery:sha256:${manifest.origin_sha256}`,
    last_seen_at: new Date().toISOString(),
  })), { onConflict: "listing_url", ignoreDuplicates: true }).abortSignal(signal);
  if (write.error) throw Error("cc_retained_discovery_write_failed");
  const read = await db.from("source_targets").select("listing_url,source_slug").in("listing_url", manifest.urls).abortSignal(signal);
  if (read.error || read.data?.length !== manifest.urls.length
    || new Set(read.data.map((row: Row) => row.listing_url)).size !== manifest.urls.length
    || read.data.some((row: Row) => row.source_slug !== "collecting-cars" || !manifest.urls.includes(row.listing_url)))
    throw Error("cc_retained_discovery_unacknowledged");
  await control.checkpoint({ ...control.get(), history_retained_discovery_ack: fingerprint });
  return { ...receipt, acknowledged: true, discovery_slots_used: manifest.urls.length };
}

/** One retained XML file, <=100 shared durable discoveries per invocation. No paid renderer or fallback. */
export async function discoverCollectingCarsSitemap(db: any, control: Control, signal: AbortSignal, fetcher = fetch, discoveryLimit = 100) {
  if (!integer(discoveryLimit, 1) || discoveryLimit > 100) throw Error("cc_sitemap_discovery_limit_invalid");
  let c = control.get();
  const file = c.history_sitemap_index ?? 0, offset = c.history_sitemap_offset ?? 0;
  if (!integer(file) || file >= SITEMAPS.length || !integer(offset)) throw Error("cc_sitemap_cursor_invalid");
  const url = SITEMAPS[file];
  let capture = c.history_sitemap_capture, xml: string;
  if (capture) {
    if (capture.url !== url || typeof capture.id !== "string" || !/^[a-f0-9-]{36}$/.test(capture.id)
      || !/^[a-f0-9]{64}$/.test(capture.sha256 ?? "") || !clock(capture.read_at)) throw Error("cc_sitemap_capture_invalid");
    const read = await db.from("listing_page_snapshots").select("id,platform,listing_url,html,html_sha256,fetched_at,success,http_status")
      .eq("id", capture.id).abortSignal(signal).maybeSingle();
    const row = read.data;
    if (read.error || !row || row.id !== capture.id || row.platform !== PLATFORM || row.listing_url !== url
      || row.success !== true || row.http_status !== 200 || row.html_sha256 !== capture.sha256
      || Date.parse(row.fetched_at) !== Date.parse(capture.read_at) || typeof row.html !== "string"
      || new TextEncoder().encode(row.html).byteLength > MAX_BYTES || await hash(row.html) !== capture.sha256)
      throw Error("cc_sitemap_retained_body_unavailable");
    xml = row.html;
  } else {
    if (offset !== 0) throw Error("cc_sitemap_capture_missing");
    const acquisitionSignal = AbortSignal.any([signal, AbortSignal.timeout(4000)]);
    try {
      const response = await fetcher(url, { signal: acquisitionSignal, redirect: "error" }); // guardrail-allow: raw-fetch (fixed public XML sitemap; raw response retained before discovery)
      if (response.status !== 200) throw Error(`cc_sitemap_http_${response.status}`);
      const advertised = Number(response.headers.get("content-length"));
      if (Number.isFinite(advertised) && advertised > MAX_BYTES) throw Error("cc_sitemap_oversized");
      if (!response.body) throw Error("cc_sitemap_body_missing");
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let bytes = 0; xml = "";
      try {
        for (;;) {
          acquisitionSignal.throwIfAborted();
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > MAX_BYTES) { await reader.cancel(); throw Error("cc_sitemap_oversized"); }
          xml += decoder.decode(part.value, { stream: true });
        }
        xml += decoder.decode();
      } finally { reader.releaseLock(); }
      collectingCarsSitemapUrls(xml);
    } catch (error) {
      // Source acquisition is independent of already retained inventory. Persistence/CAS failures below remain fatal.
      const code = error instanceof Error && /^cc_sitemap_(?:http_\d{3}|oversized|body_missing|body_invalid|location_invalid)$/.test(error.message)
        ? error.message : "cc_sitemap_acquisition_unavailable";
      return { scope: "retained_publisher_sitemap_discovery", status: "unavailable", source_url: url,
        attempted_at: new Date().toISOString(), reason: code, source_read_at: null, capture_id: null,
        discovered_urls: 0, retained_file_urls: null, next_offset: offset,
        coverage: "Sitemap acquisition unavailable; existing inventory intake may proceed. Source membership is unmeasured." };
    }
    const ack = await retainFetchedCapture(db, { platform: PLATFORM, url, html: xml, httpStatus: 200,
      fetchedAt: new Date().toISOString(), metadata: { capture_kind: "publisher_sitemap", representation: "raw_xml", discovery_only: true } });
    if ("reason" in ack) throw Error(`cc_sitemap_retention_failed:${ack.reason}`);
    capture = { id: ack.snapshot_id, sha256: ack.html_sha256, read_at: ack.fetched_at, url };
    await control.checkpoint({ ...control.get(), history_sitemap_capture: capture });
  }
  const urls = collectingCarsSitemapUrls(xml);
  if (offset > urls.length) throw Error("cc_sitemap_offset_invalid");
  const page = urls.slice(offset, offset + discoveryLimit);
  if (page.length) {
    const write = await db.from("source_targets").upsert(page.map(listing_url => ({ source_slug: "collecting-cars", listing_url,
      sitemap_file: url, last_seen_at: capture.read_at })), { onConflict: "listing_url", ignoreDuplicates: true }).abortSignal(signal);
    if (write.error) throw Error("cc_sitemap_discovery_write_failed");
    // Match the existing feed ledger's bounded URL-IN batches; long native slugs must not overflow the request line.
    for (let start = 0; start < page.length; start += 40) {
      const batch = page.slice(start, start + 40);
      const read = await db.from("source_targets").select("listing_url,source_slug").in("listing_url", batch).abortSignal(signal);
      if (read.error || read.data?.length !== batch.length || new Set(read.data.map((r: Row) => r.listing_url)).size !== batch.length
        || read.data.some((r: Row) => r.source_slug !== "collecting-cars" || !batch.includes(r.listing_url))) throw Error("cc_sitemap_discovery_unacknowledged");
    }
  }
  const end = offset + page.length === urls.length;
  c = control.get();
  await control.checkpoint({ ...c, history_sitemap_offset: end ? 0 : offset + page.length,
    history_sitemap_index: end ? (file + 1) % SITEMAPS.length : file,
    history_sitemap_capture: end ? null : capture });
  return { scope: "retained_publisher_sitemap_discovery", source_url: url, source_read_at: capture.read_at,
    capture_id: capture.id, discovered_urls: page.length, retained_file_urls: urls.length, next_offset: end ? 0 : offset + page.length,
    coverage: "Membership only; native listing classification and canonical capture remain separate. No all-time completeness claim." };
}

/** Retry native failures even if their URL is no longer in the current publisher index. */
export async function readCollectingCarsRetry(db: any, control: Control, signal: AbortSignal) {
  const now = new Date(), cursor = control.get().history_retry_scan_after;
  let query = db.from("import_queue").select("listing_url,status,attempts,max_attempts,next_attempt_at,created_at,raw_data,error_message")
    .eq("status", "failed").lte("next_attempt_at", now.toISOString()).like("listing_url", "https://collectingcars.com/for-sale/%")
    .eq("raw_data->>collecting_cars_native_version", "cc_native_listing_v1");
  if (cursor) {
    if (!clock(cursor.next_attempt_at) || !Number.isFinite(Date.parse(cursor.created_at ?? "")) || !discoveryUrl(cursor.listing_url))
      throw Error("cc_history_retry_cursor_invalid");
    const at = JSON.stringify(cursor.next_attempt_at), created = JSON.stringify(cursor.created_at), url = JSON.stringify(cursor.listing_url);
    query = query.or(`next_attempt_at.gt.${at},and(next_attempt_at.eq.${at},created_at.gt.${created}),and(next_attempt_at.eq.${at},created_at.eq.${created},listing_url.gt.${url})`);
  }
  const read = await query.order("next_attempt_at").order("created_at").order("listing_url").limit(20).abortSignal(signal);
  if (read.error || !Array.isArray(read.data)) throw Error("cc_history_retry_read_unavailable");
  let selected: { url: string; identity: { auctionId: number; stage: string } | null } | null = null, inspected: Row | null = null;
  for (const row of read.data) {
    if (!clock(row.next_attempt_at) || !Number.isFinite(Date.parse(row.created_at ?? "")) || !discoveryUrl(row.listing_url))
      throw Error("cc_history_retry_row_invalid");
    inspected = row;
    if (!URL_RE.test(row.listing_url) || row.raw_data?.collecting_cars_native_version !== "cc_native_listing_v1"
      || ledgerDecision(row, now) !== "retry") continue;
    const identity = row.raw_data?.collecting_cars_history_identity;
    const qualified = identity && integer(identity.auctionId, 1) && ["sold", "unsold", "live", "upcoming", "comingsoon"].includes(identity.stage);
    // A previous custody refusal cannot become permission for fresh acquisition by losing its index witness.
    if (String(row.error_message ?? "").startsWith("cc_replay_preflight:") && !qualified) continue;
    selected = { url: row.listing_url, identity: qualified ? { auctionId: identity.auctionId, stage: identity.stage } : null };
    break;
  }
  // Preserve progress across ineligible rows; the ledger remains authoritative, not this scan cursor.
  const exhausted = !inspected || (read.data.length < 20 && inspected === read.data.at(-1));
  const next = exhausted ? null : { next_attempt_at: inspected!.next_attempt_at, created_at: inspected!.created_at, listing_url: inspected!.listing_url };
  if (cursor || next) await control.checkpoint({ ...control.get(), history_retry_scan_after: next });
  return selected;
}

/** A fixed <=20 target page. Registry read_at is an instrumentation clock, not a publisher observation. */
export async function prepareCollectingCarsTargets(db: any, control: Control, signal: AbortSignal) {
  const c = control.get(), after = c.history_targets_after_id ?? 0;
  if (!integer(after)) throw Error("cc_history_target_cursor_invalid");
  let page = c.history_targets_page;
  if (!page) {
    const read = await db.from("source_targets").select("id,listing_url,source_slug,sitemap_file,last_seen_at")
      .eq("source_slug", "collecting-cars").gt("id", after).order("id").limit(20).abortSignal(signal);
    if (read.error || !Array.isArray(read.data)) throw Error("cc_history_targets_unavailable");
    page = { after_id: after, read_at: new Date().toISOString(), rows: read.data };
    validateTargets(page, after);
    await control.checkpoint({ ...control.get(), history_targets_page: page });
  } else validateTargets(page, after);
  if (page.rows.length) {
    const read = await db.from("source_targets").select("id,listing_url,source_slug").in("id", page.rows.map((r: Row) => r.id)).abortSignal(signal);
    if (read.error || read.data?.length !== page.rows.length || read.data.some((r: Row) => r.source_slug !== "collecting-cars"
      || !page.rows.some((p: Row) => p.id === r.id && p.listing_url === r.listing_url))) throw Error("cc_history_target_ownership_changed");
  }
  const urls: string[] = [...new Set<string>(page.rows.filter((r: Row) => URL_RE.test(r.listing_url)).map((r: Row) => r.listing_url.replace(/\/$/, "")))];
  const receipt: Row = { scope: "retained_discovery_targets", registry_read_at: page.read_at, target_rows: page.rows.length, intake_eligible_urls: urls.length,
    unsupported_route_unresolved: page.rows.filter((r: Row) => !URL_RE.test(r.listing_url)).length,
    after_id: after, classification: "unknown until native capture", coverage: "Discovered URLs are not proven cars, captures or complete all-time inventory." };
  return { urls, identities: new Map<string, { auctionId: number; stage: string | null }>(), freshClassificationUrls: new Set(urls), receipt,
    async finish(ledger: Map<string, LedgerKnown>, outcomes: Row[]) {
      const ack = new Set(outcomes.filter(r => r.ledger_write_status === "acknowledged" && ["complete", "skipped", "failed"].includes(r.ledger)).map(r => r.url));
      const pending = urls.filter(url => !ack.has(url) && !["settled", "backoff"].includes(ledgerDecision(ledger.get(url), new Date())));
      receipt.page_unattempted_or_unacknowledged = pending.length;
      receipt.failed_or_backing_off = urls.filter(url => ledger.get(url)?.status === "failed" || outcomes.some(r => r.url === url && r.ledger === "failed")).length;
      receipt.unresolved_skipped = urls.filter(url => ledger.get(url)?.status === "skipped" || outcomes.some(r => r.url === url && r.ledger === "skipped")).length;
      if (pending.length) return;
      await control.checkpoint({ ...control.get(), history_targets_after_id: page.rows.length < 20 ? 0 : page.rows.at(-1).id,
        history_targets_page: null, history_phase: "index" });
      receipt.page_advanced = true;
    } };
}

function validateTargets(page: Row, after: number) {
  if (!page || page.after_id !== after || !clock(page.read_at) || !Array.isArray(page.rows) || page.rows.length > 20) throw Error("cc_history_target_page_invalid");
  let prior = after;
  const seen = new Set<string>();
  for (const r of page.rows) {
    if (!integer(r.id, 1) || r.id <= prior || r.source_slug !== "collecting-cars" || !discoveryUrl(r.listing_url) || seen.has(r.listing_url))
      throw Error("cc_history_target_identity_invalid");
    prior = r.id; seen.add(r.listing_url);
  }
}
