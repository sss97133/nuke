#!/usr/bin/env bash
# Installed PostgreSQL only. Fresh Unix-socket cluster; never a supplied DB URL.
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
pg_bin="${PG_BINDIR:-/opt/homebrew/opt/postgresql@17/bin}"
if [[ ! -x "$pg_bin/initdb" ]]; then pg_bin="$(pg_config --bindir)"; fi
fixture_dir="$(mktemp -d /tmp/nuke-search-pagination.XXXXXX)"
cleanup() {
  status=$?
  if [[ "$status" != 0 ]]; then cat "$fixture_dir/init.log" "$fixture_dir/test.log" "$fixture_dir/server.log" 2>/dev/null >&2 || true; fi
  "$pg_bin/pg_ctl" -D "$fixture_dir/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$fixture_dir"
}
trap cleanup EXIT
mkdir "$fixture_dir/socket"
"$pg_bin/initdb" -D "$fixture_dir/data" -A trust --no-locale -E UTF8 >"$fixture_dir/init.log" 2>&1
"$pg_bin/pg_ctl" -D "$fixture_dir/data" -l "$fixture_dir/server.log" \
  -o "-c listen_addresses= -k $fixture_dir/socket -p 55489" -w start >/dev/null
"$pg_bin/createdb" -h "$fixture_dir/socket" -p 55489 dm_refinement_search_pagination
"$pg_bin/psql" -X -v ON_ERROR_STOP=1 -h "$fixture_dir/socket" -p 55489 -d dm_refinement_search_pagination \
  -f "$repo_root/supabase/sql/test_search_vehicles_fts_pagination.sql" >"$fixture_dir/test.log" 2>&1
cat "$fixture_dir/test.log"
python3 - "$fixture_dir/server.log" <<'PY'
import json,re,sys
log=open(sys.argv[1]).read()
plans=[]
for match in re.finditer(r'duration: [0-9.]+ ms\s+plan:\s*',log):
    plan=json.JSONDecoder().raw_decode(log[match.end():])[0]
    if 'FROM public.vehicles v' in plan.get('Query Text',''): plans.append(plan)
actual=[p['Plan']['Actual Rows'] for p in plans]
assert actual==[95,95,6000,100],f'Unexpected nested branch plans: {actual}'
assert all('v.make = initcap(parsed_make)' in p['Query Text'] for p in plans[:3])
assert 'v.make != initcap(parsed_make)' in plans[3]['Query Text']
print('PASS nested plans: baseline/full patched page each run only exact branch; boundary runs exact then fallback')
def nodes(p):
    yield p
    for child in p.get('Plans',[]): yield from nodes(child)
for name,plan in zip(['baseline first','patched first','boundary exact','boundary fallback'],plans):
    details=[{k:n[k] for k in ['Node Type','Actual Rows','Index Name','Sort Method','Sort Space Used'] if k in n} for n in nodes(plan['Plan'])]
    print(name+': '+json.dumps(details,separators=(',',':')))
PY
# Exact-definition drift must refuse the migration instead of silently replacing it.
"$pg_bin/psql" -X -v ON_ERROR_STOP=1 -h "$fixture_dir/socket" -p 55489 -d dm_refinement_search_pagination \
  -c 'ALTER FUNCTION public.search_vehicles_fts(text,integer,boolean,integer) COST 101' >/dev/null
if "$pg_bin/psql" -X -v ON_ERROR_STOP=1 -h "$fixture_dir/socket" -p 55489 -d dm_refinement_search_pagination \
  -f "$repo_root/supabase/migrations/20261013090000_search_vehicles_fts_single_offset.sql" >"$fixture_dir/drift.log" 2>&1; then
  echo 'FAIL: drifted owner was accepted' >&2; exit 1
fi
if ! grep -q 'Search reader owner drifted' "$fixture_dir/drift.log"; then cat "$fixture_dir/drift.log" >&2; exit 1; fi
echo 'PASS exact-definition drift refuses deployment'
