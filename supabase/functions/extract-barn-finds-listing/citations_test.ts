import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { bindableSubject, canonicalListingLink, citedListings } from "./citations.ts";
import { articleAndComments, parseBarnFindsPost } from "./parseArticle.ts";

Deno.test("listing links reduce to the key their platform is held under", () => {
  assertEquals(canonicalListingLink("https://www.ebay.com/itm/237119814820?mkcid=1&#038;mkrid=711-53200-19255-0&#038;campid=5336858830&#038;customid=962247"),
    { platform: "ebay_motors", listing_key: "237119814820", url: "https://www.ebay.com/itm/237119814820" });
  assertEquals(canonicalListingLink("https://rover.ebay.com/rover/1/711-53200-19255-0/1?icep_id=114&ipn=icep&toolid=20004&campid=5336858830&mpre=https%3A%2F%2Fwww.ebay.com%2Fitm%2F185674703946")?.listing_key, "185674703946");
  assertEquals(canonicalListingLink("https://www.ebay.com/itm/1965-Ford-Mustang/237119814820")?.listing_key, "237119814820");
  assertEquals(canonicalListingLink("https://newyork.craigslist.org/jsy/cto/d/new-york-1976-jaguar-xj6c-coupe-rare/7571508499.html"),
    { platform: "craigslist", listing_key: "7571508499", url: "https://newyork.craigslist.org/jsy/cto/d/new-york-1976-jaguar-xj6c-coupe-rare/7571508499.html" });
  assertEquals(canonicalListingLink("https://www.craigslist.org/view/d/quakertown-1972-dodge-challenger-speed/qj5JqE8rYUyNdig5egg5Ld"),
    { platform: "craigslist", listing_key: null, url: "https://www.craigslist.org/view/d/quakertown-1972-dodge-challenger-speed/qj5JqE8rYUyNdig5egg5Ld" });
  assertEquals(canonicalListingLink("https://images.craigslist.org/00x0x_5osXA2Z8zAzz_0sZ0hZ_1200x900.jpg"), null);
  assertEquals(canonicalListingLink("https://www.facebook.com/marketplace/item/976893913269369/?hoisted=false&#038;ref=search"),
    { platform: "facebook_marketplace", listing_key: "976893913269369", url: "https://www.facebook.com/marketplace/item/976893913269369/" });
  assertEquals(canonicalListingLink("https://www.facebook.com/sharer.php?u=https://barnfinds.com/x/"), null);
  assertEquals(canonicalListingLink("https://bringatrailer.com/listing/1965-pontiac-catalina-3/")?.listing_key, "1965-pontiac-catalina-3");
  assertEquals(canonicalListingLink("https://carsandbids.com/auctions/9nV871wl/1993-jeep-wrangler-s-4x4")?.listing_key, "9nV871wl");
  assertEquals(canonicalListingLink("https://www.hemmings.com/classifieds/dealer/dodge/unspecified/2636714.html")?.listing_key, "2636714");
  assertEquals(canonicalListingLink("https://www.hemmings.com/stories/article/buick-215-cu-in-v-8"), null);
  assertEquals(canonicalListingLink("https://classiccars.com/listings/view/1505630/1972-pontiac-gto-for-sale")?.listing_key, "1505630");
});

const page = (article: string, comments = "") =>
  `<html><body><h1>Fastback Find: 1965 Ford Mustang C-Code</h1><div class="entry-content">${article}</div>${comments ? `<div id="comments">${comments}</div>` : ""}</body></html>`;

Deno.test("the affiliate eBay link the article gives for the car is the subject", () => {
  const html = page(`<p>Stored for 40 years in Lincoln, Nebraska, this mostly solid restoration project is available </span><a  rel="nofollow" target="_blank" href="https://www.ebay.com/itm/237119814820?mkcid=1&#038;campid=5336858830&#038;customid=962247" class="external">on eBay</a>, where the current bid is $13,200, though the reserve is unmet.</p>`);
  const { article, comments } = articleAndComments(html);
  const c = citedListings(article, comments);
  assertEquals(c.length, 1);
  assertEquals([c[0].role, c[0].platform, c[0].listing_key, c[0].link_state], ["subject", "ebay_motors", "237119814820", "live"]);
  assertEquals(bindableSubject(c)?.url, "https://www.ebay.com/itm/237119814820");
});

Deno.test("a link Barn Finds replaced after the listing ended is kept, with no key", () => {
  const html = page(`<p>Find it <a rel="nofollow" target="_blank" class="old" href="/old/?car=chevelle">here on eBay</a> in Ohio.</p>`);
  const { article, comments } = articleAndComments(html);
  const c = citedListings(article, comments);
  assertEquals([c[0].role, c[0].link_state, c[0].named_platform, c[0].platform], ["subject", "replaced_by_barnfinds", "ebay_motors", undefined]);
  assertEquals(bindableSubject(c), null);
});

Deno.test("comparables and earlier sales are references; commenters' links are reader links", () => {
  const html = page(
    `<p>Rising prices are pushing all Alfa prices up. <a href="https://bringatrailer.com/listing/1973-alfa-romeo-berlina-6/" class="external">Here</a> is a nice Berlina that sold for $30,000.</p>` +
    `<p>Another great tip from T.J., this Packard is in Sterling, Massachusetts, and is available <a href="https://www.facebook.com/marketplace/item/553164782812961/" class="external">here on Facebook Marketplace</a> for $10,500.</p>` +
    `<p>And here is another for sale now, <a href="https://www.hemmings.com/classifieds/dealer/hudson/hornet/2270548.html">here</a>, priced at $60,000.</p>`,
    `<div id="comment-1" class="comment depth-1"><p>It's back on Ebay <a rel="nofollow" href="https://www.ebay.com/itm/195516401937?mkcid=1">https://www.ebay.com/itm/195516401937</a></p></div>`,
  );
  const { article, comments } = articleAndComments(html);
  const c = citedListings(article, comments);
  assertEquals(c.map((x) => [x.role, x.platform]), [["reference", "bat"], ["subject", "facebook_marketplace"], ["reference", "hemmings"], ["reader", "ebay_motors"]]);
});

Deno.test("the post's author comes from the article markup", () => {
  const html = `<script type="application/ld+json">{"@graph":[{"@type":"Article","headline":"Fastback Find: 1965 Ford Mustang C-Code","author":{"@type":"Person","name":"Russ Dixon"}}]}</script>${page("<p>x</p>")}`;
  assertEquals(parseBarnFindsPost(html).author, "Russ Dixon");
  assertEquals(parseBarnFindsPost(`<meta name="author" content="Jane Doe" />${page("<p>x</p>")}`).author, "Jane Doe");
});
