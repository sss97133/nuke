import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractFromHtml } from "./extract.ts";

const html = await Deno.readTextFile(new URL("./fixtures/listing-chevy1500.html", import.meta.url));
const url = "https://classiccars.com/listings/view/2118864/1991-chevrolet-1500-for-sale-in-preston-mississippi-39354";

Deno.test("identity, price, odometer, place", () => {
  const x = extractFromHtml(html, url);
  assertEquals([x.listing_id, x.year, x.make, x.model], ["2118864", 1991, "Chevrolet", "1500"]);
  assertEquals([x.price, x.mileage, x.location], [18500, 20000, "Preston, Mississippi"]);
  assertEquals([x.exterior_color, x.interior_color, x.transmission, x.title_status, x.seller_type], ["Dark Gray", "Burgundy", "Automatic", "Clear", "Private Seller"]);
});

Deno.test("description is unescaped text and the gallery is the listing's own full-size photos", () => {
  const x = extractFromHtml(html, url);
  assert(x.description?.startsWith("1991 Chevrolet Pickup"), x.description ?? "null");
  assert(!x.description?.includes("&lt;"));
  assert(x.image_urls.length >= 5, String(x.image_urls.length));
  assert(x.image_urls.every((u) => u.includes("/listing/211/8864/") && u.endsWith("-std.jpg")));
});

Deno.test("a page without the listing block is an error, not an empty listing", () => {
  let threw = false;
  try { extractFromHtml("<html></html>", url); } catch { threw = true; }
  assert(threw);
});
