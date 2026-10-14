#!/usr/bin/env node
/**
 * GUARDRAIL: no-default-grant-definer
 *
 * A SECURITY DEFINER function runs with its owner's rights. Supabase grants EXECUTE on every new function in public
 * to anon and authenticated by default, so a definer function created without explicit grants becomes a public API
 * endpoint that nobody chose. On 2026-10-14, 34 owner-run functions that write were open to anon this way (one could
 * end every live auction of a platform), and owner-run readers returned private vehicles (PRs #1109, #1111).
 *
 * RULE: a migration that creates, replaces or alters a function to SECURITY DEFINER states, in the same file, what each
 * of PUBLIC, anon and authenticated may do with it: a REVOKE ... ON FUNCTION <name> ... FROM <role> or a
 * GRANT ... ON FUNCTION <name> ... TO <role> naming each of the three. Revoking from PUBLIC alone is not enough: 286
 * owner-run functions already carry explicit anon and authenticated grants, and CREATE OR REPLACE keeps them.
 * The alternative is the reviewed marker on its own line, with a reason:
 *   -- definer-grants: default reviewed <name>: <reason>
 *
 * SCOPE: migrations whose file name sorts at or after CUTOFF (new work); older files are the past, not the floor.
 * SQL is split into top-level statements with comments, quoted strings and dollar-quoted bodies skipped, so
 * "security definer" written inside a function body or a comment is not a definer attribute.
 *
 * EXIT: 0 clean, 1 violations, 2 scanner error. Flags: --count prints only the number of violations.
 * Not scanned: functions created through EXECUTE inside a DO block.
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

/** Names (schema-qualified, lower case) of functions a SQL file creates, replaces or alters as SECURITY DEFINER. */
export function definerFunctions(sql) {
  const names = [];
  for (const st of topLevelStatements(sql)) {
    const m = /^(?:create\s+(?:or\s+replace\s+)?|alter\s+)function\s+((?:"?[\w]+"?\.)?"?[\w]+"?)\s*\(/i.exec(st);
    if (!m || !/\bsecurity\s+definer\b/i.test(st)) continue;
    let name = m[1].replace(/"/g, '').toLowerCase();
    if (!name.includes('.')) name = `public.${name}`;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

const ROLES = ['public', 'anon', 'authenticated'];

/** The roles among PUBLIC, anon and authenticated that the file's REVOKE and GRANT statements name for a function. */
export function rolesStated(sql, name) {
  const bare = name.split('.').pop();
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const on = new RegExp(`\\bon\\s+function\\s+(?:public\\.)?"?${esc(bare)}"?\\s*\\(`, 'i');
  const stated = new Set();
  for (const st of topLevelStatements(sql)) {
    if (!/^(?:revoke|grant)\b/i.test(st) || !on.test(st)) continue;
    const tail = /\b(?:from|to)\b([\s\S]*)$/i.exec(st.replace(/\$body\$/g, ''));
    if (!tail) continue;
    for (const r of tail[1].split(',').map((x) => x.trim().toLowerCase().replace(/"/g, ''))) {
      const role = r.split(/\s+/)[0];
      if (ROLES.includes(role)) stated.add(role);
    }
  }
  return stated;
}

/** True when the file states the function's grants for each of PUBLIC, anon and authenticated, or carries the
 *  reviewed marker with a reason. */
export function grantsStated(sql, name) {
  const bare = name.split('.').pop();
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const marker = new RegExp(`^\\s*--\\s*definer-grants:\\s*default\\s+reviewed\\s+(?:public\\.)?${esc(bare)}\\s*:\\s*\\S.*$`, 'im');
  if (marker.test(sql)) return true;
  const stated = rolesStated(sql, name);
  return ROLES.every((r) => stated.has(r));
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
  let v;
  try { v = scan(); } catch (e) { console.error(`no-default-grant-definer: scanner error: ${e.message}`); process.exit(2); }
  if (process.argv.includes('--count')) { console.log(v.length); process.exit(0); }
  for (const x of v) {
    console.log(`VIOLATION ${x.file}: SECURITY DEFINER function ${x.name} does not state what PUBLIC, anon and authenticated may do; REVOKE EXECUTE ON FUNCTION ... FROM each role it should not reach and GRANT EXECUTE ... TO each it should, or mark it "-- definer-grants: default reviewed ${x.name.split('.').pop()}: <reason>"`);
  }
  console.log(v.length ? `no-default-grant-definer: ${v.length} violation(s)` : 'no-default-grant-definer: clean');
  process.exit(v.length ? 1 : 0);
}
