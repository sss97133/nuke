// Run: deno test --allow-read supabase/functions/mcp-connector/oauth_test.ts
// The connector's real HTTP entry point, built from index.ts without starting a server, reading credentials or
// reaching the database (tool handlers are spies, the service key is a test value). It holds the 2026-10-14 repair:
// this function issues no tokens (its /authorize approved every request without a login and minted 90-day
// write:canonical tokens signed with the service key), and a token in that old format is refused.
import { scopeAllowsWriteTier } from "../_shared/scopeGrammar.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
const slice = (from: string, to?: string) => {
  const a = source.indexOf(from), b = to === undefined ? source.length : source.indexOf(to);
  if (a < 0 || b < 0) throw new Error(`index.ts marker missing: ${a < 0 ? from : to}`);
  return source.slice(a, b);
};
const handlerNames = [...source.matchAll(/^  (\w+): handle\w+,$/gm)].map((m) => m[1]);
const entry = slice("Deno.serve(async (req: Request)");
const moduleSource = `
const SUPABASE_URL = "https://example.supabase.co";
const SERVICE_ROLE_KEY = "sb_secret_test_key";
const projectSecretKey = () => SERVICE_ROLE_KEY;
const getSupabase = () => ({ rpc: async () => ({ data: { allowed: false }, error: null }) });
const scopeAllowsWriteTier = (globalThis as any).__scopeAllowsWriteTier;
type WriteTier = string;
` + slice("const CORS = {", "// ── Edge Function Proxy") + slice("interface JsonRpcRequest", "const sb = ()") + `
const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
const TOOL_HANDLERS = Object.fromEntries(${JSON.stringify(handlerNames)}.map((name: string) =>
  [name, async (args: Record<string, unknown>) => { calls.push({ name, args }); return toolOk({ name, args }); }]));
` + slice("const SERVER_INFO", "// HTTP ENTRY POINT") + `
export const handle = ` + entry.slice("Deno.serve".length) + `
export { calls };
`;
(globalThis as Record<string, unknown>).__scopeAllowsWriteTier = scopeAllowsWriteTier;
const connector = await import(`data:application/typescript,${encodeURIComponent(moduleSource)}`);
const handle = connector.handle as (req: Request) => Promise<Response>;
const calls = connector.calls as Array<{ name: string; args: Record<string, unknown> }>;
const dispatched = () => calls.length;
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

Deno.test("a token in the retired format is refused on write and read tools; the service key and anonymous reads still work", async () => {
  const forged = await retiredFormatToken();
  calls.length = 0;
  for (const name of ["create_profile", "submit_observation", "search_vehicles"]) {
    const res = await toolCall(name, { query: "porsche" }, { authorization: `Bearer ${forged}` });
    assert(res.status === 401, `${name} with a retired-format token: ${res.status}`);
  }
  assert(dispatched() === 0, `dispatched with a retired-format token: ${JSON.stringify(calls)}`);

  const unknown = await toolCall("search_vehicles", { query: "porsche" }, { authorization: "Bearer not-a-key" });
  assert(unknown.status === 401, `unknown bearer: ${unknown.status}`);

  const noAuthWrite = await toolCall("submit_observation", {});
  assert(noAuthWrite.status === 401 && (noAuthWrite.headers.get("www-authenticate") ?? "").includes("nuke.ag"),
    `write without auth: ${noAuthWrite.status} ${noAuthWrite.headers.get("www-authenticate")}`);

  const read = await toolCall("search_vehicles", { query: "porsche" });
  assert(read.status === 200 && dispatched() === 1 && calls[0].name === "search_vehicles", `anonymous read: ${read.status}`);

  const service = await toolCall("create_profile", { name: "probe" }, { authorization: "Bearer sb_secret_test_key" });
  assert(service.status === 200 && dispatched() === 2 && calls[1].name === "create_profile", `service key: ${service.status}`);
});
