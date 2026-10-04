import { strict as assert } from "node:assert";
import fixture from "./batLiveEvents.fixture.json" with { type: "json" };
import { BatLiveBuffer, prepareBatLiveFrame, type BatLiveFrame, type BatLiveTarget } from "./batLiveEvents.ts";
import { collectBatLive } from "../extract-bat-core/liveStream.ts";

const target: BatLiveTarget = { id: "00000000-0000-0000-0000-000000000001", vehicle_id: "00000000-0000-0000-0000-000000000002",
  post_id: fixture.post_id, source_url: fixture.source_url, last_comment_id: 0 };
const frames = fixture.events.map(f => ({ ...f, monitored_auction_id: target.id, transport: "public_pusher" as const }));

Deno.test("captured native bid and final record retain source clocks, identities and result", async () => {
  const bid = await prepareBatLiveFrame(frames[0], target);
  assert.equal(bid.current_bid, 30750);
  assert.equal(bid.kind, "bid");
  assert.equal(bid.observed_at, "2026-10-04T18:00:16.000Z");
  assert.equal(bid.received_at, "2026-10-04T18:00:16.586Z");
  assert.equal(bid.native_comment_id, 22780538);
  assert.equal(bid.outcome, null);
  const sold = await prepareBatLiveFrame(frames[4], target);
  assert.equal(sold.outcome, "sold");
  assert.equal(sold.sale_amount, 33000);
  assert.equal(sold.sale_at, "2026-10-04T18:08:34.000Z");
  assert.equal(sold.buyer, "JuergenJanzen");
  assert.deepEqual(JSON.parse(sold.raw_frame_json).data, frames[4].data);
});

Deno.test("end extension is recorded independently; source notices and expired clocks cannot mint a sale", async () => {
  const end = await prepareBatLiveFrame(frames[1], target);
  assert.equal(end.end_at, new Date(Number(frames[1].data.end_timestamp) * 1000).toISOString());
  assert.equal(end.clock_basis, "collector_receipt_time_publication_unknown");
  assert.equal(end.outcome, null);
  const notice = await prepareBatLiveFrame(frames[5], target);
  assert.equal(notice.outcome, null);
  assert.equal(notice.sale_amount, null);
});

Deno.test("native replay dedupes; source mismatch fails; unclocked raw comments persist without invented clocks", async () => {
  const first = await prepareBatLiveFrame(frames[0], target);
  const retry = await prepareBatLiveFrame({ ...frames[0], received_at: "2026-10-04T18:10:00Z", transport: "missed_comments" }, target);
  assert.equal(first.content_hash, retry.content_hash);
  assert.equal(first.comment_row!.content_hash, retry.comment_row!.content_hash);
  await assert.rejects(() => prepareBatLiveFrame(frames[0], { ...target, post_id: target.post_id + 1 }), /post_mismatch/);
  const unclocked = await prepareBatLiveFrame({ ...frames[0], data: { ...frames[0].data, comment: { ...frames[0].data.comment, timestamp: null } } }, target);
  assert.equal(unclocked.comment_row, null);
  assert.equal(unclocked.outcome, null);
  assert.equal(unclocked.clock_basis, "collector_receipt_time_publication_unknown");
  assert.equal(unclocked.projection_error, "native_comment_identity_or_source_clock_unqualified");
  assert.equal(JSON.parse(unclocked.raw_frame_json).data.comment.timestamp, null);
});

Deno.test("current metadata supports withdrawn bids and never substitutes catch-up comment counts", async () => {
  const high = await prepareBatLiveFrame(frames[3], target);
  assert.equal(high.current_bid, 33000);
  assert.equal(high.bid_count, 16);
  const canceled = await prepareBatLiveFrame({ ...frames[3], data: { ...frames[3].data, current_numeric: 31000, count: 15 } }, target);
  assert.equal(canceled.current_bid, 31000);
  assert.equal(canceled.bid_count, 15);
  const empty = await prepareBatLiveFrame({ ...frames[3], data: { ...frames[3].data, current_numeric: 0, count: 0 } }, target);
  assert.equal(empty.current_bid, 0);
  assert.equal(empty.bid_count, 0);
});

Deno.test("intake failure keeps every frame in order; bounded overflow is an error", async () => {
  let failed = true;
  const admitted: BatLiveFrame[] = [];
  const queue = new BatLiveBuffer(async f => { if (failed) throw new Error("database unavailable"); admitted.push(...f); }, 2);
  queue.push(frames[0]); queue.push(frames[1]);
  assert.throws(() => queue.push(frames[2]), /capacity_exceeded/);
  await assert.rejects(() => queue.flush(), /database unavailable/);
  assert.equal(queue.pending, 2);
  failed = false;
  await queue.flush();
  assert.deepEqual(admitted, [frames[0], frames[1]]);
  assert.equal(queue.pending, 0);
});

Deno.test("slow historical admission cannot stop socket pings or connected coverage heartbeats", async () => {
  let release!: () => void;
  const slowAdmission = new Promise<void>(resolve => { release = resolve; });
  let blocked = false, connections = 0, pings = 0;
  const heartbeatsDuringAdmission: any[] = [];
  const socket: any = { readyState: 1, close() { this.readyState = 3; this.onclose?.(); }, send(raw: string) {
    const f = JSON.parse(raw);
    if (f.event === "pusher:subscribe") queueMicrotask(() => this.onmessage({ data: JSON.stringify({
      event: "pusher_internal:subscription_succeeded", channel: f.data.channel, data: {} }) }));
    if (f.event === "pusher:ping") { pings++; queueMicrotask(() => this.onmessage({ data: JSON.stringify({ event: "pusher:pong", data: {} }) })); }
  } };
  const finishAdmission = setTimeout(() => release(), 3200);
  try {
    await collectBatLive([{ ...target }], {
      socket: () => { connections++; queueMicrotask(() => socket.onmessage({ data: JSON.stringify({ event: "pusher:connection_established", data: {} }) })); return socket; },
      admit: async (f, h) => {
        if (f.length) { blocked = true; await slowAdmission; blocked = false; }
        if (blocked) heartbeatsDuringAdmission.push(...h);
      },
      missed: async () => ({ comments: [], metadata: { post_id: target.post_id, current_numeric: 100, count: 1 } }),
    }, 3500);
    assert.equal(connections, 1);
    assert.ok(pings >= 4, "one-second source control continues during the blocked admission");
    assert.ok(heartbeatsDuringAdmission.filter(h => h.connected).length >= 3);
    assert.ok(heartbeatsDuringAdmission.every(h => h.error === null && h.pending > 0));
  } finally { clearTimeout(finishAdmission); release(); }
});

Deno.test("a stalled coverage acknowledgement cannot block source capture or spawn overlapping heartbeat requests", async () => {
  let release!: () => void;
  const stalledHeartbeat = new Promise<void>(resolve => { release = resolve; });
  let pings = 0, connections = 0, heartbeatCallsWhileStalled = 0, stalled = true;
  const socket: any = { readyState: 1, close() { this.readyState = 3; this.onclose?.(); }, send(raw: string) {
    const f = JSON.parse(raw);
    if (f.event === "pusher:subscribe") queueMicrotask(() => this.onmessage({ data: JSON.stringify({
      event: "pusher_internal:subscription_succeeded", channel: f.data.channel, data: {} }) }));
    if (f.event === "pusher:ping") { pings++; queueMicrotask(() => this.onmessage({ data: JSON.stringify({ event: "pusher:pong", data: {} }) })); }
  } };
  const unblock = setTimeout(() => { stalled = false; release(); }, 3200);
  try {
    await collectBatLive([{ ...target }], {
      socket: () => { connections++; queueMicrotask(() => socket.onmessage({ data: JSON.stringify({ event: "pusher:connection_established", data: {} }) })); return socket; },
      admit: async (_f, h) => { if (h.length && stalled) { heartbeatCallsWhileStalled++; await stalledHeartbeat; } },
      missed: async () => ({ comments: [], metadata: { post_id: target.post_id, current_numeric: 100, count: 1 } }),
    }, 3500);
    assert.equal(heartbeatCallsWhileStalled, 1);
    assert.equal(connections, 1);
    assert.ok(pings >= 4);
  } finally { clearTimeout(unblock); release(); }
});

Deno.test("public collector covers all 20 simultaneous closings and recovers on subscription", async () => {
  const targets = Array.from({ length: 20 }, (_, i) => ({ ...target,
    id: `00000000-0000-0000-0000-${String(i + 1).padStart(12,"0")}`, post_id: fixture.post_id + i }));
  const subscriptions: string[] = []; const recovered = new Set<number>(); const heartbeats: any[] = [];
  const socket: any = { readyState: 1, close() { this.readyState = 3; this.onclose?.(); }, send(raw: string) {
    const f = JSON.parse(raw);
    if (f.event === "pusher:subscribe") { subscriptions.push(f.data.channel);
      queueMicrotask(() => this.onmessage({ data: JSON.stringify({ event: "pusher_internal:subscription_succeeded", channel: f.data.channel, data: {} }) })); }
  } };
  await collectBatLive(targets, { socket: () => { queueMicrotask(() => socket.onmessage({ data: JSON.stringify({ event: "pusher:connection_established", data: {} }) })); return socket; },
    admit: async (_frames, h) => { heartbeats.push(...h); },
    missed: async t => { recovered.add(t.post_id); return { comments: [], metadata: { post_id: t.post_id, current_numeric: 100, count: 1 } }; } }, 1100);
  assert.equal(subscriptions.length, 60);
  assert.equal(recovered.size, 20);
  assert.equal(new Set(heartbeats.map(h => h.monitored_auction_id)).size, 20);
});
