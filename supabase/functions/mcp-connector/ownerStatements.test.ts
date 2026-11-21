// Run: deno test supabase/functions/mcp-connector/ownerStatements.test.ts
// The two owner-statement tools without HTTP or a database: the rpc is a recorder. Synthetic text only.
import { callOwnerStatement, derivedRequestId, OWNER_STATEMENT_TOOLS, type Rpc } from "./ownerStatements.ts";

const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
const USER = "10000000-0000-4000-8000-000000000001";
const ORG = "20000000-0000-4000-8000-00000000000a";
const TOKEN = "nuke_oauth_" + "c".repeat(64);
const signedIn = { userId: USER, scopes: ["read", "write:observations"], oauthToken: TOKEN };
function recorder(result: { data?: unknown; error?: { code?: string; message?: string } | null } = {}) {
  const calls: Array<{ fn: string; params: Record<string, unknown> }> = [];
  const rpc: Rpc = (fn, params) => { calls.push({ fn, params }); return Promise.resolve({ data: result.data ?? { statement_id: "s", replay: false }, error: result.error ?? null }); };
  return { calls, rpc };
}
const text = (r: { content: Array<{ text: string }> }) => JSON.parse(r.content[0].text);

Deno.test("no login token, no speaker: nothing reaches the database", async () => {
  for (const caller of [undefined, {}, { userId: USER }, { userId: "service-role", oauthToken: TOKEN }, { userId: "agent:anon", oauthToken: TOKEN }, { oauthToken: TOKEN }]) {
    for (const tool of ["record_owner_statement", "read_owner_statements"]) {
      const { calls, rpc } = recorder();
      const r = await callOwnerStatement(tool, { statement: "synthetic", said_at_basis: "b", recording_agent: "a" }, caller, rpc);
      assert(r.isError === true && calls.length === 0, `${tool} ran for ${JSON.stringify(caller)}`);
    }
  }
});

Deno.test("the message is passed whole; the speaker is never an argument", async () => {
  const { calls, rpc } = recorder();
  const statement = "  Synthetic Org A supplies Synthetic Org B.\n\tSecond line. é\u{1F697}  ";
  const r = await callOwnerStatement("record_owner_statement", {
    statement, said_on: "2026-11-16", said_at_basis: "stated in conversation on this date", recording_agent: "fixture-agent",
    organizations: [{ name_as_written: "Synthetic Org A", organization_id: ORG.toUpperCase() }, { name_as_written: "Synthetic Org B" }],
    user_id: "30000000-0000-4000-8000-000000000003", speaker: "someone else", submitted_by_user_id: "30000000-0000-4000-8000-000000000003",
  }, signedIn, rpc);
  assert(!r.isError && calls.length === 1 && calls[0].fn === "record_owner_statement", "writer not called once");
  const p = calls[0].params;
  assert(p.p_statement === statement, "the statement was altered on the way");
  assert(p.p_credential === TOKEN, "the request's own token is the only identity sent");
  assert(!Object.keys(p).some((k) => /user|speaker|submitted/.test(k)), `an identity argument was sent: ${Object.keys(p)}`);
  assert(!JSON.stringify(p).includes("30000000-0000-4000-8000-000000000003"), "a typed identity leaked into the call");
  assert(p.p_said_on === "2026-11-16" && p.p_said_at === null && p.p_withdraw === false && p.p_supersedes === null, "said-at or flags wrong");
  assert(JSON.stringify(p.p_organization_links) === JSON.stringify([{ name_as_written: "Synthetic Org A", organization_id: ORG }, { name_as_written: "Synthetic Org B" }]),
    "links must be the agent's resolution, unresolved names kept as written");
  const out = text(r);
  assert(out.request_id === p.p_request_id && out.stored_characters === statement.length, "the result must name the request and the stored length");
});

Deno.test("a retry without a request id replays the same request; different words do not", async () => {
  const args = { statement: "Synthetic message.", said_on: "2026-11-16", said_at_basis: "b", recording_agent: "agent one" };
  const a = recorder(), b = recorder(), c = recorder(), d = recorder();
  await callOwnerStatement("record_owner_statement", args, signedIn, a.rpc);
  // Same words after a reconnect: a new token and a differently phrased agent label.
  await callOwnerStatement("record_owner_statement", { ...args, recording_agent: "agent one, reconnected" }, { ...signedIn, oauthToken: "nuke_oauth_" + "d".repeat(64) }, b.rpc);
  await callOwnerStatement("record_owner_statement", { ...args, statement: "Synthetic message!" }, signedIn, c.rpc);
  await callOwnerStatement("record_owner_statement", args, { ...signedIn, userId: "10000000-0000-4000-8000-000000000002" }, d.rpc);
  assert(a.calls[0].params.p_request_id === b.calls[0].params.p_request_id, "a retry must reuse the request id");
  assert(a.calls[0].params.p_request_id !== c.calls[0].params.p_request_id, "different words must be a different request");
  assert(a.calls[0].params.p_request_id !== d.calls[0].params.p_request_id, "another speaker must be a different request");
  assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(String(a.calls[0].params.p_request_id)), "request id is a uuid");
  assert(await derivedRequestId(["x", 1]) === await derivedRequestId(["x", 1]), "derivation is stable");
  const given = recorder();
  await callOwnerStatement("record_owner_statement", { ...args, request_id: "40000000-0000-4000-8000-000000000004" }, signedIn, given.rpc);
  assert(given.calls[0].params.p_request_id === "40000000-0000-4000-8000-000000000004", "a given request id is kept");
});

Deno.test("bad input is refused before the database, never repaired", async () => {
  const base = { statement: "Synthetic.", said_at_basis: "b", recording_agent: "a" };
  const bad: Array<Record<string, unknown>> = [
    { ...base, statement: "   " }, { ...base, statement: undefined }, { ...base, statement: 7 },
    { ...base, statement: "nul \u0000 inside" }, { ...base, statement: "lone \ud83d surrogate" },
    { ...base, said_at_basis: "" }, { ...base, recording_agent: "" },
    { ...base, said_on: "16/11/2026" }, { ...base, said_on: "2026-11-16", said_at: "2026-11-16T10:00:00Z" }, { ...base, said_at: "yesterday" },
    { ...base, said_at: "2026-11-16" }, { ...base, said_at: "2026-11-16 10:00" }, { ...base, said_at: "2026-11-16T10:00:00" }, { ...base, said_at: "March 7" },
    { ...base, withdraw: "true", supersedes_statement_id: ORG }, { recording_agent: "a", link: { statement_id: ORG, name_as_written: "x", withdraw: 1 } },
    { ...base, supersedes_statement_id: "not-a-uuid" }, { ...base, organizations: "Synthetic Org A" },
    { ...base, organizations: [{ organization_id: ORG }] }, { ...base, organizations: [{ name_as_written: "x", organization_id: "nope" }] },
    { ...base, link: { statement_id: ORG, name_as_written: "x" } }, { recording_agent: "a", link: { name_as_written: "x" } },
  ];
  for (const args of bad) {
    const { calls, rpc } = recorder();
    const r = await callOwnerStatement("record_owner_statement", args, signedIn, rpc);
    assert(r.isError === true && calls.length === 0, `admitted ${JSON.stringify(args)}`);
  }
  const { calls, rpc } = recorder();
  const r = await callOwnerStatement("read_owner_statements", { organization_id: "nope" }, signedIn, rpc);
  assert(r.isError === true && calls.length === 0, "the reader admitted a bad organisation id");
  const flag = recorder();
  const rf = await callOwnerStatement("read_owner_statements", { include_superseded: "yes" }, signedIn, flag.rpc);
  assert(rf.isError === true && flag.calls.length === 0, "the reader guessed a flag");
  const exact = recorder();
  await callOwnerStatement("record_owner_statement", { ...base, said_at: "2026-11-16T10:30:00-10:00" }, signedIn, exact.rpc);
  assert(exact.calls[0].params.p_said_at === "2026-11-16T10:30:00-10:00" && exact.calls[0].params.p_said_on === null, "a full instant is passed as given");
});

Deno.test("a login without the scope is told which scope, and nothing is sent", async () => {
  const noWrite = recorder(), noRead = recorder();
  const w = await callOwnerStatement("record_owner_statement", { statement: "Synthetic.", said_at_basis: "b", recording_agent: "a" },
    { ...signedIn, scopes: ["read", "write"] }, noWrite.rpc);
  assert(w.isError === true && noWrite.calls.length === 0 && /write:observations/.test(text(w).error) && !/Sign-in required/.test(text(w).error),
    "a missing write scope must be named, not reported as a sign-in problem");
  const r = await callOwnerStatement("read_owner_statements", {}, { ...signedIn, scopes: ["write:observations"] }, noRead.rpc);
  assert(r.isError === true && noRead.calls.length === 0 && /'read' scope/.test(text(r).error), "a write scope must not read");
});

Deno.test("a replay is reported as not stored again; link writes are never silently replayed", async () => {
  const replay = recorder({ data: { statement_id: "s", replay: true, recorded_at: "2026-11-16T00:00:00Z" } });
  const r = await callOwnerStatement("record_owner_statement", { statement: "Synthetic.", said_at_basis: "b", recording_agent: "a" }, signedIn, replay.rpc);
  const out = text(r);
  assert(!r.isError && out.stored_now === false && /nothing new was written/.test(out.note) && out.stored_characters === undefined,
    "a replay must say that nothing new was stored");
  const fresh = recorder();
  assert(text(await callOwnerStatement("record_owner_statement", { statement: "Synthetic.", said_at_basis: "b", recording_agent: "a" }, signedIn, fresh.rpc)).stored_now === true,
    "a new row is reported as stored now");
  const a = recorder({ data: "l" }), b = recorder({ data: "l" });
  const link = { recording_agent: "a", link: { statement_id: ORG, name_as_written: "Synthetic Org B", organization_id: ORG } };
  await callOwnerStatement("record_owner_statement", link, signedIn, a.rpc);
  await callOwnerStatement("record_owner_statement", link, signedIn, b.rpc);
  assert(a.calls[0].params.p_request_id !== b.calls[0].params.p_request_id, "a link write without a request id must reach the writer as a new request");
});

Deno.test("link corrections and withdrawals go to the link writer", async () => {
  const { calls, rpc } = recorder({ data: "50000000-0000-4000-8000-000000000005" });
  const r = await callOwnerStatement("record_owner_statement", { recording_agent: "fixture-agent",
    link: { statement_id: ORG, name_as_written: "Synthetic Org B", organization_id: ORG, supersedes_link_id: USER } }, signedIn, rpc);
  assert(!r.isError && calls[0].fn === "record_owner_statement_link", "link writer not called");
  const p = calls[0].params;
  assert(p.p_statement_id === ORG && p.p_organization_id === ORG && p.p_supersedes === USER && p.p_withdraw === false && p.p_credential === TOKEN, "link arguments wrong");
  assert(text(r).link_id === "50000000-0000-4000-8000-000000000005", "link id not returned");
  const w = recorder();
  await callOwnerStatement("record_owner_statement", { statement: "Synthetic: I did not say that.", said_at_basis: "b", recording_agent: "a",
    supersedes_statement_id: ORG, withdraw: true }, signedIn, w.rpc);
  assert(w.calls[0].params.p_withdraw === true && w.calls[0].params.p_supersedes === ORG, "withdrawal not passed");
});

Deno.test("the reader is a database read with the caller's filters; a refusal says how to sign in", async () => {
  const { calls, rpc } = recorder({ data: { reader: "get_my_owner_statements", total_count: 2, returned: 2, statements: [] } });
  const r = await callOwnerStatement("read_owner_statements", { organization_id: ORG, said_from: "2026-11-01", said_to: "2026-11-17", include_superseded: true, limit: 10 }, signedIn, rpc);
  assert(calls.length === 1 && calls[0].fn === "get_my_owner_statements", "reader not called");
  assert(JSON.stringify(calls[0].params) === JSON.stringify({ p_organization_id: ORG, p_said_from: "2026-11-01", p_said_to: "2026-11-17",
    p_include_superseded: true, p_limit: 10, p_offset: 0, p_credential: TOKEN }), `reader arguments: ${JSON.stringify(calls[0].params)}`);
  assert(text(r).total_count === 2, "the count must come back from the database");
  const denied = recorder({ error: { code: "42501", message: "an authenticated speaker is required" } });
  const d = await callOwnerStatement("read_owner_statements", {}, signedIn, denied.rpc);
  assert(d.isError === true && /Sign-in required/.test(text(d).error), "a database refusal must tell the person to sign in");
  const failed = recorder({ error: { code: "23514", message: "request key reused with different content" } });
  const f = await callOwnerStatement("record_owner_statement", { statement: "Synthetic.", said_at_basis: "b", recording_agent: "a" }, signedIn, failed.rpc);
  assert(f.isError === true && text(f).error === "request key reused with different content", "a database refusal must be reported, not swallowed");
});

Deno.test("tool definitions: titles, annotations, and no argument that names a person", () => {
  assert(OWNER_STATEMENT_TOOLS.length === 2, "two tools");
  for (const tool of OWNER_STATEMENT_TOOLS) {
    assert(tool.annotations.title.trim().length > 0 && tool.annotations.destructiveHint === false && tool.annotations.openWorldHint === false, `${tool.name} annotations`);
    assert(!Object.keys(tool.inputSchema.properties).some((k) => /user|speaker|owner|submitted/.test(k)), `${tool.name} takes an identity argument`);
  }
  assert(OWNER_STATEMENT_TOOLS[0].annotations.readOnlyHint === false && OWNER_STATEMENT_TOOLS[1].annotations.readOnlyHint === true, "write and read hints");
});
