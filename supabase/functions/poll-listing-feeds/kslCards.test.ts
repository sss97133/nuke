import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseKslSearchCards } from "./kslCards.ts";

const html = await Deno.readTextFile(new URL("./fixtures/ksl-search.html", import.meta.url));

Deno.test("each search card gives id, year, seller class, created time and price", () => {
  const cards = parseKslSearchCards(html);
  assertEquals(cards.length, 6);
  const c = cards[1];
  assertEquals([c.year, c.seller_type, c.url], [1968, "private", `https://cars.ksl.com/listing/${c.listing_id}`]);
  assertEquals(cards[0].seller_type, "dealership");
  assertEquals(typeof cards[0].created_at, "string");
});

Deno.test("a page without results gives no cards", () => {
  assertEquals(parseKslSearchCards("<html></html>"), []);
});
