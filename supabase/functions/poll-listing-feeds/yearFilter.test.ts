import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { slugYear, splitByYear } from "./yearFilter.ts";

Deno.test("the year comes from the slug's first four digits", () => {
  assertEquals(slugYear("https://carsandbids.com/auctions/3ABcDeF/1987-porsche-911-carrera"), 1987);
  assertEquals(slugYear("https://carsandbids.com/auctions/3ABcDeF/2004-bmw-m3"), 2004);
  assertEquals(slugYear("https://carsandbids.com/auctions/3ABcDeF/not-a-year"), null);
  assertEquals(slugYear("nope"), null);
});

Deno.test("only slug years inside the slice are queued; the rest keep their year", () => {
  const urls = ["https://c.test/a/x/1964-ford-mustang", "https://c.test/a/y/1991-bmw-m5", "https://c.test/a/z/1992-bmw-m5", "https://c.test/a/w/2022-ford-gt", "https://c.test/a/v/unknown-thing"];
  const r = splitByYear(urls, 1964, 1991);
  assertEquals(r.keep, [urls[0], urls[1]]);
  assertEquals(r.rest.map((x) => x.year), [1992, 2022, null]);
});
