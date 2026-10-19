
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
