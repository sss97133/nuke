import { parseAmount, parseLotPage } from "./lotPage.ts";

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
