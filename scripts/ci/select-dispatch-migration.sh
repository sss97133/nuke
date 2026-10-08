#!/usr/bin/env bash
# Exact-file recovery through reviewed CI; never infer a range from a filename.
set -euo pipefail
requested_file="${1:-}"
repo_root="${2:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
if [[ ! "$requested_file" =~ ^[0-9]{14}_[a-z0-9_]+\.sql$ ]]; then
  echo 'A single timestamped migration filename is required' >&2
  exit 1
fi
relative_path="supabase/migrations/$requested_file"
if [[ ! -f "$repo_root/$relative_path" ]] ||
   ! git -C "$repo_root" ls-files --error-unmatch -- "$relative_path" >/dev/null 2>&1; then
  echo 'Requested migration must be an existing tracked file' >&2
  exit 1
fi
printf '%s\n' "$relative_path"
