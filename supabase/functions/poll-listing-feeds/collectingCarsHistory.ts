import { retainFetchedCapture } from "../_shared/archiveFetch.ts";
import { ledgerDecision, type LedgerKnown } from "./ledger.ts";

const ENDPOINT = "https://dora.production.collecting.com/multi_search";
// Publisher's existing public, search-only client key (same discovery owner).
const PUBLIC_SEARCH_KEY = "0I2WvLvRUeeHNaDV74u0KRlkLnhhgH9S";
const PLATFORM = "collecting-cars-history";
const PAGE_SIZE = 20;
const MAX_BYTES = 2_097_152;
const digest = async (value: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(v => v.toString(16).padStart(2, "0")).join("");
type Row = Record<string, any>;
type Capture = { id: string; sha256: string; read_at: string; after_id: number; ceiling_id: number; last_id: number; found: number };
const integer = (n: unknown, min = 0): n is number => Number.isSafeInteger(n) && Number(n) >= min;

export function collectingCarsHistorySearch(after: number, ceiling: number) {
  if (!integer(after) || !integer(ceiling, 1) || after > ceiling) throw Error("cc_history_cursor_invalid");
  return { collection: "production_listings", q: "*", query_by: "title", filter_by: `owningSite:=cars && auctionId:>${after} && auctionId:<=${ceiling}`,
    sort_by: "auctionId:asc", per_page: PAGE_SIZE, page: 1, exclude_fields: "embedding,embeddingPriceBand" };
}

function readPage(body: any, after: number, ceiling: number) {
  if (!body || !integer(body.found) || !Array.isArray(body.hits) || body.hits.length !== Math.min(body.found, PAGE_SIZE)) throw Error("cc_history_page_incomplete");
  let prior = after;
  const seen = new Set<string>();
  const lots = body.hits.map((hit: any) => {
    const d = hit?.document;
    if (!d || d.owningSite !== "cars" || !integer(d.auctionId, 1) || d.auctionId <= prior || d.auctionId > ceiling
      || typeof d.slug !== "string" || !/^[a-zA-Z0-9+-]+$/.test(d.slug) || seen.has(d.slug)) throw Error("cc_history_identity_invalid");
    prior = d.auctionId; seen.add(d.slug);
    return { id: d.auctionId as number, url: `https://collectingcars.com/for-sale/${d.slug}`, isCar: d.lotType === "car", document: d };
  });
  return { lots, found: body.found as number, lastId: prior };
}

/** One immutable page is drained through the existing full-listing ledger before the keyset advances. */
export async function prepareCollectingCarsHistory(db: any, feed: any, signal: AbortSignal, fetcher = fetch) {
  let config = feed.search_criteria ?? {};
  if (feed.source_slug !== "collecting-cars" || feed.enabled !== true || config.fetch_strategy !== "collecting_cars_history"
    || config.history_version !== 1 || "slug_year_min" in config || "slug_year_max" in config || !integer(config.history_pass ?? 1, 1)) throw Error("cc_history_config_invalid");
  const after = config.history_after_id ?? 0, ceiling = config.history_ceiling_id;
  const search = collectingCarsHistorySearch(after, ceiling);
  // Attribution URL contains the exact bounded query, never the client key.
  const sourceUrl = `${ENDPOINT}?${new URLSearchParams({ search: JSON.stringify(search) })}`;
  const checkpoint = async (next: Row) => {
    const saved = await db.from("listing_feeds").update({ search_criteria: next, updated_at: new Date().toISOString() })
      .eq("id", feed.id).eq("source_slug", "collecting-cars").eq("enabled", true)
      .eq("search_criteria", JSON.stringify(config)).select("id").abortSignal(AbortSignal.timeout(5000));
    if (saved.error || saved.data?.length !== 1 || saved.data[0].id !== feed.id) throw Error("cc_history_checkpoint_conflict");
    config = next;
  };
  let capture: Capture | null = config.history_capture ?? null, response: any;
  if (capture) {
    if (capture.after_id !== after || capture.ceiling_id !== ceiling || typeof capture.id !== "string"
      || !/^[0-9a-f-]{36}$/.test(capture.id) || !/^[a-f0-9]{64}$/.test(capture.sha256 ?? "")
      || !Number.isFinite(Date.parse(capture.read_at)) || Date.parse(capture.read_at) > Date.now()) throw Error("cc_history_capture_invalid");
    const held = await db.from("listing_page_snapshots").select("id,platform,listing_url,fetched_at,html,html_sha256,success,http_status")
      .eq("id", capture.id).abortSignal(signal).maybeSingle();
    const row = held.data;
    if (held.error || !row || row.platform !== PLATFORM || row.listing_url !== sourceUrl || row.success !== true || row.http_status !== 200
      || Date.parse(row.fetched_at) !== Date.parse(capture.read_at) || row.html_sha256 !== capture.sha256
      || typeof row.html !== "string" || new TextEncoder().encode(row.html).length > MAX_BYTES || await digest(row.html) !== capture.sha256)
      throw Error("cc_history_capture_unavailable");
    const envelope = JSON.parse(row.html);
    if (JSON.stringify(envelope.search) !== JSON.stringify(search) || envelope.read_at !== capture.read_at) throw Error("cc_history_capture_attribution_mismatch");
    response = envelope.response;
  } else {
    signal.throwIfAborted();
    const remote = await fetcher(ENDPOINT, { method: "POST", signal,
      headers: { "Content-Type": "application/json", "x-typesense-api-key": PUBLIC_SEARCH_KEY }, body: JSON.stringify({ searches: [search] }) }); // guardrail-allow: raw-fetch (existing public search API)
    if (!remote.ok) throw Error(`cc_history_source_http_${remote.status}`);
    const raw = await remote.text();
    if (new TextEncoder().encode(raw).length > MAX_BYTES) throw Error("cc_history_page_oversized");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.results) || parsed.results.length !== 1) throw Error("cc_history_response_invalid");
    response = parsed.results[0];
    const page = readPage(response, after, ceiling), readAt = new Date().toISOString();
    // The capture helper's insert and readback share the bounded preparation deadline.
    const captureDb = { storage: db.storage, from: (table: string) => new Proxy(db.from(table), { get(target, name) {
      const member = target[name];
      return typeof member !== "function" ? member : (...args: unknown[]) => {
        const next = member.apply(target, args); return next?.abortSignal ? next.abortSignal(signal) : next;
      };
    } }) };
    const retained = await retainFetchedCapture(captureDb, { platform: PLATFORM, url: sourceUrl,
      html: JSON.stringify({ search, read_at: readAt, response }), fetchedAt: readAt, httpStatus: 200,
      metadata: { capture_kind: "collecting_cars_history_index", representation: "native_search_response_with_request", excluded_fields: ["embedding", "embeddingPriceBand"] } });
    if ("reason" in retained) throw Error(`cc_history_retention_failed:${retained.reason}`);
    capture = { id: retained.snapshot_id, sha256: retained.html_sha256, read_at: retained.fetched_at,
      after_id: after, ceiling_id: ceiling, last_id: page.lastId, found: page.found };
    await checkpoint({ ...config, history_capture: capture });
  }
  const page = readPage(response, after, ceiling);
  if (capture.last_id !== page.lastId || capture.found !== page.found) throw Error("cc_history_capture_population_mismatch");
  // Preserve discovery of every source lot type, without making a non-car vehicle.
  if (page.lots.length) {
    const stored = await db.from("source_targets").upsert(page.lots.map((lot: any) => ({ source_slug: "collecting-cars",
      listing_url: lot.url, last_seen_at: capture!.read_at, card_observed_at: capture!.read_at,
      card_year: /^\d{4}$/.test(String(lot.document.productYear ?? "")) ? Number(lot.document.productYear) : null })), { onConflict: "listing_url", ignoreDuplicates: true }).abortSignal(signal);
    if (stored.error) throw Error("cc_history_discovery_unacknowledged");
    const discovered = await db.from("source_targets").select("listing_url").eq("source_slug", "collecting-cars")
      .in("listing_url", page.lots.map((lot: any) => lot.url)).abortSignal(signal);
    if (discovered.error || !Array.isArray(discovered.data) || discovered.data.length !== page.lots.length
      || new Set(discovered.data.map((row: any) => row.listing_url)).size !== page.lots.length
      || discovered.data.some((row: any) => !page.lots.some((lot: any) => lot.url === row.listing_url))) throw Error("cc_history_discovery_unacknowledged");
  }
  const urls: string[] = page.lots.filter((lot: any) => lot.isCar).map((lot: any) => lot.url);
  const receipt: Row = { scope: "publisher_search_index_fixed_cohort", ceiling_id: ceiling, after_id: after, page_lots: page.lots.length,
    car_lots: urls.length, noncar_lots_unresolved: page.lots.length - urls.length, source_read_at: capture.read_at,
    remaining_index_hits_at_read: page.found, completion_semantics: "keyset traversal only; full-population capture reconciliation is separate",
    capture_id: capture.id, pass: config.history_pass ?? 1, discovery_complete: config.history_discovery_complete === true,
    coverage: "Current publisher index only; delisted or absent historical lots unknown. Non-car discovery is not canonical ingestion." };
  return { urls, receipt, async finish(ledger: Map<string, LedgerKnown>, outcomes: Row[]) {
    const ack = new Set(outcomes.filter(row => row.ledger_write_status === "acknowledged" && ["complete", "skipped", "failed"].includes(row.ledger)).map(row => row.url));
    const pending = urls.filter(url => !ack.has(url) && !["settled", "backoff"].includes(ledgerDecision(ledger.get(url), new Date())));
    receipt.page_unattempted_or_unacknowledged = pending.length;
    receipt.failed_or_backing_off = urls.filter(url => ledger.get(url)?.status === "failed" || outcomes.some(row => row.url === url && row.ledger === "failed")).length;
    if (pending.length) return;
    const end = page.found === page.lots.length || page.lastId === ceiling;
    await checkpoint({ ...config, history_after_id: end ? 0 : page.lastId, history_capture: null,
      history_discovery_complete: config.history_discovery_complete === true || end,
      history_pass: (config.history_pass ?? 1) + (end ? 1 : 0) });
    receipt.page_advanced = true; receipt.discovery_complete = config.history_discovery_complete;
    receipt.next_after_id = config.history_after_id;
    // Subsequent passes reconcile current-index retry debt. Known full captures do not expire here.
    // A correction/version upgrade and withdrawal policy are separate from first-capture completion.
  } };
}
