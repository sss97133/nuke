// Run: deno test --allow-read supabase/functions/mcp-connector/oauth_test.ts
// The connector's real HTTP entry point, built from index.ts without starting a server, reading credentials or
// reaching the database (tool handlers are spies, the service key is a test value). It holds the 2026-10-14 repair:
// this function issues no tokens (its /authorize approved every request without a login and minted 90-day
// write:canonical tokens signed with the service key), and a token in that old format is refused.
// It also holds the 2026-11-21 rule: with no credential only the public tools run, and every tool that reads through
// the service client, on /mcp and on the advisor surface, answers only the service key or an active admin.
import { scopeAllowsWriteTier } from "../_shared/scopeGrammar.ts";
import { ADVISOR_TOOL_NAMES, isAdvisorSurface } from "./advisor/mod.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
const slice = (from: string, to?: string) => {
  const a = source.indexOf(from), b = to === undefined ? source.length : source.indexOf(to);
  if (a < 0 || b < 0) throw new Error(`index.ts marker missing: ${a < 0 ? from : to}`);
  return source.slice(a, b);
};
const handlerNames = [...source.matchAll(/^  (\w+): handle\w+,$/gm)].map((m) => m[1]);
const entry = slice("Deno.serve(async (req: Request)");
const moduleSource = `
const ACCOUNTING_TOOLS = [];
const OWNER_STATEMENT_TOOLS = [];
type CallerContext = { userId?: string; scopes?: string[]; oauthToken?: string };
const ACCOUNTING_TOOL_NAME = 'accounting_books';
const RECORD_OWNER_STATEMENT = 'record_owner_statement';
const READ_OWNER_STATEMENTS = 'read_owner_statements';
const callAccounting = async () => (globalThis as any).__accountingResult;
const SUPABASE_URL = "https://example.supabase.co";
const SERVICE_ROLE_KEY = "sb_secret_test_key";
const projectSecretKey = () => SERVICE_ROLE_KEY;
const getSupabase = () => ({
  rpc: async () => (globalThis as any).__apiKeyCheck ?? ({ data: { allowed: false }, error: null }),
  // The admin_users lookup (isPrivilegedCaller): its filters are recorded and handed to the test's stand-in.
  from: (table: string) => {
    const filters: Record<string, unknown> = {};
    const q = {
      select: () => q,
      eq: (column: string, value: unknown) => { filters[column] = value; return q; },
      limit: async () => (globalThis as any).__adminLookup(table, filters),
    };
    return q;
  },
});
const scopeAllowsWriteTier = (globalThis as any).__scopeAllowsWriteTier;
const requireWriteAuth = (globalThis as any).__requireWriteAuth;
const requireAdminOrService = (globalThis as any).__requireAdminOrService;
type WriteTier = string;
// Advisor surface: the real surface test (advisor/mod.ts), and a spy in place of the advisor's own handlers.
const isAdvisorSurface = (globalThis as any).__isAdvisorSurface as (req: Request) => boolean;
const checkAdvisorRateLimit = (_req: Request) => ({ ok: true as const });
const advisorCalls: Array<{ method?: string; params?: { name?: string }; publicCaller?: boolean }> = [];
const handleAdvisorJsonRpc = async (body: any, opts: { publicCaller?: boolean } = {}) => {
  advisorCalls.push({ ...body, publicCaller: opts.publicCaller === true });
  return body?.id === undefined || body?.id === null ? null : { jsonrpc: "2.0", id: body.id, result: { advisor: true } };
};
const initAdvisorHandlers = (_deps: unknown) => {};
const callEdgeApi = async () => ({});
` + slice("const CORS = {", "// ── Edge Function Proxy") + slice("interface JsonRpcRequest", "const sb = ()") + `
const calls: Array<{ name: string; args: Record<string, unknown>; caller?: unknown }> = [];
const TOOL_HANDLERS = Object.fromEntries(${JSON.stringify(handlerNames)}.map((name: string) =>
  [name, async (args: Record<string, unknown>, caller?: unknown) => { calls.push({ name, args, caller }); return toolOk({ name, args }); }]));
` + slice("const SERVER_INFO", "// HTTP ENTRY POINT") + `
export const handle = ` + entry.slice("Deno.serve".length) + `
export { calls, advisorCalls };
`;
(globalThis as Record<string, unknown>).__scopeAllowsWriteTier = scopeAllowsWriteTier;
(globalThis as Record<string, unknown>).__isAdvisorSurface = isAdvisorSurface;
// Stand-in for admin_users: ADMIN has an active row, nobody else does. It records what the connector asked for.
const ADMIN = "20000000-0000-4000-8000-00000000000a";
const NOT_ADMIN = "10000000-0000-4000-8000-000000000001";
const adminLookups: Array<{ table: string; filters: Record<string, unknown> }> = [];
let adminLookupFails = false;
(globalThis as Record<string, unknown>).__adminLookup = (table: string, filters: Record<string, unknown>) => {
  adminLookups.push({ table, filters });
  if (adminLookupFails) return { data: null, error: { message: "admin_users unavailable" } };
  const hit = table === "admin_users" && filters.is_active === true && filters.user_id === ADMIN;
  return { data: hit ? [{ user_id: ADMIN }] : [], error: null };
};
// Stand-ins for the real _shared/writeGuard helpers (verified against the project JWKS + admin_users there; proven in
// writeGuard.test.ts). They encode the contract the connector relies on, keyed off the Authorization header, so this
// test proves execute_sql is routed through requireWriteAuth then requireAdminOrService and honors their verdicts:
//   Bearer sb_secret_test_key → service key (both pass)        Bearer admin-jwt  → verified admin (both pass)
//   Bearer user-jwt          → verified non-admin (writeAuth passes, admin check 403)   anything else → no token (writeAuth 401)
const PASSES_WRITE = new Set(["Bearer sb_secret_test_key", "Bearer admin-jwt", "Bearer user-jwt"]);
const IS_ADMIN_OR_SERVICE = new Set(["Bearer sb_secret_test_key", "Bearer admin-jwt"]);
(globalThis as Record<string, unknown>).__requireWriteAuth = async (req: Request) =>
  PASSES_WRITE.has(req.headers.get("authorization") ?? "")
    ? null
    : new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="nuke", resource_metadata="https://nuke.ag/.well-known/oauth-protected-resource"' } });
(globalThis as Record<string, unknown>).__requireAdminOrService = async (req: Request) =>
  IS_ADMIN_OR_SERVICE.has(req.headers.get("authorization") ?? "")
    ? null
    : new Response(JSON.stringify({ error: "forbidden", reason: "admins only" }), { status: 403 });
const connector = await import(`data:application/typescript,${encodeURIComponent(moduleSource)}`);
const handle = connector.handle as (req: Request) => Promise<Response>;
const calls = connector.calls as Array<{ name: string; args: Record<string, unknown>; caller?: { userId?: string; scopes?: string[]; oauthToken?: string } }>;
const advisorCalls = connector.advisorCalls as Array<{ method?: string; params?: { name?: string }; publicCaller?: boolean }>;
const dispatched = () => calls.length;
const advised = () => advisorCalls.length;
// The gate's own lists, read from index.ts so this file cannot drift from them.
const listed = (declaration: string, close: string, pattern: RegExp) => {
  const a = source.indexOf(declaration), b = source.indexOf(close, a);
  if (a < 0 || b < 0) throw new Error(`index.ts marker missing: ${declaration}`);
  return [...source.slice(a, b).matchAll(pattern)].map((m) => m[1]);
};
const WRITE_TIER_TOOLS = listed("const WRITE_TIERS: Record<string, WriteTier> = {", "};", /^\s+(\w+): "/gm);
const SIGN_IN_TOOLS = listed("const SIGN_IN_READ_TOOLS = new Set([", "]);", /"(\w+)"/g);
const SQL_TOOLS = listed("const ADMIN_OR_SERVICE_TOOLS = new Set([", "]);", /"(\w+)"/g);
// Pinned here on purpose: a tool joins this list only with proof that it returns nothing a logged-out visitor may
// not read (see PUBLIC_TOOLS in index.ts).
const PUBLIC_TOOLS = ["get_attribute_checklist", "get_event_checklist", "get_event_schema", "query_library"];
// The advisor tools a visitor may call, in the public scope (advisor/public.ts; audited 2026-11-21). Pinned on purpose.
const ADVISOR_PUBLIC = ["budget_options", "evaluate_listing", "find_asset", "get_asset", "get_comps", "value_asset"];
const ADVISOR_PUBLIC_IN_SOURCE = listed("const ADVISOR_PUBLIC_TOOLS = new Set([", "]);", /"(\w+)"/g);
const sorted = (names: string[]) => JSON.stringify([...names].sort());
const FN = "https://example.supabase.co/functions/v1/mcp-connector";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
// A token exactly as the retired /token minted it: HS256 over the service key, type access_token, 90 days.
async function retiredFormatToken(): Promise<string> {
  const enc = new TextEncoder();
  const now = Math.floor(Date.now() / 1000);
  const hdr = b64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const pay = b64url(enc.encode(JSON.stringify({
    type: "access_token", sub: "claude-ai", scope: "read write:observations write:canonical", iat: now, exp: now + 90 * 86400,
  })));
  const key = await crypto.subtle.importKey("raw", enc.encode("sb_secret_test_key"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${hdr}.${pay}`)));
  return `${hdr}.${pay}.${b64url(sig)}`;
}
const toolCall = (name: string, args: Record<string, unknown>, headers: Record<string, string> = {}) =>
  handle(new Request(FN, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  }));

Deno.test("the connector issues no authorization codes, tokens or client registrations", async () => {
  const authorize = await handle(new Request(`${FN}/authorize?redirect_uri=https://example.invalid/cb&state=s&code_challenge=x`));
  assert(authorize.status === 404, `GET /authorize: ${authorize.status}`);
  assert(authorize.headers.get("location") === null, "GET /authorize redirected");
  const asMeta = await handle(new Request(`${FN}/.well-known/oauth-authorization-server`));
  assert(asMeta.status === 404, `authorization server metadata: ${asMeta.status}`);
  for (const route of ["token", "register"]) {
    const res = await handle(new Request(`${FN}/${route}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=authorization_code&code=anything",
    }));
    const body = await res.text();
    assert(res.status === 404, `POST /${route}: ${res.status}`);
    assert(!body.includes("access_token") && !body.includes("client_secret"), `POST /${route} returned a credential`);
  }
  const rsMeta = await handle(new Request(`${FN}/.well-known/oauth-protected-resource`));
  const meta = await rsMeta.json();
  assert(rsMeta.status === 200 && JSON.stringify(meta.authorization_servers) === '["https://nuke.ag"]',
    `protected resource metadata names ${JSON.stringify(meta.authorization_servers)}`);
});

Deno.test("a token in the retired format is refused on write and read tools; the service key and the public tools still work", async () => {
  const forged = await retiredFormatToken();
  calls.length = 0;
  for (const name of ["create_profile", "submit_observation", "search_vehicles"]) {
    const res = await toolCall(name, { query: "porsche" }, { authorization: `Bearer ${forged}` });
    assert(res.status === 401, `${name} with a retired-format token: ${res.status}`);
  }
  assert(dispatched() === 0, `dispatched with a retired-format token: ${JSON.stringify(calls)}`);

  const unknown = await toolCall("search_vehicles", { query: "porsche" }, { authorization: "Bearer not-a-key" });
  assert(unknown.status === 401, `unknown bearer: ${unknown.status}`);
  // A credential that does not verify never falls back to the no-credential path, not even on a public tool.
  for (const headers of [{ authorization: "Bearer not-a-key" }, { "x-api-key": "nk_live_not_a_key" }] as Array<Record<string, string>>) {
    const res = await toolCall("query_library", { type: "paint_codes" }, headers);
    assert(res.status === 401 && dispatched() === 0, `a public tool with a credential that does not verify: ${res.status}`);
  }

  const noAuthWrite = await toolCall("submit_observation", {});
  assert(noAuthWrite.status === 401 && (noAuthWrite.headers.get("www-authenticate") ?? "").includes("nuke.ag"),
    `write without auth: ${noAuthWrite.status} ${noAuthWrite.headers.get("www-authenticate")}`);

  const closed = await toolCall("search_vehicles", { query: "porsche" });
  assert(closed.status === 401 && dispatched() === 0, `a service-client read with no credential: ${closed.status}`);
  const read = await toolCall("query_library", { type: "paint_codes" });
  assert(read.status === 200 && dispatched() === 1 && calls[0].name === "query_library", `a public tool with no credential: ${read.status}`);

  const service = await toolCall("create_profile", { name: "probe" }, { authorization: "Bearer sb_secret_test_key" });
  assert(service.status === 200 && dispatched() === 2 && calls[1].name === "create_profile", `service key: ${service.status}`);
});

Deno.test("execute_sql is gated like nlq-sql: anonymous 401, signed-in non-admin 403, verified admin 200, service key 200", async () => {
  calls.length = 0;

  const anonymous = await toolCall("execute_sql", { query: "select 1" });
  assert(anonymous.status === 401 && (anonymous.headers.get("www-authenticate") ?? "").includes("nuke.ag"),
    `execute_sql without auth: ${anonymous.status}`);

  // A signed-in non-admin (a verified user JWT, no admin_users row): passes requireWriteAuth, refused by the admin check.
  const nonAdmin = await toolCall("execute_sql", { query: "select 1" }, { authorization: "Bearer user-jwt" });
  assert(nonAdmin.status === 403, `execute_sql as a signed-in non-admin: ${nonAdmin.status}`);

  // An API key (admin scope or not): no Authorization bearer, so requireWriteAuth refuses it — like nlq-sql.
  const adminKey = await toolCall("execute_sql", { query: "select 1" }, { "x-api-key": "nk_live_probe" });
  assert(adminKey.status === 401, `execute_sql with an API key: ${adminKey.status}`);

  // A tool name that is not a string cannot be coerced into a gated name (typeof check in both the gate and
  // handleToolsCall). With no auth it is refused like every tool that is not public. With the service key it
  // reaches the dispatcher, which rejects it before any handler runs.
  const oddCall = (headers: Record<string, string> = {}) => handle(new Request(FN, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: ["execute_sql"], arguments: {} } }),
  }));
  const odd = await oddCall();
  assert(odd.status === 401, `a tool name that is not a string, no credential: ${odd.status}`);
  const oddBody = await (await oddCall({ authorization: "Bearer sb_secret_test_key" })).json();
  assert(oddBody.error?.code === -32602, `a tool name that is not a string, service key: ${JSON.stringify(oddBody)}`);
  assert(dispatched() === 0, `execute_sql dispatched before an allowed caller: ${JSON.stringify(calls)}`);

  // A verified active admin (via the connector's own OAuth/JWT path): allowed.
  const admin = await toolCall("execute_sql", { query: "select 1" }, { authorization: "Bearer admin-jwt" });
  assert(admin.status === 200 && dispatched() === 1 && calls[0].name === "execute_sql", `verified admin: ${admin.status}`);

  // The service key: allowed.
  const service = await toolCall("execute_sql", { query: "select 1" }, { authorization: "Bearer sb_secret_test_key" });
  assert(service.status === 200 && dispatched() === 2 && calls[1].name === "execute_sql", `service key: ${service.status}`);
});

Deno.test('accounting authentication failure provides a reconnect challenge', async () => {
 (globalThis as any).__accountingResult = { authenticationRequired: true, isError: true, content: [] };
 const result = await toolCall('accounting_books', { action: 'contexts' });
 assert(result.status === 401, 'missing accounting credential did not challenge');
 assert(!!result.headers.get('WWW-Authenticate')?.includes('oauth-protected-resource'), 'missing resource challenge');
});
Deno.test('opaque accounting scope permits the public tools but no other reads, generic writes or SQL', async () => {
 (globalThis as any).__apiKeyCheck = { data: { allowed: true, user_id: 'member', key_id: 'key', scopes: ['accounting:read','accounting:correct'] }, error: null };
 const headers = { authorization: 'Bearer nuke_oauth_' + 'a'.repeat(64) };
 const read = await toolCall('query_library', { type: 'paint_codes' }, headers);
 assert(read.status === 200, 'valid opaque credential refused a public tool');
 const closed = await toolCall('search_vehicles', { query: 'synthetic' }, headers);
 assert(closed.status === 403, 'accounting scope reached a tool that reads through the service client');
 const write = await toolCall('submit_observation', {}, headers);
 assert(write.status === 403, 'accounting scope became generic write permission');
 const sql = await toolCall('execute_sql', { query: 'select 1' }, headers);
 assert(sql.status === 401 || sql.status === 403, 'accounting scope became SQL permission');
 (globalThis as any).__apiKeyCheck = undefined;
});

Deno.test('private accounting bridge cannot bypass the ChatGPT public surface allowlist', async () => {
 (globalThis as any).__accountingResult = { content: [{ type: 'text', text: 'private result' }] };
 const response = await toolCall('accounting_books', { action: 'contexts' }, { 'x-nuke-surface': 'chatgpt' });
 const result = await response.json();
 assert(result.error?.code === -32602, 'private accounting tool bypassed curated surface');
 assert(!JSON.stringify(result).includes('private result'), 'private bridge dispatched');
});

Deno.test('owner-statement tools need a sign-in and hand the handler only what this request presented', async () => {
 calls.length = 0;
 // No credential: both tools answer 401 with the login challenge, the reader included, and nothing is dispatched.
 for (const name of ['record_owner_statement', 'read_owner_statements']) {
  const anonymous = await toolCall(name, {});
  assert(anonymous.status === 401 && (anonymous.headers.get('www-authenticate') ?? '').includes('nuke.ag'), `${name} without auth: ${anonymous.status}`);
 }
 assert(dispatched() === 0, 'an owner-statement tool dispatched without a credential');

 // A login token without a write scope cannot reach the writer.
 const token = 'nuke_oauth_' + 'b'.repeat(64);
 const headers = { authorization: `Bearer ${token}` };
 (globalThis as any).__apiKeyCheck = { data: { allowed: true, user_id: '10000000-0000-4000-8000-000000000001', key_id: 'key', scopes: ['read'] }, error: null };
 const readOnlyWrite = await toolCall('record_owner_statement', { statement: 'synthetic' }, headers);
 assert(readOnlyWrite.status === 403 && dispatched() === 0, `read-only login reached the writer: ${readOnlyWrite.status}`);
 const read = await toolCall('read_owner_statements', {}, headers);
 assert(read.status === 200 && dispatched() === 1, `read-scoped login refused the reader: ${read.status}`);
 assert(calls[0].caller?.oauthToken === token && calls[0].caller?.userId === '10000000-0000-4000-8000-000000000001',
  'the handler must receive this request\'s own token and the user it resolved to');

 // With the write scope the writer is dispatched with the same context; arguments never carry an identity.
 (globalThis as any).__apiKeyCheck = { data: { allowed: true, user_id: '10000000-0000-4000-8000-000000000001', key_id: 'key', scopes: ['read', 'write:observations'] }, error: null };
 const write = await toolCall('record_owner_statement', { statement: 'synthetic' }, headers);
 assert(write.status === 200 && dispatched() === 2 && calls[1].caller?.oauthToken === token, `scoped login refused the writer: ${write.status}`);

 assert(write.headers.get('cache-control') === 'no-store' && read.headers.get('cache-control') === 'no-store', 'a private statement response must not be cached');
 // The public ChatGPT surface refuses both tools even for a fully scoped login: the allowlist, not the login gate.
 for (const name of ['record_owner_statement', 'read_owner_statements']) {
  const before = dispatched();
  const curated = await toolCall(name, { statement: 'synthetic' }, { ...headers, 'x-nuke-surface': 'chatgpt' });
  assert((await curated.json()).error?.code === -32602 && dispatched() === before, `${name} reachable on the public surface with a login`);
 }

 // An API key authenticates but carries no login token; the service key carries none either.
 const apiKey = await toolCall('read_owner_statements', {}, { 'x-api-key': 'nk_live_probe' });
 assert(apiKey.status === 200 && calls[2].caller?.oauthToken === undefined, 'an API key was passed on as a login token');
 (globalThis as any).__apiKeyCheck = undefined;
 const service = await toolCall('read_owner_statements', {}, { authorization: 'Bearer sb_secret_test_key' });
 assert(service.status === 200 && calls[3].caller?.oauthToken === undefined && calls[3].caller?.userId === 'service-role',
  'the service key was given a speaker');
 // The public tools are unaffected: a call with no credential still dispatches with no caller.
 const open = await toolCall('query_library', { type: 'paint_codes' });
 assert(open.status === 200 && calls[4].caller === undefined, 'a public tool with no credential gained a caller');
});

Deno.test("with no credential only the four public tools run; every other tool answers 401 with the login challenge", async () => {
  calls.length = 0;
  const ran: string[] = [];
  for (const name of handlerNames) {
    const before = dispatched();
    const res = await toolCall(name, {});
    if (dispatched() > before) { ran.push(name); continue; }
    assert(res.status === 401 && (res.headers.get("www-authenticate") ?? "").includes("nuke.ag"),
      `${name} with no credential: ${res.status} ${res.headers.get("www-authenticate")}`);
  }
  assert(handlerNames.length >= 56, `index.ts lists ${handlerNames.length} tools; the handler pattern no longer matches`);
  assert(sorted(ran) === sorted(PUBLIC_TOOLS), `tools that ran with no credential: ${ran.join(", ")}`);
  // A name the server does not know, and names every object inherits, are refused the same way and reach no handler.
  for (const name of ["no_such_tool", "constructor", "toString", "hasOwnProperty", "__proto__"]) {
    const res = await toolCall(name, {});
    assert(res.status === 401 && dispatched() === ran.length, `${name} with no credential: ${res.status}`);
  }
});

Deno.test("a valid credential that is not an admin's is refused every tool that reads through the service client", async () => {
  calls.length = 0;
  adminLookups.length = 0;
  (globalThis as any).__apiKeyCheck = { data: { allowed: true, user_id: NOT_ADMIN, key_id: "key", scopes: ["read", "write:observations", "write:canonical"] }, error: null };
  const headers = { authorization: "Bearer nuke_oauth_" + "c".repeat(64) };
  const ran: string[] = [];
  for (const name of handlerNames) {
    const before = dispatched();
    const res = await toolCall(name, {}, headers);
    if (dispatched() > before) { ran.push(name); continue; }
    // execute_sql is judged by writeGuard, which answers 401 to anything that is not a verified JWT or the service key.
    assert(res.status === 403 || (SQL_TOOLS.includes(name) && res.status === 401), `${name} as a signed-in non-admin: ${res.status}`);
    assert(!res.headers.get("www-authenticate") || SQL_TOOLS.includes(name), `${name}: a valid credential was sent back to log in`);
  }
  // What stays open to it: the public tools, the write tiers its scopes cover, and the reader of its own statements.
  assert(sorted(ran) === sorted([...PUBLIC_TOOLS, ...WRITE_TIER_TOOLS, ...SIGN_IN_TOOLS]),
    `tools a signed-in non-admin reached: ${ran.join(", ")}`);
  assert(WRITE_TIER_TOOLS.length === 9 && SIGN_IN_TOOLS.length === 1 && SQL_TOOLS.length === 1,
    `gate lists read from index.ts: ${WRITE_TIER_TOOLS.length} write, ${SIGN_IN_TOOLS.length} sign-in, ${SQL_TOOLS.length} SQL`);
  assert(adminLookups.length > 0 && adminLookups.every((l) =>
    l.table === "admin_users" && l.filters.user_id === NOT_ADMIN && l.filters.is_active === true),
    `the admin lookup must ask for this caller's active row: ${JSON.stringify(adminLookups.slice(0, 2))}`);

  // A name every object inherits is not a write tier, whatever the scopes: it is refused like an unknown tool.
  for (const name of ["constructor", "toString", "hasOwnProperty", "__proto__", "no_such_tool"]) {
    const res = await toolCall(name, {}, headers);
    assert(res.status === 403 && dispatched() === ran.length, `${name} as a signed-in non-admin with every write scope: ${res.status}`);
  }

  // An agent key with no user behind it is never an admin, and nothing is looked up for it.
  (globalThis as any).__apiKeyCheck = { data: { allowed: true, user_id: null, agent_registration_id: "a1", key_id: "key" }, error: null };
  adminLookups.length = 0;
  const before = dispatched();
  const agent = await toolCall("search_vehicles", { query: "synthetic" }, { "x-api-key": "nk_live_agent" });
  assert(agent.status === 403 && adminLookups.length === 0 && dispatched() === before, `an agent key with no user: ${agent.status}`);

  // If admin_users cannot be read, an admin's own credential is refused too: only the service key passes.
  (globalThis as any).__apiKeyCheck = { data: { allowed: true, user_id: ADMIN, key_id: "key", scopes: ["read"] }, error: null };
  adminLookupFails = true;
  const unreadable = await toolCall("search_vehicles", { query: "synthetic" }, headers);
  adminLookupFails = false;
  assert(unreadable.status === 403 && dispatched() === before, `admin lookup failed open: ${unreadable.status}`);
  const service = await toolCall("search_vehicles", { query: "synthetic" }, { authorization: "Bearer sb_secret_test_key" });
  assert(service.status === 200 && dispatched() === before + 1, `service key: ${service.status}`);
  (globalThis as any).__apiKeyCheck = undefined;
});

Deno.test("an active admin's credential and the service key reach every tool that reads through the service client", async () => {
  const closedByDefault = handlerNames.filter((name) =>
    !PUBLIC_TOOLS.includes(name) && !WRITE_TIER_TOOLS.includes(name) && !SIGN_IN_TOOLS.includes(name) && !SQL_TOOLS.includes(name));
  assert(closedByDefault.length === handlerNames.length - 15, `tools closed by default: ${closedByDefault.length}`);
  (globalThis as any).__apiKeyCheck = { data: { allowed: true, user_id: ADMIN, key_id: "key", scopes: ["read"] }, error: null };
  for (const headers of [{ authorization: "Bearer nuke_oauth_" + "d".repeat(64) }, { "x-api-key": "nk_live_admin" }] as Array<Record<string, string>>) {
    calls.length = 0;
    for (const name of closedByDefault) {
      const res = await toolCall(name, {}, headers);
      assert(res.status === 200, `${name} as an active admin: ${res.status}`);
    }
    assert(dispatched() === closedByDefault.length && calls.every((c) => c.caller?.userId === ADMIN),
      "an admin's call must reach the handler with the admin as its caller");
  }
  (globalThis as any).__apiKeyCheck = undefined;
  calls.length = 0;
  for (const name of closedByDefault) {
    const res = await toolCall(name, {}, { authorization: "Bearer sb_secret_test_key" });
    assert(res.status === 200, `${name} with the service key: ${res.status}`);
  }
  assert(dispatched() === closedByDefault.length && calls.every((c) => c.caller?.userId === "service-role"), "service key calls");
});

Deno.test("advisor surface: a visitor's call runs in the public scope, an admin's and the service key's in the full one; an unknown tool stays closed", async () => {
  const advisor = (how: string, body: unknown, headers: Record<string, string> = {}) =>
    handle(new Request(how === "path" ? `${FN}/advisor` : how === "query" ? `${FN}?surface=advisor` : FN, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", ...(how === "header" ? { "x-nuke-surface": "advisor" } : {}), ...headers },
      body: JSON.stringify(body),
    }));
  const call = (name: string) => ({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: { asset_id: "synthetic" } } });
  const login = { authorization: "Bearer nuke_oauth_" + "e".repeat(64) };
  assert(ADVISOR_TOOL_NAMES.size === 6, `advisor tools: ${ADVISOR_TOOL_NAMES.size}`);
  assert(sorted(ADVISOR_PUBLIC_IN_SOURCE) === sorted(ADVISOR_PUBLIC), `ADVISOR_PUBLIC_TOOLS drifted: ${sorted(ADVISOR_PUBLIC_IN_SOURCE)}`);
  for (const name of ADVISOR_PUBLIC) assert(ADVISOR_TOOL_NAMES.has(name), `public advisor tool ${name} is not in the catalog`);
  for (const how of ["path", "header", "query"]) {
    calls.length = 0;
    advisorCalls.length = 0;
    // An unknown name is closed: no credential 401 with the login challenge, a non-admin credential 403.
    (globalThis as any).__apiKeyCheck = undefined;
    const unknownAnon = await advisor(how, call("no_such_tool"));
    assert(unknownAnon.status === 401 && (unknownAnon.headers.get("www-authenticate") ?? "").includes("nuke.ag"),
      `advisor no_such_tool by ${how}, no credential: ${unknownAnon.status}`);
    (globalThis as any).__apiKeyCheck = { data: { allowed: true, user_id: NOT_ADMIN, key_id: "key", scopes: ["read"] }, error: null };
    const unknownMember = await advisor(how, call("no_such_tool"), login);
    assert(unknownMember.status === 403, `advisor no_such_tool by ${how}, signed-in non-admin: ${unknownMember.status}`);
    assert(advised() === 0 && dispatched() === 0, `advisor by ${how}: a refused call reached a handler`);

    for (const name of ADVISOR_TOOL_NAMES) {
      advisorCalls.length = 0;
      (globalThis as any).__apiKeyCheck = undefined;
      const anonymous = await advisor(how, call(name));
      assert(anonymous.status === 200 && advised() === 1 && advisorCalls[0].publicCaller === true,
        `advisor ${name} by ${how}, no credential: ${anonymous.status} public=${advisorCalls[0]?.publicCaller}`);
      const unverified = await advisor(how, call(name), { authorization: "Bearer not-a-key" });
      assert(unverified.status === 401 && advised() === 1, `advisor ${name} by ${how}, a credential that does not verify: ${unverified.status}`);
      (globalThis as any).__apiKeyCheck = { data: { allowed: true, user_id: NOT_ADMIN, key_id: "key", scopes: ["read"] }, error: null };
      const member = await advisor(how, call(name), login);
      assert(member.status === 200 && advised() === 2 && advisorCalls[1].publicCaller === true,
        `advisor ${name} by ${how}, signed-in non-admin: ${member.status} public=${advisorCalls[1]?.publicCaller}`);
      (globalThis as any).__apiKeyCheck = { data: { allowed: true, user_id: ADMIN, key_id: "key", scopes: ["read"] }, error: null };
      const admin = await advisor(how, call(name), login);
      assert(admin.status === 200 && advised() === 3 && advisorCalls[2].publicCaller === false, `advisor ${name} by ${how}, admin: ${admin.status}`);
      (globalThis as any).__apiKeyCheck = undefined;
      const service = await advisor(how, call(name), { authorization: "Bearer sb_secret_test_key" });
      assert(service.status === 200 && advised() === 4 && advisorCalls[3].publicCaller === false, `advisor ${name} by ${how}, service key: ${service.status}`);
    }
    assert(dispatched() === 0, `advisor by ${how}: a call reached the full catalog`);

    // The protocol methods read no data and stay open with no credential.
    advisorCalls.length = 0;
    for (const method of ["initialize", "tools/list", "ping"]) {
      const res = await advisor(how, { jsonrpc: "2.0", id: 1, method });
      assert(res.status === 200, `advisor ${method} by ${how}, no credential: ${res.status}`);
    }
    assert(advised() === 3 && dispatched() === 0, `advisor by ${how}: protocol calls reaching the advisor handler: ${advised()}`);
  }
});

Deno.test("a body that is not one JSON-RPC request object is refused: a batch, null, a number, a string", async () => {
  calls.length = 0;
  advisorCalls.length = 0;
  const one = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_vehicle", arguments: { vehicle_id: "synthetic" } } };
  for (const payload of [[one], [one, one], [], null, 7, "tools/call", true]) {
    for (const url of [FN, `${FN}/advisor`]) {
      for (const headers of [{}, { authorization: "Bearer sb_secret_test_key" }] as Array<Record<string, string>>) {
        const res = await handle(new Request(url, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json", ...headers },
          body: JSON.stringify(payload),
        }));
        const body = await res.json();
        assert(res.status === 400 && body.error?.code === -32600, `${JSON.stringify(payload).slice(0, 30)} to ${url.slice(FN.length) || "/"}: ${res.status}`);
      }
    }
  }
  assert(dispatched() === 0 && advised() === 0, "a refused body reached a handler");
});
