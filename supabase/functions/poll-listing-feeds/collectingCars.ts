import { ledgerDecision, type IngestPlan, type LedgerKnown } from "./ledger.ts";

export const CC_LISTING_METHOD = "cc_native_listing_v1";
const SOURCE = "collecting-cars";
const PAGE = 200;
const MAX_LOTS = 2000;
const MAX_INVENTORY_AGE_MS = 30 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface CollectingCarsReceipt {
  observation_id: string; snapshot_id: string; source_read_at: string; images: number;
  country_corrected?: boolean; duplicate?: boolean;
}
export function collectingCarsReceipt(value: any, now = Date.now()): CollectingCarsReceipt | null {
  const at = Date.parse(value?.source_read_at ?? "");
  return value && UUID.test(value.observation_id ?? "") && UUID.test(value.snapshot_id ?? "")
    && Number.isFinite(at) && at <= now && Number.isInteger(value.images) && value.images >= 0
    ? { observation_id: value.observation_id, snapshot_id: value.snapshot_id, source_read_at: value.source_read_at,
      images: value.images, ...(typeof value.country_corrected === "boolean" ? { country_corrected: value.country_corrected } : {}),
      ...(typeof value.duplicate === "boolean" ? { duplicate: value.duplicate } : {}) } : null;
}
export function collectingCarsAdmissionMatches(receipt: CollectingCarsReceipt, observation: any,
  url: string, vehicleId: string, sourceId: string): boolean {
  return observation?.id === receipt.observation_id && observation.vehicle_id === vehicleId
    && observation.source_id === sourceId && observation.source_url === url && observation.kind === "listing"
    && observation.extraction_method === CC_LISTING_METHOD && observation.is_superseded === false
    && observation.raw_source_ref === `listing_page_snapshots:${receipt.snapshot_id}`
    && Date.parse(observation.observed_at) === Date.parse(receipt.source_read_at);
}
export const CC_OBSERVATION_COLUMNS = "id,vehicle_id,source_id,source_url,kind,extraction_method,is_superseded,raw_source_ref,observed_at";

/** Full listing admission, not a board price/vehicle shell, settles a URL. Failed attempts retain their existing limits. */
export function prepareCollectingCarsLedger(urls: string[], ledger: Map<string, LedgerKnown>, raw: Map<string, any>,
  observations: Map<string, any>, sourceId: string, intervalMinutes: number, now = Date.now(), refreshes = new Map<string, number>()): Set<string> {
  const proved = new Set<string>();
  for (const url of urls) {
    const prior = ledger.get(url);
    if (!prior || prior.status === "failed") continue;
    const metadata = raw.get(url) ?? {};
    if (prior.status === "skipped" && metadata.collecting_cars_native_version === CC_LISTING_METHOD) continue;
    const receipt = collectingCarsReceipt(metadata.collecting_cars_receipt, now);
    const valid = receipt && prior.vehicle_id && collectingCarsAdmissionMatches(receipt,
      observations.get(receipt.observation_id), url, prior.vehicle_id, sourceId);
    if (valid && now - Date.parse(receipt.source_read_at) < intervalMinutes * 60_000) proved.add(url);
    else if (prior.status === "complete" || prior.status === "skipped") {
      if (valid) refreshes.set(url, Date.parse(receipt.source_read_at));
      ledger.delete(url);
    }
  }
  return proved;
}

/** Polling cadence controls discovery, not how often an already captured full listing is fetched. */
export function collectingCarsCaptureInterval(criteria: any): number {
  const minutes = criteria?.full_capture_interval_minutes;
  return Number.isInteger(minutes) && minutes > 0 ? minutes : 1440;
}

/** Give a due failure the first actual execution slot; uncaptured lots precede optional refreshes. */
export function planCollectingCarsIngests(urls: string[], ledger: Map<string, LedgerKnown>,
  refreshes: Map<string, number>, now: Date, cap: number): IngestPlan {
  const missing: string[] = [], retries: string[] = [], stale: string[] = [];
  let settled = 0, backoff = 0;
  for (const url of urls) {
    const decision = ledgerDecision(ledger.get(url), now);
    if (decision === "settled") settled++;
    else if (decision === "backoff") backoff++;
    else if (decision === "retry") retries.push(url);
    else if (refreshes.has(url)) stale.push(url);
    else missing.push(url);
  }
  const retryClock = (url: string) => {
    const row = ledger.get(url);
    for (const value of [row?.next_attempt_at, row?.processed_at]) {
      const at = Date.parse(value ?? "");
      if (Number.isFinite(at)) return at;
    }
    return 0;
  };
  retries.sort((a, b) => retryClock(a) - retryClock(b));
  stale.sort((a, b) => refreshes.get(a)! - refreshes.get(b)!);
  const limit = Number.isInteger(cap) && cap > 0 ? cap : 0;
  return { toIngest: [...retries.slice(0, 1), ...missing, ...retries.slice(1), ...stale].slice(0, limit),
    fresh: missing.length, retries: retries.length, settled, backoff };
}

/** Reuse one complete retained board batch. This is inventory-recorded time, never a native bid clock. */
export async function readCollectingCarsInventory(supabase: any, now: number, signal: AbortSignal) {
  const source = await supabase.from("live_auction_sources")
    .select("id,last_successful_sync,last_sync_error,scraping_config").eq("slug", SOURCE).abortSignal(signal).maybeSingle();
  if (source.error || !source.data) throw Error("retained_inventory_source_unavailable");
  const run = source.data.scraping_config?.live_board?.last_run;
  const clock = Date.parse(run?.at ?? "");
  if (!UUID.test(source.data.id) || run?.complete !== true || source.data.last_sync_error
    || !Number.isInteger(run?.lots) || run.lots < 0 || run.lots > MAX_LOTS || run.upserted !== run.lots
    || !Number.isFinite(clock) || clock > now || now - clock > MAX_INVENTORY_AGE_MS
    || Date.parse(source.data.last_successful_sync) !== clock) throw Error("retained_inventory_not_current_complete");
  const rows: any[] = [];
  let pages = 0;
  for (let offset = 0; offset < run.lots; offset += PAGE) {
    const read = await supabase.from("monitored_auctions")
      .select("id,external_auction_id,external_auction_url,auction_end_time,is_live,last_synced_at,board:stream_state->>board")
      .eq("source_id", source.data.id).eq("last_synced_at", run.at)
      .order("id", { ascending: true }).range(offset, Math.min(offset + PAGE, run.lots) - 1).abortSignal(signal);
    pages++;
    if (read.error || !Array.isArray(read.data)) throw Error("retained_inventory_page_unavailable");
    rows.push(...read.data);
  }
  if (rows.length !== run.lots) throw Error("retained_inventory_batch_changed_or_truncated");
  const seen = new Set<string>();
  for (const row of rows) {
    if (!UUID.test(row.id ?? "") || seen.has(row.id) || row.board !== SOURCE
      || Date.parse(row.last_synced_at) !== clock || !/^\d+$/.test(row.external_auction_id ?? "")
      || !/^https:\/\/collectingcars\.com\/for-sale\/[a-zA-Z0-9+-]+$/.test(row.external_auction_url ?? ""))
      throw Error("retained_inventory_identity_invalid");
    seen.add(row.id);
  }
  const eligible = rows.filter(row => row.is_live === true && Date.parse(row.auction_end_time ?? "") > now)
    .sort((a,b) => Date.parse(a.auction_end_time) - Date.parse(b.auction_end_time) || a.external_auction_id.localeCompare(b.external_auction_id));
  const urls = eligible.map(row => row.external_auction_url);
  if (new Set(urls).size !== urls.length) throw Error("retained_inventory_duplicate_url");
  return { urls, receipt: { scope: "retained_current_collecting_cars_inventory", inventory_recorded_at: run.at,
    inventory_lots: run.lots, eligible_lots: urls.length, pages, complete: true } };
}
