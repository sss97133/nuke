// Run: deno test --allow-read supabase/functions/mcp-connector/advisor/ledger_test.ts
import {
  dedupeEvents,
  isAskOnlyPlatform,
} from "./ledger.ts";
import { bodyBucket, canonicalListingUrl, transBucket } from "./variants.ts";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("isAskOnlyPlatform catches classifieds by platform and URL", () => {
  assert(isAskOnlyPlatform("craigslist"), "cl platform");
  assert(isAskOnlyPlatform("facebook_marketplace"), "fb");
  assert(isAskOnlyPlatform("ksl"), "ksl");
  assert(isAskOnlyPlatform("conceptcarz"), "ccz");
  assert(isAskOnlyPlatform("unknown"), "unknown");
  assert(isAskOnlyPlatform("bat") === false, "bat ok");
  assert(
    isAskOnlyPlatform("bat", "https://craigslist.org/view/d/foo") === true,
    "url override",
  );
});

Deno.test("dedupeEvents collapses same canonical URL + status + date", () => {
  const { events, duplicates_removed } = dedupeEvents([
    {
      id: "1",
      source_url: "https://bringatrailer.com/listing/foo/",
      event_type: "auction",
      event_status: "sold",
      sold_at: "2024-01-01",
      final_price: 10000,
    },
    {
      id: "2",
      source_url: "https://bringatrailer.com/listing/foo",
      event_type: "auction",
      event_status: "sold",
      sold_at: "2024-01-01T12:00:00Z",
      final_price: 10000,
    },
    {
      id: "3",
      source_url: "https://bringatrailer.com/listing/bar",
      event_type: "auction",
      event_status: "sold",
      sold_at: "2024-01-02",
      final_price: 12000,
    },
  ]);
  assert(events.length === 2, `got ${events.length}`);
  assert(duplicates_removed === 1, `dupes ${duplicates_removed}`);
  assert(
    canonicalListingUrl("https://bringatrailer.com/listing/foo/") ===
      canonicalListingUrl("https://bringatrailer.com/listing/foo"),
    "canonical URL matches",
  );
});

Deno.test("body and transmission buckets normalize listing text", () => {
  assert(bodyBucket("911 Cabriolet") === "cabriolet", "cab");
  assert(bodyBucket("Targa") === "targa", "targa");
  assert(transBucket("G50 5-speed") === "g50", "g50");
  assert(transBucket("Tiptronic") === "automatic", "auto");
  assert(transBucket("5-speed manual") === "manual", "manual");
});
