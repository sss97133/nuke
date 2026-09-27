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
const FN_DIR = path.join(REPO, "supabase/functions");

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
  "mcp-connector": "own tiered auth: write tools need nk_live_/OAuth/service; read tools open",
  "oauth-server": "OAuth authorization/token flows carry their own proofs (client secret, PKCE, user session)",
  "stripe-webhook": "Stripe signature is the auth",
  "universal-search": "public read; its one write (register_make_model_subject) is idempotent and bounded to canonical make/model/year",
};

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
  info.set(fn, { reasons, callees, guarded: /requireWriteAuth\(/.test(src) });
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
if (unguarded.length) {
  console.error(`\n✗ ${unguarded.length} writing function(s) accept anonymous callers:`);
  for (const [fn, i] of unguarded) console.error(`  ${fn}  (${i.reasons.join("; ")})`);
  console.error("\nAdd `const denied = await requireWriteAuth(req); if (denied) return denied;` as the first statement of the handler\n(import from ../_shared/writeGuard.ts), or allowlist it in scripts/guardrails/check-write-guard.mjs with the auth that refuses anonymous callers.");
  process.exit(1);
}
console.log("✓ every writing function refuses anonymous callers");
