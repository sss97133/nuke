import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseKslSearchCards, parseKslSearchCount } from "./kslCards.ts";

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

Deno.test("published counts preserve whole, filtered, empty, and singular search results", () => {
  assertEquals(parseKslSearchCount('<button>Show <span>67,878</span> results</button>'), 67878);
  assertEquals(parseKslSearchCount('<div class="font-bold hidden sm:flex">1,174 results</div>'), 1174);
  assertEquals(parseKslSearchCount('<div>0 results</div>'), 0);
  assertEquals(parseKslSearchCount('<button>Show 1 result</button>'), 1);
  assertEquals(parseKslSearchCount('<div>1,174 results</div><div>1,174 results</div>'), 1174);
});
Deno.test("missing, conflicting, script-only counts and human challenges are not censuses", () => {
  assertEquals(parseKslSearchCount(html), null);
  assertEquals(parseKslSearchCount('<div>1,174 results</div><div>1,175 results</div>'), null);
  assertEquals(parseKslSearchCount('<script>"67,878 results"</script>'), null);
  assertEquals(parseKslSearchCount('Press & Hold to confirm you are a human. 67,878 results'), null);
});
