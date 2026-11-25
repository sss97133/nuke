#!/usr/bin/env node
/**
 * GUARDRAIL: check-write-guard
 *
 * No edge function that writes to the database may run for an anonymous caller.
 * Every function that can write must call `requireWriteAuth` from
 * supabase/functions/_shared/writeGuard.ts, or sit on the allowlist below with the
 * reason it is safe without it (its own auth, or a public read whose single write is argued).
 *
 * What counts as "writes" (mirrors the 2026-09-27 census that guarded 155 functions):
 *   - supabase-js .insert( / .update( / .upsert( / .delete(
 *   - storage .upload( ; auth.admin.* ; a POST/PATCH/DELETE fetch to /rest/v1/
 *   - the write RPCs: persist_auction_readiness, register_make_model_subject, exec_sql, execute_sql
 *   - raw SQL INSERT/UPDATE/DELETE/TRUNCATE in a function that opens its own postgres connection
 *   - importing a _shared helper that does any of the above (observationWriter, aiCredits, …)
 *   - fan-out: calling any writer over /functions/v1/<name> or functions.invoke('<name>')
 *
 * Usage:  node scripts/guardrails/check-write-guard.mjs [--list]
 * Exit 1 when a writer is unguarded. Runs in .github/workflows/supabase-deploy.yml before deploy.
 */

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// CHECK_WRITE_GUARD_FN_DIR points the check at a fixture tree (check-write-guard.test.mjs); production never sets it.
const FN_DIR = process.env.CHECK_WRITE_GUARD_FN_DIR || path.join(REPO, "supabase/functions");

// Functions that write but are allowed to skip requireWriteAuth, with the reason.
// Adding a name here is a decision, not a convenience: say what refuses the anonymous caller.
const ALLOWLIST = {
  "api-v1-agent-metrics": "apiKeyAuth.authenticateRequest refuses anonymous callers (401)",
  "api-v1-analysis": "apiKeyAuth.authenticateRequest refuses anonymous callers (401)",
  "api-v1-batch": "apiKeyAuth.authenticateRequest refuses anonymous callers (401)",
  "api-v1-business-data": "apiKeyAuth.authenticateRequest refuses anonymous callers (401)",
  "api-v1-events": "apiKeyAuth.authenticateRequest refuses anonymous callers (401)",
  "api-v1-observations": "apiKeyAuth.authenticateRequest refuses anonymous callers (401)",
  "api-v1-signal": "apiKeyAuth.authenticateRequest refuses anonymous callers (401)",
  "api-v1-vehicles": "apiKeyAuth.authenticateRequest refuses anonymous callers (401)",
  "api-v1-agent-register": "anonymous self-registration by design; IP rate-limited",
  "mcp-connector": "own tiered auth: write tools need nk_live_/service; the execute_sql tool the service key only; with no credential only the reference tools in PUBLIC_TOOLS run; every other tool needs the service key or an active admin",
  "oauth-server": "OAuth authorization/token flows carry their own proofs (client secret, PKCE, user session)",
  "stripe-webhook": "Stripe signature is the auth",
  "notify-transfer-parties": "authenticateWriter refuses anonymous callers and any caller but the service key (403); its only write is the outbound gate's held row",
  "auto-merge-duplicate-orgs": "authenticateWriter refuses anonymous callers (writeAuthResponse on !ok); scanAll is service-role only, organizationId requires an owner/discoverer of that org",
  "universal-search": "public read; its one write (register_make_model_subject) is idempotent and bounded to canonical make/model/year",
};

// Caller classes (scripts/guardrails/edge-caller-classes.json). requireWriteAuth admits anyone signed in, and sign-up
// is open with email auto-confirmed, so every function that passes it and then writes with the service client needs
// one row saying who may call it:
//   service    the service key or an active admin (or the company owner): the function calls requireAdminOrService,
//              requireOwnerOrService or isServiceCaller as a top-level statement before it reads the body.
//   self       an end user calls it and every write is keyed to the caller's own verified id; the row says how.
//   row_owner  an end user calls it on ids it names (vehicle_id, image_id, organization_id ...); the row names the id
//              (owns). Until it calls a requireCallerCan* ownership helper the row stays status "open", and the
//              number of open rows may only shrink (open_ceiling).
//   by_mode    an end user calls some modes (each checked as self or row_owner) and the rest are service-only; the
//              row lists service_modes and the function calls requireAdminOrService / requireOwnerOrService /
//              isServiceCaller on them.
//   public     deliberately callable by anyone signed in, with bounded writes; the row says why.
// A function of any class but service that holds the service key and calls another function (a relay: the callee
// trusts the key, not the caller) must say in `relay` how the caller's right to each target is checked; while that
// check is not built the row is status "open". Open rows of every class count against open_ceiling.
// CHECK_WRITE_GUARD_MANIFEST points at a fixture manifest (check-write-guard.test.mjs); production never sets it.
const MANIFEST_PATH = process.env.CHECK_WRITE_GUARD_MANIFEST || path.join(REPO, "scripts/guardrails/edge-caller-classes.json");
const MANIFEST = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
const CLASSES = new Set(["service", "self", "row_owner", "by_mode", "public"]);
const ANY_GATE = /\brequireAdminOrService\(|\brequireOwnerOrService\(|\bisServiceCaller\(/;
const OWNER_HELPER = /\brequireCallerCan[A-Z]\w*\(/;
const SERVICE_CLIENT = /projectSecretKey\(|SERVICE_ROLE_KEY/;
function fnSources(fn) {
  return readdirSync(path.join(FN_DIR, fn)).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => readFileSync(path.join(FN_DIR, fn, f), "utf8"));
}
// The gate: a statement of its own that returns its refusal (requireOwnerOrService / requireAdminOrService into a
// const, then `if (x) return`; or `if (!(await isServiceCaller(req))) return`). Group 1 is its indent.
const STRONG_GATE = /^( *)(?:(?:const|let) (\w+) = \(?await (?:requireOwnerOrService|requireAdminOrService)\(\s*(?:req|request)\b[^;]*;\s*if \(\2\) return\b|(?:const|let) (\w+) = \(await requireWriteAuth\(\s*(?:req|request)\b[^;]*?\)\) \?\?\s*\(await (?:requireOwnerOrService|requireAdminOrService)\(\s*(?:req|request)\b[^;]*;\s*if \(\3\) return\b|if \(!\s*\(?await isServiceCaller\(\s*(?:req|request)\b[^\n]*\)\)\s*(?:return\b|\{\s*return\b))/gm;
const BODY_READ = /\b(req|request)\.(json|formData|text|arrayBuffer|blob|body)\b|new URL\(\s*(req|request)\.url/;
// What may run before the gate: requireWriteAuth and its refusal, and the OPTIONS preflight return.
// A refusal of a wrong method may run too, and the handler's top-level `try {` may open first (the gate is then the
// first statement inside it).
const PRE_GATE_OK = [
  /^\s*(?:const|let) (\w+) = \(?await requireWriteAuth\([^;]*?\)\)?;?\s*if \(\1\) return \1\b[^;\n]*;?/,
  /^\s*if \((?:req|request)\.method === ["']OPTIONS["']\)\s*(?:\{\s*return [^;\n]*;?\s*\}|return [^;\n]*;?)/,
  /^\s*if \((?:req|request)\.method !== ["'][A-Z]+["']\)\s*(?:\{\s*return [^;\n]*;?\s*\}|return [^;\n]*;?)/,
];
const TRY_OPEN = /^\s*try\s*\{/;
// Comments and string contents do not gate anything and must not move braces: blank them, keeping offsets.
function blank(src, strings = true) {
  const sp = (m) => m.replace(/[^\n]/g, " ");
  return src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, (m) =>
    m[0] === "/" ? sp(m) : strings ? m[0] + sp(m.slice(1, -1)) + m[m.length - 1] : m);
}
// The handler: Deno.serve's inline function, or the named function Deno.serve is handed (an exported handler
// gated by `if (import.meta.main) Deno.serve(handler)` counts), in index.ts. Returns [open, close] brace offsets.
function handlerSpan(src) {
  let at = -1;
  const inline = /(?:Deno\.serve|\bserve)\(\s*(?:\{[^}]*\},\s*)?(?:async\s*)?(?:function\s*\w*\s*)?\(\s*(?:req|request|_req)\b/.exec(src);
  if (inline) at = inline.index + inline[0].length;
  else {
    const named = /Deno\.serve\(\s*(?:\{[^}]*\},\s*)?(\w+)\s*\)/.exec(src);
    if (!named) return null;
    const def = new RegExp(`(?:function\\s+${named[1]}\\s*\\(|(?:const|let)\\s+${named[1]}\\s*=\\s*(?:async\\s*)?(?:function\\s*)?\\()`).exec(src);
    if (!def) return null;
    at = def.index + def[0].length;
  }
  // Skip the parameter list (balanced parens), then the body opens at the first "{".
  let depth = 1, i = at;
  for (; i < src.length && depth; i++) depth += src[i] === "(" ? 1 : src[i] === ")" ? -1 : 0;
  const open = src.indexOf("{", i);
  if (open < 0) return null;
  depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return [open, j];
  }
  // Unbalanced (a quote inside a regex literal can fool the blanking): the gate test below needs only the opening,
  // since everything between it and the gate must be requireWriteAuth, OPTIONS, a method refusal or `try {`.
  return [open, src.length];
}
// The gate must be a statement at the top level of the handler (the indent of its first statement), inside the
// handler's own span in index.ts, with nothing before it but requireWriteAuth and the OPTIONS return, and before
// anything reads what the caller sent. A gate in another file, in an unused function, in a branch or after the
// body is read does not count.
function gatedBeforeBody(fn) {
  const file = path.join(FN_DIR, fn, "index.ts");
  if (!existsSync(file)) return false;
  const raw = readFileSync(file, "utf8");
  const src = blank(raw); // braces and spans: comments and string contents blanked
  const text = blank(raw, false); // statements: comments blanked, strings kept (same offsets)
  const span = handlerSpan(src);
  if (!span) return false;
  const [open, close] = span;
  const first = /\S/.exec(src.slice(open + 1));
  if (!first) return false;
  const firstAt = open + 1 + first.index;
  const indent = firstAt - (src.lastIndexOf("\n", firstAt) + 1);
  for (const g of text.matchAll(STRONG_GATE)) {
    if (g.index < open || g.index > close) continue;
    let pre = text.slice(open + 1, g.index), inTry = false;
    for (let changed = true; changed; ) {
      changed = false;
      for (const ok of PRE_GATE_OK) {
        const m = ok.exec(pre);
        if (m) { pre = pre.slice(m[0].length); changed = true; }
      }
      const t = !inTry && TRY_OPEN.exec(pre);
      if (t) { pre = pre.slice(t[0].length); inTry = changed = true; }
    }
    // Top level: at the handler's first-statement indent, or one block deeper inside its leading try.
    const depthOk = inTry ? g[1].length > indent : g[1].length === indent;
    if (depthOk && pre.trim() === "" && !BODY_READ.test(text.slice(open, g.index))) return true;
  }
  return false;
}
const WRITE_RPCS = new Set(["persist_auction_readiness", "register_make_model_subject", "exec_sql", "execute_sql"]);
const RAW_PG = /deno\.land\/x\/postgres|postgresjs|npm:postgres|NUKE_DB_POOL_URL|SUPABASE_DB_URL/;
const RAW_WRITE = /\b(INSERT\s+INTO|UPDATE\s+[a-z_."]+\s+SET|DELETE\s+FROM|TRUNCATE)\b/i;

// A _shared helper that writes makes every importer a writer — except apiKeyAuth.ts, whose only
// write (api_usage_logs) runs after it has validated a key or JWT, and writeGuard.ts itself.
const SHARED_DIR = path.join(FN_DIR, "_shared");
const sharedWriters = new Set(
  readdirSync(SHARED_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !["apiKeyAuth.ts", "writeGuard.ts"].includes(f))
    .filter((f) => {
      const src = readFileSync(path.join(SHARED_DIR, f), "utf8");
      return /\.(insert|update|upsert|delete)\(/.test(src) || /\.upload\(/.test(src) ||
        [...src.matchAll(/\.rpc\(\s*['"]([a-zA-Z0-9_]+)/g)].some((m) => WRITE_RPCS.has(m[1]));
    }),
);

const fns = readdirSync(FN_DIR)
  .filter((d) => !d.startsWith("_") && existsSync(path.join(FN_DIR, d, "index.ts")) && statSync(path.join(FN_DIR, d)).isDirectory())
  .sort();

// An OPTIONS branch that returns: `if (req.method === "OPTIONS") return …` or `… "OPTIONS") { return …`.
const OPTIONS_RETURN = /\b(req|request)\.method\s*===?\s*["']OPTIONS["']\s*\)?\s*(\{\s*)?return\b/;
// Where a handler body starts: the last of these before the OPTIONS branch.
const HANDLER_START = /Deno\.serve\(|\bserve\(\s*async|export\s+(default\s+)?(async\s+)?function\b|async\s*\(\s*(req|request)\b/g;
// Request-time I/O that must not run for a preflight.
const HANDLER_IO = /\bfetch\(|createClient\(|\.from\(|\.rpc\(|\.storage\.|\.query\(|\bsql`/;
function preflightVerdict(fn) {
  let verdict = "no OPTIONS branch that returns";
  for (const f of readdirSync(path.join(FN_DIR, fn)).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
    const src = readFileSync(path.join(FN_DIR, fn, f), "utf8");
    const m = OPTIONS_RETURN.exec(src);
    if (!m) continue;
    let start = 0;
    for (const s of src.matchAll(HANDLER_START)) if (s.index < m.index) start = s.index;
    const io = HANDLER_IO.exec(src.slice(start, m.index));
    if (!io) return null;
    verdict = `${f}: ${io[0]} runs before the OPTIONS return`;
  }
  return verdict;
}

const info = new Map();
for (const fn of fns) {
  const src = readFileSync(path.join(FN_DIR, fn, "index.ts"), "utf8");
  const reasons = [];
  if (/\.(insert|update|upsert|delete)\(/.test(src)) reasons.push("table write");
  if (/\.upload\(/.test(src)) reasons.push("storage upload");
  if (/auth\.admin\./.test(src)) reasons.push("auth.admin");
  // A POST to /rest/v1/rpc/… is a read call; a POST to a table path, or any PATCH/PUT/DELETE, writes.
  if (/rest\/v1\/(?!rpc\/)[^\n]*\n(?:[^\n]*\n){0,6}?[^\n]*method:\s*['"](POST|PATCH|DELETE|PUT)/.test(src)) reasons.push("rest write");
  if (/rest\/v1\/rpc\/[^\n]*\n(?:[^\n]*\n){0,6}?[^\n]*method:\s*['"](PATCH|DELETE|PUT)/.test(src)) reasons.push("rest write");
  for (const m of src.matchAll(/\.rpc\(\s*['"]([a-zA-Z0-9_]+)/g)) if (WRITE_RPCS.has(m[1])) reasons.push(`rpc ${m[1]}`);
  if (RAW_PG.test(src) && RAW_WRITE.test(src)) reasons.push("raw sql write");
  for (const m of src.matchAll(/from\s+['"]\.\.\/_shared\/([a-zA-Z0-9_-]+\.ts)['"]/g)) if (sharedWriters.has(m[1])) reasons.push(`writes via _shared/${m[1]}`);
  const callees = new Set();
  for (const m of src.matchAll(/functions\/v1\/([a-zA-Z0-9_-]+)/g)) if (m[1] !== fn) callees.add(m[1]);
  for (const m of src.matchAll(/functions\.invoke\(\s*['"`]([a-zA-Z0-9_-]+)/g)) if (m[1] !== fn) callees.add(m[1]);
  // writeGuard returns null for OPTIONS so the function's own CORS preflight can answer it. A guarded
  // function with no OPTIONS branch therefore runs its whole body for an anonymous preflight (2026-11-12:
  // firecrawl-balance-log wrote a row from an anonymous OPTIONS probe).
  // The branch must return before the handler makes any database, storage or fetch call.
  info.set(fn, { reasons, callees, guarded: /requireWriteAuth\(/.test(src), usesGuard: /_shared\/writeGuard\.ts/.test(src), preflight: preflightVerdict(fn) });
}

// Fan-out closes over writers: calling a writer with the service key is writing.
let changed = true;
while (changed) {
  changed = false;
  for (const [fn, i] of info) {
    if (i.reasons.length) continue;
    const hit = [...i.callees].find((c) => info.get(c)?.reasons.length);
    if (hit) { i.reasons.push(`fan-out → ${hit}`); changed = true; }
  }
}

const writers = [...info].filter(([, i]) => i.reasons.length);
const unguarded = writers.filter(([fn, i]) => !i.guarded && !(fn in ALLOWLIST));
const preflightRuns = [...info].filter(([, i]) => i.usesGuard && i.preflight);
// Every guarded writer that builds a service client needs a caller class.
const rows = MANIFEST.functions ?? {};
const serviceWriters = writers.filter(([fn, i]) => i.guarded && fnSources(fn).some((src) => SERVICE_CLIENT.test(src))).map(([fn]) => fn);
const classProblems = [];
for (const fn of serviceWriters) {
  const row = rows[fn];
  if (!row) { classProblems.push(`${fn}: no caller class (add a row to edge-caller-classes.json)`); continue; }
  if (!CLASSES.has(row.class)) { classProblems.push(`${fn}: unknown class '${row.class}'`); continue; }
  if (!String(row.reason ?? "").trim()) classProblems.push(`${fn}: class ${row.class} needs a reason`);
  if (row.class === "service" && !gatedBeforeBody(fn)) {
    classProblems.push(`${fn}: class service, but no requireAdminOrService / requireOwnerOrService / isServiceCaller before the body is read`);
  }
  if (row.class === "by_mode") {
    if (!Array.isArray(row.service_modes) || !row.service_modes.length) classProblems.push(`${fn}: class by_mode must list service_modes`);
    if (!fnSources(fn).some((src) => ANY_GATE.test(src))) classProblems.push(`${fn}: class by_mode, but no service gate on any mode`);
  }
  if (row.status === "open" && row.class === "service") classProblems.push(`${fn}: a service row cannot be open`);
  const callees = [...(info.get(fn)?.callees ?? [])];
  if (row.class !== "service" && callees.length && fnSources(fn).some((src) => SERVICE_CLIENT.test(src)) && !String(row.relay ?? "").trim()) {
    classProblems.push(`${fn}: class ${row.class} calls ${callees.join(", ")} holding the service key; say in relay how the caller's right to each target is checked`);
  }
  if (row.class === "row_owner") {
    if (!String(row.owns ?? "").trim()) classProblems.push(`${fn}: class row_owner must name the id it owns (owns)`);
    if (row.status !== "open" && !fnSources(fn).some((src) => OWNER_HELPER.test(src))) {
      classProblems.push(`${fn}: class row_owner is not open, but calls no requireCallerCan* ownership helper`);
    }
  }
}
const openRows = Object.entries(rows).filter(([, r]) => r.status === "open").map(([fn]) => fn);
if (openRows.length > (MANIFEST.open_ceiling ?? 0)) {
  classProblems.push(`${openRows.length} open rows exceed open_ceiling ${MANIFEST.open_ceiling ?? 0}: the open list may only shrink`);
}
// A rename would otherwise drop a function out of the check without anyone noticing.
const scopedStale = Object.keys(rows).filter((fn) => !info.has(fn));
const stale = Object.keys(ALLOWLIST).filter((fn) => !info.has(fn));
const idle = Object.keys(ALLOWLIST).filter((fn) => info.has(fn) && !info.get(fn).reasons.length);

if (process.argv.includes("--list")) {
  for (const [fn, i] of info) {
    const state = i.reasons.length ? (i.guarded ? "guarded" : fn in ALLOWLIST ? "allowlisted" : "UNGUARDED") : "read-only";
    console.log(`${state.padEnd(11)} ${fn.padEnd(42)} ${i.reasons.join("; ")}`);
  }
  console.log("");
}

console.log(
  `check-write-guard: ${fns.length} functions, ${writers.length} write, ` +
  `${writers.filter(([, i]) => i.guarded).length} guarded, ${writers.filter(([fn]) => fn in ALLOWLIST).length} allowlisted, ` +
  `${fns.length - writers.length} read-only.`,
);
for (const fn of stale) console.log(`  note: allowlist entry '${fn}' has no function directory (stale)`);
for (const fn of idle) console.log(`  note: allowlist entry '${fn}' no longer writes (drop it)`);
if (scopedStale.length) {
  console.error(`\n✗ caller-class entr${scopedStale.length === 1 ? "y has" : "ies have"} no function directory: ${scopedStale.join(", ")} (rename the entry with the function)`);
}
if (classProblems.length) {
  console.error(`\n✗ ${classProblems.length} caller-class problem(s) (scripts/guardrails/edge-caller-classes.json):`);
  for (const p of classProblems) console.error(`  ${p}`);
  console.error("\nA service-class function adds, right after requireWriteAuth and before the body is read:\n`const notAdmin = await requireAdminOrService(req); if (notAdmin) return notAdmin;`");
}
if (preflightRuns.length) {
  console.error(`\n✗ ${preflightRuns.length} guarded function(s) run their handler for an anonymous OPTIONS request:`);
  for (const [fn, i] of preflightRuns) console.error(`  ${fn}  (${i.preflight})`);
  console.error("\nwriteGuard never judges OPTIONS. Answer it right after the guard, before any database or fetch call: `if (req.method === \"OPTIONS\") return new Response(null, { status: 204 });`");
}
if (unguarded.length) {
  console.error(`\n✗ ${unguarded.length} writing function(s) accept anonymous callers:`);
  for (const [fn, i] of unguarded) console.error(`  ${fn}  (${i.reasons.join("; ")})`);
  console.error("\nAdd `const denied = await requireWriteAuth(req); if (denied) return denied;` as the first statement of the handler\n(import from ../_shared/writeGuard.ts), or allowlist it in scripts/guardrails/check-write-guard.mjs with the auth that refuses anonymous callers.");
}
if (unguarded.length || preflightRuns.length || classProblems.length || scopedStale.length) process.exit(1);
console.log(`✓ every writing function refuses anonymous callers; ${serviceWriters.length} service-client writers classed (${openRows.length} open)`);
