import { ECR_MODE, ecrSelector, ecrUrl, parseEcr, qualifyEcrCapture, readEcrCapture } from "./retainedEcr.ts";
const assert = (v: unknown, message = "assertion failed") => { if (!v) throw new Error(message); };
const url = "https://exclusivecarregistry.com/collection/example";
const car = "https://exclusivecarregistry.com/details/pagani/zonda/123";
const card = (href = car, label = "Pagani Zonda F") => `<div class="car_item"><a class="content" href="${href}"><img class="image" src="/images/cars/preview/123.jpg"><p class="title">${label}</p></a></div>`;
const page = (current = card(), previous = "", count = 17) => `<main><h1>Example collection</h1><div class="car_timeline"><div class="selection"><p data-info="cars_1">Current (${count})</p><p data-info="cars_4">Previous (8)</p></div><div data-box="cars_1">${current}<button>Load more</button></div><div data-box="cars_4">${previous}</div></div></main>`;
const sid = "11111111-1111-4111-8111-111111111111";
async function capture(html = page()) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(html));
  return { id: sid, platform: "ecr", listing_url: url, fetched_at: "2026-02-16T03:00:00.123456Z",
    created_at: "2026-02-16T03:00:01.123456Z", success: true, http_status: 200,
    html_sha256: Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2,"0")).join("") };
}
Deno.test("selector cannot supply testimony, identity or fake dry-run values", () => {
  assert(ecrSelector({mode:ECR_MODE,snapshot_id:sid,dry_run:true})===sid);
  for(const patch of [{vehicle_id:sid},{html:page()},{structured_data:{}},{dry_run:"false"},{snapshot_id:"bad"}])
    assert(ecrSelector({mode:ECR_MODE,snapshot_id:sid,dry_run:false,...patch})===null);
});
Deno.test("only exact source origins and entity paths are admitted", () => {
  assert(ecrUrl(url+"/")===url);
  for(const bad of [url.replace("https:","http:"),url.replace(".com/",".com.evil/"),url+"?owner=1",url+"#x",url.replace("https://","https://u:p@"),"https://exclusivecarregistry.com/make/pagani"])
    assert(ecrUrl(bad)===null,bad);
});
Deno.test("current and previous evidence remain separate; counts and unloaded tails stay qualified", () => {
  const result=parseEcr(page(card(),card(car,"Pagani Zonda F")),url);
  assert(result.ok);
  if(!result.ok)return;
  assert(result.page.cards.length===2 && result.page.current_total===17);
  assert(result.page.cards[0].relationship==="source_current" && result.page.cards[1].relationship==="source_previous");
  assert(result.page.enumeration==="captured_cards_only");
});
Deno.test("recommendations, filter options, scripts and page furniture do not become collection members", () => {
  const result=parseEcr(page()+`<aside>${card(car.replace("123","456"))}</aside><select><option>Bugatti Chiron</option></select>`,url);
  assert(result.ok && result.page.cards.length===1);
});
Deno.test("locked, conflicting, structurally empty and malformed source pages are refused", () => {
  for(const html of ["<main><h1>Example</h1>This content is locked</main>","<main><h1>Empty</h1></main>",
    page(card()+card(car,"Different title")),page(card("https://evil.test/details/pagani/zonda/123")),page(card(),"",0),
    `<link rel="canonical" href="https://exclusivecarregistry.com/collection/other">${page()}`]) assert(!parseEcr(html,url).ok);
});
Deno.test("detail page retains heading only; hidden specs and similar cars are not extracted", () => {
  const result=parseEcr(`<main><div class="page_title"><h1>Pagani Zonda F</h1></div><h2>Car Timeline</h2><p>VIN Log in</p><h2>Similar Cars</h2>${card()}</main>`,car);
  assert(result.ok && result.page.cards.length===0 && result.page.hidden_fields===true);
});
Deno.test("qualified capture keeps source clocks, hash, unknown permission and unresolved physical identity",async()=>{
  const html=page(),s=await capture(html),result=await qualifyEcrCapture(s,html);
  assert(result.ok);
  if(!result.ok)return;
  assert(result.input.observed_at===s.fetched_at && result.receipt.capture_recorded_at===s.created_at);
  assert(result.receipt.source_sha256===s.html_sha256 && result.receipt.ownership_status==="unverified");
  assert(!("vehicle_id" in result.input) && result.input.defer_analysis && result.receipt.staging_permission_status==="unknown");
  for(const patch of [{success:false},{http_status:403},{platform:"bat"},{html_sha256:"0".repeat(64)},
    {fetched_at:"2999-01-01T00:00:00Z"},{created_at:null},{created_at:"2026-02-15T00:00:00Z"},{listing_url:"https://evil.test/collection/example"}])
    assert(!(await qualifyEcrCapture({...s,...patch},html)).ok);
  assert(!(await qualifyEcrCapture(s,html+"changed")).ok);
});
Deno.test("offloaded capture is verified after storage read; unsafe storage paths never download",async()=>{
  const html=page(),s=await capture(html); let downloads=0;
  const db=(path:string,body=html)=>({from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{...s,html:null,html_storage_path:path}})})})}),
    storage:{from:()=>({download:async()=>{downloads++;return{data:new Blob([body])};}})}});
  assert((await readEcrCapture(db("ecr/2026/test.html"),sid)).ok && downloads===1);
  for(const path of ["ecr/../test.html","https://evil.test/file","/ecr/file","bat/file"])
    assert(!(await readEcrCapture(db(path),sid)).ok);
  assert(downloads===1);
  assert(!(await readEcrCapture(db("ecr/2026/test.html","altered"),sid)).ok);
});
