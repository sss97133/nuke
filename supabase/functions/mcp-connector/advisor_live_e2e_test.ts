// End-to-end checks against real Nuke public data (read-only).
// Uses the captured Karmann Ghia fixture (live-probed) plus optional live HTTP probes.
// Run: deno test --allow-read --allow-net supabase/functions/mcp-connector/advisor_live_e2e_test.ts
import {
  assertEnvelopeShape,
  citationFromObservation,
  extractEventTime,
  makeEnvelope,
  recordedClaim,
  resolveClaimConfidence,
} from "./advisor/evidence.ts";
import { ADVISOR_TOOLS, handleAdvisorJsonRpc, initAdvisorHandlers } from "./advisor/mod.ts";
import { createAdvisorHandlers } from "./advisor/handlers.ts";

const FIXTURE_PATH = new URL("./fixtures/karmann-ghia-14123fbf.json", import.meta.url);
const VID = "14123fbf-7eb6-4dd6-b0ca-bbc83db06a28";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

interface Fixture {
  vehicle_id: string;
  api_v1: { data: Record<string, unknown> };
  get_vehicle: Record<string, unknown>;
  query_observations: {
    observations: Array<Record<string, unknown>>;
  };
  query_market_history: {
    events: Array<Record<string, unknown>>;
    count: number;
  };
  get_comps: { data: Array<Record<string, unknown>> };
  search_vehicles: { results: Array<Record<string, unknown>>; count: number };
}

Deno.test("live fixture: Karmann Ghia BaT sale separates event_time from ingested_at", async () => {
  const fixture: Fixture = JSON.parse(await Deno.readTextFile(FIXTURE_PATH));
  assert(fixture.vehicle_id === VID, "vehicle id");
  assert(fixture.api_v1.data.make === "Volkswagen", "make");
  assert(String(fixture.api_v1.data.model).includes("Karmann Ghia"), "model");

  const listingObs = fixture.query_observations.observations.find((o) => o.kind === "listing");
  assert(Boolean(listingObs), "listing observation present");
  const cit = citationFromObservation({
    id: listingObs!.id as string,
    source_name: listingObs!.source_name as string,
    source_url: listingObs!.source_url as string,
    ingested_at: listingObs!.ingested_at as string,
    observed_at: listingObs!.observed_at as string,
    is_superseded: Boolean(listingObs!.is_superseded),
    structured_data: listingObs!.structured_data as Record<string, unknown>,
  });
  assert(cit.event_time?.startsWith("2024-07-07") === true, `event_time=${cit.event_time}`);
  assert(cit.ingested_at?.startsWith("2026-") === true, `ingested_at=${cit.ingested_at}`);
  assert(cit.event_time !== cit.ingested_at, "sale clock ≠ ingest clock");

  // Sale observation where confidence_score (0.9) ≠ source_trust (0.85)
  const saleObs = fixture.query_observations.observations.find(
    (o) => o.kind === "sale_result" && o.confidence_score === 0.9,
  );
  assert(Boolean(saleObs), "sale_result with distinct confidence");
  const conf = resolveClaimConfidence(
    saleObs!.confidence_score as number,
    saleObs!.source_trust as number,
  );
  assert(conf.confidence_basis === "claim_score", `basis=${conf.confidence_basis}`);
  assert(conf.confidence === 0.9, "claim confidence preserved");

  // Market event sold_at
  const ev = fixture.query_market_history.events[0];
  assert(ev.final_price === 21000, "BaT sale price");
  const eventTime = extractEventTime(null, [ev.sold_at as string, ev.ended_at as string]);
  assert(eventTime?.startsWith("2024-07-07") === true, `event sold_at=${eventTime}`);

  // Build a history-shaped envelope from live fixture (what get_history returns)
  const claims = fixture.query_market_history.events.map((e) =>
    recordedClaim(`event.${e.id}.final_price`, e.final_price, {
      confidence: 0.9,
      confidence_basis: "claim_score",
      citations: [{
        source_name: e.source_platform === "bat" ? "Bring a Trailer" : String(e.source_platform),
        source_url: e.source_url as string,
        observation_id: null,
        event_time: extractEventTime(null, [e.sold_at as string, e.ended_at as string]),
        ingested_at: null,
        is_superseded: false,
      }],
    })
  );
  const envelope = makeEnvelope("get_history", "vehicle", VID, claims, {
    event_count: fixture.query_market_history.count,
    source: "fixture:karmann-ghia-14123fbf",
  });
  assertEnvelopeShape(envelope);
  assert(envelope.claims.length >= 1, "claims");
  assert(envelope.claims[0]!.citations[0]!.event_time?.startsWith("2024-07-07") === true, "cited sale date");
});

Deno.test("live fixture: comps carry sold_date as event_time", async () => {
  const fixture: Fixture = JSON.parse(await Deno.readTextFile(FIXTURE_PATH));
  const comps = fixture.get_comps.data || [];
  assert(comps.length >= 1, "comps present");
  const c0 = comps[0]!;
  assert(typeof c0.sale_price === "number", "sale_price");
  assert(typeof c0.sold_date === "string", "sold_date");
  assert(typeof c0.listing_url === "string", "listing_url");

  const envelope = makeEnvelope("get_comps", "vehicle", VID, [
    recordedClaim("comp.0.sale_price", c0.sale_price, {
      confidence: 0.85,
      confidence_basis: "claim_score",
      citations: [{
        source_name: String(c0.platform || c0.platform_raw || null),
        source_url: String(c0.listing_url),
        observation_id: null,
        event_time: String(c0.sold_date),
        ingested_at: null,
        is_superseded: false,
      }],
    }),
  ], { count: comps.length });
  assertEnvelopeShape(envelope);
});

Deno.test("handler get_asset against fixture-backed mock returns BaT sale and history envelope", async () => {
  const fixture: Fixture = JSON.parse(await Deno.readTextFile(FIXTURE_PATH));
  const obs = fixture.query_observations.observations.map((o) => ({
    id: o.id,
    kind: o.kind,
    content_text: o.content_text,
    structured_data: o.structured_data,
    confidence_score: o.confidence_score,
    observed_at: o.observed_at,
    source_url: o.source_url,
    source_id: o.source_id,
    is_superseded: o.is_superseded,
    ingested_at: o.ingested_at,
  }));
  const events = fixture.query_market_history.events;
  const sourceId = obs[0]?.source_id;
  const price = fixture.get_vehicle.price as {
    kind: string; amount: number; as_of: string; live: boolean; outcome: string;
    sold: { amount: number; on: string; basis: string; from: string }; source_url: string;
  };

  const handlers = createAdvisorHandlers({
    sb: () => ({
      from(table: string) {
        const rows =
          table === "vehicle_events"
            ? events
            : table === "vehicle_observations"
            ? obs
            : table === "observation_sources"
            ? [{
              id: sourceId,
              slug: "bat",
              display_name: "Bring a Trailer",
              base_trust_score: 0.85,
            }]
            : [];
        const api: Record<string, unknown> = {
          select() {
            return api;
          },
          eq() {
            return api;
          },
          in() {
            return api;
          },
          order() {
            return api;
          },
          limit() {
            return api;
          },
          single() {
            assert(table === "vehicles", "only vehicle lookup is singular");
            return Promise.resolve({ data: fixture.get_vehicle, error: null });
          },
          then(resolveCb: (v: unknown) => unknown, rejectCb?: (e: unknown) => unknown) {
            return Promise.resolve({ data: rows, error: null }).then(resolveCb, rejectCb);
          },
        };
        return api;
      },
      rpc(name: string) {
        assert(name === "vehicle_price_facts", "canonical price reader");
        return Promise.resolve({ data: [{ price_kind: price.kind, price_amount: price.amount,
          price_as_of: price.as_of, price_live: price.live, outcome: price.outcome,
          sold_amount: price.sold.amount, sold_on: price.sold.on, sold_basis: price.sold.basis,
          sold_amount_from: price.sold.from, source_url: price.source_url }], error: null });
      },
    }) as never,
    callEdgeApi: async () => ({ data: [] }),
  });

  const result = await handlers.get_asset!({ asset_id: VID });
  assert(!result.isError, "no error");
  assertEnvelopeShape(result.structuredContent);
  const saleClaim = result.structuredContent.claims.find((c) =>
    c.field === "sale_price" && c.value === 21000 && c.citations[0]?.event_time?.startsWith("2024-07-07")
  );
  assert(Boolean(saleClaim), "must include cited $21000 BaT sale with 2024-07-07 event_time");
  assert(result.structuredContent.tool === "get_asset", "current advisor surface");
  assert(saleClaim!.citations[0].ingested_at === null, "price reader does not invent an ingestion clock");
  const makeObs = obs.find((o) => (o.structured_data as Record<string, unknown>)?.make);
  const makeCit = result.structuredContent.claims.find((c) => c.field === "make")?.citations
    .find((c) => c.observation_id === makeObs?.id);
  assert(Boolean(makeCit), "identity keeps its observation citation");
  assert(makeCit!.event_time === null, "unknown source event clock stays unknown; observed_at is not promoted");
  assert(makeCit!.ingested_at === makeObs!.ingested_at, "observation ingestion clock preserved");
  assert(makeCit!.event_time !== makeCit!.ingested_at, "event_time ≠ ingested_at");
  const history = result.structuredContent.history as Array<Record<string, unknown>>;
  assert(history.some((e) => e.sale_price === 21000 && String(e.event_date).startsWith("2024-07-07")),
    "current asset surface retains recorded sale history");
});

Deno.test({
  name: "optional live HTTP: public /api/v1/vehicle still serves Karmann Ghia",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const res = await fetch(`https://nuke.ag/api/v1/vehicle/${VID}`);
    assert(res.ok, `status ${res.status}`);
    const body = await res.json();
    assert(body.data?.id === VID, "id");
    assert(body.data?.make === "Volkswagen", "make");
    assert(String(body.data?.model).includes("Karmann"), "model");
    assert(body.data?.sale_price === 21000, "sale_price");
  },
});

Deno.test({
  name: "optional live HTTP: advisor endpoint may be undeployed (document status)",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    // Until this PR is deployed, /mcp/advisor may not exist on the running function.
    // We still probe and record the status for the PR report — failure to reach the new
    // surface is expected pre-deploy and must not fail the suite.
    const res = await fetch("https://nuke.ag/mcp/advisor", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "advisor-e2e", version: "0" },
        },
      }),
    });
    const text = await res.text();
    let parsed: { result?: { serverInfo?: { name?: string } } } | null = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    const deployed =
      res.ok && parsed?.result?.serverInfo?.name === "nuke-asset-advisor";
    console.log(
      JSON.stringify({
        probe: "https://nuke.ag/mcp/advisor",
        http_status: res.status,
        deployed,
        note: deployed
          ? "Advisor surface is live"
          : "Advisor surface not deployed yet (expected until this PR ships)",
        tool_count_in_pr: ADVISOR_TOOLS.length,
      }),
    );
    // Always pass — this is a status probe, not a gate, until deploy.
    assert(ADVISOR_TOOLS.length === 5, "local catalog ready");
    void handleAdvisorJsonRpc;
    void initAdvisorHandlers;
  },
});
