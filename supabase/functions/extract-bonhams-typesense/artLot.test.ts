import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ART_LOT_METHOD, artDepartmentFilter, artLotFromDoc, assetTypeForDepartment, catalogueLines, isPlaceholderEnd } from "./artLot.ts";

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
  // Not in the 2026-11-08 capture; live documents carry the house lot status (NEW on upcoming lots, read 2026-11-09).
  status: "NEW",
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

Deno.test("house status SOLD is sold on the hammer clock; an ended lot without a proven code is never inferred not_sold", () => {
  const sold = artLotFromDoc({
    ...fontana, status: "SOLD", id: "5000001", lotId: "12", lotNo: { full: "12" }, department: { code: "PIC-PRT", name: "Prints & Multiples" },
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
  assertEquals(unsold?.result, "unresolved:NEW"); // ended flag + no hammer is not evidence of an outcome
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

Deno.test("catalogue text: tags are removed to a fixed point and entities decode once", () => {
  const rec = artLotFromDoc({
    ...fontana, catalogDesc: "<div>Signed &amp;lt;b&amp;gt; dated <<b>i</b>>script> 50 &#215; 70 cm &quot;Ovale&quot;</div>",
  }, { readAt: "2026-11-08T15:00:00.000Z", page: 1, pass: 0 });
  assertEquals(rec?.catalog_text, 'Signed &lt;b&gt; dated script> 50 × 70 cm "Ovale"');
});

// Draft fixes 2026-11-09: outcome from the house lot status (isAuctionEnded is a sale clock), placeholder end dates kept raw.
const readAt = "2026-11-09T04:00:00.000Z";
const endedFlagFalseSold = {
  ...fontana, id: "18752-107", auctionId: "18752", lotId: "107", status: "SOLD",
  price: { estimateLow: 200, estimateHigh: 300, hammerPrice: 170, hammerPremium: 212.5 },
  flags: { isAuctionEnded: false, isResultPublished: true }, hammerTime: undefined, auctionEndDate: undefined,
};

Deno.test("status SOLD with isAuctionEnded false is sold, not upcoming (the upcoming-with-hammer bug)", () => {
  const rec = artLotFromDoc(endedFlagFalseSold as never, { readAt, page: 1, pass: 0 })!;
  assertEquals(rec.result, "sold");
  assertEquals(rec.hammer_price, 170);
  assertEquals(rec.price_basis, "hammer");
});

Deno.test("status WD is withdrawn even though the index says ended", () => {
  const rec = artLotFromDoc({ ...endedFlagFalseSold, status: "WD", price: { hammerPrice: 0 }, flags: { isAuctionEnded: true } } as never, { readAt, page: 1, pass: 0 })!;
  assertEquals(rec.result, "withdrawn");
});

Deno.test("codes whose meaning no source page states stay explicit, raw code kept, even with a hammer", () => {
  for (const code of ["BI", "CS", "WR"]) {
    const rec = artLotFromDoc({ ...endedFlagFalseSold, status: code, flags: { isAuctionEnded: true } } as never, { readAt, page: 1, pass: 0 })!;
    assertEquals(rec.result, `unresolved:${code}`);
    assertEquals(rec.observed_at_basis, "index_read");
  }
});

Deno.test("no status at all is unknown, never upcoming or sold", () => {
  const rec = artLotFromDoc({ ...endedFlagFalseSold, status: undefined } as never, { readAt, page: 1, pass: 0 })!;
  assertEquals(rec.result, "unknown");
  assertEquals(rec.hammer_price, 170);
});

Deno.test("the 2100-12-31 placeholder is stored as printed, withheld from derived status", () => {
  const rec = artLotFromDoc({ ...fontana, hammerTime: undefined, auctionEndDate: { datetime: "2100-12-31T23:59:59.000Z" } } as never, { readAt, page: 1, pass: 0 })!;
  assertEquals(rec.sale_ends_at, "2100-12-31T23:59:59.000Z");
  assertEquals(isPlaceholderEnd(rec.sale_ends_at, readAt), true);
  assertEquals(rec.result, "upcoming"); // NEW plus the explicit not-ended flag, not the placeholder
});

Deno.test("NEW with a hammer and a past end is contradicted: unresolved:NEW, not upcoming", () => {
  const doc = { ...fontana, price: { estimateLow: 3000, estimateHigh: 5000, hammerPrice: 900 },
    hammerTime: { datetime: "2026-11-03T12:00:00+00:00" }, auctionEndDate: { datetime: "2026-11-04T22:59:59+00:00" } };
  const rec = artLotFromDoc(doc as never, { readAt, page: 1, pass: 0 })!;
  assertEquals(rec.result, "unresolved:NEW");
  assertEquals(rec.hammer_price, 900);
});

Deno.test("a scheduled hammer time in the future does not end an upcoming lot", () => {
  const rec = artLotFromDoc(fontana as never, { readAt, page: 1, pass: 0 })!;
  assertEquals(rec.result, "upcoming");
});
