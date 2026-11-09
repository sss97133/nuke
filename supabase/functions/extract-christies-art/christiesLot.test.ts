import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  artDepartment, catalogueLines, christiesLotRecord, currencyOf, decodePosition, encodePosition, monthAt, PREMIUM_SCHEDULES,
  premiumScheduleFor, PRICE_SEMANTICS, saleNumber, withLotPage, type ChristiesEvent, type ChristiesLot,
} from "./christiesLot.ts";
import { lotHeader, premiumScheduleRows } from "./christiesPage.ts";
import { Reader, withLotPages } from "./christiesRead.ts";

// Read live 2026-11-08: sale 24260 (20th/21st Century: London Evening Sale), lot 101 sold and lot 124 unsold.
const fixture = JSON.parse(await Deno.readTextFile(new URL("./fixture.json", import.meta.url))) as { event: ChristiesEvent; lots: ChristiesLot[] };
const ctx = { readAt: "2026-11-09T04:00:00.000Z", page: 1, pass: 0 };

Deno.test("sale number and art department come from the calendar event", () => {
  assertEquals(saleNumber(fixture.event), "24260");
  assertEquals(artDepartment(fixture.event), { code: "CHR-7", name: "Fine Art" });
  assertEquals(artDepartment({ event_id: "1", filter_ids: "|category_14|event_0|" }), null);
});

Deno.test("a priced lot: price realised under the house label (outcome NEEDS SOURCE PROOF), sale-end clock, artist split into the fold's two lines", () => {
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

// Saved public pages (2026-11-09): two lot pages of sale 24260 and the house's buyer's premium page. No network in these tests.
const page = (f: string) => Deno.readTextFile(new URL(`./${f}`, import.meta.url));
const lot101 = await page("lot-6609192.html");
const lot105 = await page("lot-6609196.html");
const finance = await page("financial-information.html");

Deno.test("price realised is hammer plus buyer's premium, citing the 2025 year-end release; no hammer is backed out", () => {
  const rec = christiesLotRecord(fixture.lots[0], fixture.event, ctx)!;
  assertEquals(rec.price_semantics, PRICE_SEMANTICS);
  assertEquals(rec.price_semantics!.reading, "hammer_plus_buyers_premium");
  assertEquals(rec.price_semantics!.source_url, "https://press.christies.com/62b-projected-global-sales-in-2025/");
  assertEquals(rec.hammer_price, null);
  assertEquals(christiesLotRecord(fixture.lots[1], fixture.event, ctx)!.price_semantics, null);
});

Deno.test("the printed premium schedule is the parse of the saved house page, and is attached by sale site and date", () => {
  const printed = premiumScheduleRows(finance);
  assertEquals(printed.effective_txt, "1 September 2026");
  assertEquals(printed.rows, PREMIUM_SCHEDULES[0].rows.map((r) => ({ site: r.site, rates: [...r.rates], thresholds: [...r.thresholds] })));
  const rec = christiesLotRecord(fixture.lots[0], fixture.event, ctx)!;
  assertEquals(rec.premium_schedule?.site, "London");
  assertEquals(rec.premium_schedule?.rates, ["28.0%", "22.0%", "15.0%"]);
  assertEquals(rec.premium_schedule?.thresholds[0], "Up to £1,500,000");
  assertEquals(rec.premium_schedule?.effective_from, "2026-09-01");
  // Before the saved schedule, or at a site it does not print: nothing is attached (no older schedule is assumed).
  assertEquals(premiumScheduleFor("London", "2025-10-14T00:00Z"), null);
  assertEquals(premiumScheduleFor("Milan", "2026-10-14T00:00Z"), null);
  assertEquals(christiesLotRecord({ ...fixture.lots[0], start_date: "2025-03-01T00:00Z" }, fixture.event, ctx)!.premium_schedule, null);
});

// Consistency check only (nothing here is stored): the printed London bands turn a whole hammer into each saved price realised.
function londonPrice(hammer: number): number {
  const bands: Array<[number, number]> = [[1_500_000, 0.28], [6_000_000, 0.22], [Infinity, 0.15]];
  let prev = 0, bp = 0;
  for (const [top, rate] of bands) { bp += Math.max(0, Math.min(hammer, top) - prev) * rate; prev = top; }
  return Math.round(hammer + bp);
}
Deno.test("the saved lot prices are hammer plus premium under the printed London schedule (one band and two bands)", () => {
  assertEquals(lotHeader(lot101)!.price_realised_txt, "GBP 588,800");
  assertEquals(londonPrice(460_000), 588_800);
  assertEquals(lotHeader(lot105)!.price_realised_txt, "GBP 3,262,000");
  assertEquals(londonPrice(2_600_000), 3_262_000);
});

Deno.test("lot page symbols are kept as printed (code, glyph, name, description); nothing is mapped to a meaning", () => {
  const h101 = lotHeader(lot101)!;
  assertEquals(h101.object_id, "6609192");
  assertEquals(h101.symbols_printed!.map((s) => s.code), ["S17"]);
  const h105 = lotHeader(lot105)!;
  assertEquals(h105.object_id, "6609196");
  assertEquals(h105.symbols_printed!.map((s) => [s.code, s.symbol, s.name]), [
    ["S02", "○♦", "Third party guarantee"], ["S06", "λ", "Artist's Resale Right"], ["S17", "*", "VAT (reduced rate)"]]);
  assertEquals(/third part/i.test(h105.symbols_printed![0].description ?? ""), true);
  assertEquals(lotHeader("<html><body>no header</body></html>"), null);
});

Deno.test("withLotPage attaches symbols only from this lot's own page", () => {
  const rec = christiesLotRecord(fixture.lots[0], fixture.event, ctx)!;
  const withSyms = withLotPage(rec, lotHeader(lot101));
  assertEquals(withSyms.symbols, ["S17 * VAT (reduced rate)"]);
  assertEquals(withSyms.symbols_basis, "lot_page_symbols_list");
  assertEquals(withSyms.symbols_printed![0].code, "S17");
  assertEquals(withLotPage(rec, lotHeader(lot105)), rec); // lot 105's page is not lot 101's
  assertEquals(withLotPage(rec, { object_id: "6609192", lot_id_txt: "101", price_realised_txt: null, symbols_printed: null }), rec);
  assertEquals(rec.symbols, undefined); // the index read alone never claims symbols
});

class FakeReader extends Reader {
  paths: string[] = [];
  constructor(max: number, private readonly pages: Record<string, string | number>) { super(max, 0); }
  override async text(path: string): Promise<{ status: number; body: string | null }> {
    if (this.exhausted) return { status: 0, body: null };
    this.requests += 1; this.paths.push(path);
    const p = this.pages[path];
    return typeof p === "number" ? { status: p, body: null } : { status: 200, body: p ?? null };
  }
}
Deno.test("lot page reads are bounded, skip upcoming lots, and stop on a 429", async () => {
  const sold = christiesLotRecord(fixture.lots[0], fixture.event, ctx)!;
  const up = christiesLotRecord({ ...fixture.lots[0], object_id: "7000001", is_auction_over: false }, fixture.event, ctx)!;
  const other = christiesLotRecord({ ...fixture.lots[0], object_id: "6609196" }, fixture.event, ctx)!;
  const r1 = new FakeReader(1, { "/en/lot/lot-6609192": lot101, "/en/lot/lot-6609196": lot105 });
  const a = await withLotPages(r1, [up, sold, other]);
  assertEquals(r1.paths, ["/en/lot/lot-6609192"]); // upcoming skipped, budget of one
  assertEquals(a.read, 1);
  assertEquals(a.records[1].symbols_basis, "lot_page_symbols_list");
  assertEquals(a.records[2].symbols, undefined);
  const r2 = new FakeReader(5, { "/en/lot/lot-6609192": 429, "/en/lot/lot-6609196": lot105 });
  const b = await withLotPages(r2, [sold, other]);
  assertEquals(b.status, 429);
  assertEquals(r2.paths, ["/en/lot/lot-6609192"]);
  assertEquals(new Reader(0).exhausted, true); // gate off: a zero budget reads nothing
});
