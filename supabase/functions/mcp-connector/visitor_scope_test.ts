// Run: deno test --allow-read supabase/functions/mcp-connector/visitor_scope_test.ts
// The rule under test: a caller without owner rights reads what a logged-out visitor reads. These tests load the
// connector's own scope, client and handler code from index.ts (no server, no credentials, no network, no database):
// the privilege decision, sb() choosing the publishable-key client, the edge-proxy allowlist, query_library's table
// and row limits, the readiness tools never storing for a visitor, and the HTTP gate refusing visitors on tools that
// write or return one account's rows.
import { scopeAllowsWriteTier } from "../_shared/scopeGrammar.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
const slice = (from: string, to: string) => {
  const a = source.indexOf(from);
  const b = a < 0 ? -1 : source.indexOf(to, a + from.length);
  if (a < 0 || b < 0) throw new Error(`index.ts marker missing: ${a < 0 ? from : to}`);
  return source.slice(a, b);
};
const handlerNames = [...source.matchAll(/^  (\w+): handle\w+,$/gm)].map((m) => m[1]);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// A recording stand-in for a supabase-js client. Every builder call is logged; awaiting a builder answers with the
// result configured for its table (or an empty list).
type Log = Array<unknown[]>;
function fakeClient(kind: string, results: Record<string, unknown>, log: Log) {
  const builder = (table: string): unknown => {
    const b: unknown = new Proxy({}, {
      get(_t, prop) {
        if (prop === "then") {
          return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
            Promise.resolve(results[table] ?? { data: [], error: null }).then(res, rej);
        }
        return (...args: unknown[]) => {
          log.push([kind, String(prop), table, ...args]);
          return b;
        };
      },
    });
    return b;
  };
  return {
    kind,
    from(table: string) {
      log.push([kind, "from", table]);
      return builder(table);
    },
    rpc(fn: string, _params: unknown) {
      log.push([kind, "rpc", fn]);
      return Promise.resolve(results[`rpc:${fn}`] ?? { data: null, error: null });
    },
  };
}

const g = globalThis as Record<string, any>;
g.__results = {} as Record<string, unknown>;
g.__log = [] as Log;
g.__publishable = "sb_publishable_test";
g.__adminLookup = async () => ({ data: [], error: null });
g.__fetches = [] as string[];

const moduleSource = `
import { AsyncLocalStorage } from "node:async_hooks";
const SUPABASE_URL = "https://example.supabase.co";
const SERVICE_ROLE_KEY = "sb_secret_test_key";
const projectPublishableKey = () => (globalThis as any).__publishable;
const fakeClient = (globalThis as any).__fakeClient;
const createClient = (_url: string, key: string) =>
  fakeClient(key === SERVICE_ROLE_KEY ? "service" : "visitor:" + key, (globalThis as any).__results, (globalThis as any).__log);
const getSupabase = () => {
  const client = fakeClient("service", (globalThis as any).__results, (globalThis as any).__log);
  return { ...client, from: (table: string) => table === "admin_users"
    ? { select: () => ({ eq: (_c: string, id: string) => ({ eq: () => ({ limit: () => (globalThis as any).__adminLookup(id) }) }) }) }
    : client.from(table) };
};
const fetch = async (url: string) => { (globalThis as any).__fetches.push(url); return new Response("{}", { status: 200 }); };
` + slice("interface ToolContent", "interface ToolDef") +
  slice("// ── Caller scope", "// ── JSON-RPC Types") +
  slice("const sb = () =>", "\n// ── Schema Discovery") +
  slice("async function visitorVehicleArgs", "async function handleComputeValuation") +
  slice("const LIBRARY_TYPES", "async function handleSearchServiceManuals") +
  slice("async function handleGetAuctionReadiness(", "async function handleGetCoachingPlan(") +
  slice("async function handleGetProfile(", "async function handleLinkAccount(") +
  slice("async function handleSearchVehicles(", "async function handleSearchVehiclesAdvanced(") + `
export { callerScope, isPrivilegedCaller, sb, callEdgeFn, callEdgeApi, handleQueryLibrary, handleGetAuctionReadiness,
  handleGetProfile, handleGetValuation, handleSearchVehicles, VISITOR_EDGE_TARGETS };
`;
g.__fakeClient = fakeClient;
const c = await import(`data:application/typescript,${encodeURIComponent(moduleSource)}`);
const VID = "10000000-0000-4000-8000-0000000000aa";
const reset = (results: Record<string, unknown> = {}) => {
  g.__results = results;
  g.__log = [];
  g.__fetches = [];
};
const asText = (r: { content: Array<{ text: string }>; isError?: boolean }) => r.content[0].text;

Deno.test("privileged is the service key or an active admin row; every other caller and every lookup failure is not", async () => {
  const admin = "20000000-0000-4000-8000-000000000001";
  g.__adminLookup = async (id: string) => ({ data: id === admin ? [{ user_id: admin }] : [], error: null });
  assert(await c.isPrivilegedCaller("service-role") === true, "the service key is privileged");
  assert(await c.isPrivilegedCaller(admin) === true, "an active admin is privileged");
  assert(await c.isPrivilegedCaller("20000000-0000-4000-8000-000000000002") === false, "a signed-in non-admin is a visitor");
  assert(await c.isPrivilegedCaller("agent:abc") === false, "an agent key is a visitor");
  assert(await c.isPrivilegedCaller(undefined) === false, "no credential is a visitor");
  g.__adminLookup = async () => ({ data: null, error: { message: "boom" } });
  assert(await c.isPrivilegedCaller(admin) === false, "a lookup error is not privileged");
  g.__adminLookup = async () => { throw new Error("network"); };
  assert(await c.isPrivilegedCaller(admin) === false, "a thrown lookup is not privileged");
  g.__adminLookup = async () => ({ data: [], error: null });
});

Deno.test("sb() is the publishable-key client unless the scope acts as the service, and never falls back", () => {
  assert(c.sb().kind === "visitor:sb_publishable_test", "no scope must read as a visitor");
  assert(c.callerScope.run({ privileged: false }, () => c.sb().kind) === "visitor:sb_publishable_test", "a visitor scope");
  assert(c.callerScope.run({ privileged: true }, () => c.sb().kind) === "service", "a privileged scope reads as the service");
  assert(c.callerScope.run({ privileged: false, writer: true }, () => c.sb().kind) === "service",
    "a call that passed its write tier writes as the service");
  g.__publishable = undefined;
  let threw = false;
  try {
    c.sb();
  } catch {
    threw = true;
  }
  assert(threw, "no publishable key must throw, never hand out the service client");
  g.__publishable = "sb_publishable_test";
});

Deno.test("a visitor reaches only the public market proxies; ingest and extraction need a privileged caller", async () => {
  reset();
  for (const name of ["ingest-observation", "extract-vehicle-data-ai", "compute-vehicle-valuation", "identify-vehicle-from-image"]) {
    let refused = false;
    try {
      await c.callEdgeFn(name, {});
    } catch (e) {
      refused = String(e).includes("Sign in");
    }
    assert(refused, `${name} must be refused to a visitor`);
  }
  await c.callEdgeApi("comps", "", "POST", { make: "Porsche" });
  await c.callEdgeApi("valuations", "?vehicle_id=x");
  for (const path of ["/analyze", "/classify"]) {
    let refused = false;
    try {
      await c.callEdgeApi("vision", path, "POST", {});
    } catch {
      refused = true;
    }
    assert(refused, `api-v1-vision${path} can spend and is not open to a visitor`);
  }
  assert(g.__fetches.length === 2, `public proxies dispatched: ${g.__fetches.length}`);
  await c.callerScope.run({ privileged: true }, () => c.callEdgeFn("ingest-observation", {}));
  assert(g.__fetches.length === 3, "a privileged caller reaches ingest-observation");
});

Deno.test("query_library reads only its four documented tables, at most 100 rows, for every caller", async () => {
  for (const scope of [undefined, { privileged: true }]) {
    reset();
    const run = (args: Record<string, unknown>) =>
      scope ? c.callerScope.run(scope, () => c.handleQueryLibrary(args)) : c.handleQueryLibrary(args);
    for (const type of ["profiles", "vehicles", "admin_users", "undefined"]) {
      const r = await run({ type });
      assert(r.isError && asText(r).includes("paint_codes"), `${type} must be refused`);
    }
    assert(!g.__log.some((l: unknown[]) => l[1] === "from"), "a refused type must never be queried");
    await run({ type: "paint_codes", limit: 5000 });
    const limit = g.__log.find((l: unknown[]) => l[1] === "limit");
    assert(limit && limit[3] === 100, `limit must be capped at 100, got ${JSON.stringify(limit)}`);
    reset();
    await run({ type: "condition_taxonomy" });
    assert(g.__log.find((l: unknown[]) => l[1] === "limit")?.[3] === 25, "the default limit stays 25");
  }
});

Deno.test("a visitor gets readiness computed, never stored, and only for a vehicle it can see", async () => {
  reset({ vehicles: { data: [{ id: VID }], error: null }, auction_readiness: { data: null, error: null } });
  await c.handleGetAuctionReadiness({ vehicle_id: VID });
  const rpcs = g.__log.filter((l: unknown[]) => l[1] === "rpc").map((l: unknown[]) => l[2]);
  assert(JSON.stringify(rpcs) === '["compute_auction_readiness"]', `visitor rpcs: ${JSON.stringify(rpcs)}`);
  assert(g.__log.every((l: unknown[]) => String(l[0]).startsWith("visitor:")), "a visitor read went through the service");

  reset({ vehicles: { data: [], error: null }, auction_readiness: { data: null, error: null } });
  const hidden = await c.handleGetAuctionReadiness({ vehicle_id: VID });
  assert(hidden.isError && asText(hidden).includes("Vehicle not found"), "a vehicle the visitor cannot see is not found");
  assert(!g.__log.some((l: unknown[]) => l[1] === "rpc"), "nothing is computed for a hidden vehicle");

  reset({ vehicles: { data: [{ id: VID }], error: null }, auction_readiness: { data: null, error: null } });
  await c.callerScope.run({ privileged: true }, () => c.handleGetAuctionReadiness({ vehicle_id: VID }));
  const privileged = g.__log.filter((l: unknown[]) => l[1] === "rpc").map((l: unknown[]) => l[2]);
  assert(JSON.stringify(privileged) === '["persist_auction_readiness"]', `privileged rpcs: ${JSON.stringify(privileged)}`);
});

Deno.test("get_profile: a visitor cannot look a person up by email and reads only granted profile columns", async () => {
  reset({ profiles: { data: [{ id: VID }], error: null } });
  const byEmail = await c.handleGetProfile({ email: "someone@example.test" });
  assert(byEmail.isError && !g.__log.length, "an email lookup by a visitor must be refused before any read");
  await c.handleGetProfile({ user_id: VID });
  const select = g.__log.find((l: unknown[]) => l[1] === "select" && l[2] === "profiles");
  assert(select && !String(select[3]).includes("email") && !String(select[3]).includes("onboarded_via"),
    `visitor profile columns: ${JSON.stringify(select)}`);
  reset({ profiles: { data: [{ id: VID }], error: null } });
  await c.callerScope.run({ privileged: true }, () => c.handleGetProfile({ email: "someone@example.test" }));
  assert(g.__log.some((l: unknown[]) => l[0] === "service" && l[2] === "profiles"), "a privileged caller may look up by email");
});

Deno.test("get_valuation: a visitor's VIN is resolved through the visitor client before the service-key proxy", async () => {
  reset({ vehicles: { data: [], error: null } });
  const hidden = await c.handleGetValuation({ vin: "1HGCM82633A004352" });
  assert(hidden.isError && g.__fetches.length === 0, "a VIN the visitor cannot see must not reach the proxy");
  reset({ vehicles: { data: [{ id: VID }], error: null } });
  await c.handleGetValuation({ vin: "1HGCM82633A004352" });
  assert(g.__fetches.length === 1 && g.__fetches[0].includes(`vehicle_id=${VID}`) && !g.__fetches[0].includes("vin="),
    "the proxy is asked by the visible vehicle id");
});

Deno.test("a visitor's vehicle search reads every returned row through the visitor client", async () => {
  reset({ vehicles: { data: [{ id: VID, make: "Porsche" }], error: null } });
  const r = await c.handleSearchVehicles({ query: "porsche 911" });
  const rows = JSON.parse(asText(r)).results;
  assert(rows.length === 1 && rows[0].id === VID, `visitor rows: ${asText(r)}`);
  const service = g.__log.filter((l: unknown[]) => l[0] === "service");
  const visitor = g.__log.filter((l: unknown[]) => String(l[0]).startsWith("visitor:"));
  assert(service.some((l: unknown[]) => l[1] === "select" && l[3] === "id"), "the service client only finds candidate ids");
  assert(service.some((l: unknown[]) => l[1] === "eq" && l[3] === "is_public" && l[4] === true), "candidates are public vehicles");
  assert(visitor.some((l: unknown[]) => l[1] === "in" && l[3] === "id"), "the rows are read by id through the visitor client");
  reset({ vehicles: { data: [{ id: VID }], error: null } });
  await c.callerScope.run({ privileged: true }, () => c.handleSearchVehicles({ query: "porsche" }));
  assert(g.__log.every((l: unknown[]) => l[0] === "service") && !g.__log.some((l: unknown[]) => l[1] === "eq"),
    "a privileged search is unchanged");
});

// ── The HTTP gate, built from index.ts's real entry point (as oauth_test.ts does) ──────────────────────────────────
const entrySource = source.slice(source.indexOf("Deno.serve(async (req: Request)"));
const gateModule = `
import { AsyncLocalStorage } from "node:async_hooks";
const ACCOUNTING_TOOLS = [];
const OWNER_STATEMENT_TOOLS = [];
type CallerContext = { userId?: string; scopes?: string[]; oauthToken?: string };
const ACCOUNTING_TOOL_NAME = 'accounting_books';
const RECORD_OWNER_STATEMENT = 'record_owner_statement';
const READ_OWNER_STATEMENTS = 'read_owner_statements';
const callAccounting = async () => ({ content: [] });
const SUPABASE_URL = "https://example.supabase.co";
const SERVICE_ROLE_KEY = "sb_secret_test_key";
const projectSecretKey = () => SERVICE_ROLE_KEY;
const getSupabase = () => ({
  rpc: async () => (globalThis as any).__apiKeyCheck ?? ({ data: { allowed: false }, error: null }),
  from: () => ({ select: () => ({ eq: (_c: string, id: string) => ({ eq: () => ({ limit: () => (globalThis as any).__adminLookup(id) }) }) }) }),
});
const scopeAllowsWriteTier = (globalThis as any).__scopeAllowsWriteTier;
const requireWriteAuth = async () => new Response(null, { status: 401 });
const requireAdminOrService = async () => new Response(null, { status: 403 });
type WriteTier = string;
const isAdvisorSurface = (_req: Request) => false;
const checkAdvisorRateLimit = (_req: Request) => ({ ok: true as const });
const handleAdvisorJsonRpc = async (_body: unknown) => null;
const initAdvisorHandlers = (_deps: unknown) => {};
` + slice("const CORS = {", "// ── Edge Function Proxy") + slice("interface JsonRpcRequest", "const sb = ()") + `
const calls: Array<{ name: string; scope: unknown }> = [];
const TOOL_HANDLERS = Object.fromEntries(${JSON.stringify(handlerNames)}.map((name: string) =>
  [name, async (args: Record<string, unknown>) => { calls.push({ name, scope: callerScope.getStore() }); return toolOk({ name, args }); }]));
` + slice("const SERVER_INFO", "// HTTP ENTRY POINT") + `
export const handle = ` + entrySource.slice("Deno.serve".length) + `
export { calls };
`;
g.__scopeAllowsWriteTier = scopeAllowsWriteTier;
const gate = await import(`data:application/typescript,${encodeURIComponent(gateModule)}`);
const FN = "https://example.supabase.co/functions/v1/mcp-connector";
const toolCall = (name: string, headers: Record<string, string> = {}) =>
  gate.handle(new Request(FN, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} } }),
  })) as Promise<Response>;

const WRITES_OR_ACCOUNT_ROWS = [
  "confirm_work_session", "project_invoice", "project_work_log", "project_money_flow", "propose_attribute",
  "analyze_image", "compute_valuation", "identify_vehicle_image", "extract_listing",
];
const PRIVILEGED_ONLY = [
  "confirm_work_session", "project_invoice", "project_work_log", "project_money_flow", "compute_valuation",
  "identify_vehicle_image", "extract_listing", "analyze_image",
];

Deno.test("a caller with no credential is sent to sign in on every tool that writes or returns one account's rows", async () => {
  gate.calls.length = 0;
  for (const name of WRITES_OR_ACCOUNT_ROWS) {
    const res = await toolCall(name);
    assert(res.status === 401 && (res.headers.get("www-authenticate") ?? "").includes("nuke.ag"), `${name}: ${res.status}`);
  }
  assert(gate.calls.length === 0, `dispatched without a credential: ${JSON.stringify(gate.calls)}`);
  const open = await toolCall("get_vehicle");
  assert(open.status === 200 && gate.calls.length === 1, "an anonymous public read still dispatches");
  assert(JSON.stringify(gate.calls[0].scope) === '{"privileged":false}', `anonymous scope: ${JSON.stringify(gate.calls[0].scope)}`);
});

Deno.test("an agent key or signed-in non-admin is a visitor: refused on privileged tools, visitor scope on reads", async () => {
  gate.calls.length = 0;
  g.__adminLookup = async () => ({ data: [], error: null });
  g.__apiKeyCheck = { data: { allowed: true, user_id: "30000000-0000-4000-8000-000000000003", key_id: "k", scopes: ["read", "write:observations"] }, error: null };
  const key = { "x-api-key": "nk_live_probe" };
  for (const name of PRIVILEGED_ONLY) {
    const res = await toolCall(name, key);
    assert(res.status === 403, `${name} for a non-admin: ${res.status}`);
  }
  assert(gate.calls.length === 0, "a privileged-only tool dispatched for a non-admin");
  const read = await toolCall("get_vehicle", key);
  assert(read.status === 200 && JSON.stringify(gate.calls[0].scope) === '{"privileged":false,"writer":false}',
    `non-admin read scope: ${JSON.stringify(gate.calls[0].scope)}`);
  const propose = await toolCall("propose_attribute", key);
  assert(propose.status === 200 && JSON.stringify(gate.calls[1].scope) === '{"privileged":false,"writer":true}',
    "propose_attribute runs as a writer for a key holding write:observations");
  g.__apiKeyCheck = { data: { allowed: true, user_id: "30000000-0000-4000-8000-000000000003", key_id: "k", scopes: ["read"] }, error: null };
  const readOnly = await toolCall("propose_attribute", key);
  assert(readOnly.status === 403 && gate.calls.length === 2, "propose_attribute needs write:observations");

  g.__adminLookup = async () => ({ data: [{ user_id: "30000000-0000-4000-8000-000000000003" }], error: null });
  const admin = await toolCall("project_money_flow", key);
  assert(admin.status === 200 && JSON.stringify(gate.calls[2].scope) === '{"privileged":true,"writer":false}',
    "an active admin runs a privileged tool as privileged");
  g.__apiKeyCheck = undefined;
  g.__adminLookup = async () => ({ data: [], error: null });

  const service = await toolCall("confirm_work_session", { authorization: "Bearer sb_secret_test_key" });
  assert(service.status === 200 && JSON.stringify(gate.calls[3].scope) === '{"privileged":true,"writer":false}',
    "the service key is privileged");
});
