// Run: deno test --allow-read supabase/functions/extract-vehicle-data-ai/priceColumns.test.ts
import { listingPriceColumns } from "./priceColumns.ts";

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

Deno.test("a listing that shows only a price writes the ask to asking_price and leaves sale_price null", () => {
  equal(listingPriceColumns({ price: 27500, sold_price: null }), { sale_price: null, asking_price: 27500 });
  equal(listingPriceColumns({ price: 27500 }), { sale_price: null, asking_price: 27500 });
});

Deno.test("a listing that states a sale writes sale_price; the ask stays in asking_price", () => {
  equal(listingPriceColumns({ price: 30000, sold_price: 28500 }), { sale_price: 28500, asking_price: 30000 });
});

Deno.test("a stated sale with no ask leaves asking_price null", () => {
  equal(listingPriceColumns({ price: null, sold_price: 28500 }), { sale_price: 28500, asking_price: null });
});

Deno.test("no price, or a zero price, writes neither column", () => {
  equal(listingPriceColumns({}), { sale_price: null, asking_price: null });
  equal(listingPriceColumns({ price: 0, sold_price: 0 }), { sale_price: null, asking_price: null });
});

Deno.test("the extractor builds its vehicle payload from that rule, not from an inline price mapping", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  if (!source.includes("...listingPriceColumns(normalized)")) {
    throw new Error("index.ts must take sale_price and asking_price from listingPriceColumns(normalized)");
  }
  if (/sale_price\s*:\s*normalized\.sold_price\s*\|\|\s*normalized\.price/.test(source)) {
    throw new Error("index.ts maps the listing price into sale_price again");
  }
});
