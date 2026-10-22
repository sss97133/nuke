import { financialCandidateContext } from "./financialCandidateContext.ts";
import { processFinancialEvidence } from "./financialProcessing.ts";
/** Private original custody + attributed financial cells; never an expense posting. */
export const FINANCIAL_EVIDENCE_MODE = "financial_evidence_v1";
type Client = { storage: { getBucket(bucket: string): Promise<{ data: { public: boolean } | null; error: unknown }>; from(bucket: string): { download(path: string): Promise<{ data: Blob | null; error: unknown }> } }; rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
export function financialActor(caller: { kind: string; userId?: string | null; scopes?: string[] }, action: string): string | null {
  if (!["user", "api_key"].includes(caller.kind) || !caller.userId) return null;
  if (caller.kind === "api_key" && !caller.scopes?.includes(["read", "tax_read"].includes(action) ? "read" : "write")) return null;
  return caller.userId;
}
export async function ingestFinancialEvidence(db: Client, userId: string, input: unknown, stillAuthorized: () => Promise<boolean>, actorContext: { kind: string; agent_id?: string | null } = { kind: "user" }): Promise<{ status: number; body: Record<string, unknown> }> {
  const body = input as Record<string, any>;
  if (body?.action === "process") {
    const processed = await processFinancialEvidence(db, userId, input, stillAuthorized,
      original => ingestFinancialEvidence(db, userId, original, stillAuthorized, actorContext));
    if (processed.status === 200 && processed.body.data) {
      processed.body.data = await withContext(db, userId, processed.body.data);
      if (!await stillAuthorized()) return { status: 403, body: { error: "Account authorization no longer active" } };
    }
    return processed;
  }
  if (body && typeof body === "object" && !Array.isArray(body) && body.action === "tax_read") {
    if (Object.keys(body).some(k => !["mode", "action", "after", "limit"].includes(k)) ||
        (body.after !== undefined && !uuid(body.after)) ||
        (body.limit !== undefined && (!Number.isInteger(body.limit) || body.limit < 1 || body.limit > 500)))
      return { status: 400, body: { error: "Invalid workpaper page" } };
    const read = await db.rpc("read_financial_tax_workpapers", { p_owner_id: userId, p_after: body.after ?? null, p_limit: body.limit ?? 500 });
    return read.error ? { status: 503, body: { error: "Workpaper read unavailable" } } : { status: 200, body: { data: read.data } };
  }
  if (body && typeof body === "object" && !Array.isArray(body) && body.action === "review_source") {
    if (Object.keys(body).some(k => !["mode", "action", "document_id", "source"].includes(k)) || !uuid(body.document_id))
      return { status: 400, body: { error: "Expected owned document and reviewed derivative" } };
    const source = body.source;
    if (!source || typeof source !== "object" || Array.isArray(source) ||
        !/^[a-f0-9]{64}$/.test(source.source_sha256) || !/^[a-f0-9]{64}$/.test(source.derivative_sha256) ||
        source.bucket !== "user-documents" || source.mime_type !== "image/png" ||
        source.verification?.reviewer !== userId || typeof source.verification?.reviewed_at !== "string" ||
        !Number.isFinite(Date.parse(source.verification.reviewed_at)) ||
        source.storage_path !== `${userId}/redacted/${source.source_sha256}/${source.derivative_sha256}.png`)
      return { status: 400, body: { error: "Invalid private derivative" } };
    const read = await db.rpc("read_financial_evidence", { p_owner_id: userId, p_document_id: body.document_id, p_sha256: null });
    const document = (read.data as any)?.document;
    if (read.error || !document || document.content_sha256 !== source.source_sha256)
      return { status: 409, body: { error: "Original source unavailable" } };
    const bucket = await db.storage.getBucket("user-documents");
    if (bucket.error || bucket.data?.public !== false) return { status: 409, body: { error: "Private evidence storage unavailable" } };
    const held = await db.storage.from("user-documents").download(source.storage_path);
    if (held.error || !held.data || held.data.size < 1 || held.data.size > 10485760)
      return { status: 409, body: { error: "Derivative unavailable" } };
    const bytes = new Uint8Array(await held.data.arrayBuffer());
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
    if (digest !== source.derivative_sha256 || !cleanPng(bytes, source.width, source.height) || !await validPngPixels(bytes, source.width, source.height))
      return { status: 409, body: { error: "Derivative integrity or metadata check failed" } };
    if (!await stillAuthorized()) return { status: 403, body: { error: "Account authorization no longer active" } };
    // Pixel masking/visual review remain attributed human testimony, not a server certification.
    const result = await db.rpc("record_financial_source_review", { p_owner_id: userId, p_document_id: body.document_id,
      p_source: source, p_actor_context: actorContext });
    return result.error ? { status: 409, body: { error: "Source review admission refused" } }
      : { status: 200, body: { data: result.data, expense_posted: false } };
  }
  if (body && typeof body === "object" && !Array.isArray(body) && body.action === "read") {
    if (Object.keys(body).some(k => !["mode", "action", "document_id", "original_sha256", "include_context"].includes(k)) ||
        (body.include_context !== undefined && typeof body.include_context !== "boolean") ||
        Boolean(body.document_id) === Boolean(body.original_sha256) ||
        (body.document_id && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.document_id)) ||
        (body.original_sha256 && !/^[a-f0-9]{64}$/.test(body.original_sha256)))
      return { status: 400, body: { error: "Expected one original selector" } };
    const read = await db.rpc("read_financial_evidence", { p_owner_id: userId,
      p_document_id: body.document_id ?? null, p_sha256: body.original_sha256 ?? null });
    if (!read.error && (read.data as any)?.document?.id) {
      const accounting = await db.rpc("read_financial_accounting", { p_owner_id: userId, p_document_id: (read.data as any).document.id });
      return accounting.error ? { status: 503, body: { error: "Accounting evidence read unavailable" } }
        : { status: 200, body: { data: body.include_context === false ? accounting.data : await withContext(db, userId, accounting.data) } };
    }
    return read.error ? { status: 503, body: { error: "Financial evidence read unavailable" } }
      : { status: 200, body: { data: read.data } };
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(k => !["mode", "action", "original", "revision"].includes(k)))
    return { status: 400, body: { error: "Only original and attributed revision are accepted" } };
  if (body.action !== undefined && body.action !== "submit") return { status: 400, body: { error: "Unknown financial evidence action" } };
  const original = body.original;
  if (!original || typeof original !== "object" || Array.isArray(original) ||
      Object.keys(original).some(k => !["sha256", "storage_path", "source_filename", "source_kind"].includes(k)) ||
      !/\.(pdf|png|jpe?g|webp|heic|csv|numbers)$/i.test(original.storage_path ?? "") ||
      typeof original.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(original.sha256) ||
      typeof original.storage_path !== "string" || !original.storage_path.startsWith(`${userId}/`) ||
      original.storage_path.includes("..") || original.storage_path.includes("\\") ||
      JSON.stringify(body).length > 250000)
    return { status: 400, body: { error: "Invalid private original reference" } };
  const bucket = await db.storage.getBucket("user-documents");
  if (bucket.error || !bucket.data || bucket.data.public !== false)
    return { status: 409, body: { error: "Private evidence storage unavailable" } };
  const held = await db.storage.from("user-documents").download(original.storage_path);
  if (held.error || !held.data) return { status: 409, body: { error: "Original unavailable" } };
  if (held.data.size < 1 || held.data.size > 10485760)
    return { status: 400, body: { error: "Original must be between 1 byte and 10 MiB" } };
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await held.data.arrayBuffer())))
    .map(b => b.toString(16).padStart(2, "0")).join("");
  if (digest !== original.sha256) return { status: 409, body: { error: "Original hash mismatch" } };
  if (!await stillAuthorized()) return { status: 403, body: { error: "Account authorization no longer active" } };
  const result = await db.rpc("ingest_financial_evidence", {
    p_owner_id: userId, p_actor_context: actorContext, p_original: { ...original, byte_size: held.data.size }, p_revision: body.revision,
  });
  if (result.error) return { status: 409, body: { error: "Financial evidence admission refused" } };
  return { status: 200, body: { data: result.data, expense_posted: false } };
}

function uuid(value: unknown): boolean {
  return typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
}
/** Accept only metadata-free RGB PNG with bounded dimensions and valid CRCs. */
export function cleanPng(bytes: Uint8Array, width: unknown, height: unknown): boolean {
  if (bytes.length < 45 || ![137,80,78,71,13,10,26,10].every((b,i) => bytes[i] === b)) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8, header = false, data = false;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset), end = offset + 12 + length;
    if (end > bytes.length) return false;
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    let crc = 0xffffffff;
    for (let i = offset + 4; i < end - 4; i++) {
      crc ^= bytes[i];
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    if (((crc ^ 0xffffffff) >>> 0) !== view.getUint32(end - 4)) return false;
    if (type === "IHDR") {
      if (header || offset !== 8 || length !== 13) return false;
      const w = view.getUint32(offset + 8), h = view.getUint32(offset + 12);
      if (w !== width || h !== height || w < 1 || h < 1 || w*h > 40000000 ||
          bytes[offset+16] !== 8 || bytes[offset+17] !== 2 ||
          bytes[offset+18] !== 0 || bytes[offset+19] !== 0 || bytes[offset+20] !== 0) return false;
      header = true;
    } else if (type === "IDAT") { if (!header) return false; data = true; }
    else if (type === "IEND") return header && data && length === 0 && end === bytes.length;
    else return false;
    offset = end;
  }
  return false;
}

async function withContext(db: Client, owner: string, data: unknown) {
  try { return { ...(data as Record<string, unknown>), context: await financialCandidateContext(db, owner, data) }; }
  catch { return { ...(data as Record<string, unknown>), context: { status: "missing", missing: ["accounting_context_unavailable"],
    source_population_complete: false, expense_posted: false, evidence_stage: "computed_candidate_not_owner_decision" } }; }
}

/** Stream-decode a validated RGB PNG, rejecting malformed/oversized raster data. */
async function validPngPixels(bytes: Uint8Array, width: number, height: number): Promise<boolean> {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), parts: ArrayBuffer[] = [];
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = view.getUint32(offset);
      if (String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) === "IDAT") parts.push(new Uint8Array(bytes.subarray(offset + 8, offset + 8 + length)).buffer);
      offset += length + 12;
    }
    const reader = new Blob(parts).stream().pipeThrough(new DecompressionStream("deflate")).getReader();
    const stride = width * 3 + 1, expected = stride * height;
    let size = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) return size === expected;
      if (size + next.value.length > expected) { await reader.cancel(); return false; }
      for (let i = (stride - size % stride) % stride; i < next.value.length; i += stride) {
        if (next.value[i] > 4) { await reader.cancel(); return false; }
      }
      size += next.value.length;
    }
  } catch { return false; }
}
