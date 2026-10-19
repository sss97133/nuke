import {
  HistoricalAskRefusal, historicalJpegDimensions, HISTORICAL_ASK_METHOD,
  ingestHistoricalAsk, type HistoricalAskStore,
} from "./historicalAskIntake.ts";
import {
  canonicalHistoricalJson, foldHistoricalAsks, historicalAdKey, HISTORICAL_ASK_MODE, HISTORICAL_ASK_PROFILE,
  type HistoricalCapture, type HistoricalReading, type HistoricalStoredRow, type HistoricalWithdrawal,
} from "./historicalAsks.ts";

const assert = (ok: unknown, message = "assertion failed") => { if (!ok) throw new Error(message); };
const id = (n: number) => `20000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SOURCE = id(900), CLOCK = "2026-01-01T01:00:00Z";
async function sha(bytes: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)), b => b.toString(16).padStart(2,"0")).join("");
}
/** Synthetic JPEG framing only; no claim of a decoded photograph. */
function jpeg(width = 1200, height = 1600) {
  return new Uint8Array([255,216,255,192,0,11,8,height >> 8,height & 255,width >> 8,width & 255,1,1,17,0,
    255,218,0,8,1,1,0,0,63,0,1,255,217]);
}
async function fixture() {
  const bytes = jpeg(), hash = await sha(bytes);
  const capture: HistoricalCapture = { profile: HISTORICAL_ASK_PROFILE, record_type: "capture",
    asset: { sha256: hash, storage_path: `source-evidence/autotrader/${hash}.jpg`, source_url: "https://example.test/synthetic.jpg",
      mime_type: "image/jpeg", width: 1200, height: 1600, captured_at: null, retained_at: CLOCK },
    issue: { key: "synthetic-1988-02", title: "Synthetic AutoTrader", country: "US", date_start: "1988-02-01", date_end_exclusive: "1988-03-01",
      precision: "month", date_basis: "printed", evidence: { excerpt: "February 1988" } },
    pass: { id: "retention-1", method: "byte_custody", version: "1", observed_at: CLOCK } };
  const rows: HistoricalStoredRow[] = [];
  let writes = 0, downloads = 0;
  const store: HistoricalAskStore = {
    source: async () => ({ id: SOURCE, supported_observations: ["listing"], base_trust_score: 0.5 }),
    download: async () => { downloads++; return bytes; },
    byIdentity: async (source, identifier) => rows.filter(r => r.source_id === source && r.source_identifier === identifier),
    byId: async (rowId) => rows.find(r => r.id === rowId) ?? null,
    related: async (source, captureId, adKey) => rows.filter(r => {
      const value = r.structured_data as any;
      return r.source_id === source && (adKey ? value.ad_key === adKey || value.capture_observation_id === captureId && value.record_type === "withdrawal" : value.capture_observation_id === captureId);
    }),
    insert: async (row) => {
      writes++; const saved = { ...structuredClone(row), id: id(rows.length + 1), ingested_at: new Date().toISOString(), is_superseded: false } as HistoricalStoredRow;
      rows.push(saved); return saved;
    },
  };
  async function ingest(envelope: unknown, extra: Record<string, unknown> = {}) { return await ingestHistoricalAsk(store, { mode: HISTORICAL_ASK_MODE, envelope, ...extra }); }
  async function reading(): Promise<HistoricalReading> {
    const c = await ingest(capture);
    return { profile: HISTORICAL_ASK_PROFILE, record_type: "reading", capture_observation_id: c.observation_id!, issue: structuredClone(capture.issue),
      pass: { id: "read-1", method: "visual_read", version: "1", observed_at: CLOCK },
      ad_key: await historicalAdKey(hash, [10,20,300,200]), locator: { bbox: [10,20,300,200], printed_page: 100 },
      fields: { raw: { model_year: "1966", make: "Ford", model: "Mustang", asking_price: "$4950" }, normalized: { model_year: 1966, make: "Ford", model: "Mustang", asking_amount: 4950, currency: "USD" } },
      field_assessments: Object.fromEntries(["model_year","make","model","asking_price"].map(field => [field, { assessment: "readable", evidence_excerpt: `Synthetic ${field}`,
        evidence_bbox_xywh: [20,100,200,20], checks: [{ status: "passed", method: "visual_check", version: "1", evidence: "Synthetic fixture witness", independent: false }] }])) };
  }
  return { store, capture, rows, bytes, ingest, reading, counts: () => ({ writes, downloads }) };
}
async function refused(run: () => Promise<unknown>, reason: string) {
  try { await run(); } catch (error) {
    if (!(error instanceof HistoricalAskRefusal)) throw error;
    assert(error.message.includes(reason), `${error.message} does not include ${reason}`); return;
  }
  throw new Error(`expected refusal ${reason}`);
}

Deno.test("historical JPEG reader rejects fake MIME, truncated header and mismatched framing", () => {
  assert(JSON.stringify(historicalJpegDimensions(jpeg())) === "[1200,1600]");
  for (const bytes of [new TextEncoder().encode("<html>not a JPEG</html>"), jpeg().slice(0,-2), jpeg().slice(0,15), new Uint8Array([255,216,255,217])]) assert(historicalJpegDimensions(bytes) === null);
  const bad = jpeg(); bad[5] = 255; assert(historicalJpegDimensions(bad) === null);
});

Deno.test("capture verifies immutable stored bytes before canonical source-only admission", async () => {
  const f = await fixture(); const out = await f.ingest(f.capture);
  assert(out.duplicate === false && f.counts().writes === 1 && f.counts().downloads === 1);
  const row = f.rows[0]; assert(row.vehicle_id === null && row.source_id === SOURCE && row.kind === "listing");
  assert(row.extraction_method === HISTORICAL_ASK_METHOD && row.raw_source_ref === `storage:masters/${f.capture.asset.storage_path}`);
  assert((row.structured_data as HistoricalCapture).asset.captured_at === null);
});

Deno.test("capture hash, dimensions and existing bucket path fail closed without inserts", async () => {
  const f = await fixture(); f.store.download = async () => jpeg(100, 100);
  await refused(() => f.ingest(f.capture), "original_hash_mismatch"); assert(f.counts().writes === 0);
  const g = await fixture(); g.capture.asset.width = 100;
  await refused(() => g.ingest(g.capture), "original_geometry_mismatch"); assert(g.counts().writes === 0);
  const h = await fixture(); h.capture.asset.storage_path = `wrong/${h.capture.asset.sha256}.jpg`;
  await refused(() => h.ingest(h.capture), "unexpected_original_path"); assert(h.counts().writes === 0);
});

Deno.test("source support, unexpected top-level identity and future clocks refuse", async () => {
  const f = await fixture(); f.store.source = async () => ({ id: SOURCE, supported_observations: null, base_trust_score: 0.5 });
  await refused(() => f.ingest(f.capture), "source_listing_not_registered"); assert(f.counts().writes === 0);
  const g = await fixture(); await refused(() => g.ingest(g.capture, { vehicle_hints: { year: 1966 } }), "expected_only_historical_envelope");
  g.capture.pass.observed_at = "2099-01-01T00:00:00Z"; await refused(() => g.ingest(g.capture), "future_observation_clock");
  await refused(() => ingestHistoricalAsk(g.store, { mode: "wrong", envelope: g.capture }), "expected_only_historical_envelope");
});

Deno.test("dry-run and exact retry recheck custody without duplicate testimony", async () => {
  const f = await fixture(); assert((await f.ingest(f.capture, { dry_run: true })).dry_run === true); assert(f.counts().writes === 0);
  const a = await f.ingest(f.capture), b = await f.ingest(f.capture);
  assert(a.observation_id === b.observation_id && b.duplicate === true && f.counts().writes === 1 && f.counts().downloads === 3);
});

Deno.test("capture retry rejects changed persisted custody and superseded source", async () => {
  for (const patch of [{ source_id: id(901) }, { source_identifier: "wrong" }, { content_hash: "bad" }, { source_url: "https://wrong.example.test/" },
    { kind: "sale_result" }, { vehicle_id: id(99) }, { extraction_method: "generic" }, { observed_at: "2026-01-01T01:00:00.000001Z" }, { is_superseded: true }]) {
    const f = await fixture(); await f.ingest(f.capture); const poisoned = { ...f.rows[0], ...patch };
    f.store.byIdentity = async () => [poisoned];
    await refused(() => f.ingest(f.capture), "historical_retry_conflict"); assert(f.counts().writes === 1);
  }
});

Deno.test("capture citation verifies exact saved source tuple before any ad insert", async () => {
  for (const patch of [{ id: id(99) }, { content_hash: "bad" }, { source_url: "https://wrong.example.test/" }, { kind: "media" },
    { observed_at: "2026-01-01T01:00:00.000001Z" }, { vehicle_id: id(99) }, { is_superseded: true }]) {
    const f = await fixture(), r = await f.reading(); Object.assign(f.rows[0], patch);
    await refused(() => f.ingest(r), "invalid_capture_citation"); assert(f.counts().writes === 1);
  }
});

Deno.test("reading, correction, prior retry and current reader conserve the same source ad", async () => {
  const f = await fixture(), r = await f.reading(); const first = await f.ingest(r);
  const next = structuredClone(r); next.previous_observation_id = first.observation_id; next.pass = { ...next.pass, id: "read-2", version: "2" };
  next.fields.normalized.asking_amount = 4590; next.fields.raw.asking_price = "$4590";
  const correction = await f.ingest(next); assert(correction.observation_id !== first.observation_id);
  const retry = await f.ingest(r); assert(retry.duplicate === true && retry.observation_id === first.observation_id);
  const out = await foldHistoricalAsks(f.rows, { sourceId: SOURCE }); assert(out.qualified.length === 1 && out.qualified[0].asking_amount === 4590);
  assert(f.rows.every(row => row.vehicle_id === null));
});

Deno.test("ad and whole-capture withdrawals preserve testimony and withhold current prices", async () => {
  for (const whole of [false,true]) {
    const f = await fixture(), r = await f.reading(), first = await f.ingest(r);
    const w: HistoricalWithdrawal = { profile: HISTORICAL_ASK_PROFILE, record_type: "withdrawal", issue: structuredClone(r.issue),
      pass: { id: "withdraw-1", method: "disagreement", version: "1", observed_at: CLOCK }, capture_observation_id: r.capture_observation_id,
      previous_observation_id: whole ? r.capture_observation_id : first.observation_id!, ...(whole ? {} : { ad_key: r.ad_key }), reason: "Synthetic evidence withdrawal" };
    const withdrawal = await f.ingest(w); assert(!!withdrawal.observation_id && f.rows.length === 3);
    const out = await foldHistoricalAsks(f.rows, { sourceId: SOURCE }); assert(out.qualified.length === 0);
    const again = await f.ingest(w); assert(again.duplicate === true);
    if (whole) await refused(() => f.ingest(r), "capture_unavailable");
  }
});

Deno.test("a sibling repass is refused while a malformed price correction cannot insert", async () => {
  const f = await fixture(), r = await f.reading(), first = await f.ingest(r);
  const next = structuredClone(r); next.previous_observation_id = first.observation_id; next.pass.id = "read-2"; await f.ingest(next);
  const sibling = structuredClone(next); sibling.pass.id = "sibling";
  await refused(() => f.ingest(sibling), "ambiguous_revision_chain"); assert(f.rows.length === 3);
  sibling.fields.normalized.asking_amount = -1; await refused(() => f.ingest(sibling), "invalid_asking_amount");
});

Deno.test("related-row custody corruption withholds new corrections", async () => {
  const f = await fixture(), r = await f.reading(), first = await f.ingest(r);
  f.rows[1].content_hash = "bad"; const next = structuredClone(r); next.previous_observation_id = first.observation_id; next.pass.id = "read-2";
  await refused(() => f.ingest(next), "invalid_related_custody"); assert(f.rows.length === 2);
});

Deno.test("concurrent unique winner is qualified and altered insert responses refuse", async () => {
  const f = await fixture(), normal = f.store.insert;
  f.store.insert = async row => { await normal(row); return null; };
  const out = await f.ingest(f.capture); assert(out.duplicate === true && f.rows.length === 1);
  const g = await fixture(), insert = g.store.insert;
  g.store.insert = async row => ({ ...(await insert(row))!, content_hash: "altered" });
  await refused(() => g.ingest(g.capture), "historical_insert_custody_mismatch");
  assert(canonicalHistoricalJson(g.rows[0].structured_data) === canonicalHistoricalJson(g.capture));
});
