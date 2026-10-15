#!/usr/bin/env node
/**
 * GUARDRAIL: no-swallowed-write-errors
 *
 * A supabase-js write resolves with { error } instead of throwing. A write whose result is
 * dropped (bare `await sb.from(t).upsert(...)`, or `const { data } = ...` with no error read)
 * fails silently: the function returns 200 and the table stays empty. Found 2026-10-15 in
 * extract-mecum, extract-cars-and-bids-core, extract-barn-finds-listing and extract-bonhams.
 *
 * Flags, for .insert( .upsert( .update( .delete( and write .rpc( chains rooted at .from()/.rpc():
 *   - "dropped": the result is not assigned, or is assigned without reading `error`
 *   - "log-only": `error` is read, but the next lines only console.log/warn/error it
 *     (no throw, return, push into a result, continue, or counter)
 * A line containing `write-error-ok:<reason>` (same statement or the line above) is an argued exception.
 *
 * Fix with mustWrite / softWrite from supabase/functions/_shared/writeResult.ts, or by reading `error`
 * and throwing / returning non-2xx / counting it into the run's result.
 *
 * CI runs it as a ratchet (scripts/ci/verify.sh, baseline.json "no-swallowed-write-errors"): the
 * whole-tree count may fall, never rise.
 *
 * Usage: node scripts/guardrails/no-swallowed-write-errors.mjs [--all] [files...]
 *   no args: function files changed vs origin/main, exit 1 on any finding (local pre-push check)
 *   --all:   every function file, always exit 0 (prints one line per finding for the ratchet)
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FN_DIR = "supabase/functions";
const WRITE = /\.(insert|upsert|update|delete)\(/g;
// RPCs that only read, or whose failures callers already handle, are not listed; any other rpc is
// checked only when its name starts with a write-ish verb.
const WRITE_RPC = /\.rpc\(\s*['"](?:upsert_|insert_|persist_|register_|record_|write_|enqueue_|claim_|mark_|set_|update_|refresh_|ingest_|apply_|link_|merge_|supersede_)/g;

const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function scan(src) {
  const lines = src.split("\n");
  const offs = []; let o = 0;
  for (const l of lines) { offs.push(o); o += l.length + 1; }
  const lineOf = (i) => { let lo = 0, hi = offs.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (offs[m] <= i) lo = m; else hi = m - 1; } return lo; };
  const out = [];
  const seen = new Set();
  for (const re of [WRITE, WRITE_RPC]) {
    re.lastIndex = 0;
    for (let m; (m = re.exec(src));) {
      const ln = lineOf(m.index);
      // statement start: walk up to a line ending a previous statement
      let s = ln;
      while (s > 0) {
        const prev = lines[s - 1].trimEnd();
        if (/[;{}]$/.test(prev) || prev === "" || /^\s*(\/\/|\*|\/\*)/.test(prev) || /=>\s*$/.test(prev) && false) break;
        s--;
      }
      // statement end: first line at/after ln ending in ';' (or 25 lines)
      let e = ln;
      while (e < lines.length - 1 && e < ln + 40 && !/;\s*(\/\/.*)?$/.test(lines[e])) e++;
      const stmt = lines.slice(s, e + 1).join("\n");
      const isRpc = re === WRITE_RPC;
      if (!isRpc && !/\.from\(/.test(stmt)) continue;       // not supabase-js
      if (/\.then\(|\.catch\(/.test(stmt) && !/error/.test(stmt)) { /* fallthrough: dropped */ }
      if (seen.has(s + ":" + e)) continue; seen.add(s + ":" + e);
      if (/write-error-ok:/.test(lines.slice(Math.max(0, s - 1), e + 1).join("\n"))) continue;
      const head = lines.slice(s, ln + 1).join("\n");
      if (/\b(mustWrite|softWrite|writeVehicleEventByKey)\(/.test(head)) continue; // _shared/writeResult.ts wrappers
      const assign = /^\s*(?:const|let|var)\s*([^=]+?)=\s*(?:await\s+)?/.exec(head) || /^\s*([A-Za-z_$][\w$.]*|\{[^}]*\}|\[[^\]]*\])\s*=\s*(?:await\s+)?/.exec(head);
      // `return await ...` / `return ...` hands the result to the caller
      if (/^\s*return\b/.test(head) || /^\s*(?:await\s+)?Promise\.all|^\s*\w+\.push\(/.test(head)) continue;
      if (!assign) {
        // inside an arrow/expression context (e.g. map(() => sb.from...)): result is returned upward
        if (/=>\s*(?:await\s+)?\w*\.?\w*$/.test(lines[s - 1] || "") ) continue;
        if (!/^\s*(await\s+)?[\w$.]+\s*\.(from|rpc)\(/.test(head) && !/^\s*await\b/.test(head) && !/^\s*[\w$.]+\s*$/.test(lines[s])) continue;
        out.push({ line: s + 1, kind: "dropped", text: lines[ln].trim().slice(0, 100) });
        continue;
      }
      const lhs = assign[1];
      const resultVar = /^\{/.test(lhs.trim()) ? null : lhs.trim().replace(/^\w+\s+/, "");
      let errName = null;
      if (resultVar === null) {
        const em = /(?:\berror\b|\berr\w*\b|\w*[Ee]rror\w*)\s*(?::\s*(\w+))?/.exec(lhs);
        if (!em) { out.push({ line: s + 1, kind: "dropped", text: lines[ln].trim().slice(0, 100) }); continue; }
        errName = em[1] || em[0].split(":")[0].trim();
      } else {
        errName = resultVar + ".error";
      }
      // look at following lines for how errName is treated
      const after = lines.slice(e + 1, e + 9);
      const idx = after.findIndex((l) => l.includes(errName.split(".")[0]) && (resultVar === null || l.includes(resultVar + ".error") || l.includes("error")));
      if (idx < 0) {
        if (resultVar !== null && new RegExp(`(?<![\\w$])${escapeRe(resultVar)}(?![\\w$])`).test(after.join("\n")) === false) { out.push({ line: s + 1, kind: "dropped", text: lines[ln].trim().slice(0, 100) }); }
        else if (resultVar === null) out.push({ line: s + 1, kind: "dropped", text: lines[ln].trim().slice(0, 100) });
        continue;
      }
      // handled-ness: from the if-line to ~6 lines on, any non-console action?
      const block = after.slice(idx, idx + 7).join("\n");
      const handled = /\b(throw|return|continue|break|\w*[Ee]rrors?\.push|failed\+\+|\w*[Ee]rr\w*\s*=\s*[^=]|softWrite|\w*[Ee]rrors?\+\+|\w*[Ff]ail\w*\s*(\+\+|\+=)|result\.\w+\+\+|stats\.\w+\+\+|jsonResponse|new Response|status:\s*[45]\d\d)\b/.test(block);
      if (!handled) out.push({ line: s + 1, kind: "log-only", text: lines[ln].trim().slice(0, 100) });
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

function walk(d) {
  return readdirSync(d).flatMap((f) => {
    const p = path.join(d, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const all = args.includes("--all");
  let files = args.filter((a) => !a.startsWith("--"));
  if (!files.length) {
    if (all) files = walk(path.join(REPO, FN_DIR)).map((p) => path.relative(REPO, p));
    else {
      let base = "origin/main";
      try { base = execSync(`git merge-base HEAD origin/main`, { cwd: REPO }).toString().trim(); } catch {}
      files = execSync(`git diff --name-only --diff-filter=AM ${base} HEAD -- ${FN_DIR}`, { cwd: REPO }).toString().split("\n").filter(Boolean);
    }
  }
  files = files.filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f) && existsSync(path.join(REPO, f)));
  let n = 0;
  for (const f of files) {
    const hits = scan(readFileSync(path.join(REPO, f), "utf8"));
    for (const h of hits) { n++; console.log(`${f}:${h.line}: ${h.kind}: ${h.text}`); }
  }
  console.error(`no-swallowed-write-errors: ${n} finding(s) in ${files.length} file(s)`);
  if (n && !all) process.exit(1);
}
