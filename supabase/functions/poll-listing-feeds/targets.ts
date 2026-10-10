import {
  ledgerDecision, ledgerWriteFor, readLandedBatch, selectIntakeFeeds,
  type IntakeBudget, type IntakeThrottle, type LedgerKnown, type IngestOutcome,
} from "./ledger.ts";

// Extend the existing intake owner. Unknown sources retain their targets;
// they must never silently fall through to paid generic extraction.
const NATIVE_TARGET_SOURCES: Record<string, { feed: string; hosts: string[]; path?: RegExp }> = {
  mecum: { feed: "mecum", hosts: ["mecum.com"], path: /^\/lots\/\d+\// },
  "barrett-jackson": { feed: "barrettjackson", hosts: ["barrett-jackson.com"], path: /^\/[\w-]+\/docket\/vehicle\/[\w-]+/ },
  gooding: { feed: "gooding", hosts: ["goodingco.com"] },
  pcarmarket: { feed: "pcarmarket", hosts: ["pcarmarket.com"], path: /^\/auction\/[\w-]+/ },
  "rm-sothebys": { feed: "rmsothebys", hosts: ["rmsothebys.com"] },
  bonhams: { feed: "bonhams", hosts: ["bonhams.com", "cars.bonhams.com"] },
  "broad-arrow": { feed: "broadarrow", hosts: ["broadarrowauctions.com"] },
};

export type TargetControls = IntakeThrottle["targets"];

export interface Target { id: number; source_slug: string; listing_url: string }
export function targetFeed(target: Target): string | null {
  const source = NATIVE_TARGET_SOURCES[target.source_slug];
  if (!source) return null;
  try {
    const url = new URL(target.listing_url);
    // The retained PCarMarket sitemap contains HTTP URLs. Upgrade those
    // exact native hosts at dispatch, retaining the original URL on the ledger.
    const protocolAllowed = url.protocol === "https:" || target.source_slug === "pcarmarket" && url.protocol === "http:";
    return target.listing_url.length <= 2000 && protocolAllowed && !url.username && !url.password && !url.port &&
        source.hosts.includes(url.hostname.toLowerCase().replace(/^www\./, "")) &&
        (!source.path || source.path.test(url.pathname)) ? source.feed : null;
  } catch { return null; }
}
export function targetRequestUrl(target: Target): string | null {
  if (!targetFeed(target)) return null;
  const url = new URL(target.listing_url); url.protocol = "https:";
  return url.href;
}

const CURSOR_KEY = "source_target_intake_cursor";
const LEASE_MS = 120_000;
interface Cursor { after_id: number; after_ids?: Record<string, number>; next_source?: number;
  lease_token?: string | null; lease_until?: string | null }
function cursorValue(raw: unknown): Cursor {
  const v = raw as Cursor;
  if (!v || !Number.isSafeInteger(v.after_id) || v.after_id < 0 ||
    (v.lease_token != null && typeof v.lease_token !== "string") ||
    (v.lease_until != null && (!Number.isFinite(Date.parse(v.lease_until)) || typeof v.lease_until !== "string"))) {
    throw new Error("invalid retained-target cursor");
  }
  if (v.after_ids != null && (typeof v.after_ids !== "object" || Array.isArray(v.after_ids) ||
    Object.entries(v.after_ids).some(([key, id]) => !NATIVE_TARGET_SOURCES[key] || !Number.isSafeInteger(id) || id < 0))) {
    throw new Error("invalid retained-target source cursor");
  }
  if (v.next_source != null && (!Number.isInteger(v.next_source) || v.next_source < 0 || v.next_source >= Object.keys(NATIVE_TARGET_SOURCES).length)) {
    throw new Error("invalid retained-target rotation");
  }
  return v;
}

// deno-lint-ignore no-explicit-any
export async function pollTargets(db: any, options: {
  controls: TargetControls; throttle: IntakeThrottle; budget: IntakeBudget;
  // Only enabled, declared feeds enter this lane. Their switches and backoff
  // continue to apply to archived URLs as well as fresh discovery.
  feeds: Array<{ id: string; source_slug: string; last_polled_at?: string | null;
    last_error?: string | null; error_count?: number | null }>;
  ingest: (url: string, timeoutMs: number) => Promise<IngestOutcome>;
  preview?: boolean; afterId?: number; targetSource?: string; clock?: () => number; token?: () => string;
}) {
  const { controls, budget, throttle } = options;
  const clock = options.clock ?? Date.now;
  const receipt = { status: "paused", scanned: 0, attempted: 0, complete: 0, failed: 0,
    skipped: 0, held: 0, unsupported: 0, candidates: 0, after_id: 0, source_slug: null as string | null, cycle_complete: false };
  if (!options.preview && (!controls.enabled || !controls.max_ingests || !controls.scan_limit ||
    !throttle.enabled || !throttle.max_ingests)) return receipt;
  if (options.afterId !== undefined && (!Number.isSafeInteger(options.afterId) || options.afterId < 0)) {
    throw new Error("invalid target after_id");
  }
  if (options.targetSource !== undefined && !Object.hasOwn(NATIVE_TARGET_SOURCES, options.targetSource)) {
    throw new Error("unsupported target preview source");
  }
  const newest = new Map<string, typeof options.feeds[number]>();
  for (const feed of options.feeds) {
    const old = newest.get(feed.source_slug);
    const timestamp = (date?: string | null) => Number.isFinite(Date.parse(date ?? "")) ? Date.parse(date!) : 0;
    if (!old || timestamp(feed.last_polled_at) > timestamp(old.last_polled_at)) newest.set(feed.source_slug, feed);
  }
  const eligible = new Map(selectIntakeFeeds([...newest.values()].map(f => ({ ...f, poll_interval_minutes: 0 })),
    newest.size, throttle, clock(), false).map(f => [f.source_slug, f]));
  const sources = Object.keys(NATIVE_TARGET_SOURCES);
  if (!options.preview && !sources.some(s => eligible.has(NATIVE_TARGET_SOURCES[s].feed))) return { ...receipt, status: "held" };

  let lease: Cursor | null = null;
  let before: Cursor = { after_id: 0 };
  let afterId = options.afterId ?? 0;
  if (!options.preview) {
    const current = await db.from("platform_config").select("config_value").eq("config_key", CURSOR_KEY).maybeSingle();
    if (current.error) throw new Error("retained-target cursor unavailable");
    before = current.data ? cursorValue(current.data.config_value) : { after_id: 0 };
    if (before.lease_until && Date.parse(before.lease_until) > clock()) return { ...receipt, status: "busy" };
    // Reserve the scanner before fetching or admitting work. A killed worker
    // replays the acknowledged prefix after lease expiry through the URL ledger.
    lease = { ...before, lease_token: (options.token ?? (() => crypto.randomUUID()))(),
      lease_until: new Date(clock() + LEASE_MS).toISOString() };
    let claim;
    if (current.data) {
      claim = await db.from("platform_config").update({ config_value: lease, updated_at: new Date(clock()).toISOString() })
        .eq("config_key", CURSOR_KEY).eq("config_value", JSON.stringify(current.data.config_value)).select("config_value").maybeSingle();
    } else {
      claim = await db.from("platform_config").insert({ config_key: CURSOR_KEY, config_value: lease,
        description: "Resumable, leased scan of retained sitemap targets through poll-listing-feeds" }).select("config_value").maybeSingle();
    }
    if (claim.error?.code === "23505" || (!claim.error && !claim.data)) return { ...receipt, status: "busy" };
    if (claim.error) throw new Error("retained-target lease unavailable");
  }
  const rotated = [...sources.slice(before.next_source ?? 0), ...sources.slice(0, before.next_source ?? 0)];
  const selectedSource = options.preview && options.targetSource ? options.targetSource
    : rotated.find(s => eligible.has(NATIVE_TARGET_SOURCES[s].feed)) ?? sources[0];
  if (!options.preview) afterId = before.after_ids?.[selectedSource] ?? (before.after_ids ? 0 : before.after_id);
  receipt.source_slug = selectedSource;
  receipt.after_id = afterId;
  let acknowledged = afterId;
  try {
    // Each source owns a monotone cursor. Rotate eligible sources every tick,
    // so a large archive cannot starve a smaller house behind it. No OFFSET.
    const scan = await db.from("source_targets").select("id,source_slug,listing_url")
      .eq("source_slug", selectedSource).gt("id", afterId).order("id", { ascending: true }).limit(controls.scan_limit);
    if (scan.error) throw new Error("retained-target scan unavailable");
    const targets = (scan.data ?? []) as Target[];
    if (targets.some((t, i) => !Number.isSafeInteger(t.id) || t.id <= (i ? targets[i - 1].id : afterId))) {
      throw new Error("invalid retained-target scan order");
    }
    receipt.scanned = targets.length;
    receipt.status = options.preview ? "preview" : "processed";
    if (!targets.length) { receipt.cycle_complete = true; acknowledged = 0; return receipt; }

    const urls = [...new Set(targets.filter(t => { const source = targetFeed(t); return source && eligible.has(source); })
      .flatMap(t => [t.listing_url, targetRequestUrl(t)!]))];
    const ledger = new Map<string, LedgerKnown>();
    const existing = new Set<string>();
    // Keep URL filters below the HTTP request-line limit. Bounded chunks
    // also keep a large configured scan from becoming one unbounded IN query.
    const chunks: string[][] = [];
    let chunk: string[] = [], length = 0;
    for (const url of urls) {
      const size = encodeURIComponent(url).length;
      if (chunk.length && (chunk.length >= 20 || length + size > 6000)) { chunks.push(chunk); chunk = []; length = 0; }
      chunk.push(url); length += size;
    }
    if (chunk.length) chunks.push(chunk);
    const checked = new Set<string>();
    const batchForUrl = new Map(chunks.flatMap(batch => batch.map(url => [url, batch] as const)));
    const ensureKnown = async (url: string) => {
      if (checked.has(url)) return true;
      if (!options.preview && budget.remainingMs() < 15_000) return false;
      const batch = batchForUrl.get(url)!;
      const [known, vehicles] = await Promise.all([
        db.from("import_queue").select("listing_url,status,attempts,max_attempts,next_attempt_at,raw_data").in("listing_url", batch),
        db.from("vehicles").select("listing_url").in("listing_url", batch),
      ]);
      if (known.error || vehicles.error) throw new Error("retained-target ledger unavailable");
      for (const row of known.data ?? []) ledger.set(row.listing_url, row);
      for (const row of vehicles.data ?? []) existing.add(row.listing_url);
      for (const key of batch) checked.add(key);
      return true;
    };

    for (const target of targets) {
      const source = targetFeed(target);
      if (!source) { receipt.unsupported++; acknowledged = target.id; continue; }
      const feed = eligible.get(source);
      if (!feed) { receipt.held++; acknowledged = target.id; continue; }
      if (!await ensureKnown(target.listing_url)) { receipt.status = "worker_deadline"; break; }
      const decision = ledgerDecision(ledger.get(target.listing_url), new Date(clock()));
      if (decision === "settled" || decision === "backoff") { receipt.skipped++; acknowledged = target.id; continue; }
      // Pending/claimed/reviewed rows belong to their existing queue consumer.
      const prior = ledger.get(target.listing_url);
      if (prior && prior.status !== "failed") { receipt.held++; acknowledged = target.id; continue; }
      const requestUrl = targetRequestUrl(target)!;
      if (requestUrl !== target.listing_url && !await ensureKnown(requestUrl)) { receipt.status = "worker_deadline"; break; }
      if (!prior && (existing.has(target.listing_url) || existing.has(requestUrl) || ledger.has(requestUrl))) {
        receipt.skipped++; acknowledged = target.id; continue;
      }
      receipt.candidates++;
      if (options.preview) { acknowledged = target.id; continue; }
      if (receipt.attempted >= controls.max_ingests) { receipt.status = "target_limit"; break; }
      const grant = budget.reserve(source);
      if (!grant) { receipt.status = budget.refusal(source) ?? "throttled"; break; }
      receipt.attempted++;
      const started = clock();
      let outcome: IngestOutcome;
      try { outcome = await options.ingest(requestUrl, grant.timeout_ms); }
      catch (error) { outcome = { status: "error", error: error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)
        ? "retained-target ingest request timeout" : "retained-target ingest request failed" }; }
      budget.record(source, clock() - started, outcome);
      const hold = budget.refusal(source);
      if (hold && ["billing", "blocked", "rate_limited", "timeout"].includes(hold)) {
        const savedHold = await db.from("listing_feeds").update({
          last_error: `intake_backoff: ${hold} (retained target)`, error_count: (feed.error_count ?? 0) + 1,
          last_polled_at: new Date(clock()).toISOString(),
        }).eq("id", feed.id);
        if (savedHold.error) { receipt.failed++; receipt.status = "hold_unavailable"; break; }
      }
      const batch = await readLandedBatch(db, outcome.vehicle_id ? [outcome.vehicle_id] : []);
      const write = ledgerWriteFor({ url: target.listing_url, feedId: feed.id, ingest: outcome,
        batch, prev: ledger.get(target.listing_url), now: new Date(clock()) });
      if (!write) { receipt.failed++; receipt.status = "unacknowledged"; break; }
      const attempt = { ...(write.row.raw_data as Record<string, unknown>),
        ingested_via: "poll_source_targets", source_target_id: target.id, source_target_slug: target.source_slug,
        requested_listing_url: requestUrl };
      const priorRaw = (prior as (LedgerKnown & { raw_data?: unknown }) | undefined)?.raw_data;
      write.row.raw_data = priorRaw && typeof priorRaw === "object" && !Array.isArray(priorRaw)
        ? { ...priorRaw, source_target_attempts: [
          ...(Array.isArray((priorRaw as Record<string, unknown>).source_target_attempts)
            ? (priorRaw as { source_target_attempts: unknown[] }).source_target_attempts : []), attempt,
        ] } : attempt;
      // Do not overwrite a row that a queue worker claimed after our read.
      // A newly queued URL wins its UNIQUE constraint; we retain this cursor
      // for a fresh ownership check rather than clobbering that work item.
      let saved;
      if (prior) {
        let update = db.from("import_queue").update(write.row).eq("listing_url", target.listing_url)
          .eq("status", "failed").is("locked_at", null);
        update = prior.attempts == null ? update.is("attempts", null) : update.eq("attempts", prior.attempts);
        saved = await update.select("listing_url").maybeSingle();
      } else saved = await db.from("import_queue").insert(write.row).select("listing_url").maybeSingle();
      if (saved.error || !saved.data) {
        receipt.failed++; receipt.status = saved.error?.code === "23505" || !saved.error ? "ledger_conflict" : "ledger_unavailable"; break;
      }
      if (write.status === "complete") receipt.complete++;
      else if (write.status === "failed") receipt.failed++;
      else receipt.skipped++;
      acknowledged = target.id;
    }
    return receipt;
  } finally {
    receipt.after_id = acknowledged;
    if (lease) {
      const released = await db.from("platform_config").update({ config_value: { after_id: acknowledged,
        after_ids: { ...(before.after_ids ?? {}), [selectedSource]: acknowledged },
        next_source: (sources.indexOf(selectedSource) + 1) % sources.length },
        updated_at: new Date(clock()).toISOString() }).eq("config_key", CURSOR_KEY)
        .eq("config_value->>lease_token", lease.lease_token).select("config_key").maybeSingle();
      if (released.error || !released.data) throw new Error("retained-target acknowledgement unavailable");
    }
  }
}
