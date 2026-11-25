#!/usr/bin/env node
// cron-notice-prefix: warns when an added migration schedules (cron.schedule) or rewrites (cron.alter_job) a
// multi-statement pg_cron command that can raise a NOTICE mid-run and does not begin with
// SET client_min_messages = error.
//
// Why (measured 2026-11-18..25): pg_cron runs here with cron.use_background_workers = off, so the launcher reads
// each job's results over libpq. A NOTICE flushes the results produced so far, the launcher reads them, and it then
// waits on that job's remaining statements without starting any other job. Job 526 stopped every start for
// 194-328 s each night at 04:25Z (a DROP TABLE IF EXISTS on pg_temp); job 646 did the same for 149-236 s at 09:22Z
// (CREATE TEMP TABLE IF NOT EXISTS). Fixed in 20261125041500 / 20261125051500. Live view: v_cron_notice_risk.
//
// A command can raise a notice when it, or a public function it calls (up to three levels, using the newest
// definition in supabase/migrations), contains DDL with IF [NOT] EXISTS, ADD COLUMN IF NOT EXISTS or
// RAISE NOTICE / WARNING / INFO. Blocking since 20261125060000 cleared the live list (v_cron_notice_risk = 0): prints
// WARN lines and exits 1; exit 2 when no base revision is found. Exception, for a command whose notices are wanted:
// -- guardrail-allow(cron-notice): <first called function>: <reason of 12+ characters>
//
//   node scripts/guardrails/cron-notice-prefix.mjs [--base <rev> | --files a.sql b.sql] [--json]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { addedMigrations, allowMarkers } from "./no-raw-testimony-insert.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIG = path.join(REPO, "supabase", "migrations");

export const NOTICE_RE = /((?:drop|create)\s+(?:temp\s+|temporary\s+|unlogged\s+)?(?:table|index|view|materialized\s+view|sequence|type|schema)\s+if\s+(?:not\s+)?exists|add\s+column\s+if\s+not\s+exists|raise\s+(?:notice|warning|info))/i;
export const PREFIX_RE = /^\s*set\s+client_min_messages\s*(?:=|to)\s*'?(?:error|fatal|panic)'?\s*;/i;

// Read one SQL string literal at s[i] ('...' with '' escapes, E'...', or $tag$...$tag$). Returns [text, end] or null.
function literalAt(s, i) {
  let j = i;
  while (j < s.length && /\s/.test(s[j])) j++;
  if ((s[j] === "E" || s[j] === "e") && s[j + 1] === "'") j++;
  if (s[j] === "'") {
    let out = "", k = j + 1;
    while (k < s.length) {
      if (s[k] === "'" && s[k + 1] === "'") { out += "'"; k += 2; continue; }
      if (s[k] === "'") return [out, k + 1];
      out += s[k++];
    }
    return null;
  }
  const m = /^\$([A-Za-z_0-9]*)\$/.exec(s.slice(j));
  if (m) {
    const tag = m[0], start = j + tag.length, end = s.indexOf(tag, start);
    return end < 0 ? null : [s.slice(start, end), end + tag.length];
  }
  return null;
}

// Every cron command literal an SQL text passes to cron.schedule (last argument) or cron.alter_job (command := ...).
export function cronCommands(sql) {
  const out = [];
  const lineOf = (i) => sql.slice(0, i).split("\n").length;
  for (const m of sql.matchAll(/cron\.schedule\s*\(/gi)) {
    const lits = [];
    let i = m.index + m[0].length;
    for (let n = 0; n < 3; n++) {
      const lit = literalAt(sql, i);
      if (!lit) break;
      lits.push(lit[0]);
      i = lit[1];
      const comma = /^\s*,/.exec(sql.slice(i));
      if (!comma) break;
      i += comma[0].length;
    }
    if (lits.length >= 2) out.push({ line: lineOf(m.index), command: lits[lits.length - 1], via: "cron.schedule" });
  }
  for (const m of sql.matchAll(/command\s*:=\s*/gi)) {
    const lit = literalAt(sql, m.index + m[0].length);
    if (lit) out.push({ line: lineOf(m.index), command: lit[0], via: "cron.alter_job" });
  }
  return out;
}

export function statementCount(command) {
  return command.replace(/'(?:[^']|'')*'/g, "''").split(";").filter((p) => p.trim()).length;
}

export function calledNames(text) {
  return [...new Set([...text.replace(/'(?:[^']|'')*'/g, "''").matchAll(/(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi)]
    .map((m) => m[1].toLowerCase()))];
}

// name -> newest CREATE FUNCTION body text found in the migration files (filename order = version order).
export function functionIndex(files = fs.readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort().map((f) => path.join(MIG, f))) {
  const idx = new Map();
  const re = /create\s+(?:or\s+replace\s+)?(?:function|procedure)\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi;
  for (const f of files) {
    const sql = fs.readFileSync(f, "utf8");
    const hits = [...sql.matchAll(re)];
    hits.forEach((h, k) => {
      const stop = k + 1 < hits.length ? hits[k + 1].index : sql.length;
      const head = sql.slice(h.index, stop);
      // the body is the dollar-quoted text after AS; DDL that follows the function in the file is not its body
      const as = /\bas\s+(\$[A-Za-z_0-9]*\$)/i.exec(head);
      let body = head;
      if (as) {
        const start = as.index + as[0].length, end = head.indexOf(as[1], start);
        body = head.slice(start, end < 0 ? head.length : end);
      }
      idx.set(h[1].toLowerCase(), { file: path.relative(REPO, f), body });
    });
  }
  return idx;
}

// The first notice path for a command: [] when it cannot raise one before its last statement.
export function noticePath(command, idx, depth = 3) {
  const direct = NOTICE_RE.exec(command);
  if (direct) return [`command: ${direct[1].toLowerCase()}`];
  const seen = new Set();
  let frontier = calledNames(command).map((n) => [n]);
  for (let d = 0; d < depth && frontier.length; d++) {
    const next = [];
    for (const chain of frontier) {
      const fn = chain[chain.length - 1];
      if (seen.has(fn)) continue;
      seen.add(fn);
      const def = idx.get(fn);
      if (!def) continue;
      const hit = NOTICE_RE.exec(def.body);
      if (hit) return [...chain.slice(0, -1), `${fn}: ${hit[1].toLowerCase().replace(/\s+/g, " ")}`];
      for (const n of calledNames(def.body)) if (n !== fn && idx.has(n)) next.push([...chain, n]);
    }
    frontier = next;
  }
  return [];
}

export function warnings(sql, idx) {
  const allowed = allowMarkers(sql).get("cron-notice") || new Set();
  return cronCommands(sql)
    .filter((c) => statementCount(c.command) > 1 && !PREFIX_RE.test(c.command))
    .map((c) => ({ ...c, path: noticePath(c.command, idx) }))
    .filter((c) => c.path.length && !allowed.has(c.path[0].split(":")[0]));
}

function main(argv) {
  const files = addedMigrations(argv);
  if (!files) { console.error("cron-notice-prefix: could not find the base revision (fetch origin/main, or pass --base <rev>)"); process.exit(2); }
  const idx = functionIndex();
  const hits = [];
  for (const f of files) {
    const abs = path.isAbsolute(f) ? f : path.join(REPO, f);
    for (const w of warnings(fs.readFileSync(abs, "utf8"), idx)) hits.push({ file: f, ...w });
  }
  if (argv.includes("--json")) { console.log(JSON.stringify({ files: files.length, hits }, null, 2)); process.exit(hits.length ? 1 : 0); }
  for (const h of hits) {
    console.log(`WARN  ${h.file}:${h.line}  ${h.via} command of ${statementCount(h.command)} statements can raise a notice (${h.path.join(" > ")}); begin it with SET client_min_messages = error;`);
  }
  if (hits.length) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
