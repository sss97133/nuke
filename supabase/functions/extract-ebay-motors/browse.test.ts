// Synthetic fixtures shaped by the Browse OpenAPI spec (read 2026-10-15), not captured eBay data. The live gate replaces them.
import { assertEquals } from "jsr:@std/assert@1";
import { aspectFilterFor, yearAspect } from "./browseApi.ts";
import { classifySeller, fullSizeImage, imagesOf, tierOfYear, toLanding, vinOf } from "./browseMap.ts";
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
