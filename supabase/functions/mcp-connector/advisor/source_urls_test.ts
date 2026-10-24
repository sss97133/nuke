// deno test --allow-read supabase/functions/mcp-connector/advisor/source_urls_test.ts
import { emptyCitation, publicSourceUrl, sourceLabelForUrl } from "./evidence.ts";
import { vehicleEventTime } from "./handlers.ts";
import { cleanListingUrl } from "./variants.ts";

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const CCZ = "conceptcarz://event/1866/1990 BMW E30 M3 ConvertibleChassis#: WBSBB05090EB86261";

Deno.test("conceptcarz:// is never cited as a URL", () => {
  assert(publicSourceUrl(CCZ) === null, "pseudo-scheme dropped");
  assert(publicSourceUrl("https://bringatrailer.com/listing/x/") === "https://bringatrailer.com/listing/x/", "https kept");
  assert(sourceLabelForUrl(CCZ) === "conceptcarz (event 1866, no public URL)", String(sourceLabelForUrl(CCZ)));
  const c = emptyCitation({ source_name: "conceptcarz", source_url: CCZ });
  assert(c.source_url === null, "citation url null");
  assert(c.source_name === "conceptcarz (event 1866, no public URL)", String(c.source_name));
  const u = emptyCitation({ source_name: "unknown", source_url: CCZ });
  assert(u.source_name === "conceptcarz (event 1866, no public URL)", String(u.source_name));
  assert(cleanListingUrl(CCZ) === null, "comp url null");
});

Deno.test("event_time comes from sale / auction end dates, never ingested_at", () => {
  const now = Date.parse("2026-10-24T00:00:00Z");
  assert(vehicleEventTime({ sale_date: "2024-02-18", updated_at: "2026-07-12" }, now) === "2024-02-18", "sale_date");
  assert(vehicleEventTime({ bat_sale_date: "2022-05-01" }, now) === "2022-05-01", "bat_sale_date");
  assert(vehicleEventTime({ auction_end_date: "2022-05-01T19:00:00Z" }, now) === "2022-05-01T19:00:00.000Z", "past auction end");
  assert(vehicleEventTime({ auction_end_date: "2026-11-02T19:00:00Z" }, now) === null, "future end is not an event yet");
  assert(vehicleEventTime({ updated_at: "2026-07-12", created_at: "2026-03-24" }, now) === null, "no ingest time");
});
