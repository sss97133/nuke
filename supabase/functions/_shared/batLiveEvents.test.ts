import { strict as assert } from "node:assert";
import fixture from "./batLiveEvents.fixture.json" with { type: "json" };
import { BatLiveBuffer, prepareBatLiveFrame, type BatLiveFrame, type BatLiveTarget } from "./batLiveEvents.ts";
import { collectBatLive } from "../extract-bat-core/liveStream.ts";

const target: BatLiveTarget = { id: "00000000-0000-0000-0000-000000000001", vehicle_id: "00000000-0000-0000-0000-000000000002",
  post_id: fixture.post_id, source_url: fixture.source_url, last_comment_id: 0 };
const frames = fixture.events.map(f => ({ ...f, monitored_auction_id: target.id, transport: "public_pusher" as const }));

// Control the collector's clock and waits together. Real one-second timers can
// wake just before its threshold, making short fixtures skip a heartbeat/ping.
async function withCollectorClock(run:()=>Promise<void>) {
  const realNow=Date.now,realSetTimeout=globalThis.setTimeout,realClearTimeout=globalThis.clearTimeout;
  let now=realNow(),nextId=0,pump:ReturnType<typeof globalThis.setTimeout>|undefined;
  const timers=new Map<number,{at:number;run:()=>void}>();
  const schedule=()=>{
    if(pump!==undefined||!timers.size)return;
    pump=realSetTimeout(()=>{
      pump=undefined;
      const next=[...timers].sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];
      if(next){timers.delete(next[0]);now=Math.max(now,next[1].at);next[1].run();}
      schedule();
    },0);
  };
  Date.now=()=>now;
  globalThis.setTimeout=((handler:Parameters<typeof setTimeout>[0],delay=0,...args:unknown[])=>{
    assert.equal(typeof handler,"function");
    const id=++nextId;
    timers.set(id,{at:now+Math.max(0,delay),run:()=>{(handler as (...args:unknown[])=>void)(...args);}});
    schedule();return id;
  }) as unknown as typeof globalThis.setTimeout;
  globalThis.clearTimeout=(id)=>{if(typeof id==="number")timers.delete(id);};
  try { await run(); }
  finally {
    if(pump!==undefined)realClearTimeout(pump);
    Date.now=realNow;globalThis.setTimeout=realSetTimeout;globalThis.clearTimeout=realClearTimeout;
  }
}

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

Deno.test("native member link supplies the current bidder alias while preserving the original frame", async () => {
  const data: Record<string, any> = { ...frames[3].data };
  delete data.high_bidder_username;
  const original = JSON.stringify(data);
  for (const link of [data.high_bidder_link, 'by <a href="https://bringatrailer.com/member/example_bidder/" target="_blank">Example_Bidder</a>']) {
    const frame = { ...frames[3], data: { ...data, high_bidder_link: link } };
    const projection = await prepareBatLiveFrame(frame, target);
    assert.equal(projection.high_bidder, link === data.high_bidder_link ? "JuergenJanzen" : "Example_Bidder");
    assert.deepEqual(JSON.parse(projection.raw_frame_json).data, frame.data);
    assert.equal(projection.clock_basis, "collector_receipt_time_publication_unknown");
    assert.equal(projection.observed_at, frame.received_at);
    assert.equal(projection.buyer, null);
    assert.equal(projection.outcome, null);
    assert.equal(projection.comment_row, null);
    assert.equal(projection.projection_error, null);
    assert.equal((await prepareBatLiveFrame(frame, target)).content_hash, projection.content_hash);
  }
  assert.equal(JSON.stringify(data), original);
});

Deno.test("member-link fallback refuses ambiguous, mismatched and nonnative aliases", async () => {
  const link = 'by <a href="https://bringatrailer.com/member/example_bidder/" target="_blank">Example_Bidder</a>';
  const data: Record<string, any> = { ...frames[3].data };
  delete data.high_bidder_username;
  for (const bad of [null, {}, "", link.replace("https:", "http:"), link.replace("bringatrailer.com/", "bringatrailer.com.evil/"),
    link.replace("example_bidder/", "different/"), link.replace("example_bidder/", "example_bidder/?x=1"),
    link.replace("example_bidder/", "example_bidder/#x"), link.replace("example_bidder/", "%65xample_bidder/"),
    link.replace("https://", "https://user@"), link + link, link + " trailing", link.replace("Example_Bidder</a>", "<b>Example_Bidder</b></a>"),
    link.replace("Example_Bidder</a>", "Example&amp;Bidder</a>"), link.replace("by ", "winner "), "x".repeat(1025)]) {
    const frame = { ...frames[3], data: { ...data, high_bidder_link: bad } };
    const projection = await prepareBatLiveFrame(frame, target);
    assert.equal(projection.high_bidder, null);
    assert.equal(projection.current_bid, 33000);
    assert.equal(projection.bid_count, 16);
    assert.deepEqual(JSON.parse(projection.raw_frame_json).data, frame.data);
  }
  assert.equal((await prepareBatLiveFrame({ ...frames[3], data: { ...data, high_bidder_link: link, high_bidder_username: "Native_Typed_Alias" } }, target)).high_bidder, "Native_Typed_Alias");
  assert.equal((await prepareBatLiveFrame({ ...frames[2], data: { ...frames[2].data, high_bidder_link: link } }, target)).high_bidder, null);
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

Deno.test("one rejected lot retains its ordered frames without blocking another lot", async () => {
  const badId = target.id;
  const goodId = "00000000-0000-0000-0000-000000000003";
  let rejected = true;
  const admitted: BatLiveFrame[] = [];
  const failedFrames = Array.from({ length: 60 }, (_, i) => ({ ...frames[0], data: { sequence: i } }));
  const goodFrames = [frames[1], frames[4]].map(f => ({ ...f, monitored_auction_id: goodId }));
  const queue = new BatLiveBuffer(async batch => {
    assert.equal(new Set(batch.map(f => f.monitored_auction_id)).size, 1);
    assert.ok(batch.length <= 50);
    if (rejected && batch[0].monitored_auction_id === badId) throw new Error("canonical vehicle auction event missing");
    admitted.push(...batch);
  });
  failedFrames.forEach(f => queue.push(f));
  goodFrames.forEach(f => queue.push(f));
  await assert.rejects(() => queue.flush(), /canonical vehicle auction event missing/);
  assert.deepEqual(admitted, goodFrames);
  assert.equal(queue.pending, failedFrames.length);
  assert.equal(queue.statusFor(badId).pending, failedFrames.length);
  assert.match(queue.statusFor(badId).error!, /canonical vehicle auction event missing/);
  assert.deepEqual(queue.statusFor(goodId), { pending: 0, oldestReceivedAt: null, error: null });
  rejected = false;
  await queue.flush();
  assert.deepEqual(admitted, [...goodFrames, ...failedFrames]);
  assert.equal(queue.pending, 0);
  assert.equal(queue.statusFor(badId).error, null);
});

Deno.test("a collector reports admission lag and failure only on the rejected lot", () => withCollectorClock(async () => {
  const good = { ...target, id: "00000000-0000-0000-0000-000000000003", post_id: target.post_id + 1 };
  const heartbeats: any[] = [];
  const admitted: BatLiveFrame[] = [];
  const socket: any = { readyState: 1, close() { this.readyState = 3; this.onclose?.(); }, send(raw: string) {
    const f = JSON.parse(raw);
    if (f.event === "pusher:subscribe") queueMicrotask(() => this.onmessage({ data: JSON.stringify({
      event: "pusher_internal:subscription_succeeded", channel: f.data.channel, data: {} }) }));
    if (f.event === "pusher:ping") queueMicrotask(() => this.onmessage({ data: JSON.stringify({ event: "pusher:pong", data: {} }) }));
  } };
  await assert.rejects(() => collectBatLive([{ ...target }, good], {
    socket: () => { queueMicrotask(() => socket.onmessage({ data: JSON.stringify({ event: "pusher:connection_established", data: {} }) })); return socket; },
    admit: async (batch, h) => {
      heartbeats.push(...h);
      if (batch.some(f => f.monitored_auction_id === target.id)) throw new Error("live_intake_http_500");
      admitted.push(...batch);
    },
    missed: async t => ({ comments: [], metadata: { post_id: t.post_id, current_numeric: 100, count: 1 } }),
  }, 2100), /live_intake_http_500/);
  assert.equal(admitted.filter(f => f.monitored_auction_id === good.id).length, 1);
  assert.ok(heartbeats.some(h => h.monitored_auction_id === target.id && h.pending > 0 && h.error?.includes("live_intake_http_500")));
  assert.ok(heartbeats.some(h => h.monitored_auction_id === good.id && h.connected && h.pending === 0 && h.error === null));
}));

Deno.test("arrivals during admission survive acknowledgement even when the same frame object is reused", async () => {
  let appended = false;
  const sizes: number[] = [];
  const queue = new BatLiveBuffer(async batch => {
    sizes.push(batch.length);
    if (!appended) { appended = true; queue.push(frames[0]); }
  });
  for (let i = 0; i < 50; i++) queue.push(frames[0]);
  await queue.flush();
  assert.deepEqual(sizes, [50, 1]);
  assert.equal(queue.pending, 0);
});

Deno.test("slow historical admission cannot stop socket pings or connected coverage heartbeats", () => withCollectorClock(async () => {
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
}));

Deno.test("a stalled coverage acknowledgement cannot block source capture or spawn overlapping heartbeat requests", () => withCollectorClock(async () => {
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
}));

Deno.test("public collector covers all 20 simultaneous closings and recovers on subscription", () => withCollectorClock(async () => {
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
}));

Deno.test("one bid arriving by three transports with differently shaped frames is one observation key", async () => {
  const pusher = await prepareBatLiveFrame({ ...frames[0], transport: "public_pusher" }, target);
  const missed = await prepareBatLiveFrame({ ...frames[0], transport: "missed_comments", received_at: "2026-10-04T18:01:30Z",
    data: { ...frames[0].data, extra_transport_field: "x", comment: { ...frames[0].data.comment, likes: 3 } } }, target);
  const html = await prepareBatLiveFrame({ ...frames[0], transport: "direct_html", received_at: "2026-10-04T18:05:00Z",
    data: { post_id: frames[0].data.post_id, comment: frames[0].data.comment } }, target);
  assert.equal(pusher.kind, "bid");
  assert.equal(pusher.content_hash, missed.content_hash);
  assert.equal(pusher.content_hash, html.content_hash);
  assert.equal(pusher.source_identifier, missed.source_identifier);
  assert.equal(pusher.source_identifier, html.source_identifier);
  // a different bid (different comment id) still gets its own key
  const other = await prepareBatLiveFrame(frames[1], target);
  assert.notEqual(other.source_identifier, pusher.source_identifier);
});

// Move Date.now by hand; the buffer reads its waits from the same clock the collector uses.
async function withClock(start: number, run: (at: (ms: number) => void) => Promise<void>) {
  const realNow = Date.now;
  let now = start;
  Date.now = () => now;
  try { await run(ms => { now = start + ms; }); } finally { Date.now = realNow; }
}

Deno.test("a lot the intake keeps rejecting waits longer before each retry; a success starts it over", () => withClock(1_000_000, async at => {
  let rejecting = true, attempts = 0;
  const queue = new BatLiveBuffer(async () => { attempts++; if (rejecting) throw new Error("canonical vehicle auction event missing"); },
    5000, { baseMs: 1000, maxMs: 30000 });
  queue.push(frames[0]);
  const attemptedAt: number[] = [];
  for (let s = 0; s <= 140; s++) {
    at(s * 1000);
    const before = attempts;
    await queue.flush().catch(() => {});
    if (attempts > before) attemptedAt.push(s);
  }
  // 1, 2, 4, 8, 16 seconds, then the 30 second cap: 9 attempts in 140 seconds instead of 141.
  assert.deepEqual(attemptedAt, [0, 1, 3, 7, 15, 31, 61, 91, 121]);
  assert.equal(queue.pending, 1);
  assert.match(queue.statusFor(target.id).error!, /canonical vehicle auction event missing/);
  rejecting = false;
  at(151_000);
  await queue.flush();
  assert.equal(queue.pending, 0);
  assert.equal(queue.statusFor(target.id).error, null);
  rejecting = true;
  queue.push(frames[0]);
  at(152_000);
  await queue.flush().catch(() => {});
  const before = attempts;
  at(153_000);
  await queue.flush().catch(() => {});
  assert.equal(attempts, before + 1, "after a success the next failure waits one second again, not thirty");
}));

Deno.test("a lot inside its wait does not hold back another lot; a forced flush attempts it anyway", () => withClock(2_000_000, async at => {
  const badId = target.id, goodId = "00000000-0000-0000-0000-000000000003";
  const seen: string[] = [];
  const queue = new BatLiveBuffer(async batch => {
    seen.push(batch[0].monitored_auction_id);
    if (batch[0].monitored_auction_id === badId) throw new Error("live source/parent binding mismatch");
  }, 5000, { baseMs: 1000, maxMs: 30000 });
  queue.push(frames[0]);
  at(0);
  await queue.flush().catch(() => {});
  assert.deepEqual(seen, [badId]);
  queue.push({ ...frames[1], monitored_auction_id: goodId });
  at(500);
  await queue.flush();
  assert.deepEqual(seen, [badId, goodId], "the other lot drains while the bad lot waits");
  assert.equal(queue.statusFor(goodId).pending, 0);
  assert.equal(queue.statusFor(badId).pending, 1);
  assert.match(queue.statusFor(badId).error!, /binding mismatch/);
  await assert.rejects(() => queue.flush({ force: true }), /binding mismatch/);
  assert.deepEqual(seen, [badId, goodId, badId], "the worker's last flush ignores the wait");
  assert.equal(queue.pending, 1);
}));

Deno.test("without a retry policy a rejected lot is retried on every flush", async () => {
  let attempts = 0;
  const queue = new BatLiveBuffer(async () => { attempts++; throw new Error("database unavailable"); });
  queue.push(frames[0]);
  for (let i = 0; i < 5; i++) await queue.flush().catch(() => {});
  assert.equal(attempts, 5);
});

Deno.test("a collector retries a lot the intake keeps rejecting with growing waits, not every second", () => withCollectorClock(async () => {
  const good = { ...target, id: "00000000-0000-0000-0000-000000000003", post_id: target.post_id + 1 };
  const attempts: Record<string, number> = { [target.id]: 0, [good.id]: 0 };
  const socket: any = { readyState: 1, close() { this.readyState = 3; this.onclose?.(); }, send(raw: string) {
    const f = JSON.parse(raw);
    if (f.event === "pusher:subscribe") queueMicrotask(() => this.onmessage({ data: JSON.stringify({
      event: "pusher_internal:subscription_succeeded", channel: f.data.channel, data: {} }) }));
    if (f.event === "pusher:ping") queueMicrotask(() => this.onmessage({ data: JSON.stringify({ event: "pusher:pong", data: {} }) }));
  } };
  await assert.rejects(() => collectBatLive([{ ...target }, good], {
    socket: () => { queueMicrotask(() => socket.onmessage({ data: JSON.stringify({ event: "pusher:connection_established", data: {} }) })); return socket; },
    admit: async batch => {
      if (!batch.length) return;
      attempts[batch[0].monitored_auction_id]++;
      if (batch[0].monitored_auction_id === target.id) throw new Error("live_intake_http_500");
    },
    missed: async t => ({ comments: [], metadata: { post_id: t.post_id, current_numeric: 100, count: 1 } }),
  }, 40_000), /live_intake_http_500/);
  // One attempt a second for 40 seconds before this change; now 1, 2, 4, 8, 16 second waits plus the final flush.
  assert.ok(attempts[target.id] >= 5 && attempts[target.id] <= 9, `rejected lot attempts: ${attempts[target.id]}`);
  assert.ok(attempts[good.id] >= 1, "the other lot is admitted");
}));
