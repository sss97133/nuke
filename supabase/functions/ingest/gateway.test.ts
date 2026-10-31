import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { readGatewayBrowserCapture } from "../_shared/gatewayCapture.ts";
import { prepareGatewayCapture, landGatewayCapture } from "./gateway.ts";
import { document, vehicle } from "../_shared/gatewayParser.test.ts";

const url = vehicle().url, html = document(vehicle());
async function fixture(options: Record<string, any> = {}) {
  const observed = new Date(Date.now() - 1000).toISOString(), original = new Date(Date.now() - 10 * 86400_000).toISOString();
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(html)))].map(v => v.toString(16).padStart(2, "0")).join("");
  const run = { id: "run", source: "gateway-browser", status: options.running ? "running" : "completed",
    started_at: new Date(Date.now() - 2000).toISOString(), completed_at: observed,
    metadata: { profile: "public_gateway_browser_v1", feed_id: "c68aa94a-68aa-475b-847d-4b0672e7beee", pages: [{
      url, inventory: false, observed_at: options.future ? new Date(Date.now() + 86400_000).toISOString() : observed,
      http_status: 200, capture: { snapshot_id: "snapshot", html_sha256: hash },
    }] } };
  const calls: { path: string; method: string; body: any; query: string }[] = [];
  let observation: any = null, event: any = null;
  const db = createClient("https://fixture.invalid", "synthetic-service-key", {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init = {}) => {
      const u = new URL(String(input)), method = init.method ?? "GET", body = init.body ? JSON.parse(String(init.body)) : null;
      calls.push({ path: u.pathname, method, body, query: u.search });
      if (u.pathname === "/rest/v1/extraction_runs") return Response.json(options.missing ? [] : [run]);
      if (u.pathname === "/rest/v1/observation_sources") return Response.json({ id: "source", species: "dealer", supported_observations: ["listing"] });
      if (u.pathname === "/rest/v1/listing_page_snapshots") return Response.json({ id: "snapshot", platform: "gateway_classics", listing_url: options.wrongUrl ? url + "-other" : url,
        fetched_at: original, html_sha256: options.badHash ? "changed" : hash, success: true, http_status: 200, metadata: { browser_rendered_dom: true } });
      if (u.pathname === "/functions/v1/ingest-observation") {
        assertEquals(body.defer_analysis, true); assertEquals(body.source_slug, "gateway-classic-cars");
        const duplicate = !!observation;
        observation = { id: "observation", vehicle_id: body.vehicle_id, source_id: "source", source_url: body.source_url,
          raw_source_ref: body.raw_source_ref, observed_at: observed };
        return Response.json({ success: true, observation_id: "observation", duplicate });
      }
      if (u.pathname === "/rest/v1/vehicle_observations") {
        assertEquals(u.searchParams.get("observed_at"), "eq." + observed);
        return Response.json(observation);
      }
      if (u.pathname === "/rest/v1/vehicle_events") {
        if (method === "GET") return Response.json(event ? [event] : []);
        if (method === "POST") { event = { ...body, id: "event" }; return Response.json([{ id: "event" }]); }
        event = { ...event, ...body }; return Response.json([{ id: "event" }]);
      }
      if (u.pathname === "/rest/v1/vehicles" && method === "PATCH") return Response.json([{ id: "vehicle" }]);
      throw Error("Unexpected source, model, raw testimony or private request: " + u.pathname);
    } },
  });
  const readBody = async () => ({ html, markdown: null, snapshotId: "snapshot", fetchedAt: original });
  const read = (client: any, sourceUrl: string) => readGatewayBrowserCapture(client, sourceUrl, false, 86400, readBody);
  return { db, read, readBody, observed, original, calls };
}

Deno.test("fresh browser witness can reference an unchanged older body without changing either clock", async () => {
  const f = await fixture(); const capture = await prepareGatewayCapture(f.db, url, f.read);
  assertEquals(capture.fetched_at, f.observed); assertEquals(capture.snapshot_fetched_at, f.original);
  const result = await landGatewayCapture(f.db, capture, "vehicle");
  assertEquals(result.observation_id, "observation"); assertEquals(result.listing_event_id, "event");
  const replay = await landGatewayCapture(f.db, capture, "vehicle"); assertEquals(replay.duplicate, true);
  const payload = f.calls.find(c => c.path === "/functions/v1/ingest-observation")!.body;
  assertEquals(payload.structured_data.asking_price, 12345);
  assertEquals("price" in payload.structured_data, false);
  const listing = f.calls.find(c => c.path === "/rest/v1/vehicle_events" && c.method === "POST")!.body;
  assertEquals([listing.source_platform, listing.source_listing_id, listing.event_type, listing.current_price], ["www.gatewayclassiccars.com", "det:42", "listing", 12345]);
});
for (const option of ["missing", "badHash", "wrongUrl", "future"]) {
  Deno.test(`Gateway ${option} refuses before parent, canonical admission or paid fallback`, async () => {
    const f = await fixture({ [option]: true });
    await assertRejects(() => prepareGatewayCapture(f.db, url, f.read));
    assertEquals(f.calls.some(c => c.method !== "GET"), false);
  });
}
