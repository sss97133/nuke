// One read-only pull of the live data model per run, cached in the run folder (atlas.json).
// It carries everything the generator needs: what exists (pg_class and pg_attribute, which also cover views and
// materialized views that information_schema leaves out), the atlas rows (activity, rows, owners, described columns,
// purpose), the residual gaps, the pipeline_registry rows, and the two facts the stack registry's own coverage function
// reads for a column: its fill (1 - null_frac from pg_stats) and whether a foreign key sits on it.
// A second, best-effort read (registry.json) takes the registry's stack names and substrates.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pg, readJson, writeJson } from './common.mjs';

export const ATLAS_SQL = `select json_build_object(
  'pulled_at', now(),
  'objects', (select coalesce(json_agg(o), '[]'::json) from (
      select c.relname as name, c.relkind::text as kind,
             coalesce(string_agg(a.attname, ',' order by a.attnum) filter (where a.attname is not null), '') as cols
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      left join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      where n.nspname = 'public' and c.relkind in ('r','p','v','m','f')
      group by c.relname, c.relkind order by c.relname) o),
  'atlas', (select coalesce(json_agg(t), '[]'::json) from (
      select table_name::text, activity, est_rows, n_cols, n_cols_described, fk_out, fk_in, left(purpose, 160) as purpose, registry_fields
      from v_schema_atlas order by table_name) t),
  'residual', (select coalesce(json_agg(r), '[]'::json) from (
      select table_name::text, est_rows, gaps::text[] as gaps from v_residual
      where gaps::text[] && array['key','owner'] order by est_rows desc nulls last limit 80) r),
  'registry', (select coalesce(json_agg(g), '[]'::json) from (
      select table_name, column_name, left(coalesce(description, ''), 160) as description
      from pipeline_registry order by table_name, column_name) g),
  'fill', (select coalesce(json_object_agg(t, cols), '{}'::json) from (
      select s.tablename::text as t, json_object_agg(s.attname, round((1 - s.null_frac)::numeric, 4)) as cols
      from (select distinct on (tablename, attname) tablename, attname, null_frac
            from pg_stats where schemaname = 'public' order by tablename, attname, inherited desc) s
      group by s.tablename) f),
  'fks', (select coalesce(json_object_agg(t, cols), '{}'::json) from (
      select c.relname::text as t, json_agg(distinct a.attname) as cols
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any(k.conkey)
      where k.contype = 'f' group by c.relname) g)
) as atlas`;

export const REGISTRY_SQL = `select json_build_object(
  'stacks', (select coalesce(json_agg(x), '[]'::json) from (
      select distinct on (stack_id) stack_id, version, name, status
      from public.stacks order by stack_id, version desc) x),
  'substrates', (select coalesce(json_agg(s), '[]'::json) from (
      select substrate, declared_table from public.stack_substrates order by substrate) s)
) as registry`;

const isAtlas = a => a && ['objects', 'atlas', 'residual', 'registry'].every(k => Array.isArray(a[k])) && a.objects.length > 100;

/** Load the run's cached pull, or make the one pull for this run and cache it. */
export async function loadAtlas({ runDir, refresh = false, pull = pg } = {}) {
  const cache = runDir ? join(runDir, 'atlas.json') : null;
  if (cache && !refresh && existsSync(cache)) {
    try { const cached = readJson(cache); if (isAtlas(cached)) return cached; } catch { /* fall through to a fresh pull */ }
  }
  const started = Date.now();
  const rows = await pull(ATLAS_SQL);
  const atlas = rows?.[0]?.atlas;
  if (!isAtlas(atlas)) throw new Error('atlas pull returned an unexpected shape');
  atlas.pull_ms = Date.now() - started;
  if (cache) writeJson(cache, atlas);
  return atlas;
}

/**
 * The stack registry's names and substrates (public.stacks, public.stack_substrates), cached as registry.json.
 * Best effort: when the registry is not there or not readable the run goes on without it and says so.
 */
export async function loadRegistry({ runDir, refresh = false, pull = pg } = {}) {
  const cache = runDir ? join(runDir, 'registry.json') : null;
  if (cache && !refresh && existsSync(cache)) {
    try { const cached = readJson(cache); if (cached?.available) return cached; } catch { /* fall through */ }
  }
  try {
    const rows = await pull(REGISTRY_SQL);
    const registry = rows?.[0]?.registry;
    if (!Array.isArray(registry?.stacks) || !Array.isArray(registry?.substrates)) throw new Error('unexpected shape');
    const out = { available: true, stacks: registry.stacks, substrates: registry.substrates };
    if (cache) writeJson(cache, out);
    return out;
  } catch (error) {
    return { available: false, error: String(error.message).slice(0, 200), stacks: [], substrates: [] };
  }
}

export function atlasMeta(atlas) {
  return {
    pulled_at: atlas.pulled_at, objects: atlas.objects.length, atlas_rows: atlas.atlas.length, registry_rows: atlas.registry.length,
    columns_with_stats: Object.values(atlas.fill ?? {}).reduce((n, cols) => n + Object.keys(cols).length, 0),
  };
}

/** Live = written to since stats reset and not empty. Sorted by rows, largest first. */
export function liveTables(atlas, n = 40) {
  return atlas.atlas
    .filter(r => r.activity === 'written' && (r.est_rows ?? 0) > 0)
    .sort((a, b) => (b.est_rows ?? 0) - (a.est_rows ?? 0) || String(a.table_name).localeCompare(String(b.table_name)))
    .slice(0, n);
}

const compact = rows => {
  const n = Number(rows ?? 0);
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(n);
};

const shortPurpose = (text, max = 72) => {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 40))}...`;
};

/** The atlas as the prompt sees it: top live tables, then the key gaps and owner gaps. */
export function atlasSummary(atlas, { tables = 40, gaps = 10 } = {}) {
  const lines = liveTables(atlas, tables).map(r => {
    const described = r.n_cols ? Math.round(100 * (r.n_cols_described ?? 0) / r.n_cols) : 0;
    return `${r.table_name} | ${compact(r.est_rows)} rows | ${described}% described | fk out ${r.fk_out ?? 0}, in ${r.fk_in ?? 0} | ${shortPurpose(r.purpose)}`;
  });
  const gapLine = label => {
    const picked = atlas.residual.filter(r => (r.gaps ?? []).includes(label)).slice(0, gaps)
      .map(r => `${r.table_name} (${compact(r.est_rows)})`);
    return picked.length ? `${label} gap, largest first: ${picked.join(', ')}` : `${label} gap: none listed`;
  };
  return [
    ...lines,
    '',
    'Tables with text references that are not yet foreign keys, and tables with no declared owner:',
    gapLine('key'),
    gapLine('owner'),
  ].join('\n');
}

/**
 * Seed tables for one batch: live tables taken in a rotating order, so each batch (and each night) starts its stacks
 * from different data instead of re-deriving the same ideas. Deterministic for a given salt. Uses only what the atlas
 * says about itself: the connected core (at least 50,000 rows and at least two foreign keys in or out), so seeds are
 * entities and events rather than queues and logs. A table whose purpose is marked RETIRED is skipped. With too few
 * core tables the pool widens to every live table.
 */
export function pickSeeds(atlas, { k, salt = 0 }) {
  const live = liveTables(atlas, 400).filter(r => !/\bRETIRED\b/i.test(r.purpose ?? ''));
  const core = live.filter(r => (r.est_rows ?? 0) >= 50000 && (r.fk_in ?? 0) + (r.fk_out ?? 0) >= 2);
  const pool = core.length >= k ? core : live;
  if (!pool.length || k < 1) return [];
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const stride = [7, 11, 13, 5, 3, 1].find(x => gcd(x, pool.length) === 1); // coprime, so the rotation visits every table
  const out = [];
  for (let i = 0; out.length < Math.min(k, pool.length) && i < pool.length; i++) {
    out.push(pool[(salt * 3 + i * stride) % pool.length].table_name);
  }
  return out;
}

/** Seed names with their one-line purpose from the atlas, so the model knows what the table is. */
export function seedDetails(atlas, names) {
  const byName = new Map(atlas.atlas.map(r => [r.table_name, r]));
  return names.map(name => ({ name, purpose: shortPurpose(byName.get(name)?.purpose, 150) }));
}
