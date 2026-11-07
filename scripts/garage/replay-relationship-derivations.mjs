#!/usr/bin/env node
// Replay garage relationship derivations for one account. Dry-run by default: prints old vs derived as markdown.
//
// Dry-run runs supabase/sql/derive_vehicle_relationships_preview.sql through psql in a READ-ONLY session
// (default_transaction_read_only=on); it needs DATABASE_URL and psql, not the service-role key, and works before
// the evidence-chain migration is deployed. --apply calls the deployed derive_vehicle_relationships RPC.
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
if (apply && (!url || !key)) { console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required for --apply (run under dotenvx)'); process.exit(2); }
if (!apply && !process.env.DATABASE_URL) { console.error('DATABASE_URL required for the read-only dry-run (run under dotenvx)'); process.exit(2); }

const runId = randomUUID();
async function rpc(name, body) {
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${name}: ${res.status} ${await res.text()}`);
  return res.json();
}
const call = (dry) => rpc('derive_vehicle_relationships',
  { p_user: user, p_vehicle: vehicle ?? null, p_run_id: runId, p_dry_run: dry });

// Read-only preview: the same chain as the function, as one SELECT. Fields are separated by \x1f.
function preview() {
  const file = new URL('../../supabase/sql/derive_vehicle_relationships_preview.sql', import.meta.url).pathname;
  const claims = JSON.stringify({ role: 'service_role', sub: user }).replace(/'/g, "''");
  const out = execFileSync('psql', [process.env.DATABASE_URL, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At', '-F', '\x1f',
    '-v', `user_id=${user}`, '-v', `vehicle_id=${vehicle ?? ''}`,
    '-c', `SELECT set_config('request.jwt.claims', '${claims}', false)`, '-f', file],
  { encoding: 'utf8', env: { ...process.env, PGOPTIONS: '-c default_transaction_read_only=on' }, maxBuffer: 1 << 28 });
  return out.split('\n').filter((l) => l.includes('\x1f')).map((l) => {
    const [vehicle_id, old_role, derived_role, confidence, evidence, reason] = l.split('\x1f');
    return { vehicle_id, old_role: old_role || null, derived_role, confidence, evidence: JSON.parse(evidence), reason };
  });
}

if (apply) {
  const schema = `backup_garage_deriv_${runId.replace(/-/g, '').slice(0, 12)}`;
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL required to write the backup schema'); process.exit(2); }
  const sql = `create schema ${schema};
    create table ${schema}.garage as select now() as backed_up_at, g.* from public.get_user_garage('${user}') g;
    create table ${schema}.derivations as select * from public.vehicle_relationship_derivations where user_id = '${user}';`;
  execFileSync('psql', [process.env.DATABASE_URL, '-v', 'ON_ERROR_STOP=1', '-c', sql], { stdio: 'inherit' });
  console.error(`backup written to schema ${schema}`);
}

const rows = apply ? await call(false) : preview();
console.log(`run_id: \`${runId}\`  mode: ${apply ? 'APPLIED' : 'dry-run'}  user: \`${user}\`\n`);
console.log('| vehicle | old | derived | confidence | reason |\n|---|---|---|---|---|');
for (const r of rows) {
  const changed = r.old_role !== r.derived_role && !(r.old_role === 'owner' && r.derived_role === 'owner_verified');
  console.log(`| ${r.vehicle_id} | ${r.old_role ?? '—'} | ${changed ? '**' : ''}${r.derived_role}${changed ? '**' : ''} | ${r.confidence} | ${r.reason} |`);
}
console.log(`\n${rows.length} vehicles; bold = role changes.`);
for (const r of rows) {
  const chain = (r.evidence?.chain ?? []).map((c) => `${c.step}:${c.name}${c.confidence != null ? `@${c.confidence}` : ''}` +
    (c.eliminated?.length ? ` -[${c.eliminated.join(',')}]` : '')).join(' | ');
  if (chain) console.log(`- \`${r.vehicle_id}\` ${chain}`);
}
