// Parts finder contract. FIXTURES: synthetic, shaped like the Taxonomy and Browse responses read live on 2026-10-20
// (field names and nesting as eBay returned them for a 1977 K5 Blazer); item ids, titles, prices and sellers are invented.
// No network: a fake fetch answers every eBay path and records each call.
import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { BUDGET, PartsClient, clearTaxonomyCache, findParts, parseInput, pick, pickEngine, resolveFitment, type QuotaLedger } from "./partsFinder.ts";
import { NEVER_RANK_BY, RANK_FIELDS, normalizeSummary, partMatch, rankListings, titleYears } from "./partsRank.ts";

const VALUES: Record<string, string[]> = {
  Year: ["1975", "1976", "1977", "1978"],
  Make: ["Chevrolet", "GMC"],
  Model: ["C10", "C10 Suburban", "K10", "K5 Blazer", "Nova"],
  Trim: ["Cheyenne Sport Utility 2-Door", "Custom Deluxe Sport Utility 2-Door"],
  Engine: ["4.1L 250Cu. In. l6 GAS OHV Naturally Aspirated", "5.0L 305Cu. In. V8 GAS OHV Naturally Aspirated",
    "5.7L 350Cu. In. V8 GAS OHV Naturally Aspirated", "6.6L 400Cu. In. V8 GAS OHV Naturally Aspirated"],
};
const BLAZER = { year: 1977, make: "Chevrolet", model: "Blazer", series: "K5", trim: "Cheyenne", engine_size: "6.2L V8",
  engine_type: "Chevrolet LS3 6.2L V8 (swap)", engine_displacement: "6.2L" };

const summary = (id: string, o: Record<string, unknown> = {}) => ({
  itemId: `v1|${id}|0`, legacyItemId: id, title: "Mechanical Fuel Pump for Chevy 350", price: { value: "30.00", currency: "USD" },
  condition: "New", conditionId: "1000", seller: { username: `seller_${id}`, feedbackPercentage: "99.5", feedbackScore: 5000 },
  shippingOptions: [{ shippingCostType: "FIXED", shippingCost: { value: "0.00", currency: "USD" } }], buyingOptions: ["FIXED_PRICE"],
  itemWebUrl: `https://www.ebay.com/itm/${id}?fits=Year%3A1977%7CModel%3AK5+Blazer%7CMake%3AChevrolet&_skw=fuel+pump&hash=item0`,
  itemLocation: { postalCode: "372**", country: "US" }, image: { imageUrl: `https://i.ebayimg.com/images/g/${id}/s-l225.jpg` },
  compatibilityMatch: "EXACT", compatibilityProperties: [{ name: "Year", value: "1977" }, { name: "Make", value: "Chevrolet" }, { name: "Model", value: "K5 Blazer" }],
  priorityListing: false, ...o,
});

const SEARCH = {
  total: 1288,
  itemSummaries: [
    summary("100000000001", { price: { value: "45.00", currency: "USD" } }),
    summary("100000000002", { price: { value: "20.00", currency: "USD" }, compatibilityMatch: "POSSIBLE" }),
    summary("100000000003", { price: { value: "16.99", currency: "USD" }, title: "Fuel Pump Block-Off Plate for BB Chevy" }),
    summary("100000000004", { price: { value: "25.00", currency: "USD" }, shippingOptions: [{ shippingCostType: "CALCULATED" }] }),
    summary("100000000005", { price: { value: "9.00", currency: "USD" }, condition: "For parts or not working", conditionId: "7000" }),
    summary("100000000006", { price: { value: "30.00", currency: "USD" }, shippingOptions: [{ shippingCostType: "FIXED", shippingCost: { value: "5.00", currency: "USD" } }] }),
    summary("100000000007", { price: { value: "35.00", currency: "USD" }, condition: "Used", conditionId: "3000" }),
    summary("100000000008", { price: { value: "35.00", currency: "USD" }, condition: "New", conditionId: "1000", priorityListing: true }),
    { itemId: "v1|bad|0", title: "no legacy id, no price" },
  ],
};

type Call = { path: string; params: URLSearchParams; raw: string; headers: Record<string, string> };
function fakeEbay(o: { search?: (p: URLSearchParams, n: number) => { status?: number; body: unknown }; properties?: string[]; suggest?: string } = {}) {
  const calls: Call[] = [];
  let searches = 0;
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    calls.push({ path: url.pathname, params: url.searchParams, raw: url.search, headers });
    const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.pathname.endsWith("/get_category_suggestions")) {
      return ok({ categorySuggestions: [
        { category: { categoryId: "177780", categoryName: "Fuel Pumps & Sending Units" }, categoryTreeNodeAncestors: [{ categoryId: "10063" }, { categoryId: "6028" }] },
        { category: { categoryId: o.suggest ?? "33555", categoryName: "Fuel Pumps & Sending Units" }, categoryTreeNodeAncestors: [{ categoryId: "33549" }, { categoryId: "6030" }, { categoryId: "6028" }] },
      ] });
    }
    if (url.pathname.endsWith("/get_compatibility_properties")) {
      const props = url.searchParams.get("category_id") === "6030" ? ["Year", "Make", "Model", "Trim", "Engine"] : (o.properties ?? ["Year", "Make", "Model", "Trim", "Engine"]);
      return ok({ compatibilityProperties: props.map((name) => ({ name, localizedName: name })) });
    }
    if (url.pathname.endsWith("/get_compatibility_property_values")) {
      const prop = url.searchParams.get("compatibility_property")!;
      return ok({ compatibilityPropertyValues: (VALUES[prop] ?? []).map((value) => ({ value })) });
    }
    if (url.pathname.endsWith("/item_summary/search")) {
      const r = o.search ? o.search(url.searchParams, searches++) : { body: SEARCH };
      return ok(r.body, r.status ?? 200);
    }
    return ok({ errors: [{ message: `unexpected ${url.pathname}` }] }, 404);
  }) as typeof fetch;
  return { fetchFn, calls, browse: () => calls.filter((c) => c.path.endsWith("/item_summary/search")) };
}
const client = (f: ReturnType<typeof fakeEbay>) => new PartsClient(f.fetchFn, async () => "test-token");
function ledger(used: number, cap = BUDGET.dailyCap): QuotaLedger & { taken: number } {
  const l = { taken: 0, usedToday: async () => used + l.taken, take: async () => { l.taken++; return used + l.taken > cap ? { ok: false, reason: `Not enough quota today: the parts finder's ${cap} eBay searches for today are used.` } : { ok: true }; } };
  return l;
}

Deno.test("fitment: the vehicle's values are chosen from eBay's own lists, never typed in", async () => {
  clearTaxonomyCache();
  const f = fakeEbay();
  const fit = await resolveFitment(client(f), "33555", ["Year", "Make", "Model", "Trim", "Engine"], BLAZER);
  assertEquals(fit.established, true);
  assertEquals(fit.applied, { Year: "1977", Make: "Chevrolet", Model: "K5 Blazer", Trim: "Cheyenne Sport Utility 2-Door" });
  const engine = fit.steps.find((s) => s.property === "Engine")!;
  assertEquals(engine.ebay, null);
  assertMatch(engine.basis, /engine swap/);
  assertEquals(fit.note, "eBay checks fit on Year, Make, Model, Trim; not checked: Engine");
  // Each list is read for the values chosen so far.
  const modelCall = f.calls.find((c) => c.params.get("compatibility_property") === "Model")!;
  assertEquals(modelCall.params.get("filter"), "Year:1977,Make:Chevrolet");
  assert(!modelCall.raw.includes("+"), "spaces are sent as %20, not +");

  clearTaxonomyCache();
  const stock = await resolveFitment(client(fakeEbay()), "33555", ["Year", "Make", "Model", "Trim", "Engine"], { ...BLAZER, engine_type: null, engine_size: "5.7L V8" });
  assertEquals(stock.applied.Engine, "5.7L 350Cu. In. V8 GAS OHV Naturally Aspirated");

  clearTaxonomyCache();
  const none = await resolveFitment(client(fakeEbay()), "33555", ["Year", "Make", "Model"], { ...BLAZER, model: "Jimmy", series: null });
  assertEquals(none.established, false);
  assertMatch(none.note, /no single value for "Jimmy"/);
});

Deno.test("fitment picks: exact beats containment; several matches choose nothing", () => {
  assertEquals(pick(["C10", "C10 Suburban"], ["C10"]), { value: "C10", ours: "C10", basis: "exact" });
  assertEquals(pick(["K5 Blazer", "S10 Blazer"], ["Blazer"]), { value: null, candidates: ["K5 Blazer", "S10 Blazer"] });
  assertEquals(pick(["K5 Blazer", "C10"], ["Blazer"]).value, "K5 Blazer");
  assertEquals(pickEngine(VALUES.Engine, "350ci V8").value, "5.7L 350Cu. In. V8 GAS OHV Naturally Aspirated");
  assertEquals(pickEngine(VALUES.Engine, "6.2L V8").value, null);
});

Deno.test("search: category, fitment filter, fixed price to the US; shortlist ranked by fit, part, condition, delivered price", async () => {
  clearTaxonomyCache();
  const f = fakeEbay();
  const l = ledger(0);
  const r = await findParts({ client: client(f), ledger: l, ebayRemaining: 3000, now: () => new Date("2026-10-20T19:00:00Z") },
    BLAZER, [{ query: "fuel pump" }], { zip: "89101", shortlist: 8 });
  assertEquals(r.refused, null);
  const [s] = f.browse();
  assertEquals(s.params.get("category_ids"), "33555");
  assertEquals(s.params.get("compatibility_filter"), "Year:1977;Make:Chevrolet;Model:K5 Blazer;Trim:Cheyenne Sport Utility 2-Door");
  assertEquals(s.params.get("filter"), "buyingOptions:{FIXED_PRICE},deliveryCountry:US");
  assertEquals(s.headers["X-EBAY-C-ENDUSERCTX"], "contextualLocation=country%3DUS%2Czip%3D89101");
  const p = r.parts[0];
  assertEquals([p.status, p.ebay_total, p.read, p.exact_read, p.possible_read, p.browse_calls], ["searched", 1288, 8, 7, 1, 1]);
  assertEquals(p.observed_at, "2026-10-20T19:00:00.000Z");
  // Exact fits naming the part in usable condition, by delivered price: 30+5 and 35+0 tie (new, same feedback: item
  // number), 35 used (condition), 45; then unknown shipping (25 before shipping); then the for-parts pump; then the
  // block-off plate (an accessory of the part); then the POSSIBLE fit, cheapest of all.
  assertEquals(p.shortlist.map((x) => x.item_id), ["100000000006", "100000000008", "100000000007", "100000000001",
    "100000000004", "100000000005", "100000000003", "100000000002"]);
  const by = (id: string) => p.shortlist.find((x) => x.item_id === id)!;
  assertEquals(by("100000000006").why[1], "$35.00 delivered ($30.00 + $5.00 shipping): lowest of the 4 exact fits read with a stated delivered price");
  assertMatch(by("100000000008").why.join(" | "), /Same price, condition and seller feedback as #1; listed by item number/);
  assertMatch(by("100000000007").why.join(" | "), /Same price as #2; condition decided the order/);
  assertMatch(by("100000000004").why.join(" | "), /eBay states no shipping cost/);
  assertMatch(by("100000000003").why.join(" | "), /Title names a pump blockoff, not a pump/);
  assertMatch(by("100000000005").why.join(" | "), /For parts or not working/);
  assertMatch(by("100000000002").why[0], /^Possible fit/);
  assertEquals(by("100000000001").item_url, "https://www.ebay.com/itm/100000000001?fits=Year%3A1977%7CModel%3AK5%20Blazer%7CMake%3AChevrolet");
  assertEquals(by("100000000001").observed_at, "2026-10-20T19:00:00.000Z");
});

Deno.test("ranking never reads commission, promotion or eBay's result order", () => {
  for (const f of NEVER_RANK_BY) assert(!(RANK_FIELDS as readonly string[]).includes(f), `${f} is not a rank field`);
  const ctx = { observedAt: "2026-10-20T19:00:00Z", fitChecked: true, query: "fuel pump" };
  const base = SEARCH.itemSummaries.map((s) => normalizeSummary(s, ctx)).filter((x) => !!x);
  const order = rankListings(base as any, 20).map((x) => x.item_id);
  const paid = SEARCH.itemSummaries.map((s, i) => ({ ...s, priorityListing: i % 2 === 0, adId: `ad${i}`, commission: { rate: 0.04 * i },
    commissionRate: i, campaignId: `c${i}`, itemAffiliateWebUrl: `https://www.ebay.com/itm/x?campid=${i}`, sponsored: i % 3 === 0 }));
  const shuffled = [...paid].reverse().map((s) => normalizeSummary(s, ctx)).filter((x) => !!x);
  assertEquals(rankListings(shuffled as any, 20).map((x) => x.item_id), order);
  for (const l of shuffled) for (const f of NEVER_RANK_BY) assert(!(f in (l as object)), `normalized listing carries no ${f}`);
});

Deno.test("quota: the daily cap stops calls; eBay's floor and an unreadable ledger stop them before the first", async () => {
  const parts = [{ query: "fuel pump" }, { query: "radiator" }, { query: "brake pads" }];
  clearTaxonomyCache();
  let f = fakeEbay();
  let r = await findParts({ client: client(f), ledger: ledger(BUDGET.dailyCap - 1), ebayRemaining: 3000 }, BLAZER, parts);
  assertEquals(f.browse().length, 1);
  assertEquals(r.parts.map((p) => p.status), ["searched", "not_searched", "not_searched"]);
  assertMatch(r.parts[1].reason!, /^Not enough quota today/);

  f = fakeEbay();
  r = await findParts({ client: client(f), ledger: ledger(BUDGET.dailyCap), ebayRemaining: 3000 }, BLAZER, parts);
  assertEquals(f.browse().length, 0);
  assertMatch(r.refused!, /^Not enough quota today/);

  f = fakeEbay();
  r = await findParts({ client: client(f), ledger: ledger(0), ebayRemaining: BUDGET.ebayFloor }, BLAZER, parts);
  assertEquals([f.browse().length, f.calls.length], [0, 0]);
  assertMatch(r.refused!, /held for the listing sweep's revisits/);

  f = fakeEbay();
  r = await findParts({ client: client(f), ledger: ledger(0), ebayRemaining: BUDGET.ebayFloor + 1 }, BLAZER, parts);
  assertEquals(f.browse().length, 1);
  assertEquals(r.parts.map((p) => p.status), ["searched", "not_searched", "not_searched"]);

  f = fakeEbay();
  r = await findParts({ client: client(f), ledger: { usedToday: async () => null, take: async () => ({ ok: true }) }, ebayRemaining: 3000 }, BLAZER, parts);
  assertEquals(f.browse().length, 0);
  assertMatch(r.refused!, /could not be read/);
});

Deno.test("a part number eBay's fitment does not carry is searched without fitment and shown as unknown fit", async () => {
  clearTaxonomyCache();
  const f = fakeEbay({ search: (p, n) => ({ body: n === 0 ? { total: 0, itemSummaries: [] }
    : { total: 1, itemSummaries: [summary("200000000001", { title: "Carter M6624 fuel pump", compatibilityMatch: undefined })] } }) });
  const r = await findParts({ client: client(f), ledger: ledger(0), ebayRemaining: 3000 }, BLAZER, [{ query: "fuel pump", part_number: "M6624" }]);
  const [a, b] = f.browse();
  assertEquals([a.params.get("q"), a.params.has("compatibility_filter"), b.params.has("compatibility_filter")], ["M6624", true, false]);
  const p = r.parts[0];
  assertEquals([p.browse_calls, p.search?.with_fitment, p.shortlist[0].fit, p.shortlist[0].part_match.state], [2, false, "unknown", "names_part"]);
  assertMatch(p.shortlist[0].why[0], /Fit unknown/);
});

Deno.test("a suggested category without fitment falls back to Car & Truck Parts (6030)", async () => {
  clearTaxonomyCache();
  const f = fakeEbay({ suggest: "99999", properties: [] });
  const r = await findParts({ client: client(f), ledger: ledger(0), ebayRemaining: 3000 }, BLAZER, [{ query: "fuel pump" }]);
  assertEquals(r.parts[0].category?.id, "6030");
  assertMatch(r.parts[0].category?.note ?? "", /does not support fitment/);
  assertEquals(f.browse()[0].params.get("category_ids"), "6030");
});

Deno.test("input: 1-8 parts, a vehicle id, an optional 5-digit ZIP", () => {
  const id = "e08bf694-0000-4000-8000-000000000001";
  assertEquals(parseInput({ vehicle_id: id, parts: ["fuel pump", { query: "radiator", part_number: "DPI161" }] }),
    { vehicleId: id, parts: [{ query: "fuel pump", part_number: null, work_order_part_id: null }, { query: "radiator", part_number: "DPI161", work_order_part_id: null }], zip: null });
  assert("error" in parseInput({ vehicle_id: "x", parts: ["a"] }));
  assert("error" in parseInput({ vehicle_id: id, parts: [] }));
  assert("error" in parseInput({ vehicle_id: id, parts: Array(9).fill("a") }));
  assert("error" in parseInput({ vehicle_id: id, parts: ["a"], delivery_postal_code: "8910" }));
});

Deno.test("title reading: the part named, an accessory of it, the years a title names", () => {
  assertEquals(partMatch("Radiator Cap 16 PSI", "radiator").state, "accessory");
  assertEquals(partMatch("2 Row Aluminum Radiator for 73-87 Chevy", "radiator").state, "names_part");
  assertEquals(partMatch("Front Ceramic Brake Pads Set", "front brake pads").state, "names_part");
  assertEquals(partMatch("Fuel Pump with Gasket", "fuel pump").state, "names_part");
  assertEquals(partMatch("Fuel Sending Unit", "fuel pump").state, "not_named");
  assertEquals(partMatch("Delphi MF0055 mechanical", "fuel pump", "MF-0055").state, "names_part");
  assertEquals(titleYears("SMD52 FRONT Brake Pads Fits 87-91 Chevrolet Blazer"), [[1987, 1991]]);
  assertEquals(titleYears("Radiator For 1978-1988 Oldsmobile"), [[1978, 1988]]);
  assertEquals(titleYears("Electric Fuel Pump 5-9 PSI 12V"), []);
  assertEquals(titleYears("Fuel pump 40-50 psi"), []);
  const l = normalizeSummary(summary("300000000001", { title: "SMD52 FRONT Brake Pads Fits 87-91 Chevrolet Blazer" }),
    { observedAt: "2026-10-20T19:00:00Z", fitChecked: true, query: "brake pads", vehicleYear: 1977 })!;
  assertEquals(l.title_years_other, "1987-1991");
  assertMatch(rankListings([l])[0].why[0], /the title names 1987-1991, so check the listing's fitment table/);
});
