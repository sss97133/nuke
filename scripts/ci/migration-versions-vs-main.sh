#!/usr/bin/env bash
# Fails when a migration version in this checkout collides with one on the base branch as merged (default origin/main),
# counting the union of both file sets minus files this branch deleted or renamed since the merge-base. Two branches
# that each pass alone can still collide once both merge (#2660/#2661, #2678/#2680 on 2026-10-24).
#   scripts/ci/migration-versions-vs-main.sh [base_ref]
set -euo pipefail
base=${1:-origin/main}
root=$(git rev-parse --show-toplevel)
git fetch -q origin "+refs/heads/${base#origin/}:refs/remotes/$base" 2>/dev/null || echo "could not fetch $base; using local ref"
# CI checks out shallow; deepen until HEAD and base share history (needed to see what this branch renamed away)
for _ in 1 2 3 4 5 6; do git merge-base HEAD "$base" >/dev/null 2>&1 && break; git fetch -q --deepen=200 origin HEAD "${base#origin/}" 2>/dev/null || break; done
bash "$root/scripts/ci/migration-versions-unique.sh" "$root/supabase/migrations"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
gone=$(git diff --no-renames --name-only --diff-filter=D "$(git merge-base HEAD "$base")" -- supabase/migrations | xargs -rn1 basename)
{ ls "$root/supabase/migrations"; git ls-tree --name-only "$base" supabase/migrations/ | xargs -rn1 basename \
    | grep -vxF -f <(printf '%s\n' $gone) || true; } | sort -u | while read -r f; do : > "$tmp/$f"; done
bash "$root/scripts/ci/migration-versions-unique.sh" "$tmp" || { echo "migration version collides with $base as merged; rename the later file (and its rollback)"; exit 1; }
echo "migration versions unique against $base ($(git rev-parse --short "$base"))"
