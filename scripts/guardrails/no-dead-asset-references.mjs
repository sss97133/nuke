#!/usr/bin/env node
/**
 * GUARDRAIL: no-dead-asset-references
 *
 * Catches the vehicle_image_tags-class bug: live code referencing a DB relation
 * or edge function that the asset ledger (docs/ledger/ledger.json) marks DEAD —
 * or that no longer exists in the live DB at all. A live path calling a ghost
 * is a silent runtime failure (PostgREST 404 / PGRST205, fn 404).
 *
 * Scope (deliberately narrow for precision):
 *   - DEAD relations (kind: table / view / materialized_view)
 *   - DEAD edge functions (kind: edge_function)
 *   Pages/files/dirs are excluded: a missing import breaks the BUILD loudly;
 *   this guardrail hunts things that fail SILENTLY at runtime.
 *
 * Reference patterns (invocation-shaped only, not mere mentions):
 *   relations:  .from('X') | rest/v1/X | SQL FROM/JOIN/INTO/UPDATE/TABLE X
 *   edge fns:   functions/v1/X | .invoke('X'
 *
 * Precision rules:
 *   - Names parsed from grouped ledger entries must contain '_' (relations)
 *     or '-' (fns) — drops prose tokens like "dead", "x11", "search".
 *   - Any name that ALSO appears in the ledger with a non-DEAD verdict is
 *     excluded (collision safety).
 *   - Comment-only lines (// * # -- /*) are skipped.
 *   - Self-references (a dead fn's own directory) are skipped.
 *   - References FROM inside another dead fn's directory are reported
 *     separately as "dead-context" (dead calling dead ≠ live path).
 *
 * DB confirmation: existence probe for each referenced dead relation against
 * the live Supabase project (qkgaybvrernstplzjaam) via PostgREST
 * `HEAD /rest/v1/<name>?limit=0` — 404/PGRST205 == to_regclass IS NULL for
 * exposed public relations. Keys resolved via dotenvx. Degrades gracefully.
 *   - referenced + relation DOES NOT exist  -> ERROR  (confirmed ghost)
 *   - referenced + relation still exists    -> WARNING (deprecated-but-live)
 *   - DB unreachable                        -> WARNING (ledger-only verdict)
 *
 * Exit codes: 0 = clean or warnings only; 1 = confirmed-ghost ERROR (or any
 * finding with --strict); 2 = script failure (missing ledger, etc.)
 *
 * Usage: no-dead-asset-references.mjs [--json] [--no-db] [--strict]
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LEDGER = path.join(REPO, "docs/ledger/ledger.json");
const SEARCH_PATHS = ["supabase/functions", "nuke_frontend/src"];
const args = new Set(process.argv.slice(2));
const asJson = args.has("--json");
const noDb = args.has("--no-db");
const strict = args.has("--strict");

if (!existsSync(LEDGER)) {
  console.error(`no-dead-asset-references: ledger not found at ${LEDGER}`);
  process.exit(2);
}
const ledger = JSON.parse(readFileSync(LEDGER, "utf8"));
const assets = ledger.assets ?? [];

// ---------- 1. Extract dead names (incl. from grouped entries) ----------
const REL_KINDS = new Set(["table", "view", "materialized_view"]);
const CLEAN_REL = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CLEAN_FN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$|^[a-z][a-z0-9_]*$/; // hyphenated or simple

function tokensFromGroup(name, mustContain) {
  // "phantom image tables (vehicle_image_assets, vehicle_image_tags, ...)"
  return (name.match(/[A-Za-z_][A-Za-z0-9_-]*/g) ?? []).filter(
    (t) =>
      t.includes(mustContain) && // '_' for relations, '-' for fns: drops prose
      !t.endsWith("_") &&
      !t.endsWith("-") &&
      t.length >= 5
  );
}

const nonDeadNames = new Set();
for (const a of assets) {
  if (a.verdict !== "DEAD" && typeof a.name === "string") {
    if (CLEAN_REL.test(a.name) || CLEAN_FN.test(a.name)) nonDeadNames.add(a.name);
  }
}

const deadRelations = new Set();
const deadFns = new Set();
for (const a of assets) {
  if (a.verdict !== "DEAD") continue;
  if (REL_KINDS.has(a.kind)) {
    if (CLEAN_REL.test(a.name)) deadRelations.add(a.name);
    else for (const t of tokensFromGroup(a.name, "_")) deadRelations.add(t);
  } else if (a.kind === "edge_function") {
    if (/^[a-z][a-z0-9-]*$/.test(a.name)) deadFns.add(a.name);
    else for (const t of tokensFromGroup(a.name, "-")) deadFns.add(t);
  }
}
// Collision safety: never flag a name the ledger also lists as alive.
for (const n of nonDeadNames) {
  deadRelations.delete(n);
  deadFns.delete(n);
}
// Grouped-entry tokens can be SQL keywords/nonsense; hard blocklist of terms
// too generic to grep safely (would false-positive on canonical code).
const GENERIC = new Set(["public", "select", "insert", "update_at", "created_at"]);
for (const g of GENERIC) { deadRelations.delete(g); deadFns.delete(g); }

// ---------- 2. git grep for invocation-shaped references ----------
function gitGrep(pattern) {
  try {
    return execFileSync(
      "git",
      ["grep", "-nI", "--no-color", "-E", pattern, "--", ...SEARCH_PATHS],
      { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
    )
      .split("\n")
      .filter(Boolean);
  } catch (e) {
    if (e.status === 1) return []; // no matches
    throw e;
  }
}

const relAlt = [...deadRelations].join("|");
const fnAlt = [...deadFns].join("|");

const relPatterns = relAlt
  ? [
      `\\.from\\([[:space:]]*['"\`](${relAlt})['"\`]`,
      `rest/v1/(${relAlt})([^A-Za-z0-9_]|$)`,
      `[[:<:]](FROM|JOIN|INTO|UPDATE|TABLE|from|join|into|update|table)[[:space:]]+(public\\.)?(${relAlt})([^A-Za-z0-9_]|$)`,
    ]
  : [];
const fnPatterns = fnAlt
  ? [
      `functions/v1/(${fnAlt})([^A-Za-z0-9_-]|$)`,
      `\\.invoke\\([[:space:]]*['"\`](${fnAlt})['"\`]`,
    ]
  : [];

const COMMENT_LINE = /^\s*(\/\/|\*|\/\*|#|--)/;

function whichNames(text, names) {
  const hits = [];
  for (const n of names) {
    // exact-token containment check (boundary chars around the name)
    const re = new RegExp(`(^|[^A-Za-z0-9_-])${n.replace(/[-]/g, "\\-")}($|[^A-Za-z0-9_-])`);
    if (re.test(text)) hits.push(n);
  }
  return hits;
}

const findings = []; // {file, line, name, kind, snippet, deadContext}
const seen = new Set();

function collect(patterns, names, kind) {
  for (const p of patterns) {
    for (const row of gitGrep(p)) {
      const m = row.match(/^([^:]+):(\d+):(.*)$/);
      if (!m) continue;
      const [, file, line, text] = m;
      if (COMMENT_LINE.test(text)) continue;
      for (const name of whichNames(text, names)) {
        // skip self-reference: the dead fn's own source tree
        if (kind === "edge_function" && file.startsWith(`supabase/functions/${name}/`)) continue;
        const key = `${file}:${line}:${name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // is the REFERENCING file itself inside a dead fn dir?
        const fm = file.match(/^supabase\/functions\/([^/]+)\//);
        const deadContext = !!(fm && deadFns.has(fm[1]));
        findings.push({ file, line: +line, name, kind, snippet: text.trim().slice(0, 160), deadContext });
      }
    }
  }
}

collect(relPatterns, deadRelations, "relation");
collect(fnPatterns, deadFns, "edge_function");

// ---------- 3. DB confirmation (to_regclass) for referenced relations ----------
const referencedRels = [...new Set(findings.filter((f) => f.kind === "relation").map((f) => f.name))];
let dbStatus = "skipped";
const existsInDb = {}; // name -> true/false
if (!noDb && referencedRels.length) {
  try {
    let url = process.env.VITE_SUPABASE_URL;
    let key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !key) {
      const out = execFileSync(
        "dotenvx",
        ["run", "-q", "--", "bash", "-c", 'printf "%s\\n%s" "$VITE_SUPABASE_URL" "$SUPABASE_SERVICE_ROLE_KEY"'],
        { cwd: REPO, encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "ignore"] }
      ).split("\n");
      url = url || out[0];
      key = key || out[1];
    }
    if (!url || !key) throw new Error("no supabase creds");
    const probes = referencedRels.map(async (n) => {
      const r = await fetch(`${url}/rest/v1/${n}?limit=0`, {
        method: "HEAD",
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(8000),
      });
      // 404 == not in PostgREST schema cache == relation gone (to_regclass NULL)
      existsInDb[n] = r.status !== 404;
    });
    await Promise.all(probes);
    dbStatus = "checked";
  } catch {
    dbStatus = "unreachable (ledger-only verdicts)";
  }
}

// ---------- 4. Classify + report ----------
for (const f of findings) {
  if (f.kind === "relation" && dbStatus === "checked") {
    f.severity = existsInDb[f.name] === false ? "ERROR" : "WARNING";
    f.db = existsInDb[f.name] === false ? "relation does not exist (confirmed ghost)" : "relation still exists (deprecated)";
  } else {
    f.severity = "WARNING";
    f.db = f.kind === "relation" ? "unverified" : "n/a";
  }
  if (f.deadContext && f.severity === "ERROR") f.severity = "WARNING"; // dead calling dead: not a live path
}

const live = findings.filter((f) => !f.deadContext);
const deadCtx = findings.filter((f) => f.deadContext);
const errors = live.filter((f) => f.severity === "ERROR");

const summary = {
  guardrail: "no-dead-asset-references",
  dead_names_screened: { relations: deadRelations.size, edge_functions: deadFns.size },
  db_check: dbStatus,
  violations: live.length,
  errors: errors.length,
  dead_context_references: deadCtx.length,
};

if (asJson) {
  console.log(JSON.stringify({ ...summary, findings: live, dead_context: deadCtx }, null, 2));
} else {
  console.log(`[no-dead-asset-references] screened ${deadRelations.size} dead relations + ${deadFns.size} dead edge fns; db_check=${dbStatus}`);
  if (!live.length && !deadCtx.length) console.log("CLEAN — no live code references a dead asset.");
  for (const f of live) {
    console.log(`${f.severity}: ${f.file}:${f.line} -> ${f.kind} '${f.name}' [${f.db}]`);
    console.log(`    ${f.snippet}`);
  }
  if (deadCtx.length) console.log(`(+${deadCtx.length} references from inside DEAD edge-fn dirs — dead-calling-dead, not counted)`);
  console.log(`TOTAL: ${live.length} violation(s), ${errors.length} confirmed-ghost error(s).`);
}

process.exit(errors.length > 0 || (strict && live.length > 0) ? 1 : 0);
