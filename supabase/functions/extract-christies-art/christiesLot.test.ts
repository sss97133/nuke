import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  artDepartment, catalogueLines, christiesLotRecord, currencyOf, decodePosition, encodePosition, monthAt, saleNumber,
  type ChristiesEvent, type ChristiesLot,
} from "./christiesLot.ts";

// Read live 2026-11-08: sale 24260 (20th/21st Century: London Evening Sale), lot 101 sold and lot 124 unsold.
const fixture = JSON.parse(await Deno.readTextFile(new URL("./fixture.json", import.meta.url))) as { event: ChristiesEvent; lots: ChristiesLot[] };
const ctx = { readAt: "2026-11-09T04:00:00.000Z", page: 1, pass: 0 };

Deno.test("sale number and art department come from the calendar event", () => {
  assertEquals(saleNumber(fixture.event), "24260");
  assertEquals(artDepartment(fixture.event), { code: "CHR-7", name: "Fine Art" });
  assertEquals(artDepartment({ event_id: "1", filter_ids: "|category_14|event_0|" }), null);
});

Deno.test("a sold lot: price realised under the house label (premium semantics NEED SOURCE PROOF), sale-end clock, artist split into the fold's two lines", () => {
  const rec = christiesLotRecord(fixture.lots[0], fixture.event, ctx)!;
  assertEquals(rec.identity_key, "christies:" + fixture.lots[0].object_id);
  assertEquals(rec.result, "unresolved:PRICE_REALISED");
  assertEquals(rec.price_basis, "price_realised");
  assertEquals(rec.hammer_price, null);
  assertEquals(rec.hammer_premium, 588800);
  assertEquals(rec.currency, "GBP");
  assertEquals(rec.lines.slice(0, 2), ["JOSEF ALBERS", "(1888-1976)"]);
  assertEquals(rec.observed_at_basis, "sale_end");
  assertEquals(rec.sale_key, "christies-24260");
});

Deno.test("an unpriced lot after the sale is withheld as unknown (unsold vs withheld NEEDS SOURCE PROOF)", () => {
  const rec = christiesLotRecord(fixture.lots[1], fixture.event, ctx)!;
  assertEquals(rec.result, "unknown");
  assertEquals(rec.hammer_premium, null);
});

Deno.test("withdrawn and upcoming lots", () => {
  const base = fixture.lots[0];
  assertEquals(christiesLotRecord({ ...base, lot_withdrawn: true }, fixture.event, ctx)!.result, "withdrawn");
  const up = christiesLotRecord({ ...base, is_auction_over: false, is_in_progress: true, price_realised: "", current_bid: "120000.0" }, fixture.event, ctx)!;
  assertEquals(up.result, "upcoming");
  assertEquals(up.high_bid, 120000);
});

Deno.test("a first line without dates is left as printed (no party is invented)", () => {
  assertEquals(catalogueLines({ object_id: "1", description_txt: "A GILT-COPPER ALLOY FIGURE<br> CHINA, NORTHERN WEI DYNASTY (386-535 CE)" }),
    ["A GILT-COPPER ALLOY FIGURE", "CHINA, NORTHERN WEI DYNASTY (386-535 CE)"]);
  assertEquals(catalogueLines({ object_id: "1", description_txt: "A BRASS FIGURE OF MAITREYA (CIRCA 1650)" }, true),
    ["A BRASS FIGURE OF MAITREYA (CIRCA 1650)"]);
  assertEquals(catalogueLines({ object_id: "1", description_txt: "JOSEF ALBERS (1888-1976)" }, false), ["JOSEF ALBERS (1888-1976)"]);
  assertEquals(currencyOf({ object_id: "1", estimate_txt: "HKD 2,400,000 - 3,800,000" }), "HKD");
});

Deno.test("a placeholder sale end is stored as printed and not used as the observation clock", () => {
  const rec = christiesLotRecord({ ...fixture.lots[0], end_date: "2100-12-31T00:00Z" }, fixture.event, ctx)!;
  assertEquals(rec.sale_ends_at, "2100-12-31T00:00:00.000Z");
  assertEquals(rec.observed_at_basis, "index_read");
});

Deno.test("walk position round-trips and months count back across years", () => {
  assertEquals(decodePosition(encodePosition(14, 7)), { monthOffset: 14, saleIndex: 7 });
  assertEquals(monthAt({ year: 2026, month: 2 }, 3), { year: 2025, month: 11 });
});
