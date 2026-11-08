#!/usr/bin/env node
// Lists, for one account, the photo sessions that sit within range of ONE OR MORE (distinct) organizations, each with all its
// image ids and up to four sample image URLs, so a vision model (or a person) can label the session's scene (dealer_lot,
// showroom, shop_interior, upholstery_work, paint_body, outdoor_street, other) and the label can be stored in
// vehicle_photo_session_scenes (scripts/garage/label-scenes.mjs reads this script's --out file as its --sessions-json).
// Read-only: one SELECT. Nothing is written to a database; --dry-run is the only mode.
//
//   node scripts/garage/scene-sessions.mjs --dry-run --user <uuid> [--out /workspace/scene_sessions.json]
//        [--print-sql] [--sessions-sql-out <file>]
//   --sessions-sql-out <file>  write the SELECT to <file> and print it; nothing is run (no credentials needed)
//
// How the SQL runs (first that is available): psql with DATABASE_URL (read-only session), or the Supabase management API with
// SUPABASE_ACCESS_TOKEN (the path scripts/data/q.sh uses). With neither, the SQL is printed (and written next to --out as .sql).
// Session = a vehicle's geotagged photos with no gap longer than session_gap_hours (platform_config garage_shop_shoot_rules,
// default 2); an organization is in range at org_radius_m (default 60); organizations with the same normalized name count once.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROJECT = 'qkgaybvrernstplzjaam';
const BUCKET = 'vehicle-photos'; // assumption: most common public bucket in the repo; image_url is preferred when it is http(s)

export function buildSql(userId) {
  if (!UUID.test(userId ?? '')) throw new Error('--user must be a uuid');
  return `WITH cfg AS (
  SELECT coalesce((SELECT (pc.config_value->>'org_radius_m')::float8 FROM platform_config pc WHERE pc.config_key = 'garage_shop_shoot_rules'), 60) AS r,
         coalesce((SELECT (pc.config_value->>'session_gap_hours')::float8 FROM platform_config pc WHERE pc.config_key = 'garage_shop_shoot_rules'), 2) AS g
),
s1 AS (
  SELECT vi.id, vi.vehicle_id, coalesce(vi.taken_at, vi.created_at) AS t, vi.latitude::float8 AS lat, vi.longitude::float8 AS lon,
         vi.image_url, vi.storage_path,
         lag(coalesce(vi.taken_at, vi.created_at)) OVER (PARTITION BY vi.vehicle_id ORDER BY coalesce(vi.taken_at, vi.created_at), vi.id) AS pt
    FROM vehicle_images vi
   WHERE vi.user_id = '${userId.toLowerCase()}'::uuid AND vi.vehicle_id IS NOT NULL AND vi.latitude IS NOT NULL AND vi.longitude IS NOT NULL
),
s2 AS (
  SELECT s1.*, sum(CASE WHEN s1.pt IS NULL OR s1.t - s1.pt > make_interval(secs => cfg.g * 3600) THEN 1 ELSE 0 END)
                 OVER (PARTITION BY s1.vehicle_id ORDER BY s1.t, s1.id) AS sess
    FROM s1 CROSS JOIN cfg
),
rk AS MATERIALIZED (
  SELECT s2.*, row_number() OVER (PARTITION BY s2.vehicle_id, s2.sess ORDER BY s2.t, s2.id) AS rn,
         count(*) OVER (PARTITION BY s2.vehicle_id, s2.sess) AS n
    FROM s2
),
orgs AS MATERIALIZED (
  SELECT o.id, o.name, to_jsonb(o)->>'business_type' AS business_type, o.latitude::float8 AS olat, o.longitude::float8 AS olon
    FROM organizations o WHERE o.latitude IS NOT NULL AND o.longitude IS NOT NULL
),
-- Grid cells (0.002 deg lat x 0.003 deg lon) with each organization copied into its 3x3 neighbourhood, so the photo join is a
-- hash join on cell keys instead of a photos x organizations nested loop.
ocell AS MATERIALIZED (
  SELECT o.*, floor(o.olat / 0.002)::int + dx AS cx, floor(o.olon / 0.003)::int + dy AS cy
    FROM orgs o CROSS JOIN generate_series(-1, 1) dx CROSS JOIN generate_series(-1, 1) dy
),
near AS MATERIALIZED (
  SELECT rk.vehicle_id, rk.sess, rk.id AS image_id, o.id AS org_id, o.name, o.business_type,
         regexp_replace(lower(coalesce(o.name, '')), '[^a-z0-9]+', '', 'g') AS nn
    FROM rk CROSS JOIN cfg
    JOIN ocell o ON o.cx = floor(rk.lat / 0.002)::int AND o.cy = floor(rk.lon / 0.003)::int
   WHERE 12742000 * asin(sqrt(least(1, power(sin(radians(o.olat - rk.lat) / 2), 2)
           + cos(radians(rk.lat)) * cos(radians(o.olat)) * power(sin(radians(o.olon - rk.lon) / 2), 2)))) <= cfg.r
),
in_range AS (
  SELECT n.vehicle_id, n.sess, count(DISTINCT n.nn) AS n_orgs, count(DISTINCT n.image_id) AS photos_in_range,
         jsonb_agg(DISTINCT jsonb_build_object('id', n.org_id, 'name', n.name, 'business_type', n.business_type)) AS orgs
    FROM near n GROUP BY n.vehicle_id, n.sess HAVING count(DISTINCT n.nn) >= 1
)
SELECT coalesce(jsonb_agg(jsonb_build_object(
         'vehicle_id', x.vehicle_id, 'session_key', x.session_key, 'started_at', x.started_at, 'ended_at', x.ended_at,
         'photos', x.photos, 'photos_in_range', x.photos_in_range, 'organizations', x.orgs, 'image_ids', x.image_ids, 'samples', x.samples)
       ORDER BY x.started_at DESC), '[]'::jsonb) AS sessions
  FROM (
    SELECT t.vehicle_id, t.sess, t.n_orgs, t.photos_in_range, t.orgs,
           (array_agg(r.id ORDER BY r.rn))[1]::text AS session_key, min(r.t) AS started_at, max(r.t) AS ended_at, max(r.n) AS photos,
           jsonb_agg(r.id ORDER BY r.rn) AS image_ids,
           -- primary samples (first, a third, two thirds, last) and alternative samples (a sixth, the middle, five sixths) for a second viewer
           jsonb_agg(jsonb_build_object('image_id', r.id, 'image_url', r.image_url, 'storage_path', r.storage_path, 'taken_at', r.t,
                       'primary', r.rn IN (1, 1 + (r.n - 1) / 3, 1 + 2 * (r.n - 1) / 3, r.n)) ORDER BY r.rn)
             FILTER (WHERE r.rn IN (1, 1 + (r.n - 1) / 3, 1 + 2 * (r.n - 1) / 3, r.n, 1 + (r.n - 1) / 6, 1 + (r.n - 1) / 2, 1 + 5 * (r.n - 1) / 6)) AS samples
      FROM in_range t JOIN rk r ON r.vehicle_id = t.vehicle_id AND r.sess = t.sess
     GROUP BY t.vehicle_id, t.sess, t.n_orgs, t.photos_in_range, t.orgs) x;
`;
}

// A public URL for a sample: an http(s) image_url as it is, else the public-bucket URL of the storage path.
export function publicUrl(sample, supabaseUrl = `https://${PROJECT}.supabase.co`) {
  if (/^https?:\/\//i.test(sample.image_url ?? '')) return sample.image_url;
  const p = (sample.storage_path ?? '').replace(/^\/+/, '');
  return p ? `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${p.split('/').map(encodeURIComponent).join('/')}` : null;
}

export function shapeSessions(sessions, supabaseUrl) {
  return sessions.map((s) => ({
    vehicle_id: s.vehicle_id, session_key: s.session_key, started_at: s.started_at, ended_at: s.ended_at,
    photos: s.photos, photos_in_range: s.photos_in_range, organizations: s.organizations,
    image_ids: s.image_ids ?? (s.samples ?? []).map((x) => x.image_id),
    // primary samples (a sample without the flag counts as primary); the others are alternatives for a second viewer
    sample_urls: (s.samples ?? []).filter((x) => x.primary !== false).map((x) => publicUrl(x, supabaseUrl)).filter(Boolean).slice(0, 4),
    sample_image_ids: (s.samples ?? []).filter((x) => x.primary !== false).map((x) => x.image_id).slice(0, 4),
    alt_sample_urls: (s.samples ?? []).filter((x) => x.primary === false).map((x) => publicUrl(x, supabaseUrl)).filter(Boolean).slice(0, 4),
  }));
}

async function runSql(sql) {
  if (process.env.DATABASE_URL) {
    try {
      const out = execFileSync('psql', [process.env.DATABASE_URL, '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql.replace(/;\s*$/, '')],
        { env: { ...process.env, PGOPTIONS: '-c default_transaction_read_only=on' }, encoding: 'utf8', maxBuffer: 1 << 28 });
      return JSON.parse(out.trim());
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  if (process.env.SUPABASE_ACCESS_TOKEN) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, { method: 'POST',
      headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) });
    if (!res.ok) throw new Error(`management API ${res.status}`);
    const j = await res.json();
    return typeof j[0].sessions === 'string' ? JSON.parse(j[0].sessions) : j[0].sessions;
  }
  return null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
  const out = opt('out', '/workspace/scene_sessions.json');
  let sql;
  try { sql = buildSql(opt('user')); } catch (e) { console.error(e.message); process.exit(2); }
  const sqlOut = opt('sessions-sql-out');
  if (sqlOut) { writeFileSync(sqlOut, sql); console.error(`SELECT written to ${sqlOut}; nothing was run`); console.log(sql); process.exit(0); }
  if (args.includes('--print-sql')) { console.log(sql); process.exit(0); }
  const sessions = await runSql(sql);
  if (!sessions) {
    const f = out.replace(/\.json$/, '') + '.sql';
    writeFileSync(f, sql);
    console.error(`no database credentials (DATABASE_URL + psql, or SUPABASE_ACCESS_TOKEN): nothing was run. The read-only SQL is in ${f} and printed below.\n`);
    console.log(sql);
    process.exit(3);
  }
  const shaped = shapeSessions(sessions, process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL);
  writeFileSync(out, JSON.stringify(shaped, null, 2));
  console.error(`${shaped.length} sessions within range of an organization -> ${out}`);
}
