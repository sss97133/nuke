/**
 * build-index.mjs — one-off: create the partial index the dHash backfill needs.
 * CREATE INDEX CONCURRENTLY idx_vehicle_images_image_identity_id
 *   ON vehicle_images(image_identity_id) WHERE image_identity_id IS NOT NULL
 *
 * Runs on the DIRECT session connection (port 5432) — the transaction pooler
 * (6543) cannot host CONCURRENTLY. statement_timeout=0 because the build scans
 * 38.75M rows (> the 120s role default). Approved by team-lead (Option A).
 * After build: verify pg_index.indisvalid; if INVALID, DROP CONCURRENTLY + retry once.
 */
import pg from "pg";

const IDX = "idx_vehicle_images_image_identity_id";
const DDL = `CREATE INDEX CONCURRENTLY ${IDX} ON vehicle_images(image_identity_id) WHERE image_identity_id IS NOT NULL`;

const cfg = {
  host: "db.qkgaybvrernstplzjaam.supabase.co",
  port: 5432,
  user: "postgres",
  password: process.env.SUPABASE_DB_PASSWORD,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
  // no statement_timeout here; we set it to 0 on the session below
};
const log = (m) => console.log(`${new Date().toISOString()} ${m}`);

async function isValid(client) {
  const r = await client.query(
    `select i.indisvalid, i.indisready
       from pg_class c join pg_index i on i.indexrelid = c.oid
      where c.relname = $1`, [IDX]);
  return r.rows[0] || null;
}
async function exists(client) {
  const r = await client.query(`select 1 from pg_class where relname=$1 and relkind='i'`, [IDX]);
  return r.rowCount > 0;
}

async function attempt(client) {
  log(`building ${IDX} (CONCURRENTLY, statement_timeout=0)...`);
  const t = Date.now();
  await client.query(DDL);
  log(`CREATE returned in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  const v = await isValid(client);
  log(`indisvalid=${v?.indisvalid} indisready=${v?.indisready}`);
  return v?.indisvalid === true;
}

async function main() {
  const client = new pg.Client(cfg);
  await client.connect();
  log("connected direct (5432, session mode)");
  await client.query("set statement_timeout=0");
  await client.query("set lock_timeout='5s'");

  if (await exists(client)) {
    const v = await isValid(client);
    if (v?.indisvalid) { log(`${IDX} already exists and is VALID — nothing to do`); await client.end(); return; }
    log(`${IDX} exists but INVALID — dropping before rebuild`);
    await client.query(`DROP INDEX CONCURRENTLY IF EXISTS ${IDX}`);
  }

  let ok = false;
  try { ok = await attempt(client); }
  catch (e) { log(`attempt#1 error: ${e.code || ""} ${e.message}`); }

  if (!ok) {
    log("attempt#1 not valid — dropping and retrying once");
    try { await client.query(`DROP INDEX CONCURRENTLY IF EXISTS ${IDX}`); } catch (e) { log(`drop err: ${e.message}`); }
    try { ok = await attempt(client); }
    catch (e) { log(`attempt#2 error: ${e.code || ""} ${e.message}`); }
  }

  log(ok ? `SUCCESS: ${IDX} is VALID` : `FAILED: ${IDX} not valid after retry`);
  await client.end();
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error("fatal", e); process.exit(2); });
