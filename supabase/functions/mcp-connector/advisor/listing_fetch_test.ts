// deno test --allow-read supabase/functions/mcp-connector/advisor/listing_fetch_test.ts
import { batGalleryPhotoUrls, parseListingHtml } from "./listing_fetch.ts";

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const FIXTURE = `<!DOCTYPE html><html><head>
<meta property="og:title" content="1987 porsche 911 for sale by owner - Henderson, NV - craigslist">
<meta property="og:description" content="This is a classic low mileage 1987 911 5 speed Cabriolet nicely updated with all steel 993 body panels. Clean title, Clean Carfax with real 74k miles.">
<script type="application/ld+json">
{"@type":"Product","name":"1987 Porsche 911 Cabriolet (updated 993 styling, low miles)","description":"Bullet proof G50 5-speed. Stored indoors, no rust. PROJECT.","offers":{"@type":"Offer","price":"39500.00","priceCurrency":"USD","availableAtOrFrom":{"geo":{"latitude":"36.038400","longitude":"-115.085700"},"address":{"addressLocality":"Henderson","addressRegion":"NV"}}},"image":["https://images.craigslist.org/00L0L_avCdvA8R2u1_0CI0t2_600x450.jpg","https://images.craigslist.org/00c0c_18ZhHYJH84Y_0CI0t2_600x450.jpg"]}
</script>
</head><body>
<h1 class="postingtitle"><span id="titletextonly">1987 Porsche 911 Cabriolet (updated 993 styling, low miles)</span> - <span class="price">$39,500</span><span> (Green Valley)</span></h1>
<span class="valu year">1987</span>
<span class="labl">odometer:</span><span class="valu">74000</span>
<span class="labl">transmission:</span><span class="valu">manual</span>
<section id="postingbody">Stored indoors, no rust. G50 transmission. This is a project.</section>
</body></html>`;

Deno.test("parseListingHtml extracts CL 911 ask, photos, and identity", () => {
  const u = "https://www.craigslist.org/view/d/henderson-1987-porsche-911-cabriolet/4i3GUhSsgWciiLLmQukSy7";
  const L = parseListingHtml(u, FIXTURE, 200);
  assert(L.asking_price === 39500, `price=${L.asking_price}`);
  assert(L.year === 1987, `year=${L.year}`);
  assert(L.make === "Porsche", `make=${L.make}`);
  assert(/911/i.test(L.model || ""), `model=${L.model}`);
  assert(L.mileage === 74000, `miles=${L.mileage}`);
  assert((L.photo_urls?.length || 0) >= 2, "photos");
  assert(/993/i.test(`${L.title} ${L.description}`), "993 in title/description");
  assert(L.city === "Henderson" || /Henderson/i.test(L.location || ""), "location");
  assert(L.source === "craigslist", L.source);
});

Deno.test("parseListingHtml recovers identity from C&B URL when HTML is empty", () => {
  const u = "https://carsandbids.com/auctions/KD60OD28/1995-porsche-911-turbo-coupe";
  const L = parseListingHtml(u, "<html><body></body></html>", 200);
  assert(L.year === 1995, `year=${L.year}`);
  assert(L.make === "Porsche", `make=${L.make}`);
  assert(/turbo/i.test(L.model || ""), `model=${L.model}`);
  assert(L.source === "cars_and_bids", L.source);
});

Deno.test("BaT data-gallery-items photos are parsed (entity-encoded JSON)", () => {
  const items = [
    { id: 1, large: { url: "https:\\/\\/bringatrailer.com\\/wp-content\\/uploads\\/2026\\/10\\/a.jpg" }, small: { url: "https://x/a-s.jpg" } },
    { id: 2, large: { url: "https://bringatrailer.com/wp-content/uploads/2026/10/b.jpg" } },
  ];
  const attr = JSON.stringify(items).replace(/"/g, "&quot;");
  const html = `<html><head><title>1994 Mazda MX-5 Miata M-Edition</title></head><body>` +
    `<div data-gallery-items="${attr}"></div></body></html>`;
  const got = batGalleryPhotoUrls(html, "https://bringatrailer.com/listing/1994-mazda-mx-5-miata-60/");
  if (got.length !== 2 || !got[0].endsWith("/a.jpg") || got[0].includes("\\")) throw new Error(JSON.stringify(got));
  const parsed = parseListingHtml("https://bringatrailer.com/listing/1994-mazda-mx-5-miata-60/", html, 200);
  if (parsed.photo_urls.length !== 2) throw new Error(JSON.stringify(parsed.photo_urls));
});

Deno.test("og:image is the photo fallback", () => {
  const html = `<html><head><meta property="og:image" content="https://cdn.example.com/car.jpg"/></head></html>`;
  const parsed = parseListingHtml("https://example.com/car/1", html, 200);
  if (parsed.photo_urls[0] !== "https://cdn.example.com/car.jpg") throw new Error(JSON.stringify(parsed.photo_urls));
});

Deno.test("live BaT auction: page price is a current bid, never an asking price", async () => {
  const { detectAuctionState } = await import("./listing_fetch.ts");
  const until = Math.floor(Date.now() / 1000) + 6 * 86400;
  const html = `<html><head><meta property="og:title" content="No Reserve: 26k-Mile 1994 Mazda MX-5 Miata M Edition 5-Speed">
<script type="application/ld+json">{"@type":"Product","name":"No Reserve: 26k-Mile 1994 Mazda MX-5 Miata M Edition 5-Speed","offers":{"@type":"Offer","priceCurrency":"USD","price":12000}}</script></head>
<body><span class="listing-available-countdown" data-countdown="1" data-until="${until}"></span><a href="#listing-bid">Place Bid</a></body></html>`;
  const L = parseListingHtml("https://bringatrailer.com/listing/1994-mazda-mx-5-miata-146/", html, 200);
  assert(L.listing_kind === "auction_live", `kind=${L.listing_kind}`);
  assert(L.current_bid === 12000, `bid=${L.current_bid}`);
  assert(L.asking_price === null, `ask=${L.asking_price}`);
  assert(L.auction_end_at === new Date(until * 1000).toISOString(), `end=${L.auction_end_at}`);
  // Ended auction (end time in the past) is not live.
  const past = detectAuctionState(`<span class="date-localize" data-ends="1600000000"></span> Sold for USD $24,500`);
  assert(!past.live && past.ended, "ended");
});
