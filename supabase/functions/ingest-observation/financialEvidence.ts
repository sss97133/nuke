/** Private original custody + attributed financial cells; never an expense posting. */
export const FINANCIAL_EVIDENCE_MODE = "financial_evidence_v1";
type Client = { storage: { getBucket(bucket: string): Promise<{ data: { public: boolean } | null; error: unknown }>; from(bucket: string): { download(path: string): Promise<{ data: Blob | null; error: unknown }> } }; rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
export function financialActor(caller: { kind: string; userId?: string | null; scopes?: string[] }, action: string): string | null {
  if (!["user", "api_key"].includes(caller.kind) || !caller.userId) return null;
  if (caller.kind === "api_key" && !caller.scopes?.includes(action === "read" ? "read" : "write")) return null;
  return caller.userId;
}
export async function ingestFinancialEvidence(db: Client, userId: string, input: unknown, stillAuthorized: () => Promise<boolean>, actorContext: { kind: string; agent_id?: string | null } = { kind: "user" }) {
  const body = input as Record<string, any>;
  if (body && typeof body === "object" && !Array.isArray(body) && body.action === "read") {
    if (Object.keys(body).some(k => !["mode", "action", "document_id", "original_sha256"].includes(k)) ||
        Boolean(body.document_id) === Boolean(body.original_sha256) ||
        (body.document_id && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.document_id)) ||
        (body.original_sha256 && !/^[a-f0-9]{64}$/.test(body.original_sha256)))
      return { status: 400, body: { error: "Expected one original selector" } };
    const read = await db.rpc("read_financial_evidence", { p_owner_id: userId,
      p_document_id: body.document_id ?? null, p_sha256: body.original_sha256 ?? null });
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
