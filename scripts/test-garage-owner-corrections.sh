#!/usr/bin/env bash
# Installed PostgreSQL only; disposable Unix-socket cluster, never production.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
fixture="${1:-garage-owner-corrections}"
case "$fixture" in garage-owner-corrections|native-album-source) ;; *) echo "Unknown disposable fixture" >&2; exit 2 ;; esac
bindir="$(pg_config --bindir)"
fixture_dir="$(mktemp -d "${TMPDIR:-/tmp}/nuke-garage-sql.XXXXXX")"
cleanup() {
  status=$?
  if [[ "$status" != 0 ]]; then
    cat "$fixture_dir/init.log" "$fixture_dir/server.log" 2>/dev/null >&2 || true
  fi
  "$bindir/pg_ctl" -D "$fixture_dir/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$fixture_dir"
}
trap cleanup EXIT
mkdir "$fixture_dir/socket"
"$bindir/initdb" -D "$fixture_dir/data" -A trust --no-locale >"$fixture_dir/init.log" 2>&1
"$bindir/pg_ctl" -D "$fixture_dir/data" -l "$fixture_dir/server.log" \
  -o "-c listen_addresses= -k $fixture_dir/socket -p 55487" start >/dev/null
"$bindir/psql" -h "$fixture_dir/socket" -p 55487 -d postgres \
  -f "$root/scripts/tests/$fixture.sql"
