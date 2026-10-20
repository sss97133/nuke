#!/usr/bin/env bash
# Installed PostgreSQL only. Fresh socket cluster, or the existing CI-only
# localhost service. Fixed disposable database; never a supplied DB URL.
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
ci_service=false
if [[ "${1:-}" == --ci-service && "${CI:-}" == true && "${PGHOST:-}" == localhost ]]; then
  ci_service=true
  pg_bin="$(dirname "$(command -v psql)")"
  connection=(-h localhost -p "${PGPORT:-5432}")
elif [[ $# != 0 ]]; then
  echo 'Only --ci-service with CI=true and PGHOST=localhost is supported' >&2; exit 1
else
  pg_bin="${PG_BINDIR:-/opt/homebrew/opt/postgresql@17/bin}"
  if [[ ! -x "$pg_bin/initdb" ]]; then pg_bin="$(pg_config --bindir)"; fi
fi
fixture_dir="$(mktemp -d /tmp/nuke-search-pagination.XXXXXX)"
cleanup() {
  status=$?
  if [[ "$status" != 0 ]]; then
    for log in "$fixture_dir"/*.log; do [[ ! -f "$log" ]] || tail -80 "$log" >&2; done
  fi
  if [[ "$ci_service" == true ]]; then
    if [[ -f "$fixture_dir/created" ]]; then "$pg_bin/dropdb" "${connection[@]}" dm_refinement_search_pagination >/dev/null 2>&1 || true; fi
  else
    "$pg_bin/pg_ctl" -D "$fixture_dir/data" -m immediate stop >/dev/null 2>&1 || true
  fi
  rm -rf "$fixture_dir"
}
trap cleanup EXIT
if [[ "$ci_service" == false ]]; then
  mkdir "$fixture_dir/socket"
  "$pg_bin/initdb" -D "$fixture_dir/data" -A trust --no-locale -E UTF8 >"$fixture_dir/init.log" 2>&1
  "$pg_bin/pg_ctl" -D "$fixture_dir/data" -l "$fixture_dir/server.log" \
    -o "-c listen_addresses= -k $fixture_dir/socket -p 55489" -w start >/dev/null
  connection=(-h "$fixture_dir/socket" -p 55489)
fi
"$pg_bin/createdb" "${connection[@]}" dm_refinement_search_pagination
touch "$fixture_dir/created"
psql=("$pg_bin/psql" -X -v ON_ERROR_STOP=1 "${connection[@]}" -d dm_refinement_search_pagination)
"${psql[@]}" \
  -f "$repo_root/supabase/sql/test_search_vehicles_fts_pagination.sql" >"$fixture_dir/test.log" 2>&1
sed -n '/NOTICE:  PASS/p; /duration_ms=/p; /Execution Time:/p' "$fixture_dir/test.log"
python3 - "$fixture_dir/test.log" <<'PY'
import json,re,sys
log=open(sys.argv[1]).read()
plans=[]
for match in re.finditer(r'duration: [0-9.]+ ms\s+plan:\s*',log):
    plan=json.JSONDecoder().raw_decode(log[match.end():])[0]
    if 'FROM public.vehicles v' in plan.get('Query Text',''): plans.append(plan)
actual=[p['Plan']['Actual Rows'] for p in plans]
assert actual==[95,95,6000,100,95,6000,100],f'Unexpected nested branch plans: {actual}'
assert all('v.make = initcap(parsed_make)' in p['Query Text'] for p in plans[:3])
assert 'v.make != initcap(parsed_make)' in plans[3]['Query Text']
print('PASS nested plans: full pages run only exact branch; boundary runs exact then fallback before/after index')
def nodes(p):
    yield p
    for child in p.get('Plans',[]): yield from nodes(child)
for p in plans[:3]:
    assert any(n['Node Type']=='Sort' for n in nodes(p['Plan'])), 'Expected pre-index exact-make sort'
for p in [plans[4],plans[5]]:
    ns=list(nodes(p['Plan']))
    assert not any(n['Node Type'] in ['Sort','Incremental Sort'] for n in ns), 'Indexed exact-make branch still sorts'
    scans=[n for n in ns if n.get('Index Name')=='idx_vehicles_public_make_search_rank']
    assert len(scans)==1 and scans[0]['Node Type']=='Index Scan', 'Expected rank index scan'
assert next(n for n in nodes(plans[4]['Plan']) if n.get('Index Name')=='idx_vehicles_public_make_search_rank')['Actual Rows']==95
print('PASS indexed first page reads 95 ordered rows without full exact-make sort')
for name,plan in zip(['baseline first','patched first','boundary exact','boundary fallback','indexed first','indexed boundary exact','indexed boundary fallback'],plans):
    details=[{k:n[k] for k in ['Node Type','Actual Rows','Index Name','Sort Method','Sort Space Used'] if k in n} for n in nodes(plan['Plan'])]
    print(name+': '+json.dumps(details,separators=(',',':')))
PY
python3 - "$repo_root/supabase/migrations/20261013110000_vehicles_public_make_search_rank.sql" "${psql[@]}" <<'PY'
# Exercise real sessions and real failed concurrent builds on this disposable
# database. No catalog flag forgery and no production connection are involved.
import os,subprocess,sys,time
migration,*psql=sys.argv[1:]
def sql(query):
    return subprocess.run(psql+['-Atq','-c',query],text=True,capture_output=True,check=True,timeout=10).stdout.strip()
def refused(message):
    result=subprocess.run(psql+['-f',migration],text=True,capture_output=True,timeout=10)
    assert result.returncode and message in result.stderr, result.stdout+result.stderr
def wait_for(query,seconds=5):
    deadline=time.monotonic()+seconds
    while time.monotonic()<deadline:
        if sql(query)=='t': return
        time.sleep(.05)
    raise AssertionError('Fixture session did not reach expected state: '+query)
# Mirrors the migration preflight. Run only before refusals that expect a later
# message: an autovacuum worker on vehicles or a backend still exiting would
# otherwise trip the idle-lane check on loaded CI runners.
def wait_quiet():
    wait_for("SELECT NOT (EXISTS(SELECT FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock') "
             "OR EXISTS(SELECT FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND datname=current_database() "
             "AND (state LIKE 'idle in transaction%' OR (state='active' AND query ~* '(\\mvehicles\\M|search_vehicles_)'))) "
             "OR EXISTS(SELECT FROM pg_stat_progress_create_index WHERE pid<>pg_backend_pid()))",15)
def session(name,query):
    p=subprocess.Popen(psql+['-q'],stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
                       text=True,env={**os.environ,'PGAPPNAME':name})
    p.stdin.write(query+';\n'); p.stdin.flush(); return p
def finish(p):
    p.stdin.write('\\q\n'); p.stdin.close(); assert p.wait(timeout=5)==0

sql('ALTER TABLE public.vehicles SET (autovacuum_enabled=false, toast.autovacuum_enabled=false)')
reader=session('rank_fixture_reader','SELECT pg_sleep(1) FROM public.vehicles LIMIT 1')
try:
    wait_for("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='rank_fixture_reader' AND state='active')")
    refused('Search rank index requires an idle DDL lane')
finally: finish(reader)
print('PASS preflight refuses active target reader')

idle=session('rank_fixture_idle','BEGIN; SELECT 1')
try:
    wait_for("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='rank_fixture_idle' AND state='idle in transaction')")
    refused('Search rank index requires an idle DDL lane')
finally: finish(idle)
print('PASS preflight refuses idle transaction')

holder=session('rank_fixture_holder','SELECT pg_advisory_lock(310131100)')
wait_for("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='rank_fixture_holder' AND state='idle')")
waiter=session('rank_fixture_waiter','SELECT pg_advisory_lock(310131100)')
try:
    wait_for("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='rank_fixture_waiter' AND wait_event_type='Lock')")
    refused('Search rank index requires an idle DDL lane')
finally: finish(holder); finish(waiter)
print('PASS preflight refuses existing lock waiter')

sql('CREATE TABLE fixture_build_target AS SELECT n FROM generate_series(1,20)n; '
    'CREATE FUNCTION fixture_slow_key(n integer) RETURNS integer LANGUAGE plpgsql IMMUTABLE AS '
    "$$ BEGIN PERFORM pg_sleep(0.05); RETURN n; END $$")
builder=session('rank_fixture_builder','CREATE INDEX CONCURRENTLY fixture_active_build ON fixture_build_target(fixture_slow_key(n))')
try:
    wait_for("SELECT EXISTS(SELECT FROM pg_stat_progress_create_index WHERE relid='fixture_build_target'::regclass)")
    refused('Search rank index requires an idle DDL lane')
finally: finish(builder)
print('PASS preflight refuses another active concurrent build')

sql('DROP INDEX public.idx_vehicles_public_make_search_rank; '
    'CREATE INDEX idx_vehicles_public_make_search_rank ON public.vehicles(make)')
before=sql("SELECT pg_get_indexdef('public.idx_vehicles_public_make_search_rank'::regclass)")
wait_quiet()
refused('Search rank index conflict or invalid state')
assert sql("SELECT pg_get_indexdef('public.idx_vehicles_public_make_search_rank'::regclass)")==before
print('PASS conflicting valid index is refused and retained unchanged')

# Too-wide incompressible fixture make fails the actual btree build. This
# creates an invalid object with the *expected* definition, testing the state
# check separately from conflicting-definition refusal. Never truncate keys.
sql('DROP INDEX public.idx_vehicles_public_make_search_rank; DROP INDEX fixture_make_idx; '
    "INSERT INTO public.vehicles(id,year,make,model) SELECT 'ffffffff-ffff-ffff-ffff-ffffffffffff',2000,"
    "string_agg(md5(n::text),''),'wide fixture' FROM generate_series(1,300)n")
wait_quiet()
refused('index row requires')
assert sql("SELECT NOT indisvalid FROM pg_index WHERE indexrelid='public.idx_vehicles_public_make_search_rank'::regclass")=='t'
sql("DELETE FROM public.vehicles WHERE id='ffffffff-ffff-ffff-ffff-ffffffffffff'")
wait_quiet()
refused('Search rank index conflict or invalid state')
assert sql("SELECT NOT indisvalid FROM pg_index WHERE indexrelid='public.idx_vehicles_public_make_search_rank'::regclass")=='t'
print('PASS failed concurrent build leaves invalid index; retry refuses rather than silently accepting/dropping it')
PY
# Exact-definition drift must refuse the migration instead of silently replacing it.
"${psql[@]}" \
  -c 'ALTER FUNCTION public.search_vehicles_fts(text,integer,boolean,integer) COST 101' >/dev/null
if "${psql[@]}" \
  -f "$repo_root/supabase/migrations/20261013090000_search_vehicles_fts_single_offset.sql" >"$fixture_dir/drift.log" 2>&1; then
  echo 'FAIL: drifted owner was accepted' >&2; exit 1
fi
if ! grep -q 'Search reader owner drifted' "$fixture_dir/drift.log"; then cat "$fixture_dir/drift.log" >&2; exit 1; fi
echo 'PASS exact-definition drift refuses deployment'
