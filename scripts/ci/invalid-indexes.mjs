/**
 * scripts/ci/invalid-indexes.mjs
 *
 * The standing check for indexes an interrupted CREATE INDEX CONCURRENTLY left INVALID (pg_index.indisvalid = false).
 * The planner never reads one. When it is also indisready, every insert and update still writes into it, and a later
 * CREATE INDEX IF NOT EXISTS of the same name finds the leftover and does nothing, so nothing notices. On 2026-10-14
 * production held 16, found by reading slow plans one at a time.
 *
 * scripts/data/readme-stats.mjs (daily, update-stats.yml) lists them in the README's measured block and exits 1, after
 * writing the block, when one appears that the previous block did not list. Pure functions only: no network, no env.
 *
 *   node --test scripts/ci/invalid-indexes.test.mjs   (run by scripts/ci/verify.sh)
 */

// An index that is being built right now is not valid either, so builds listed in pg_stat_progress_create_index are left out
// (the API role is a member of pg_read_all_stats, so it sees other sessions' builds).
export const INVALID_INDEXES_SQL = `
  select t.relname as tbl, c.relname as idx, i.indisready as ready, pg_relation_size(i.indexrelid) as bytes
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_class t on t.oid = i.indrelid
    join pg_namespace s on s.oid = t.relnamespace
   where s.nspname = 'public' and not i.indisvalid
     and not exists (select 1 from pg_stat_progress_create_index p where p.index_relid = i.indexrelid)
   order by t.relname, c.relname`;

const size = (bytes) => {
  const b = Number(bytes);
  if (!(b > 0)) return '0 bytes';
  return b >= 1048576 ? `${Math.round(b / 1048576)} MB` : `${Math.max(1, Math.round(b / 1024))} kB`;
};

// The one line the README carries. The count comes first, then every index as "`name` on `table`".
export function invalidIndexesLine(rows) {
  if (rows.length === 0) return 'Invalid indexes in `public`: 0.';
  const list = rows
    .map((r) => `\`${r.idx}\` on \`${r.tbl}\` (${r.ready ? 'ready' : 'not ready'}, ${size(r.bytes)})`)
    .join('; ');
  return (
    `Invalid indexes in \`public\`: ${rows.length}. An interrupted \`CREATE INDEX CONCURRENTLY\` leaves one that no query ` +
    `reads and, when ready, every write still maintains: ${list}.`
  );
}

// What the previous README block listed: { count, names } or null when it carried no such line yet.
export function previousInvalidIndexes(text) {
  const m = /Invalid indexes in `public`: (\d+)\./.exec(text);
  if (!m) return null;
  const end = text.indexOf('\n', m.index);
  const line = text.slice(m.index, end < 0 ? undefined : end);
  const names = new Set([...line.matchAll(/`([^`]+)` on `[^`]+`/g)].map((x) => x[1]));
  return { count: Number(m[1]), names };
}

// The indexes measured now that the previous block did not list. No previous line means nothing to compare, so none.
export function newlyInvalid(rows, previous) {
  if (!previous) return [];
  return rows.filter((r) => !previous.names.has(r.idx));
}

// The message when the rows hold an invalid index the previous README block did not list; null when there is none.
export function riseReport(rows, previousReadmeText) {
  const risen = newlyInvalid(rows, previousInvalidIndexes(previousReadmeText));
  if (risen.length === 0) return null;
  return (
    `INVALID INDEX appeared since the last measurement: ${risen.map((r) => `${r.idx} on ${r.tbl}`).join(', ')}. ` +
    'An interrupted CREATE INDEX CONCURRENTLY left it; the planner never reads it. Rebuild it or drop it in a migration ' +
    '(supabase/migrations/20261006141000_idx_vehicle_observations_source_vehicle_event.sql is the pattern).'
  );
}
