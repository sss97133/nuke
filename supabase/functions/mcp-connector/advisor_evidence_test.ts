// Run: deno test --allow-read supabase/functions/mcp-connector/advisor_evidence_test.ts
import {
  assertEnvelopeShape,
  citationFromObservation,
  extractEventTime,
  makeEnvelope,
  notRecordedClaim,
  recordedClaim,
  resolveClaimConfidence,
  resolveEventSaleClock,
  NOT_RECORDED,
} from "./advisor/evidence.ts";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("extractEventTime prefers sold_at/sale_date over scrape clocks", () => {
  const fromSoldAt = extractEventTime({
    sold_at: "2024-07-07T00:00:00+00:00",
    sale_price: 21000,
  });
  assert(
    fromSoldAt === "2024-07-07T00:00:00.000Z" || Boolean(fromSoldAt?.startsWith("2024-07-07")),
    `got ${fromSoldAt}`,
  );

  const fromSaleDate = extractEventTime({ sale_date: "2024-07-07", high_bid: 21000 });
  assert(fromSaleDate === "2024-07-07", `got ${fromSaleDate}`);

  // No event keys → null (do not fall back to observed_at here)
  const none = extractEventTime({ mileage: 24000 }, []);
  assert(none === null, "must not invent event_time from unrelated structured_data");

  const fallback = extractEventTime(null, ["2024-07-07T20:31:26+00:00"]);
  assert(Boolean(fallback?.startsWith("2024-07-07")), `fallback got ${fallback}`);
});

Deno.test("resolveClaimConfidence distinguishes claim score from source trust", () => {
  const same = resolveClaimConfidence(0.85, 0.85);
  assert(same.confidence_basis === "source_trust", "equal scores are source_trust");

  const distinct = resolveClaimConfidence(0.9, 0.85);
  assert(distinct.confidence_basis === "claim_score", "distinct score is claim_score");
  assert(distinct.confidence === 0.9, "preserves claim score");

  const pct = resolveClaimConfidence(70, null);
  assert(pct.confidence === 0.7 && pct.confidence_basis === "claim_score", "0-100 normalized");

  const none = resolveClaimConfidence(null, null);
  assert(none.confidence === null && none.confidence_basis === "none", "ungraded");
});

Deno.test("not-recorded claims carry checked_sources and null confidence", () => {
  const c = notRecordedClaim("drivetrain", { checked_sources: ["vehicles", "Bring a Trailer"] });
  assert(c.value === NOT_RECORDED, "value");
  assert(c.confidence === null, "confidence");
  assert(c.checked_sources?.includes("vehicles") === true, "checked");
});

Deno.test("citationFromObservation keeps event_time out of ingested_at", () => {
  const cit = citationFromObservation({
    id: "2af8cd27-1edc-4c1d-b696-e75b13ef922f",
    source_name: "Bring a Trailer",
    source_url: "https://bringatrailer.com/listing/1974-volkswagen-karmann-ghia-coupe-5",
    ingested_at: "2026-03-24T07:36:25.128748+00:00",
    observed_at: "2026-01-31T12:10:27.625508+00:00",
    is_superseded: false,
    structured_data: { sold_at: "2024-07-07T00:00:00+00:00", final_price: 21000 },
  });
  assert(cit.event_time?.startsWith("2024-07-07") === true, `event_time=${cit.event_time}`);
  assert(cit.ingested_at?.startsWith("2026-03-24") === true, `ingested_at=${cit.ingested_at}`);
  assert(cit.event_time !== cit.ingested_at, "clocks must differ for BaT scrape-vs-sale case");
  assert(cit.observation_id === "2af8cd27-1edc-4c1d-b696-e75b13ef922f", "obs id");
});

Deno.test("resolveEventSaleClock prefers recovery when native clocks are absent", () => {
  const recovered = {
    event_id: "e1",
    source_event_at: "2023-01-20T00:00:00.000Z",
    precision: "day",
    basis: "lot_run_day_within_auction",
    confidence: 0.85,
    observation_id: "o1",
    citation_excerpt: "Mecum",
    rule: "mecum_index_v1",
  };
  const undated = resolveEventSaleClock(
    { id: "e1", sold_at: null, ended_at: null, started_at: null },
    recovered,
  );
  assert(undated.clock_source === "recovery", `got ${undated.clock_source}`);
  assert(undated.event_time?.startsWith("2023-01-20") === true, `got ${undated.event_time}`);

  const dated = resolveEventSaleClock(
    { id: "e1", sold_at: "2023-01-18T00:00:00Z", ended_at: null, started_at: null },
    recovered,
  );
  assert(dated.clock_source === "sold_at", "native sold_at wins when not placeholder");

  const placeholder = resolveEventSaleClock(
    {
      id: "e1",
      sold_at: "2023-01-15T00:00:00Z",
      ended_at: null,
      started_at: null,
      sold_at_precision: "month_placeholder",
    },
    recovered,
  );
  assert(placeholder.clock_source === "recovery", "high-confidence recovery beats placeholder");
});

Deno.test("envelope schema assert accepts advisor shape and rejects bad claims", () => {
  const env = makeEnvelope("get_asset", "vehicle", "14123fbf-7eb6-4dd6-b0ca-bbc83db06a28", [
    recordedClaim("make", "Volkswagen", {
      confidence: 0.85,
      confidence_basis: "source_trust",
      citations: [{
        source_name: "Bring a Trailer",
        source_url: "https://bringatrailer.com/listing/1974-volkswagen-karmann-ghia-coupe-5",
        observation_id: null,
        event_time: null,
        ingested_at: null,
        is_superseded: false,
      }],
    }),
    notRecordedClaim("drivetrain", { checked_sources: ["vehicles"] }),
  ]);
  assertEnvelopeShape(env);
  assert(env.agent_instructions.includes("Cite"), "instructions");

  let threw = false;
  try {
    assertEnvelopeShape({ tool: "x", claims: [{ field: "a", value: 1 }] });
  } catch {
    threw = true;
  }
  assert(threw, "incomplete envelope must fail");
});
