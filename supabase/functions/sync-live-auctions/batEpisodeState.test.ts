import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { batBoardReceipt, batEpisodePatch, updateVehicleEvents } from "./batEpisodeState.ts";
const url = "https://bringatrailer.com/listing/1971-chevrolet-k5-blazer-85";
const lot = { url, current_bid: 75000, bid_count: null, auction_end_date: "2026-11-12T20:29:00.000Z",
  raw_data: { source_snapshot_id: "capture", source_read_at: "2026-11-08T18:50:37.000Z" } };
const event = { id: "k5", source_url: url + "/", source_platform: "bat", event_status: "active", event_type: "auction", sold_at: null,
  current_price: null, bid_count: 0, ended_at: "2026-11-12T00:00:00Z", updated_at: "2026-11-05T20:13:29Z",
  metadata: { source: "extract-auction-comments" } };
Deno.test("actual K5 slash variant receives inventory bid and precise end without sale/identity writes", () => {
  const patch = batEpisodePatch(event, lot)!;
  assertEquals(patch.current_price, 75000);
  assertEquals(patch.bid_count, null);
  assertEquals(patch.ended_at, lot.auction_end_date);
  assertEquals(Object.keys(patch).sort(), ["bid_count", "current_price", "ended_at", "metadata"]);
  assertEquals((patch.metadata as any).source, "extract-auction-comments");
  assertEquals((patch.metadata as any).bat_inventory_snapshot.individual_bid, false);
});
Deno.test("historical BJ/terminal/different lot and native stream state stay untouched", () => {
  for (const change of [{ event_type: "listing" }, { source_platform: "barrettjackson" }, { event_status: "sold" },
    { sold_at: "2026-01-15" }, { source_url: url + "-another" }, { metadata: { live_stream: { last_frame_received_at: "2026-11-08" } } }])
    assertEquals(batEpisodePatch({ ...event, ...change }, lot), null);
});
Deno.test("older captures, admitted higher bids and extensions never regress", () => {
  assertEquals(batEpisodePatch({ ...event, metadata: { source_observed_at: "2026-11-09" } }, lot), null);
  assertEquals(batEpisodePatch({ ...event, current_price: 80000, ended_at: "2026-11-12T21:00:00Z" }, lot), null);
  const patch = batEpisodePatch({ ...event, metadata: { clock_locked_by_supersession: "correction" } }, lot)!;
  assertEquals(patch.ended_at, undefined);
  assertEquals(patch.current_price, 75000);
});
Deno.test("unknown bid does not invent zero; end may still improve; unchanged rows do not consume budget", () => {
  const patch = batEpisodePatch(event, { ...lot, current_bid: null })!;
  assertEquals(patch.current_price, undefined);
  assertEquals(patch.ended_at, lot.auction_end_date);
  assertEquals(batEpisodePatch({ ...event, current_price: 75000, ended_at: lot.auction_end_date }, lot), null);
});
function dbFixture(rows: any[], fail = false) {
  const writes: any[] = [], ranges: number[] = [];
  return { writes, ranges, db: { from(table: string) {
    let patch: any = null; const filters: any[] = [];
    const q: any = { select() { return patch ? Promise.resolve({ data: fail ? [] : [{ id: "saved" }], error: null }) : q; },
      update(value: any) { patch = value; writes.push({ patch, filters }); return q; },
      eq(key: string, value: any) { filters.push([key,value]); return q; },
      is(key: string, value: any) { filters.push([key,value]); return q; }, order() { return q; },
      range(start: number, end: number) { ranges.push(start); return Promise.resolve({ data: rows.slice(start,end+1), error: null }); } };
    assertEquals(table, "vehicle_events"); return q;
  } } };
}
Deno.test("episode beyond default1000 is reached; writes compare active/source/clock metadata", async () => {
  const rows = Array.from({ length: 1001 }, (_,i) => ({ ...event, id: String(i), source_url: url + "-other" }));
  rows.push(event);
  const f = dbFixture(rows), result = await updateVehicleEvents(f.db, [lot]);
  assertEquals(f.ranges, [0,500,1000]);
  assertEquals(result.updated, 1);
  assertEquals(f.writes[0].filters.some(([k,v]: any[])=>k==="updated_at" && v===event.updated_at), true);
  assertEquals(f.writes[0].filters.some(([k,v]: any[])=>k==="event_status" && v==="active"), true);
});
Deno.test("bounded changed backlog and concurrent rejection remain visible", async () => {
  const f = dbFixture([event,{ ...event,id:"second" }]);
  const result = await updateVehicleEvents(f.db, [lot], 1);
  assertEquals([result.updated,result.deferred], [1,1]);
  const raced = await updateVehicleEvents(dbFixture([event],true).db, [lot]);
  assertEquals(raced.updated, 0);
  assertEquals(raced.errors, ["episode changed concurrently; retry"]);
});
Deno.test("read ceiling and elapsed budget explicitly report incomplete work", async () => {
  const many = Array.from({ length: 3000 }, (_,i)=>({ ...event,id:String(i),source_url:url+"-other" }));
  assertEquals((await updateVehicleEvents(dbFixture(many).db,[lot])).read_limit_reached, true);
  assertEquals((await updateVehicleEvents(dbFixture([event]).db,[lot],64,0)).read_limit_reached, true);
});
Deno.test("duplicate archive recovery pins exact hash and retained clock; missing receipt refuses", async () => {
  const seen: any[] = [];
  const receipt = { id: "retained", fetched_at: "2026-11-08T18:50:37Z", html_sha256: "hash" };
  function db(data: any) { const q: any={ select(){return q;},eq(k:any,v:any){seen.push([k,v]);return q;},
    order(){return q;},limit(){return q;},maybeSingle(){return Promise.resolve({data,error:null});} };return{from(){return q;}}; }
  assertEquals(await batBoardReceipt(db(receipt),"html",null),receipt);
  assertEquals(seen.some(([k,v])=>k==="html_sha256" && /^[a-f0-9]{64}$/.test(v)),true);
  await assertRejects(()=>batBoardReceipt(db(null),"html",null),Error,"deferred");
});
