// Run: deno test --allow-read=supabase/functions/extract-craigslist/fixtures supabase/functions/ingest/craigslistCapture.test.ts
// What ingest does with a Craigslist post's attribute block once the vehicle exists: which fields go to the sanctioned
// observation writer, where the VIN goes and where it must not, and what the poller's ledger row ends up holding.
// The writer is exercised two ways: a stub that records the call it receives, and the real _shared/observationWriter
// over a client that records every table write.
import { captureObservationFields, COLUMNS_WRITTEN_AT_CREATION, cylindersFrom, fuelTypeFrom, landCraigslistCapture, ledgerFields } from "./craigslistCapture.ts";
import { writeObservation } from "../_shared/observationWriter.ts";
import { parseCapture, pickCapture } from "../_shared/craigslistAttributes.ts";
import { extractFromHtml } from "../extract-craigslist/extract.ts";
import { normalizeExtractedData } from "../extract-vehicle-data-ai/normalize.ts";
import { captureLedgerFields } from "../poll-listing-feeds/captureLedger.ts";

function equal(actual: unknown, expected: unknown, note = "") {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${note} expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const page = (name: string) => Deno.readTextFileSync(new URL(`../extract-craigslist/fixtures/${name}`, import.meta.url));
const URL1 = "https://www.craigslist.org/view/d/sample-vehicle/FixtureToken000001";
const VEHICLE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const classic = () => parseCapture(page("classic-vin-manual-truck.html"), URL1);
// what ingest handed matchOrCreateVehicle for that post (after its gate)
const WRITTEN = { mileage: 96213, title_status: "clean", transmission: "Manual", color: "silver", body_style: "truck" };

// ---- a client that records every table call and answers from a script -----------------------------------------

interface Call { table: string; ops: Array<[string, unknown[]]> }
function fakeSupabase(handler: (call: Call) => { data?: unknown; error?: unknown }) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, ops: [] };
      const settle = () => {
        calls.push(call);
        const r = handler(call);
        return { data: r.data ?? null, error: r.error ?? null };
      };
      const builder: any = new Proxy({}, {
        get(_t, prop: string) {
          if (prop === "then") return (resolve: any, reject: any) => Promise.resolve(settle()).then(resolve, reject);
          return (...args: unknown[]) => {
            call.ops.push([prop, args]);
            return builder;
          };
        },
      });
      return builder;
    },
  };
  return { client, calls };
}
const op = (call: Call, name: string) => call.ops.find((o) => o[0] === name)?.[1];
const selectOf = (call: Call) => String(op(call, "select")?.[0] ?? "");

interface World {
  vinHolder?: string | null; // another vehicle that holds the VIN
  holderLookupFails?: boolean;
  row?: Record<string, unknown>; // the vehicle row as it stands
  duplicateObservation?: boolean;
}
function world(w: World = {}) {
  const row = {
    id: VEHICLE, vin: null, mileage: 96213, transmission: "Manual", color: "silver", body_style: "truck", title_status: "clean",
    drivetrain: null, fuel_type: null, listing_posted_at: null, listing_updated_at: null, ...w.row,
  };
  return fakeSupabase((c) => {
    switch (c.table) {
      case "observation_sources":
        return { data: { id: "source-craigslist", base_trust_score: 0.4, supported_observations: ["listing"] } };
      case "pipeline_registry":
        return { data: [] };
      case "vehicle_observations":
        if (c.ops.some((o) => o[0] === "insert")) return { data: { id: "observation-1" } };
        return { data: w.duplicateObservation ? { id: "observation-0" } : null };
      case "vehicles":
        if (c.ops.some((o) => o[0] === "update")) return {};
        if (selectOf(c) === "id") return w.holderLookupFails ? { error: { message: "boom" } } : { data: w.vinHolder ? [{ id: w.vinHolder }] : [] };
        return { data: row };
      case "field_evidence":
        return { data: [{ id: "evidence-1" }] };
      default:
        return {};
    }
  });
}
const writes = (calls: Call[], table: string, kind: string) => calls.filter((c) => c.table === table && c.ops.some((o) => o[0] === kind));

// ---- the fields ------------------------------------------------------------------------------------------------

Deno.test("fuel: Craigslist's gas is the column's gasoline; other is not a fuel", () => {
  equal([fuelTypeFrom("gas"), fuelTypeFrom("diesel"), fuelTypeFrom("electric"), fuelTypeFrom("other"), fuelTypeFrom(null)], ["gasoline", "diesel", "electric", null, null]);
});

Deno.test("cylinders: a number only when the page gave one", () => {
  equal([cylindersFrom("8 cylinders"), cylindersFrom("12 cylinders"), cylindersFrom("other"), cylindersFrom(null)], [8, 12, null, null]);
});

Deno.test("the observation fields of a full post: columns in their own names, testimony beside them", () => {
  equal(captureObservationFields(classic(), WRITTEN, true), {
    vin: "CKY145Z123456", mileage: 96213, title_status: "clean", transmission: "Manual", drivetrain: "4WD", fuel_type: "gasoline",
    color: "silver", body_style: "truck", cylinders: 8, condition: "good",
    listing_posted_at: "2026-01-02T11:04:05.000Z", listing_updated_at: "2026-01-03T12:05:06.000Z",
  });
});

Deno.test("a VIN that may not be written travels as a claim, not as the VIN", () => {
  const f = captureObservationFields(classic(), WRITTEN, false);
  equal([f.vin, f.vin_claim], [undefined, "CKY145Z123456"]);
});

Deno.test("a VIN row the rules refused travels as the seller's text, as a claim", () => {
  const bad = page("modern-vin-17-full-block.html").replace("1B7KF23D3WJ123456", "1B7KF23D4WJ123456");
  const f = captureObservationFields(parseCapture(bad), {}, true);
  equal([f.vin, f.vin_claim], [undefined, "1B7KF23D4WJ123456"]);
});

Deno.test("the disclosures are testimony, and a zero odometer is not offered to the writer", () => {
  const f = captureObservationFields(parseCapture(page("title-missing-odometer-rolled-over.html")), {}, true);
  equal([f.odometer_broken, f.odometer_rolled_over, f.title_status, f.mileage], [true, true, "missing", 100000]);
  const none = captureObservationFields(parseCapture(page("classic-vin-manual-truck.html").replace("96,213", "0")), { mileage: 0 }, true);
  equal(none.mileage, undefined);
  const clean = captureObservationFields(classic(), WRITTEN, true);
  equal([clean.odometer_broken, clean.odometer_rolled_over], [undefined, undefined]);
});

Deno.test("what ingest already wrote is offered back as written, so the writer confirms it", () => {
  const f = captureObservationFields(classic(), { ...WRITTEN, transmission: "Manual (normalized)", color: "Silver" }, true);
  equal([f.transmission, f.color], ["Manual (normalized)", "Silver"]);
});

// ---- the VIN reaches the writer -----------------------------------------------------------------------------------

Deno.test("the VIN is handed to the sanctioned writer as a listing observation from the craigslist source", async () => {
  const seen: any[] = [];
  const supabase = world().client;
  const landing = await landCraigslistCapture(
    { supabase, writeObservation: (_c, input) => { seen.push(input); return Promise.resolve({ observationId: "o1", gapFilled: ["vin", "drivetrain"], confirmed: ["mileage"], conflicted: [], evidenceIds: [], errors: [] }); } },
    { vehicleId: VEHICLE, listingUrl: URL1, capture: classic(), written: WRITTEN },
  );
  equal(seen.length, 1);
  const w = seen[0];
  equal([w.vehicleId, w.source.platform, w.source.url, w.source.sourceIdentifier, w.observationKind, w.extractionMethod], [VEHICLE, "craigslist", URL1, "7000000001", "listing", "html_parse"]);
  equal(w.fields.vin, "CKY145Z123456");
  equal(w.fields.vin_claim, undefined);
  equal(w.rawData.attributes.vin_raw, "CKY145Z123456", "the verbatim block rides with the observation");
  equal(w.rawData.post_id, "7000000001");
  equal([landing.observation, landing.vin, landing.gap_filled, landing.confirmed], ["written", "filled", ["vin", "drivetrain"], ["mileage"]]);
});

Deno.test("the condition word is inside the listing observation; no condition-kind observation is written", async () => {
  const seen: any[] = [];
  await landCraigslistCapture(
    { supabase: world().client, writeObservation: (_c, input) => { seen.push(input); return Promise.resolve({ observationId: "o1", gapFilled: [], confirmed: [], conflicted: [], evidenceIds: [], errors: [] }); } },
    { vehicleId: VEHICLE, listingUrl: URL1, capture: classic(), written: WRITTEN },
  );
  equal(seen.map((s) => s.observationKind), ["listing"]);
  equal(seen[0].fields.condition, "good");
});

Deno.test("another vehicle already holds the VIN: it stays a claim on the observation and is not written to the vehicle", async () => {
  const seen: any[] = [];
  const landing = await landCraigslistCapture(
    { supabase: world({ vinHolder: OTHER }).client, writeObservation: (_c, input) => { seen.push(input); return Promise.resolve({ observationId: "o1", gapFilled: ["drivetrain"], confirmed: [], conflicted: [], evidenceIds: [], errors: [] }); } },
    { vehicleId: VEHICLE, listingUrl: URL1, capture: classic(), written: WRITTEN },
  );
  equal([seen[0].fields.vin, seen[0].fields.vin_claim], [undefined, "CKY145Z123456"]);
  equal(seen[0].rawData.vin_held_by, OTHER);
  equal(landing.vin, "held_elsewhere");
  equal(landing.observation, "written");
});

Deno.test("the holder lookup failed: the VIN is not written, and the landing says so", async () => {
  const seen: any[] = [];
  const landing = await landCraigslistCapture(
    { supabase: world({ holderLookupFails: true }).client, writeObservation: (_c, input) => { seen.push(input); return Promise.resolve({ observationId: "o1", gapFilled: [], confirmed: [], conflicted: [], evidenceIds: [], errors: [] }); } },
    { vehicleId: VEHICLE, listingUrl: URL1, capture: classic(), written: WRITTEN },
  );
  equal([seen[0].fields.vin, seen[0].fields.vin_claim, landing.vin], [undefined, "CKY145Z123456", "unchecked"]);
});

Deno.test("the vehicle's own row is never reported as another holder", async () => {
  const w = world();
  await landCraigslistCapture(
    { supabase: w.client, writeObservation: () => Promise.resolve({ observationId: "o1", gapFilled: [], confirmed: [], conflicted: [], evidenceIds: [], errors: [] }) },
    { vehicleId: VEHICLE, listingUrl: URL1, capture: classic(), written: WRITTEN },
  );
  const lookup = w.calls.find((c) => c.table === "vehicles" && selectOf(c) === "id");
  assert(lookup, "the holder lookup ran");
  equal(op(lookup, "neq"), ["id", VEHICLE]);
  equal(op(lookup, "eq"), ["vin", "CKY145Z123456"]);
});

Deno.test("a post whose VIN row was refused records why, and makes no holder lookup", async () => {
  const bad = parseCapture(page("modern-vin-17-full-block.html").replace("1B7KF23D3WJ123456", "1B7KF23D4WJ123456"));
  const w = world();
  const landing = await landCraigslistCapture(
    { supabase: w.client, writeObservation: () => Promise.resolve({ observationId: "o1", gapFilled: [], confirmed: [], conflicted: [], evidenceIds: [], errors: [] }) },
    { vehicleId: VEHICLE, listingUrl: URL1, capture: bad, written: {} },
  );
  equal(landing.vin, "not_accepted");
  equal(w.calls.filter((c) => c.table === "vehicles").length, 0);
});

Deno.test("a post with no VIN row lands everything else", async () => {
  const seen: any[] = [];
  const landing = await landCraigslistCapture(
    { supabase: world().client, writeObservation: (_c, input) => { seen.push(input); return Promise.resolve({ observationId: "o1", gapFilled: ["fuel_type"], confirmed: [], conflicted: [], evidenceIds: [], errors: [] }); } },
    { vehicleId: VEHICLE, listingUrl: URL1, capture: parseCapture(page("no-vin-diesel-fair.html")), written: {} },
  );
  equal([seen[0].fields.vin, seen[0].fields.vin_claim, seen[0].fields.fuel_type, seen[0].fields.condition], [undefined, undefined, "diesel", "fair"]);
  equal(landing.vin, "absent");
});

Deno.test("the writer's verdict on the VIN is reported: filled, confirmed, conflict", async () => {
  const verdict = async (r: { gapFilled: string[]; confirmed: string[]; conflicted: string[] }) =>
    (await landCraigslistCapture(
      { supabase: world().client, writeObservation: () => Promise.resolve({ observationId: "o1", evidenceIds: [], errors: [], ...r }) },
      { vehicleId: VEHICLE, listingUrl: URL1, capture: classic(), written: WRITTEN },
    )).vin;
  equal(await verdict({ gapFilled: ["vin"], confirmed: [], conflicted: [] }), "filled");
  equal(await verdict({ gapFilled: [], confirmed: ["vin"], conflicted: [] }), "confirmed");
  equal(await verdict({ gapFilled: [], confirmed: [], conflicted: ["vin"] }), "conflict");
  equal(await verdict({ gapFilled: [], confirmed: [], conflicted: [] }), "not_written");
});

Deno.test("a writer that throws or hangs is an error outcome, never an exception, and never holds ingest", async () => {
  const thrown = await landCraigslistCapture(
    { supabase: world().client, writeObservation: () => Promise.reject(new Error("db down")) },
    { vehicleId: VEHICLE, listingUrl: URL1, capture: classic(), written: WRITTEN },
  );
  equal([thrown.observation, thrown.errors], ["error", ["db down"]]);
  const started = Date.now();
  const hung = await landCraigslistCapture(
    { supabase: world().client, writeObservation: () => new Promise(() => {}) },
    { vehicleId: VEHICLE, listingUrl: URL1, capture: classic(), written: WRITTEN, timeoutMs: 25 },
  );
  equal(hung.observation, "error");
  assert(hung.errors[0].includes("timed out"), "says it timed out");
  assert(Date.now() - started < 1000, "returned promptly");
});

Deno.test("an observation the writer already holds is reported as a duplicate, not a second row", async () => {
  const w = world({ duplicateObservation: true });
  const landing = await landCraigslistCapture(
    { supabase: w.client, writeObservation },
    { vehicleId: VEHICLE, listingUrl: URL1, capture: classic(), written: WRITTEN },
  );
  equal(landing.observation, "duplicate");
  equal(writes(w.calls, "vehicle_observations", "insert").length, 0);
});

// ---- through the real writer ----------------------------------------------------------------------------------

Deno.test("through the real observation writer: the VIN is on the observation, in the evidence, and filled on the vehicle with provenance", async () => {
  const w = world();
  const landing = await landCraigslistCapture(
    { supabase: w.client, writeObservation },
    { vehicleId: VEHICLE, listingUrl: URL1, capture: classic(), written: WRITTEN },
  );
  equal([landing.observation, landing.vin, landing.errors], ["written", "filled", []]);

  // the observation row
  const inserts = writes(w.calls, "vehicle_observations", "insert");
  equal(inserts.length, 1);
  const row = (op(inserts[0], "insert") as any[])[0];
  equal([row.vehicle_id, row.source_id, row.source_url, row.source_identifier, row.kind, row.extraction_method], [VEHICLE, "source-craigslist", URL1, "7000000001", "listing", "html_parse"]);
  equal(row.structured_data.vin, "CKY145Z123456");
  equal(row.structured_data.drivetrain, "4WD");
  equal(row.structured_data.condition, "good");
  equal(row.extraction_metadata.raw.attributes.raw["auto_vin"], "CKY145Z123456");
  assert(!inserts.some((c) => (op(c, "insert") as any[])[0].kind === "condition"), "no condition-kind observation");

  // the vehicle: one update, only the columns that were empty, each with its provenance
  const updates = writes(w.calls, "vehicles", "update");
  equal(updates.length, 1);
  const set = (op(updates[0], "update") as any[])[0];
  equal(set.vin, "CKY145Z123456");
  equal(set.drivetrain, "4WD");
  equal(set.fuel_type, "gasoline");
  equal(set.listing_posted_at, "2026-01-02T11:04:05.000Z");
  equal(set.listing_updated_at, "2026-01-03T12:05:06.000Z");
  assert(typeof set.vin_source === "string" && set.vin_source.length > 0, "vin_source is stamped");
  for (const k of ["mileage", "transmission", "color", "body_style", "title_status"]) assert(!(k in set), `${k} was confirmed, not rewritten`);

  // the evidence
  const evidence = (op(writes(w.calls, "field_evidence", "upsert")[0], "upsert") as any[])[0] as any[];
  const vinEvidence = evidence.find((e) => e.field_name === "vin");
  assert(vinEvidence, "a field_evidence row for the VIN");
  equal([vinEvidence.proposed_value, vinEvidence.source_type, vinEvidence.vehicle_id], ["CKY145Z123456", "craigslist", VEHICLE]);

  // the receipts: one per field, so each value says where it came from
  const receipts = writes(w.calls, "extraction_metadata", "insert").map((c) => (op(c, "insert") as any[])[0].field_name);
  assert(receipts.includes("vin") && receipts.includes("mileage") && receipts.includes("listing_posted_at"), "receipts for vin, mileage, listing_posted_at");
});

Deno.test("through the real writer: a different VIN already on the vehicle is quarantined, not overwritten", async () => {
  const w = world({ row: { vin: "ZZZ99999999999999" } });
  const landing = await landCraigslistCapture(
    { supabase: w.client, writeObservation },
    { vehicleId: VEHICLE, listingUrl: URL1, capture: classic(), written: WRITTEN },
  );
  equal(landing.vin, "conflict");
  const set = (op(writes(w.calls, "vehicles", "update")[0], "update") as any[])[0];
  assert(!("vin" in set), "the existing VIN is untouched");
  equal(writes(w.calls, "bat_quarantine", "insert").length, 1);
});

Deno.test("through the real writer: a held VIN is not written, and the vehicle still gets its other columns", async () => {
  const w = world({ vinHolder: OTHER });
  const landing = await landCraigslistCapture(
    { supabase: w.client, writeObservation },
    { vehicleId: VEHICLE, listingUrl: URL1, capture: classic(), written: WRITTEN },
  );
  equal(landing.vin, "held_elsewhere");
  const set = (op(writes(w.calls, "vehicles", "update")[0], "update") as any[])[0];
  equal([set.vin, set.drivetrain, set.fuel_type], [undefined, "4WD", "gasoline"]);
  const row = (op(writes(w.calls, "vehicle_observations", "insert")[0], "insert") as any[])[0];
  equal([row.structured_data.vin, row.structured_data.vin_claim], [undefined, "CKY145Z123456"]);
  equal(row.extraction_metadata.raw.vin_held_by, OTHER);
});

// ---- a vehicle ingest just created is not re-confirmed column by column --------------------------------------------

const receiptFields = (calls: Call[]) => writes(calls, "extraction_metadata", "insert").map((c) => (op(c, "insert") as any[])[0].field_name).sort();
const evidenceFieldNames = (calls: Call[]) => ((op(writes(calls, "field_evidence", "upsert")[0], "upsert") as any[])[0] as any[]).map((e) => e.field_name).sort();

Deno.test("a vehicle just created: the observation keeps the whole block, the vehicle and the ledger see only what is new", async () => {
  const w = world();
  const landing = await landCraigslistCapture(
    { supabase: w.client, writeObservation },
    { vehicleId: VEHICLE, listingUrl: URL1, capture: classic(), written: WRITTEN, isNewVehicle: true },
  );
  equal([landing.observation, landing.vin], ["written", "filled"]);
  const row = (op(writes(w.calls, "vehicle_observations", "insert")[0], "insert") as any[])[0];
  for (const k of COLUMNS_WRITTEN_AT_CREATION) assert(k in row.structured_data, `${k} stays on the observation`);
  equal(receiptFields(w.calls), ["drivetrain", "fuel_type", "listing_posted_at", "listing_updated_at", "vin"]);
  equal(evidenceFieldNames(w.calls), ["condition", "cylinders", "drivetrain", "fuel_type", "listing_posted_at", "listing_updated_at", "vin"]);
  const set = (op(writes(w.calls, "vehicles", "update")[0], "update") as any[])[0];
  equal(Object.keys(set).sort(), ["drivetrain", "fuel_type", "listing_posted_at", "listing_updated_at", "vin", "vin_source"]);
  assert(w.calls.length < 18, `fewer table calls than the ${28} of a full comparison (${w.calls.length})`);
});

Deno.test("a vehicle that was matched, not created: every column is compared, and a different value is quarantined", async () => {
  const w = world({ row: { mileage: 150000 } });
  const landing = await landCraigslistCapture(
    { supabase: w.client, writeObservation },
    { vehicleId: VEHICLE, listingUrl: URL1, capture: classic(), written: WRITTEN, isNewVehicle: false },
  );
  equal(landing.conflicted, ["mileage"]);
  const q = writes(w.calls, "bat_quarantine", "insert");
  equal(q.length, 1);
  equal([(op(q[0], "insert") as any[])[0].field_name, (op(q[0], "insert") as any[])[0].existing_value, (op(q[0], "insert") as any[])[0].proposed_value], ["mileage", "150000", "96213"]);
  const set = (op(writes(w.calls, "vehicles", "update")[0], "update") as any[])[0];
  assert(!("mileage" in set), "the existing mileage is not overwritten");
  assert(receiptFields(w.calls).includes("mileage") && receiptFields(w.calls).includes("transmission"), "receipts for the compared columns");
});

Deno.test("the writer is told which columns to leave alone only for a vehicle just created", async () => {
  const seen: any[] = [];
  const stub = { supabase: world().client, writeObservation: (_c: unknown, input: any) => { seen.push(input); return Promise.resolve({ observationId: "o1", gapFilled: [], confirmed: [], conflicted: [], evidenceIds: [], errors: [] }); } };
  await landCraigslistCapture(stub, { vehicleId: VEHICLE, listingUrl: URL1, capture: classic(), written: WRITTEN, isNewVehicle: true });
  await landCraigslistCapture(stub, { vehicleId: VEHICLE, listingUrl: URL1, capture: classic(), written: WRITTEN, isNewVehicle: false });
  await landCraigslistCapture(stub, { vehicleId: VEHICLE, listingUrl: URL1, capture: classic(), written: WRITTEN });
  equal(seen.map((s) => s.testimonyOnly), [COLUMNS_WRITTEN_AT_CREATION, undefined, undefined]);
});

Deno.test("the shared writer without testimonyOnly behaves as it always did: every field gets a receipt and evidence", async () => {
  const w = world();
  await writeObservation(w.client, {
    vehicleId: VEHICLE, source: { platform: "craigslist", url: URL1 },
    fields: { mileage: 96213, transmission: "Manual", drivetrain: "4WD" }, observationKind: "listing", extractionMethod: "html_parse",
  });
  equal(receiptFields(w.calls), ["drivetrain", "mileage", "transmission"]);
  equal(evidenceFieldNames(w.calls), ["drivetrain", "mileage", "transmission"]);
});

Deno.test("the shared writer with testimonyOnly: the observation keeps every field, the vehicle and the evidence skip the named ones", async () => {
  const w = world();
  await writeObservation(w.client, {
    vehicleId: VEHICLE, source: { platform: "craigslist", url: URL1 },
    fields: { mileage: 96213, transmission: "Manual", drivetrain: "4WD" }, observationKind: "listing", extractionMethod: "html_parse",
    testimonyOnly: ["mileage", "transmission"],
  });
  const row = (op(writes(w.calls, "vehicle_observations", "insert")[0], "insert") as any[])[0];
  equal(Object.keys(row.structured_data), ["mileage", "transmission", "drivetrain"]);
  equal(receiptFields(w.calls), ["drivetrain"]);
  equal(evidenceFieldNames(w.calls), ["drivetrain"]);
});

// ---- from the page to the ledger row --------------------------------------------------------------------------

Deno.test("page -> extractor -> funnel -> ingest -> ledger row: the ledger holds what the page said", async () => {
  // extract-craigslist answers as JSON; extract-vehicle-data-ai normalizes; ingest re-reads the capture
  const answer = JSON.parse(JSON.stringify({ success: true, extracted: extractFromHtml(page("classic-vin-manual-truck.html"), URL1) }));
  const funnelled = JSON.parse(JSON.stringify({ success: true, data: normalizeExtractedData(answer.extracted, URL1) }));
  const capture = pickCapture(funnelled.data);
  assert(capture, "ingest re-reads the capture");

  const w = world();
  const landing = await landCraigslistCapture(
    { supabase: w.client, writeObservation },
    { vehicleId: VEHICLE, listingUrl: URL1, capture, written: WRITTEN },
  );
  // ingest's answer; the poller spreads what the ledger helper returns into the ledger row's raw_data
  const ingestAnswer = JSON.parse(JSON.stringify({ status: "created", vehicle_id: VEHICLE, listing_capture: ledgerFields(capture, landing) }));
  const raw: any = { feed_id: "feed-1", ingested_via: "poll_firecrawl_html", ingest_status: ingestAnswer.status, ...captureLedgerFields(ingestAnswer) };

  equal([raw.feed_id, raw.ingested_via, raw.ingest_status], ["feed-1", "poll_firecrawl_html", "created"]);
  equal([raw.post_id, raw.posted_at, raw.updated_at], ["7000000001", "2026-01-02T11:04:05.000Z", "2026-01-03T12:05:06.000Z"]);
  equal(
    [raw.attributes.vin, raw.attributes.odometer, raw.attributes.title_status, raw.attributes.condition, raw.attributes.transmission,
      raw.attributes.drive, raw.attributes.fuel, raw.attributes.cylinders, raw.attributes.paint_color, raw.attributes.type],
    ["CKY145Z123456", 96213, "clean", "good", "manual", "4wd", "gas", "8 cylinders", "silver", "truck"],
  );
  equal([raw.capture_landing.observation, raw.capture_landing.vin], ["written", "filled"]);
});

Deno.test("the ledger fields of any other source are empty, and anything that is not a capture object adds nothing", () => {
  equal(captureLedgerFields({ status: "matched", vehicle_id: VEHICLE }), {});
  equal(captureLedgerFields({ status: "rejected", reason: "quality_gate_reject: x" }), {});
  equal(captureLedgerFields({ listing_capture: "text" }), {});
  equal(captureLedgerFields({ listing_capture: [1] }), {});
  equal(captureLedgerFields({ listing_capture: null }), {});
  equal(captureLedgerFields(null), {});
  equal(captureLedgerFields(undefined), {});
});

Deno.test("a rejected post's ledger fields keep the page's block too, without a landing", () => {
  const fields: any = captureLedgerFields({ status: "rejected", reason: "insufficient identity", listing_capture: ledgerFields(classic()) });
  equal(fields.attributes.vin, "CKY145Z123456");
  equal("capture_landing" in fields, false);
  equal(fields.post_id, "7000000001");
});
