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
