// deno test --allow-read supabase/functions/mcp-connector/advisor/find_rank_test.ts
import { looksLikePart, rankFindResults } from "./find_rank.ts";

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

Deno.test("find_asset ranks real E30 M3s above seats and incomplete rows", () => {
  const rows = [
    { id: "seats", year: 1990, make: "BMW", model: "E30 M3 Seats", sale_price: 4000, primary_image_url: "x", listing_url: "https://bringatrailer.com/listing/seats/" },
    { id: "bare", year: 1990, make: "BMW", model: "M3", sale_price: null, primary_image_url: null, listing_url: "conceptcarz://event/1" },
    { id: "wrongyear", year: 1991, make: "BMW", model: "M3", sale_price: 90000, primary_image_url: "x", listing_url: "https://bringatrailer.com/listing/b/" },
    { id: "full", year: 1990, make: "BMW", model: "M3", sale_price: 120000, primary_image_url: "x", listing_url: "https://bringatrailer.com/listing/a/" },
  ];
  const ranked = rankFindResults(rows, ["BMW", "M3"], 1990).map((r) => r.id);
  assert(ranked[0] === "full", ranked.join(","));
  assert(ranked[1] === "bare", ranked.join(","));
  assert(ranked[ranked.length - 1] === "seats", ranked.join(","));
});

Deno.test("part detection", () => {
  assert(looksLikePart({ model: "E30 M3 Seats" }), "seats");
  assert(looksLikePart({ model: "911 Fuchs wheels" }), "wheels");
  assert(!looksLikePart({ model: "M3" }), "car");
  assert(!looksLikePart({ model: "911 Carrera" }), "car2");
});
