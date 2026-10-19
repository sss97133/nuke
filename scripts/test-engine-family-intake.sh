#!/usr/bin/env bash
# Real handler / PostgreSQL / reader contract in an already-created disposable DB.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${PGHOST:?explicit local host required}" "${PGPORT:?explicit port required}"
: "${PGUSER:?explicit user required}" "${PGDATABASE:?empty disposable database required}"
[[ "$PGDATABASE" =~ ^dm_refinement_[A-Za-z0-9_]+$ ]] || exit 2
case "$PGHOST" in localhost|127.0.0.1|::1|/private/tmp/*|/tmp/*) ;; *) exit 2 ;; esac
[[ "$PGHOST" != *..* ]] || exit 2
export PSQL_BIN="${PSQL_BIN:-$(command -v psql)}"
# A GitHub service container is reached through localhost but reports its bridge IP.
fixture_container=false
if [[ "${GITHUB_ACTIONS:-}" == true && "${GITHUB_JOB:-}" == engine-family-intake && "$PGHOST" == localhost && "$PGDATABASE" == dm_refinement_engine_family_ci ]]; then
  fixture_container=true
fi
fixture_local=$("$PSQL_BIN" -XAtq -v ON_ERROR_STOP=1 -c "SELECT current_database() LIKE 'dm_refinement_%' AND (inet_server_addr() IS NULL OR host(inet_server_addr()) IN('127.0.0.1','::1') OR ($fixture_container AND (inet_server_addr() <<= inet '10.0.0.0/8' OR inet_server_addr() <<= inet '172.16.0.0/12' OR inet_server_addr() <<= inet '192.168.0.0/16'))) AND NOT pg_is_in_recovery()")
[[ "$fixture_local" == t ]] || { echo 'Refusing a non-local disposable database' >&2; exit 2; }
"$PSQL_BIN" -Xq -v ON_ERROR_STOP=1 -f supabase/sql/test_retained_engine_family_intake_fixture.sql
deno_flags=(--node-modules-dir=none -A)
[[ "${DENO_TEST_CACHE_ONLY:-0}" != 1 ]] || deno_flags+=(--cached-only)
RUN_ENGINE_FAMILY_PG=1 deno test "${deno_flags[@]}" supabase/functions/ingest-observation/engineFamilyPostgres.test.ts
