#!/usr/bin/env bash
# Fails when two migration files share a version (the digits before the first underscore). The Supabase CLI keys
# migration history by that version, so a shared one breaks `supabase db reset` and history in fresh environments.
# Prints one line per shared version. Files before FLOOR are not checked: history up to 20261019021500 already holds
# shared versions that live applied long ago (this deploy applies added files with psql and never records versions).
#   scripts/ci/migration-versions-unique.sh [migrations_dir]
set -euo pipefail
dir=${1:-"$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/supabase/migrations"}
floor=20261019021501
[[ -d "$dir" ]] || { echo "no migrations directory: $dir"; exit 0; }
dups=$(ls "$dir" | grep -E '^[0-9]+_.*\.sql$' | awk -F_ -v f="$floor" '$1 >= f {print $1}' | sort | uniq -d)
[[ -z "$dups" ]] && exit 0
for v in $dups; do
  echo "shared migration version $v: $(ls "$dir" | grep -E "^${v}_" | tr '\n' ' ')"
done
exit 1
