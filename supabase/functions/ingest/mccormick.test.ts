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

async function archiveWorld(mode: "complete" | "missing" | "disagreement" | "ambiguous" = "complete") {
  const archiveUrl="https://www.classic-carauction.com/auction-results?auctionnbr=80&auctionid=123";
  const modern=(s:string)=>s.replaceAll("1967","2002");
  const archiveBody=modern(fixture(true)).replace('second</a>', 'second</a><a href="./upload/Auction/archive-only.jpg">original</a>');
  const detailBody=modern(fixture(false)).replace('>TBA</TD>', '>1FAFP42X62F212138</TD>')
    .replace('second</a>', 'second</a><a href="./upload/Auction/extra.jpg">third</a>')
    .replace('Lot Nbr. 42', mode === "disagreement" ? 'Lot Nbr. 43' : 'Lot Nbr. 42');
  const docs:Record<string,any>={};
  for(const [name,body,sourceUrl] of [["archive",archiveBody,archiveUrl],["detail",detailBody,url]]) {
    const hash=[...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(body)))].map(b=>b.toString(16).padStart(2,"0")).join("");
    docs[name]={id:name,body,platform:"mccormicks",listing_url:sourceUrl,html_sha256:hash,fetched_at:"2026-01-01T00:00:00Z",success:true};
  }
  const payloads:any[]=[];const held=new Map<string,any>();let candidate:any;
  const db:any={
    from(table:string){
      const filters:Record<string,any>={};let inserted:any[]|null=null;
      const query:any={};
      for(const k of ["select","order","range","limit","in"])query[k]=()=>query;
      query.eq=(k:string,v:any)=>{filters[k]=v;return query;};
      query.insert=(rows:any[])=>{inserted=rows;return query;};
      const result=()=>{
        if(table==="observation_sources")return {data:{id:"source",species:"block_house",supported_observations:["listing"]}};
        if(table==="listing_page_snapshots")return {data:docs[filters.id]};
        if(table==="vehicles")return {data:mode === "ambiguous" && filters.vin ? [{id:"a"},{id:"b"}] : []};
        if(table==="vehicle_images"){
          for(const row of inserted??[])held.set(row.image_url,row);
          return {data:[...held.values()]};
        }
        const p=payloads[Number(String(filters.id).split("-")[1])];
        return {data:{...p,id:filters.id,source_id:"source",vehicle_id:p.vehicle_id??null}};
      };
      query.maybeSingle=async()=>result();
      query.then=(resolve:any,reject:any)=>Promise.resolve(result()).then(resolve,reject);
      return query;
    },
    functions:{invoke(_name:string,{body}:any){const n=payloads.push(body)-1;return Promise.resolve({data:{success:true,observation_id:`obs-${n}`}});}},
  };
  const result=await ingestMcCormick(archiveUrl,{
    supabase:db,
    archiveFetch:async(fetchUrl)=>{
      const doc=fetchUrl===archiveUrl?docs.archive:docs.detail;
      return {html:doc.body,markdown:null,source:"cache",cached:true,snapshotId:mode==="missing"&&doc.id==="detail"?null:doc.id,url:fetchUrl,platform:"mccormicks",statusCode:200,error:null,costCents:0};
    },
    matchVehicle:async(data)=>{
      candidate=data;
      for(const image_url of data.imageUrls)held.set(image_url,{image_url,source_url:data.url});
      return {vehicleId:"vehicle",isNew:true};
    },
  });
  return {result,payloads,candidate,images:[...held.values()],archiveUrl};
}
Deno.test("historical VIN and gallery come from a separately retained matching public detail witness",async()=>{
  const w=await archiveWorld();
  eq(w.candidate.vin,"1FAFP42X62F212138");eq(w.candidate.price,undefined);
  eq(w.payloads.length,2);eq(w.payloads.map(p=>p.raw_source_ref),["listing_page_snapshots:archive","listing_page_snapshots:detail"]);
  eq(w.payloads[0].structured_data.result_claim.status,"sold");
  eq(w.payloads[1].structured_data.result_claim,null);
  eq(w.payloads.every(p=>p.structured_data.observation_time_basis==="source_capture" && p.structured_data.source_captured_at===p.observed_at),true);
  eq(w.payloads[1].structured_data.auction_number,null);eq(w.payloads[1].structured_data.presentation,"unknown");
  eq(w.result.mccormick_receipt.source_capture_gaps,[]);eq(w.result.mccormick_receipt.images,4);
  eq(w.images.find(i=>i.image_url.endsWith("archive-only.jpg"))?.source_url,w.archiveUrl);
  eq(w.images.find(i=>i.image_url.endsWith("extra.jpg"))?.source_url,url);
});
for(const mode of ["missing","disagreement"] as const) {
  Deno.test(`alternate detail ${mode} preserves the result and explicit missing coverage without importing its VIN`,async()=>{
    const w=await archiveWorld(mode);
    eq(w.candidate.vin,null);eq(w.payloads.length,1);eq(w.result.mccormick_receipt.source_capture_gaps.length,1);
    eq(w.payloads[0].source_url,w.archiveUrl);eq(w.payloads[0].structured_data.result_claim.status,"sold");
  });
}

Deno.test("ambiguous historical VIN stays two sourced blips without minting or attaching a vehicle",async()=>{
  const w=await archiveWorld("ambiguous");eq(w.candidate,undefined);eq(w.payloads.length,2);
  eq(w.result.mccormick_receipt.unresolved,true);eq(w.result.mccormick_receipt.images,0);
  eq(w.payloads.every(p=>p.vehicle_id===undefined),true);
  eq(w.payloads[1].structured_data.vin,"1FAFP42X62F212138");
});
