// deno test supabase/functions/_shared/landingDepthProbes.test.ts
// Synthetic fixtures only: every identifier below is invented.
import { blockByClass, isLotUrl, modelHolds, readRaw } from "./landingDepthProbes.ts";

function equal(actual: unknown, expected: unknown, label = "") {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

const craigslist = `<html><head><title>1977 example roadster for sale by owner - Townsville, FL - craigslist</title>
<meta name="geo.position" content="28.001100;-82.792800"><meta name="geo.placename" content="Townsville"><meta name="geo.region" content="US-FL"></head>
<body><span class="slider-info">image 1 of 19</span><span id="titletextonly">1977 EXAMPLE ROADSTER</span> - <span class="price">$6,000</span>
<div class="attrgroup"><div class="attr important"><span class="valu year">1977</span><span class="valu makemodel"><a href="#">example roadster</a></span></div></div>
<div class="attrgroup"><div class="attr auto_miles"><span class="labl">odometer:</span> <span class="valu">71,000</span></div>
<div class="attr auto_transmission"><span class="labl">transmission:</span> <span class="valu"><a href="#">manual</a></span></div></div>
<section class="userbody"><section id="postingbody"><div class="print-information print-qrcode-container"><p>QR Code Link to This Post</p><div class="print-qrcode"></div></div>
Runs and drives. Needs paint and a new top. Clean title in hand, garage kept for twenty years, records available on request.</section></section></body></html>`;

Deno.test("craigslist: state, point, city, price, photos and description are read from the capture", () => {
  const r = readRaw("craigslist", craigslist, null);
  equal([r.year?.sample, r.mileage?.n, r.transmission?.sample, r.location_state?.sample, r.location_point?.sample,
    r.location_city?.sample, r.price?.n, r.photo_count?.n], ["1977", 71000, "manual", "FL", "28.001100,-82.792800", "Townsville", 6000, 19]);
  equal((r.description?.n ?? 0) > 80, true, "description length");
  equal(r.vin, undefined, "no VIN in this capture, so none is claimed");
});

Deno.test("bat: the full description is the post-excerpt block, nested divs included", () => {
  const body = "x".repeat(300);
  const page = `<link rel="canonical" href="https://example.test/listing/1999-example-1/"><h1 class="post-title listing-post-title">1999 Example Coupe</h1>
  <div class="essentials"><div class="item item-seller"><strong>Seller</strong>: <a href="#">SOMEONE</a></div><strong>Location</strong>: <a href="#">Reno, Nevada 89501</a>
  <ul><li>Chassis: <a href="#">ABC12345</a></li><li>45k Miles Shown</li><li>Five-Speed Manual Transmission</li></ul></div>
  <div class="post-excerpt"><div><p>${body}</p></div><p>${body}</p></div><div class="after">tail</div>`;
  const r = readRaw("bat", page, null);
  equal([r.vin?.sample, r.mileage?.n, r.location_zip?.sample, r.seller?.sample], ["ABC12345", 45000, "89501", "SOMEONE"]);
  equal(r.description?.n, 601, "both paragraphs, not the tail");
  equal(blockByClass("<div class=\"a\"><div>in</div></div><div>out</div>", "a"), "<div>in</div>");
});

Deno.test("lot urls: index and search pages are not lots", () => {
  equal(isLotUrl("bat", "https://bringatrailer.com/auctions"), false);
  equal(isLotUrl("bat", "https://bringatrailer.com/listing/1999-example-1/"), true);
  equal(isLotUrl("mecum", "https://www.mecum.com/lots/1182679/1987-example"), true);
});

Deno.test("modelHolds: a teaser on the row with the full text in the log is held in the model, not on the profile", () => {
  const ctx = { v: { description: "t".repeat(481) }, events: [], locObs: [], commentCount: 0, imageCount: 0, obsDescLen: 2800 };
  const h = modelHolds("description", { n: 2896 }, ctx);
  equal([h.anywhere, h.profile], [true, false]);
  equal(Math.round((h.profileRatio ?? 0) * 100), 17);
  const none = modelHolds("description", { n: 2896 }, { ...ctx, obsDescLen: 400 });
  equal([none.anywhere, none.profile], [false, false]);
});

Deno.test("modelHolds: location counts from the observation table but not for the profile row", () => {
  const ctx = { v: { state: null }, events: [], locObs: [{ region_code: "FL" }], commentCount: 0, imageCount: 0, obsDescLen: 0 };
  const h = modelHolds("location_state", { sample: "FL" }, ctx);
  equal([h.anywhere, h.profile], [true, false]);
  equal(modelHolds("comment_count", { n: 10 }, { ...ctx, commentCount: 4 }).anywhere, false);
  equal(modelHolds("comment_count", { n: 10 }, { ...ctx, commentCount: 5 }).anywhere, true);
});

Deno.test("sale_outcome: read from the source's stated result, held only when the row says sold", () => {
  const mecum = `<script>self.__next_f.push([1,"{\\"saleResults\\":{\\"edges\\":[{\\"node\\":{\\"name\\":\\"Sold\\",\\"slug\\":\\"sold\\"}}]}}"])</script>`;
  equal(readRaw("mecum", mecum, null).sale_outcome?.sample, "sold");
  equal(readRaw("mecum", mecum.replace("sold", "bid-goes-on"), null).sale_outcome, undefined, "bid goes on is not a sale");
  equal(readRaw("carsandbids", "", "- Auction EndedSold for $13,350\n- 10/9/26").sale_outcome?.sample, "sold");
  const ctx = (v: Record<string, unknown>, events: Record<string, unknown>[] = []) => ({ v, events, locObs: [], commentCount: 0, imageCount: 0, obsDescLen: 0 });
  const raw = { sample: "sold" };
  equal(modelHolds("sale_outcome", raw, ctx({ sale_status: "available" }, [{ event_status: "sold" }])), { anywhere: true, profile: false });
  equal(modelHolds("sale_outcome", raw, ctx({ sale_status: "sold" })).profile, true);
  equal(modelHolds("sale_outcome", raw, ctx({ auction_outcome: "sold" })).profile, true);
});
