import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { identityFromTitle, priceMentions, isWidgetText, shownTimeAsUtc, listingFromText, parseBarnFindsPost, priceFromText } from "./parseArticle.ts";

Deno.test("identity from headlines with and without a prefix", () => {
  assertEquals(identityFromTitle("Mild Build 350 V8: 1989 Chevrolet C1500"), { year: 1989, make: "Chevrolet", model: "C1500" });
  assertEquals(identityFromTitle("Nees TLC 40k-mile1996 Plymouth Neon"), { year: 1996, make: "Plymouth", model: "Neon" });
  assertEquals(identityFromTitle("Rust-Free 1965 Alfa Romeo Giulia Spider").make, "Alfa Romeo");
  assertEquals(identityFromTitle("Fresh Ferraris: A Round-Up of Newer Models").year, null);
});

Deno.test("price and listing place come from the prose", () => {
  assertEquals(priceFromText("The seller set their price at $107,000 OBO.").price, 107000);
  assertEquals(priceFromText("The seller set their price at $107,000 OBO.").obo, true);
  assertEquals(priceFromText("It has 107,000 miles.").price, null);
  assertEquals(listingFromText("the GTX listed here on eBay in Concord, North Carolina. The seller").location, "Concord, North Carolina");
  assertEquals(listingFromText("the GTX listed here on eBay in Concord, North Carolina. The seller").platform, "eBay");
});

const PAGE = `<html><head><script type="application/ld+json">{"@graph":[{"@type":"Article","headline":"Hemi-Powered: 1967 Plymouth GTX","datePublished":"2026-02-02T16:00:00+00:00"}]}</script></head><body>
<h1>Hemi-Powered: 1967 Plymouth GTX</h1>
<div class="entry-content"><p>Disclosure: affiliate</p><p>Thanks to <em>Barn Finder</em> Curvette for the GTX listed <a href="/old/?car=x">here on eBay</a> in Concord, North Carolina. The seller set their price at $107,000 OBO.</p>
<img src="https://barnfinds.com/wp-content/uploads/2026/02/GTX-1-300x200.jpg"><img data-src="https://barnfinds.com/wp-content/uploads/2026/02/GTX-2.jpg"><img src="https://barnfinds.com/wp-content/uploads/2026/02/GTX-2.jpg"></div>
<div id="comments"><ol><li id="li-comment-1"><div id="comment-1" class="comment even thread-even depth-1" ><div class="comment-author vcard"><cite class="fn">Stan</cite><span class="member-tag">Member</span></div><div class="comment-meta commentmetadata"> Feb 1, 2026 9:49pm</div><div class="comment-content"><p>Favorite &amp; then some</p><div class="cld-like-dislike-wrap"><span class="cld-count-wrap">22 </span></div></div></div></li></ol></div></body></html>`;

Deno.test("a whole post", () => {
  const p = parseBarnFindsPost(PAGE);
  assertEquals([p.year, p.make, p.model], [1967, "Plymouth", "GTX"]);
  assertEquals(p.askingPrice, 107000);
  assertEquals(p.location, "Concord, North Carolina");
  assertEquals(p.tipster, "Curvette");
  assertEquals(p.publishedAt, "2026-02-02T16:00:00+00:00");
  assertEquals(p.imageUrls, ["https://barnfinds.com/wp-content/uploads/2026/02/GTX-1.jpg", "https://barnfinds.com/wp-content/uploads/2026/02/GTX-2.jpg"]);
  assertEquals(p.comments.length, 1);
  assertEquals([p.comments[0].author, p.comments[0].member, p.comments[0].likes, p.comments[0].text], ["Stan", true, 22, "Favorite & then some"]);
  assertEquals(p.articleText.startsWith("Thanks to"), true);
});

Deno.test("widget teasers are not article text or a price", () => {
  assertEquals(isWidgetText("1971 Chevrolet Corvette Convertible Bid Now 6 days $100"), true);
  assertEquals(priceFromText("Current high bid $100 on the widget").price, null);
  assertEquals(shownTimeAsUtc("Feb 1, 2026 9:49pm"), "2026-02-01T21:49:00.000Z");
  assertEquals(shownTimeAsUtc("Jan 8, 2026 12:05am"), "2026-01-08T00:05:00.000Z");
});

Deno.test("price kinds: asking, bid, msrp, unknown", () => {
  const m = priceMentions("The seller set their price at $107,000 OBO. It sold new for $3,995 when new. The current high bid is $52,000. The cash value of $16,504 was stated. Asking $12k firm.");
  assertEquals(m.map((x) => [x.amount, x.kind]), [[107000, "asking"], [3995, "original_msrp"], [52000, "bid"], [16504, "unknown"], [12000, "asking"]]);
  assertEquals(priceFromText("Original MSRP was $4,200 and the high bid is $9,000.").price, null);
});
