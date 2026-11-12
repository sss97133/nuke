/** Owner-private work projections (image-derived timeline observations, invoice-vs-photo labor reconciliation).
 * Account scope only: the account is the caller's own, derived by the server; the body can never name an owner. */
type Rpc = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
type Reply = { status: number; body: Record<string, unknown> };
export const PROJECTION_ACTIONS = ["projection_submit", "projection_read"];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const KEY = /^[a-f0-9]{16,64}$/;
const FORBIDDEN_BODY_KEYS = ["owner_id", "owner_user_id", "p_owner_id", "user_id", "account_id"];

export async function privateProjection(db: Rpc, userId: string, input: unknown, stillAuthorized: () => Promise<boolean>,
    actorContext: { kind: string; agent_id?: string | null }): Promise<Reply> {
  const body = input as Record<string, unknown>;
  if (!body || typeof body !== "object" || Array.isArray(body) || FORBIDDEN_BODY_KEYS.some(k => k in body))
    return { status: 400, body: { error: "The account is derived from your credential; do not send an owner" } };
  if (body.action === "projection_read") {
    const allowed = ["mode", "action", "keys", "kind", "include_superseded", "after", "limit"];
    const keys = body.keys;
    if (Object.keys(body).some(k => !allowed.includes(k)) ||
        (keys !== undefined && (!Array.isArray(keys) || keys.length > 100 || keys.some(k => typeof k !== "string" || !KEY.test(k)))) ||
        (body.kind !== undefined && !["image_timeline_event", "labor_reconciliation"].includes(body.kind as string)) ||
        (body.include_superseded !== undefined && typeof body.include_superseded !== "boolean") ||
        (body.after !== undefined && (typeof body.after !== "string" || !UUID.test(body.after))) ||
        (body.limit !== undefined && (!Number.isInteger(body.limit) || (body.limit as number) < 1 || (body.limit as number) > 500)))
      return { status: 400, body: { error: "Invalid projection read" } };
    const read = await db.rpc("read_private_work_projections", { p_owner_id: userId, p_keys: keys ?? null, p_kind: body.kind ?? null,
      p_include_superseded: body.include_superseded ?? false, p_after: body.after ?? null, p_limit: body.limit ?? 200 });
    return read.error ? { status: 503, body: { error: "Projection read unavailable" } } : { status: 200, body: { data: read.data } };
  }
  if (body.action !== "projection_submit" || Object.keys(body).some(k => !["mode", "action", "revision"].includes(k)))
    return { status: 400, body: { error: "Only a projection revision is accepted" } };
  const revision = body.revision as Record<string, unknown> | undefined;
  if (!revision || typeof revision !== "object" || Array.isArray(revision) || JSON.stringify(revision).length > 250000 ||
      !Array.isArray(revision.projections) || revision.projections.length < 1 || revision.projections.length > 50 ||
      revision.projections.some((p: unknown) => !p || typeof p !== "object" || FORBIDDEN_BODY_KEYS.some(k => k in (p as object))))
    return { status: 400, body: { error: "Invalid projection revision" } };
  if (!await stillAuthorized()) return { status: 403, body: { error: "Account authorization no longer active" } };
  // The database re-validates everything (scope, refs, payload contract, supersession); a refusal is generic on purpose.
  const result = await db.rpc("ingest_private_work_projection", { p_owner_id: userId, p_actor_context: actorContext, p_revision: revision });
  if (result.error) return { status: 409, body: { error: "Private projection admission refused" } };
  return { status: 200, body: { data: result.data, expense_posted: false, public_timeline_written: false } };
}
