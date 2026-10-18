import { strict as assert } from "node:assert";
import fixture from "../_shared/batLiveEvents.fixture.json" with { type: "json" };

const saved = [Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")];
Deno.env.set("SUPABASE_URL", "https://db.test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");
let handler: (req: Request) => Promise<Response>;
const serve = Deno.serve;
(Deno as any).serve = (fn: typeof handler) => { handler = fn; };
await import("./index.ts");
Deno.serve = serve;

Deno.test("native bidder link reaches the existing source-bound RPC through the actual HTTP intake", async () => {
  Deno.env.set("SUPABASE_URL", "https://db.test");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");
  const original = globalThis.fetch;
  const monitor = "00000000-0000-0000-0000-000000000001";
  const vehicle = "00000000-0000-0000-0000-000000000002";
  const source = "00000000-0000-0000-0000-000000000003";
  const data: Record<string, any> = { ...fixture.events[3].data };
  delete data.high_bidder_username;
  const frame = { ...fixture.events[3], data, monitored_auction_id: monitor, transport: "public_pusher" };
  const calls: any[] = [];
  const respond = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
  globalThis.fetch = async (resource, init) => {
    const url = new URL(typeof resource === "string" ? resource : resource instanceof URL ? resource.href : resource.url);
    assert.equal(url.hostname, "db.test");
    if (url.pathname === "/rest/v1/monitored_auctions") return respond([{ id: monitor, source_id: source, vehicle_id: vehicle, external_auction_url: fixture.source_url, stream_state: {} }]);
    if (url.pathname === "/rest/v1/live_auction_sources") return respond({ id: source });
    if (url.pathname === "/rest/v1/vehicles") return respond([{ id: vehicle, listing_url: fixture.source_url, origin_metadata: { source: "bat_auctions_page", external_id: String(fixture.post_id) } }]);
    assert.equal(url.pathname, "/rest/v1/rpc/ingest_bat_live_events");
    calls.push(JSON.parse(String((init as { body?: unknown } | undefined)?.body)));
    return respond({ recorded: 1, duplicates: 0 });
  };
  const request = (f = frame) => new Request("https://db.test/functions/v1/ingest-observation", { method: "POST", headers: { Authorization: "Bearer test-key", "Content-Type": "application/json" }, body: JSON.stringify({ mode: "bat_live_events_v1", frames: [f], heartbeats: [] }) });
  try {
    const response = await handler(request());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, recorded: 1, duplicates: 0 });
    assert.equal(calls.length, 1);
    const projected = calls[0].p_frames[0];
    assert.equal(projected.high_bidder, "JuergenJanzen");
    assert.equal(projected.vehicle_id, vehicle);
    assert.equal(projected.post_id, fixture.post_id);
    assert.equal(projected.kind, "listing");
    assert.equal(projected.clock_basis, "collector_receipt_time_publication_unknown");
    assert.deepEqual(JSON.parse(projected.raw_frame_json).data, data);
    assert.equal(projected.buyer, null);
    assert.equal(projected.sale_amount, null);
    assert.equal(projected.comment_row, null);
    assert.deepEqual(calls[0].p_heartbeats, []);
    assert.equal((await handler(request({ ...frame, data: { ...data, post_id: fixture.post_id + 1 } }))).status, 500);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = original;
    for (const [i, key] of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].entries()) {
      if (saved[i] === undefined) Deno.env.delete(key); else Deno.env.set(key, saved[i]!);
    }
  }
});
