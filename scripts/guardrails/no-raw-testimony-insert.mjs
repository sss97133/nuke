#!/usr/bin/env node
/**
 * GUARDRAIL: no-raw-testimony-insert
 *
 * Testimony tables are the load-bearing substrate of Nuke (see
 * .claude/rules/agent-trust-invariants.md and memory
 * feedback_agent_under_skylar_writes_through_ingest_observation.md).
 * Atom writes must flow through the canonical front doors
 * (ingest-observation edge function / sanctioned write APIs), never raw
 * INSERT. This script statically scans the repo for raw-insert violations.
 *
 * WHAT IT CHECKS
 *  1. supabase/migrations/*.sql — DML `INSERT INTO <testimony>` at top
 *     level OR inside `DO $$` blocks (immediate execution = raw DML).
 *     INSERTs inside CREATE FUNCTION/PROCEDURE dollar-quoted bodies are
 *     IGNORED: those define RPCs/triggers, sanctioned server-side paths.
 *  2. supabase/functions/**\/*.ts — supabase-js `.from('<front-door table>')
 *     .insert(...)/.upsert(...)` chains, and raw `INSERT INTO <front-door
 *     table>` SQL strings, outside the sanctioned front-door files.
 *
 * PRECISION CHOICES (deliberate, to avoid false-positives on canonical code):
 *  - Extractor daemons (extract-bat-core etc.) canonically insert into
 *    vehicle_images / vehicle_events / auction_comments with service role
 *    (per memory: "Service-role API keys exist for system daemons").
 *    So the TS-side check is scoped to the tables whose ONLY canonical
 *    write path is the ingest-observation front door:
 *    vehicle_observations and vehicle_user_permissions.
 *  - The migration-side check covers ALL testimony tables (seeding
 *    testimony via migration DML bypasses provenance entirely).
 *  - The supabase-js chain regex requires .insert/.upsert IMMEDIATELY after
 *    .from(...) (modulo whitespace/comments) — supabase-js v2 grammar —
 *    so `.from(T).select(...)` reads never match.
 *  - Bypass marker: a line containing ALLOW_RAW_TESTIMONY_WRITE anywhere in
 *    a SQL migration file skips that file (mirrors the PreToolUse hook
 *    ~/.claude/hooks/block-god-writes.sh); in TS, the marker on the match
 *    line or within the 3 lines above skips that match.
 *
 * KNOWN LIMITATIONS (heuristic, conservative):
 *  - Does not scan frontend/src or scripts/ (out of spec scope:
 *    migrations + functions). Extend scanRoots if needed.
 *  - Raw-SQL-in-TS detection can in principle hit an INSERT mentioned
 *    inside an LLM prompt string; none exist today. Use the marker if one
 *    ever legitimately appears.
 *  - *.test.ts / *.spec.ts are skipped (mock clients would false-positive).
 *
 * EXIT: 0 clean, 1 violations, 2 script error.
 * Flags: --all  also fail on GRANDFATHERED baseline entries (audit mode).
 *
 * INERT until wired: the Wire phase installs this as a pre-commit /
 * Claude Code hook. This script only reports.
 */

import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO =
  process.env.GUARDRAIL_REPO_ROOT || // test/fixture override
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MARKER = "ALLOW_RAW_TESTIMONY_WRITE";
const AUDIT_ALL = process.argv.includes("--all");

// All testimony tables: union of block-god-writes.sh hook list,
// agent-trust-invariants.md, ledger.json testimony-marked tables, and
// *_observations tables discovered in migrations (2026-07-12).
const TESTIMONY_TABLES = [
  "vehicle_observations",
  "vehicle_images",
  "vehicle_events",
  "vehicle_user_permissions",
  "vehicle_aliases",
  "vehicle_timeline",
  "auction_comments",
  "merge_proposals",
  "merge_deleted_rows",
  "observation_discoveries",
  "comment_discoveries",
  "description_discoveries",
  "chassis_observations",
  "part_price_observations",
  "image_angle_observations",
  "image_pose_observations",
  "vehicle_location_observations",
  "part_observation_evidence",
];

// Tables whose ONLY canonical write path is the ingest-observation front
// door / sanctioned write APIs. TS-side enforcement is scoped here to avoid
// flagging canonical extractor daemons (see PRECISION CHOICES above).
const FRONT_DOOR_TABLES = ["vehicle_observations", "vehicle_user_permissions"];

// Sanctioned front-door files/dirs (repo-relative, forward slashes).
// Each entry carries its rationale — do not extend casually.
const SANCTIONED = [
  "supabase/functions/ingest-observation/", // THE canonical front door
  "supabase/functions/ingest-observation-batch/", // batch variant of the front door
  "supabase/functions/_shared/observationWriter.ts", // shared wrapper around ingest-observation
  "supabase/functions/ingest/", // universal CANONICAL entry (ledger.json verdict)
  "supabase/functions/api-v1-observations/", // external-agent write API (encyclopedia 07)
  "supabase/functions/api-v1-batch/", // batch sibling of api-v1-observations
  "supabase/functions/review-agent-submissions/", // trust-gate: reviewed promotion path
];

// GRANDFATHERED: known pre-guardrail exceptions (baseline as of 2026-07-12).
// These do not fail the run (unless --all). New code must never join this
// list — fix the code or use the explicit marker instead.
const GRANDFATHERED = [
  // Historical one-shot backfill function; predates guardrail; not a front door.
  "supabase/functions/migrate-to-observations/index.ts",
];

function legacyMain() {
const violations = []; // {file, line, table, rule, grandfathered}

function rel(p) {
  return path.relative(REPO, p).split(path.sep).join("/");
}

function lineOf(src, idx) {
  let n = 1;
  for (let i = 0; i < idx; i++) if (src.charCodeAt(i) === 10) n++;
  return n;
}

// Replace a span with spaces, preserving newlines (keeps line numbers stable).
function blank(src, start, end) {
  let out = "";
  for (let i = start; i < end; i++) out += src[i] === "\n" ? "\n" : " ";
  return src.slice(0, start) + out + src.slice(end);
}

// Strip SQL comments, then dollar-quoted bodies belonging to CREATE
// FUNCTION/PROCEDURE (sanctioned definitions). Bodies of `DO $$` blocks are
// KEPT — a DO block in a migration executes immediately and is raw DML.
function stripSqlNoise(src) {
  // block comments
  let s = src.replace(/\/\*[\s\S]*?\*\//g, (t) => t.replace(/[^\n]/g, " "));
  // line comments
  s = s.replace(/--[^\n]*/g, (t) => " ".repeat(t.length));
  // dollar-quoted bodies
  const dq = /\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$/g;
  let m;
  while ((m = dq.exec(s))) {
    const tag = m[0];
    const close = s.indexOf(tag, m.index + tag.length);
    if (close === -1) break; // unbalanced; leave rest as-is (conservative: still scanned)
    // Look back at the statement introducing this body: is it a DO block?
    const back = s.slice(Math.max(0, m.index - 400), m.index);
    const stmtStart = back.lastIndexOf(";");
    const intro = back.slice(stmtStart + 1);
    const isDoBlock = /\bDO\b(?![\s\S]*\b(FUNCTION|PROCEDURE)\b)/i.test(intro);
    if (!isDoBlock) {
      s = blank(s, m.index, close + tag.length); // sanctioned fn/proc body
    }
    dq.lastIndex = close + tag.length;
  }
  return s;
}

// Blank JS/TS comments (preserving newlines) so doc-comments that merely
// MENTION "insert into vehicle_observations" don't false-positive the
// raw-SQL scan. The (^|[^:]) guard keeps "https://" URLs intact.
function stripTsComments(src) {
  let s = src.replace(/\/\*[\s\S]*?\*\//g, (t) => t.replace(/[^\n]/g, " "));
  s = s.replace(/(^|[^:"'`])\/\/[^\n]*/gm, (t, pre) => pre + " ".repeat(t.length - pre.length));
  return s;
}

function markerNearby(lines, lineNo) {
  for (let i = Math.max(0, lineNo - 4); i < lineNo; i++) {
    if (lines[i] && lines[i].includes(MARKER)) return true;
  }
  return false;
}

function isGrandfathered(relPath) {
  return GRANDFATHERED.some((g) => relPath === g || relPath.startsWith(g));
}

// ---- Check 1: migrations ----
const migDir = path.join(REPO, "supabase", "migrations");
const tablePat = `(?:ONLY\\s+)?(?:public\\.)?"?(${TESTIMONY_TABLES.join("|")})"?\\b`;
const sqlInsertRe = new RegExp(`\\bINSERT\\s+INTO\\s+${tablePat}`, "gi");

if (fs.existsSync(migDir)) {
  for (const f of fs.readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort()) {
    const abs = path.join(migDir, f);
    const raw = fs.readFileSync(abs, "utf8");
    if (raw.includes(MARKER)) continue; // deliberate, hook-consistent bypass
    const stripped = stripSqlNoise(raw);
    sqlInsertRe.lastIndex = 0;
    let m;
    while ((m = sqlInsertRe.exec(stripped))) {
      const rp = rel(abs);
      violations.push({
        file: rp,
        line: lineOf(stripped, m.index),
        table: m[1],
        rule: "migration-top-level-DML",
        grandfathered: isGrandfathered(rp),
      });
    }
  }
}

// ---- Check 2: edge functions ----
const fnDir = path.join(REPO, "supabase", "functions");
const chainRes = FRONT_DOOR_TABLES.map((t) => ({
  table: t,
  re: new RegExp(
    `\\.from\\(\\s*["'\`]${t}["'\`]\\s*\\)\\s*(?:(?://[^\\n]*\\s*)|(?:/\\*[\\s\\S]*?\\*/\\s*))*\\.\\s*(?:insert|upsert)\\s*\\(`,
    "g"
  ),
}));
const rawSqlRes = FRONT_DOOR_TABLES.map((t) => ({
  table: t,
  re: new RegExp(`\\bINSERT\\s+INTO\\s+(?:public\\.)?${t}\\b`, "gi"),
}));

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

if (fs.existsSync(fnDir)) {
  for (const abs of walk(fnDir)) {
    if (!/\.ts$/.test(abs) || /\.(test|spec)\.ts$/.test(abs)) continue;
    const rp = rel(abs);
    if (SANCTIONED.some((s) => rp === s || rp.startsWith(s))) continue;
    const src = fs.readFileSync(abs, "utf8");
    const srcNoComments = stripTsComments(src);
    const lines = src.split("\n");
    const scans = [
      ...chainRes.map((c) => ({ ...c, body: src, rule: "supabase-js-raw-insert" })),
      ...rawSqlRes.map((c) => ({ ...c, body: srcNoComments, rule: "raw-sql-in-ts" })),
    ];
    for (const { table, re, body, rule } of scans) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(body))) {
        const ln = lineOf(body, m.index);
        if (lines[ln - 1]?.includes(MARKER) || markerNearby(lines, ln - 1)) continue;
        violations.push({
          file: rp,
          line: ln,
          table,
          rule,
          grandfathered: isGrandfathered(rp),
        });
      }
    }
  }
}

// ---- Report ----
const active = violations.filter((v) => !v.grandfathered);
const baseline = violations.filter((v) => v.grandfathered);

for (const v of active) {
  console.log(`VIOLATION  ${v.file}:${v.line}  table=${v.table}  rule=${v.rule}`);
}
for (const v of baseline) {
  console.log(`baseline   ${v.file}:${v.line}  table=${v.table}  rule=${v.rule}  (grandfathered)`);
}

const failing = AUDIT_ALL ? violations : active;
if (failing.length) {
  console.error(
    `\nno-raw-testimony-insert: ${active.length} violation(s)` +
      (baseline.length ? `, ${baseline.length} grandfathered baseline` : "") +
      `.\nWrites to testimony tables must go through the ingest-observation front door.` +
      `\nSee .claude/rules/agent-trust-invariants.md. Deliberate bypass: add the` +
      `\nliteral marker ${MARKER} adjacent to the write (friction is the feature).`
  );
  process.exit(1);
}
console.log(
  `no-raw-testimony-insert: clean` +
    (baseline.length ? ` (${baseline.length} grandfathered baseline entr${baseline.length === 1 ? "y" : "ies"})` : "")
);
process.exit(0);
}

// ============================================================================================================
// CHANGES MODE (`--changes [--base <rev>] [--files <f>...] [--json]`), added 2026-11-24 after #3707.
//
// The whole-repo scan above blanks every CREATE FUNCTION body as "sanctioned", so a migration that defines a new
// function writing vehicle_observations (#3707's fold_byok_component_observations) passed it. Changes mode reads only
// the migrations a change ADDS (against its base, like no-new-photo-reader.mjs; migration numbers are unique, not
// ordered, so a version floor would miss queued lower numbers) and fails on any INSERT, UPDATE, DELETE, MERGE,
// TRUNCATE or COPY into a testimony table (.claude/rules/db-safety.md, "Testimony") that is not inside one of the
// sanctioned writers AGENTS.md "Row writes" names:
//   - at top level or in a DO block (immediate DML);
//   - inside a CREATE FUNCTION / PROCEDURE body, unless the function is a sanctioned writer;
//   - inside a patch of a function body (DO ... pg_get_functiondef('public.f(...)') ... EXECUTE), attributed to f.
// An UPDATE whose SET list assigns only supersession stamps (is_superseded, superseded_by, superseded_at, ...) is the
// supersession pattern and passes. A deliberate exception names itself and gives a reason in the same file:
//   -- guardrail-allow(testimony-write): <function name | top | do>: <reason, 12 characters or more>
// Limits: SQL assembled at run time (EXECUTE format('INSERT INTO %I', ...)) is not seen; edge functions are covered
// by the whole-repo scan above and by check-write-guard.mjs, not here.
// ============================================================================================================

// Exactly the tables .claude/rules/db-safety.md "Testimony" names (the core list and the image evidence store); the
// test reads that section and fails if the two lists differ. The whole-repo list above also carries tables whose only
// front door is ingest-observation (vehicle_user_permissions, ...); changes mode follows the rule file.
export const CHANGE_TESTIMONY_TABLES = [
  "vehicle_events", "vehicle_observations", "vehicle_images", "auction_comments", "vehicle_timeline", "merge_proposals",
  "merge_deleted_rows", "observation_discoveries", "comment_discoveries", "description_discoveries",
  "image_vehicle_candidates", "image_capture_time_claims", "evidence_links", "evidence_account_entities",
  "vehicle_change_claims", "vehicle_change_claim_support", "user_day_vehicle_context", "evidence_decisions",
];

// AGENTS.md "Row writes" (2026-11-24), by function name. ingest-observation is an edge function and writes through
// ingest_observation*; the supersession functions are the ones db-safety.md names. The test checks that every name
// here still appears in AGENTS.md or db-safety.md, so the list cannot drift from the rule silently.
export const SANCTIONED_WRITERS = [
  "correct_vehicle_sale_provenance_batch", "correct_vehicle_event_attribution",
  "unmerge_vehicle", "reattribute_observation", "merge_into_primary",
  "evidence_open_run", "evidence_close_run", "evidence_record_answers", "propose_image_candidates",
  "propose_capture_time_claims", "confirm_capture_times_by_rule", "propose_evidence_links", "propose_account_entities",
  "propose_change_claim", "propose_claim_support", "record_day_context", "decide_evidence",
  "record_owner_statement", "record_owner_statement_link", "record_vehicle_statement",
];
const SUPERSEDE_COLUMNS = new Set(["is_superseded", "superseded_by", "superseded_at", "superseded_reason", "superseded_by_id", "updated_at"]);
const ALLOW_RE = /guardrail-allow\(([a-z-]+)\):[ \t]*([A-Za-z0-9_.]+)[ \t]*:[ \t]*(\S.*)$/gm;

/** Reasoned exemptions in a file: Map rule -> Set of names. A marker whose reason is under 12 characters does not count. */
export function allowMarkers(sql) {
  const out = new Map();
  for (const m of String(sql).matchAll(ALLOW_RE)) {
    if (m[3].replace(/\s+/g, "").length < 12) continue;
    if (!out.has(m[1])) out.set(m[1], new Set());
    out.get(m[1]).add(m[2].toLowerCase());
  }
  return out;
}

/** Splits SQL into top-level statements: [{ text, start }]. Respects comments, quoted strings and dollar quotes. */
export function splitStatements(sql) {
  const s = String(sql);
  const out = [];
  let start = 0, i = 0;
  while (i < s.length) {
    const c = s[i], rest = s.startsWith.bind(s);
    if (rest("--", i)) { const j = s.indexOf("\n", i); i = j < 0 ? s.length : j; continue; }
    if (rest("/*", i)) { const j = s.indexOf("*/", i + 2); i = j < 0 ? s.length : j + 2; continue; }
    if (c === "'") { let j = i + 1; while (j < s.length && !(s[j] === "'" && s[j + 1] !== "'")) j += s[j] === "'" ? 2 : 1; i = j + 1; continue; }
    if (c === '"') { const j = s.indexOf('"', i + 1); i = j < 0 ? s.length : j + 1; continue; }
    if (c === "$") {
      const m = s.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (m) { const j = s.indexOf(m[0], i + m[0].length); i = j < 0 ? s.length : j + m[0].length; continue; }
    }
    if (c === ";") { out.push({ text: s.slice(start, i), start }); start = i + 1; }
    i += 1;
  }
  if (s.slice(start).trim()) out.push({ text: s.slice(start), start });
  return out;
}

/** Blanks comments (keeping offsets). */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (t) => t.replace(/[^\n]/g, " ")).replace(/--[^\n]*/g, (t) => " ".repeat(t.length));
}

/** Dollar-quoted literals in text: [{ tag, body, start }] where start is the body's offset. Outermost only. */
function dollarLiterals(text) {
  const out = [];
  const re = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/g;
  for (let m; (m = re.exec(text));) {
    const close = text.indexOf(m[0], m.index + m[0].length);
    if (close < 0) break;
    out.push({ tag: m[0], body: text.slice(m.index + m[0].length, close), start: m.index + m[0].length });
    re.lastIndex = close + m[0].length;
  }
  return out;
}

const bareName = (n) => n.replace(/"/g, "").replace(/^[a-z_][a-z0-9_]*\./i, "").toLowerCase();

/** Columns an UPDATE's SET list assigns, or null when it cannot be read. */
function setColumns(text) {
  let d = 0, end = text.length;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") d++; else if (ch === ")") { if (d === 0) { end = i; break; } d--; }
    else if (d === 0 && /^\s(where|from|returning)\b/i.test(text.slice(i, i + 12))) { end = i; break; }
  }
  const list = text.slice(0, end);
  const parts = []; let depth = 0, from = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === "(") depth++; else if (list[i] === ")") depth--; else if (list[i] === "," && depth === 0) { parts.push(list.slice(from, i)); from = i + 1; }
  }
  parts.push(list.slice(from));
  const cols = [];
  for (const p of parts) {
    const t = p.trim();
    const tuple = t.match(/^\(([^)]*)\)\s*=/);
    if (tuple) { cols.push(...tuple[1].split(",").map((x) => bareName(x.trim()))); continue; }
    const one = t.match(/^"?([A-Za-z_][A-Za-z0-9_]*)"?(?:\.[A-Za-z_"][A-Za-z0-9_"]*)?\s*=/);
    if (!one) return null;
    cols.push(one[1].toLowerCase());
  }
  return cols;
}

/** DML into testimony tables in a stretch of SQL text: [{ verb, table, offset }]. */
export function testimonyDml(text, tables = CHANGE_TESTIMONY_TABLES) {
  const t = `(?:ONLY\\s+)?(?:"?public"?\\.)?"?(${tables.join("|")})"?(?![A-Za-z0-9_])`;
  const re = new RegExp(`\\b(?:(INSERT)\\s+INTO|(UPDATE)|(DELETE)\\s+FROM|(MERGE)\\s+INTO|(TRUNCATE)(?:\\s+TABLE)?|(COPY))\\s+${t}`, "gi");
  const out = [];
  for (let m; (m = re.exec(text));) {
    const verb = (m[1] || m[2] || m[3] || m[4] || m[5] || m[6]).toUpperCase();
    if (verb === "UPDATE") {
      // "ON CONFLICT ... DO UPDATE SET" belongs to its INSERT, already counted; a trigger's "BEFORE UPDATE ON t" is not DML.
      const before = text.slice(Math.max(0, m.index - 12), m.index);
      if (/\bDO\s*$/i.test(before) || /\b(?:BEFORE|AFTER|OR|OF)\s*$/i.test(before)) continue;
      const after = text.slice(re.lastIndex).match(/^\s+(?:(?:AS\s+)?(?!SET\b)[A-Za-z_][A-Za-z0-9_]*\s+)?SET\s/i);
      if (!after) continue; // "UPDATE ON t" in a GRANT, "FOR UPDATE OF t"
      const cols = setColumns(text.slice(re.lastIndex + after[0].length));
      if (cols && cols.length && cols.every((c) => SUPERSEDE_COLUMNS.has(c))) continue;
    }
    if (verb === "DELETE" && /\bON\s*$/i.test(text.slice(Math.max(0, m.index - 6), m.index))) continue; // ON DELETE CASCADE
    out.push({ verb, table: m[7].toLowerCase(), offset: m.index });
  }
  return out;
}

/**
 * Testimony writes in one migration that no sanctioned writer or reasoned marker covers:
 * [{ table, verb, where, line }] where `where` is 'top', 'do', 'function <name>' or 'patch of <name>'.
 */
export function testimonyWritesInMigration(sql, { sanctioned = SANCTIONED_WRITERS } = {}) {
  const src = String(sql);
  const allowed = allowMarkers(src).get("testimony-write") ?? new Set();
  const ok = new Set([...sanctioned.map((n) => n.toLowerCase()), ...allowed]);
  const line = (off) => src.slice(0, off).split("\n").length;
  const out = [];
  const push = (hits, where, name, base) => {
    if (name && ok.has(name)) return;
    if (!name && ok.has(where)) return;
    for (const h of hits) out.push({ table: h.table, verb: h.verb, where: name ? `${where} ${name}` : where, line: line(base + h.offset) });
  };
  for (const st of splitStatements(src)) {
    const text = stripComments(st.text);
    const fn = text.match(/^\s*create\s+(?:or\s+replace\s+)?(?:function|procedure)\s+((?:"?[A-Za-z_][A-Za-z0-9_]*"?\.)?"?[A-Za-z_][A-Za-z0-9_]*"?)\s*\(/i);
    if (fn) {
      for (const lit of dollarLiterals(text)) push(testimonyDml(lit.body), "function", bareName(fn[1]), st.start + lit.start);
      continue;
    }
    if (/^\s*do\b/i.test(text)) {
      for (const lit of dollarLiterals(text)) {
        const body = lit.body;
        const patched = [...body.matchAll(/pg_get_functiondef\(\s*'([^'(]+)/gi)].map((m) => bareName(m[1]));
        // text inside the DO body's own literals is a function body being patched; the rest runs now
        const inner = [];
        for (const q of [...dollarLiterals(body), ...[...body.matchAll(/'(?:[^']|'')*'/g)].map((m) => ({ body: m[0], start: m.index }))]) inner.push(q);
        let runsNow = body;
        for (const q of inner) runsNow = runsNow.slice(0, q.start) + " ".repeat(q.body.length) + runsNow.slice(q.start + q.body.length);
        push(testimonyDml(runsNow), "do", null, st.start + lit.start);
        for (const q of inner) {
          const hits = testimonyDml(q.body);
          if (!hits.length) continue;
          if (patched.length === 1) push(hits, "patch of", patched[0], st.start + lit.start + q.start);
          else push(hits, "do", null, st.start + lit.start + q.start);
        }
      }
      continue;
    }
    push(testimonyDml(text), "top", null, st.start);
  }
  return out;
}

function gitOut(args) {
  return execFileSync("git", args, { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

/** Migration files a change adds, against --base (CI: HEAD^1; local: merge-base with origin/main). */
export function addedMigrations(argv = process.argv.slice(2)) {
  const fi = argv.indexOf("--files");
  if (fi >= 0) return argv.slice(fi + 1).filter((a) => !a.startsWith("--"));
  const bi = argv.indexOf("--base");
  let base = bi >= 0 ? argv[bi + 1] : null;
  if (!base) {
    try { base = process.env.GITHUB_ACTIONS ? gitOut(["rev-parse", "--verify", "HEAD^1"]) : gitOut(["merge-base", "origin/main", "HEAD"]); }
    catch { return null; }
  }
  return gitOut(["diff", "--name-only", "--diff-filter=A", base, "HEAD", "--", "supabase/migrations"]).split("\n")
    .filter((f) => /^supabase\/migrations\/[^/]+\.sql$/.test(f));
}

function changesMain(argv) {
  const files = addedMigrations(argv);
  if (!files) { console.error("no-raw-testimony-insert --changes: could not find the base revision (fetch origin/main, or pass --base <rev>)"); process.exit(2); }
  const hits = [];
  for (const f of files) {
    const abs = path.isAbsolute(f) ? f : path.join(REPO, f);
    for (const h of testimonyWritesInMigration(fs.readFileSync(abs, "utf8"))) hits.push({ file: f, ...h });
  }
  if (argv.includes("--json")) { console.log(JSON.stringify({ files: files.length, hits }, null, 2)); process.exit(hits.length ? 1 : 0); }
  for (const h of hits) console.log(`CHANGE-VIOLATION  ${h.file}:${h.line}  ${h.verb} ${h.table}  in ${h.where}`);
  if (hits.length) {
    console.error(`\nno-raw-testimony-insert --changes: ${hits.length} write(s) to testimony tables outside the sanctioned writers, in ${files.length} added migration(s).
Testimony is written only by the writers AGENTS.md "Row writes" names; never by a new function, a DO block or top-level DML
(.claude/rules/db-safety.md, "Testimony"). Land observations through ingest-observation; supersede, never update in place.
A deliberate exception names itself in the file with a reason:  -- guardrail-allow(testimony-write): <function|top|do>: <reason>`);
    process.exit(1);
  }
  console.log(`no-raw-testimony-insert --changes: clean (${files.length} added migration(s))`);
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.argv.includes("--changes")) changesMain(process.argv.slice(2));
  else legacyMain();
}
