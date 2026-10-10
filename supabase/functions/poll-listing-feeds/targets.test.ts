import { pollTargets, targetFeed, targetRequestUrl, type Target } from "./targets.ts";
import { createIntakeBudget, intakeThrottle, type IngestOutcome } from "./ledger.ts";

const NOW = Date.parse("2026-10-10T17:00:00Z");
const equal = (a: unknown, b: unknown) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};
const target = (id: number): Target => ({ id, source_slug: "mecum", listing_url: `https://www.mecum.com/lots/${id}/1971-chevrolet-c10/` });
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

// A stateful client double runs the actual scanner/lease/ledger logic. It
// implements compare-and-set rather than always accepting a claimed lease.
function fixture(targets: Target[] = [target(1), target(2)]) {
  const rows: Record<string, Record<string, unknown>[]> = {
    source_targets: targets.map(t => ({ ...t })), platform_config: [], import_queue: [], vehicles: [],
    listing_feeds: [{ id: "feed", source_slug: "mecum" }],
  };
  const calls: Array<{ table: string; op: string }> = [];
  const failures = new Set<string>();
  const db = { from(table: string) {
    let op = "select", payload: Record<string, unknown> | null = null, maximum = Infinity;
    const filters: Array<(row: Record<string, unknown>) => boolean> = [];
    const query = {
      select(_columns: string) { return query; },
      eq(key: string, value: unknown) {
        filters.push(row => key === "config_value->>lease_token"
          ? (row.config_value as Record<string, unknown>)?.lease_token === value
          : key === "config_value" ? JSON.stringify(row[key]) === value : row[key] === value);
        return query;
      },
      gt(key: string, value: number) { filters.push(row => Number(row[key]) > value); return query; },
      is(key: string, _value: null) { filters.push(row => row[key] == null); return query; },
      in(key: string, values: unknown[]) { filters.push(row => values.includes(row[key])); return query; },
      order(_key: string, _options: unknown) { return query; },
      limit(n: number) { maximum = n; return query; },
      insert(value: Record<string, unknown>) { op = "insert"; payload = value; return query; },
      update(value: Record<string, unknown>) { op = "update"; payload = value; return query; },
      upsert(value: Record<string, unknown>, _options: unknown) { op = "upsert"; payload = value; return query; },
      maybeSingle() { return execute(true); },
      then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) { return execute(false).then(resolve, reject); },
    };
    async function execute(single: boolean) {
      calls.push({ table, op });
      if (failures.has(`${table}:${op}`)) return { data: null, error: { message: "fixture refusal" } };
      const selected = rows[table].filter(r => filters.every(f => f(r))).slice(0, maximum);
      if (op === "insert") {
        const key = table === "platform_config" ? "config_key" : "listing_url";
        if (rows[table].some(r => r[key] === payload![key])) return { data: null, error: { code: "23505" } };
        const saved = clone(payload!); rows[table].push(saved); return { data: single ? clone(saved) : [clone(saved)], error: null };
      }
      if (op === "update") for (const row of selected) Object.assign(row, clone(payload!));
      if (op === "upsert") {
        const old = rows[table].find(r => r.listing_url === payload!.listing_url);
        if (old) Object.assign(old, clone(payload!)); else rows[table].push(clone(payload!));
      }
      return { data: single ? clone(selected[0] ?? null) : clone(selected), error: null };
    }
    return query;
  } };
  const throttle = intakeThrottle({ targets: { enabled: true, max_ingests: 2, scan_limit: 200 } });
  const budget = createIntakeBudget(throttle, NOW, () => NOW);
  const ingests: string[] = [];
  let outcome: IngestOutcome = { status: "created", vehicle_id: "vehicle" };
  rows.vehicles.push({ id: "vehicle", description: "Original attributed catalog description." });
  const options: Parameters<typeof pollTargets>[1] = { controls: throttle.targets, throttle, budget,
    feeds: [{ id: "feed", source_slug: "mecum", last_polled_at: null }], clock: () => NOW, token: () => "lease-a",
    ingest: async (url: string, _timeoutMs: number) => { ingests.push(url); return clone(outcome); } };
  return { db, rows, calls, failures, options, ingests, setOutcome: (v: IngestOutcome) => { outcome = v; } };
}

Deno.test("zero target throttle touches no cursor, target, ledger or source", async () => {
  const f = fixture(); f.options.controls.max_ingests = 0;
  equal((await pollTargets(f.db, f.options)).status, "paused"); equal(f.calls, []); equal(f.ingests, []);
});

Deno.test("preview reads candidates without admitting work, leasing or writing", async () => {
  const f = fixture(); const receipt = await pollTargets(f.db, { ...f.options, preview: true });
  equal(receipt.candidates, 2); equal(receipt.attempted, 0); equal(f.ingests, []);
  equal(f.calls.every(c => c.op === "select" && c.table !== "platform_config"), true);
});

Deno.test("only exact source/host/native-route pairs can reach an extractor", () => {
  equal(targetFeed(target(1)), "mecum");
  for (const url of ["https://mecum.com.evil.test/lots/1/car", "http://mecum.com/lots/1/car",
    "https://user@mecum.com/lots/1/car", "https://mecum.com:8443/lots/1/car", "https://mecum.com/about"]) {
    equal(targetFeed({ ...target(1), listing_url: url }), null);
  }
  equal(targetFeed({ ...target(1), source_slug: "bonhams" }), null);
  equal(targetFeed({ ...target(1), source_slug: "unregistered" }), null);
  equal(targetFeed({ ...target(1), source_slug: "broad-arrow", listing_url: "https://broadarrow.com/vehicles/1" }), null);
});

Deno.test("scanner uses canonical ingest and completes only after persisted read-back", async () => {
  const f = fixture(); const result = await pollTargets(f.db, f.options);
  equal(result.complete, 2); equal(result.after_id, 2); equal(f.ingests.length, 2);
  equal(f.rows.import_queue.map(r => r.status), ["complete", "complete"]);
  equal(f.rows.import_queue.map(r => (r.raw_data as Record<string, unknown>).source_target_id), [1, 2]);
  equal((f.rows.platform_config[0].config_value as { after_ids: unknown }).after_ids, { mecum: 2 });
});

Deno.test("missing vehicle read-back records failure rather than delivered data", async () => {
  const f = fixture([target(1)]); f.rows.vehicles.length = 0;
  const result = await pollTargets(f.db, f.options);
  equal(result.complete, 0); equal(result.failed, 1); equal(f.rows.import_queue[0].status, "failed");
  equal(f.rows.import_queue[0].failure_category, "readback_error");
});

Deno.test("active queue claims are preserved and settled URLs spend no admission", async () => {
  const f = fixture([target(1), target(2), target(3)]);
  f.rows.import_queue.push({ listing_url: target(1).listing_url, status: "processing", locked_by: "other-worker" },
    { listing_url: target(2).listing_url, status: "complete", vehicle_id: "old" });
  f.rows.vehicles.push({ listing_url: target(3).listing_url, id: "existing" });
  const before = clone(f.rows.import_queue); const result = await pollTargets(f.db, f.options);
  equal(result.attempted, 0); equal(result.held, 1); equal(result.skipped, 2);
  equal(f.rows.import_queue, before); equal(result.after_id, 3);
});

Deno.test("source zero and billing backoff preserve targets without paid calls", async () => {
  const f = fixture(); f.options.throttle.sources.mecum = { max_ingests: 0 };
  equal((await pollTargets(f.db, f.options)).status, "held"); equal(f.ingests, []); equal(f.rows.source_targets.length, 2);
  const g = fixture(); g.options.feeds = [{ id: "feed", source_slug: "mecum", last_polled_at: new Date(NOW).toISOString(),
    last_error: "intake_backoff: billing", error_count: 1 } as typeof g.options.feeds[number]];
  equal((await pollTargets(g.db, g.options)).status, "held"); equal(g.ingests, []);
});

Deno.test("archive work shares the fresh-feed admission budget", async () => {
  const f = fixture(); for (let i = 0; i < 19; i++) f.options.budget.reserve("fresh-source");
  const result = await pollTargets(f.db, f.options);
  equal(result.attempted, 1); equal(result.status, "invocation_limit"); equal(result.after_id, 1);
  equal(f.options.budget.snapshot().attempted, 20);
});

Deno.test("unacknowledged errors and ledger refusals retain the same target for replay", async () => {
  const f = fixture(); f.setOutcome({ status: "error", error: "transient" });
  equal((await pollTargets(f.db, f.options)).after_id, 0); equal((f.rows.platform_config[0].config_value as { after_ids: unknown }).after_ids, { mecum: 0 });
  const g = fixture(); g.failures.add("import_queue:insert");
  equal((await pollTargets(g.db, g.options)).status, "ledger_unavailable"); equal((g.rows.platform_config[0].config_value as { after_ids: unknown }).after_ids, { mecum: 0 });
});

Deno.test("a live scanner lease prevents a second worker from scanning or fetching", async () => {
  const f = fixture(); f.rows.platform_config.push({ config_key: "source_target_intake_cursor",
    config_value: { after_id: 1, lease_token: "other", lease_until: new Date(NOW + 60_000).toISOString() } });
  equal((await pollTargets(f.db, f.options)).status, "busy"); equal(f.ingests, []);
  equal(f.calls, [{ table: "platform_config", op: "select" }]);
});

Deno.test("expired lease resumes the acknowledged prefix and end-of-scan starts a new cycle", async () => {
  const f = fixture(); f.rows.platform_config.push({ config_key: "source_target_intake_cursor",
    config_value: { after_id: 1, lease_token: "old", lease_until: new Date(NOW - 1).toISOString() } });
  equal((await pollTargets(f.db, f.options)).after_id, 2); equal(f.ingests, [target(2).listing_url]);
  const result = await pollTargets(f.db, f.options);
  equal(result.cycle_complete, true); equal((f.rows.platform_config[0].config_value as { after_ids: unknown }).after_ids, { mecum: 0 });
});

Deno.test("two competing lease initializers admit only one scanner", async () => {
  const f = fixture([target(1)]);
  const results = await Promise.all([pollTargets(f.db, f.options), pollTargets(f.db, { ...f.options, token: () => "lease-b" })]);
  equal(results.filter(r => r.status === "busy").length, 1); equal(f.ingests.length, 1);
});

Deno.test("provider failure persists a source hold and stops more admissions", async () => {
  const f = fixture(); f.setOutcome({ status: "rejected", reason: "enrichment_failed: HTTP 402 payment required" });
  const result = await pollTargets(f.db, f.options);
  equal(result.failed, 1); equal(result.attempted, 1); equal(result.after_id, 1);
  equal(f.rows.listing_feeds[0].last_error, "intake_backoff: billing (retained target)");
  equal(f.rows.import_queue[0].failure_category, "billing");
});

Deno.test("malformed controls fail closed, and defaults preserve the existing archive hold", () => {
  equal(intakeThrottle().targets, { enabled: false, max_ingests: 0, scan_limit: 200 });
  for (const targets of [{ enabled: "yes" }, { max_ingests: 21 }, { scan_limit: 2001 }, []]) {
    let rejected = false; try { intakeThrottle({ targets }); } catch { rejected = true; }
    equal(rejected, true);
  }
});

Deno.test("source cursors rotate without waiting behind the largest archive", async () => {
  const pcar = { id: 3, source_slug: "pcarmarket", listing_url: "https://pcarmarket.com/auction/1971-chevrolet-c10/" };
  const f = fixture([target(1), target(2), pcar]);
  f.options.feeds.push({ id: "pcar-feed", source_slug: "pcarmarket", last_polled_at: null });
  const first = await pollTargets(f.db, f.options), second = await pollTargets(f.db, f.options);
  equal(first.source_slug, "mecum"); equal(second.source_slug, "pcarmarket");
  equal(second.complete, 1);
  equal((f.rows.platform_config[0].config_value as { after_ids: unknown }).after_ids, { mecum: 2, pcarmarket: 3 });
});

Deno.test("a queue claim arriving during native extraction is never overwritten", async () => {
  const f = fixture([target(1)]);
  f.rows.import_queue.push({ listing_url: target(1).listing_url, status: "failed", attempts: 1, raw_data: { original: "kept" } });
  f.options.ingest = async () => {
    Object.assign(f.rows.import_queue[0], { status: "processing", locked_by: "other-worker", locked_at: new Date(NOW).toISOString() });
    return { status: "created", vehicle_id: "vehicle" };
  };
  const result = await pollTargets(f.db, f.options);
  equal(result.status, "ledger_conflict"); equal(result.after_id, 0);
  equal(f.rows.import_queue[0].status, "processing"); equal(f.rows.import_queue[0].raw_data, { original: "kept" });
});

Deno.test("native retry preserves the original ledger capture and attempt history", async () => {
  const f = fixture([target(1)]); const original = { ingested_via: "original-writer", html_capture: "retained-original",
    source_target_attempts: [{ old: "retained-attempt" }] };
  f.rows.import_queue.push({ listing_url: target(1).listing_url, status: "failed", attempts: 1, raw_data: clone(original) });
  equal((await pollTargets(f.db, f.options)).complete, 1);
  const raw = f.rows.import_queue[0].raw_data as typeof original;
  equal(raw.ingested_via, original.ingested_via); equal(raw.html_capture, original.html_capture);
  equal(raw.source_target_attempts[0], original.source_target_attempts[0]); equal(raw.source_target_attempts.length, 2);
});

Deno.test("retained HTTP PCarMarket targets use HTTPS while keeping their source URL", async () => {
  const t = { id: 1, source_slug: "pcarmarket", listing_url: "http://www.pcarmarket.com/auction/2005-porsche-cayenne-partsproject-car/" };
  const f = fixture([t]); f.options.feeds = [{ id: "pcar-feed", source_slug: "pcarmarket", last_polled_at: null }];
  equal(targetFeed(t), "pcarmarket");
  equal((await pollTargets(f.db, f.options)).complete, 1);
  equal(f.ingests, ["https://www.pcarmarket.com/auction/2005-porsche-cayenne-partsproject-car/"]);
  equal(f.rows.import_queue[0].listing_url, t.listing_url);
  equal((f.rows.import_queue[0].raw_data as Record<string, unknown>).requested_listing_url, f.ingests[0]);
});

Deno.test("an already-known HTTPS alias spends no work for the retained HTTP target", async () => {
  const t = { id: 1, source_slug: "pcarmarket", listing_url: "http://www.pcarmarket.com/auction/2005-porsche-cayenne-partsproject-car/" };
  const f = fixture([t]); f.options.feeds = [{ id: "pcar-feed", source_slug: "pcarmarket", last_polled_at: null }];
  f.rows.vehicles.push({ id: "old-pcar", listing_url: targetRequestUrl(t) });
  equal((await pollTargets(f.db, f.options)).skipped, 1); equal(f.ingests, []);
});
