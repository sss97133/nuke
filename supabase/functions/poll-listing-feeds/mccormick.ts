import { archiveFetch, type ArchiveFetchOptions, type ArchiveFetchResult } from "../_shared/archiveFetch.ts";
import { MCCORMICK_LIVE_METHOD, MCCORMICK_ORIGIN, mccormickLiveLinks, mccormickRunDay,
  parseMcCormickSale, parseMcCormickFutureSales, parseMcCormickInventory, type McCormickInventoryRow } from "../_shared/mccormickLive.ts";
import { vehicleEventWriterFor } from "../_shared/vehicleEventWrite.ts";
import { ledgerWriteFor, type IntakeBudget } from "./ledger.ts";

const writeEpisode = vehicleEventWriterFor("poll-listing-feeds:mccormicks");
type Capture = { url: string; html: string; snapshot_id: string; html_sha256: string; content_captured_at: string; checked_at: string };
type Dependencies = { capture?: (url: string, options: ArchiveFetchOptions) => Promise<ArchiveFetchResult>; clock?: () => number };
const digest = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, "0")).join("");

/** One complete publisher reading, then bounded canonical detail refreshes and episode projections.
 * The existing feed scheduler, fair-share budget, retry ledger and calendar refresh remain the owners. */
export async function pollMcCormick(db: any, feed: any, budget: IntakeBudget, allocation: number, deps: Dependencies = {}) {
  const clock = deps.clock ?? Date.now, capture = deps.capture ?? archiveFetch;
  const result: any = { feed: feed.display_name, source: "mccormicks", items_found: 0, new_ingested: 0,
    matched_existing: 0, error: null, ingest_outcomes: [], retained_inventory: {} };
  const stamp = async (error: string | null) => {
    const write = await db.from("listing_feeds").update({ last_polled_at: new Date(clock()).toISOString(),
      last_poll_count: result.items_found, last_new_count: result.new_ingested,
      total_items_found: (feed.total_items_found ?? 0) + result.items_found,
      error_count: error ? (feed.error_count ?? 0) + 1 : 0, last_error: error,
      updated_at: new Date(clock()).toISOString() }).eq("id", feed.id);
    if (write.error) throw Error("mccormick_feed_receipt_unavailable");
  };
  try {
    const organizationId = feed.search_criteria?.organization_id;
    if (feed.source_slug !== "mccormicks" || feed.feed_url !== `${MCCORMICK_ORIGIN}/Home`
      || typeof organizationId !== "string") throw Error("mccormick_live_feed_config_invalid");
    const [source, capability] = await Promise.all([
      db.from("observation_sources").select("id,species").eq("slug", "mccormicks").maybeSingle(),
      db.functions.invoke("ingest", { method: "GET" }),
    ]);
    if (source.error || source.data?.species !== "block_house") throw Error("mccormick_source_unavailable");
    if (capability.error || capability.data?.capabilities?.mccormicks_native_fresh_capture !== true) throw Error("mccormick_native_intake_not_deployed");
    const pages: Capture[] = [];
    const page = async (url: string): Promise<Capture> => {
      if (budget.remainingMs() < 15000) throw Error("mccormick_catalog_deadline");
      const response = await capture(url, { platform: "mccormicks", forceRefresh: true,
        useFirecrawl: false, firecrawlOnBlock: false, directFetchOptions: { publicOnly: true, timeout: 12000 },
        callerName: "poll-listing-feeds:mccormicks" });
      if (response.error || response.archiveError || !response.html || !response.snapshotId || response.statusCode !== 200
        || response.cached) throw Error("mccormick_live_capture_unavailable");
      const checkedAt = new Date(clock()).toISOString();
      const row = await db.from("listing_page_snapshots").select("id,platform,listing_url,fetched_at,html_sha256,success")
        .eq("id", response.snapshotId).maybeSingle();
      if (row.error || row.data?.success !== true || row.data?.platform !== "mccormicks"
        || row.data.listing_url !== url || row.data.html_sha256 !== await digest(response.html)) throw Error("mccormick_catalog_custody_failed");
      // Identical bytes reuse an older immutable snapshot. The acknowledged
      // network check and original content-capture clock remain separate.
      const p = { url, html: response.html, snapshot_id: response.snapshotId, html_sha256: row.data.html_sha256,
        content_captured_at: row.data.fetched_at, checked_at: checkedAt };
      pages.push(p); return p;
    };
    const home = await page(feed.feed_url), links = mccormickLiveLinks(home.html);
    const event = await page(links.event_url), sale = parseMcCormickSale(event.html, event.url);
    const schedule = await page(`${MCCORMICK_ORIGIN}/Schedule`);
    const catalog = await page(`${MCCORMICK_ORIGIN}/auction-cars`);
    const showroomPage = await page(`${MCCORMICK_ORIGIN}/Showroom-Inventory`);
    const future = links.future_url ? await page(links.future_url) : null;
    const sales = [sale, ...(future ? parseMcCormickFutureSales(future.html, future.url) : [])];
    if (new Set(sales.map(s => s.sale_key)).size !== sales.length) throw Error("mccormick_duplicate_sale_identity");
    const lots = parseMcCormickInventory(catalog.html, "auction", sale);
    for (const lot of lots) lot.run_on = mccormickRunDay(lot.lot_number, sale, catalog.html, schedule.html);
    const showroom = parseMcCormickInventory(showroomPage.html, "showroom");
    sale.lots_listed = lots.length;
    const checkedAt = new Date(clock()).toISOString();
    const rows = [...lots, ...showroom];
    result.items_found = rows.length;
    const census = await db.rpc("record_census", { p_source_slug: "mccormicks",
      p_universe_total: rows.length, p_universe_active: lots.length + showroom.filter(r => r.source_status === "available").length,
      p_census_method: "house_roster_facet", p_census_confidence: 1, p_census_url: feed.feed_url,
      p_by_year: {}, p_by_make: {}, p_by_category: Object.fromEntries(sales.map(s => [s.sale_key, s.lots_listed])),
      p_checked_at: checkedAt,
      p_raw_response: { method: MCCORMICK_LIVE_METHOD, organization_id: organizationId, current_sale_key: sale.sale_key,
        checked_at: checkedAt, inventory: rows, captures: pages.map(({ html: _html, ...p }) => p),
        sales: Object.fromEntries(sales.map(s => [s.sale_key, { ...s, organization_id: organizationId }])) } });
    if (census.error) throw Error("mccormick_census_admission_failed");
    result.retained_inventory = { complete: true, checked_at: checkedAt, sales: sales.length,
      auction_lots: lots.length, showroom_rows: showroom.length, method: MCCORMICK_LIVE_METHOD };

    const read = await db.rpc("organization_source_inventory_read", { p_organization_id: organizationId });
    if (read.error || Date.parse(read.data?.checked_at ?? "") !== Date.parse(checkedAt) || read.data?.source !== "mccormicks" || !Array.isArray(read.data.inventory)) throw Error("mccormick_inventory_readback_failed");
    const readEvents = async () => {
      const events = await db.from("vehicle_events").select("id,vehicle_id,source_listing_id,metadata,ended_at,event_status")
        .eq("source_platform", "mccormicks").eq("metadata->>sale_key", sale.sale_key).limit(1500);
      if (events.error || (events.data?.length ?? 0) >= 1500) throw Error("mccormick_episode_lookup_unavailable");
      return events;
    };
    const withdrawInvalid = async (events: any[], inventory: any[]) => {
      const bindings = new Map(inventory.map(r => [r.native_id, r])), lotMap = new Map(lots.map(l => [l.native_id, l]));
      for (const old of events) {
        if (old.metadata?.projection_method !== MCCORMICK_LIVE_METHOD || old.metadata?.withdrawn_at) continue;
        const reason = projectionWithdrawal(old, lotMap.get(old.metadata?.native_id), bindings.get(old.metadata?.native_id));
        if (!reason) continue;
        if (budget.remainingMs() < 12000) throw Error("mccormick_projection_reconciliation_deadline");
        const withdrawn = await writeEpisode(db, { vehicle_id: old.vehicle_id, source_platform: "mccormicks",
          source_listing_id: old.source_listing_id, metadata: { withdrawn_at: checkedAt, withdrawal_basis: reason,
            source_observed_at: checkedAt, source_catalog_snapshot_id: catalog.snapshot_id } }, { sourceObservedAt: checkedAt });
        if (withdrawn.action === "error" || withdrawn.action === "skipped") throw Error("mccormick_withdrawal_projection_failed");
      }
    };
    // A complete catalog owns membership before potentially slow/failing detail
    // revisits. Retract obsolete public projections before spending that budget.
    await withdrawInvalid((await readEvents()).data ?? [], read.data.inventory);
    let detailError: string | null = null;
    const latest = new Map<string, any>(read.data.inventory.map((r: any) => [r.native_id, r]));
    const ledger = new Map<string, any>();
    for (let i = 0; i < rows.length; i += 40) {
      const q = await db.from("import_queue").select("listing_url,status,vehicle_id,attempts,max_attempts,next_attempt_at,raw_data,processed_at")
        .in("listing_url", rows.slice(i, i + 40).map(r => r.source_url));
      if (q.error) throw Error("mccormick_refresh_ledger_unavailable");
      for (const r of q.data ?? []) ledger.set(r.listing_url, r);
    }
    const interval = 24 * 3600000;
    const due = rows.filter(row => {
      const prior = ledger.get(row.source_url);
      if (prior?.status === "failed" && (!prior.next_attempt_at || Date.parse(prior.next_attempt_at) > clock())) return false;
      const acknowledged = prior?.status === "complete" && prior.raw_data?.mccormick_receipt?.source_id === row.native_id
        && prior.raw_data.mccormick_receipt.observation_id && prior.raw_data.mccormick_receipt.snapshot_id;
      const at = Math.max(Date.parse(latest.get(row.native_id)?.detail_captured_at ?? "") || 0,
        acknowledged ? Date.parse(prior.processed_at ?? "") || 0 : 0);
      return at === 0 || clock() - at >= interval;
    }).sort((a, b) => (Date.parse(latest.get(a.native_id)?.detail_captured_at ?? "") || 0)
      - (Date.parse(latest.get(b.native_id)?.detail_captured_at ?? "") || 0));
    for (const row of due.slice(0, Math.min(8, allocation))) {
      const slot = budget.reserve("mccormicks");
      if (!slot) { result.deferred_reason = budget.refusal("mccormicks"); break; }
      const started = clock(), landed = await db.functions.invoke("ingest", { body: { url: row.source_url }, signal: AbortSignal.timeout(slot.timeout_ms) });
      const receipt = landed.data?.mccormick_receipt;
      const valid = !landed.error && receipt?.source_id === row.native_id && receipt.observation_id && receipt.snapshot_id
        && Date.parse(receipt.source_checked_at ?? "") >= started - 60000 && Date.parse(receipt.source_checked_at ?? "") <= clock() + 60000
        && receipt.source_capture_gaps?.length === 0 && ["created", "matched", "unresolved"].includes(landed.data?.status);
      const outcome = valid ? landed.data : { status: "error", error: landed.error?.message ?? "mccormick_detail_admission_unverified" };
      budget.record("mccormicks", clock() - started, outcome);
      // Canonical ingest already verifies observations and images. Preserve that
      // receipt in the existing retry ledger, including valid unbound blips.
      const write = ledgerWriteFor({ feedId: feed.id, url: row.source_url,
        ingest: valid ? { ...outcome, status: "matched" } : outcome, batch: { rows: new Map(), error: null },
        prev: ledger.get(row.source_url), now: new Date(clock()) });
      if (!write) throw Error("mccormick_refresh_receipt_missing");
      if (valid) Object.assign(write.row, { status: "complete", vehicle_id: landed.data.vehicle_id ?? null,
        error_message: null, failure_category: null, next_attempt_at: null, attempts: 0,
        raw_data: { ...write.row.raw_data as any, mccormick_receipt: receipt } });
      const ack = await db.from("import_queue").upsert(write.row, { onConflict: "listing_url" });
      if (ack.error) throw Error("mccormick_refresh_receipt_unavailable");
      result.ingest_outcomes.push({ url: row.source_url, status: outcome.status, vehicle_id: landed.data?.vehicle_id ?? null });
      if (!valid) { detailError = String(outcome.error); break; }
      if (outcome.status === "created") result.new_ingested++;
      else if (outcome.status === "matched") result.matched_existing++;
      result.retained_inventory.details_refreshed = (result.retained_inventory.details_refreshed ?? 0) + 1;
    }
    // Re-read bindings after the bounded detail pass. Never project an old,
    // private, deleted, ambiguous or differently titled parent as current stock.
    const current = await db.rpc("organization_source_inventory_read", { p_organization_id: organizationId });
    if (current.error || Date.parse(current.data?.checked_at ?? "") !== Date.parse(checkedAt) || !Array.isArray(current.data?.inventory)) throw Error("mccormick_binding_readback_failed");
    const byNative = new Map<string, any>(current.data.inventory.map((r: any) => [r.native_id, r]));
    const events = await readEvents();
    const eventMap = new Map<string, any>();
    for (const e of events.data ?? []) {
      const expected = byNative.get(e.metadata?.native_id)?.vehicle_id;
      if (!eventMap.has(e.source_listing_id) || e.vehicle_id === expected) eventMap.set(e.source_listing_id, e);
    }
    const eligible = lots.filter(l => l.run_on && byNative.get(l.native_id)?.vehicle_id
      && !(eventMap.get(`${sale.sale_key}:${l.native_id}`)?.vehicle_id === byNative.get(l.native_id)?.vehicle_id
        && ["sold", "unsold", "ended", "cancelled"].includes(eventMap.get(`${sale.sale_key}:${l.native_id}`)?.event_status)))
      .sort((a, b) => {
        const priority = (lot: McCormickInventoryRow) => {
          const e = eventMap.get(`${sale.sale_key}:${lot.native_id}`);
          return e?.ended_at && Date.parse(e.ended_at) !== Date.parse(`${lot.run_on}T12:00:00Z`) ? 0 : 1;
        };
        return priority(a) - priority(b) || (Date.parse(eventMap.get(`${sale.sale_key}:${a.native_id}`)?.metadata?.source_observed_at ?? "") || 0)
          - (Date.parse(eventMap.get(`${sale.sale_key}:${b.native_id}`)?.metadata?.source_observed_at ?? "") || 0);
      });
    let projected = 0;
    const write = async (lot: McCormickInventoryRow, binding: any) => {
      const previous = eventMap.get(`${sale.sale_key}:${lot.native_id}`);
      if (previous?.vehicle_id === binding.vehicle_id && previous.metadata?.projection_method !== MCCORMICK_LIVE_METHOD)
        throw Error("mccormick_episode_not_owned");
      const targetEnd = lot.run_on ? `${lot.run_on}T12:00:00Z` : null;
      if (previous?.vehicle_id === binding.vehicle_id && previous.ended_at && targetEnd
        && Date.parse(previous.ended_at) !== Date.parse(targetEnd)) {
        if (previous.metadata?.projection_method !== MCCORMICK_LIVE_METHOD) throw Error("mccormick_scheduled_clock_not_owned");
        const corrected = await db.rpc("supersede_vehicle_event_episode", { p_event_id: previous.id,
          p_corrections: { ended_at: { expected: previous.ended_at, value: targetEnd, precision: "day" } },
          p_source: { type: "mccormick_scheduled_catalog_day", ref: lot.source_url, snapshot_id: catalog.snapshot_id,
            census_id: census.data, basis: "scheduled_run_day", asserted_by: "poll-listing-feeds:mccormicks", repoint_references: true },
          p_reason: "The complete current publisher catalog and schedule agree on a changed lot run day." });
        if (corrected.error || !["superseded", "noop"].includes(corrected.data?.status)) throw Error("mccormick_scheduled_clock_supersession_failed");
      }
      const projected = await writeEpisode(db, { vehicle_id: binding.vehicle_id, source_platform: "mccormicks",
        source_listing_id: `${sale.sale_key}:${lot.native_id}`, source_url: lot.source_url, event_type: "auction", event_status: "upcoming",
        ended_at: lot.run_on ? `${lot.run_on}T12:00:00Z` : null, source_organization_id: organizationId,
        metadata: { sale_key: sale.sale_key, auction_name: sale.name, sale_location: sale.location,
          sale_starts_on: sale.starts_on, sale_ends_on: sale.ends_on, auction_session_days: lot.run_on ? [lot.run_on] : [],
          lot_number: lot.lot_number, roster_first_seen_at: eventMap.get(`${sale.sale_key}:${lot.native_id}`)?.metadata?.roster_first_seen_at ?? checkedAt,
          source_observed_at: checkedAt, source_catalog_snapshot_id: catalog.snapshot_id, source_catalog_sha256: catalog.html_sha256,
          source_observation_id: binding.observation_id, native_id: lot.native_id, withdrawn_at: null, projection_method: MCCORMICK_LIVE_METHOD,
          ended_at_precision: "day", ended_at_method: "scheduled_run_day", sale_outcome: "unknown" } }, { sourceObservedAt: checkedAt });
      if (projected.action === "error" || projected.action === "skipped") throw Error("mccormick_episode_projection_unavailable");
    };
    await withdrawInvalid(events.data ?? [], current.data.inventory);
    for (const lot of eligible.slice(0, 20)) {
      if (budget.remainingMs() < 12000) break;
      await write(lot, byNative.get(lot.native_id)); projected++;
    }
    result.retained_inventory.episodes_projected = projected;
    result.retained_inventory.detail_refresh_due = due.length;
    result.error = detailError;
    await stamp(detailError);
    return result;
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
    await stamp(result.error.slice(0, 500));
    return result;
  }
}

/** A still-listed native ID does not preserve an obsolete parent or unverified run day. */
export function projectionWithdrawal(old: any, lot: McCormickInventoryRow | undefined, binding: any): string | null {
  if (!lot) return "not_in_complete_current_catalog";
  if (!lot.run_on) return "current_run_day_unverified";
  if (!binding?.vehicle_id) return "current_public_binding_unavailable";
  if (binding.vehicle_id !== old.vehicle_id) return "current_public_binding_changed";
  if (old.ended_at && Date.parse(old.ended_at) !== Date.parse(`${lot.run_on}T12:00:00Z`)) return "scheduled_run_day_changed";
  return null;
}
