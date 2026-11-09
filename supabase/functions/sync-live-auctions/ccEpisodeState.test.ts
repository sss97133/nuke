import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { ccBidObservation } from "./boards.ts";
import { ccEpisodeRow, projectCcEpisodes } from "./ccEpisodeState.ts";
const now = Date.parse("2026-11-09T01:10:00Z"), readAt = "2026-11-09T01:06:03.523Z";
const url = "https://collectingcars.com/for-sale/1980-porsche-928-2";
async function fixture(n = 0) {
  const fixtureUrl = n ? `${url}-${n}` : url;
  // Retained production source field values; IDs below are synthetic fixture owners.
  const document = { auctionId: 94494 + n, slug: n ? `1980-porsche-928-2-${n}` : "1980-porsche-928-2", lotType: "car", stage: "live",
    currentBid: 15000, noBids: 31, currencyCode: "aud", dtStageEndsUTC: "2026-11-12 06:05:00", features: ["native witness"] };
  const p = ccBidObservation({ url: fixtureUrl, external_id: String(94494 + n), current_bid: 15000, bid_count: 31, currency: "AUD", ends: "2026-11-12T06:05:00.000Z" }, `vehicle-fixture-${n}`, readAt)!;
  const html = JSON.stringify(document), sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(html)))].map(b => b.toString(16).padStart(2, "0")).join("");
  const s = { id: `00000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`, platform: "collecting-cars", listing_url: fixtureUrl, html, html_sha256: sha,
    fetched_at: readAt, success: true, http_status: 200, metadata: { capture_kind: "typesense_native_document", representation: "complete_selected_document_json_not_wire_response" } };
  const o = { ...p, id: `observation-fixture-${n}`, is_superseded: false, raw_source_ref: `listing_page_snapshots:${s.id}`,
    extraction_metadata: { source_capture: { snapshot_id: s.id, html_sha256: sha, source_url: fixtureUrl, fetched_at: readAt } } };
  return { p, o, s, native: { document, receivedAt: readAt } };
}
Deno.test("CC native aggregate projects recorded AUD, count, end and original capture without individual bid fiction", async () => {
  const f = await fixture(), row = await ccEpisodeRow(f.p, f.native, f.o, f.s, now);
  assertEquals([row.source_platform, row.source_listing_id, row.event_type, row.current_price, row.currency_code, row.bid_count],
    ["collecting_cars", "collectingcars.com/for-sale/1980-porsche-928-2", "auction", 15000, "AUD", 31]);
  assertEquals(row.high_bid, 15000);
  assertEquals(row.metadata.source_observed_at, readAt);
  assertEquals(row.metadata.source_event_time, null);
  assertEquals(row.metadata.raw_source_ref, f.o.raw_source_ref);
});
Deno.test("CC old end/currency, wrong owner, corrupted capture and future clock cannot project", async () => {
  const f = await fixture();
  for (const patch of [{ structured_data: { ...f.o.structured_data, ends: "2026-11-11T06:05:00.000Z" } },
    { structured_data: { ...f.o.structured_data, currency: "USD" } }, { vehicle_id: "other-car" },
    { observed_at: "2026-11-10T00:00:00Z" }, { is_superseded: true }])
    await assertRejects(() => ccEpisodeRow(f.p, f.native, { ...f.o, ...patch }, f.s, now));
  await assertRejects(() => ccEpisodeRow(f.p, f.native, f.o, { ...f.s, html: f.s.html + " " }, now));
  await assertRejects(() => ccEpisodeRow(f.p, { ...f.native, document: { ...f.native.document, currencyCode: "usd" } }, f.o, f.s, now));
});
Deno.test("CC held canonical testimony retries a failed episode write without another admission", async () => {
  const f = await fixture(); let episode: any = null; let writes = 0; let fail = true;
  const db: any = { from: (table: string) => {
    const q: any = new Proxy({}, { get: (_t, k) => k === "then" ? (resolve: any) => resolve({ error: null, data:
      table === "observation_sources" ? { id: "source" } : table === "vehicle_observations" ? [f.o] : table === "vehicle_events" ? (episode ? [episode] : [])
      : table === "listing_page_snapshots" ? f.s : { id: f.p.vehicle_id, listing_url: url } }) : () => q }); return q;
  } };
  const writer: any = (_db: any, row: any, policy: any) => {
    writes++; assertEquals(policy.sourceObservedAt, readAt); assertEquals(policy.compactMetadataCas, true);
    if (fail) return { action: "error", error: "projection unavailable" };
    episode = row; return { action: "inserted", id: "episode" };
  };
  const native = new Map([[url, f.native]]);
  const first = await projectCcEpisodes(db, [f.p], native, Date.now() + 5000, writer);
  assertEquals([first.projected, first.refused], [0, 1]);
  fail = false;
  const second = await projectCcEpisodes(db, [f.p], native, Date.now() + 5000, writer);
  assertEquals(second.projected, 1);
  const third = await projectCcEpisodes(db, [f.p], native, Date.now() + 5000, writer);
  assertEquals([third.unchanged, writes], [1, 2]);
});

Deno.test("CC projection cap converges held eligible episodes and leaves legacy raw gaps explicit", async () => {
  const fixtures = await Promise.all(Array.from({ length: 26 }, (_, n) => fixture(n)));
  const observations = fixtures.map(f => f.o);
  observations[25] = { ...observations[25], raw_source_ref: "" };
  const episodes: any[] = [];
  const db: any = { from: (table: string) => {
    const filters: Record<string, any> = {};
    const q: any = new Proxy({}, { get: (_t, k) => k === "then" ? (resolve: any) => resolve({ error: null, data:
      table === "observation_sources" ? { id: "source" } : table === "vehicle_observations" ? observations : table === "vehicle_events" ? episodes
      : table === "listing_page_snapshots" ? fixtures.find(f => f.s.id === filters.id)?.s
      : { id: filters.id, listing_url: fixtures.find(f => f.p.vehicle_id === filters.id)?.p.source_url } })
      : (...args: any[]) => { if(k === "eq") filters[args[0]] = args[1]; return q; } }); return q;
  } };
  const writer: any = (_db: any, row: any) => { episodes.push(row); return { action: "inserted", id: "episode" }; };
  const posts = fixtures.map(f => f.p), natives = new Map(fixtures.map(f => [f.p.source_url, f.native]));
  const first = await projectCcEpisodes(db, posts, natives, Date.now() + 5000, writer);
  assertEquals([first.projected, first.deferred], [20, 6]);
  const second = await projectCcEpisodes(db, posts, natives, Date.now() + 5000, writer);
  assertEquals([second.projected, second.unchanged, second.deferred], [5, 20, 1]);
  const expired = await projectCcEpisodes({ from: () => { throw Error("deadline must stop reads"); } }, posts, natives, Date.now(), writer);
  assertEquals(expired.deferred, 26);
});
