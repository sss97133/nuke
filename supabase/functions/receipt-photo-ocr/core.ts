// receipt-photo-ocr: the photo pipeline's document route.
//
// The orchestrator sends every frame it classifies as receipt_document here (photo-pipeline-orchestrator, routeByType).
// Until 2026-11-08 this function did not exist and every such frame failed with 404: the classifier's fields sat in
// ai_scan_metadata and no record was made (299 frames of one account since 2026-11-03). This module is the pure logic; index.ts
// wires it to Supabase. Nothing here invents a writer:
//   1. the document is read by document-ocr-worker (classify, then extract by type);
//   2. the frame's bytes are copied into the private user-documents bucket under the owner (a document never stays only
//      in a public photo bucket);
//   3. one capture_document_pages row records the page: type, confidence, date, the sanitized extraction;
//   4. when the frame belongs to a vehicle and the document is a money record (receipt, invoice), it lands through
//      land_document_pages, the writer the binder used, which makes the vehicle_documents row, the receipts row, its
//      receipt_items and the vehicle link; then ingest-receipts-as-observations bridges it to the timeline.
// A frame with no vehicle keeps its page row and waits; a later vehicle attribution lands it with the same envelope.
// Privacy: card numbers, e-mail addresses and raw OCR text never reach the record (land_document_pages refuses them;
// sanitizeExtraction removes them first).

export interface FrameRow {
  id: string;
  user_id: string | null;
  vehicle_id: string | null;
  image_url: string | null;
  thumbnail_url?: string | null;
  file_name?: string | null;
  taken_at?: string | null;
  /** The pipeline classifier's own document type for this frame (ai_scan_metadata.classification.v2.document_type), when it has one. */
  doc_type_hint?: string | null;
}

export interface Classification {
  document_type: string;
  confidence: number; // 0..1 or 0..100; normalised by the caller
}

export type Extraction = Record<string, unknown>;

export interface ExistingPage {
  doc_type: string | null;
  extraction: Extraction | null;
  class_conf: number | null;
  doc_date: string | null;
  run_id: string | null;
  storage_path?: string | null;
}

export interface LandDocumentResult {
  landed: number;
  duplicates: number;
  errors: number;
  documents: Array<{ source_key?: string; receipt_id?: string | null; document_id?: string | null; duplicate?: boolean; error?: string; lines?: number }>;
}

export interface Deps {
  frame: (imageId: string) => Promise<FrameRow | null>;
  existingPage: (imageId: string) => Promise<ExistingPage | null>;
  classify: (url: string) => Promise<Classification>;
  extract: (url: string, docType: string) => Promise<Extraction>;
  fetchBytes: (url: string) => Promise<{ bytes: Uint8Array; contentType: string }>;
  fetchStoredBytes: (path: string) => Promise<Uint8Array>;
  upload: (path: string, bytes: Uint8Array, contentType: string) => Promise<{ error: string | null }>;
  upsertPage: (row: CapturePageRow) => Promise<{ error: string | null }>;
  land: (owner: string, vehicle: string, run: string, docs: LandEnvelope) => Promise<LandDocumentResult>;
  bridge: (receiptId: string) => Promise<void>;
  env: (name: string) => string | undefined;
  now: () => Date;
  runId: () => string;
  sha256: (bytes: Uint8Array) => Promise<string>;
}

export interface CapturePageRow {
  image_id: string;
  user_id: string;
  doc_key: string;
  page_no: number;
  is_label_card: boolean;
  doc_type: string;
  class_conf: number;
  classifier: string;
  doc_date: string | null;
  date_source: "ocr" | "none";
  date_text: string | null;
  extraction: Extraction;
  cost_usd: number | null;
  run_id: string;
}

export interface LandingDocument {
  source_key: string;
  doc_type: string;
  vendor: { name: string; address?: string; phone?: null };
  doc_number?: string;
  doc_date?: string;
  date_basis?: string;
  bill_to_name?: string;
  vehicle_noted?: string;
  pages: Array<{ sha256: string; storage_path: string; byte_size: string; page_no: string; role: string; source_filename: string }>;
  lines: Array<{ description: string; part_number?: string; quantity?: number; unit_price?: number; amount?: number }>;
  subtotal?: number;
  discount?: number;
  shipping?: number;
  tax?: number;
  total?: number;
  payment?: { method?: string; amount?: number; date?: string };
  confidence?: number;
  notes?: string;
  vehicle_context?: string;
}

export interface LandEnvelope {
  storage_base: string;
  method: string;
  model?: string;
  documents: LandingDocument[];
}

export interface RouteBody {
  image_id?: string;
  image_url?: string | null;
  vehicle_id?: string | null;
  user_id?: string | null;
  document_type_hint?: string | null;
  /** A reader that already read the page (the owner's subscription worker) hands its result here; no provider is called. */
  extraction?: Extraction | null;
  document_type?: string | null;
  confidence?: number | null;
  reader?: string | null;
}

export interface RouteResult {
  status: number;
  image_id?: string;
  document_type?: string;
  confidence?: number;
  page: boolean;
  landed: boolean;
  reason?: string;
  receipt_id?: string | null;
  document_id?: string | null;
  storage_path?: string;
  line_items_count: number;
  parts_found: number;
  extracted_fields?: Record<string, unknown>;
  run_id?: string;
  error?: string;
}

export const RUN = "capture-document-route";
export const METHOD = "capture_document_route_v1";
export const CLASSIFIER = "document-ocr-worker";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const LONG_DIGITS = /\d[\d -]{11,}\d/g; // 13+ digits, with or without spaces/dashes: card numbers, never kept
const DROP_KEYS = new Set(["ocr_text", "raw_text", "full_text", "full_ocr", "text"]);

/** The worker's document types that land_document_pages admits as money records. Others keep a page row only. */
export const LAND_TYPES = new Set(["receipt", "invoice", "work_order", "packing_slip", "order_confirmation", "alignment_report", "estimate", "statement"]);
export const MONEY_TYPES = new Set(["receipt", "invoice", "work_order", "estimate", "statement"]);

export function isUuid(s: unknown): s is string {
  return typeof s === "string" && UUID.test(s);
}

/** Strip what must never enter the record: e-mail addresses, card-length digit runs, raw OCR dumps. Bounded strings. */
export function sanitizeExtraction(value: unknown, depth = 0): unknown {
  if (depth > 6) return undefined;
  if (value == null) return value;
  if (typeof value === "string") {
    const s = value.replace(EMAIL, "[e-mail removed]").replace(LONG_DIGITS, (m) => (m.replace(/\D/g, "").length >= 13 ? "[number removed]" : m));
    return s.length > 500 ? s.slice(0, 500) : s;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => sanitizeExtraction(v, depth + 1)).filter((v) => v !== undefined);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (DROP_KEYS.has(k.toLowerCase())) continue;
      if (k.startsWith("_")) continue; // the worker's own bookkeeping (_provider, _cost_usd, ...)
      const sv = sanitizeExtraction(v, depth + 1);
      if (sv !== undefined) out[k] = sv;
    }
    return out;
  }
  return undefined;
}

export function normaliseConfidence(c: unknown): number {
  const n = typeof c === "number" ? c : Number(c);
  if (!Number.isFinite(n) || n < 0) return 0;
  const v = n > 1 ? n / 100 : n;
  return Math.max(0, Math.min(1, Math.round(v * 1000) / 1000));
}

export function parseIsoDate(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim().slice(0, 10);
  if (!ISO_DATE.test(s)) return undefined;
  const d = new Date(s + "T00:00:00Z");
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return undefined;
  const y = Number(s.slice(0, 4));
  if (y < 1950 || y > 2100) return undefined;
  return s;
}

export function money(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || Math.abs(n) > 999_999_999) return undefined;
  return Math.round(n * 100) / 100;
}

/** Card brand or payment kind only; never digits. */
export function brandOnly(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.toLowerCase();
  const brands: Array<[RegExp, string]> = [
    [/american\s*express|amex/, "Amex"], [/master\s*card/, "Mastercard"], [/visa/, "Visa"], [/discover/, "Discover"],
    [/apple\s*cash/, "Apple Cash"], [/apple\s*pay/, "Apple Pay"], [/debit/, "Debit"], [/credit/, "Credit card"],
    [/cash/, "Cash"], [/check|cheque/, "Check"], [/zelle/, "Zelle"], [/venmo/, "Venmo"], [/paypal/, "PayPal"], [/wire/, "Wire"],
  ];
  for (const [re, name] of brands) if (re.test(s)) return name;
  return undefined;
}

/** The land_document_pages doc_type for a worker document type and its fields. */
export function landType(docType: string, data: Extraction): string {
  const t = (docType || "other").toLowerCase();
  if (t === "receipt") return data.invoice_number && !data.receipt_number ? "invoice" : "receipt";
  if (t === "shipping_bill") return "packing_slip";
  if (LAND_TYPES.has(t)) return t;
  return "other";
}

export function extFor(contentType: string, fileName?: string | null): string {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("heic") || ct.includes("heif")) return "heic";
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  const m = (fileName || "").toLowerCase().match(/\.(heic|heif|png|webp|gif|jpe?g)$/);
  if (m) return m[1] === "jpeg" ? "jpg" : m[1] === "heif" ? "heic" : m[1];
  return "jpg";
}

export function mimeFor(ext: string): string {
  return ext === "heic" ? "image/heic" : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : "image/jpeg";
}

export function pagePath(userId: string, imageId: string, ext: string): string {
  return `${userId}/capture/${imageId}.${ext}`;
}

function str(v: unknown, max: number): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s ? s.slice(0, max) : undefined;
}

/** One landing document from a sanitized extraction and the page already copied to user-documents. */
export function toLandingDocument(
  frame: FrameRow,
  docType: string,
  data: Extraction,
  confidence: number,
  page: { sha256: string; storage_path: string; byte_size: number },
  reviewReasons: string[] = [],
): LandingDocument {
  const lt = landType(docType, data);
  const items = Array.isArray(data.line_items) ? (data.line_items as unknown[]) : [];
  const lines = items.slice(0, 200).map((raw) => {
    const l = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const o: LandingDocument["lines"][number] = { description: str(l.description, 500) || "line" };
    const pn = str(l.part_number ?? l.sku ?? l.part, 100);
    if (pn) o.part_number = pn;
    const q = money(l.quantity ?? l.qty);
    if (q !== undefined) o.quantity = q;
    const u = money(l.unit_price);
    if (u !== undefined) o.unit_price = u;
    const a = money(l.amount ?? l.total ?? l.ext_price);
    if (a !== undefined) o.amount = a;
    return o;
  });
  const date = parseIsoDate(data.date ?? data.receipt_date ?? data.invoice_date ?? data.transaction_date);
  const vehicleNoted = [data.year, data.make, data.model].filter((x) => x != null && x !== "").join(" ").trim() || (typeof data.vin === "string" ? `VIN ${data.vin}` : "");
  const d: LandingDocument = {
    source_key: `capture:${frame.id}`,
    doc_type: lt,
    vendor: { name: str(data.vendor_name ?? data.vendor ?? data.store_name ?? data.auction_house, 200) || "Unknown vendor" },
    pages: [{ sha256: page.sha256, storage_path: page.storage_path, byte_size: String(page.byte_size), page_no: "1", role: "page", source_filename: str(frame.file_name, 120) || `${frame.id}.jpg` }],
    lines,
    confidence,
    vehicle_context: `photographed on the phone${frame.taken_at ? ` ${String(frame.taken_at).slice(0, 10)}` : ""}; routed by the photo pipeline (capture_document_route_v1)`,
  };
  const addr = str(data.vendor_address, 300);
  if (addr) d.vendor.address = addr;
  const num = str(data.invoice_number ?? data.receipt_number ?? data.document_number ?? data.order_number, 80);
  if (num) d.doc_number = num;
  if (date) { d.doc_date = date; d.date_basis = "printed_document_date"; }
  const billTo = str(data.customer_name ?? data.sold_to ?? data.bill_to ?? data.buyer_name, 120);
  if (billTo) d.bill_to_name = billTo;
  if (vehicleNoted) d.vehicle_noted = vehicleNoted.slice(0, 200);
  for (const k of ["subtotal", "discount", "shipping", "tax", "total"] as const) {
    const v = money(data[k]);
    if (v !== undefined) d[k] = v;
  }
  const method = brandOnly(data.payment_method);
  if (method) d.payment = { method };
  if (reviewReasons.length) d.notes = reviewReasons.join("; ").slice(0, 1000);
  return d;
}

function extractedFields(docType: string, data: Extraction): Record<string, unknown> {
  const out: Record<string, unknown> = { document_type: docType };
  for (const k of ["vendor_name", "date", "total", "subtotal", "tax", "invoice_number", "receipt_number", "vin", "year", "make", "model"]) {
    if (data[k] != null && data[k] !== "") out[k] = data[k];
  }
  return out;
}

export async function handle(body: RouteBody, deps: Deps): Promise<RouteResult> {
  const imageId = body.image_id;
  if (!isUuid(imageId)) return { status: 400, page: false, landed: false, line_items_count: 0, parts_found: 0, error: "image_id (uuid) required" };
  const frame = await deps.frame(imageId);
  if (!frame) return { status: 404, image_id: imageId, page: false, landed: false, line_items_count: 0, parts_found: 0, error: "frame not found" };
  const userId = frame.user_id ?? (isUuid(body.user_id) ? body.user_id : null);
  if (!userId) return { status: 422, image_id: imageId, page: false, landed: false, line_items_count: 0, parts_found: 0, error: "frame has no owner" };
  const vehicleId = frame.vehicle_id ?? (isUuid(body.vehicle_id) ? body.vehicle_id : null);
  const url = frame.image_url || body.image_url || null;
  const base = deps.env("SUPABASE_URL") || "";

  // Already recorded and nothing new to do: a page with no vehicle waits for one.
  const existing = await deps.existingPage(imageId);
  const hasProvided = !!(body.extraction && typeof body.extraction === "object" && !Array.isArray(body.extraction));
  if (existing && !vehicleId && !hasProvided) {
    return {
      status: 200, image_id: imageId, document_type: existing.doc_type ?? undefined, confidence: existing.class_conf ?? undefined,
      page: true, landed: false, reason: "page already recorded; no vehicle to land on", line_items_count: lineCount(existing.extraction), parts_found: 0,
      run_id: existing.run_id ?? undefined,
    };
  }

  // A retained page is the original byte witness. Replay must not silently replace it with a later public object.
  const retained = existing?.extraction ?? {};
  const hasRetained = !!existing;
  if (hasRetained && (
    typeof retained.storage_path !== "string" ||
    !["heic", "jpg", "png", "webp", "gif"].some((ext) => retained.storage_path === pagePath(userId, imageId, ext)) ||
    typeof retained.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(retained.sha256) ||
    !Number.isSafeInteger(retained.byte_size) || Number(retained.byte_size) < 1 || Number(retained.byte_size) > 52_428_800
  )) {
    return { status: 409, image_id: imageId, page: true, landed: false, line_items_count: 0, parts_found: 0, error: "retained page metadata does not match this owner and image" };
  }
  if (existing && !hasProvided && !existing.doc_type) {
    return { status: 409, image_id: imageId, page: true, landed: false, line_items_count: 0, parts_found: 0, error: "retained document type missing; a reader result is required" };
  }
  if (!hasRetained && !url) return { status: 422, image_id: imageId, page: false, landed: false, line_items_count: 0, parts_found: 0, error: "frame has no image url" };

  // 1. Read the document.
  let docType: string;
  let confidence: number;
  let data: Extraction;
  let reviewReasons: string[] = [];
  let costUsd: number | null = null;
  const provided = body.extraction && typeof body.extraction === "object" && !Array.isArray(body.extraction) ? body.extraction : null;
  if (provided) {
    // A reader already read the page: the pipeline hint or the reader's type, the reader's confidence, its JSON sanitized.
    const t = typeof body.document_type === "string" && body.document_type ? body.document_type
      : typeof provided.document_type === "string" && provided.document_type ? String(provided.document_type)
      : typeof frame.doc_type_hint === "string" && frame.doc_type_hint ? frame.doc_type_hint : "other";
    docType = t.toLowerCase();
    confidence = normaliseConfidence(body.confidence ?? provided.confidence ?? 1);
    reviewReasons = Array.isArray(provided._review_reasons) ? (provided._review_reasons as unknown[]).map(String) : [];
    data = sanitizeExtraction(provided) as Extraction;
    if (typeof body.reader === "string" && body.reader) (data as Record<string, unknown>).reader = body.reader.slice(0, 80);
  } else if (existing?.extraction && existing.doc_type) {
    docType = existing.doc_type;
    confidence = existing.class_conf ?? 0;
    data = existing.extraction;
  } else {
    const hinted = typeof body.document_type_hint === "string" && body.document_type_hint ? body.document_type_hint
      : typeof frame.doc_type_hint === "string" && frame.doc_type_hint && frame.doc_type_hint !== "other" ? frame.doc_type_hint : null;
    if (!url) return { status: 422, image_id: imageId, page: !!existing, landed: false, line_items_count: 0, parts_found: 0, error: "frame has no image url for document read" };
    const cls = hinted ? { document_type: hinted, confidence: 1 } : await deps.classify(url);
    docType = (cls.document_type || "other").toLowerCase();
    confidence = normaliseConfidence(cls.confidence);
    const raw = await deps.extract(url, docType);
    reviewReasons = Array.isArray(raw._review_reasons) ? (raw._review_reasons as unknown[]).map(String) : [];
    costUsd = typeof raw._cost_usd === "number" ? raw._cost_usd : null;
    data = sanitizeExtraction(raw) as Extraction;
  }

  // 2. Verify the retained private bytes on replay; copy the source only on first admission.
  let bytes: Uint8Array;
  let storagePath: string;
  let sha256: string;
  if (hasRetained) {
    storagePath = retained.storage_path as string;
    try { bytes = await deps.fetchStoredBytes(storagePath); }
    catch (_e) {
      return { status: 502, image_id: imageId, page: true, landed: false, line_items_count: 0, parts_found: 0, error: "retained private page unavailable; retry without replacing the original" };
    }
    sha256 = await deps.sha256(bytes);
    if (bytes.byteLength !== retained.byte_size || sha256 !== retained.sha256) {
      return { status: 409, image_id: imageId, page: true, landed: false, line_items_count: 0, parts_found: 0, error: "retained private page integrity mismatch" };
    }
  } else {
    const source = await deps.fetchBytes(url!);
    bytes = source.bytes;
    const ext = extFor(source.contentType, frame.file_name);
    storagePath = pagePath(userId, imageId, ext);
    const up = await deps.upload(storagePath, bytes, mimeFor(ext));
    if (up.error) return { status: 502, image_id: imageId, page: false, landed: false, line_items_count: 0, parts_found: 0, error: `upload failed: ${up.error}` };
    sha256 = await deps.sha256(bytes);
  }

  // 3. The page row.
  const runId = existing?.run_id ?? deps.runId();
  const docDate = parseIsoDate(data.date ?? data.receipt_date ?? data.invoice_date ?? data.transaction_date) ?? null;
  const row: CapturePageRow = {
    image_id: imageId, user_id: userId, doc_key: `capture:${imageId}`, page_no: 1, is_label_card: false,
    doc_type: docType, class_conf: confidence, classifier: CLASSIFIER,
    doc_date: docDate, date_source: docDate ? "ocr" : "none", date_text: docDate ? String(data.date ?? data.receipt_date ?? data.invoice_date ?? data.transaction_date).slice(0, 40) : null,
    extraction: { ...data, storage_path: storagePath, sha256, byte_size: bytes.byteLength, landed_type: landType(docType, data) },
    cost_usd: costUsd ?? 0, run_id: runId, // the column is NOT NULL; a subscription read costs the platform nothing
  };
  const pg = await deps.upsertPage(row);
  if (pg.error) return { status: 502, image_id: imageId, page: false, landed: false, line_items_count: 0, parts_found: 0, error: `page row failed: ${pg.error}` };

  const lt = landType(docType, data);
  const fields = extractedFields(docType, data);
  const n = lineCount(data);

  // 4. Land it on the vehicle when there is one and it is a money record.
  if (!vehicleId) {
    return { status: 200, image_id: imageId, document_type: docType, confidence, page: true, landed: false, reason: "no vehicle on the frame; page recorded, waiting", storage_path: storagePath, line_items_count: n, parts_found: 0, extracted_fields: fields, run_id: runId };
  }
  // A page the route has placed (as a receipt, or recorded as a vehicle document on a frame that holds a vehicle) carries
  // extraction.landed, so capture_document_pages_to_land stops listing it.
  const markLanded = async (landed: Record<string, unknown>): Promise<void> => {
    await deps.upsertPage({ ...row, extraction: { ...row.extraction, landed: { ...landed, at: deps.now().toISOString() } } });
  };
  if (!MONEY_TYPES.has(lt) && lt !== "packing_slip" && lt !== "order_confirmation" && lt !== "alignment_report") {
    await markLanded({ as: "vehicle_document", vehicle_id: vehicleId });
    return { status: 200, image_id: imageId, document_type: docType, confidence, page: true, landed: false, reason: `a ${docType} is a vehicle document, not a receipt; page recorded`, storage_path: storagePath, line_items_count: n, parts_found: 0, extracted_fields: fields, run_id: runId };
  }
  const doc = toLandingDocument(frame, docType, data, confidence, { sha256, storage_path: storagePath, byte_size: bytes.byteLength }, reviewReasons);
  const envelope: LandEnvelope = { storage_base: base, method: METHOD, documents: [doc] };
  const model = typeof (data as Record<string, unknown>)._model === "string" ? String((data as Record<string, unknown>)._model) : undefined;
  if (model) envelope.model = model;
  const res = await deps.land(userId, vehicleId, RUN, envelope);
  const d0 = res.documents?.[0];
  if (!d0 || d0.error) {
    return { status: 200, image_id: imageId, document_type: docType, confidence, page: true, landed: false, reason: `land_document_pages: ${d0?.error ?? "no result"}`, storage_path: storagePath, line_items_count: n, parts_found: 0, extracted_fields: fields, run_id: runId };
  }
  if (d0.receipt_id && !d0.duplicate) {
    try { await deps.bridge(d0.receipt_id); } catch (_e) { /* the bridge runs again on its own; the receipt exists */ }
  }
  await markLanded({ as: "receipt", vehicle_id: vehicleId, receipt_id: d0.receipt_id ?? null, document_id: d0.document_id ?? null, duplicate: !!d0.duplicate });
  return {
    status: 200, image_id: imageId, document_type: docType, confidence, page: true, landed: true, reason: d0.duplicate ? "already landed" : undefined,
    receipt_id: d0.receipt_id ?? null, document_id: d0.document_id ?? null, storage_path: storagePath, line_items_count: n, parts_found: 0, extracted_fields: fields, run_id: runId,
  };
}

function lineCount(data: Extraction | null): number {
  return data && Array.isArray(data.line_items) ? (data.line_items as unknown[]).length : 0;
}
