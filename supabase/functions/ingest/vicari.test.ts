import { parseVicariListing, vicariCatalogLinks, vicariListingId, vicariUrl } from "../_shared/vicariParser.ts";
import { normalizeListingUrl } from "../_shared/urlNormalization.ts";
import { ingestVicari } from "./vicari.ts";

function eq(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}
const url = vicariUrl("123");
const html = `<h2>Lot F1 &ndash; <a><span>Example, 2026 Auction</span></a></h2>
<h3>Lot F1 &ndash; 1967 FORD MUSTANG</h3><h4>This Car is Still FOR SALE!</h4>
<p>Note: the High bid was: <font>$12,000</font></p>
<ul class="detail"><li>Year: 1967</li><li>Make: FORD</li><li>Model:MUSTANG</li><li>Status:NO RESERVE<br>BILL OF SALE ONLY</li><li>Mileage:N/A</li></ul>
<ul class="detail last"><li>VIN:</li><li>Exterior:BLUE</li><li>Cylinder:289 V8</li></ul>
<div class="car_detail">Seller says original<br>Paint &amp; trim</div>
<img src="https://www.vicariauction.com/car_images/inventory/123/thumbnails/123_01.gif">
<img src="https://www.vicariauction.com/car_images/inventory/123/123_01.jpg">
<img src="https://www.vicariauction.com/car_images/inventory/123/123_01.jpg">`;

Deno.test("Vicari query identity survives path pagination and keeps different lots separate", () => {
  eq(normalizeListingUrl("http://www.vicariauction.com/auction-house/5/?ahid=123&x=1#top")?.normalized, url);
  eq(normalizeListingUrl(vicariUrl("124"))?.canonicalListingId, "vicari:124");
  for (const bad of ["https://vicariauction.com.evil/auction-house/?ahid=123", "https://evil@vicariauction.com/auction-house/?ahid=123", "https://vicariauction.com/auction-house/?ahid=123&ahid=124", "https://vicariauction.com/auction-house/?ahid=x"]) eq(vicariListingId(bad), null);
});
Deno.test("high bids and no-reserve/title disclosures never become sale prices", () => {
  const lot = parseVicariListing(html, url);
  eq([lot.year, lot.make, lot.model, lot.lot_number, lot.auction_name], [1967, "FORD", "MUSTANG", "F1", "Example, 2026 Auction"]);
  eq(lot.high_bid?.amount, 12000); eq(lot.sale_price, null); eq(lot.sale_date, null);
  eq(lot.presentation, "for_sale_after_auction"); eq(lot.high_bid?.currency, null);
  eq(lot.raw_fields.VIN, ""); eq(lot.description, "Seller says original\nPaint & trim");
  eq(lot.image_urls.length, 1);
});
Deno.test("archive is a presentation with unknown outcome; wrong lot images refuse", () => {
  const archived = html.replace("This Car is Still FOR SALE!", "This is an ARCHIVE listing").replace(/<p>Note:[\s\S]*?<\/p>/, "");
  eq(parseVicariListing(archived, url).presentation, "archive");
  eq(parseVicariListing(archived, url).high_bid, null);
  let failed = false;
  try { parseVicariListing(html, vicariUrl("124")); } catch { failed = true; }
  eq(failed, true);
});
Deno.test("catalog discovery keeps only observed lots and unfiltered auction pages", () => {
  const links = vicariCatalogLinks(`<a href="?ahid=123">one</a><a href="/auction-house/2/?ahid=123">same</a>
    <a href="?ahcode=CTC%202026&page=2">next</a><a href="?ahcode=CTC%202026&soldpa=1">unsold only</a>
    <a href="https://evil.example/auction-house/?ahid=5">external</a>`, "https://www.vicariauction.com/auction-house/");
  eq(links.lots, [url]); eq(links.catalogs, ["https://www.vicariauction.com/auction-house/?ahcode=CTC+2026&page=2"]);
});

async function world(failure?: "archive" | "admission" | "readback" | "images" | "identity", unresolved = false) {
  const body = unresolved ? html.replace("Year: 1967", "Year: N/A") : html;
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)))].map(b => b.toString(16).padStart(2, "0")).join("");
  let payload: any, matches = 0, calls = 0;
  const source = { id: "source", species: "block_house", supported_observations: ["listing"] };
  const snapshot = { id: "snapshot", platform: "vicari", listing_url: url, html_sha256: hash, fetched_at: "2026-01-01T00:00:00Z", success: true };
  const db: any = {
    from(table: string) {
      const query: any = {};
      for (const k of ["select", "eq", "in", "limit"]) query[k] = () => query;
      const result = () => {
        if (table === "observation_sources") return { data: source };
        if (table === "listing_page_snapshots") return { data: snapshot };
        if (table === "vehicles") return failure === "identity" ? { error: "unavailable" } : { data: [] };
        if (table === "vehicle_images") return { data: failure === "images" ? [] : [{ image_url: parseVicariListing(body, url).image_urls[0] }] };
        return { data: { ...payload, id: "observation", source_id: "source", vehicle_id: failure === "readback" ? "wrong" : payload.vehicle_id ?? null } };
      };
      query.maybeSingle = async () => result();
      query.then = (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject);
      return query;
    },
    functions: { invoke(_name: string, input: any) { calls++; payload = input.body; return Promise.resolve({ data: failure === "admission" ? { success: false } : { success: true, observation_id: "observation" } }); } },
  };
  const run = () => ingestVicari(url, {
    supabase: db,
    archiveFetch: async (fetchUrl, options) => {
      eq(fetchUrl, "https://www.vicariauction.com/auction-house/?ahid=123");
      eq(options.directFetchOptions?.publicOnly, true); eq(options.firecrawlOnBlock, false);
      return { html: body, markdown: null, source: "cache", cached: true, snapshotId: failure === "archive" ? null : "snapshot", url, platform: "vicari", statusCode: 200, error: null, costCents: 0 };
    },
    matchVehicle: async (data) => { matches++; eq(data.price, undefined); eq(data.vin, undefined); return { vehicleId: "vehicle", isNew: true }; },
  });
  return { run, counts: () => ({ matches, calls }), payload: () => payload };
}
Deno.test("landing verifies capture, observation and images and disables paid analysis", async () => {
  const w = await world(); const result = await w.run();
  eq(result.vicari_receipt.images, 1); eq(result.vehicle_id, "vehicle");
  eq(w.payload().defer_analysis, true); eq(w.payload().observed_at, "2026-01-01T00:00:00Z");
  eq(w.payload().raw_source_ref, "listing_page_snapshots:snapshot");
});
Deno.test("incomplete identity stays an unresolved observation without fuzzy matching", async () => {
  const w = await world(undefined, true); const result = await w.run();
  eq(result.vicari_receipt.unresolved, true); eq(w.counts().matches, 0);
  eq(w.payload().vehicle_hints, undefined);
});
for (const failure of ["archive", "identity", "admission", "readback", "images"] as const) {
  Deno.test(`landing refuses false success when ${failure} fails`, async () => {
    const w = await world(failure); let failed = false;
    try { await w.run(); } catch { failed = true; }
    eq(failed, true);
    if (failure === "archive" || failure === "identity") eq(w.counts().matches, 0);
  });
}
