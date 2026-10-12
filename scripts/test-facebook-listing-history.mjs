import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { test } from 'node:test';
import * as history from '../supabase/functions/db-stats/listingHistory.ts';

const clock = '2025-01-03T12:00:00.000Z';
test('source and knowledge clocks are independent, finite past UTC instants', () => {
  const scope = history.listingHistoryScope(new URLSearchParams({ history_before: '2025-01-02T12:00:00Z',
    history_known_at: clock,facebook_id: '12345' }), Date.parse(clock));
  assert.equal(scope.eventBefore,'2025-01-02T12:00:00.000Z');
  assert.equal(scope.knownAt,clock); assert.equal(scope.facebookId,'12345');
  assert.equal(scope.eventFrom,'2025-01-01T12:00:00.000Z');
  for (const bad of ['2025-02-30T00:00:00Z','2025-01-04T00:00:00Z','2025-01-01','infinity','2025-01-01T24:00:00Z']) {
    assert.throws(() => history.listingHistoryScope(new URLSearchParams({ history_before: bad }),Date.parse(clock)));
  }
  assert.throws(() => history.listingHistoryScope(new URLSearchParams({ facebook_id: '1 OR 1=1' }),Date.parse(clock)));
});

function handler({ caller = null,admin = false } = {}) {
  let serve; const calls = [];
  const source = readFileSync(new URL('../supabase/functions/db-stats/index.ts',import.meta.url),'utf8');
  const code = stripTypeScriptTypes(source,{ mode: 'transform' })
    .replace(/^import \{([^}]+)\} from ['"]([^'"]+)['"];$/gm,(_,names,name) => `const {${names}}=require(${JSON.stringify(name)});`)
    .replace('await import("https://deno.land/x/postgres@v0.19.3/mod.ts")',"require('postgres')");
  const context = { Request,Response,URL,console: { error() {} },
    Deno: { env: { get: () => 'configured' },serve(fn) { serve=fn; } },
    require(name) {
      if (name.endsWith('/cors.ts')) return { corsHeaders: {} };
      if (name.endsWith('/writeGuard.ts')) return { authenticateWriter: async () => caller ? { ok: true,caller } : { ok: false } };
      if (name.endsWith('/listingHistory.ts')) return history;
      if (name.endsWith('/intakeStatus.ts')) return {};
      if (name === 'postgres') return { Pool: class {
        constructor() { calls.push('pool'); }
        async connect() { return { async queryObject(sql) { calls.push(sql);
          return { rows: sql === history.LISTING_HISTORY_SQL ? [{ measured_at: clock,rows: [],capture_window_complete: true,
            summary: { selected_runs: 0,acknowledged_runs: 0,withheld_runs: 0,retained_sightings: 0,listing_histories: 0,repeated_histories: 0,histories_with_asking_changes: 0 } }]
            : [{ allowed: admin }] }; },release() {} }; }
        async end() {}
      } };
      throw new Error(`Unexpected import ${name}`);
    } };
  vm.runInNewContext(code,context);
  return { calls,request: (method='GET',extra='') => serve(new Request(`https://synthetic.invalid/db-stats?intake=listing_history&history_before=2025-01-03T00:00:00Z&history_known_at=2025-01-03T12:00:00Z${extra}`,{ method })) };
}
test('private history refuses anonymous, forged and non-admin callers; accepts existing admin/service readers', async () => {
  for (const caller of [null,{ kind: 'anon' },{ kind: 'user',userId: '11111111-1111-1111-1111-111111111111' }]) {
    const h=handler({ caller });const r=await h.request();assert([401,403].includes(r.status));
    assert(!h.calls.includes(history.LISTING_HISTORY_SQL));
    if (!caller || caller.kind==='anon') assert(!h.calls.includes('pool'));
  }
  for (const options of [{ caller: { kind: 'service_role' } },{ caller: { kind: 'user',userId: '11111111-1111-1111-1111-111111111111' },admin: true }]) {
    const h=handler(options);const r=await h.request();assert.equal(r.status,200);
    assert.equal(r.headers.get('cache-control'),'private, no-store');
    assert.equal((await r.json()).contract,'facebook_listing_history_v1');
    assert(h.calls.includes('BEGIN READ ONLY'));assert(h.calls.includes('ROLLBACK'));
  }
  const h=handler({ caller: { kind: 'service_role' } });assert.equal((await h.request('POST')).status,405);
  assert.equal((await h.request('GET','&facebook_id=bad')).status,400);
  assert(!h.calls.includes('pool'));
});
test('history failure stays unknown and never exposes SQL/private bodies', async () => {
  const calls=[];const conn={ async queryObject(sql) { calls.push(sql);
    if (sql===history.LISTING_HISTORY_SQL) throw new Error('PRIVATE_BODY_AND_CONTACT'); return { rows: [] }; } };
  const r=await history.readListingHistory(conn,history.listingHistoryScope(new URLSearchParams(),Date.parse(clock)));
  assert.equal(r.status,'unavailable');assert.deepEqual(r.rows,[]);assert(calls.includes('ROLLBACK'));
  assert(!JSON.stringify(r).includes('PRIVATE_'));assert.equal(r.scope.continuous_active_duration,null);
});

const database=process.env.PGDATABASE;
test('actual PostgreSQL history preserves source grain, admission boundaries, retry, gaps and unrelated listing',
  { skip: database!=='dm_refinement_listing_history' },() => {
    assert(process.env.PGHOST==='localhost' || process.env.PGHOST==='127.0.0.1' || process.env.PGHOST?.startsWith('/private/tmp/'));
    const sql = value => execFileSync('psql',['-X','-qAt','-d',database,'-v','ON_ERROR_STOP=1','-c',value],{ encoding: 'utf8',maxBuffer: 2_000_000 }).trim();
    sql(`DO $$ BEGIN IF current_database()<>'dm_refinement_listing_history' OR EXISTS(SELECT FROM pg_namespace WHERE nspname='auth') THEN RAISE EXCEPTION 'Disposable fixture only'; END IF; END $$;
      CREATE TABLE fb_sweep_jobs(id uuid PRIMARY KEY,started_at timestamptz,completed_at timestamptz,created_at timestamptz,status text,metadata jsonb);
      CREATE INDEX ON fb_sweep_jobs(started_at DESC);
      CREATE TABLE marketplace_listings(id uuid PRIMARY KEY,facebook_id text UNIQUE,vehicle_id uuid,title text,price integer,seller_name text);
      CREATE TABLE fb_listing_sightings(id uuid PRIMARY KEY,listing_id uuid,sweep_job_id uuid,seen_at timestamptz,price_at_sighting numeric);
      INSERT INTO marketplace_listings VALUES(md5('listing-a')::uuid,'1001',NULL,'MUTABLE_TITLE',999999,'PRIVATE_SELLER'),(md5('listing-b')::uuid,'1002',NULL,'OTHER_MUTABLE_TITLE',999999,'PRIVATE_CONTACT');`);
    const seed=(n,observed,ack,price,detail=false,ids=['1001']) => {
      const run=JSON.parse(sql(`SELECT to_json(md5('run-${n}')::uuid)`));
      const capture={ capture_id: run,observed_at: observed,access_state: 'available',complete: false,
        actual_url: detail ? 'https://www.facebook.com/marketplace/item/1001/' : 'https://www.facebook.com/marketplace/category/vehicles/?sortBy=creation_time_descend',
        target_url: 'https://www.facebook.com/marketplace/las-vegas/vehicles/',actual_region: 'Nevada',retrieval_surface: detail ? 'detail' : 'search',
        source_listed_at: null,source_listed_label: detail ? '2 hours ago' : null };
      const batch=ids.map(id=>({ facebook_id: id,title: `Retained listing ${id}`,price: id==='1001' ? price : 200,content_text: 'PRIVATE_RAW_BODY' }));
      const results=ids.map(id=>({ facebook_id: id,listing_id: JSON.parse(sql(`SELECT to_json(md5('listing-${id==='1001' ? 'a' : 'b'}')::uuid)`)),
        sighting_id: JSON.parse(sql(`SELECT to_json(md5('sighting-${n}-${id}')::uuid)`)),listing_landed: true,sighting_landed: true }));
      const metadata=JSON.stringify({ writer: 'extract-facebook-marketplace',capture_version: 1,capture,batch,results }).replaceAll("'","''");
      sql(`INSERT INTO fb_sweep_jobs VALUES('${run}','${ack}','${ack}','${ack}','completed','${metadata}'::jsonb) ON CONFLICT(id) DO NOTHING;`);
      for (const [i,id] of ids.entries()) sql(`INSERT INTO fb_listing_sightings VALUES('${results[i].sighting_id}','${results[i].listing_id}','${run}','${observed}',${batch[i].price}) ON CONFLICT(id) DO NOTHING;`);
      return run;
    };
    const read=(eventBefore='2025-01-03T12:00:00Z',known='2025-01-03T12:00:00Z') => {
      const args=[eventBefore,known,'2025-01-02T12:00:00Z',null];
      return JSON.parse(sql(`SELECT row_to_json(h) FROM (${history.LISTING_HISTORY_SQL.replace(/\$(\d+)\b/g,(_,n)=>args[+n-1]===null ? 'NULL' : "'"+args[+n-1].replaceAll("'","''")+"'")}) h`));
    };
    const semantic=r=>{ r=structuredClone(r);delete r.measured_at;return r; };
    seed(1,'2025-01-03T06:00:00Z','2025-01-03T06:01:00Z',100,false,['1001','1002']);
    seed(2,'2025-01-03T07:00:00Z','2025-01-03T07:01:00Z',100);
    seed(3,'2025-01-03T08:00:00Z','2025-01-03T08:01:00Z',100,true);
    const original=read('2025-01-03T10:00:00Z','2025-01-03T09:00:00Z');
    const a=original.rows.find(r=>r.facebook_id==='1001');const b=original.rows.find(r=>r.facebook_id==='1002');
    assert.equal(a.observation_count,3);assert.equal(a.same_query_revisits,1);assert.equal(a.detail_observations,1);
    assert.equal(a.observed_span_minutes,120);assert.equal(a.current_vehicle_id,null);
    assert.equal(a.observations[2].source_reported_age_label,'2 hours ago');assert.equal(a.observations[2].source_reported_listed_at,null);
    assert(a.observations.every(o=>o.asking_currency===null));assert.equal(a.title,'Retained listing 1001');
    assert(!JSON.stringify(original).includes('PRIVATE_'));assert(!JSON.stringify(original).includes('MUTABLE_TITLE'));
    seed(3,'2025-01-03T08:00:00Z','2025-01-03T08:01:00Z',100,true);
    assert.deepEqual(semantic(read('2025-01-03T10:00:00Z','2025-01-03T09:00:00Z')),semantic(original));
    const later=seed(4,'2025-01-03T09:00:00Z','2025-01-03T11:00:00Z',80);
    // Same source event arrives later. Neither source time nor current listing
    // scalars can date this observation's knowledge before capture acknowledgement.
    sql("UPDATE marketplace_listings SET title='LATER_MUTABLE_TITLE',price=80 WHERE facebook_id='1001'");
    const prior=read('2025-01-03T10:00:00Z','2025-01-03T09:00:00Z');
    assert.deepEqual(semantic(prior),semantic(original));assert.equal(prior.summary.retained_sightings,4);
    assert.equal(read('2025-01-03T10:00:00Z','2025-01-03T10:59:59.999Z').rows[0].observation_count,3);
    const admitted=read('2025-01-03T10:00:00Z','2025-01-03T11:00:00Z');
    const admittedA=admitted.rows.find(r=>r.facebook_id==='1001');assert.equal(admittedA.observation_count,4);
    assert.equal(admittedA.observed_asking_changes,1);assert.equal(admittedA.observed_span_minutes,180);
    assert.deepEqual(admitted.rows.find(r=>r.facebook_id==='1002'),b);
    assert.deepEqual(semantic(read('2025-01-03T10:00:00Z','2025-01-03T11:00:00.001Z')),semantic(admitted));
    const eventHeld=read('2025-01-03T09:00:00Z','2025-01-03T12:00:00Z');assert.equal(eventHeld.rows[0].observation_count,3);
    sql(`UPDATE fb_sweep_jobs SET completed_at=NULL WHERE id='${later}'`);
    assert.equal(read().rows[0].observation_count,3);assert.equal(read().summary.withheld_runs,1);
    sql(`UPDATE fb_sweep_jobs SET completed_at='infinity' WHERE id='${later}'`);
    assert.equal(read().rows[0].observation_count,3);
    sql(`UPDATE fb_sweep_jobs SET completed_at='2025-01-03T11:00:00Z',status='failed' WHERE id='${later}'`);
    assert.equal(read().rows[0].observation_count,3);
    sql(`UPDATE fb_sweep_jobs SET status='completed',metadata=jsonb_set(metadata,'{batch}','{}') WHERE id='${later}'`);
    assert.equal(read().rows[0].observation_count,3);
    assert.equal(sql("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock'"),'0');
  });
