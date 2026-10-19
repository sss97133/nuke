/**
 * scripts/ci/owner-writable-views.mjs
 *
 * The standing check for views in public that let a visitor write past row-level security. A view without
 * security_invoker runs as its owner. When the owner bypasses row-level security (postgres does on Supabase) and the
 * view is auto-updatable, an INSERT, UPDATE or DELETE through it reaches the table below with no policy applied, and
 * Supabase's default privileges grant anon and authenticated ALL on every new view. On 2026-10-14 production held 21
 * (through vehicle_display_names the publishable key could delete any vehicle); 20261014124500_owner_view_writes_revoked
 * and 20261014130000_vehicle_timeline_events_invoker closed them.
 *
 * The event trigger in supabase/migrations/20261014214500_view_write_guard.sql refuses the DDL that would open one.
 * scripts/data/readme-stats.mjs (daily, update-stats.yml) runs this query against the live catalog, prints the count in
 * the README's measured block and exits 1, after writing the block, whenever a view outside ALLOWED matches: that also
 * catches what the trigger never sees (a role given BYPASSRLS, the trigger switched off). Pure functions only: no
 * network, no env.
 *
 *   node --test scripts/ci/owner-writable-views.test.mjs   (run by scripts/ci/verify.sh)
 *   supabase/sql/test_view_write_guard.sql runs this query on PG17 next to the trigger (db-contracts job)
 */

// Views that match and are harmless, with the reason. The trigger in the migration allows the same names.
export const ALLOWED = {
  geometry_columns: 'PostGIS view owned by supabase_admin; its insert, update and delete rules are DO INSTEAD NOTHING',
};

// Owner-run (BYPASSRLS owner, no security_invoker), auto-updatable (pg_relation_is_updatable mask 28: INSERT, UPDATE,
// DELETE), and anon or authenticated holds a write on it. A column grant of INSERT or UPDATE writes too, so those two
// read has_any_column_privilege. `writes` lists each grant as role:privilege.
export const OWNER_WRITABLE_VIEWS_SQL = `
  select c.relname as view, o.rolname as owner,
         array_to_string(array(
           select r.role || ':' || p.priv
             from unnest(array['anon', 'authenticated']) with ordinality r(role, i),
                  unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) with ordinality p(priv, j)
            where case when p.priv in ('INSERT', 'UPDATE') then has_any_column_privilege(r.role, c.oid, p.priv)
                       else has_table_privilege(r.role, c.oid, p.priv) end
            order by r.i, p.j), ',') as writes
    from pg_class c
    join pg_roles o on o.oid = c.relowner
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
     and o.rolbypassrls
     and not coalesce((select option_value::boolean from pg_options_to_table(c.reloptions)
                        where option_name = 'security_invoker'), false)
     and (pg_relation_is_updatable(c.oid, false) & 28) > 0
     and exists (select 1 from unnest(array['anon', 'authenticated']) r(role)
                  where has_any_column_privilege(r.role, c.oid, 'INSERT') or has_any_column_privilege(r.role, c.oid, 'UPDATE')
                     or has_table_privilege(r.role, c.oid, 'DELETE') or has_table_privilege(r.role, c.oid, 'TRUNCATE'))
   order by c.relname`;

// The rows outside ALLOWED.
export const ownerWritableViews = (rows) => rows.filter((r) => !Object.hasOwn(ALLOWED, r.view));

// "anon:INSERT,anon:DELETE,authenticated:UPDATE" -> "anon INSERT, DELETE; authenticated UPDATE"
const writes = (text) => {
  const by = new Map();
  for (const w of String(text || '').split(',').filter(Boolean)) {
    const [role, priv] = w.split(':');
    by.set(role, [...(by.get(role) || []), priv]);
  }
  return [...by].map(([role, privs]) => `${role} ${privs.join(', ')}`).join('; ');
};

// The one line the README carries: the count outside ALLOWED first, then every such view with its grants.
export function ownerWritableViewsLine(rows) {
  const open = ownerWritableViews(rows);
  const allowed = Object.entries(ALLOWED).map(([v, why]) => `\`${v}\` (${why})`).join('; ');
  const head = 'Owner-run views in `public` that anon or authenticated can write through, past row-level security: ';
  if (open.length === 0) return `${head}0. Allowed: ${allowed}.`;
  const list = open.map((r) => `\`${r.view}\` (${writes(r.writes)})`).join('; ');
  return `${head}${open.length}: ${list}. Allowed: ${allowed}.`;
}

// The message when a view outside ALLOWED matches; null when none does. Any one fails the run, not only a new one.
export function ownerWritableViewsReport(rows) {
  const open = ownerWritableViews(rows);
  if (open.length === 0) return null;
  return (
    `OWNER-RUN VIEW WRITABLE BY VISITORS: ${open.map((r) => `${r.view} (${writes(r.writes)})`).join(', ')}. ` +
    'A write through it runs as the owner, so no row policy on the table below applies. In a migration, revoke ' +
    'INSERT, UPDATE, DELETE, TRUNCATE on it from anon and authenticated ' +
    '(supabase/migrations/20261014124500_owner_view_writes_revoked.sql), or, when callers must write through it, set ' +
    'security_invoker = true (supabase/migrations/20261014130000_vehicle_timeline_events_invoker.sql).'
  );
}
