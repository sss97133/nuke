import { strict as assert } from "node:assert";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { auctionReplayStore, decodeReplay, mergeReplay, MAX_REPLAY, type ReplayEntry, type AuctionRead } from "./auctionReplay.ts";

const id = "00000000-0000-4000-8000-000000000001";
const vehicle = "00000000-0000-4000-8000-000000000002";
const at = "2026-01-01T00:00:00Z";
const item = { itemId: "v1|100000000001|0", legacyItemId: "100000000001", itemEndDate: "2026-01-02T00:00:00Z",
  buyingOptions: ["AUCTION"], currentBidPrice: { value: "1234.50", currency: "USD" }, bidCount: 4,
  title: "Synthetic vehicle", seller: { username: "FixtureSeller", feedbackScore: 123 }, extraNativeField: { retained: true } };
const page: AuctionRead = { url: "https://api.ebay.com/buy/browse/v1/item_summary/search?sort=endingSoonest&offset=0",
  method: "search", readAt: at, items: [item], response: { total: 1, itemSummaries: [item], nativePageField: "preserved" } };
const candidate = { key: item.legacyItemId, vehicleId: vehicle, url: `https://www.ebay.com/itm/${item.legacyItemId}`, endAt: item.itemEndDate };
const entry: ReplayEntry = { ...candidate, snapshotId: id, sha256: "a".repeat(64), readAt: at, pageUrl: page.url, method: "search" };

Deno.test("queue convergence: repeated unchanged receipt is one item; acknowledged delivery drains to zero", () => {
  const first = mergeReplay([], [entry], []);
  assert.equal(mergeReplay(first.entries, [entry], []).entries.length, 1);
  assert.equal(mergeReplay(first.entries, [], [entry]).entries.length, 0);
  assert.equal(mergeReplay([], [entry], [entry]).entries.length, 0);
});
Deno.test("newer queued state fences stale acknowledgements and late older captures without deleting native history", () => {
  const newer = { ...entry, readAt: "2026-01-01T01:00:00Z", snapshotId: "00000000-0000-4000-8000-000000000003" };
  assert.deepEqual(mergeReplay([entry], [newer], [entry]).entries, [newer]);
  assert.deepEqual(mergeReplay([newer], [entry], [entry]).entries, [newer]);
  assert.deepEqual(mergeReplay([newer], [], [entry]).entries, [newer]);
  assert.throws(() => mergeReplay([entry], [{ ...entry, sha256: "b".repeat(64) }], []), /same-clock capture conflict/);
  assert.throws(() => mergeReplay([entry], [{ ...newer, vehicleId: "00000000-0000-4000-8000-000000000004" }], []), /identity conflict/);
});
Deno.test("queue cap keeps closing priority and reports overflow; malformed state cannot be overwritten", () => {
  const entries = Array.from({ length: MAX_REPLAY + 2 }, (_, n) => ({ ...entry,
    key: String(100000000000 + n), url: `https://www.ebay.com/itm/${100000000000 + n}`,
    endAt: new Date(Date.parse(at) + (MAX_REPLAY + 2 - n) * 60000).toISOString() }));
  const result = mergeReplay([], entries, []);
  assert.equal(result.entries.length, MAX_REPLAY); assert.equal(result.overflow, 2);
  assert.equal(result.entries[0].key, entries.at(-1)!.key);
  assert.throws(() => decodeReplay({ version: 1, entries: [entry, entry] }));
  assert.throws(() => decodeReplay({ version: 2, entries: [] }));
});

function database(options: { corrupt?: boolean; rejectInsert?: boolean; race?: boolean; deleted?: boolean } = {}) {
  let stored: any, state: any = null, patches = 0;
  const mutations: string[] = [];
  const db = createClient("https://synthetic.supabase.co", "synthetic-key", { auth: { persistSession: false }, global: {
    fetch: async (request: any, init: any) => {
      const url = new URL(String(request)), method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(init.body) : null;
      if (method !== "GET") mutations.push(`${method} ${url.pathname}`);
      if (url.pathname.includes("/rpc/ebay_deleted_member_hashes")) return Response.json(options.deleted ? body.p_hashes : []);
      if (url.pathname.endsWith("listing_page_snapshots")) {
        if (method === "POST") { stored = body; return options.rejectInsert
          ? Response.json({ code: "XX000" }, { status: 500 }) : Response.json({ id }); }
        return Response.json([{ ...stored, id, html: options.corrupt ? "changed retained bytes" : stored.html }]);
      }
      if (url.pathname.endsWith("system_state")) {
        if (method === "GET") return Response.json(state ? [state] : []);
        if (method === "POST") { state = body; return Response.json([{ key: body.key }]); }
        patches++;
        if (options.race && patches === 1) {
          state = { ...state, updated_at: "2026-01-01T02:00:00Z", value: { version: 1,
            entries: [{ ...entry, readAt: "2026-01-01T01:00:00Z", snapshotId: "00000000-0000-4000-8000-000000000003" }] } };
          return Response.json([]);
        }
        assert.equal(url.searchParams.get("updated_at"), `eq.${state.updated_at}`);
        state = body; return Response.json([{ key: body.key }]);
      }
      throw Error(`unexpected fixture request ${url.pathname}`);
    },
  } });
  return { db, stored: () => stored, state: () => state, mutations };
}
Deno.test("full native page retains source clock/hash and exact member, using existing deletion handling", async () => {
  for (const deleted of [false, true]) {
    const f = database({ deleted }), store = auctionReplayStore(f.db), deadline = Date.now() + 5000;
    const entries = await store.retain(page, [candidate], deadline);
    const native = await store.summary(entries[0], deadline);
    assert.equal(native.currentBidPrice?.value, "1234.50"); assert.equal(entries[0].readAt, at);
    const retained = JSON.parse(f.stored().html);
    assert.equal(retained.page_read_at, at); assert.equal(retained.response.nativePageField, "preserved");
    assert.deepEqual(native.extraNativeField, { retained: true });
    assert.deepEqual(native.seller, deleted ? {} : item.seller);
    if (!deleted) assert.deepEqual(retained.response, page.response);
    assert.equal(f.mutations.filter(m => m.includes("ebay_deleted_member_hashes")).length, 1);
    assert.ok(Array.isArray(f.stored().metadata.member_handles_sha256));
    await assert.rejects(() => store.summary({ ...entries[0], sha256: "b".repeat(64) }, deadline), /cached receipt differs/);
  }
});
Deno.test("batch fast path preserves explicit seller deletion outside handle regex grammar", async () => {
  const f = database({ deleted: true }), store = auctionReplayStore(f.db), deadline = Date.now() + 5000;
  const special = { ...item, seller: { username: "x", feedbackScore: 2 } };
  const native = { ...page, items: [special], response: { ...page.response, itemSummaries: [special] } };
  const retained = await store.retain(native, [candidate], deadline);
  assert.deepEqual((await store.summary(retained[0], deadline)).seller, {});
});

Deno.test("archive failure, changed bytes, source-clock and byte limits refuse replay", async () => {
  for (const options of [{ rejectInsert: true }, { corrupt: true }]) {
    const store = auctionReplayStore(database(options).db);
    await assert.rejects(() => store.retain(page, [candidate], Date.now() + 5000));
  }
  const f = database(), store = auctionReplayStore(f.db);
  await assert.rejects(() => store.retain({ ...page, readAt: "2999-01-01T00:00:00Z" }, [candidate], Date.now() + 5000));
  await assert.rejects(() => store.retain({ ...page, response: { extra: "x".repeat(2_097_152) } }, [candidate], Date.now() + 5000), /byte cap/);
  assert.equal(f.mutations.filter(x => x.includes("listing_page_snapshots")).length, 0);
  await assert.rejects(() => store.load(Date.now() - 1), /deadline/);
});
Deno.test("state CAS retries merge against newer writer, never clobbers its queued receipt", async () => {
  const f = database({ race: true }), store = auctionReplayStore(f.db), deadline = Date.now() + 5000;
  assert.deepEqual(await store.merge([entry], [], deadline), { pending: 1, overflow: 0 });
  assert.deepEqual(await store.merge([], [entry], deadline), { pending: 1, overflow: 0 });
  assert.equal((await store.load(deadline))[0].readAt, "2026-01-01T01:00:00Z");
  assert.equal(f.mutations.some(x => x.startsWith("DELETE")), false);
});
