/** Retained-first processing for the authenticated account's private originals.
 * No OCR, provider fallback, queue write, expense recognition or paid operation.
 * The caller derives userId from normal account authentication and injects the
 * existing hash-verifying sanctioned admission helper (never a raw table write).
 */
type Result = { status: number; body: Record<string, unknown> };
type Db = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
type Admit = (input: Record<string, unknown>) => Promise<Result>;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const sha = /^[a-f0-9]{64}$/;
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const unavailable = (): Result => ({ status: 503, body: { error: "Retained financial evidence unavailable" } });
const denied = (): Result => ({ status: 403, body: { error: "Account authorization no longer active" } });
const blocked = (documentId: string, reused: boolean): Result => ({ status: 200, body: {
  document_id: documentId, processing_status: "blocked", reason: "ocr_entitlement_unavailable",
  message: "Original saved. Automatic extraction is not enabled for this processing path.",
  retained_evidence_reused: reused, original_retained: true, paid_inference_started: false,
  expense_posted: false, tax_ready: false,
} });

export async function processFinancialEvidence(
  db: Db, userId: string, input: unknown, stillAuthorized: () => Promise<boolean>, admit: Admit,
): Promise<Result> {
  if (!uuid.test(userId) || !object(input) || input.mode !== "financial_evidence_v1" || input.action !== "process" ||
      Object.keys(input).some(k => !["mode", "action", "original", "document_id"].includes(k)) ||
      (input.original !== undefined) === (input.document_id !== undefined))
    return { status: 400, body: { error: "Expected one private original or document selector" } };
  const original = input.original;
  if (input.document_id !== undefined && (typeof input.document_id !== "string" || !uuid.test(input.document_id)))
    return { status: 400, body: { error: "Invalid document selector" } };
  if (original !== undefined && (!object(original) ||
      Object.keys(original).some(k => !["sha256", "storage_path", "source_filename", "source_kind"].includes(k)) ||
      typeof original.sha256 !== "string" || !sha.test(original.sha256) ||
      typeof original.storage_path !== "string" || !original.storage_path.startsWith(`${userId}/`) ||
      original.storage_path.includes("..") || original.storage_path.includes("\\") ||
      !/\.(pdf|png|jpe?g|webp|heic|csv|numbers)$/i.test(original.storage_path)))
    return { status: 400, body: { error: "Invalid private original reference" } };
  if (!await stillAuthorized()) return denied();
  const retained = await db.rpc("read_financial_evidence", { p_owner_id: userId,
    p_document_id: input.document_id ?? null, p_sha256: object(original) ? original.sha256 : null });
  if (retained.error) return unavailable();
  if (retained.data !== null) {
    if (!object(retained.data) || !object(retained.data.document) ||
        typeof retained.data.document.id !== "string" || !uuid.test(retained.data.document.id)) return unavailable();
    const documentId = retained.data.document.id;
    const accounting = await db.rpc("read_financial_accounting", { p_owner_id: userId, p_document_id: documentId });
    if (accounting.error || !object(accounting.data) || !Array.isArray(accounting.data.fields) || !Array.isArray(accounting.data.lines)) return unavailable();
    if (!await stillAuthorized()) return denied();
    // Custody and display review are not extracted accounting content. Reuse
    // current cells/lines exactly; do not re-admit, reinterpret or erase them.
    const substantiveFields = accounting.data.fields.filter(f => object(f) &&
      !["capture_status", "redacted_source"].includes(String(f.field_key)));
    if (!substantiveFields.length && !accounting.data.lines.length) return blocked(documentId, true);
    return { status: 200, body: { document_id: documentId, processing_status: "needs_review",
      retained_evidence_reused: true, original_retained: true, paid_inference_started: false,
      expense_posted: false, tax_ready: false, data: accounting.data,
      message: "Retained evidence is available for reconciliation and review." } };
  }
  if (!object(original)) return { status: 404, body: { error: "Financial document not found" } };
  if (!await stillAuthorized()) return denied();
  const admitted = await admit({ mode: "financial_evidence_v1", action: "submit", original,
    revision: { idempotency_key: `capture:v1:${original.sha256}`, method: "authenticated_original_capture", version: "1",
      fields: [{ field_key: "capture_status", value_raw: "Private original captured; extraction pending",
        value_type: "event", value_normalized: { processing_status: "blocked", reason: "ocr_entitlement_unavailable" },
        evidence: { stage: "original_capture_only", source_sha256: original.sha256,
          method: "authenticated_original_capture", extraction_performed: false } }] } });
  if (admitted.status !== 200) return admitted;
  if (!object(admitted.body.data) || typeof admitted.body.data.document_id !== "string" || !uuid.test(admitted.body.data.document_id)) return unavailable();
  if (!await stillAuthorized()) return denied();
  return blocked(admitted.body.data.document_id, false);
}
