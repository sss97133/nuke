import { strict as assert } from "node:assert";
import { BAT_LIVE_COLLECT_MODE } from "../_shared/batLiveEvents.ts";

let handler: (req: Request) => Promise<Response>;
const serve = Deno.serve;
(Deno as any).serve = (fn: typeof handler) => { handler = fn; };
await import("./index.ts");
Deno.serve = serve;
const runId = "00000000-0000-4000-8000-000000000010";
const target = { id: "00000000-0000-0000-0000-000000000001", vehicle_id: "00000000-0000-0000-0000-000000000002",
  post_id: 123, source_url: "https://bringatrailer.com/listing/synthetic-fixture", last_comment_id: 0 };

async function fixture(run: (f: { calls: any[]; call: (body?: Record<string, unknown>, key?: string | null) => Promise<Response>;
  reply: (value: unknown, status?: number) => void; fail: () => void }) => Promise<void>) {
  const keys = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEYS", "SUPABASE_PUBLISHABLE_KEYS"];
  const saved = keys.map(k => Deno.env.get(k)), fetch = globalThis.fetch;
  const runtime = (globalThis as any).EdgeRuntime;
  Deno.env.set("SUPABASE_URL", "https://db.test"); Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");
  Deno.env.delete("SUPABASE_SECRET_KEYS"); Deno.env.delete("SUPABASE_PUBLISHABLE_KEYS");
  (globalThis as any).EdgeRuntime = { waitUntil: () => assert.fail("core cannot launch a collector") };
  const calls: any[] = [];
  let value: any = { success: true, mode: BAT_LIVE_COLLECT_MODE, dry_run: false, accepted: true,
    collector_run_id: runId, selected_lots: 1, collector_duration_seconds: 115, transport: "public_pusher" };
  let status = 202, timeout = false;
  globalThis.fetch = async (resource, init) => {
    const url = new URL(typeof resource === "string" ? resource : resource instanceof URL ? resource.href : resource.url);
    assert.equal(url.origin, "https://db.test"); assert.equal(url.pathname, "/functions/v1/ingest-observation");
    assert.equal(url.searchParams.get("native_collection_handoff"), "1");
    assert.equal(init?.method, "POST"); assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-key");
    assert.ok(init?.signal instanceof AbortSignal);
    calls.push(JSON.parse(String(init?.body)));
    if (timeout) throw new DOMException("fixture timeout after ambiguous launch", "TimeoutError");
    return Response.json(value, { status });
  };
  try {
    await run({ calls, call: (body = {}, key = "test-key") => handler(new Request("https://db.test/functions/v1/extract-bat-core", {
      method: "POST", headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "live_stream", ...body }),
    })), reply: (next, code = 202) => { value = next; status = code; timeout = false; }, fail: () => { timeout = true; } });
  } finally {
    globalThis.fetch = fetch;
    if (runtime === undefined) delete (globalThis as any).EdgeRuntime; else (globalThis as any).EdgeRuntime = runtime;
    keys.forEach((k, i) => { if (saved[i] === undefined) Deno.env.delete(k); else Deno.env.set(k, saved[i]!); });
  }
}

Deno.test("actual core live-stream handler makes one authenticated handoff and keeps acceptance distinct from completion", () => fixture(async f => {
  const response = await f.call(), body = await response.json();
  assert.equal(response.status, 202); assert.equal(body.success, true); assert.equal(body.accepted, true);
  assert.equal(body.mode, "live_stream"); assert.equal(body.collector_run_id, runId); assert.equal(body.selected_lots, 1);
  assert.equal(body.collector_duration_seconds, 115); assert.equal(body.model_calls, 0); assert.equal(body.targets, undefined);
  assert.deepEqual(f.calls, [{ mode: BAT_LIVE_COLLECT_MODE, dry_run: false }]);
}));

Deno.test("actual core dry-run preserves the target manifest and idle keeps its legacy response contract", () => fixture(async f => {
  f.reply({ success: true, mode: BAT_LIVE_COLLECT_MODE, dry_run: true, accepted: false,
    collector_run_id: null, selected_lots: 1, collector_duration_seconds: 115, transport: "public_pusher", targets: [target] }, 200);
  const preview = await f.call({ dry_run: true }), body = await preview.json();
  assert.equal(preview.status, 200); assert.equal(body.accepted, false); assert.deepEqual(body.targets, [target]);
  assert.deepEqual(f.calls, [{ mode: BAT_LIVE_COLLECT_MODE, dry_run: true }]);
  f.reply({ success: true, mode: BAT_LIVE_COLLECT_MODE, dry_run: false, accepted: false,
    collector_run_id: null, selected_lots: 0, collector_duration_seconds: 115, transport: "public_pusher" }, 200);
  const idle = await f.call(), idleBody = await idle.json();
  assert.equal(idle.status, 202); assert.equal(idleBody.accepted, false); assert.equal(idleBody.selected_lots, 0);
}));

Deno.test("core service guard and selector validation refuse before any handoff", () => fixture(async f => {
  assert.equal((await f.call({}, null)).status, 401);
  for (const body of [{ targets: [] }, { duration: 1 }, { url: "https://example.invalid" }, { dry_run: "true" }])
    assert.equal((await f.call(body)).status, 500);
  assert.equal(f.calls.length, 0);
}));

Deno.test("core refuses malformed child acceptance and never automatically retries ambiguous launch", () => fixture(async f => {
  for (const value of [{ success: true }, { success: false }, { success: true, mode: BAT_LIVE_COLLECT_MODE,
    dry_run: false, accepted: true, collector_run_id: null, selected_lots: 1, collector_duration_seconds: 115, transport: "public_pusher" }]) {
    const before = f.calls.length; f.reply(value);
    const response = await f.call(), body = await response.json();
    assert.equal(response.status, 500); assert.notEqual(body.success, true); assert.equal(f.calls.length, before + 1);
  }
  const before = f.calls.length; f.fail();
  const response = await f.call(), body = await response.json();
  assert.equal(response.status, 500); assert.notEqual(body.success, true); assert.equal(f.calls.length, before + 1);
}));

Deno.test("native core path contains no target reader, collector or privileged admission invocation", async () => {
  const code = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const native = code.slice(code.indexOf('if (body?.mode === "live_stream")'), code.indexOf('if (body?.mode === "description_source")'));
  assert.ok(native.includes("handoffBatLiveCollection"));
  assert.doesNotMatch(native, /closingBatTargets|collectBatLive|batStreamIO|createClient|\.from\(|\.rpc\(/);
  const transport = await Deno.readTextFile(new URL("./liveStream.ts", import.meta.url));
  assert.doesNotMatch(transport, /ingestBatLive\s*\(|ingest_bat_live_events\s*\(/);
});
