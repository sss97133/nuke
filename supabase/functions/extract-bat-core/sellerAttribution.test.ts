// deno test supabase/functions/extract-bat-core/sellerAttribution.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  decideLotAttribution,
  mergeEventMetadata,
  monitorForSeller,
  type BatEventRow,
  type MonitorRow,
} from "./sellerAttribution.ts";

// Synthetic names only: the repo is public.
const DEALER_ORG = "org-dealer-1";
const monitors: MonitorRow[] = [
  { organization_id: DEALER_ORG, seller_username: "Example_Motors" },
  { organization_id: DEALER_ORG, seller_username: "example_motors_2" },
  { organization_id: "org-other", seller_username: "other-dealer" },
];

const LOT_2019 = "https://bringatrailer.com/listing/1990-example-roadster-12/";
const LOT_2024 = "https://bringatrailer.com/listing/1990-example-roadster-13/";
const ev = (id: string, url: string, org: string | null = null): BatEventRow => ({
  id,
  source_url: url,
  source_listing_id: url.replace(/^https:\/\//, "").replace(/\/$/, ""),
  source_organization_id: org,
});

Deno.test("the dealer's own lot is attributed", () => {
  const d = decideLotAttribution({
    lotSellerHandle: "example_motors",
    monitors,
    lotUrl: LOT_2024,
    events: [ev("e-2024", LOT_2024)],
  });
  assertEquals(d, { attributeEventIds: ["e-2024"], reason: "attribute" });
});

Deno.test("a resale of the same vehicle by a private seller stays unattributed", () => {
  const d = decideLotAttribution({
    lotSellerHandle: "some_private_seller",
    monitors,
    lotUrl: LOT_2024,
    events: [ev("e-2019", LOT_2019), ev("e-2024", LOT_2024)],
  });
  assertEquals(d, { attributeEventIds: [], reason: "seller_not_monitored" });
});

Deno.test("reading the dealer's lot does not stamp the vehicle's other lots", () => {
  // The old code updated every BaT row of the vehicle with no organization. The dealer sold lot 13 only.
  const d = decideLotAttribution({
    lotSellerHandle: "Example_Motors",
    monitors,
    lotUrl: LOT_2024,
    events: [ev("e-2019", LOT_2019), ev("e-2024", LOT_2024)],
  });
  assertEquals(d.attributeEventIds, ["e-2024"]);
});

Deno.test("url variants of the same lot match; a row already attributed is left alone", () => {
  const variant = "http://www.bringatrailer.com/listing/1990-example-roadster-13?utm=x";
  assertEquals(
    decideLotAttribution({ lotSellerHandle: "example_motors", monitors, lotUrl: variant, events: [ev("e", LOT_2024)] })
      .attributeEventIds,
    ["e"],
  );
  assertEquals(
    decideLotAttribution({
      lotSellerHandle: "example_motors",
      monitors,
      lotUrl: LOT_2024,
      events: [ev("e", LOT_2024, "org-other")],
    }),
    { attributeEventIds: [], reason: "already_attributed" },
  );
});

Deno.test("no seller, no event for this lot: nothing is attributed", () => {
  assertEquals(
    decideLotAttribution({ lotSellerHandle: null, monitors, lotUrl: LOT_2024, events: [ev("e", LOT_2024)] }).reason,
    "no_lot_seller",
  );
  assertEquals(
    decideLotAttribution({ lotSellerHandle: "example_motors", monitors, lotUrl: LOT_2024, events: [ev("e", LOT_2019)] })
      .reason,
    "no_event_for_this_lot",
  );
});

Deno.test("an ILIKE wildcard hit is not a match: handle a_b does not claim axb", () => {
  const ilikeHits: MonitorRow[] = [{ organization_id: DEALER_ORG, seller_username: "a_b" }];
  assertEquals(monitorForSeller("axb", ilikeHits), null);
  assertEquals(monitorForSeller("A_B", ilikeHits)?.organization_id, DEALER_ORG);
});

Deno.test("a handle monitored under two organizations is not guessed", () => {
  const dup: MonitorRow[] = [
    { organization_id: "org-a", seller_username: "same" },
    { organization_id: "org-b", seller_username: "same" },
  ];
  assertEquals(monitorForSeller("same", dup), null);
});

Deno.test("metadata merge keeps seller, buyer, lot number and images", () => {
  const existing = {
    source: "extract-bat-core",
    lot_number: "12345",
    seller_username: "example_motors",
    buyer_username: "some_buyer",
    images: ["https://example.test/a.jpg"],
    image_count: 1,
  };
  const merged = mergeEventMetadata(existing, { ownership_classification: "consigner" });
  assertEquals(merged, { ...existing, ownership_classification: "consigner" });
  // input is not mutated
  assertEquals("ownership_classification" in existing, false);
});

Deno.test("metadata merge tolerates null and non-object metadata", () => {
  assertEquals(mergeEventMetadata(null, { a: 1 }), { a: 1 });
  assertEquals(mergeEventMetadata(undefined, { a: 1 }), { a: 1 });
  assertEquals(mergeEventMetadata([1, 2] as unknown as Record<string, unknown>, { a: 1 }), { a: 1 });
});
