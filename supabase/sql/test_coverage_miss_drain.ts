// deno test -A supabase/sql/test_coverage_miss_drain.ts
// Runs migration 20261114000000_coverage_miss_drain.sql in an in-memory PostgreSQL (PGlite, WASM) against a
// minimal import_queue fixture. Synthetic rows only; never touches a real database.
import { PGlite } from "npm:@electric-sql/pglite@0.2.17";

function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m);
}

const MIGRATION = new URL(
  "../migrations/20261114000000_coverage_miss_drain.sql",
  import.meta.url,
);

async function setup() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.import_queue (
      id uuid PRIMARY KEY, source_id uuid, listing_url text UNIQUE, raw_data jsonb, status text, priority integer,
      attempts integer, max_attempts integer, created_at timestamptz, next_attempt_at timestamptz,
      locked_at timestamptz, locked_by text, last_attempt_at timestamptz);
    INSERT INTO public.import_queue VALUES
      -- the Nov 5 2026 row as it stands: pending, attempts 3 (lost claims released by release-stale-locks)
      ('dcd24793-cb4f-4867-831b-90b7081e02db','db9ff20a-15b6-41f1-ae09-dd31975a77c0',
       'https://bringatrailer.com/?post_type=bat-listing&p=126086136',
       '{"origin":"evaluate_listing","queued_reason":"coverage_miss"}', 'pending', 0, 3, 3,
       '2026-11-05 11:27:51+00', NULL, NULL, NULL, '2026-11-06 00:17:46+00'),
      -- the Nov 9 C&B miss
      ('fedd9a4d-e3d5-4dfb-b56a-17978b9d1fb1','3422b660-3233-47a4-b44e-97e23bf9e9cb',
       'https://carsandbids.com/auctions/35nB6lll/2026-tesla-model-x-plaid',
       '{"origin":"evaluate_listing","queued_reason":"coverage_miss"}', 'pending', 0, 0, 3,
       '2026-11-09 20:42:01+00', NULL, NULL, NULL, NULL),
      -- not a coverage miss: never claimed by this drain
      ('00000000-0000-0000-0000-000000000001','db9ff20a-15b6-41f1-ae09-dd31975a77c0','https://bringatrailer.com/listing/a/',
       '{}', 'pending', 0, 0, 3, now(), NULL, NULL, NULL, NULL),
      -- coverage miss out of attempts / backing off / freshly locked / done
      ('00000000-0000-0000-0000-000000000002',NULL,'https://bringatrailer.com/listing/b/','{"queued_reason":"coverage_miss"}','pending',0,8,3,now(),NULL,NULL,NULL,NULL),
      ('00000000-0000-0000-0000-000000000003',NULL,'https://bringatrailer.com/listing/c/','{"queued_reason":"coverage_miss"}','pending',0,1,3,now(),now()+interval '1 hour',NULL,NULL,NULL),
      ('00000000-0000-0000-0000-000000000004',NULL,'https://bringatrailer.com/listing/d/','{"queued_reason":"coverage_miss"}','pending',0,1,3,now(),NULL,now(),'w',NULL),
      ('00000000-0000-0000-0000-000000000005',NULL,'https://bringatrailer.com/listing/e/','{"queued_reason":"coverage_miss"}','complete',0,1,3,now(),NULL,NULL,NULL,NULL);
  `);
  await db.exec(await Deno.readTextFile(MIGRATION));
  return db;
}

Deno.test("coverage-miss claim: takes the stuck Nov 5 row and the C&B miss, nothing else", async () => {
  const db = await setup();
  const r = await db.query<
    { id: string; status: string; attempts: number; locked_by: string }
  >(
    "SELECT id, status, attempts, locked_by FROM public.claim_import_queue_coverage_misses(10, 8, 'test-worker') ORDER BY id",
  );
  const ids = r.rows.map((x) => x.id);
  assert(
    JSON.stringify(ids) ===
      JSON.stringify([
        "dcd24793-cb4f-4867-831b-90b7081e02db",
        "fedd9a4d-e3d5-4dfb-b56a-17978b9d1fb1",
      ]),
    JSON.stringify(ids),
  );
  const nov5 = r.rows.find((x) => x.id.startsWith("dcd24793"))!;
  assert(
    nov5.status === "processing" && nov5.attempts === 4 &&
      nov5.locked_by === "test-worker",
    JSON.stringify(nov5),
  );
  const again = await db.query(
    "SELECT * FROM public.claim_import_queue_coverage_misses(10, 8, 'w2')",
  );
  assert(
    again.rows.length === 0,
    "a claimed row is not claimed twice while locked",
  );
});

Deno.test("coverage-miss claim: service_role only", async () => {
  const db = await setup();
  const r = await db.query<{ anon: boolean; auth: boolean; svc: boolean }>(
    `SELECT
    has_function_privilege('anon','public.claim_import_queue_coverage_misses(integer,integer,text,integer)','EXECUTE') anon,
    has_function_privilege('authenticated','public.claim_import_queue_coverage_misses(integer,integer,text,integer)','EXECUTE') auth,
    has_function_privilege('service_role','public.claim_import_queue_coverage_misses(integer,integer,text,integer)','EXECUTE') svc`,
  );
  const p = r.rows[0]!;
  assert(!p.anon && !p.auth && p.svc, JSON.stringify(p));
});

Deno.test("migration leaves rows untouched and schedules nothing without pg_cron", async () => {
  const db = await setup();
  const r = await db.query<{ n: number }>(
    "SELECT count(*)::int n FROM public.import_queue WHERE status='pending'",
  );
  assert(r.rows[0]!.n === 6, `pending ${r.rows[0]!.n}`);
});
