import assert from "node:assert/strict";
import { processFinancialEvidence } from "./financialProcessing.ts";
const user = "11111111-1111-4111-8111-111111111111";
const doc = "22222222-2222-4222-8222-222222222222";
const original = { sha256: "a".repeat(64), storage_path: `${user}/receipt.jpg` };
const request = { mode: "financial_evidence_v1", action: "process", original };
function fixture(retained: unknown = null, accounting: unknown = null) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const admissions: Record<string, unknown>[] = [];
  const db = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args }); return { data: name === "read_financial_evidence" ? retained : accounting, error: null as unknown };
  } };
  const admit = async (input: Record<string, unknown>) => { admissions.push(input); return { status: 200, body: { data: { document_id: doc } } }; };
  return { calls, admissions, db, admit };
}
Deno.test("new original uses sanctioned capture only and explicitly blocks unsupported OCR", async () => {
  const f = fixture(); const result = await processFinancialEvidence(f.db, user, request, async () => true, f.admit);
  assert.equal(result.status, 200); assert.equal(result.body.processing_status, "blocked");
  assert.equal(result.body.reason, "ocr_entitlement_unavailable"); assert.equal(result.body.paid_inference_started, false);
  assert.equal(result.body.tax_ready, false); assert.equal(f.admissions.length, 1);
  const revision = f.admissions[0].revision as any;
  assert.equal(revision.idempotency_key, `capture:v1:${original.sha256}`);
  assert.equal(revision.fields[0].evidence.extraction_performed, false);
  assert.equal(revision.accounting_records, undefined); assert.equal(revision.lines, undefined);
  assert.deepEqual(f.calls[0].args, { p_owner_id: user, p_document_id: null, p_sha256: original.sha256 });
});
Deno.test("existing current lines are reused exactly without admission or OCR", async () => {
  const evidence = { document: { id: doc }, fields: [], lines: [{ amount: "-12.50", evidence_stage: "retained_parse" }] };
  const f = fixture({ document: { id: doc } }, evidence);
  const result = await processFinancialEvidence(f.db, user, request, async () => true, f.admit);
  assert.equal(result.body.processing_status, "needs_review"); assert.equal(result.body.data, evidence);
  assert.equal(result.body.retained_evidence_reused, true); assert.equal(f.admissions.length, 0);
  assert.deepEqual(f.calls[1].args, { p_owner_id: user, p_document_id: doc });
});
Deno.test("existing field-only extraction is retained; custody and redaction alone remain blocked", async () => {
  for (const field of ["total", "capture_status", "redacted_source"]) {
    const f = fixture({ document: { id: doc } }, { fields: [{ field_key: field }], lines: [] });
    const result = await processFinancialEvidence(f.db, user, { mode: request.mode, action: "process", document_id: doc }, async () => true, f.admit);
    assert.equal(result.body.processing_status, field === "total" ? "needs_review" : "blocked");
    assert.equal(f.admissions.length, 0);
  }
});
Deno.test("unknown or foreign document does not fall back to upload or provider", async () => {
  const f = fixture(); const result = await processFinancialEvidence(f.db, user,
    { mode: request.mode, action: "process", document_id: doc }, async () => true, f.admit);
  assert.equal(result.status, 404); assert.equal(f.admissions.length, 0);
});
Deno.test("rejects owner overrides, supplied revisions, mixed selectors and foreign paths before access", async () => {
  for (const input of [{ ...request, owner_id: user }, { ...request, revision: {} }, { ...request, document_id: doc },
    { ...request, original: { ...original, storage_path: "someone-else/receipt.jpg" } },
    { ...request, original: { ...original, storage_path: `${user}/../receipt.jpg` } }, { ...request, paid: true }]) {
    const f = fixture(); assert.equal((await processFinancialEvidence(f.db, user, input, async () => true, f.admit)).status, 400);
    assert.equal(f.calls.length, 0); assert.equal(f.admissions.length, 0);
  }
});
Deno.test("revoked account cannot read, capture, or receive retained content", async () => {
  const f = fixture(); assert.equal((await processFinancialEvidence(f.db, user, request, async () => false, f.admit)).status, 403);
  assert.equal(f.calls.length, 0);
  const g = fixture({ document: { id: doc } }, { fields: [{ field_key: "total" }], lines: [] });
  let checks = 0;
  const result = await processFinancialEvidence(g.db, user, request, async () => ++checks === 1, g.admit);
  assert.equal(result.status, 403); assert.equal(result.body.data, undefined); assert.equal(g.admissions.length, 0);
});
Deno.test("unavailable retained reader fails closed without treating failure as missing evidence", async () => {
  const f = fixture(); f.db.rpc = async () => ({ data: null, error: "offline" });
  assert.equal((await processFinancialEvidence(f.db, user, request, async () => true, f.admit)).status, 503);
  assert.equal(f.admissions.length, 0);
});
Deno.test("custody hash refusal propagates and is never represented as captured", async () => {
  const f = fixture(); const refused = { status: 409, body: { error: "Original hash mismatch" } };
  assert.deepEqual(await processFinancialEvidence(f.db, user, request, async () => true, async () => refused), refused);
});
