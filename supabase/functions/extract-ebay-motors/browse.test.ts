// Synthetic fixtures shaped by the Browse OpenAPI spec (read 2026-10-15), not captured eBay data. The live gate replaces them.
import { assertEquals } from "jsr:@std/assert@1";
import { aspectFilterFor, yearAspect } from "./browseApi.ts";
import { tallyZip3, zip3Of, censusRow, pickupFilter } from "./browseCensus.ts";
import { classifySeller, fullSizeImage, imagesOf, itemPagePhotos, linkVin, tierOfYear, toLanding, vinOf } from "./browseMap.ts";
import { sweep } from "./browseSweep.ts";
import { htmlToText } from "../_shared/htmlToText.ts";

const item = {
  itemId: "v1|123456789012|0", legacyItemId: "123456789012", title: "1969 Chevrolet C10 Pickup", itemWebUrl: "https://www.ebay.com/itm/123456789012?hash=x",
  description: "<p>Selling my dad's truck. Runs great.</p>", price: { value: "18500.00", currency: "USD" }, buyingOptions: ["FIXED_PRICE", "BEST_OFFER"],
  itemLocation: { city: "Reno", stateOrProvince: "NV", postalCode: "89501", country: "US" },
  image: { imageUrl: "https://i.ebayimg.com/images/g/AAA/s-l225.jpg" },
  additionalImages: [{ imageUrl: "https://i.ebayimg.com/images/g/BBB/s-l500.jpg" }, { imageUrl: "https://i.ebayimg.com/images/g/AAA/s-l1600.jpg" }],
  localizedAspects: [{ name: "Year", value: "1969" }, { name: "Make", value: "Chevrolet" }, { name: "Model", value: "C10" }, { name: "Mileage", value: "81,250" },
    { name: "VIN (Vehicle Identification Number)", value: "CE149Z123456" }, { name: "Exterior Color", value: "Green" }, { name: "Engine", value: "350ci V8" }],
  seller: { username: "dusty_garage_77", feedbackScore: 12, feedbackPercentage: "100.0" }, itemCreationDate: "2026-10-14T08:00:00.000Z", itemEndDate: "2026-11-13T08:00:00.000Z",
};

Deno.test("item gallery preserves photo order and excludes video posters and unrelated images", () => {
  const image = (id: string, label: string) => `<button class="ux-image-grid-item image-treatment" aria-label="${label}"><img alt="${label}" src="https://i.ebayimg.com/images/g/${id}/s-l140.webp"></button>`;
  const html = image('FIRST', 'Picture 1 of 2') + image('POSTER', 'Video 1 of 1') + image('SECOND', 'Picture 2 of 2')
    + image('FIRST', 'Picture 1 of 2') + '<img src="https://i.ebayimg.com/images/g/RELATED/s-l1600.webp">';
  assertEquals(itemPagePhotos(html), ['https://i.ebayimg.com/images/g/FIRST/s-l1600.webp', 'https://i.ebayimg.com/images/g/SECOND/s-l1600.webp']);
  assertEquals(itemPagePhotos('<p>No gallery captured</p>'), []);
});

Deno.test("full-size photos, deduplicated", () => {
  assertEquals(fullSizeImage("https://i.ebayimg.com/images/g/AAA/s-l225.jpg"), "https://i.ebayimg.com/images/g/AAA/s-l1600.jpg");
  assertEquals(imagesOf(item as any), ["https://i.ebayimg.com/images/g/AAA/s-l1600.jpg", "https://i.ebayimg.com/images/g/BBB/s-l1600.jpg"]);
});

Deno.test("an item maps to the writers' shapes, VIN kept even when pre-1981", () => {
  const l = toLanding(item as any, htmlToText)!;
  assertEquals([l.url, l.year, l.make, l.model], ["https://www.ebay.com/itm/123456789012", 1969, "Chevrolet", "C10"]);
  assertEquals(l.price.amount, 18500);
  assertEquals(l.ingestInput?.mileage, 81250);
  assertEquals(l.ingestInput?.vin, undefined);           // 12 characters: not a modern VIN, so not sent as creation identity
  assertEquals(l.vin, { vin: "CE149Z123456", modern: false });
  assertEquals(l.eventMetadata.tier, 1);
  assertEquals(l.seller.class, "likely_private");
});

Deno.test("identity missing -> no ingest input (kept as an unresolved observation)", () => {
  const l = toLanding({ ...item, localizedAspects: [{ name: "Year", value: "1969" }] } as any, (h) => h)!;
  assertEquals(l.ingestInput, null);
});

Deno.test("seller class is a claim from signals", () => {
  assertEquals(classifySeller({ seller: { username: "Prestige_Motors_LLC", feedbackScore: 4200 }, title: "x" }, "Financing available. Visit our showroom.").class, "likely_dealer");
  assertEquals(classifySeller({ seller: { username: "bob", feedbackScore: 3 }, title: "x" }, "").class, "unknown");
  assertEquals(vinOf({ vin: "1gcek14v6yz123456" }), { vin: "1GCEK14V6YZ123456", modern: true });
});

Deno.test("tiers and the Year aspect filter", () => {
  assertEquals([tierOfYear(1964), tierOfYear(1973), tierOfYear(1974), tierOfYear(1991), tierOfYear(1992)], [1, 1, 2, 2, 4]);
  const ya = yearAspect([{ localizedAspectName: "Make" }, { localizedAspectName: "Year", aspectValueDistributions: [{ localizedAspectValue: "1969", matchCount: 40 }, { localizedAspectValue: "1970", matchCount: 0 }] }])!;
  assertEquals(aspectFilterFor(ya.name, [1969, 1970]), "categoryId:6001,Year:{1969|1970}");
});

// A fake supabase: the held read answers from a set; nothing else is touched in a dry run.
const fakeSb = (held: string[]) => ({
  from: () => { const q: any = { select: () => q, eq: () => q, in: () => q, limit: () => Promise.resolve({ data: held.map((k) => ({ listing_url: `https://www.ebay.com/itm/${k}` })), error: null }) }; return q; },
});
const summary = (id: string, user = "x") => ({ itemId: `v1|${id}|0`, legacyItemId: id, title: "t", seller: { username: user, feedbackScore: 1 }, buyingOptions: ["FIXED_PRICE"] });

Deno.test("sweep stops at a page whose items are all held, and reports per tier", async () => {
  let searches = 0;
  const client: any = {
    calls: 0,
    remainingToday: async () => ({ remaining: 4000, limit: 5000, resetAt: null }),
    aspectRefinements: async () => { client.calls++; return [{ localizedAspectName: "Year", aspectValueDistributions: [{ localizedAspectValue: "1969", matchCount: 5 }] }]; },
    search: async () => { client.calls++; searches++; return { total: 2, next: "more", itemSummaries: [summary("111111111111"), summary("222222222222")] }; },
  };
  const rep = await sweep(fakeSb(["111111111111", "222222222222"]), client, { tiers: [1], dryRun: true });
  assertEquals([rep.ok, searches, rep.per_tier[1].seen, rep.per_tier[1].held, rep.per_tier[1].new], [true, 1, 2, 2, 0]);
});

Deno.test("sweep refuses to spend the reserved quota", async () => {
  const client: any = { calls: 0, remainingToday: async () => ({ remaining: 300, limit: 5000, resetAt: null }) };
  const rep = await sweep(fakeSb([]), client, { reserveCalls: 400, dryRun: true });
  assertEquals(rep.stopped?.startsWith("quota"), true);
});

Deno.test("the year aspect is eBay's live name, Model Year, and filters on that exact name", () => {
  const ya = yearAspect([{ localizedAspectName: "Make" }, { localizedAspectName: "Model Year", aspectValueDistributions: [{ localizedAspectValue: "1969", matchCount: 7 }] }])!;
  assertEquals(ya.name, "Model Year");
  assertEquals(aspectFilterFor(ya.name, [1969]), "categoryId:6001,Model Year:{1969}");
});

Deno.test("a VIN of one repeated character is a placeholder, not a VIN", () => {
  for (const v of ["00000000000000000", "11111111111111111", "xxxxxxxxxxxxxxxxx", "000000"]) assertEquals(vinOf({ vin: v }).vin, null);
  assertEquals(vinOf({ vin: "1GCEK14V5SZ123456" }).vin, "1GCEK14V5SZ123456");
});

// A listing may join a vehicle another source already holds only on a strong identifier. Every VIN here is invented.
Deno.test("linkVin: a 17-character VIN links for a 1980-or-later car when its check digit holds", () => {
  assertEquals(linkVin("1ABCD12E3FG100001", 1993), { grade: "vin17", keys: ["1ABCD12E3FG100001"] });
  assertEquals(linkVin("1ABCD12E0FG100001", 1993), null);                    // North American WMI, check digit fails
  assertEquals(linkVin("ZAZZZ00Z0ZZ000001", 1993), { grade: "vin17", keys: ["ZAZZZ00Z0ZZ000001"] }); // no NA check digit
  assertEquals(linkVin("1NUKEO0T1EX000002", 1993), null);                    // O is not in the VIN alphabet
  assertEquals(linkVin("1ABCD12E3FG100001", null), { grade: "vin17", keys: ["1ABCD12E3FG100001"] });
});

Deno.test("linkVin: a 17-character VIN on a pre-1980 car links only when its check digit holds (an assigned replica VIN)", () => {
  assertEquals(linkVin("1ABCD12E3FG100001", 1965), { grade: "vin17", keys: ["1ABCD12E3FG100001"] });
  assertEquals(linkVin("ZAZZZ00Z0ZZ000001", 1965), null);
  assertEquals(linkVin("DRMVB0000100001MO", 1965), null);                    // state-assigned number with O: lands, never links
});

Deno.test("linkVin: a pre-1981 chassis number links; eBay's zero padding is read off", () => {
  assertEquals(linkVin("9F02Z100001", 1969), { grade: "chassis", keys: ["9F02Z100001"] });
  assertEquals(linkVin("18100001", 1932), { grade: "chassis", keys: ["18100001"] });
  assertEquals(linkVin("0000008T02S100001", 1968), { grade: "chassis", keys: ["0000008T02S100001", "8T02S100001"] });
  assertEquals(linkVin("9F02Z100001", 1981), null);                          // a short VIN on a 17-character-era car is a partial
  assertEquals(linkVin("9F02Z100001", null), null);                          // era unknown
  assertEquals(linkVin("F02Z1001", 1969), { grade: "chassis", keys: ["F02Z1001"] });
  assertEquals(linkVin("F02Z101", 1969), null);                              // under 8 characters
});

Deno.test("linkVin: placeholders never link", () => {
  for (const v of ["00000000000000019", "12345678900000000", "11111111", "11111111111111111", "ABCDEFGHJK", "0000000000", "N/A", "", null]) {
    assertEquals(linkVin(v as string | null, 1965), null, String(v));
  }
  assertEquals(linkVin("11111111111111111", 1995), null);
});

Deno.test("census: ZIP prefix tally, filter and row", () => {
  assertEquals(zip3Of("891**"), "891");
  assertEquals(zip3Of(undefined), null);
  const tally: Record<string, number> = {};
  tallyZip3([{ itemLocation: { postalCode: "891**" } }, { itemLocation: { postalCode: "89123" } }, { itemLocation: {} }], tally);
  assertEquals(tally, { "891": 2, none: 1 });
  assertEquals(pickupFilter("89101"), "deliveryOptions:{SELLER_ARRANGED_LOCAL_PICKUP},pickupCountry:US,pickupPostalCode:89101,pickupRadius:100,pickupRadiusUnit:mi");
  const row = censusRow("src", { as_of: "2026-10-20T00:00:00.000Z", total: 10, makes: { Ford: 4 }, years: { "1969": 2 }, vintage: { total: 2, read: 2, by_zip3: { "891": 2 }, skipped: null }, local_pickup: {}, calls: 3 });
  assertEquals([row.universe_active, row.by_category.vintage_le_1991, row.raw_response.vintage_by_zip3["891"]], [10, 2, 2]);
});
