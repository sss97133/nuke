// Owner statements: the two connector tools over the SQL writers and reader of migration 20261117150000.
// A statement is what the signed-in person said in conversation, stored whole and uninterpreted, unsigned.
// The speaker is never an argument: the database resolves it from the raw OAuth token this request carried
// (owner_statement_caller hashes it; a stored hash, an API key or the service key speaks for nobody).
// Nothing here logs an argument or a result.

export const RECORD_OWNER_STATEMENT = "record_owner_statement";
export const READ_OWNER_STATEMENTS = "read_owner_statements";

export const OWNER_STATEMENT_TOOLS = [
  {
    name: RECORD_OWNER_STATEMENT,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, title: "Record Owner Statement" },
    description:
      "Store something the signed-in person just told you, in their own words, about an organisation (a brand, a shop, " +
      "one of their companies) or a relationship between organisations. Pass the message exactly as written: do not " +
      "summarise, translate, correct or split it. One call per message. It is stored privately (no other account and " +
      "no public reader can read it back; the platform operator's own database access is not restricted by this), " +
      "unsigned (their claim as you transcribed it, not a verified fact) and uninterpreted. Tell the person it was " +
      "stored and that they can correct or withdraw it. " +
      "`organizations` is YOUR resolution of names in the message: give organization_id when search_organizations " +
      "found the organisation, or only name_as_written when it did not; never guess an id. To correct a statement, send " +
      "the corrected message with supersedes_statement_id (the old one is kept). To withdraw one, send the person's " +
      "words withdrawing it with supersedes_statement_id and withdraw=true. To fix only your own organisation link, " +
      "send `link` instead of `statement`. Requires sign-in through the connector's OAuth login; an API key cannot " +
      "speak for a person. Never call this with words the person did not say.",
    inputSchema: {
      type: "object",
      properties: {
        statement: { type: "string", description: "The person's message, verbatim and whole. Required unless `link` is given." },
        said_on: { type: "string", description: "The day it was said, YYYY-MM-DD, in the person's own calendar. Give this or said_at when known." },
        said_at: { type: "string", description: "The instant it was said, only when you actually know it: full ISO 8601 with an offset, e.g. 2026-11-16T10:30:00-10:00. For a day, use said_on." },
        said_at_basis: { type: "string", description: "How you know when it was said, in plain words, e.g. 'stated in conversation on this date'." },
        recording_agent: { type: "string", description: "Who is transcribing: your own name and surface, e.g. 'Claude, phone app'." },
        organizations: {
          type: "array",
          description: "Your resolution of organisation names in the message. Omit when it names none.",
          items: {
            type: "object",
            properties: {
              name_as_written: { type: "string", description: "The name exactly as it appears in the message." },
              organization_id: { type: "string", description: "Organisation UUID from search_organizations. Omit when unresolved." },
            },
            required: ["name_as_written"],
          },
        },
        supersedes_statement_id: { type: "string", description: "UUID of the person's earlier statement this one corrects or withdraws." },
        withdraw: { type: "boolean", description: "true when the message withdraws the statement named in supersedes_statement_id." },
        conversation_ref: { type: "string", description: "Optional pointer to this conversation (an id or title), not its content." },
        request_id: { type: "string", description: "Optional UUID for this write. Reuse it when retrying the same call; pass a new one when the person says the same words again on a new occasion." },
        link: {
          type: "object",
          description: "Instead of a statement: add, correct or withdraw one organisation link on an existing statement.",
          properties: {
            statement_id: { type: "string", description: "UUID of the statement." },
            name_as_written: { type: "string", description: "The name exactly as it appears in that statement." },
            organization_id: { type: "string", description: "Organisation UUID, or omit to keep the name unresolved." },
            supersedes_link_id: { type: "string", description: "UUID of the link this replaces. Required when the name is already linked." },
            withdraw: { type: "boolean", description: "true to withdraw the link named in supersedes_link_id." },
            request_id: { type: "string", description: "Optional UUID for this write. Reuse it when retrying." },
          },
          required: ["statement_id", "name_as_written"],
        },
      },
      required: ["recording_agent"],
    },
  },
  {
    name: READ_OWNER_STATEMENTS,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, title: "Read Owner Statements" },
    description:
      "Read back the signed-in person's own stored statements (see record_owner_statement), newest first, with " +
      "total_count and each statement's organisation links. Read this before answering a question about the person's " +
      "organisations or their dealings with other organisations. Each statement is their unsigned claim as transcribed, " +
      "not a verified fact: quote it as what they said and when. A database read; filters are optional. Requires " +
      "sign-in through the connector's OAuth login.",
    inputSchema: {
      type: "object",
      properties: {
        organization_id: { type: "string", description: "Only statements currently linked to this organisation UUID." },
        said_from: { type: "string", description: "Only statements said on or after this day, YYYY-MM-DD." },
        said_to: { type: "string", description: "Only statements said on or before this day, YYYY-MM-DD." },
        include_superseded: { type: "boolean", description: "Also return corrected and withdrawn statements. Default false." },
        limit: { type: "integer", description: "Page size, 1-500. Default 100." },
        offset: { type: "integer", description: "Rows to skip. Default 0." },
      },
    },
  },
];

/** Who called, as the HTTP entry authenticated them. oauthToken is set only for a nuke_oauth_ bearer. */
export interface CallerContext {
  userId?: string;
  scopes?: string[];
  oauthToken?: string;
  /** The raw X-API-Key this request presented, so a write tool can forward the caller's own key (callerRelay.ts). */
  apiKey?: string;
}

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };
export type Rpc = (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;

const ok = (data: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
const err = (msg: string): ToolResult => ({ content: [{ type: "text", text: JSON.stringify({ error: msg }) }], isError: true });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const SIGN_IN = "Sign-in required: this tool works only for a person signed in through the connector's OAuth login. " +
  "An API key or the service key cannot speak for a person. Reconnect the Nuke connector and try again.";

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
function uuidArg(v: unknown, name: string): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !UUID.test(v)) throw new Error(`${name} must be a UUID`);
  return v.toLowerCase();
}
function dayArg(v: unknown, name: string): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !DAY.test(v)) throw new Error(`${name} must be a day, YYYY-MM-DD`);
  return v;
}
/** A flag is true or false. Anything else is refused, not guessed: "true" as text must not turn a withdrawal into a correction. */
function boolArg(v: unknown, name: string): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v !== "boolean") throw new Error(`${name} must be true or false`);
  return v;
}
/** The person is signed in but this login was not granted the scope: reconnecting alone will not help, so say which scope. */
function missingScope(caller: CallerContext, scope: string): ToolResult | null {
  if ((caller.scopes ?? []).includes(scope)) return null;
  return err(`This login does not carry the '${scope}' scope (it holds [${(caller.scopes ?? []).join(", ") || "none"}]). ` +
    `Re-authorize the Nuke connector requesting scope=${scope}. Nothing was ${scope === "read" ? "read" : "written"}.`);
}
/** Text the database cannot hold is refused by name, never stripped: the message is stored whole or not at all. */
function storable(v: string, name: string) {
  // deno-lint-ignore no-control-regex
  if (/\u0000/.test(v)) throw new Error(`${name} contains a NUL character, which cannot be stored; nothing was written`);
  if (!v.isWellFormed()) throw new Error(`${name} contains a broken character (an unpaired surrogate); nothing was written`);
}

/** A stable UUID for a request that did not bring one, so a retry after a dropped reply replays instead of duplicating. */
export async function derivedRequestId(parts: unknown[]): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(parts))));
  const hex = [...bytes.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function refusal(error: { code?: string; message?: string }): ToolResult {
  if (error.code === "42501") {
    return err("Not authorised: " + (error.message ?? "") + ". " + SIGN_IN +
      " Writing needs the write:observations scope and reading the read scope.");
  }
  return err(error.message || "the database refused the request");
}

export async function callOwnerStatement(
  tool: string,
  args: Record<string, unknown>,
  caller: CallerContext | undefined,
  rpc: Rpc,
): Promise<ToolResult> {
  // The speaker is whoever holds this request's OAuth token. No token, no speaker; nothing is sent to the database.
  if (!caller?.oauthToken || !caller.userId || caller.userId === "service-role" || !UUID.test(caller.userId)) return err(SIGN_IN);
  const credential = caller.oauthToken;
  try {
    if (tool === READ_OWNER_STATEMENTS) {
      const refused = missingScope(caller, "read");
      if (refused) return refused;
      const { data, error } = await rpc("get_my_owner_statements", {
        p_organization_id: uuidArg(args.organization_id, "organization_id"),
        p_said_from: dayArg(args.said_from, "said_from"),
        p_said_to: dayArg(args.said_to, "said_to"),
        p_include_superseded: boolArg(args.include_superseded, "include_superseded"),
        p_limit: Number.isInteger(args.limit) ? args.limit : 100,
        p_offset: Number.isInteger(args.offset) ? args.offset : 0,
        p_credential: credential,
      });
      return error ? refusal(error) : ok(data);
    }
    if (tool !== RECORD_OWNER_STATEMENT) return err(`Unknown owner statement tool: ${tool}`);
    const refused = missingScope(caller, "write:observations");
    if (refused) return refused;

    const agent = str(args.recording_agent);
    if (!agent) return err("recording_agent is required: name yourself as the transcriber");
    storable(agent, "recording_agent");

    if (args.link !== undefined && args.link !== null) {
      if (args.statement !== undefined) return err("send either `statement` or `link`, not both");
      const link = args.link as Record<string, unknown>;
      if (typeof link !== "object" || Array.isArray(link)) return err("link must be an object");
      const statementId = uuidArg(link.statement_id, "link.statement_id");
      const name = str(link.name_as_written);
      if (!statementId || !name) return err("link needs statement_id and name_as_written");
      storable(name, "link.name_as_written");
      const organizationId = uuidArg(link.organization_id, "link.organization_id");
      const supersedes = uuidArg(link.supersedes_link_id, "link.supersedes_link_id");
      const withdraw = boolArg(link.withdraw, "link.withdraw");
      // No derived id here: the writer itself refuses a second link for a name already linked and a second successor
      // of a superseded link, so a blind retry cannot duplicate, and a deliberate re-link is never mistaken for one.
      const requestId = uuidArg(link.request_id, "link.request_id") ?? crypto.randomUUID();
      const { data, error } = await rpc("record_owner_statement_link", {
        p_request_id: requestId, p_statement_id: statementId, p_name_as_written: name, p_recording_agent: agent,
        p_organization_id: organizationId, p_supersedes: supersedes, p_withdraw: withdraw, p_credential: credential,
      });
      return error ? refusal(error) : ok({ link_id: data, request_id: requestId, sign_status: "unsigned" });
    }

    // The message goes through untouched: no trim, no normalisation.
    if (typeof args.statement !== "string" || args.statement.trim() === "") return err("statement is required: the person's message, verbatim");
    const statement = args.statement;
    storable(statement, "statement");
    const basis = str(args.said_at_basis);
    if (!basis) return err("said_at_basis is required: say in plain words how you know when it was said");
    storable(basis, "said_at_basis");
    const saidOn = dayArg(args.said_on, "said_on");
    const saidAt = str(args.said_at);
    if (saidAt !== null && (!INSTANT.test(saidAt) || Number.isNaN(Date.parse(saidAt)))) {
      return err("said_at must be a full instant with an offset (e.g. 2026-11-16T10:30:00-10:00); for a day, give said_on");
    }
    if (saidOn && saidAt) return err("give said_on or said_at, not both");
    const conversationRef = str(args.conversation_ref);
    if (conversationRef) storable(conversationRef, "conversation_ref");
    const supersedes = uuidArg(args.supersedes_statement_id, "supersedes_statement_id");
    const withdraw = boolArg(args.withdraw, "withdraw");

    const links: Array<{ name_as_written: string; organization_id?: string }> = [];
    if (args.organizations !== undefined && args.organizations !== null) {
      if (!Array.isArray(args.organizations)) return err("organizations must be an array");
      for (const item of args.organizations as Array<Record<string, unknown>>) {
        const name = item && typeof item === "object" ? str(item.name_as_written) : null;
        if (!name) return err("each organization needs name_as_written");
        storable(name, "organizations.name_as_written");
        const id = uuidArg(item.organization_id, "organizations.organization_id");
        links.push(id ? { name_as_written: name, organization_id: id } : { name_as_written: name });
      }
    }
    const givenId = uuidArg(args.request_id, "request_id");
    const requestId = givenId ??
      await derivedRequestId(["owner-statement", caller.userId, statement, saidOn, saidAt ? new Date(saidAt).toISOString() : null, supersedes, withdraw, links]);
    const { data, error } = await rpc("record_owner_statement", {
      p_request_id: requestId, p_statement: statement, p_said_at_basis: basis, p_recording_agent: agent,
      p_said_on: saidOn, p_said_at: saidAt, p_organization_links: links, p_supersedes: supersedes,
      p_conversation_ref: conversationRef, p_withdraw: withdraw, p_credential: credential,
    });
    if (error) return refusal(error);
    const stored = (data ?? {}) as Record<string, unknown>;
    if (stored.replay === true) {
      // Not a new row. Say so in words, so a restated message is never reported as freshly stored.
      return ok({ ...stored, request_id: requestId, stored_now: false,
        note: "These exact words were already stored under this request" + (givenId ? "" : " (the request id was derived from them)") +
          "; nothing new was written. The stored row may since have been corrected or withdrawn: check read_owner_statements " +
          "with include_superseded. If the person said this again on a new occasion, call again with a new request_id." });
    }
    return ok({ ...stored, request_id: requestId, stored_now: true, stored_characters: statement.length });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}
