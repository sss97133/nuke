import { parseMcCormickLot, mccormickLinks, mccormickTarget } from "../_shared/mccormickParser.ts";
import { normalizeListingUrl } from "../_shared/urlNormalization.ts";
import { ingestMcCormick } from "./mccormick.ts";
const url = "https://www.classic-carauction.com/auction-cars?auctionid=123";
function eq(a: unknown, b: unknown) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
function fixture(archive=false, sold=true) {
  const row = (k: string, v: string) => `<TR><TD><div>${k}:</TD><TD><div>${v}</TD></TR>`;
  return `<script>const hidden='Sold for: $ 999999';</script><div class="bcopy12"><b>unrelated masthead</b></div>
  <b>Auction ${archive ? 80 : 81}${archive ? " Results" : ""}</b> (February 20-22, 2026)
  <IMG ID="Picture1" SRC="./upload/Auction/lot123.jpg">
  <div class="bcopy12"><b>1967 FORD MUSTANG</b><br>Lot Nbr. 42</div>
  ${archive ? `<div>${sold ? "Sold for" : "High Bid"}: $ 12,345</div>` : ""}
  <a rel="example_group" href="./upload/Auction/lot123.jpg"><img src="./upload/Auction/lot123.jpg"></a>
  <a rel="example_group" href="./upload/Auction/lot123-2.jpg">second</a>
  <TR><TD><div>Owner Comments:</TD><TD><div>Seller says rebuilt<br>paint &amp; trim</TD></TR>
  <b>Vehicle Info:</b>${row("Model Year","1967")}${row("Make","FORD")}${row("Body Style","COUPE")}
  ${row("Body Color","BLUE")}${row("Vin No.","TBA")}${row("Mileage","TMU")}${row("Engine Size","8")}${row("Transmission","Automatic")}
  <b>Component Ratings:</b>${row("Transmission","good")}${row("Paint","fair")}
  <!end car details><img src="./upload/sponsor.jpg">`;
}
const html=fixture();
Deno.test("McCormick identity keeps query IDs and coalesces current/featured/archive locators", () => {
  eq(normalizeListingUrl(url)?.canonicalListingId,"mccormicks:123");
  for (const u of [url, url.replace("auction-cars","featured-cars"),"https://classic-carauction.com/auction-results?auctionnbr=80&auctionid=123"]) eq(normalizeListingUrl(u)?.normalized,url);
  for (const bad of [url.replace(".com/",".com.evil/"),url+"&auctionid=124",url.replace("https://","https://u@"),url.replace("123","x"),url.replace("auction-cars","auction-results")]) eq(mccormickTarget(bad),null);
});
Deno.test("McCormick scopes the heading, photos, specs and ratings; unknowns stay unknown", () => {
  const p=parseMcCormickLot(html,url);
  eq([p.year,p.make,p.model,p.lot_number],[1967,"FORD","MUSTANG","42"]);
  eq(p.raw_fields.Transmission,"Automatic"); eq(p.condition_ratings.Transmission,"good");
  eq(p.image_urls,["https://www.classic-carauction.com/upload/Auction/lot123.jpg","https://www.classic-carauction.com/upload/Auction/lot123-2.jpg"]);
  eq(p.vin,null); eq(p.result_claim,null); eq(p.description,"Seller says rebuilt\npaint & trim");
});
Deno.test("McCormick sold and no-sale figures remain literal claims with unknown currency/fee basis", () => {
  const u="https://www.classic-carauction.com/auction-results?auctionnbr=80&auctionid=123";
  for(const sold of [true,false]) {
    const p=parseMcCormickLot(fixture(true,sold),u);
    eq(p.result_claim?.status,sold?"sold":"no_sale"); eq(p.result_claim?.amount,12345);
    eq(p.result_claim?.currency,null); eq(p.result_claim?.fee_basis,"unknown");
  }
  let failed=false;try{parseMcCormickLot(fixture(true),u.replace("80","79"));}catch{failed=true;}eq(failed,true);
});
Deno.test("McCormick follows advertised catalogs only and rejects external or duplicate IDs", () => {
  const p=mccormickLinks(`<a href="${url}">lot</a><a href="/featured-cars?auctionid=123">same</a>
    <a href="/Auction-47">old</a><a href="/auction-results?auctionnbr=47">results</a>
    <a href="https://evil.example/auction-cars?auctionid=3">bad</a>`,url);
  eq(p.lots,[url]);eq(p.catalogs,["https://www.classic-carauction.com/Auction-47","https://www.classic-carauction.com/auction-results?auctionnbr=47"]);
});

async function world(failure?: "archive" | "admission" | "readback" | "images" | "identity", unresolved = false) {
  const body = unresolved ? html.replace("1967 FORD MUSTANG", "1967 FORD") : html;
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)))].map(b => b.toString(16).padStart(2, "0")).join("");
  let payload: any, matches = 0, calls = 0;
  const source = { id: "source", species: "block_house", supported_observations: ["listing"] };
  const snapshot = { id: "snapshot", platform: "mccormicks", listing_url: url, html_sha256: hash, fetched_at: "2026-01-01T00:00:00Z", success: true };
  const db: any = {
    from(table: string) {
      const query: any = {};
      for (const k of ["select", "eq", "in", "limit"]) query[k] = () => query;
      const result = () => {
        if (table === "observation_sources") return { data: source };
        if (table === "listing_page_snapshots") return { data: snapshot };
        if (table === "vehicles") return failure === "identity" ? { error: "unavailable" } : { data: [] };
        if (table === "vehicle_images") return { data: failure === "images" ? [] : parseMcCormickLot(body, url).image_urls.map(image_url => ({image_url})) };
        return { data: { ...payload, id: "observation", source_id: "source", vehicle_id: failure === "readback" ? "wrong" : payload.vehicle_id ?? null } };
      };
      query.maybeSingle = async () => result();
      query.then = (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject);
      return query;
    },
    functions: { invoke(_name: string, input: any) { calls++; payload = input.body; return Promise.resolve({ data: failure === "admission" ? { success: false } : { success: true, observation_id: "observation" } }); } },
  };
  const run = () => ingestMcCormick(url, {
    supabase: db,
    archiveFetch: async (fetchUrl, options) => {
      eq(fetchUrl, url);
      eq(options.directFetchOptions?.publicOnly, true); eq(options.firecrawlOnBlock, false);
      return { html: body, markdown: null, source: "cache", cached: true, snapshotId: failure === "archive" ? null : "snapshot", url, platform: "mccormicks", statusCode: 200, error: null, costCents: 0 };
    },
    matchVehicle: async (data) => { matches++; eq(data.price, undefined); eq(data.vin, null); return { vehicleId: "vehicle", isNew: true }; },
  });
  return { run, counts: () => ({ matches, calls }), payload: () => payload };
}
Deno.test("landing verifies capture, observation and images and disables paid analysis", async () => {
  const w = await world(); const result = await w.run();
  eq(result.mccormick_receipt.images, 2); eq(result.vehicle_id, "vehicle");
  eq(w.payload().defer_analysis, true); eq(w.payload().observed_at, "2026-01-01T00:00:00Z");
  eq(w.payload().raw_source_ref, "listing_page_snapshots:snapshot");
});
for (const failure of ["archive", "identity", "admission", "readback", "images"] as const) {
  Deno.test(`landing refuses false success when ${failure} fails`, async () => {
    const w = await world(failure); let failed = false;
    try { await w.run(); } catch { failed = true; }
    eq(failed, true);
    if (failure === "archive" || failure === "identity") eq(w.counts().matches, 0);
  });
}
