// scripts/ci/db-transport.mjs
//
// Shared read transport for the CI measuring scripts (scripts/data/readme-stats.mjs, live-job-loop-smoke.mjs).
// It lives beside the other CI read helpers readme-stats already uses (invalid-indexes.mjs, owner-writable-views.mjs);
// scripts/data/ is gitignored for extraction dumps, so a new module there would not be tracked.
//
// Both scripts historically posted SQL to the Supabase Management API (api.supabase.com/.../database/query) with
// SUPABASE_ACCESS_TOKEN — the same path scripts/data/q.sh uses. The Actions secret SUPABASE_ACCESS_TOKEN is not a
// management token carrying the database_read scope, so every call 403s and both nightly jobs fail
// ("Missing required permission(s): database_read").
//
// When a direct Postgres connection is in the environment — DATABASE_URL, SUPABASE_DB_URL, or SUPABASE_DB_PASSWORD,
// all already present as Actions secrets and what supabase-deploy.yml connects with — this module runs the SAME
// already-wrapped SQL over `pg` and returns the rows of the last row-returning statement, exactly as the Management
// API did. With none of those set (a developer's machine), callers keep their Management-API path unchanged, so
// q.sh-style local use is untouched.
//
// DB_DIRECT tells a caller which path to take. dbRows(wrappedSql) runs one already-wrapped statement block and
// returns its rows. closeDb() ends the connection so a finished job does not hang on an open socket. Secrets are
// read from the environment and never printed.

import { pathToFileURL } from 'node:url';

const PROJECT = 'qkgaybvrernstplzjaam'; // same project as q.sh and the scripts; used to build pooler URLs

export const DB_DIRECT = Boolean(
  process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.SUPABASE_DB_PASSWORD,
);

// Candidate connection strings, in the order supabase-deploy.yml tries them: stored URLs first, then built
// from the password across the pooler regions (GitHub runners are IPv4-only; the direct db.* host is IPv6).
function candidates() {
  const out = [];
  if (process.env.DATABASE_URL) out.push(['DATABASE_URL', process.env.DATABASE_URL]);
  if (process.env.SUPABASE_DB_URL) out.push(['SUPABASE_DB_URL', process.env.SUPABASE_DB_URL]);
  const pw = process.env.SUPABASE_DB_PASSWORD;
  if (pw) {
    const enc = encodeURIComponent(pw);
    const hosts = [
      [`db.${PROJECT}.supabase.co:5432`, 'postgres'],
      ['aws-0-us-west-1.pooler.supabase.com:5432', `postgres.${PROJECT}`],
      ['aws-0-us-east-1.pooler.supabase.com:5432', `postgres.${PROJECT}`],
      ['aws-0-us-east-2.pooler.supabase.com:5432', `postgres.${PROJECT}`],
      ['aws-0-us-west-2.pooler.supabase.com:5432', `postgres.${PROJECT}`],
    ];
    for (const [host, user] of hosts) out.push([`built:${host}`, `postgresql://${user}:${enc}@${host}/postgres`]);
  }
  return out;
}

let pgLib = null;
async function loadPg() {
  if (pgLib) return pgLib;
  let mod;
  try {
    mod = await import('pg'); // resolves when pg is on the normal node_modules path (declared in package.json)
  } catch (e) {
    // CI installs pg into an isolated prefix (so the heavy native root deps are skipped) and points here.
    if (process.env.PG_MODULE) mod = await import(pathToFileURL(process.env.PG_MODULE).href);
    else throw e;
  }
  pgLib = mod.default ?? mod;
  const { types } = pgLib;
  // Match the Management API's JSON shapes, so the generated text is byte-identical across transports:
  types.setTypeParser(20, (v) => (v === null ? null : Number(v))); // int8  -> number (counts, byte sizes; all < 2^53)
  types.setTypeParser(1082, (v) => v); // date        -> 'YYYY-MM-DD' text
  types.setTypeParser(1114, (v) => v); // timestamp   -> text
  types.setTypeParser(1184, (v) => v); // timestamptz -> '… +00' text
  // numeric (1700) already comes back as a string, as the API returns it.
  return pgLib;
}

let clientPromise = null;
async function getClient() {
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    const pg = await loadPg();
    const list = candidates();
    if (!list.length) throw new Error('db-transport: no DATABASE_URL / SUPABASE_DB_URL / SUPABASE_DB_PASSWORD set');
    let lastErr;
    for (const [label, connectionString] of list) {
      const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10000 });
      try {
        await client.connect();
        await client.query('select 1');
        console.error(`db-transport: connected via ${label}`);
        return client;
      } catch (e) {
        lastErr = e;
        try { await client.end(); } catch { /* ignore */ }
        console.error(`db-transport: ${label} did not connect`);
      }
    }
    throw new Error(`db-transport: no database candidate connected (${list.length} tried): ${lastErr?.message || 'unknown'}`);
  })();
  return clientPromise;
}

// Run one already-wrapped statement block (`begin read only; set local …; <sql>; commit;` or a
// `BEGIN; …; SELECT …; ROLLBACK;` scenario) and return the rows of its last row-returning statement — what
// the Management API returned. node-pg returns an array with one result per statement; the caller's output
// is always the last SELECT (readme-stats wraps one SELECT; the smoke scenarios end in a SELECT before
// ROLLBACK). Throws on error with the SQLSTATE in the message so callers that detect 57014 still match, and
// rolls the connection back so it stays usable.
export async function dbRows(wrappedSql) {
  const client = await getClient();
  let res;
  try {
    res = await client.query(wrappedSql);
  } catch (e) {
    try { await client.query('rollback'); } catch { /* ignore */ }
    const err = new Error(e.code ? `${e.message} (SQLSTATE ${e.code})` : e.message);
    err.code = e.code;
    throw err;
  }
  const results = Array.isArray(res) ? res : [res];
  for (let i = results.length - 1; i >= 0; i--) {
    if (results[i]?.command === 'SELECT') return results[i].rows;
  }
  const last = results[results.length - 1];
  return Array.isArray(last?.rows) ? last.rows : [];
}

export async function closeDb() {
  if (!clientPromise) return;
  const p = clientPromise;
  clientPromise = null;
  try { const client = await p; await client.end(); } catch { /* ignore */ }
}
