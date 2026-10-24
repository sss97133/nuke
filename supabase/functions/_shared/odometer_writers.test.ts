// Placeholder-sentinel wiring for the eBay Motors, ClassicCars (via ingest) and Facebook refine writers.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { flagPlaceholderMileage, isPlaceholderMileage } from "./odometer.ts";
import { parseMileage } from "./extractionHealth.ts";
import { extractFromHtml } from "../extract-classiccars/extract.ts";

function fakeClient() {
  const rows: Record<string, unknown>[] = [];
  return { rows, from: (t: string) => ({ insert: (r: Record<string, unknown>) => { rows.push({ table: t, ...r }); return Promise.resolve({ error: null }); } }) };
}

Deno.test("ebay: item-specifics 99,999 parses to a sentinel and is flagged under its writer run id", async () => {
  const v = parseMileage("99,999 mi").value;
  assertEquals(v, 99999);
  const c = fakeClient();
  assert(await flagPlaceholderMileage(c, "veh-1", v, "extract_ebay_motors", "https://www.ebay.com/itm/1"));
  assertEquals(c.rows[0].table, "mileage_value_status");
  assertEquals(c.rows[0].run_id, "placeholder_sentinel_v1_writer_extract_ebay_motors");
  assertEquals(c.rows[0].status, "suspect");
});

Deno.test("ebay: a real reading is not flagged", async () => {
  const c = fakeClient();
  assertEquals(await flagPlaceholderMileage(c, "veh-1", parseMileage("48,213 miles").value, "extract_ebay_motors"), false);
  assertEquals(c.rows.length, 0);
});

Deno.test("classiccars: extracted sentinel odometer is caught; the fixture's 20000 is not", async () => {
  const html = await Deno.readTextFile(new URL("../extract-classiccars/fixtures/listing-chevy1500.html", import.meta.url));
  const url = "https://classiccars.com/listings/view/2118864/x";
  assertEquals(isPlaceholderMileage(extractFromHtml(html, url).mileage), false);
  const x = extractFromHtml(html.replaceAll(">20000<", ">123456<").replaceAll('"value": "20000"', '"value": "123456"'), url);
  assertEquals(x.mileage, 123456);
  assert(isPlaceholderMileage(x.mileage));
});

Deno.test("facebook refine: flag is best-effort and never throws on insert error", async () => {
  const bad = { from: () => ({ insert: () => Promise.resolve({ error: { message: "rls" } }) }) };
  assertEquals(await flagPlaceholderMileage(bad, "veh-2", 111111, "refine_fb_listing", null), false);
  const thrower = { from: () => { throw new Error("down"); } };
  assertEquals(await flagPlaceholderMileage(thrower, "veh-2", 111111, "refine_fb_listing", null), false);
});

Deno.test("writers call flagPlaceholderMileage after their vehicles mileage write", async () => {
  for (const [f, w, n] of [["../extract-ebay-motors/index.ts", "extract_ebay_motors", 1], ["../refine-fb-listing/index.ts", "refine_fb_listing", 2], ["../ingest/index.ts", "ingest_", 2]] as const) {
    const src = await Deno.readTextFile(new URL(f, import.meta.url));
    assert(src.includes('from "../_shared/odometer.ts"') || src.includes("from '../_shared/odometer.ts'"), f);
    assertEquals((src.match(new RegExp(`flagPlaceholderMileage\\([^;]*${w}`, "g")) || []).length, n, f);
  }
});
