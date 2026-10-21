#!/usr/bin/env bash
# Database contracts: every supabase/sql/test_*.sql, each in its own fresh database on one PostgreSQL server.
# Not run here: a file a workflow job names (that job runs it with its own setup) and a file listed in
# scripts/ci/db-contracts-skip.txt. A contract runs as `psql -X -v ON_ERROR_STOP=1 -f <file>` from the repo root in
# a database named dm_refinement_<name>, the prefix the contracts' disposable-database guards accept. Afterwards its
# database and any role it created are dropped, and the server's roles, memberships, databases and role settings
# must be what they were before the first contract, so each contract sees the server a job of its own would.
#
#   scripts/ci/run-db-contracts.sh [test_x.sql ...]  on a fresh local server (PG_BINDIR, default Homebrew PG 17)
#   scripts/ci/run-db-contracts.sh --ci-service      on the CI postgres service (CI=true, PGHOST=localhost)
#   scripts/ci/run-db-contracts.sh --list            print the contracts and exit
#
# Named files run regardless of the skip rules. Keeps going after a failure, prints a summary table, and exits 1 if
# any contract failed.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"
skip_list=scripts/ci/db-contracts-skip.txt

mode=local; list_only=false; requested=()
for arg in "$@"; do
  case "$arg" in
    --ci-service) mode=ci ;;
    --list) list_only=true ;;
    test_*.sql | supabase/sql/test_*.sql) requested+=("${arg##*/}") ;;
    *) echo "usage: $0 [--ci-service] [--list] [test_x.sql ...]" >&2; exit 2 ;;
  esac
done
if [[ "$mode" == ci && ( "${CI:-}" != true || "${PGHOST:-}" != localhost ) ]]; then
  echo '--ci-service needs CI=true and PGHOST=localhost' >&2; exit 2
fi

contracts=(); not_named=0; not_listed=0
if [[ ${#requested[@]} -gt 0 ]]; then
  for f in "${requested[@]}"; do
    [[ -f "supabase/sql/$f" ]] || { echo "no such contract: supabase/sql/$f" >&2; exit 2; }
    contracts+=("$f")
  done
else
  named=" $(grep -ohE 'supabase/sql/test_[A-Za-z0-9_]+\.sql' .github/workflows/*.yml | sed 's#.*/##' | tr '\n' ' ' ||
    true)"
  listed=" $(sed 's/#.*//' "$skip_list" | tr -s ' \t' '\n\n' | grep -E '^test_' | tr '\n' ' ' || true)"
  for f in $(cd supabase/sql && printf '%s\n' test_*.sql | LC_ALL=C sort); do
    case "$named" in *" $f "*) not_named=$((not_named + 1)); continue ;; esac
    case "$listed" in *" $f "*) not_listed=$((not_listed + 1)); continue ;; esac
    contracts+=("$f")
  done
fi
if [[ "$list_only" == true ]]; then
  [[ ${#contracts[@]} -eq 0 ]] || printf '%s\n' "${contracts[@]}"
  exit 0
fi
if [[ ${#contracts[@]} -eq 0 ]]; then
  echo '::error::no database contracts found in supabase/sql/test_*.sql' >&2; exit 1
fi

work="$(mktemp -d /tmp/db-contracts.XXXXXX)"
if [[ "$mode" == ci ]]; then
  pg_bin="$(dirname "$(command -v psql)")"
  trap 'rm -rf "$work"' EXIT
else
  pg_bin="${PG_BINDIR:-/opt/homebrew/opt/postgresql@17/bin}"
  if [[ ! -x "$pg_bin/initdb" ]]; then pg_bin="$(pg_config --bindir)"; fi
  "$pg_bin/initdb" -D "$work/data" -U postgres -A trust -E UTF8 --locale-provider=icu --icu-locale=en-US \
    --locale=en_US.UTF-8 >"$work/initdb.log" 2>&1
  "$pg_bin/pg_ctl" -D "$work/data" -l "$work/server.log" -w -t 60 -o "-c listen_addresses= -k $work -p 5432" \
    start >/dev/null
  trap '"$pg_bin/pg_ctl" -D "$work/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$work"' EXIT
  export PGHOST="$work" PGPORT=5432 PGUSER=postgres
  unset PGPASSWORD PGDATABASE PGSERVICE
fi
psql=("$pg_bin/psql" -X -v ON_ERROR_STOP=1)
export DB_CONTRACT_PSQL="$pg_bin/psql"
in_actions=false; stream=/dev/null
if [[ "${GITHUB_ACTIONS:-}" == true ]]; then in_actions=true; stream=/dev/stdout; fi

now() {  # bash 5 has EPOCHREALTIME; macOS's bash 3.2 does not
  if [[ -n "${EPOCHREALTIME:-}" ]]; then echo "${EPOCHREALTIME/,/.}"
  else perl -MTime::HiRes=time -e 'printf "%.6f", time'; fi
}
seconds() { awk -v a="$1" -v b="$2" 'BEGIN { printf "%.1f", b - a }'; }
server_state() {
  "${psql[@]}" -qAt -d postgres <<'SQL'
SELECT format('role %s super=%s inherit=%s createrole=%s createdb=%s login=%s replication=%s bypassrls=%s connlimit=%s',
              rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication, rolbypassrls,
              rolconnlimit) FROM pg_roles
UNION ALL SELECT format('member %s of %s', member::regrole, roleid::regrole) FROM pg_auth_members
UNION ALL SELECT format('database %s', datname) FROM pg_database
UNION ALL SELECT format('setting %s %s %s', setdatabase, setrole, setconfig) FROM pg_db_role_setting
UNION ALL SELECT format('tablespace %s', spcname) FROM pg_tablespace
ORDER BY 1;
SQL
}
server_roles() { "${psql[@]}" -qAt -d postgres -c "SELECT string_agg(rolname, ',') FROM pg_roles"; }
baseline="$(server_state)"; baseline_roles="$(server_roles)"
reset_server() {  # drop the contract's database and any other dm_ database it left (a contract that stops midway
  # never reaches its own cleanup, and a database it made still holding objects of its roles makes DROP ROLE fail for
  # every contract after it), then every role created since the first contract
  "$pg_bin/dropdb" --if-exists --force "$1" &&
    "${psql[@]}" -q -d postgres -v keep="$baseline_roles" <<'SQL'
SELECT format('DROP DATABASE %I WITH (FORCE)', datname) FROM pg_database WHERE datname LIKE 'dm\_%' \gexec
SELECT format('DROP ROLE %I', rolname) FROM pg_roles WHERE rolname <> ALL (string_to_array(:'keep', ',')) \gexec
SQL
}

started="$(now)"; rows=(); failed=0
for f in "${contracts[@]}"; do
  name="${f#test_}"; db="dm_refinement_${name%.sql}"; db="${db:0:63}"; log="$work/${f%.sql}.log"
  if $in_actions; then echo "::group::$f ($db)"; fi
  t0="$(now)"
  set +e
  { "$pg_bin/createdb" "$db" && "${psql[@]}" -d "$db" -f "supabase/sql/$f"; } 2>&1 | tee "$log" >"$stream"
  status=${PIPESTATUS[0]}
  set -e
  t1="$(now)"; took="$(seconds "$t0" "$t1")"
  if $in_actions; then echo '::endgroup::'; fi
  left="$("${psql[@]}" -qAt -d postgres -v db="$db" <<'SQL' || true
SELECT string_agg('  left: database ' || datname || ' (dropped by the reset)', E'\n' ORDER BY datname)
  FROM pg_database WHERE datname LIKE 'dm\_%' AND datname <> :'db'
SQL
)"
  if reset_server "$db" >"$log.reset" 2>&1; then
    changed="$(diff <(printf '%s\n' "$baseline") <(server_state) | sed -n 's/^< /  was: /p; s/^> /  now: /p' || true)"
  else
    changed="  reset failed: $(tr '\n' ' ' <"$log.reset")"
  fi
  if [[ -n "$left" ]]; then changed="$left${changed:+$'\n'$changed}"; fi
  if [[ "$status" -ne 0 ]]; then
    result=fail
    echo "::error file=supabase/sql/$f,title=Database contract failed::$f failed (exit $status) after $took s"
    tail -n 40 "$log"
  elif [[ -n "$changed" ]]; then
    result=leak
    echo "::error file=supabase/sql/$f,title=Database contract changed the server::$f passed but changed the server"
  else
    result=pass
  fi
  if [[ -n "$changed" ]]; then  # report the change once; the next contract is judged from the server it starts on
    printf '%s\n' "$changed"
    baseline="$(server_state)"; baseline_roles="$(server_roles)"
  fi
  [[ "$result" == pass ]] || failed=$((failed + 1))
  if ! $in_actions; then echo "$result $took s $f"; fi
  rows+=("$(printf '%-6s %7s  %s' "$result" "$took" "$f")")
done

headline="db-contracts: $((${#contracts[@]} - failed)) passed, $failed failed in $(seconds "$started" "$(now)") s"
if [[ ${#requested[@]} -eq 0 ]]; then
  headline="$headline; not run here: $not_named named by a workflow job, $not_listed in $skip_list"
fi
echo; echo "$headline"; printf '%-6s %7s  %s\n' result seconds contract; printf '%s\n' "${rows[@]}"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  { echo "### $headline"; echo; echo '| result | seconds | contract |'; echo '|---|---:|---|'
    printf '%s\n' "${rows[@]}" | awk '{ printf "| %s | %s | `%s` |\n", $1, $2, $3 }'; } >>"$GITHUB_STEP_SUMMARY"
fi
[[ "$failed" -eq 0 ]]
