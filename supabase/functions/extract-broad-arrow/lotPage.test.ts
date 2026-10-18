import { galleryImageId, isVinClash, lotGallery, parseAmount, parseLotPage } from "./lotPage.ts";

const eq = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); };

const page = (soldHtml: string, ld = "") => `<html><head><title>1974 Ferrari Dino 308 GT4 | The Zoute Concours Auction 2025 | Collector Car Auctions &amp; Classic Cars</title>` +
  `<meta content='Chassis No. 08424 &#x000A;Engine No. 1' name='description'>${ld ? `<script type="application/ld+json">${ld}</script>` : ""}</head>` +
  `<body><h1>1974 Ferrari Dino 308 GT4 | Lot 183 | The Zoute Concours Auction 2025</h1>${soldHtml}</body></html>`;

Deno.test("amounts read thousands separators of either style", () => {
  eq(parseAmount("123,200"), 123200);
  eq(parseAmount("51.750"), 51750);
  eq(parseAmount("1.380.000"), 1380000);
  eq(parseAmount("1.380.000,50"), 1380001);
  eq(parseAmount(""), null);
});

Deno.test("a euro sale keeps its currency token, not the schema block's USD", () => {
  const l = parseLotPage(page("<div>Sold Price: <span>€51.750</span> EUR</div>",
    '{"vehicleIdentificationNumber":"08424","offers":{"price":"51750","priceCurrency":"USD"},"mileageFromOdometer":{"value":"6865","unitCode":"KMT"}}'));
  eq([l.year, l.make, l.model, l.saleName, l.lotNumber], [1974, "Ferrari", "Dino 308 GT4", "The Zoute Concours Auction 2025", "183"]);
  eq([l.status, l.soldPrice, l.currency, l.vin], ["sold", 51750, "EUR", "08424"]);
  eq(l.odometer, { value: 6865, unit: "km" });
});

Deno.test("a lot with no sold price and no wording is unknown, never sold", () => {
  const l = parseLotPage(page("<div>Estimate $100,000 - $150,000</div>"));
  eq([l.status, l.soldPrice], ["unknown", null]);
});

Deno.test("parseAmount reads Swiss apostrophe grouping, and a Zurich sold price keeps every digit", () => {
  if (parseAmount("210'000") !== 210000 || parseAmount("5’500’000") !== 5500000) throw new Error("apostrophe grouping");
  const l = parseLotPage("<html><head><title>1991 De Tomaso Pantera SI | The Zurich Auction 2026 | Broad Arrow</title></head><body><div>Sold Price: CHF 231&#39;250</div></body></html>");
  if (l.soldPrice !== 231250 || l.currency !== "CHF") throw new Error(JSON.stringify({ soldPrice: l.soldPrice, currency: l.currency }));
});

Deno.test("lotGallery keeps one photo per image id, the largest size, in page order", () => {
  const img = (id: number, size: string) => `https://cdn.dealeraccelerate.com/bagauction/10/1780/${id}/${size}/1958-chevrolet-corvette-283-290-fuelie`;
  const html = `<meta content='${img(91920, "790x1024")}' property='og:image'>
<img data-src="${img(91920, "790x1024")}"><a href="${img(91920, "1920x1440")}"></a><img src="${img(91920, "x")}">
<img data-src="${img(91921, "790x1024")}"><a href="${img(91921, "1920x1440")}"></a>
<img data-src="${img(91922, "790x1024")}">`;
  const g = lotGallery(html);
  if (g.join() !== [img(91920, "1920x1440"), img(91921, "1920x1440"), img(91922, "790x1024")].join()) throw new Error(JSON.stringify(g));
  if (lotGallery("<html><body>no photos</body></html>").length !== 0) throw new Error("expected none");
  if (parseLotPage(`<html><head><title>1958 Chevrolet Corvette | The Amelia Auction 2024 | Broad Arrow</title></head><body>${html}</body></html>`).imageUrls.length !== 3) throw new Error("parseLotPage imageUrls");
});

Deno.test("galleryImageId names the same photo across sizes and the older .webp spelling; other URLs have none", () => {
  const a = "https://cdn.dealeraccelerate.com/bagauction/10/1744/95182/1920x1440/1958-bmw-507-series-ii-roadster";
  const b = "https://cdn.dealeraccelerate.com/bagauction/10/1744/95182/1920x1440/1958-bmw-507-series-ii-roadster.webp";
  const c = "https://cdn.dealeraccelerate.com/bagauction/10/1744/95182/790x1024/1958-bmw-507-series-ii-roadster";
  if (galleryImageId(a) !== "95182" || galleryImageId(b) !== "95182" || galleryImageId(c) !== "95182") throw new Error("same photo");
  if (galleryImageId("https://www.broadarrowauctions.com/vehicles/am24_r123/%3CBase64-Image-Removed%3E") !== null) throw new Error("junk url");
});

Deno.test("isVinClash recognises the two refusals a held VIN produces, and nothing else", () => {
  const seen = [
    'duplicate key value violates unique constraint "vehicles_vin_unique_short_v2"',
    "VIN WBAEJ13462AH61832 already exists on vehicle 6940c8a0-77f2-4acd-8305-f1182e44b8e4",
  ];
  for (const m of seen) if (!isVinClash(m)) throw new Error(`missed: ${m}`);
  for (const m of ["canceling statement due to statement timeout", 'duplicate key value violates unique constraint "vehicles_discovery_url_key"', null]) {
    if (isVinClash(m)) throw new Error(`false clash: ${m}`);
  }
});
