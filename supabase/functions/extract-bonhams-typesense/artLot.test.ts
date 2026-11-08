import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ART_LOT_METHOD, artDepartmentFilter, artLotFromDoc, assetTypeForDepartment, catalogueLines } from "./artLot.ts";

// Shape of a live index document, read 2026-11-08 (Fontana screenprint, PIC-GEN, result published, sale not yet ended).
const fontana = {
  id: "6211694", auctionId: "32241", lotId: "0", lotUniqueId: "6211694", lotNo: { full: "0", number: 0, letter: "" },
  title: "\"Lucio Fontana (Italian, 1899-1968) Concetto Spaziale (Ovale violet avec fente) Screenprint in purple, 1965\"",
  slug: "\"lucio-fontana-italian-1899-1968-concetto-spaziale\"",
  catalogDesc: "\"<div class=\\\"LotName\\\">Lucio Fontana (Italian, 1899-1968)</div>\\n<div class=\\\"LotDesc\\\">Concetto Spaziale <br />Screenprint in purple, 1965</div>\"",
  styledDescription: "<div class=\"firstLine\">Lucio Fontana</div><div class=\"secondLine\">(Italian, 1899-1968)</div><div class=\"otherLine\">Concetto Spaziale (Ovale violet avec fente)</div>",
  footnotes: "",
  department: { code: "PIC-GEN", name: "Fine Art" },
  currency: { iso_code: "GBP", bonhams_code: "£" },
  country: { code: "GB", name: "United Kingdom" },
  price: { estimateLow: 3000, estimateHigh: 5000, hammerPrice: 0, hammerPremium: 0 },
  flags: { isAuctionEnded: false, isResultPublished: true, isWithoutReserve: false },
  hammerTime: { datetime: "2026-12-17T12:01:00+00:00" },
  auctionEndDate: { datetime: "2026-12-17T12:00:00+00:00" },
  image: "{\"url\": \"https://images1.bonhams.com/image?src=Images/live/2026-10/21/25915011-1-3.jpg\", \"use\": \"MAIN\"}",
  symbols: [{ symbol: "AR", shortDescription: "Artists Resale Right" }],
};

Deno.test("department codes map to our two types; everything else is outside the slice", () => {
  assertEquals(assetTypeForDepartment("PIC-GEN"), "artwork");
  assertEquals(assetTypeForDepartment("pic-prt"), "artwork");
  assertEquals(assetTypeForDepartment("PHO"), "artwork");
  assertEquals(assetTypeForDepartment("WOA"), "artwork");
  assertEquals(assetTypeForDepartment("MOT-AUT"), "automobilia");
  assertEquals(assetTypeForDepartment("COL-AUT"), "automobilia");
  assertEquals(assetTypeForDepartment("MOT-CAR"), null);
  assertEquals(assetTypeForDepartment("JWL"), null);
  assertEquals(assetTypeForDepartment(undefined), null);
});

Deno.test("an upcoming published lot keeps the house's lines, estimates and image URL; the clock is the index read", () => {
  const rec = artLotFromDoc(fontana, { readAt: "2026-11-08T15:00:00.000Z", page: 4, pass: 0 });
  if (!rec) throw new Error("expected a record");
  assertEquals(rec.identity_key, "bonhams:6211694");
  assertEquals(rec.asset_type, "artwork");
  assertEquals(rec.title.startsWith("Lucio Fontana (Italian, 1899-1968) Concetto Spaziale"), true);
  assertEquals(rec.result, "upcoming");
  assertEquals(rec.price_basis, null);
  assertEquals(rec.hammer_price, null);
  assertEquals(rec.estimate_low, 3000);
  assertEquals(rec.estimate_high, 5000);
  assertEquals(rec.currency, "GBP");
  assertEquals(rec.observed_at, "2026-11-08T15:00:00.000Z");
  assertEquals(rec.observed_at_basis, "index_read");
  assertEquals(rec.sale_ends_at, "2026-12-17T12:00:00.000Z");
  assertEquals(rec.sale_key, "bonhams-32241");
  assertEquals(rec.lot_number, null);
  assertEquals(rec.lines, ["Lucio Fontana", "(Italian, 1899-1968)", "Concetto Spaziale (Ovale violet avec fente)"]);
  assertEquals(rec.image_url, "https://images1.bonhams.com/image?src=Images/live/2026-10/21/25915011-1-3.jpg");
  assertEquals(rec.symbols, ["AR"]);
  assertEquals(rec.catalog_text?.includes("Screenprint in purple, 1965"), true);
  assertEquals(rec.source_url, "https://www.bonhams.com/auction/32241/lot/6211694/lucio-fontana-italian-1899-1968-concetto-spaziale");
  assertEquals(rec.extraction_method, ART_LOT_METHOD);
  assertEquals(rec.ts_page, 4);
});

Deno.test("an ended lot with a hammer is sold on the hammer clock; ended without a hammer is not_sold", () => {
  const sold = artLotFromDoc({
    ...fontana, id: "5000001", lotId: "12", lotNo: { full: "12" }, department: { code: "PIC-PRT", name: "Prints & Multiples" },
    price: { estimateLow: 3000, estimateHigh: 5000, hammerPrice: 4200, hammerPremium: 5376 },
    flags: { isAuctionEnded: true, isResultPublished: true }, hammerTime: { datetime: "2025-03-20T14:01:00+00:00" },
  }, { readAt: "2026-11-08T15:00:00.000Z", page: 1, pass: 2 });
  if (!sold) throw new Error("expected a record");
  assertEquals(sold.result, "sold");
  assertEquals(sold.price_basis, "hammer");
  assertEquals(sold.hammer_price, 4200);
  assertEquals(sold.hammer_premium, 5376);
  assertEquals(sold.observed_at, "2025-03-20T14:01:00.000Z");
  assertEquals(sold.observed_at_basis, "hammer_time");
  assertEquals(sold.lot_number, "12");
  assertEquals(sold.source_url, "https://www.bonhams.com/auction/32241/lot/12/lucio-fontana-italian-1899-1968-concetto-spaziale");
  assertEquals(sold.ts_pass, 2);

  const unsold = artLotFromDoc({
    ...fontana, id: "5000002", price: { estimateLow: 3000, estimateHigh: 5000, hammerPrice: 0, hammerPremium: 0 },
    flags: { isAuctionEnded: true, isResultPublished: true }, hammerTime: { datetime: "2025-03-20T14:02:00+00:00" },
  }, { readAt: "2026-11-08T15:00:00.000Z", page: 1, pass: 0 });
  assertEquals(unsold?.result, "not_sold");
  assertEquals(unsold?.hammer_price, null);
});

Deno.test("a car-department lot, an untitled lot and a non-numeric id are outside the slice", () => {
  assertEquals(artLotFromDoc({ ...fontana, department: { code: "MOT-CAR", name: "Collector Cars" } }, { readAt: "2026-11-08T15:00:00Z", page: 1, pass: 0 }), null);
  assertEquals(artLotFromDoc({ ...fontana, title: "\"\"" }, { readAt: "2026-11-08T15:00:00Z", page: 1, pass: 0 }), null);
  assertEquals(artLotFromDoc({ ...fontana, id: "abc" }, { readAt: "2026-11-08T15:00:00Z", page: 1, pass: 0 }), null);
});

Deno.test("catalogue lines and the department filter", () => {
  assertEquals(catalogueLines({ id: "1" }), []);
  assertEquals(artDepartmentFilter("PIC-GEN"), "department.code:=PIC-GEN && flags.isResultPublished:true");
});
