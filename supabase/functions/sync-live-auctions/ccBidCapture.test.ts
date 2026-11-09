import { strict as assert } from "node:assert";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { ccBidObservation } from "./boards.ts";
import { retainCcBidCapture } from "./ccBidCapture.ts";
import { postObservations } from "./postObservations.ts";

const snapshot = "00000000-0000-4000-8000-000000000001";
const vehicle = "00000000-0000-4000-8000-000000000002";
const receivedAt = "2026-01-02T03:04:05.678Z";
const document = { auctionId: 123, slug: "synthetic-car", lotType: "car", stage: "live",
  currentBid: 5500, noBids: 13, currencyCode: "aud", dtStageEndsUTC: "2026-01-05 06:25:00",
  features: { mileage: "123,456", driveSide: "right" }, taxonomyId: "retained-native-id",
  embedding: [0.123, 0.456], sellerBadges: ["native-badge"], unknownNativeField: { nested: "preserved" } };
const post = ccBidObservation({ url: "https://collectingcars.com/for-sale/synthetic-car", external_id: "123",
  current_bid: 5500, bid_count: 13, currency: "aud", ends: "2026-01-05T06:25:00.000Z" }, vehicle, receivedAt)!;

function fixture(options: { held?: boolean; insertError?: string; corrupt?: boolean; duplicate?: boolean; oldClock?: string } = {}) {
  const calls: string[] = []; let stored: any;
  const db = createClient("https://synthetic.supabase.co", "synthetic-key", { auth: { persistSession: false }, global: {
    fetch: async (request: any, init: any) => {
      const url = new URL(String(request)), method = init?.method ?? "GET";
      calls.push(`${method} ${url.pathname}`);
      if (url.pathname.endsWith("vehicle_observations"))
        return Response.json(options.held ? [{ source_identifier: post.source_identifier }] : []);
      if (method === "POST") {
        stored = JSON.parse(init.body);
        if (options.insertError || options.duplicate) return Response.json({ code: options.insertError ?? "23505" }, { status: 409 });
        return Response.json({ id: snapshot });
      }
      return Response.json([{ ...stored, id: snapshot,
        html: options.corrupt ? "unrelated retained body" : stored.html,
        fetched_at: options.oldClock ?? stored.fetched_at }]);
    },
  } });
  return { db, calls, stored: () => stored };
}

Deno.test("CC retains every native document field and binds exact amount, currency and source-read clock", async () => {
  const f = fixture();
  const result = await retainCcBidCapture(f.db, post, { document, receivedAt });
  assert.deepEqual(JSON.parse(f.stored().html), document);
  assert.equal(f.stored().metadata.representation, "complete_selected_document_json_not_wire_response");
  assert.equal(result.raw_source_ref, `listing_page_snapshots:${snapshot}`);
  assert.equal(result.observed_at, receivedAt);
  assert.equal(result.structured_data.currency, "AUD");
  assert.equal(result.structured_data.clock, "board_read");
  assert.equal(result.extraction_metadata?.source_event_time, null);
  assert.deepEqual(result.structured_data, post.structured_data); // Existing observation identity stays stable.
  assert.equal(result.source_identifier, post.source_identifier);
});
Deno.test("CC exact duplicate archive keeps original capture clock and current response clock separate", async () => {
  const oldClock = "2026-01-02T03:00:00Z", f = fixture({ duplicate: true, oldClock });
  const result = await retainCcBidCapture(f.db, post, { document, receivedAt });
  assert.equal(result.observed_at, receivedAt);
  assert.equal((result.extraction_metadata?.source_capture as any)?.fetched_at, oldClock);
  assert.equal((result.extraction_metadata?.source_capture as any)?.archive_status, "existing");
  assert.equal((result.extraction_metadata?.source_capture as any)?.source_read_at, receivedAt);
  assert.equal(result.extraction_metadata?.received_at, receivedAt);
});
Deno.test("CC refuses cross-lot, amount, count, currency, end, kind and future-clock substitutions before archive", async () => {
  for (const patch of [{ slug: "other" }, { auctionId: 999 }, { currentBid: 6000 }, { noBids: 14 },
    { currencyCode: "USD" }, { dtStageEndsUTC: "2026-01-06 06:25:00" }, { lotType: "plate" }, { stage: "sold" }]) {
    const f = fixture();
    await assert.rejects(() => retainCcBidCapture(f.db, post, { document: { ...document, ...patch }, receivedAt }));
    assert.equal(f.calls.length, 0);
  }
  await assert.rejects(() => retainCcBidCapture(fixture().db, post, { document, receivedAt: "2999-01-01T00:00:00Z" }));
});
Deno.test("CC archive failure or hash mismatch never reaches admission; held observations cause no archive or duplicate post", async () => {
  const original = globalThis.fetch; const requests: any[] = [];
  globalThis.fetch = async (_request, init) => { requests.push(JSON.parse(String(init?.body))); return Response.json({ success: true, observation_id: snapshot }); };
  try {
    for (const options of [{ insertError: "XX000" }, { corrupt: true }, { held: true }]) {
      const f = fixture(options);
      const r = await postObservations(f.db, [post], Date.now() + 5000, 40,
        p => retainCcBidCapture(f.db, p, { document, receivedAt }));
      assert.equal(r.posted, 0); assert.equal(requests.length, 0);
      if (options.held) { assert.equal(r.held, 1); assert.equal(f.calls.length, 1); }
      else assert.equal(r.errors.length, 1);
    }
  } finally { globalThis.fetch = original; }
});
Deno.test("CC source archive then canonical request keeps full capture link; HTTP200 failure is not admitted", async () => {
  const original = globalThis.fetch; const requests: any[] = []; let accepted = true;
  globalThis.fetch = async (_request, init) => { requests.push(JSON.parse(String(init?.body))); return Response.json(accepted
    ? { success: true, observation_id: snapshot } : { success: false, error: "admission refused" }); };
  try {
    const f = fixture();
    const run = () => postObservations(f.db, [post], Date.now() + 5000, 40,
      p => retainCcBidCapture(f.db, p, { document, receivedAt }));
    assert.equal((await run()).posted, 1);
    assert.equal(requests[0].raw_source_ref, `listing_page_snapshots:${snapshot}`);
    assert.equal(requests[0].structured_data.amount, 5500);
    assert.equal(requests[0].extraction_metadata.capture_kind, "auction_bid_snapshot");
    accepted = false;
    const denied = await run(); assert.equal(denied.posted, 0); assert.equal(denied.errors.length, 1);
  } finally { globalThis.fetch = original; }
});

Deno.test("post cap and archive-deadline deferrals account for every unposted candidate", async () => {
  const original = globalThis.fetch, clock = Date.now;
  const posts = Array.from({ length: 50 }, (_, i) => ({ ...post, source_identifier: `synthetic:${i}` }));
  globalThis.fetch = async () => Response.json({ success: true, observation_id: snapshot });
  try {
    const capped = await postObservations(fixture().db, posts, Date.now() + 5000, 40);
    assert.equal(capped.posted, 40); assert.equal(capped.deferred, 10);
    let now = 100;
    Date.now = () => now;
    const expired = await postObservations(fixture().db, posts, 200, 40, async p => { now = 201; return p; });
    assert.equal(expired.posted, 0); assert.equal(expired.deferred, 50);
  } finally { globalThis.fetch = original; Date.now = clock; }
});

Deno.test("CC v2 current captures converge within40 slots without replacing or being suppressed by legacy testimony", async () => {
  const legacyId = "collecting-cars-bid:123:13:5500";
  const held = new Set([legacyId]);
  const posts = Array.from({ length: 45 }, (_, i) => ({ ...post, source_identifier: `${post.source_identifier}:fixture${i}` }));
  const db: any = { from: () => {
    let requested: string[] = [];
    const q: any = new Proxy({}, { get: (_t, k) => k === "then" ? (resolve: any) => resolve({ error: null,
      data: requested.filter(id => held.has(id)).map(source_identifier => ({ source_identifier })) })
      : (...args: any[]) => { if (k === "in") requested = args[1]; return q; } }); return q;
  } };
  const original = globalThis.fetch; let preparations = 0;
  globalThis.fetch = async (_url, init) => {
    const p = JSON.parse(String(init?.body)); held.add(p.source_identifier);
    assert.equal(p.observed_at, receivedAt);
    return Response.json({ success: true, observation_id: snapshot });
  };
  try {
    const prepare = async (p: typeof post) => { preparations++; return p; };
    const first = await postObservations(db, posts, Date.now() + 5000, 40, prepare);
    assert.deepEqual([first.posted, first.deferred, first.held], [40, 5, 0]);
    const second = await postObservations(db, posts, Date.now() + 5000, 40, prepare);
    assert.deepEqual([second.posted, second.deferred, second.held], [5, 0, 40]);
    const third = await postObservations(db, posts, Date.now() + 5000, 40, prepare);
    assert.deepEqual([third.posted, third.held, preparations], [0, 45, 45]);
    assert.equal(held.has(legacyId), true);
  } finally { globalThis.fetch = original; }
});
