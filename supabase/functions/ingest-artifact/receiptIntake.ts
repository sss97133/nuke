// Private receipt evidence. No model inference, expense posting or vehicle binding.
import { authenticateWriter } from "../_shared/writeGuard.ts";
import { projectSecretKey } from "../_shared/supabaseKeys.ts";

export const RECEIPT_MODE = "receipt_intake_v1";
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const MAX_FILE = 10 * 1024 * 1024;
const MIME: Record<string, string> = { "image/jpeg": "jpeg", "image/png": "png", "application/pdf": "pdf" };
const HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-api-key" };
// SDK is injected by the existing dispatcher; helpers can be tested without network.
// deno-lint-ignore no-explicit-any
type Client = any;
export const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });
export class ReceiptRefusal extends Error { constructor(message: string, public status = 400) { super(message); } }
export async function sha256(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)), x => x.toString(16).padStart(2, "0")).join("");
}
export function originalPath(owner: string, original: Record<string, unknown>): string {
  if (!UUID.test(owner) || typeof original.sha256 !== "string" || !HASH.test(original.sha256) ||
      typeof original.mime_type !== "string" || !MIME[original.mime_type] ||
      typeof original.filename !== "string" || !original.filename.trim() || original.filename.length > 255)
    throw new ReceiptRefusal("Original requires SHA-256, filename and JPEG/PNG/PDF MIME type");
  const path = `${owner}/receipt-originals/sha256/${original.sha256}.${MIME[original.mime_type]}`;
  if (original.storage_path !== undefined && original.storage_path !== path) throw new ReceiptRefusal("Original path does not match owner and hash", 403);
  return path;
}
export function validateExtraction(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ReceiptRefusal("extraction must be an object");
  const x = value as Record<string, unknown>;
  if (typeof x.method !== "string" || !x.method.trim() || typeof x.version !== "string" || !x.version.trim() ||
      typeof x.raw_text !== "string" || x.raw_text.length > 100000 || !x.fields || typeof x.fields !== "object" || Array.isArray(x.fields))
    throw new ReceiptRefusal("Extraction requires method, version, full raw_text and fields");
  if (JSON.stringify(x).length > 500000) throw new ReceiptRefusal("Extraction exceeds 500KB");
  const cells = Object.values(x.fields as Record<string, unknown>);
  if (x.items !== undefined) {
    if (!Array.isArray(x.items) || x.items.length > 1000) throw new ReceiptRefusal("items must be an array of at most 1000 rows");
    for (const item of x.items) {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new ReceiptRefusal("Each item must contain field cells");
      cells.push(...Object.values(item));
    }
  }
  for (const cell of cells) {
    if (!cell || typeof cell !== "object" || Array.isArray(cell) || !("value" in cell)) throw new ReceiptRefusal("Each field requires {value, evidence}");
    const c = cell as Record<string, unknown>;
    if (c.value !== null && (typeof c.evidence !== "string" || !c.evidence.trim())) throw new ReceiptRefusal("Non-null field values require source evidence");
  }
  return x;
}
async function checkAccess(sb: Client, keyId: string | null, userId: string, owner: string, org: string, operation: string) {
  const { data, error } = await sb.rpc("check_receipt_intake_access", { p_key_id: keyId, p_user_id: userId,
    p_owner_user_id: owner, p_organization_id: org, p_operation: operation });
  if (error || data?.allowed !== true) throw new ReceiptRefusal("Your account lacks accounting access to this organization and owner", 403);
  return data;
}
export async function verifiedOriginal(sb: Client, owner: string, original: Record<string, unknown>) {
  const path = originalPath(owner, original);
  const { data: bucket, error: bucketError } = await sb.storage.getBucket("user-documents");
  if (bucketError || bucket?.public !== false) throw new ReceiptRefusal("Private original storage unavailable", 503);
  const { data, error } = await sb.storage.from("user-documents").download(path);
  if (error || !data) throw new ReceiptRefusal("Upload the original before submitting extraction", 409);
  if (data.size < 1 || data.size > MAX_FILE) throw new ReceiptRefusal("Original outside 1 byte–10MB limit");
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (await sha256(bytes) !== original.sha256) throw new ReceiptRefusal("Original SHA-256 mismatch", 409);
  return { ...original, storage_path: path, file_size: bytes.length, bucket: "user-documents" };
}

export async function handleReceiptIntake(req: Request, body: Record<string, unknown>, sb: Client): Promise<Response> {
  try {
    const action = String(body.action ?? "");
    if (!["upload", "submit", "read"].includes(action)) throw new ReceiptRefusal("Unknown receipt action");
    const owner = String(body.owner_user_id ?? ""), org = String(body.organization_id ?? "");
    if (!UUID.test(owner) || !UUID.test(org)) throw new ReceiptRefusal("owner_user_id and organization_id are required UUIDs");
    const auth = await authenticateWriter(req, { apiKeys: { endpoint: "receipt-intake", requiredScopes: [] } });
    if (!auth.ok) return reply({ error: auth.reason }, auth.status);
    if (!["api_key", "user"].includes(auth.caller.kind) || !("userId" in auth.caller) || !auth.caller.userId) throw new ReceiptRefusal("Sign in with your own account or use its API key", 403);
    const userId = auth.caller.userId;
    const keyId = auth.caller.kind === "api_key" ? auth.caller.keyId ?? null : null;
    if (auth.caller.kind === "api_key" && !keyId) throw new ReceiptRefusal("API key identity unavailable", 403);
    await checkAccess(sb, keyId, userId, owner, org, action);
    if (action === "read") {
      const offset = body.offset ?? 0;
      if (!Number.isInteger(offset) || Number(offset) < 0 || Number(offset) > 100000) throw new ReceiptRefusal("Invalid offset");
      if (body.artifact_id !== undefined && !UUID.test(String(body.artifact_id))) throw new ReceiptRefusal("Invalid artifact_id");
      const { data, error } = await sb.rpc("read_receipt_intake", { p_key_id: keyId, p_user_id: userId,
        p_owner_user_id: owner, p_organization_id: org, p_artifact_id: body.artifact_id ?? null, p_offset: offset });
      if (error) throw new ReceiptRefusal("Receipt read refused", 403);
      if (body.include_original === true) {
        if (!body.artifact_id || data?.records?.length !== 1) throw new ReceiptRefusal("Select one accessible artifact to retrieve its original", 404);
        const source = data.records[0].artifact_payload.original;
        await verifiedOriginal(sb, owner, source);
        await checkAccess(sb, keyId, userId, owner, org, "read");
        const { data: signed, error: signError } = await sb.storage.from("user-documents").createSignedUrl(originalPath(owner, source), 60);
        if (signError || !signed?.signedUrl) throw new ReceiptRefusal("Original retrieval unavailable", 502);
        data.original_url = signed.signedUrl;
        data.original_url_expires_in_seconds = 60;
      }
      return reply({ data });
    }
    if (!body.original || typeof body.original !== "object" || Array.isArray(body.original)) throw new ReceiptRefusal("original is required");
    const original = body.original as Record<string, unknown>;
    const path = originalPath(owner, original);
    if (action === "upload") {
      const encoded = body.file_base64;
      if (typeof encoded !== "string" || encoded.length > Math.ceil(MAX_FILE / 3) * 4) throw new ReceiptRefusal("file_base64 exceeds 10MB limit");
      let bytes: Uint8Array;
      try { bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0)); } catch { throw new ReceiptRefusal("Invalid base64"); }
      if (!bytes.length || bytes.length > MAX_FILE || await sha256(bytes) !== original.sha256) throw new ReceiptRefusal("Original SHA-256 mismatch");
      const { data: bucket, error: be } = await sb.storage.getBucket("user-documents");
      if (be || bucket?.public !== false) throw new ReceiptRefusal("Private original storage unavailable", 503);
      const { error } = await sb.storage.from("user-documents").upload(path, bytes, { upsert: false, contentType: original.mime_type,
        metadata: { sha256: original.sha256, contributor_user_id: userId, organization_id: org } });
      if (error && String(error.statusCode) !== "409" && !/already exists|duplicate/i.test(error.message)) throw new ReceiptRefusal("Original upload failed", 502);
      const verified = await verifiedOriginal(sb, owner, original);
      await checkAccess(sb, keyId, userId, owner, org, action);
      const { error: auditError } = await sb.rpc("record_receipt_participation", { p_key_id: keyId, p_user_id: userId,
        p_owner_user_id: owner, p_organization_id: org, p_operation: "upload",
        p_target: { sha256: original.sha256, storage_path: path, status: "original_verified" } });
      if (auditError) throw new ReceiptRefusal("Original stored; participation recording failed. Retry this upload.", 502);
      return reply({ status: "original_verified", original: verified, duplicate: Boolean(error) });
    }
    const extraction = validateExtraction(body.extraction);
    if (body.supersedes_artifact_id !== undefined && !UUID.test(String(body.supersedes_artifact_id))) throw new ReceiptRefusal("Invalid supersedes_artifact_id");
    // Only this service call carries authenticated identity to canonical intake.
    const { data, error } = await sb.functions.invoke("ingest-observation", { headers: { apikey: projectSecretKey() ?? "" }, body: {
      mode: "receipt_evidence_v1", key_id: keyId, contributor_user_id: userId, owner_user_id: owner,
      organization_id: org, original, extraction, supersedes_artifact_id: body.supersedes_artifact_id ?? null,
    } });
    if (error || !data?.artifact_id || !data?.observation_id) throw new ReceiptRefusal("Canonical receipt intake failed; retry the same submission", 502);
    return reply(data);
  } catch (error) {
    return reply({ error: error instanceof ReceiptRefusal ? error.message : "Receipt intake failed" }, error instanceof ReceiptRefusal ? error.status : 500);
  }
}

export async function admitReceiptEvidence(body: Record<string, unknown>, sb: Client): Promise<Response> {
  try {
    const owner = String(body.owner_user_id ?? ""), org = String(body.organization_id ?? "");
    const key = body.key_id === null ? null : String(body.key_id ?? ""), actor = String(body.contributor_user_id ?? "");
    if (![owner, org, actor].every(x => UUID.test(x)) || (key !== null && !UUID.test(key))) throw new ReceiptRefusal("Invalid receipt identity");
    await checkAccess(sb, key, actor, owner, org, "submit");
    const extraction = validateExtraction(body.extraction);
    const original = await verifiedOriginal(sb, owner, body.original as Record<string, unknown>);
    const { data, error } = await sb.rpc("ingest_receipt_evidence", { p_key_id: key, p_user_id: actor,
      p_owner_user_id: owner, p_organization_id: org, p_original: original, p_extraction: extraction,
      p_supersedes_artifact_id: body.supersedes_artifact_id ?? null });
    if (error) throw new ReceiptRefusal("Receipt evidence admission refused", 409);
    return reply(data);
  } catch (error) {
    return reply({ error: error instanceof ReceiptRefusal ? error.message : "Receipt evidence admission failed" }, error instanceof ReceiptRefusal ? error.status : 500);
  }
}
