// Synthetic text shaped from eBay's public item pages as read 2026-10-15.
import { assertEquals } from "jsr:@std/assert@1";
import { estimateEnd, outcomeOf, parseEndedPage } from "./endState.ts";

Deno.test("an ended page: Ended, the price shown, the end label", () => {
  const md = "![x](https://i.ebayimg.com/a.jpg)\n\n1979 Chevrolet C10\n\nEnded\n\nUS $45,000.00US $45,000.00\n\nSun, Jan 25, 05:42 PMSun, Jan 25, 05:42 PM\n\n[Seller's other items](https://x)\n";
  const p = parseEndedPage(md, 404, new Date("2026-10-15T12:00:00Z"));
  assertEquals([p.ended, p.price, p.endedLabel, p.endedAt, p.auction], [true, 45000, "Sun, Jan 25, 05:42 PM", "2026-01-25T17:42:00.000Z", false]);
  assertEquals(outcomeOf(p, "best_offer"), "listing_ended");
});

Deno.test("a live page is not ended; an auction with bids is named for what the page shows", () => {
  assertEquals(parseEndedPage("# 1969 Camaro\n\n[6 bids](https://x)\n\nEnds in 6d 19h", 200, new Date()).ended, false);
  const p = parseEndedPage("1969 Camaro\n\nEnded\n\n12 bids\n\nUS $31,000.00\n\nTue, Oct 13, 08:00 PM", 404, new Date("2026-10-15T00:00:00Z"));
  assertEquals([p.ended, p.bids, outcomeOf(p, "auction")], [true, 12, "auction_ended_with_bids"]);
});

Deno.test("end estimates come from the page's own countdown", () => {
  const e = estimateEnd("6 bids\n\nEnds in 6d 19hWednesday, 11:18 PM", new Date("2026-10-15T08:00:00Z"))!;
  assertEquals(e.at.toISOString(), "2026-10-22T03:00:00.000Z");
  assertEquals(estimateEnd("nothing here", new Date()), null);
});
