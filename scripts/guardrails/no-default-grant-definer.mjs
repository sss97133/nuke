#!/usr/bin/env node
/**
 * GUARDRAIL: no-default-grant-definer
 *
 * A SECURITY DEFINER function runs with its owner's rights. Supabase grants EXECUTE on every new function in public
 * to anon and authenticated by default, so a definer function created without explicit grants becomes a public API
 * endpoint that nobody chose. On 2026-10-14, 34 owner-run functions that write were open to anon this way (one could
 * end every live auction of a platform), and owner-run readers returned private vehicles (PRs #1109, #1111).
 *
 * RULE: a migration that creates (or replaces) a SECURITY DEFINER function states its grants in the same file:
 *   REVOKE ... ON FUNCTION <name> ... FROM PUBLIC ...   (then GRANT EXECUTE to the roles that should call it)
 * or carries the reviewed marker on its own line:
 *   -- definer-grants: default reviewed <name>
 *
 * SCOPE: migrations whose file name sorts at or after CUTOFF (new work); older files are the past, not the floor.
 * SQL is split into top-level statements with comments, quoted strings and dollar-quoted bodies skipped, so
 * "security definer" written inside a function body or a comment is not a definer attribute.
 *
 * EXIT: 0 clean, 1 violations. Flags: --count prints only the number of violations.
 * Env: GUARDRAIL_REPO_ROOT (fixtures), GUARDRAIL_DEFINER_CUTOFF (default 20261014040000).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = process.env.GUARDRAIL_REPO_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CUTOFF = process.env.GUARDRAIL_DEFINER_CUTOFF || '20261014040000';
const DIR = path.join(REPO, 'supabase', 'migrations');

/** Top-level statements of a SQL file, each as the text outside comments, strings and dollar-quoted bodies. */
export function topLevelStatements(sql) {
  const out = [];
  let cur = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const two = sql.slice(i, i + 2);
    if (two === '--') { const j = sql.indexOf('\n', i); i = j === -1 ? sql.length : j; continue; }
    if (two === '/*') { const j = sql.indexOf('*/', i + 2); i = j === -1 ? sql.length : j + 2; continue; }
    if (c === "'") { let j = i + 1; while (j < sql.length) { if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; } if (sql[j] === "'") break; j++; } cur += "''"; i = j + 1; continue; }
    if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) { const tag = m[0]; const j = sql.indexOf(tag, i + tag.length); cur += ' $body$ '; i = j === -1 ? sql.length : j + tag.length; continue; }
    }
    if (c === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; i++; continue; }
    cur += c; i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Names (schema-qualified, lower case) of SECURITY DEFINER functions a SQL file creates. */
export function definerFunctions(sql) {
  const names = [];
  for (const st of topLevelStatements(sql)) {
    const m = /^create\s+(?:or\s+replace\s+)?function\s+((?:"?[\w]+"?\.)?"?[\w]+"?)\s*\(/i.exec(st);
    if (!m || !/\bsecurity\s+definer\b/i.test(st)) continue;
    let name = m[1].replace(/"/g, '').toLowerCase();
    if (!name.includes('.')) name = `public.${name}`;
    names.push(name);
  }
  return names;
}

/** True when the file states the function's grants or carries the reviewed marker. */
export function grantsStated(sql, name) {
  const bare = name.split('.').pop();
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fn = `(?:public\\.)?"?${esc(bare)}"?\\b`;
  const revoke = new RegExp(`revoke\\s+(?:all|execute)(?:\\s+privileges)?\\s+on\\s+function\\s+${fn}[^;]*?\\bfrom\\b[^;]*?\\bpublic\\b`, 'i');
  const marker = new RegExp(`^\\s*--\\s*definer-grants:\\s*default\\s+reviewed\\s+(?:public\\.)?${esc(bare)}\\s*$`, 'im');
  return revoke.test(sql) || marker.test(sql);
}

export function scan(dir = DIR, cutoff = CUTOFF) {
  const violations = [];
  if (!fs.existsSync(dir)) return violations;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    const stamp = (/^(\d+)/.exec(f) || [])[1] || '';
    if (stamp.padEnd(14, '0') < cutoff) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const name of definerFunctions(sql)) {
      if (!grantsStated(sql, name)) violations.push({ file: `supabase/migrations/${f}`, name });
    }
  }
  return violations;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const v = scan();
  if (process.argv.includes('--count')) { console.log(v.length); process.exit(0); }
  for (const x of v) {
    console.log(`VIOLATION ${x.file}: SECURITY DEFINER function ${x.name} relies on default grants; add REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC, anon, authenticated and GRANT EXECUTE to the roles meant to call it, or mark it "-- definer-grants: default reviewed ${x.name.split('.').pop()}"`);
  }
  console.log(v.length ? `no-default-grant-definer: ${v.length} violation(s)` : 'no-default-grant-definer: clean');
  process.exit(v.length ? 1 : 0);
}
