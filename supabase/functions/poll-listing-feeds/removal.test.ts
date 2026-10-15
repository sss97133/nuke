// Run: deno test --allow-env supabase/functions/poll-listing-feeds/removal.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyProbe, endedRow, sweepCraigslistRemovals } from "./removal.ts";

Deno.test("only a 404 or 410 is a removal; a block is not", () => {
  assertEquals(classifyProbe(404), "ended");
  assertEquals(classifyProbe(410), "ended");
  assertEquals(classifyProbe(200), "live");
  assertEquals(classifyProbe(403), "blocked");
  assertEquals(classifyProbe(429), "blocked");
  assertEquals(classifyProbe(503), "blocked");
  assertEquals(classifyProbe(null), "blocked");
});

Deno.test("the ended row carries the 404 as evidence, with the fetch time as ended_at", () => {
  const r: any = endedRow({ vehicle_id: "v", source_listing_id: "7889541022", source_url: "u" }, { status: 404, observed_at: "2026-10-15T03:30:00.000Z", snapshot_id: "s1" });
  assertEquals(r.event_status, "ended");
  assertEquals(r.ended_at, "2026-10-15T03:30:00.000Z");
  assertEquals(r.metadata.removal, { http_status: 404, observed_at: "2026-10-15T03:30:00.000Z", basis: "revisit", snapshot_id: "s1" });
});

function fakeSupabase(rows: any[]) {
  const writes: any[] = [];
  const q: any = {
    select: () => q, eq: () => q, lt: () => q, not: () => q, order: () => q, limit: () => Promise.resolve({ data: rows, error: null }),
    update: (patch: any) => { writes.push(patch); const u: any = { eq: () => u, is: () => u, select: () => ({ limit: () => Promise.resolve({ data: [{ id: "e" }], error: null }) }) }; return u; },
    insert: () => ({ select: () => ({ limit: () => Promise.resolve({ data: [{ id: "n" }], error: null }) }) }),
  };
  // writeVehicleEventByKey reads the live row first: a second select chain returning the row.
  const readChain: any = { select: () => readChain, eq: () => readChain, limit: () => Promise.resolve({ data: [{ id: "e", metadata: {}, ended_at: null, sold_at: null }], error: null }) };
  let calls = 0;
  return { writes, client: { from: () => (calls++ % 2 === 0 ? q : { ...q, ...readChain, update: q.update }) } };
}

Deno.test("a block stops the sweep and writes nothing", async () => {
  const f = fakeSupabase([{ id: "e", vehicle_id: "v", source_listing_id: "1", source_url: "a", metadata: {} }, { id: "f", vehicle_id: "w", source_listing_id: "2", source_url: "b", metadata: {} }]);
  const probed: string[] = [];
  const out = await sweepCraigslistRemovals({
    supabase: f.client, remainingMs: () => 100_000, sleep: async () => {},
    probe: async (u) => { probed.push(u); return { status: 429, observed_at: "2026-10-15T03:30:00.000Z", snapshot_id: null }; },
  });
  assertEquals(probed, ["a"]);
  assertEquals(out.stopped, "http_429");
  assertEquals(f.writes.length, 0);
});

Deno.test("no time left means no request", async () => {
  const f = fakeSupabase([{ id: "e", vehicle_id: "v", source_listing_id: "1", source_url: "a", metadata: {} }]);
  let probes = 0;
  const out = await sweepCraigslistRemovals({ supabase: f.client, remainingMs: () => 5_000, sleep: async () => {}, probe: async () => { probes++; return { status: 404, observed_at: "x", snapshot_id: null }; } });
  assertEquals(probes, 0);
  assertEquals(out.stopped, "worker_deadline");
});

import { noticeFrom } from "./removal.ts";
const fx = (n: string) => Deno.readTextFileSync(new URL(`./fixtures/${n}`, import.meta.url));

Deno.test("each notice page is read as its own reason", () => {
  assertEquals(noticeFrom(fx("removed-deleted.html")), "deleted");
  assertEquals(noticeFrom(fx("removed-expired.html")), "expired");
  assertEquals(noticeFrom(fx("removed-flagged.html")), "flagged");
});

Deno.test("a live post that happens to use the notice words is not removed", () => {
  assertEquals(noticeFrom(fx("live-with-notice-words.html")), null);
  assertEquals(noticeFrom(null), null);
  assertEquals(noticeFrom(""), null);
});

Deno.test("a notice at status 200 ends the listing, and the notice is recorded; a 200 without one stays live", () => {
  assertEquals(classifyProbe(200, "flagged"), "ended");
  assertEquals(classifyProbe(200, null), "live");
  assertEquals(classifyProbe(404, "deleted"), "ended");
  assertEquals(classifyProbe(403, "deleted"), "blocked");
  const r: any = endedRow({ vehicle_id: "v", source_listing_id: "1", source_url: "u" }, { status: 200, observed_at: "2026-10-15T04:00:00.000Z", snapshot_id: null, notice: "flagged" });
  assertEquals(r.metadata.removal, { http_status: 200, observed_at: "2026-10-15T04:00:00.000Z", basis: "revisit", notice: "flagged" });
});
