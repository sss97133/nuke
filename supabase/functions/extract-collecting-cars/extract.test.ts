import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractFromHtml } from "./extract.ts";

const html = await Deno.readTextFile(new URL("./fixtures/lot-911.html", import.meta.url));
const url = "https://collectingcars.com/for-sale/2017-porsche-911-991-2-carrera-s-2";

Deno.test("identity, VIN, colours, engine, clocks", () => {
  const x = extractFromHtml(html, url);
  assertEquals([x.listing_id, x.year, x.make, x.model, x.trim], ["93268", 2017, "Porsche", "911", "Carrera S"]);
  assertEquals([x.vin, x.exterior_color, x.interior_color, x.transmission, x.engine], ["WP0ZZZ99ZHS000000", "Black", "Black", "automatic", "3.0L Flat-Six"]);
  assertEquals([x.posted_at, x.stage, x.lot_type, x.bid_count], ["2026-10-13T06:11:05.000Z", "unsold", "car", 72]);
  assertEquals(x.location, "Auckland, New Zealand");
});

Deno.test("a price in another currency is kept with its currency and is not written as dollars", () => {
  const x = extractFromHtml(html, url);
  assertEquals([x.price, x.price_amount, x.currency, x.price_kind], [null, 111350, "NZD", "high_bid"]);
});

Deno.test("an ended unsold lot is not a sale: outcome unsold, last bid is a high bid, no sold_at", () => {
  const x = extractFromHtml(html, url);
  assertEquals([x.sale_outcome, x.sold_at], ["unsold", null]);
});

const swap = (h: string, from: string, to: string) => { assert(h.includes(from), from); return h.split(from).join(to); };

Deno.test("a sold lot reads priceSold and dtSoldUTC; a USD sale is the price", () => {
  let h = swap(html, '\\"stage\\":\\"unsold\\"', '\\"stage\\":\\"sold\\"');
  h = swap(h, '\\"currencyCode\\":\\"nzd\\"', '\\"currencyCode\\":\\"usd\\"');
  h = swap(h, '\\"priceSold\\":null', '\\"priceSold\\":120000');
  h = swap(h, '\\"dtSoldUTC\\":null', '\\"dtSoldUTC\\":\\"2026-10-20 09:30:00\\"');
  const x = extractFromHtml(h, url);
  assertEquals([x.sale_outcome, x.price_kind, x.price, x.price_amount, x.currency, x.sold_at], ["sold", "sold", 120000, 120000, "USD", "2026-10-20T09:30:00.000Z"]);
});

Deno.test("odometer in km is converted to miles and the raw text is kept", () => {
  const x = extractFromHtml(html, url);
  assertEquals([x.mileage, x.mileage_unit, x.mileage_raw], [15329, "km", "24,669 Km (Indicated)"]);
});

Deno.test("a source-declared sale with no disclosed price stays sold without promoting its last bid", () => {
  const soldPage = swap(html, '\\"stage\\":\\"unsold\\"', '\\"stage\\":\\"sold\\"');
  for (const replacement of ['null', '0']) {
    const x = extractFromHtml(swap(soldPage, '\\"priceSold\\":null', `\\"priceSold\\":${replacement}`), url);
    assertEquals([x.sale_outcome, x.price_amount, x.price_kind, x.price], ["sold", null, null, null]);
  }
});

Deno.test("description resolves through its flight reference and the gallery is the full image list", () => {
  const x = extractFromHtml(html, url);
  assert(x.description?.startsWith("KEY FACTS"), x.description ?? "null");
  assert(!x.description?.includes("<"));
  assertEquals(x.image_urls.length, 165);
  assert(x.image_urls.every((u) => u.startsWith("https://images.collectingcars.com/")));
});

Deno.test("a page without the lot payload is an error", () => {
  let threw = false;
  try { extractFromHtml("<html></html>", url); } catch { threw = true; }
  assert(threw);
});

const nativePage = (fields: Record<string, unknown>) =>
  `<script>self.__next_f.push([1,${JSON.stringify(JSON.stringify({ auctionId: "1", stage: "sold", ...fields }))}])</script>`;

Deno.test("historical title supplies an explicit year when modelYear is absent", () => {
  const x = extractFromHtml(nativePage({ title: "1989 PORSCHE 911 SPEEDSTER", modelYear: null }), url);
  assertEquals([x.year, x.year_source], [1989, "title"]);
});

Deno.test("structured year keeps priority and unrelated title numbers do not become years", () => {
  const x = extractFromHtml(nativePage({ title: "1989 PORSCHE 911 SPEEDSTER", modelYear: "1990" }), url);
  assertEquals([x.year, x.year_source], [1990, "modelYear"]);
  for (const title of [null, "Porsche 911 - 1989", "19890 Porsche", "911 Porsche", "1989-spec Porsche"]) {
    const y = extractFromHtml(nativePage({ title, modelYear: null }), url);
    assertEquals([y.year, y.year_source], [null, null]);
  }
});

Deno.test("known publisher prefixes retain explicit title years without searching other numbers", () => {
  for (const [title, year] of [
    ["NO RESERVE: 1991 PORSCHE 911 (964) CARRERA 2", 1991],
    ["PROJECT CAR - 1967 JAGUAR E-TYPE SERIES 1 4.2 2+2", 1967],
    ["CHARITY AUCTION - 1976 LAND ROVER SERIES III", 1976],
    ["CHARITY AUCTION - 1935 LANCIA AUGUSTA MARCH SPECIAL TOURER", 1935],
  ] as const) {
    const x = extractFromHtml(nativePage({ title, modelYear: null }), url);
    assertEquals([x.year, x.year_source, x.title], [year, "title", title]);
    const authoritative = extractFromHtml(nativePage({ title, modelYear: 2001 }), url);
    assertEquals([authoritative.year, authoritative.year_source], [2001, "modelYear"]);
  }
  for (const title of ["NO RESERVE: ALVIS SABRE LIGHT TANK", "NO RESERVE: Porsche 1991", "NO RESERVE: 19910 Porsche",
    "NO RESERVE: 1991-spec Porsche", "PROJECT CAR 1967 Jaguar", "CHARITY AUCTION - unknown 1976 Land Rover",
    "RESTORED: 1991 Porsche", "NO RESERVE: CHARITY AUCTION - 1976 Land Rover", "CHARITY AUCTION - 1976"]) {
    const x = extractFromHtml(nativePage({ title, modelYear: null }), url);
    assertEquals([x.year, x.year_source], [null, null], title);
  }
});

Deno.test("only explicit ended or unsold stages establish unsold; unknown and withdrawn remain unresolved", () => {
  for (const stage of ["ended", "unsold", "withdrawn", "unknown", "cancelled", "upcoming", "comingsoon", null]) {
    const x = extractFromHtml(nativePage({ stage, currentBid: 1500, currencyCode: "gbp", priceSold: null,
      title: "1926 Jowett Short Two", lotType: "car", makeName: null, modelName: null }), url);
    const closed = stage === "ended" || stage === "unsold";
    assertEquals([x.stage, x.sale_outcome, x.sold_at], [stage, closed ? "unsold" : null, null]);
    assertEquals([x.price_amount, x.currency, x.make, x.model], [1500, "GBP", null, null]);
    if (closed) assertEquals(x.price_kind, "high_bid");
    const sealed = extractFromHtml(nativePage({ stage, saleFormat: "sealed" }), url);
    assertEquals(sealed.sale_outcome, closed ? "sealed_unsold" : null);
  }
});

Deno.test("unknown stages retain source quotes without inventing current or sale prices", () => {
  for (const stage of ["withdrawn", "unknown", "cancelled", null]) {
    const x = extractFromHtml(nativePage({ stage, currentBid: 1500, currencyCode: "usd", priceSold: null }), url);
    assertEquals([x.price_amount, x.currency, x.price_kind, x.price, x.sale_outcome], [1500, "USD", null, null, null]);
  }
  for (const stage of ["live", "upcoming", "comingsoon"]) {
    const x = extractFromHtml(nativePage({ stage, currentBid: 1500, currencyCode: "usd", priceSold: null }), url);
    assertEquals([x.price_amount, x.price_kind, x.price], [1500, "current_bid", 1500]);
  }
});
