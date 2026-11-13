// Two-session regression for accept_asset_holding_claim (PR #3190 review finding 4). Real PostgreSQL 17 only: PGlite is one session.
// Disposable server only. Creates and drops its own database (dm_role_claims_conc). Needs psql on PATH and the `pg` package.
//   PGHOST=/tmp PGPORT=55432 PGUSER=postgres node supabase/sql/test_asset_role_claims_concurrency.mjs
// Scenario: the artist holds a work; two other people each state a holding claim; the artist's two accept calls race in two
// sessions. Expected: session B blocks on the asset row lock until A commits, then revalidates and is refused (42501); exactly one
// accepted holder; owner_id is that holder. Control run (--control): the same race against a copy of the function with its
// FOR UPDATE locks stripped, which shows the unserialized outcome the review described.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const control = process.argv.includes('--control');
const db = 'dm_role_claims_conc';
const psql = (args, input) => execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-q', ...args], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
psql(['-d', 'postgres', '-c', `DROP DATABASE IF EXISTS ${db}`]);
psql(['-d', 'postgres', '-c', `CREATE DATABASE ${db}`]);
psql(['-d', db, '-f', path.join(here, 'asset_role_claims_fixture.sql')]);
psql(['-d', db, '-f', path.join(here, '../migrations/20261113200000_asset_role_claims_split.sql')]);
if (control) {
  const src = fs.readFileSync(path.join(here, '../migrations/20261113200000_asset_role_claims_split.sql'), 'utf8');
  const start = src.indexOf('CREATE OR REPLACE FUNCTION public.accept_asset_holding_claim');
  const end = src.indexOf('END $$;', start) + 'END $$;'.length;
  psql(['-d', db], src.slice(start, end).replace(/ FOR UPDATE/g, ''));
}
const ARTIST = '0b9f107a-0000-4000-8000-000000000003', LATER = '0b9f107a-0000-4000-8000-000000000005', FAB = '0b9f107a-0000-4000-8000-000000000004';
const as = (uid) => `SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"${uid}"}', true)`;
const client = () => new pg.Client({ database: db });
const setup = client(); await setup.connect();
const one = async (c, uid, sql, params = []) => { await c.query('BEGIN'); await c.query(as(uid)); const r = await c.query(sql, params); await c.query('COMMIT'); return r.rows[0]; };
const d = (await one(setup, ARTIST, `SELECT public.declare_held_asset('artwork', 'Raced work', NULL, NULL, NULL, NULL, NULL, 'public') AS r`)).r;
const aid = d.asset_id;
const x = (await one(setup, LATER, `SELECT public.record_asset_role_claim($1, 'holder', '[]'::jsonb, 'bought it') AS r`, [aid])).r;
const y = (await one(setup, FAB, `SELECT public.record_asset_role_claim($1, 'holder', '[]'::jsonb, 'kept it') AS r`, [aid])).r;

const A = client(), B = client(); await A.connect(); await B.connect();
await A.query('BEGIN'); await A.query(as(ARTIST));
await A.query(`SELECT public.accept_asset_holding_claim($1, 'to the later holder')`, [x.claim_id]);
await B.query('BEGIN'); await B.query(as(ARTIST));
const bPid = (await B.query('SELECT pg_backend_pid() AS p')).rows[0].p;
let bResult = null;
const bDone = B.query(`SELECT public.accept_asset_holding_claim($1, 'to the fabricator')`, [y.claim_id])
  .then(() => { bResult = { ok: true }; }, (e) => { bResult = { ok: false, code: e.code, message: e.message }; });
await new Promise((r) => setTimeout(r, 700));
const waiting = (await setup.query(`SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1`, [bPid])).rows[0]?.wait_event_type;
const blockedWhileACommits = bResult === null && waiting === 'Lock';
await A.query('COMMIT');
await bDone;
if (bResult.ok) await B.query('COMMIT'); else await B.query('ROLLBACK');
const accepted = (await setup.query(`SELECT structured_data->>'party_user_id' AS party FROM public.asset_observations
  WHERE asset_id = $1 AND kind = 'role_claim_acceptance' AND superseded_by IS NULL AND structured_data->>'acceptance_state' = 'accepted'`, [aid])).rows.map((r) => r.party).sort();
const owner = (await setup.query('SELECT owner_id FROM public.assets WHERE id = $1', [aid])).rows[0].owner_id;
await A.end(); await B.end(); await setup.end();
psql(['-d', 'postgres', '-c', `DROP DATABASE IF EXISTS ${db}`]);

const report = { mode: control ? 'control (locks stripped)' : 'serialized', blockedWhileACommits, waiting, bResult, accepted, owner };
console.log(JSON.stringify(report));
if (control) process.exit(0);
const fail = (m) => { console.error('FAIL:', m); process.exit(1); };
if (!blockedWhileACommits) fail('session B did not wait on the asset lock while A held it');
if (bResult.ok || bResult.code !== '42501') fail('session B must be refused after revalidation (42501)');
if (accepted.length !== 1 || accepted[0] !== LATER) fail(`exactly one accepted holder expected, got ${accepted}`);
if (owner !== LATER) fail('owner_id must be the one accepted holder');
console.log('test_asset_role_claims_concurrency: handover serialized per asset');
