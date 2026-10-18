import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { bindToListing, identityAgrees, urlVariants } from "./bind.ts";
import type { CitedListing, ListingLink } from "./citations.ts";

Deno.test("url variants cover www and the trailing slash", () => {
  assertEquals(urlVariants("https://www.ebay.com/itm/237119814820").sort(), [
    "https://ebay.com/itm/237119814820", "https://ebay.com/itm/237119814820/", "https://www.ebay.com/itm/237119814820", "https://www.ebay.com/itm/237119814820/",
  ]);
});

Deno.test("identity: years must match and makes agree where both are stated", () => {
  assertEquals(identityAgrees({ year: 1965, make: "Ford" }, { year: 1965, make: "Ford" }), true);
  assertEquals(identityAgrees({ year: 1965, make: "Ford" }, { year: 1966, make: "Ford" }), false);
  assertEquals(identityAgrees({ year: 1965, make: "Ford" }, { year: 1965, make: "Chevrolet" }), false);
  assertEquals(identityAgrees({ year: 1965, make: "Ford" }, { year: null, make: null }), true);
  assertEquals(identityAgrees({ year: 1972, make: "Mercedes-Benz" }, { year: 1972, make: "Mercedes" }), true);
});

/** A PostgREST stand-in: each table answers its reads in order from a queue of row lists; writes and rpc calls are recorded. */
function stub(queues: Record<string, unknown[][]>, calls: unknown[][] = []) {
  const next = (table: string) => (queues[table] ?? []).shift() ?? [];
  const q = (table: string) => {
    const chain: any = {
      select: () => chain, in: () => chain, not: () => chain, eq: () => chain, neq: () => chain, limit: () => chain, gte: () => chain, order: () => chain,
      maybeSingle: () => Promise.resolve({ data: next(table)[0] ?? null, error: null }),
      upsert: (row: unknown) => { calls.push(["upsert", table, row]); return Promise.resolve({ data: null, error: null }); },
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: next(table), error: null }).then(ok),
    };
    return chain;
  };
  return { from: q, rpc: (fn: string, args: unknown) => { calls.push(["rpc", fn, args]); return Promise.resolve({ data: { proposal_id: "p1" }, error: null }); } };
}

const subject = { role: "subject", link_state: "live", platform: "ebay_motors", listing_key: "237119814820", url: "https://www.ebay.com/itm/237119814820", named_platform: "ebay_motors", anchor_text: "on eBay", raw_url: "x" } as CitedListing & ListingLink;

Deno.test("a held listing takes the post; the post's own vehicle is merged into it through a proposal", async () => {
  const calls: unknown[][] = [];
  const postUrl = "https://barnfinds.com/fastback-find-1965-ford-mustang-c-code";
  const sb = stub({
    // by listing URL, by listing key, then the post vehicle's other-platform events (none)
    vehicle_events: [[{ vehicle_id: "ebay-v", source_platform: "ebay_motors" }], [{ vehicle_id: "ebay-v" }], []],
    // by discovery URL (none), the held vehicle, then the post's own vehicle
    vehicles: [[], [{ id: "ebay-v", year: 1965, make: "Ford", status: "active", deleted_at: null }],
      [{ id: "post-v", status: "active", discovery_source: "barnfinds", profile_origin: "barnfinds", discovery_url: postUrl, user_id: null }]],
  }, calls);
  const b = await bindToListing(sb, { postUrl, postVehicleId: "post-v", cites: [subject], subject, identity: { year: 1965, make: "Ford" } });
  assertEquals([b.state, b.target_vehicle_id, b.merge?.outcome], ["bound", "ebay-v", "merged"]);
  const proposal = calls.find((c) => c[0] === "upsert")?.[2] as Record<string, unknown>;
  assertEquals([proposal.primary_vehicle_id, proposal.duplicate_vehicle_id, proposal.status, proposal.match_type], ["ebay-v", "post-v", "approved", "exact_listing_url"]);
  assertEquals(calls.find((c) => c[0] === "rpc"), ["rpc", "merge_into_primary", { primary_id: "ebay-v", dup_id: "post-v" }]);
});

Deno.test("a post vehicle that holds another platform's listing is only proposed, not merged", async () => {
  const calls: unknown[][] = [];
  const postUrl = "https://barnfinds.com/x";
  const sb = stub({
    vehicle_events: [[{ vehicle_id: "ebay-v", source_platform: "ebay_motors" }], [], [{ id: "bat-episode" }]],
    vehicles: [[], [{ id: "ebay-v", year: 1965, make: "Ford", status: "active", deleted_at: null }],
      [{ id: "post-v", status: "active", discovery_source: "barnfinds", discovery_url: postUrl, user_id: null }]],
  }, calls);
  const b = await bindToListing(sb, { postUrl, postVehicleId: "post-v", cites: [subject], subject, identity: { year: 1965, make: "Ford" } });
  assertEquals([b.state, b.merge?.outcome], ["merge_held", "proposed"]);
  assertEquals(calls.some((c) => c[0] === "rpc"), false);
});

Deno.test("an unheld listing leaves the post on its own vehicle; a different car is a conflict", async () => {
  assertEquals((await bindToListing(stub({}), { postUrl: "u", postVehicleId: null, cites: [subject], subject, identity: { year: 1965, make: "Ford" } })).state, "target_not_held");
  const conflict = await bindToListing(stub({ vehicle_events: [[{ vehicle_id: "v2", source_platform: "ebay_motors" }], []], vehicles: [[], [{ id: "v2", year: 1979, make: "Chevrolet", status: "active", deleted_at: null }]] }),
    { postUrl: "u", postVehicleId: null, cites: [subject], subject, identity: { year: 1965, make: "Ford" } });
  assertEquals(conflict.state, "identity_conflict");
  assertEquals((await bindToListing(stub({}), { postUrl: "u", postVehicleId: null, cites: [{ ...subject, link_state: "replaced_by_barnfinds" }], subject: null, identity: { year: 1965, make: "Ford" } })).state, "link_replaced");
});

Deno.test("a post vehicle holding a VIN the listing's vehicle lacks is only proposed, not merged", async () => {
  const calls: unknown[][] = [];
  const postUrl = "https://barnfinds.com/vin-post";
  const sb = stub({
    vehicle_events: [[{ vehicle_id: "ebay-v", source_platform: "ebay_motors" }], [], []],
    vehicles: [[], [{ id: "ebay-v", year: 1965, make: "Ford", status: "active", deleted_at: null }],
      [{ id: "post-v", status: "active", discovery_source: "barnfinds", discovery_url: postUrl, user_id: null, vin: "5F09C123456" }],
      [{ vin: null }]],
  }, calls);
  const b = await bindToListing(sb, { postUrl, postVehicleId: "post-v", cites: [subject], subject, identity: { year: 1965, make: "Ford" } });
  assertEquals(b.merge?.outcome, "proposed");
  assertEquals((b.merge?.detail as Record<string, unknown>).post_vin_not_on_listing_vehicle, true);
  assertEquals(calls.some((c) => c[0] === "rpc"), false);
});
