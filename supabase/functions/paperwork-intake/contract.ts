// The paperwork-intake request contract, kept pure so it is testable without a database.
// The phone (apps/nuke-capture-ios/Sources/NukeCapture/Paperwork/PaperworkRules.swift,
// PaperworkPagePayload) sends one page per call.

export const BUCKET = "deal-documents";
export const MAX_BYTES = 15 * 1024 * 1024; // the bucket's file_size_limit (15728640)
export const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/heic"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface BatchEvidence {
  source: "label_card";
  label_page_id: string;
  label_document_id: string;
  box?: string | null;
  vehicle_hint?: string | null;
  year_hint?: number | null;
  confidence: number;
  label_text: string;
  strength: "soft";
}

export interface PagePayload {
  client_page_id: string;
  document_id: string;
  page_index: number;
  page_count: number;
  scanned_at: string;
  is_document: true;
  is_label_card: boolean;
  ocr_text: string;
  ocr_engine?: string;
  document_date_hint?: string | null;
  document_date_hint_text?: string | null;
  document_date_hint_confidence?: number | null;
  batch?: BatchEvidence | null;
  content_type: string;
  image_base64: string;
}

export function validate(body: unknown): { ok: true; page: PagePayload } | { ok: false; error: string } {
  const b = body as Partial<PagePayload> | null;
  if (!b || typeof b !== "object") return { ok: false, error: "body must be a JSON object" };
  if (!UUID.test(b.client_page_id ?? "")) return { ok: false, error: "client_page_id must be a uuid" };
  if (!UUID.test(b.document_id ?? "")) return { ok: false, error: "document_id must be a uuid" };
  if (!Number.isInteger(b.page_index) || !Number.isInteger(b.page_count) || b.page_index! < 0 || b.page_index! >= b.page_count!) {
    return { ok: false, error: "page_index/page_count out of range" };
  }
  if (b.is_document !== true) return { ok: false, error: "is_document must be true" };
  if (!b.scanned_at || Number.isNaN(Date.parse(b.scanned_at))) return { ok: false, error: "scanned_at must be ISO-8601" };
  if (!ALLOWED_TYPES.includes(b.content_type ?? "")) return { ok: false, error: "unsupported content_type" };
  if (typeof b.image_base64 !== "string" || b.image_base64.length === 0) return { ok: false, error: "image_base64 required" };
  if (b.document_date_hint != null && !DAY.test(b.document_date_hint)) return { ok: false, error: "document_date_hint must be yyyy-mm-dd" };
  if (b.batch) {
    const e = b.batch;
    if (e.strength !== "soft" || e.source !== "label_card") return { ok: false, error: "batch must be soft label_card evidence" };
    if (!UUID.test(e.label_page_id ?? "") || !UUID.test(e.label_document_id ?? "")) return { ok: false, error: "batch must cite the label page" };
    if (typeof e.confidence !== "number" || e.confidence < 0 || e.confidence > 1) return { ok: false, error: "batch confidence 0..1" };
  }
  return { ok: true, page: b as PagePayload };
}

/** documents/YYYY/MM/DD/paperwork_<document>_p<NNN>_<page>.jpg — the worker's existing relative-path convention. */
export function storagePath(page: PagePayload, receivedAt: Date): string {
  const d = receivedAt.toISOString().slice(0, 10).replaceAll("-", "/");
  const ext = page.content_type === "image/png" ? "png" : page.content_type === "image/heic" ? "heic" : "jpg";
  const n = String(page.page_index + 1).padStart(3, "0");
  return `documents/${d}/paperwork_${page.document_id}_p${n}_${page.client_page_id}.${ext}`;
}

/** The document_ocr_queue row document-ocr-worker drains (status pending; everything else defaults). */
export function queueRow(path: string) {
  return { storage_path: path, status: "pending", priority: 0 };
}

/** The paperwork_page_evidence row: scan time, on-device hints and the soft cited batch. */
export function evidenceRow(page: PagePayload, path: string, queueId: string, userId: string | null) {
  return {
    client_page_id: page.client_page_id,
    document_id: page.document_id,
    page_index: page.page_index,
    page_count: page.page_count,
    storage_path: path,
    document_ocr_queue_id: queueId,
    uploaded_by: userId,
    scanned_at: page.scanned_at,
    is_document: true,
    is_label_card: page.is_label_card,
    ocr_text: page.ocr_text ?? "",
    ocr_engine: page.ocr_engine ?? null,
    document_date_hint: page.document_date_hint ?? null,
    document_date_hint_text: page.document_date_hint_text ?? null,
    document_date_hint_confidence: page.document_date_hint_confidence ?? null,
    batch_evidence: page.batch ?? null,
  };
}

export function decodeBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
