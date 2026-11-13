import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { prepareDealerCapture, landDealerCapture, dealerIdentityConflict } from "./dealer.ts";
import { document, url } from "../_shared/dealerParser.test.ts";

const html = document();
Deno.test("dealer source identity replaces a URL guess while explicit contradictions stay unresolved", () => {
  const native = { year: 1995, make: "Ford", model: "F150" };
  assertEquals(dealerIdentityConflict({}, native), false);
  assertEquals(dealerIdentityConflict(native, native), false);
  assertEquals(dealerIdentityConflict({ make: "Chevrolet" }, native), true);
  assertEquals(dealerIdentityConflict({ year: 1996 }, native), true);
  assertEquals(dealerIdentityConflict({ model: "F250" }, native), true);
});
async function fixture(options: Record<string, any> = {}) {
  const observed = new Date(Date.now() - 1000).toISOString(), original = observed;
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(html)))].map(v => v.toString(16).padStart(2, "0")).join("");
  const calls: { path: string; method: string; body: any; query: string }[] = [];
  let observation: any = null, event: any = null, captureFetches = 0, witness: any = null;
  const db = createClient("https://fixture.invalid", "synthetic-service-key", {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init = {}) => {
      const u = new URL(String(input)), method = init.method ?? "GET", body = init.body ? JSON.parse(String(init.body)) : null;
      calls.push({ path: u.pathname, method, body, query: u.search });
      if (u.pathname === "/rest/v1/extraction_runs") {
        if (method === "GET") return Response.json(witness ? [options.replayWitness ? options.replayWitness(witness) : witness] : []);
        if (options.rejectWitness) return Response.json({ message: "witness unavailable" }, { status: 503 });
        witness = { ...body, id: "visit" }; return Response.json({ id: "visit" });
      }
      if (u.pathname === "/rest/v1/listing_feeds") return options.missingControl ? Response.json({ code: "PGRST116", message: "zero feed rows" }, { status: 406 }) : Response.json({ enabled: !options.held, poll_interval_minutes: options.interval ?? 180 });
      if (u.pathname === "/rest/v1/platform_config") return Response.json(null);
      if (u.pathname === "/rest/v1/observation_sources") return Response.json(options.missing ? null : { id: "source", species: "dealer", supported_observations: ["listing"] });
      if (u.pathname === "/rest/v1/listing_page_snapshots") return Response.json({ id: "snapshot", platform: "streetside_classics", listing_url: options.wrongUrl ? url + "-other" : url,
        fetched_at: options.future ? new Date(Date.now() + 86400_000).toISOString() : original, html_sha256: options.badHash ? "changed" : hash, success: true, http_status: 200, metadata: { browser_rendered_dom: true } });
      if (u.pathname === "/functions/v1/ingest-observation") {
        assertEquals(body.defer_analysis, true); assertEquals(body.source_slug, "streetside-classics");
        const duplicate = !!observation;
        observation = { id: "observation", vehicle_id: body.vehicle_id, source_id: "source", source_url: body.source_url,
          raw_source_ref: body.raw_source_ref, observed_at: body.observed_at };
        return Response.json({ success: true, observation_id: "observation", duplicate });
      }
      if (u.pathname === "/rest/v1/vehicle_observations") {
        assertEquals(u.searchParams.get("observed_at"), "eq." + observation.observed_at);
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
  const read = (client: any, sourceUrl: string) => prepareDealerCapture(client, sourceUrl, async (_url, opts) => {
    captureFetches++; assertEquals(opts?.useFirecrawl, false); assertEquals(opts?.firecrawlOnBlock, false); assertEquals(opts?.directFetchOptions?.publicOnly, true);
    return { html, markdown: null, snapshotId: "snapshot", cached: !options.direct, source: options.direct ? "direct" : "cache", url, platform: "streetside_classics", statusCode: options.direct ? 200 : null, error: null, costCents: 0 };
  }, async () => ({ html, markdown: null, snapshotId: "snapshot", fetchedAt: original }));
  return { db, read, observed, original, calls, captureFetches: () => captureFetches };
}

Deno.test("native dealer capture, canonical readback and exact replay preserve qualified source clocks", async () => {
  const f = await fixture(); const capture = await f.read(f.db, url);
  assertEquals(capture.observed_at, f.observed); assertEquals(capture.snapshot_fetched_at, f.original);
  const result = await landDealerCapture(f.db, capture, "vehicle");
  assertEquals(result.observation_id, "observation"); assertEquals(result.listing_event_id, "event");
  const replay = await landDealerCapture(f.db, capture, "vehicle"); assertEquals(replay.duplicate, true);
  const payload = f.calls.find(c => c.path === "/functions/v1/ingest-observation")!.body;
  assertEquals(payload.structured_data.asking_price, 12345);
  assertEquals("price" in payload.structured_data, false);
  const listing = f.calls.find(c => c.path === "/rest/v1/vehicle_events" && c.method === "POST")!.body;
  assertEquals([listing.source_platform, listing.source_listing_id, listing.event_type, listing.current_price], ["Streetside Classics", "42-det", "listing", 12345]);
});
for (const option of ["missing", "badHash", "wrongUrl", "future", "held", "missingControl"]) {
  Deno.test(`Dealer ${option} refuses before parent, canonical admission or paid fallback`, async () => {
    const f = await fixture({ [option]: true });
    await assertRejects(() => f.read(f.db, url));
    assertEquals(f.calls.some(c => c.method !== "GET"), false);
    if (["missing", "held", "missingControl"].includes(option)) assertEquals(f.captureFetches(), 0);
  });
}

Deno.test("actual unchanged-body visit and later retained replay share a trusted clock without re-fetching", async () => {
  const f = await fixture({ direct: true });
  const first = await f.read(f.db, url), replay = await f.read(f.db, url);
  assertEquals(first.observed_at, replay.observed_at); assertEquals(first.hash, replay.hash);
  assertEquals(first.snapshot_fetched_at, f.original); assertEquals(first.observed_at === f.original, false);
  assertEquals(f.captureFetches(), 1);
  await landDealerCapture(f.db, first, "vehicle");
  assertEquals((await landDealerCapture(f.db, replay, "vehicle")).duplicate, true);
  const admissions = f.calls.filter(c => c.path === "/functions/v1/ingest-observation").map(c => c.body);
  assertEquals(admissions[0].source_identifier, admissions[1].source_identifier);
  assertEquals(admissions[0].extraction_metadata.visit_run_id, "visit");
  assertEquals(admissions[0].extraction_metadata.original_snapshot_fetched_at, f.original);
});

for (const [name, corrupt] of Object.entries({
  missingStart: (w: any) => ({ ...w, started_at: null }),
  missingEnd: (w: any) => ({ ...w, completed_at: null }),
  futureEnd: (w: any) => ({ ...w, completed_at: new Date(Date.now() + 86400_000).toISOString() }),
  wrongSource: (w: any) => ({ ...w, metadata: { ...w.metadata, source_id: "another-source" } }),
  changedBody: (w: any) => ({ ...w, metadata: { ...w.metadata, html_sha256: "0".repeat(64) } }),
})) {
  Deno.test(`dealer visit replay refuses ${name} without refetch or admission`, async () => {
    const f = await fixture({ direct: true, replayWitness: corrupt });
    await f.read(f.db, url);
    await assertRejects(() => f.read(f.db, url));
    assertEquals(f.captureFetches(), 1);
    assertEquals(f.calls.some(c => c.path === "/functions/v1/ingest-observation"), false);
  });
}

Deno.test("dealer refuses unavailable visit receipt before canonical admission", async () => {
  const f = await fixture({ direct: true, rejectWitness: true });
  await assertRejects(() => f.read(f.db, url), Error, "dealer_visit_not_acknowledged");
  assertEquals(f.calls.some(c => c.path === "/functions/v1/ingest-observation"), false);
});

Deno.test("invalid dealer cadence cannot silently create an unbounded capture cache", async () => {
  const f = await fixture({ interval: "invalid" });
  await assertRejects(() => f.read(f.db, url), Error, "dealer_controls_unavailable");
  assertEquals(f.captureFetches(), 0);
});
