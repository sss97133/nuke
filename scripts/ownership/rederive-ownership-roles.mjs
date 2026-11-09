#!/usr/bin/env node
// Re-run the ownership-role producer (migration 20261109070000) and sign it with this checkout's commit.
//   node scripts/ownership/rederive-ownership-roles.mjs [--user <uuid>] [--run-id <uuid>] [--apply]   (dry run unless --apply)
//   node scripts/ownership/rederive-ownership-roles.mjs --rollback <run_id> --reason "<why>" [--apply]
// Reads SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY); never prints it.
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const URL_BASE = process.env.SUPABASE_URL ?? 'https://qkgaybvrernstplzjaam.supabase.co';
const KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const apply = process.argv.includes('--apply');
if (!KEY) { console.error('SUPABASE_SECRET_KEY is not set'); process.exit(2); }
const sha = process.env.PRODUCER_SHA ?? execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8' }).trim();

async function rpc(name, body) {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${name} ${res.status}: ${text}`);
  return JSON.parse(text);
}

const rollback = arg('--rollback');
if (rollback) {
  const rows = await rpc('rollback_ownership_role_rederivation', { p_run_id: rollback, p_reason: arg('--reason'), p_dry_run: !apply });
  console.log(JSON.stringify({ run_id: rollback, dry_run: !apply, restored: rows.length, rows }, null, 2));
} else {
  const runId = arg('--run-id') ?? randomUUID();
  const version = `${sha}:scripts/ownership/rederive-ownership-roles.mjs`;
  const rows = await rpc('rederive_vehicle_ownership_roles', { p_run_id: runId, p_producer_version: version, p_user_id: arg('--user') ?? null, p_dry_run: !apply });
  console.log(JSON.stringify({ run_id: runId, producer_version: version, dry_run: !apply, decisions: rows.length,
    rows: rows.map(({ evidence, ...r }) => r) }, null, 2));
}
