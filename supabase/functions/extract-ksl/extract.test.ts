import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractFromHtml } from "./extract.ts";

const html = await Deno.readTextFile(new URL("./fixtures/listing-tahoe.html", import.meta.url));

Deno.test("flight payload: identity, price, location, clocks", () => {
  const x = extractFromHtml(html, "https://cars.ksl.com/listing/10718560");
  assertEquals([x.source, x.listing_id, x.year, x.make, x.model, x.trim], ["flight_payload", "10718560", 2005, "Chevrolet", "Tahoe", "LT"]);
  assertEquals([x.price, x.mileage, x.location, x.zip], [2100, 265003, "West Jordan, UT", "84081"]);
  assertEquals(x.vin, "1GNEK13T05J000000");
  assertEquals(x.posted_at, "2026-07-25T18:36:43.000Z");
  assertEquals(x.status, "Active");
});

Deno.test("flight payload: full gallery and the seller comments behind the $ reference", () => {
  const x = extractFromHtml(html, "https://cars.ksl.com/listing/10718560");
  assertEquals(x.image_urls.length, 13);
  assert(x.description?.startsWith("OK 2005 Chevy Tahoe."), x.description ?? "null");
  assert((x.description?.length ?? 0) > 500);
});

Deno.test("json-ld fallback when the payload is gone", () => {
  const stripped = html.replace(/<script>self\.__next_f[\s\S]*?<\/script>/g, "");
  const x = extractFromHtml(stripped, "https://cars.ksl.com/listing/10718560");
  assertEquals([x.source, x.year, x.price, x.mileage], ["json_ld", 2005, 2100, 265003]);
});
