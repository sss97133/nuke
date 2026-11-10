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
