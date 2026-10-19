import { loadCabObservation, type CabObservation } from "./cabObservation.ts";
import { writeObservation, type ObservationInput, type WriteResult } from "../_shared/observationWriter.ts";

const eq = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
const ok = (value: unknown) => { if (!value) throw new Error("assertion failed"); };
const success = (): WriteResult => ({ observationId: "receipt-1", gapFilled: [], confirmed: [], conflicted: [], evidenceIds: [], errors: [] });
const capture = (): CabObservation => ({
  vehicleId: "vehicle-1", listingUrl: "https://example.test/auctions/AbC12345/fixture", listingId: "AbC12345",
  capturedAt: "2026-10-07T08:46:11.330Z",
  vehicleData: { vin: "TESTVIN", year: 2005, description: "Retained full listing", highlights: "Original highlights", import_metadata: { highlights: "Original highlights", bids: [{ amount: 12000 }], absent: null } },
});
const persisted = (input: ObservationInput): any => ({
  id: "receipt-1", vehicle_id: input.vehicleId, source_url: input.source.url, source_identifier: input.source.sourceIdentifier,
  kind: "listing", observed_at: input.observedAt, is_superseded: false, structured_data: input.fields,
  content_text: input.contentText ?? null, extraction_metadata: { raw: input.rawData },
});
function reader(row: () => unknown, error: unknown = null) {
  return { from(table: string) {
    eq(table, "vehicle_observations");
    return { select() { return this; }, eq(column: string, value: string) {
      if (column === "id") eq(value, "receipt-1");
      else { eq(column, "observed_at"); ok(Number.isFinite(Date.parse(value))); }
      return this;
    },
      async maybeSingle() { return { data: row(), error }; } };
  } };
}
async function refused(run: () => Promise<unknown>, text: string) {
  let error: unknown;
  try { await run(); } catch (e) { error = e; }
  ok(error instanceof Error && error.message.includes(text));
}

Deno.test("C&B load waits for the writer and preserves large evidence outside indexed fields", async () => {
  const source = capture(); source.vehicleData.description = "source text ".repeat(3000);
  let input: ObservationInput | undefined; let release!: () => void; let settled = false;
  const gate = new Promise<void>((resolve) => release = resolve);
  const promise = loadCabObservation(reader(() => persisted(input!)), source, async (_s, value) => {
    input = value; await gate; return success();
  }).then((r) => { settled = true; return r; });
  await Promise.resolve(); eq(settled, false);
  eq(input!.fields, { vin: "TESTVIN", year: 2005 });
  eq(input!.contentText, source.vehicleData.description);
  eq(input!.rawData.import_metadata, source.vehicleData.import_metadata);
  eq({ ...input!.fields, description: input!.contentText, import_metadata: input!.rawData.import_metadata },
    { vin: "TESTVIN", year: 2005, description: source.vehicleData.description, import_metadata: source.vehicleData.import_metadata });
  eq(input!.rawData.source_captured_at, source.capturedAt);
  eq(input!.observedAt, source.capturedAt); eq(input!.source.sourceIdentifier, "AbC12345"); eq(input!.hashRawData, true);
  release(); eq(await promise, { observationId: "receipt-1", duplicate: false });
});

Deno.test("contained writer errors and missing receipts cannot be reported as loaded", async () => {
  const shouldNotRead = reader(() => { throw new Error("readback must not run"); });
  await refused(() => loadCabObservation(shouldNotRead, capture(), async () => ({ ...success(), errors: ["observation: index row too large"] })), "index row too large");
  await refused(() => loadCabObservation(shouldNotRead, capture(), async () => ({ ...success(), observationId: undefined })), "no persisted receipt");
  await refused(() => loadCabObservation(shouldNotRead, capture(), async () => { throw new Error("transport failed"); }), "transport failed");
});

Deno.test("the source capture clock keeps its submillisecond precision", async () => {
  let input!: ObservationInput;
  const source = { ...capture(), capturedAt: "2026-10-07T08:46:11.330123Z" };
  await loadCabObservation(reader(() => persisted(input)), source, async (_s, value) => { input = value; return success(); });
  eq(input.observedAt, source.capturedAt); eq(input.rawData.source_captured_at, source.capturedAt);
});

Deno.test("the readback requires PostgreSQL to match the exact microsecond clock", async () => {
  const source = { ...capture(), capturedAt: "2026-10-07T08:46:11.330123Z" };
  const differentClock = "2026-10-07T08:46:11.330124Z";
  eq(Date.parse(source.capturedAt), Date.parse(differentClock));
  let input!: ObservationInput;
  const filters = new Map<string, string>();
  const client = { from() { return {
    select() { return this; }, eq(key: string, value: string) { filters.set(key, value); return this; },
    async maybeSingle() {
      // Native timestamptz equality withholds the row; millisecond equality would admit it.
      return { data: filters.get("observed_at") === source.capturedAt ? null
        : { ...persisted(input), observed_at: differentClock }, error: null };
    },
  }; } };
  await refused(() => loadCabObservation(client, source, async (_s, value) => { input = value; return success(); }), "receipt does not match");
  eq(filters.get("observed_at"), source.capturedAt);
});

Deno.test("missing source IDs and clocks refuse before a writer runs", async () => {
  let writes = 0;
  const writer = async () => { writes++; return success(); };
  for (const source of [{ ...capture(), listingId: null }, { ...capture(), capturedAt: "invalid" }]) {
    await refused(() => loadCabObservation(reader(() => null), source, writer), "source ID and capture clock");
  }
  eq(writes, 0);
});

Deno.test("a duplicate ID is accepted only with the matching current persisted source", async () => {
  let input!: ObservationInput;
  const result = await loadCabObservation(reader(() => {
    const row = persisted(input); row.extraction_metadata.raw = { import_metadata: input.rawData.import_metadata, source_captured_at: input.rawData.source_captured_at }; return row;
  }), capture(), async (_s, value) => { input = value; return { ...success(), duplicate: true }; });
  eq(result, { observationId: "receipt-1", duplicate: true });
});

Deno.test("withdrawn, mismatched or unreadable persisted receipts remain failures", async (t) => {
  const changes: Record<string, (row: any) => any> = {
    withdrawn: (r) => ({ ...r, is_superseded: true }),
    vehicle: (r) => ({ ...r, vehicle_id: "another" }),
    source: (r) => ({ ...r, source_url: "https://example.test/another" }),
    identifier: (r) => ({ ...r, source_identifier: "another" }),
    kind: (r) => ({ ...r, kind: "bid" }),
    clock: (r) => ({ ...r, observed_at: "2026-10-18T00:00:00Z" }),
    fields: (r) => ({ ...r, structured_data: {} }),
    text: (r) => ({ ...r, content_text: "dropped text" }),
    metadata: (r) => ({ ...r, extraction_metadata: null }),
    missing: () => null,
  };
  for (const [name, change] of Object.entries(changes)) await t.step(name, async () => {
    let input!: ObservationInput;
    await refused(() => loadCabObservation(reader(() => change(persisted(input))), capture(), async (_s, value) => { input = value; return success(); }), "does not match");
  });
  await refused(() => loadCabObservation(reader(() => null, { message: "read failed" }), capture(), async () => success()), "does not match");
});

function hashWriter() {
  const rows: any[] = [];
  const client = { from(table: string) {
    let inserted: unknown;
    return { select() { return this; }, eq() { return this; }, insert(value: unknown) { inserted = value; rows.push(value); return this; },
      async maybeSingle() { return { data: table === "observation_sources" ? { id: "source-1", base_trust_score: 0.8, supported_observations: ["listing"] } : inserted ? { id: "observation-1" } : null, error: null }; } };
  } };
  return { rows, client };
}
const hashInput = (): ObservationInput => ({ vehicleId: null, unresolved: true,
  source: { platform: "test-cab-load-hash", url: "https://example.test/auction/abc", sourceIdentifier: "abc", trustScore: 0.8 },
  fields: { vin: "TESTVIN" }, observationKind: "listing", extractionMethod: "dom_parse", contentText: "Retained listing",
  observedAt: "2026-01-01T00:00:00Z", rawData: { note: "first" },
});
Deno.test("default observation hashes retain the deployed legacy value", async () => {
  const { client, rows } = hashWriter();
  await writeObservation(client, hashInput());
  await writeObservation(client, { ...hashInput(), rawData: { note: "second" }, hashRawData: false });
  // Public deployed SHA-256 test vector, represented as digest bytes.
  const legacyDigest = [0x3b, 0x76, 0x6f, 0x94, 0x82, 0x74, 0xac, 0xa7, 0x5b, 0xa3, 0xb3, 0x0a, 0x46, 0xca, 0x52, 0xdb,
    0xb2, 0x95, 0x62, 0x9f, 0x03, 0x8a, 0x21, 0x10, 0x3c, 0xdb, 0xf1, 0x3f, 0x6b, 0x19, 0x30, 0xf6];
  eq(Array.from(String(rows[0].content_hash).match(/../g) ?? [], (byte) => parseInt(byte, 16)), legacyDigest);
  eq(rows[1].content_hash, rows[0].content_hash);
});
Deno.test("opt-in raw evidence hashing distinguishes captures and keeps their raw testimony", async () => {
  const { client, rows } = hashWriter();
  for (const note of ["first", "second", "first"]) {
    const result = await writeObservation(client, { ...hashInput(), rawData: { note }, hashRawData: true });
    eq(result.errors, []);
  }
  ok(rows[0].content_hash !== rows[1].content_hash); eq(rows[0].content_hash, rows[2].content_hash);
  eq(rows[0].extraction_metadata.raw, { note: "first" });
  eq(rows[1].extraction_metadata.raw, { note: "second" });
});
