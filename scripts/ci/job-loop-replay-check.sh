#!/usr/bin/env bash
# Plan check for supabase/sql/test_job_loop_replay.sql (run from the repo root by that contract). Prints nothing when
# the replay covers the build; otherwise one problem per line:
#   missing <file>    a migration at or after the build start whose name looks job-loop is neither replayed nor
#                     declared out of scope in the contract (append it there, in filename order)
#   unordered <file>  the replayed files are not in filename order (a fresh environment applies them sorted)
#   absent <file>     the contract replays a file that does not exist
set -euo pipefail
contract=supabase/sql/test_job_loop_replay.sql
start=20261019005027
pattern='(work_order|work_resource|quote|offer|job_|inspection|contact_broker|provider_|signature|facilit|account_link|actor_link|requirement|evidence_attach|invoice|completion|cosign|vouch|change_order|post_work|start_work|listing_work_plan)'
replayed=$(grep -E '^\\ir \.\./migrations/' "$contract" | sed 's#.*/##')
for f in $(ls supabase/migrations | awk -v s="$start" '$0 >= s' | grep -E "$pattern" || true); do
  grep -qF "migrations/$f" "$contract" || echo "missing $f"
done
prev=''
for f in $replayed; do
  [[ -f "supabase/migrations/$f" ]] || echo "absent $f"
  [[ -z "$prev" || "$prev" < "$f" ]] || echo "unordered $f"
  prev=$f
done
