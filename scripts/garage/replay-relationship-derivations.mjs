#!/usr/bin/env node
// Replay garage relationship derivations for one account. Dry-run by default: prints old vs derived as markdown.
//
//   dotenvx run -- node scripts/garage/replay-relationship-derivations.mjs --user <uuid> [--vehicle <uuid>]
//   dotenvx run -- node scripts/garage/replay-relationship-derivations.mjs --user <uuid> --apply --i-have-a-backup
//
// --apply needs BOTH --apply and --i-have-a-backup. It first copies the account's current garage and active
// derivation rows into schema `backup_garage_deriv_<run>` (needs DATABASE_URL and `psql`), then calls
// derive_vehicle_relationships(p_dry_run => false) with the service-role key. Nothing is deleted anywhere.
//
// ROLLBACK (by run_id; supersede, never delete): the new rows carry run_id = <run>. Restore the prior state with
//   update vehicle_relationship_derivations set superseded_at = now(), superseded_reason = 'rollback run <run>'
//    where run_id = '<run>' and superseded_at is null;
//   -- then re-activate the rows this run superseded (their superseded_reason is 'rederived run <run>'):
//   update vehicle_relationship_derivations set superseded_at = null, superseded_by = null, superseded_reason = null
//    where superseded_reason = 'rederived run <run>';
// Run both in one migration/transaction (reactivate after the first, unique index allows one active row each).
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const user = opt('user'); const vehicle = opt('vehicle');
const apply = args.includes('--apply');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!user || !uuid.test(user) || (vehicle && !uuid.test(vehicle))) {
  console.error('usage: --user <uuid> [--vehicle <uuid>] [--apply --i-have-a-backup]'); process.exit(2);
}
if (apply && !args.includes('--i-have-a-backup')) {
  console.error('refusing --apply without --i-have-a-backup'); process.exit(2);
}
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required (run under dotenvx)'); process.exit(2); }

const runId = randomUUID();
async function rpc(name, body) {
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${name}: ${res.status} ${await res.text()}`);
  return res.json();
}
const call = (dry) => rpc('derive_vehicle_relationships',
  { p_user: user, p_vehicle: vehicle ?? null, p_run_id: runId, p_dry_run: dry });

if (apply) {
  const schema = `backup_garage_deriv_${runId.replace(/-/g, '').slice(0, 12)}`;
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL required to write the backup schema'); process.exit(2); }
  const sql = `create schema ${schema};
    create table ${schema}.garage as select now() as backed_up_at, g.* from public.get_user_garage('${user}') g;
    create table ${schema}.derivations as select * from public.vehicle_relationship_derivations where user_id = '${user}';`;
  execFileSync('psql', [process.env.DATABASE_URL, '-v', 'ON_ERROR_STOP=1', '-c', sql], { stdio: 'inherit' });
  console.error(`backup written to schema ${schema}`);
}

const rows = await call(!apply);
console.log(`run_id: \`${runId}\`  mode: ${apply ? 'APPLIED' : 'dry-run'}  user: \`${user}\`\n`);
console.log('| vehicle | old | derived | confidence | reason |\n|---|---|---|---|---|');
for (const r of rows) {
  const changed = r.old_role !== r.derived_role && !(r.old_role === 'owner' && r.derived_role === 'owner_verified');
  console.log(`| ${r.vehicle_id} | ${r.old_role ?? '—'} | ${changed ? '**' : ''}${r.derived_role}${changed ? '**' : ''} | ${r.confidence} | ${r.reason} |`);
}
console.log(`\n${rows.length} vehicles; bold = role changes.`);
