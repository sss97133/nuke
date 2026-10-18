import {
  canonicalHistoricalJson, foldHistoricalAsks as foldHistoricalAsksForSource, HISTORICAL_ASK_METHOD, HISTORICAL_ASK_PROFILE,
  historicalAdKey, historicalObservationIdentity, historicalSha256,
  type HistoricalAskEnvelope, type HistoricalCapture, type HistoricalReading,
  type HistoricalFoldOptions, type HistoricalStoredRow, type HistoricalWithdrawal, validateHistoricalAskEnvelope,
} from "./historicalAsks.ts";

const assert = (ok: unknown, message = "assertion failed") => { if (!ok) throw new Error(message); };
const equal = (a: unknown, b: unknown) => assert(canonicalHistoricalJson(a) === canonicalHistoricalJson(b), `${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const id = (n: number) => `10000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SOURCE = id(900);
const foldHistoricalAsks = (rows: HistoricalStoredRow[], options: Partial<HistoricalFoldOptions> = {}) =>
  foldHistoricalAsksForSource(rows, { sourceId: SOURCE, ...options });
const T0 = "2026-10-15T01:00:00.000000Z", T1 = "2026-10-15T01:01:00.000000Z", T2 = "2026-10-15T01:02:00.000000Z", T3 = "2026-10-15T01:03:00.000000Z";
function capture(): HistoricalCapture {
  return {
    profile: HISTORICAL_ASK_PROFILE, record_type: "capture",
    asset: { sha256: "a".repeat(64), storage_path: `source-evidence/autotrader/${"a".repeat(64)}.jpg`,
      source_url: "https://example.test/synthetic-scan.jpg", mime_type: "image/jpeg", width: 1200, height: 1600,
      captured_at: null, retained_at: T0 },
    issue: { key: "synthetic-1988-02", title: "Synthetic AutoTrader fixture", country: "US", date_start: "1988-02-01",
      date_end_exclusive: "1988-03-01", precision: "month", date_basis: "printed", evidence: { excerpt: "February 1988" } },
    pass: { id: "capture-1", method: "retained_byte_hash", version: "1", observed_at: T0 },
  };
}
async function reading(c = capture(), checked = true): Promise<HistoricalReading> {
  const check = { status: "passed" as const, method: "visual_source_check", version: "1", evidence: "Synthetic fixture witness only" };
  return {
    profile: HISTORICAL_ASK_PROFILE, record_type: "reading", capture_observation_id: id(1),
    issue: structuredClone(c.issue), pass: { id: "pass-1", method: "visual_transcription", version: "1", observed_at: T0 },
    ad_key: await historicalAdKey(c.asset.sha256, [10, 20, 300, 200]), locator: { bbox: [10, 20, 300, 200], printed_page: 100 },
    fields: { raw: { model_year: "1966", make: "Ford", model: "Mustang", asking_price: "$4950" },
      normalized: { model_year: 1966, make: "Ford", model: "Mustang", asking_amount: 4950, currency: "USD", trim: null, vin: null } },
    field_assessments: Object.fromEntries(["model_year", "make", "model", "asking_price"].map((field) => [field,
      { assessment: "readable", evidence_excerpt: `${field} synthetic witness`, evidence_bbox_xywh: [20, 100, 200, 20], ...(checked ? { checks: [check] } : {}) }])),
  };
}
async function row(n: number, value: HistoricalAskEnvelope, ingested = T1): Promise<HistoricalStoredRow> {
  return { id: id(n), source_id: SOURCE, source_identifier: await historicalObservationIdentity(value), structured_data: value,
    observed_at: value.pass.observed_at, ingested_at: ingested, kind: "listing", vehicle_id: null, is_superseded: false,
    extraction_method: HISTORICAL_ASK_METHOD };
}
async function fixture(checked = true) {
  const c = capture(), r = await reading(c, checked);
  return { c, r, rows: [await row(1, c), await row(2, r)] };
}
async function successor(r: HistoricalReading, changes: Partial<HistoricalReading> = {}) {
  return { ...structuredClone(r), previous_observation_id: id(2),
    pass: { id: "pass-2", method: "visual_repass", version: "2", observed_at: T2 }, ...changes } as HistoricalReading;
}
const reasons = (out: Awaited<ReturnType<typeof foldHistoricalAsks>>) => out.excluded.flatMap((x) => x.reasons);

Deno.test("historical identity canonicalizes key order and includes pass provenance", async () => {
  equal(canonicalHistoricalJson({ z: [1, null], a: { y: 2, x: 1 } }), canonicalHistoricalJson({ a: { x: 1, y: 2 }, z: [1, null] }));
  const f = await fixture();
  assert(await historicalObservationIdentity(f.r) !== await historicalObservationIdentity({ ...f.r, pass: { ...f.r.pass, version: "2" } }));
  assert(await historicalAdKey(f.c.asset.sha256, f.r.locator.bbox) === f.r.ad_key);
  // Standard public SHA-256 test vector, grouped to avoid credential-pattern false positives.
  assert(await historicalSha256("abc") === ["ba7816bf", "8f01cfea", "414140de", "5dae2223",
    "b00361a3", "96177a9c", "b410ff61", "f20015ad"].join(""));
  for (const value of [{ x: undefined }, { x: NaN }, new Date()]) {
    let threw = false; try { canonicalHistoricalJson(value); } catch { threw = true; } assert(threw);
  }
});

Deno.test("capture preserves unknown original download time and separate retention clock", () => {
  const c = capture(); assert(validateHistoricalAskEnvelope(c).ok);
  c.asset.captured_at = "1988-02-01T00:00:00Z"; assert(validateHistoricalAskEnvelope(c).ok);
  c.asset.captured_at = "1988-02-30T00:00:00Z"; assert(!validateHistoricalAskEnvelope(c).ok);
});

Deno.test("capture refuses foreign scope, unsafe content paths, URLs, MIME and dimensions", () => {
  for (const patch of [{ country: "ZA" }, { precision: "day" }, { date_start: "1988-02-30" }, { date_basis: "unknown" }]) {
    const c = capture(); Object.assign(c.issue, patch); assert(!validateHistoricalAskEnvelope(c).ok);
  }
  for (const patch of [{ sha256: "bad" }, { storage_path: `../${"a".repeat(64)}.jpg` }, { storage_path: "plain.jpg" },
    { source_url: "file:///tmp/photo.jpg" }, { source_url: "https://user:secret@example.test/x" }, { mime_type: "text/html" }, { width: 0 }, { height: 1.5 }]) {
    const c = capture(); Object.assign(c.asset, patch); assert(!validateHistoricalAskEnvelope(c).ok);
  }
});

Deno.test("unknown dates remain unknown; month and week intervals cannot claim exact dates", () => {
  const c = capture(); c.issue = { ...c.issue, precision: "unknown", date_start: null, date_end_exclusive: null, date_basis: "unknown", evidence: null };
  assert(validateHistoricalAskEnvelope(c).ok);
  c.issue.date_start = "1988-02-01"; assert(!validateHistoricalAskEnvelope(c).ok);
  c.issue = { ...capture().issue, precision: "week", date_start: "1988-02-01", date_end_exclusive: "1988-02-08" };
  assert(validateHistoricalAskEnvelope(c).ok);
  c.issue.date_end_exclusive = "1988-02-09"; assert(!validateHistoricalAskEnvelope(c).ok);
});

Deno.test("readings retain unknown fields, but reject identity hints and impossible geometry", async () => {
  const { r } = await fixture(false); r.fields.normalized.asking_amount = null; r.fields.normalized.trim = null;
  assert(validateHistoricalAskEnvelope(r).ok);
  for (const patch of [{ vehicle_id: id(88) }, { vehicle_hints: { year: 1966, make: "Ford" } }, { source_observation_id: id(1) }]) {
    assert(!validateHistoricalAskEnvelope({ ...r, ...patch }).ok);
  }
  r.field_assessments.asking_price.evidence_bbox_xywh = [0, 0, 300, 20]; assert(!validateHistoricalAskEnvelope(r).ok);
});

Deno.test("checked source ask reaches period-qualified graph without vehicle or sale identity", async () => {
  const f = await fixture(), before = canonicalHistoricalJson(f.rows);
  const out = await foldHistoricalAsks(f.rows, { sourceId: SOURCE });
  equal(out.counts.qualified_asks, 1); equal(out.counts.candidate_ads, 1);
  const q = out.qualified[0]; equal(q.asking_amount, 4950); equal(q.date_start, "1988-02-01"); equal(q.date_end_exclusive, "1988-03-01");
  equal(q.physical_vehicle_identity, "unresolved"); equal(q.price_kind, "asking"); equal(q.independent_verification, false);
  equal(before, canonicalHistoricalJson(f.rows));
});

Deno.test("first pass and same-reader repetitions do not silently become checked or independent", async () => {
  const f = await fixture(false); let out = await foldHistoricalAsks(f.rows); equal(out.qualified.length, 0);
  assert(reasons(out).includes("unchecked_asking_amount")); equal(out.observations.length, 2);
  const next = await successor(f.r); out = await foldHistoricalAsks([...f.rows, await row(3, next, T3)]); equal(out.qualified.length, 0);
  const g = await fixture(); const checked = await successor(g.r);
  out = await foldHistoricalAsks([...g.rows, await row(3, checked, T3)]); equal(out.qualified[0].independent_verification, false);
});

Deno.test("price correction supersedes only the chosen reading and preserves historical replay", async () => {
  const f = await fixture(), next = await successor(f.r); next.fields.normalized.asking_amount = 4590; next.fields.raw.asking_price = "$4590";
  const rows = [...f.rows, await row(3, next, T3)]; const current = await foldHistoricalAsks(rows);
  equal(current.qualified.length, 1); equal(current.qualified[0].asking_amount, 4590);
  assert(current.excluded.some((x) => x.observation_id === id(2) && x.reasons.includes("replaced_by_later_reading")));
  const past = await foldHistoricalAsks(rows, { knownAt: T2 }); equal(past.qualified[0].asking_amount, 4950); equal(past.counts.future_rows, 1);
});

Deno.test("a less certain successor withholds price and never resurrects an older value", async () => {
  const f = await fixture(), next = await successor(f.r); next.fields.normalized.asking_amount = null;
  next.field_assessments.asking_price.assessment = "uncertain";
  const out = await foldHistoricalAsks([...f.rows, await row(3, next, T3)]);
  equal(out.qualified.length, 0); assert(reasons(out).includes("unsupported_asking_amount")); equal(out.observations.length, 3);
});

Deno.test("sibling branches withhold the ad even when both readers agree", async () => {
  const f = await fixture(), a = await successor(f.r), b = await successor(f.r); b.pass.id = "different-checker";
  const out = await foldHistoricalAsks([...f.rows, await row(3, a, T3), await row(4, b, T3)]);
  equal(out.qualified.length, 0); assert(reasons(out).includes("ambiguous_revision_chain")); equal(out.counts.candidate_ads, 1);
});

Deno.test("ad withdrawal propagates without losing another ad or erasing the earlier answer", async () => {
  const f = await fixture(); const other = await reading(f.c); other.locator.bbox = [400, 20, 300, 200];
  other.ad_key = await historicalAdKey(f.c.asset.sha256, other.locator.bbox);
  for (const a of Object.values(other.field_assessments)) a.evidence_bbox_xywh = [410, 100, 200, 20];
  const w: HistoricalWithdrawal = { profile: HISTORICAL_ASK_PROFILE, record_type: "withdrawal", capture_observation_id: id(1), previous_observation_id: id(2),
    ad_key: f.r.ad_key, issue: f.c.issue, pass: { id: "withdraw-1", method: "source_disagreement", version: "1", observed_at: T2 }, reason: "Price is not legible in original source." };
  const rows = [...f.rows, await row(4, other), await row(3, w, T3)]; const current = await foldHistoricalAsks(rows);
  equal(current.qualified.length, 1); equal(current.qualified[0].ad_key, other.ad_key); assert(reasons(current).includes("ad_withdrawn"));
  equal((await foldHistoricalAsks(rows, { knownAt: T2 })).qualified.length, 2);
});

Deno.test("capture withdrawal withholds all dependent readings including later repasses", async () => {
  const f = await fixture(); const w: HistoricalWithdrawal = { profile: HISTORICAL_ASK_PROFILE, record_type: "withdrawal", capture_observation_id: id(1), previous_observation_id: id(1),
    issue: f.c.issue, pass: { id: "withdraw-capture", method: "source_integrity", version: "1", observed_at: T2 }, reason: "Issue association unsupported." };
  const next = await successor(f.r); const out = await foldHistoricalAsks([...f.rows, await row(3, w, T3), await row(4, next, T3)]);
  equal(out.qualified.length, 0); assert(reasons(out).includes("capture_unavailable"));
});

Deno.test("wrong source, missing parent and changed bbox cannot qualify or trigger a vehicle match", async () => {
  const f = await fixture(); const wrongSource = { ...f.rows[1], source_id: id(901) };
  equal((await foldHistoricalAsks([f.rows[0], wrongSource])).qualified.length, 0);
  equal((await foldHistoricalAsks([f.rows[1]])).qualified.length, 0);
  const bad = structuredClone(f.r); bad.locator.bbox = [1100, 20, 300, 200];
  for (const a of Object.values(bad.field_assessments)) a.evidence_bbox_xywh = [1110, 100, 200, 20];
  assert(reasons(await foldHistoricalAsks([f.rows[0], await row(2, bad)])).includes("ad_locator_mismatch"));
  equal((await foldHistoricalAsks([f.rows[0], { ...f.rows[1], vehicle_id: id(999) }])).qualified.length, 0);
});

Deno.test("forum-associated issue dates and unresolved make remain retained but unavailable to graphs", async () => {
  const f = await fixture(); f.c.issue.date_basis = "forum_association"; f.r.issue.date_basis = "forum_association";
  let out = await foldHistoricalAsks([await row(1, f.c), await row(2, f.r)]);
  equal(out.qualified.length, 0); assert(reasons(out).includes("issue_date_not_directly_supported")); equal(out.observations.length, 2);
  f.r.issue.date_basis = "printed"; f.c.issue.date_basis = "printed"; f.r.fields.raw.make = null;
  out = await foldHistoricalAsks([await row(1, f.c), await row(2, f.r)]); equal(out.qualified.length, 0); assert(reasons(out).includes("missing_printed_make"));
});

Deno.test("documented issue-context correction retains bytes and replaces prior date association", async () => {
  const f = await fixture(); f.c.issue.date_basis = "forum_association"; f.r.issue.date_basis = "forum_association";
  const next = await successor(f.r); next.issue.date_basis = "printed"; next.context_correction_reason = "A newly retained cover establishes the issue month.";
  const rows = [await row(1, f.c), await row(2, f.r), await row(3, next, T3)];
  equal((await foldHistoricalAsks(rows)).qualified.length, 1);
  delete next.context_correction_reason; equal((await foldHistoricalAsks([rows[0], rows[1], await row(3, next, T3)])).qualified.length, 0);
});

Deno.test("mirrored source pixels cannot create two qualified market observations", async () => {
  const f = await fixture(), c2 = capture(); c2.asset.source_url = "https://mirror.example.test/synthetic.jpg"; c2.pass.id = "capture-2";
  const r2 = await reading(c2); r2.capture_observation_id = id(3);
  const out = await foldHistoricalAsks([...f.rows, await row(3, c2), await row(4, r2)]);
  equal(out.counts.candidate_ads, 1); equal(out.qualified.length, 0); assert(reasons(out).includes("ambiguous_revision_chain"));
});

Deno.test("stored supersession respects cutoff and malformed admission cannot qualify", async () => {
  const f = await fixture(); f.rows[0].is_superseded = true; f.rows[0].superseded_at = T3;
  equal((await foldHistoricalAsks(f.rows)).qualified.length, 0);
  equal((await foldHistoricalAsks(f.rows, { knownAt: T2 })).qualified.length, 1);
  const g = await fixture(); g.rows[1].source_identifier = "forged";
  assert(reasons(await foldHistoricalAsks(g.rows)).includes("stored_identity_mismatch"));
  let threw = false; try { await foldHistoricalAsks(f.rows, { maxRows: 1 }); } catch { threw = true; } assert(threw);
});

Deno.test("a malformed later correction cannot silently resurrect its predecessor", async () => {
  const f = await fixture(), next = await successor(f.r);
  next.fields.normalized.asking_amount = -1;
  const out = await foldHistoricalAsks([...f.rows, await row(3, next, T3)]);
  equal(out.qualified.length, 0); assert(reasons(out).includes("invalid_asking_amount"));
  assert(reasons(out).includes("invalid_revision_chain_member"));
});

Deno.test("separate issue appearances remain two asks without any claimed physical match", async () => {
  const f = await fixture(), c2 = capture();
  c2.asset.sha256 = "b".repeat(64); c2.asset.storage_path = `source-evidence/autotrader/${"b".repeat(64)}.jpg`;
  c2.issue.key = "synthetic-1988-03"; c2.issue.date_start = "1988-03-01"; c2.issue.date_end_exclusive = "1988-04-01";
  const r2 = await reading(c2); r2.capture_observation_id = id(3);
  const out = await foldHistoricalAsks([...f.rows, await row(3, c2), await row(4, r2)]);
  equal(out.qualified.length, 2); equal(out.counts.candidate_ads, 2);
});

Deno.test("future retention clocks withhold the captured evidence", async () => {
  const f = await fixture(); f.c.asset.retained_at = T3;
  const out = await foldHistoricalAsks([await row(1, f.c, T1), f.rows[1]]);
  equal(out.qualified.length, 0); assert(reasons(out).includes("asset_clock_after_ingest"));
});

Deno.test("the reader requires the canonical source and protected admission method", async () => {
  const f = await fixture();
  for (const sourceId of [undefined, "not-a-source-id"]) {
    let refused = false;
    try { await foldHistoricalAsksForSource(f.rows, { sourceId } as HistoricalFoldOptions); }
    catch (error) { refused = error instanceof Error && error.message === "canonical_historical_source_required"; }
    assert(refused);
  }
  for (const method of [undefined, "generic_ingest"]) {
    const out = await foldHistoricalAsks(f.rows.map((r) => ({ ...r, extraction_method: method })));
    equal(out.qualified.length, 0); assert(reasons(out).includes("unprotected_historical_testimony"));
  }
});

Deno.test("malformed revision keys cannot disconnect a correction from its predecessor", async () => {
  for (const key of [undefined, "invalid-key"]) {
    const f = await fixture(), next = await successor(f.r);
    const malformed = structuredClone(next) as unknown as Record<string, unknown>;
    if (key === undefined) delete malformed.ad_key; else malformed.ad_key = key;
    const rows = [...f.rows, await row(3, malformed as unknown as HistoricalAskEnvelope, T3)];
    const out = await foldHistoricalAsks(rows);
    equal(out.qualified.length, 0); assert(reasons(out).includes("invalid_revision_chain_member"));
    equal((await foldHistoricalAsks(rows, { knownAt: T2 })).qualified.length, 1);
  }
});

Deno.test("malformed whole-capture withdrawals withhold dependent prices", async () => {
  for (const failure of ["invalid_clock", "invalid_issue", "conflicting_issue"]) {
    const f = await fixture();
    const w: HistoricalWithdrawal = { profile: HISTORICAL_ASK_PROFILE, record_type: "withdrawal", capture_observation_id: id(1),
      previous_observation_id: id(1), issue: structuredClone(f.c.issue), reason: "Source custody is uncertain.",
      pass: { id: "withdraw-capture", method: "source_integrity", version: "1", observed_at: T2 } };
    if (failure === "invalid_clock") w.pass.observed_at = "invalid-clock";
    if (failure === "invalid_issue") w.issue.date_start = "invalid-date";
    if (failure === "conflicting_issue") w.issue.key = "different-issue";
    const out = await foldHistoricalAsks([...f.rows, await row(3, w, T3)]);
    equal(out.qualified.length, 0); assert(reasons(out).includes("capture_unavailable"));
  }
});

Deno.test("a valid but changed ad key cannot detach an uncertain successor", async () => {
  const f = await fixture(), next = await successor(f.r);
  next.locator.bbox = [11, 20, 300, 200];
  next.ad_key = await historicalAdKey(f.c.asset.sha256, next.locator.bbox);
  next.field_assessments.asking_price.assessment = "uncertain";
  const rows = [...f.rows, await row(3, next, T3)];
  equal((await foldHistoricalAsks(rows)).qualified.length, 0);
  equal((await foldHistoricalAsks(rows, { knownAt: T2 })).qualified.length, 1);
});

Deno.test("a whole-capture withdrawal does not invalidate its own admission", async () => {
  const f = await fixture();
  const w: HistoricalWithdrawal = { profile: HISTORICAL_ASK_PROFILE, record_type: "withdrawal", capture_observation_id: id(1),
    previous_observation_id: id(1), issue: structuredClone(f.c.issue), reason: "Source custody is uncertain.",
    pass: { id: "withdraw-capture", method: "source_integrity", version: "1", observed_at: T2 } };
  const out = await foldHistoricalAsks([...f.rows, await row(3, w, T3)]);
  equal(out.qualified.length, 0);
  equal(out.observations.find((r) => r.id === id(3))?.exclusion_reasons, []);
});

Deno.test("one-pixel locator shifts withhold duplicates while adjacent ads remain separate", async () => {
  for (const [bbox, expected] of [[[11, 20, 300, 200], 0], [[400, 20, 300, 200], 2]] as const) {
    const f = await fixture(), other = await reading(f.c);
    other.locator.bbox = [...bbox]; other.ad_key = await historicalAdKey(f.c.asset.sha256, other.locator.bbox);
    for (const a of Object.values(other.field_assessments)) a.evidence_bbox_xywh = [bbox[0] + 10, 100, 200, 20];
    const out = await foldHistoricalAsks([...f.rows, await row(3, other)]);
    equal(out.qualified.length, expected);
    if (expected === 0) assert(reasons(out).includes("ambiguous_ad_locator_overlap"));
  }
});
