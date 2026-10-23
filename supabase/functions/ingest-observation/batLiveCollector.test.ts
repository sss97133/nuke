import { strict as assert } from "node:assert";
import fixture from "../_shared/batLiveEvents.fixture.json" with { type: "json" };
import { BatLiveAdmissionError, type BatLiveFrame } from "../_shared/batLiveEvents.ts";
import { withCollectorClock } from "../_shared/batLiveTestClock.ts";
import { batStreamIO, BAT_LIVE_COLLECT_MODE } from "./batLiveCollector.ts";

const monitor = "00000000-0000-0000-0000-000000000001";
const vehicle = "00000000-0000-0000-0000-000000000002";
const source = "00000000-0000-0000-0000-000000000003";
let handler: (req: Request) => Promise<Response>;
const serve = Deno.serve;
(Deno as any).serve = (fn: typeof handler) => { handler = fn; };
await import("./index.ts");
Deno.serve = serve;

function nativeFixture() {
  const keys = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEYS", "SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_JWKS"];
  const saved = keys.map(k => Deno.env.get(k));
  Deno.env.set("SUPABASE_URL", "https://db.test");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");
  Deno.env.delete("SUPABASE_SECRET_KEYS"); Deno.env.delete("SUPABASE_PUBLISHABLE_KEYS"); Deno.env.delete("SUPABASE_JWKS");
  const fetch = globalThis.fetch, socket = globalThis.WebSocket, runtime = (globalThis as any).EdgeRuntime;
  const state = { empty: false, sourceId: source, deleted: false, postId: fixture.post_id, url: fixture.source_url };
  const tasks: Promise<unknown>[] = [], rpcs: any[] = [], requests: { path: string; method: string }[] = [];
  let sourceReads = 0, sockets = 0, pings = 0;
  let afterRpc: (() => void) | undefined;
  (globalThis as any).EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { tasks.push(p); } };
  class Socket {
    readyState = 1;
    onmessage?: (event: { data: string }) => void;
    onclose?: () => void;
    constructor() {
      sockets++;
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ event: "pusher:connection_established", data: {} }) }));
    }
    close() { this.readyState = 3; this.onclose?.(); }
    send(raw: string) {
      const f = JSON.parse(raw);
      if (f.event === "pusher:subscribe") queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({
        event: "pusher_internal:subscription_succeeded", channel: f.data.channel, data: {} }) }));
      if (f.event === "pusher:ping") {
        pings++; queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ event: "pusher:pong", data: {} }) }));
      }
    }
  }
  globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  globalThis.fetch = async (resource, init) => {
    const url = new URL(typeof resource === "string" ? resource : resource instanceof URL ? resource.href : resource.url);
    const method = init?.method ?? "GET";
    requests.push({ path: url.pathname, method });
    if (url.hostname === "bringatrailer.com") {
      assert.equal(url.pathname, "/wp-admin/admin-ajax.php"); sourceReads++;
      return Response.json({ comments: [], metadata: { post_id: fixture.post_id, current_numeric: 100, count: 1 } });
    }
    assert.equal(url.hostname, "db.test");
    assert.ok(!url.pathname.startsWith("/functions/v1/"), "canonical-owned batches must not invoke another Edge function");
    if (url.pathname === "/rest/v1/live_auction_sources") return Response.json({ id: source });
    if (url.pathname === "/rest/v1/monitored_auctions") return Response.json(state.empty ? [] : [{ id: monitor,
      source_id: state.sourceId, vehicle_id: vehicle, external_auction_url: fixture.source_url, stream_state: {} }]);
    if (url.pathname === "/rest/v1/vehicles") return Response.json(state.deleted ? [] : [{ id: vehicle,
      listing_url: state.url, origin_metadata: { source: "bat_auctions_page", external_id: String(state.postId) } }]);
    assert.equal(url.pathname, "/rest/v1/rpc/ingest_bat_live_events");
    assert.equal(method, "POST");
    rpcs.push(JSON.parse(String(init?.body))); afterRpc?.();
    return Response.json({ recorded: rpcs.at(-1).p_frames.length, duplicates: 0 });
  };
  return { state, tasks, rpcs, requests,
    set afterRpc(fn: (() => void) | undefined) { afterRpc = fn; },
    get sourceReads() { return sourceReads; }, get sockets() { return sockets; }, get pings() { return pings; },
    request(body: Record<string, unknown> = {}, key: string | null = "test-key", method = "POST", signal?: AbortSignal) {
      return handler(new Request("https://db.test/functions/v1/ingest-observation", { method, signal,
        headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), "Content-Type": "application/json" },
        body: JSON.stringify({ mode: BAT_LIVE_COLLECT_MODE, ...body }) }));
    },
    restore() {
      globalThis.fetch = fetch; globalThis.WebSocket = socket;
      if (runtime === undefined) delete (globalThis as any).EdgeRuntime; else (globalThis as any).EdgeRuntime = runtime;
      keys.forEach((k, i) => { if (saved[i] === undefined) Deno.env.delete(k); else Deno.env.set(k, saved[i]!); });
    },
  };
}

Deno.test("canonical collector HTTP guard rejects anonymous, user, methods and caller overrides before selection", async () => {
  const f = nativeFixture();
  try {
    assert.equal((await f.request({}, null)).status, 401);
    const signer = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    Deno.env.set("SUPABASE_JWKS", JSON.stringify({ keys: [{ ...(await crypto.subtle.exportKey("jwk", signer.publicKey)), kid: "native-owner-test", alg: "ES256", use: "sig" }] }));
    const b64 = (s: Uint8Array) => btoa(String.fromCharCode(...s)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
    const enc = (o: unknown) => b64(new TextEncoder().encode(JSON.stringify(o)));
    const input = `${enc({ alg: "ES256", kid: "native-owner-test" })}.${enc({ role: "authenticated", sub: vehicle, exp: Math.floor(Date.now() / 1000) + 3600 })}`;
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signer.privateKey, new TextEncoder().encode(input));
    assert.equal((await f.request({}, `${input}.${b64(new Uint8Array(signature))}`)).status, 403);
    assert.equal((await f.request({}, "test-key", "PUT")).status, 405);
    for (const override of [{ targets: [] }, { url: fixture.source_url }, { duration: 1 }, { concurrency: 100 },
      { retain_terminal_evidence: true }, { frames: [] }, { dry_run: "true" }]) {
      assert.equal((await f.request(override)).status, 400);
    }
    assert.equal(f.requests.length, 0); assert.equal(f.tasks.length, 0); assert.equal(f.sockets, 0);
  } finally { f.restore(); }
});

Deno.test("canonical collector dry-run and idle preserve target preview without launching work", async () => {
  const f = nativeFixture();
  try {
    const response = await f.request({ dry_run: true }), result = await response.json();
    assert.equal(response.status, 200); assert.equal(result.accepted, false); assert.equal(result.collector_run_id, null);
    assert.equal(result.selected_lots, 1); assert.equal(result.targets[0].id, monitor);
    f.state.empty = true;
    const idle = await f.request(), body = await idle.json();
    assert.equal(idle.status, 200); assert.equal(body.accepted, false); assert.equal(body.selected_lots, 0);
    assert.equal(f.sourceReads, 0); assert.equal(f.sockets, 0); assert.equal(f.tasks.length, 0);
    assert.equal(f.rpcs.length, 0); assert.ok(f.requests.every(r => r.method === "GET"));
  } finally { f.restore(); }
});

Deno.test("one accepted canonical HTTP launch processes over sixty coverage batches after incoming request ends", () => withCollectorClock(async () => {
  const f = nativeFixture(), incoming = new AbortController();
  try {
    const response = await f.request({}, "test-key", "POST", incoming.signal), result = await response.json();
    assert.equal(response.status, 202); assert.equal(result.accepted, true); assert.equal(result.selected_lots, 1);
    assert.match(result.collector_run_id, /^[0-9a-f-]{36}$/); assert.equal(result.targets, undefined);
    incoming.abort();
    await Promise.all(f.tasks);
    assert.equal(f.tasks.length, 1); assert.equal(f.sockets, 1);
    const coverage = f.rpcs.flatMap(r => r.p_heartbeats);
    assert.ok(coverage.filter(h => h.connected).length > 60, `coverage batches: ${coverage.length}`);
    assert.ok(coverage.every(h => h.session_id === result.collector_run_id));
    assert.equal(coverage.at(-1).connected, false); assert.ok(f.pings >= 110);
    assert.ok(f.sourceReads <= 4, "existing45-second recovery is not expanded");
    assert.ok(f.rpcs.some(r => r.p_frames.length > 0));
    assert.ok(f.requests.every(r => !r.path.startsWith("/functions/v1/")));
    assert.ok(f.rpcs.every(r => r.p_frames.length <= 50 && r.p_heartbeats.length <= 200));
  } finally { f.restore(); }
}));

Deno.test("canonical local batches revalidate deletion, source, post and URL after an acknowledged batch", async () => {
  for (const mutation of ["deleted", "sourceId", "postId", "url"] as const) await withCollectorClock(async () => {
    const f = nativeFixture();
    f.afterRpc = () => {
      if (mutation === "deleted") f.state.deleted = true;
      else if (mutation === "sourceId") f.state.sourceId = vehicle;
      else if (mutation === "postId") f.state.postId++;
      else f.state.url = "https://bringatrailer.com/listing/different-fixture/";
    };
    try {
      assert.equal((await f.request()).status, 202); await Promise.all(f.tasks);
      assert.equal(f.rpcs.length, 1, `${mutation}: a prior valid target cannot authorize another batch`);
      assert.ok(f.requests.filter(r => r.path === "/rest/v1/monitored_auctions").length > 2);
    } finally { f.restore(); }
  });
});

Deno.test("documented nested quota exhausts the HTTP adapter while canonical local admission makes zero nested calls", async () => {
  const original = globalThis.fetch, now = Date.now;
  let time = now(), count = 0, local = 0;
  Date.now = () => time;
  globalThis.fetch = async () => {
    count++;
    if (count > 30) { const e = new Error("Rate limit exceeded. Retry after 5000ms."); e.name = "RateLimitError"; throw e; }
    return Response.json({ success: true });
  };
  try {
    const legacy = batStreamIO("https://db.test", "test-key");
    for (let n = 0; n < 30; n++) await legacy.admit([], [{ at: n }]);
    await assert.rejects(() => legacy.admit([], [{ at: 30 }]), /Rate limit/);
    const canonical = batStreamIO("https://db.test", "test-key", {}, async () => { local++; return { success: true }; });
    for (let n = 0; n < 116; n++) { time += 1000; await canonical.admit([], [{ at: n }]); }
    assert.equal(local, 116); assert.equal(count, 31, "local canonical admission never invokes another Edge function");
  } finally { globalThis.fetch = original; Date.now = now; }
});

Deno.test({
  name: "canonical collector actual HTTP mode acknowledges PostgreSQL coverage and preserves refused testimony",
  ignore: Deno.env.get("BAT_LIVE_PG_TEST") !== "1",
  async fn() {
    const host = Deno.env.get("PGHOST") ?? "";
    assert.ok(host.startsWith("/private/tmp/nuke-native-owner-") || host.startsWith("/tmp/nuke-native-owner-")
      || (Deno.env.get("CI") === "true" && host === "localhost"), "isolated local/CI PostgreSQL only");
    const sql = async (statement: string, vars: Record<string, unknown> = {}, rpc = false) => {
      const args = ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-d", "nuke_soft_close_test"];
      for (const [key, value] of Object.entries(vars)) args.push("--set", `${key}=${JSON.stringify(value)}`);
      const child = new Deno.Command(Deno.env.get("DB_CONTRACT_PSQL") ?? "psql", {
        args, stdin: "piped", stdout: "piped", stderr: "piped",
      }).spawn();
      const writer = child.stdin.getWriter(); await writer.write(new TextEncoder().encode(statement)); await writer.close();
      const out = await child.output(), error = new TextDecoder().decode(out.stderr);
      if (rpc && out.code !== 0) {
        const details = /ERROR:\s+([0-9A-Z]{5}):\s*([^\n]*)/.exec(error);
        assert.ok(details, "SQL refusal must retain its real error category");
        return { refused: true, code: details[1], message: details[2] };
      }
      assert.equal(out.code, 0, error);
      const text = new TextDecoder().decode(out.stdout).trim(); return text ? JSON.parse(text) : null;
    };
    assert.equal(await sql("SELECT to_json(current_database())"), "nuke_soft_close_test");
    await withCollectorClock(async () => {
      const f = nativeFixture(), fixtureFetch = globalThis.fetch;
      let acknowledged = 0, refused = 0;
      const ids = (value: string | null) => {
        assert.ok(value?.startsWith("in.(") && value.endsWith(")"));
        const parsed = value!.slice(4, -1).split(",");
        assert.ok(parsed.every(id => /^[0-9a-f-]{36}$/i.test(id)));
        return parsed.map(id => `'${id}'`).join(",");
      };
      globalThis.fetch = async (resource, init) => {
        const url = new URL(typeof resource === "string" ? resource : resource instanceof URL ? resource.href : resource.url);
        if (url.hostname === "bringatrailer.com") return fixtureFetch(resource, init);
        assert.equal(url.hostname, "db.test");
        assert.ok(!url.pathname.startsWith("/functions/v1/"));
        if (url.pathname === "/rest/v1/live_auction_sources") return Response.json(await sql(
          "SELECT row_to_json(t) FROM (SELECT id FROM live_auction_sources WHERE slug='bat') t"));
        if (url.pathname === "/rest/v1/monitored_auctions") {
          const where = url.searchParams.has("id") ? `id IN (${ids(url.searchParams.get("id"))})`
            : "source_id=(SELECT id FROM live_auction_sources WHERE slug='bat') AND is_live AND auction_end_time<=now()+interval '15 minutes'";
          return Response.json(await sql(`SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM
            (SELECT id,source_id,vehicle_id,external_auction_url,stream_state FROM monitored_auctions WHERE ${where}) t`));
        }
        if (url.pathname === "/rest/v1/vehicles") return Response.json(await sql(`SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM
          (SELECT id,listing_url,origin_metadata FROM vehicles WHERE id IN (${ids(url.searchParams.get("id"))}) AND deleted_at IS NULL) t`));
        assert.equal(url.pathname, "/rest/v1/rpc/ingest_bat_live_events");
        const body = JSON.parse(String(init?.body));
        const result = await sql("BEGIN; SET LOCAL ROLE service_role; SELECT ingest_bat_live_events(:'frames'::jsonb,:'hearts'::jsonb); COMMIT;",
          { frames: body.p_frames, hearts: body.p_heartbeats }, true);
        if (result.refused) { refused++; return Response.json(result, { status: 422 }); }
        acknowledged++; return Response.json(result);
      };
      try {
        const response = await f.request(), acceptance = await response.json();
        assert.equal(response.status, 202); await Promise.all(f.tasks);
        assert.ok(acknowledged > 0, "actual canonical heartbeat acknowledgement");
        assert.ok(refused > 0, "the existing fixture deliberately has no canonical event holder");
        const persisted = await sql(`SELECT jsonb_build_object('frames',(SELECT count(*) FROM vehicle_observations),
          'connected',(SELECT (stream_state->'sessions'->'${acceptance.collector_run_id}'->>'connected')::boolean FROM monitored_auctions WHERE id='${monitor}'))`);
        assert.equal(persisted.frames, 0, "canonical refusal cannot manufacture testimony");
        assert.equal(persisted.connected, false, "canonical cleanup affects its own session only");
      } finally { f.restore(); }
    });
  },
});

Deno.test("canonical local admission retains independent in-flight lanes", async () => {
  for (const blockCoverage of [true, false]) {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const calls: { frames: number; hearts: number }[] = [];
    const io = batStreamIO("https://db.test", "test-key", {}, async (frames, hearts) => {
      calls.push({ frames: frames.length, hearts: hearts.length });
      if ((hearts.length > 0) === blockCoverage) await held;
      return { success: true };
    });
    const frame = { ...fixture.events[3], monitored_auction_id: monitor, transport: "public_pusher" } as BatLiveFrame;
    const blocked = io.admit(blockCoverage ? [] : [frame], blockCoverage ? [{}] : []);
    await Promise.resolve();
    await io.admit(blockCoverage ? [frame] : [], blockCoverage ? [] : [{}]);
    assert.equal(calls.length, 2, "a stalled local lane cannot hold the independent lane");
    release(); await blocked;
  }
});

Deno.test("canonical semantic refusal restores independent lanes; transient refusal retains grouped atomic retry", async () => {
  const frame = { ...fixture.events[3], monitored_auction_id: monitor, transport: "public_pusher" } as BatLiveFrame;
  for (const kind of ["semantic", "transient"] as const) {
    let first = true;
    const calls: { frames: number; hearts: number }[] = [];
    const io = batStreamIO("https://db.test", "test-key", {}, async (frames, hearts) => {
      calls.push({ frames: frames.length, hearts: hearts.length });
      if (first) { first = false; throw new BatLiveAdmissionError(kind, "fixture refusal"); }
      if (kind === "semantic" && hearts.length) throw new BatLiveAdmissionError(kind, "coverage refusal");
      return { success: true };
    });
    const original = await Promise.allSettled([io.admit([frame], []), io.admit([], [{}])]);
    assert.ok(original.every(r => r.status === "rejected"), "shared refusal acknowledges neither caller");
    const retried = await Promise.allSettled([io.admit([frame], []), io.admit([], [{}])]);
    if (kind === "semantic") {
      assert.equal(calls.length, 3); assert.equal(retried[0].status, "fulfilled"); assert.equal(retried[1].status, "rejected");
    } else {
      assert.equal(calls.length, 2); assert.ok(retried.every(r => r.status === "fulfilled"));
      assert.deepEqual(calls[1], { frames: 1, hearts: 1 });
    }
  }
});
