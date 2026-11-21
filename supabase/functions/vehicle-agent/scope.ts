/**
 * What the per-vehicle agent may do, decided on the server and pinned to one car.
 *
 * Pure: no Deno.env, no network, no imports, so `deno test` runs it alone (scope.test.ts).
 *
 * 1. Pin. Every proposal is for the request's vehicle_id. The model never supplies a vehicle: a proposal whose
 *    arguments carry a vehicle-naming key (vehicle_id, duplicate_id, ...) or any uuid other than the pinned car is
 *    refused, so two agents open on two cards cannot touch each other's car.
 * 2. Propose, then confirm. The model only proposes. A proposal is signed by the server (HMAC over account, vehicle,
 *    writer, arguments and expiry) and handed to the card; nothing is written until the person presses Confirm, which
 *    sends the signed token back. The server verifies the signature, re-checks account, vehicle, expiry and the writer
 *    allow-list, re-validates the arguments, and only then calls the writer.
 * 3. Allow-list. Two writers:
 *    - record_vehicle_statement, called with the person's own session (the writer takes the speaker from
 *      authentication only). The words are the person's own latest message, stored whole, never the model's text;
 *      the model only suggests the kind and an optional target key.
 *    - ingest_observation (the existing ingest-observation rail, source agent-submission, rank normal): a finding in
 *      the agent's own voice, on behalf of the person, only after Confirm. Signed, so a client cannot mint an
 *      agent-labelled row with text the agent never proposed.
 *    Left out on purpose: correct_vehicle_identity / correct_vehicle_text_field / correct_vehicle_vin and
 *    propose_vehicle_merge. They execute for the service role only and take no caller identity, the correct_* writers
 *    need a cited source document, and a merge must name a second vehicle (refused by the pin).
 */

export const STATEMENT_KINDS = ["assertion", "recollection", "estimate"] as const;
export const SPEAKER_ROLES = ["owner", "representative", "seller_agent", "shop", "previous_owner"] as const;
// The agent may only record these kinds, at rank 'normal' (never listings, sales or bids).
export const OBSERVATION_KINDS = [
  "condition", "specification", "valuation", "provenance",
  "expert_opinion", "work_record", "ownership", "activity", "sighting",
] as const;
export const CONFIDENCES = ["high", "medium", "low", "inferred"] as const;
export const MAX_PROPOSALS = 3;
export const PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000;

export type WriterName = "record_vehicle_statement" | "ingest_observation";
export type StatementArgs = {
  statement: string;
  statement_kind: typeof STATEMENT_KINDS[number];
  target_key: string | null;
  target_value: string | null;
};
export type ObservationArgs = {
  kind: typeof OBSERVATION_KINDS[number];
  summary: string;
  fields: Record<string, unknown>;
  confidence: typeof CONFIDENCES[number];
};
export type Proposal =
  | { writer: "record_vehicle_statement"; args: StatementArgs; summary: string }
  | { writer: "ingest_observation"; args: ObservationArgs; summary: string };
export type SignedPayload = Proposal & { v: 1; id: string; user_id: string; vehicle_id: string; model: string; exp: number };

type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const VEHICLE_KEY = /(^|_)(vehicle|vehicles|duplicate|primary|keeper|merge_target)(_ids?)?$/i;
const TARGET_KEY = /^[a-z][a-z0-9_]{0,63}$/;

export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** True when anything in `value` (keys or strings, at any depth) names a vehicle other than the pinned one. */
export function namesAnotherVehicle(value: unknown, vehicleId: string, depth = 0): boolean {
  if (depth > 8) return true;
  if (typeof value === "string") {
    return (value.match(UUID) ?? []).some((id) => id.toLowerCase() !== vehicleId.toLowerCase());
  }
  if (Array.isArray(value)) return value.some((item) => namesAnotherVehicle(item, vehicleId, depth + 1));
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(([key, item]) =>
      VEHICLE_KEY.test(key) || namesAnotherVehicle(key, vehicleId, depth + 1) ||
      namesAnotherVehicle(item, vehicleId, depth + 1)
    );
  }
  return false;
}

const text = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.trim() && value.length <= max ? value.trim() : null;

/** The writer allow-list: each entry validates its own arguments against the pinned vehicle. */
export const WRITERS: Record<WriterName, {
  calledAs: "person" | "service";
  validate(args: unknown, vehicleId: string): Result<StatementArgs | ObservationArgs>;
}> = {
  record_vehicle_statement: {
    calledAs: "person",
    validate(raw, vehicleId) {
      const a = (raw ?? {}) as Record<string, unknown>;
      if (namesAnotherVehicle(a, vehicleId)) return { ok: false, reason: "names another vehicle" };
      const statement = text(a.statement, 20000);
      if (!statement) return { ok: false, reason: "no words to keep" };
      if (!STATEMENT_KINDS.includes(a.statement_kind as never)) return { ok: false, reason: "unknown statement kind" };
      const key = a.target_key ?? null, value = a.target_value ?? null;
      if ((key === null) !== (value === null)) return { ok: false, reason: "a target is a key and a value together" };
      if (key !== null && (typeof key !== "string" || !TARGET_KEY.test(key))) return { ok: false, reason: "target key is not lower_snake_case" };
      if (value !== null && (typeof value !== "string" || !value.trim() || value.length > 500)) {
        return { ok: false, reason: "target value is empty or longer than 500 characters" };
      }
      return {
        ok: true,
        value: { statement, statement_kind: a.statement_kind as StatementArgs["statement_kind"], target_key: key as string | null, target_value: value as string | null },
      };
    },
  },
  ingest_observation: {
    calledAs: "service",
    validate(raw, vehicleId) {
      const a = (raw ?? {}) as Record<string, unknown>;
      if (namesAnotherVehicle(a, vehicleId)) return { ok: false, reason: "names another vehicle" };
      if (!OBSERVATION_KINDS.includes(a.kind as never)) return { ok: false, reason: "kind not allowed" };
      const summary = text(a.summary, 1000);
      if (!summary) return { ok: false, reason: "no summary" };
      const fields = a.fields && typeof a.fields === "object" && !Array.isArray(a.fields) ? a.fields as Record<string, unknown> : {};
      if (JSON.stringify(fields).length > 4000) return { ok: false, reason: "fields too large" };
      const confidence = CONFIDENCES.includes(a.confidence as never) ? a.confidence as ObservationArgs["confidence"] : "low";
      return { ok: true, value: { kind: a.kind as ObservationArgs["kind"], summary, fields, confidence } };
    },
  },
};

const clip = (value: string, max: number) => value.length > max ? `${value.slice(0, max - 1)}…` : value;

/** The plain words the card shows beside Confirm. Built here, never taken from the model. */
export function summaryFor(proposal: Omit<Proposal, "summary">): string {
  if (proposal.writer === "record_vehicle_statement") {
    const a = proposal.args as StatementArgs;
    const as = a.statement_kind === "assertion" ? "a fact" : a.statement_kind === "recollection" ? "from memory" : "an estimate";
    const target = a.target_key ? ` (${a.target_key.replaceAll("_", " ")}: ${a.target_value})` : "";
    return `Keep your words in the log book as ${as}${target}: “${clip(a.statement, 160)}”`;
  }
  const a = proposal.args as ObservationArgs;
  return `Record the agent's ${a.kind.replaceAll("_", " ")} finding: ${clip(a.summary, 200)}`;
}

/** Split the model's prose from an optional trailing ```json block. */
export function splitReply(raw: string): { reply: string; block: unknown } {
  const match = raw.match(/```json\s*([\s\S]*?)```\s*$/);
  if (!match) return { reply: raw.trim(), block: null };
  let block: unknown = null;
  try { block = JSON.parse(match[1]); } catch { /* malformed: no proposals */ }
  return { reply: raw.slice(0, match.index).trim(), block };
}

/** The model's proposals, validated and pinned. The statement's words are the person's message, not the model's. */
export function normalizeProposals(block: unknown, ctx: { vehicleId: string; userMessage: string }):
  { proposals: Proposal[]; refused: Array<{ writer: string; reason: string }> } {
  const list = block && typeof block === "object" && Array.isArray((block as any).proposals) ? (block as any).proposals : [];
  const proposals: Proposal[] = [];
  const refused: Array<{ writer: string; reason: string }> = [];
  for (const item of list.slice(0, MAX_PROPOSALS * 2)) {
    const writer = String(item?.writer ?? "");
    if (!(writer in WRITERS)) { refused.push({ writer, reason: "writer not allowed" }); continue; }
    // The model's whole item is checked for another vehicle, not only the arguments a writer keeps.
    if (namesAnotherVehicle(item, ctx.vehicleId)) { refused.push({ writer, reason: "names another vehicle" }); continue; }
    const args = writer === "record_vehicle_statement"
      ? { statement: ctx.userMessage, statement_kind: item.statement_kind, target_key: item.target_key ?? null, target_value: item.target_value ?? null }
      : { kind: item.kind, summary: item.summary, fields: item.fields, confidence: item.confidence };
    const checked = WRITERS[writer as WriterName].validate(args, ctx.vehicleId);
    if (!checked.ok) { refused.push({ writer, reason: checked.reason }); continue; }
    if (proposals.length >= MAX_PROPOSALS) { refused.push({ writer, reason: "too many proposals" }); continue; }
    const base = { writer, args: checked.value } as Omit<Proposal, "summary">;
    proposals.push({ ...base, summary: summaryFor(base) } as Proposal);
  }
  return { proposals, refused };
}

// ── Signing ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const encoder = new TextEncoder();
const b64url = (bytes: Uint8Array) => {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};
const unb64url = (value: string): Uint8Array<ArrayBuffer> => {
  const s = value.replaceAll("-", "+").replaceAll("_", "/");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function proposalKey(secret: string): Promise<CryptoKey> {
  // A key for this purpose only, derived from the function's secret; no new secret is needed.
  const material = await crypto.subtle.digest("SHA-256", encoder.encode(`vehicle-agent-proposal:v1:${secret}`));
  return crypto.subtle.importKey("raw", material, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signProposal(payload: SignedPayload, secret: string): Promise<string> {
  const body = encoder.encode(JSON.stringify(payload));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await proposalKey(secret), body));
  return `${b64url(body)}.${b64url(sig)}`;
}

/** Verify a token sent back on Confirm, then re-check account, vehicle, expiry, allow-list and arguments. */
export async function verifyProposal(token: unknown, secret: string, ctx: { userId: string; vehicleId: string; now: number }):
  Promise<Result<SignedPayload>> {
  if (typeof token !== "string" || token.length > 200000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    return { ok: false, reason: "not a proposal" };
  }
  const [body, sig] = token.split(".");
  let bodyBytes: Uint8Array<ArrayBuffer>, sigBytes: Uint8Array<ArrayBuffer>;
  try { bodyBytes = unb64url(body); sigBytes = unb64url(sig); } catch { return { ok: false, reason: "not a proposal" }; }
  const valid = await crypto.subtle.verify("HMAC", await proposalKey(secret), sigBytes, bodyBytes);
  if (!valid) return { ok: false, reason: "not a proposal this agent made" };
  let payload: SignedPayload;
  try { payload = JSON.parse(new TextDecoder().decode(bodyBytes)); } catch { return { ok: false, reason: "not a proposal" }; }
  if (payload?.v !== 1 || !isUuid(payload.id)) return { ok: false, reason: "not a proposal" };
  if (payload.user_id !== ctx.userId) return { ok: false, reason: "made for another account" };
  if (payload.vehicle_id !== ctx.vehicleId) return { ok: false, reason: "made for another vehicle" };
  if (typeof payload.exp !== "number" || payload.exp < ctx.now) return { ok: false, reason: "expired" };
  if (!(payload.writer in WRITERS)) return { ok: false, reason: "writer not allowed" };
  const checked = WRITERS[payload.writer].validate(payload.args, ctx.vehicleId);
  if (!checked.ok) return { ok: false, reason: checked.reason };
  return { ok: true, value: { ...payload, args: checked.value } as SignedPayload };
}

/** The role a confirmed statement is said as: the caller's choice from the closed list, else what the record shows. */
export function speakerRole(requested: unknown, recordNamesOwner: boolean): Result<typeof SPEAKER_ROLES[number]> {
  if (requested === undefined || requested === null || requested === "") {
    return { ok: true, value: recordNamesOwner ? "owner" : "representative" };
  }
  if (!SPEAKER_ROLES.includes(requested as never)) return { ok: false, reason: "unknown role" };
  if (requested === "owner" && !recordNamesOwner) return { ok: false, reason: "the car's record does not name you as its owner" };
  return { ok: true, value: requested as typeof SPEAKER_ROLES[number] };
}
