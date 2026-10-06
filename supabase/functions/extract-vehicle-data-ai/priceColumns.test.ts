// Run: deno test supabase/functions/extract-vehicle-data-ai/priceColumns.test.ts
// No source text is read. The vehicle write is tested through a stubbed client that records what it is asked
// to write and can answer with an error, with no row, or by throwing.
import { listingPriceColumns } from "./priceColumns.ts";
import { insertRefusal } from "./insertRefusal.ts";
import { writeVehicle } from "./vehicleWrite.ts";

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// ---- the price rule ---------------------------------------------------------------------------------------

Deno.test("a price on the page goes to asking_price and never to sale_price", () => {
  equal(listingPriceColumns({ price: 27500 }), { asking_price: 27500, sale_price: null });
});

Deno.test("a sold_price the model reads off the page is ignored, with or without an ask beside it", () => {
  equal(listingPriceColumns({ price: 30000, sold_price: 28500 }), { asking_price: 30000, sale_price: null });
  equal(listingPriceColumns({ price: null, sold_price: 28500 }), { asking_price: null, sale_price: null });
});

Deno.test("only a finite number above zero is a price: zero, negatives, NaN and Infinity become null", () => {
  for (const value of [0, -1, -28500, NaN, Infinity, -Infinity]) {
    equal(listingPriceColumns({ price: value }), { asking_price: null, sale_price: null });
  }
});

Deno.test("a string price is rejected to null, never parsed", () => {
  for (const value of ["28,500", "28500", "$28,500", "28500.00", ""]) {
    equal(listingPriceColumns({ price: value }), { asking_price: null, sale_price: null });
  }
});

Deno.test("anything that is not a number is null: null, undefined, booleans, objects, arrays", () => {
  for (const value of [null, undefined, true, false, {}, [], [28500]]) {
    equal(listingPriceColumns({ price: value }), { asking_price: null, sale_price: null });
  }
  equal(listingPriceColumns({}), { asking_price: null, sale_price: null });
});

// ---- the refusal body -------------------------------------------------------------------------------------

// The guard's real refusal: SQLSTATE 23514 from guard_vehicle_sale_price (migration 20260927170000).
const GUARD_REFUSAL = {
  code: "23514",
  message: "vehicles.sale_price = 28500 refused for 4a040922-a6c7-4c61-9341-918066aa44ca: no sold status (sale_status = 'available', auction_outcome = NULL)",
  details: "A price alone is a bid, an ask or an estimate, never a sale (vehicle_sale_basis, 2026-09-27).",
  hint: "Write a quote to asking_price and a bid to high_bid / winning_bid.",
};

Deno.test("the refusal body carries the database's own message, code and hint, the extraction, and no row details", () => {
  const extracted = { year: 1978, make: "Chevrolet", price: 28500 };
  const refusal = insertRefusal(GUARD_REFUSAL, extracted, "https://example.test/listing/1");
  equal(refusal.status, 422);
  equal(refusal.body.success, false);
  equal(refusal.body.vehicle_id, null);
  equal(refusal.body.error, `Vehicle insert refused: ${GUARD_REFUSAL.message}`);
  equal(refusal.body.error_code, "23514");
  equal(refusal.body.error_hint, GUARD_REFUSAL.hint);
  equal(refusal.body.data, extracted);
  equal(refusal.body.url, "https://example.test/listing/1");
  equal("error_details" in refusal.body, false); // Postgres puts the offending row values in details
});

Deno.test("an integrity refusal is a 422, a database fault is a 500, a missing message still says why", () => {
  equal(insertRefusal({ code: "23505", message: 'duplicate key value violates unique constraint "vehicles_vin_key"' }, {}, "u").status, 422);
  const fault = insertRefusal({ code: "57014", message: "canceling statement due to statement timeout" }, {}, "u");
  equal(fault.status, 500);
  equal(fault.body.error, "Vehicle insert refused: canceling statement due to statement timeout");
  const silent = insertRefusal({}, {}, "u");
  equal(silent.status, 500);
  equal(silent.body.error, "Vehicle insert refused: the database gave no message");
  equal(silent.body.error_code, null);
});

Deno.test("a refusal is never read as a non-vehicle page by process-import-queue, so it is retried and then failed, not skipped", () => {
  // process-import-queue marks a row skipped when the error contains any of these.
  const skipMarkers = ["No vehicle data found", "could not find real vehicle data", "Missing required fields"];
  const error = String(insertRefusal(GUARD_REFUSAL, {}, "u").body.error);
  for (const marker of skipMarkers) assert(!error.includes(marker), `refusal text contains the skip marker ${JSON.stringify(marker)}`);
});

// ---- the vehicle write, against a stubbed client ----------------------------------------------------------

type DbError = { message?: string; code?: string; details?: string; hint?: string };
type Reply = { data?: unknown; error?: DbError | null };
type Call = { table: string; op: "select" | "insert" | "update"; filters: Record<string, unknown>; payload?: Record<string, unknown> };
interface Script {
  byVin?: { id: string } | null;
  byUrl?: { id: string } | null;
  row?: Record<string, unknown> | null;
  insert?: Reply;
  update?: Reply;
  throwOnInsert?: boolean;
  throwOnUpdate?: boolean;
}

function stubClient(script: Script) {
  const calls: Call[] = [];
  function reply(call: Call): Promise<Reply> {
    if (call.op === "insert") {
      if (script.throwOnInsert) throw new Error("connection reset by peer");
      return Promise.resolve(script.insert ?? { data: { id: "new-vehicle" }, error: null });
    }
    if (call.op === "update") {
      if (script.throwOnUpdate) throw new Error("connection reset by peer");
      return Promise.resolve(script.update ?? { error: null });
    }
    if ("vin" in call.filters) return Promise.resolve({ data: script.byVin ?? null, error: null });
    if ("discovery_url" in call.filters) return Promise.resolve({ data: script.byUrl ?? null, error: null });
    if ("id" in call.filters) return Promise.resolve({ data: script.row ?? null, error: null });
    throw new Error(`unexpected query ${JSON.stringify(call)}`);
  }
  const client = {
    from(table: string) {
      const call: Call = { table, op: "select", filters: {} };
      // deno-lint-ignore no-explicit-any
      const builder: any = {
        select() { return builder; },
        eq(column: string, value: unknown) { call.filters[column] = value; return builder; },
        limit() { return builder; },
        insert(payload: Record<string, unknown>) { call.op = "insert"; call.payload = payload; return builder; },
        update(payload: Record<string, unknown>) { call.op = "update"; call.payload = payload; return builder; },
        maybeSingle() { calls.push(call); return reply(call); },
        then(resolve: (value: Reply) => unknown, reject: (reason: unknown) => unknown) {
          calls.push(call);
          return reply(call).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  return { client, calls };
}

function stubLog() {
  const lines = { log: [] as string[], error: [] as string[] };
  return { lines, log: { log: (m: string) => { lines.log.push(m); }, error: (m: string) => { lines.error.push(m); } } };
}

function extraction(overrides: Record<string, unknown> = {}) {
  return {
    year: 1978, make: "Chevrolet", model: "C10", vin: null, mileage: 61000, price: 28500, sold_price: 31000,
    description: "Clean truck", exterior_color: "Blue", ...overrides,
  };
}
const URL_1 = "https://example.test/listing/1";
const inserts = (calls: Call[]) => calls.filter((c) => c.op === "insert");
const updates = (calls: Call[]) => calls.filter((c) => c.op === "update");

Deno.test("a refused vehicle insert returns an error response with the database's message, never success with no vehicle", async () => {
  const { client, calls } = stubClient({ insert: { data: null, error: GUARD_REFUSAL } });
  const { lines, log } = stubLog();
  const normalized = extraction();
  const result = await writeVehicle(client, { normalized, url: URL_1, sourceSlug: "hemmings" }, log);
  assert(!result.ok, "a refused insert must not be ok");
  equal(result.status, 422);
  equal(result.body.success, false);
  equal(result.body.vehicle_id, null);
  equal(result.body.error, `Vehicle insert refused: ${GUARD_REFUSAL.message}`);
  equal(result.body.error_code, "23514");
  equal(result.body.url, URL_1);
  assert((result.body.data as { sold_price?: number }).sold_price === 31000, "the extraction, sold_price included, rides back to the caller");
  equal(inserts(calls).length, 1);
  equal(lines.error.length, 1); // the function_logs line
  assert(lines.error[0].startsWith("[extract-vehicle-data-ai] Vehicle insert failed: vehicles.sale_price = 28500 refused for"), "the log line names the refusal");
  equal(lines.log.length, 0);
});

Deno.test("an insert that returns no row and no error is an error response too", async () => {
  const { client } = stubClient({ insert: { data: null, error: null } });
  const { lines, log } = stubLog();
  const result = await writeVehicle(client, { normalized: extraction(), url: URL_1 }, log);
  assert(!result.ok, "no row must not be ok");
  equal(result.status, 500);
  equal(result.body.success, false);
  equal(result.body.vehicle_id, null);
  assert(String(result.body.error).includes("no row and no error"), "the error says what happened");
  equal(lines.error.length, 1);
});

Deno.test("a client that throws during the write is an error response, not success with no vehicle", async () => {
  const { client } = stubClient({ throwOnInsert: true });
  const { lines, log } = stubLog();
  const result = await writeVehicle(client, { normalized: extraction(), url: URL_1 }, log);
  assert(!result.ok, "a throw must not be ok");
  equal(result.status, 500);
  equal(result.body.success, false);
  assert(String(result.body.error).includes("connection reset by peer"), "the error carries the thrown message");
  equal(lines.error.length, 1);
});

Deno.test("a database fault on insert is a 500, an integrity refusal is a 422", async () => {
  const fault = await writeVehicle(
    stubClient({ insert: { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } } }).client,
    { normalized: extraction(), url: URL_1 }, stubLog().log,
  );
  assert(!fault.ok, "a fault must not be ok");
  equal(fault.status, 500);
  const duplicate = await writeVehicle(
    stubClient({ insert: { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } } }).client,
    { normalized: extraction(), url: URL_1 }, stubLog().log,
  );
  assert(!duplicate.ok, "a duplicate must not be ok");
  equal(duplicate.status, 422);
});

Deno.test("a new vehicle is created with the ask in asking_price and sale_price null, even when the model read a sold_price", async () => {
  const { client, calls } = stubClient({ insert: { data: { id: "veh-1" }, error: null } });
  const { lines, log } = stubLog();
  const normalized = extraction();
  const result = await writeVehicle(client, { normalized, url: URL_1, source: null, sourceSlug: "craigslist" }, log);
  assert(result.ok, "the insert succeeded");
  equal(result.vehicleId, "veh-1");
  equal(result.action, "created");
  const payload = inserts(calls)[0].payload!;
  equal(payload.asking_price, 28500);
  equal(payload.sale_price, null);
  equal(payload.source, "craigslist");
  equal(payload.discovery_source, "craigslist");
  equal(payload.extractor_version, "extract-vehicle-data-ai:1.3");
  equal(normalized.sold_price, 31000); // still in the extraction, so the observation keeps it for a later sale writer
  equal(lines.log, ["[extract-vehicle-data-ai] Created vehicle: veh-1"]);
  equal(lines.error.length, 0);
});

Deno.test("a string price is rejected to null in the written row", async () => {
  const { client, calls } = stubClient({});
  await writeVehicle(client, { normalized: extraction({ price: "28,500" }), url: URL_1 }, stubLog().log);
  const payload = inserts(calls)[0].payload!;
  equal(payload.asking_price, null);
  equal(payload.sale_price, null);
});

Deno.test("gap fill fills NULL columns, including asking_price, and never sale_price", async () => {
  const existingRow = {
    id: "veh-9", year: 1978, make: "Chevrolet", model: "C10", mileage: null, color: null, description: "kept",
    asking_price: null, sale_price: null, entry_type: "owner_claim",
  };
  const { client, calls } = stubClient({ byUrl: { id: "veh-9" }, row: existingRow });
  const { lines, log } = stubLog();
  const result = await writeVehicle(client, { normalized: extraction(), url: URL_1 }, log);
  assert(result.ok, "the vehicle exists");
  equal(result.vehicleId, "veh-9");
  equal(result.action, "gap_filled");
  equal(result.gapFillError, null);
  equal(inserts(calls).length, 0);
  const patch = updates(calls)[0].payload!;
  equal(patch.asking_price, 28500);
  equal(patch.mileage, 61000);
  equal("sale_price" in patch, false);
  equal("description" in patch, false); // an existing value is never overwritten
  equal("entry_type" in patch, false);
  assert(lines.log.length === 1 && lines.log[0].startsWith("[extract-vehicle-data-ai] Gap-filled "), "success logs Gap-filled");
  equal(lines.error.length, 0);
});

Deno.test("a gap-fill UPDATE that fails is logged as a failure, not as Gap-filled, and the vehicle id still comes back", async () => {
  const { client } = stubClient({
    byUrl: { id: "veh-9" }, row: { id: "veh-9", mileage: null, asking_price: null },
    update: { error: { code: "57014", message: "canceling statement due to statement timeout" } },
  });
  const { lines, log } = stubLog();
  const result = await writeVehicle(client, { normalized: extraction(), url: URL_1 }, log);
  assert(result.ok, "the vehicle exists, so the write is still ok");
  equal(result.vehicleId, "veh-9");
  equal(result.gapFillError, "canceling statement due to statement timeout");
  equal(result.filled, []);
  equal(lines.error, ["[extract-vehicle-data-ai] Gap-fill failed for veh-9: canceling statement due to statement timeout"]);
  assert(!lines.log.some((line) => line.includes("Gap-filled")), "a failed update is never logged as Gap-filled");
});

Deno.test("a gap-fill UPDATE that throws is logged as a failure too", async () => {
  const { client } = stubClient({ byUrl: { id: "veh-9" }, row: { id: "veh-9", mileage: null }, throwOnUpdate: true });
  const { lines, log } = stubLog();
  const result = await writeVehicle(client, { normalized: extraction(), url: URL_1 }, log);
  assert(result.ok, "the vehicle exists");
  equal(result.gapFillError, "connection reset by peer");
  equal(lines.error.length, 1);
  assert(!lines.log.some((line) => line.includes("Gap-filled")), "a thrown update is never logged as Gap-filled");
});

Deno.test("an existing vehicle is found by VIN first, then by discovery_url", async () => {
  const byVin = stubClient({ byVin: { id: "veh-vin" }, byUrl: { id: "veh-url" }, row: { id: "veh-vin" } });
  const first = await writeVehicle(byVin.client, { normalized: extraction({ vin: "1GCEK14T5XZ123456" }), url: URL_1 }, stubLog().log);
  assert(first.ok, "found");
  equal(first.vehicleId, "veh-vin");
  const byUrl = stubClient({ byUrl: { id: "veh-url" }, row: { id: "veh-url" } });
  const second = await writeVehicle(byUrl.client, { normalized: extraction(), url: URL_1 }, stubLog().log);
  assert(second.ok, "found");
  equal(second.vehicleId, "veh-url");
});

Deno.test("with nothing to fill there is no update call and the log says Gap-filled 0", async () => {
  const full = { id: "veh-9", year: 1978, make: "Chevrolet", model: "C10", mileage: 61000, color: "Blue", description: "kept", asking_price: 28500,
    listing_url: URL_1, source: "hemmings", discovery_source: "hemmings", profile_origin: "ai_extraction", extractor_version: "x" };
  const { client, calls } = stubClient({ byUrl: { id: "veh-9" }, row: full });
  const { lines, log } = stubLog();
  const result = await writeVehicle(client, { normalized: extraction(), url: URL_1, sourceSlug: "hemmings" }, log);
  assert(result.ok, "ok");
  equal(updates(calls).length, 0);
  equal(lines.log, ["[extract-vehicle-data-ai] Gap-filled 0 NULL fields on existing vehicle: veh-9"]);
});
