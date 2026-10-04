#!/usr/bin/env bash
# Shared Claude/Codex PreToolUse hook: block raw SQL writes to testimony tables.
# Forces agents through ingest-observation / supersession instead of God-mode INSERT/UPDATE/DELETE.
# Skylar's mandate (2026-05-23): "you as an agent under me as a user", no service-role bypass writes.
#
# Bypass: include the literal comment "-- ALLOW_RAW_TESTIMONY_WRITE" in the SQL.
# Intentional friction — the marker must be typed deliberately by the agent for each call.

set -u

input=$(cat)
tool_name=$(printf '%s' "$input" | /usr/bin/env jq -r '.tool_name // ""' 2>/dev/null || echo "")

sql_text=""
case "$tool_name" in
  # Hand-applied migrations and function deploys bypass CI (AGENTS.md: "Deploys belong to CI —
  # never hand-applied"; plan warm-nibbling-nebula P3.6, 2026-09-27). Ship a commit instead.
  mcp__*supabase*apply_migration|mcp__*Supabase*apply_migration|mcp__*supabase*deploy_edge_function|mcp__*Supabase*deploy_edge_function)
    cat >&2 <<EOF
BLOCKED: $tool_name hand-applies to prod and skips CI.

Migrations and edge functions ship as ONE commit on origin/main; .github/workflows/supabase-deploy.yml
applies exactly what that commit changed. Write the migration/function in a worktree, commit, and push it
yourself once gh run list --workflow supabase-deploy.yml is idle; tell the other sessions first (AGENTS.md).
EOF
    exit 2
    ;;
  mcp__*supabase*execute_sql|mcp__*Supabase*execute_sql)
    sql_text=$(printf '%s' "$input" | /usr/bin/env jq -r '.tool_input.query // ""' 2>/dev/null)
    ;;
  Bash|exec_command|functions.exec_command)
    sql_text=$(printf '%s' "$input" | /usr/bin/env jq -r '.tool_input.command // .tool_input.cmd // ""' 2>/dev/null)
    ;;
  *)
    exit 0
    ;;
esac

# Explicit bypass marker — must be in the SQL/command, not the env
if printf '%s' "$sql_text" | grep -q -- '-- *ALLOW_RAW_TESTIMONY_WRITE'; then
  exit 0
fi

TESTIMONY='vehicle_observations|vehicle_images|vehicle_events|vehicle_user_permissions|vehicle_aliases|vehicle_timeline|auction_comments|merge_proposals|observation_discoveries|comment_discoveries|description_discoveries'

if printf '%s' "$sql_text" | grep -qiE "INSERT[[:space:]]+INTO[[:space:]]+(public\.)?($TESTIMONY)\b"; then
  cat >&2 <<EOF
BLOCKED: raw INSERT into testimony table.

Per ~/.claude/projects/-Users-skylar/memory/feedback_agent_under_skylar_writes_through_ingest_observation.md
and /Users/skylar/nuke/.claude/rules/agent-trust-invariants.md:

  - Atom writes flow through the 'ingest-observation' edge function, not raw INSERT.
  - Ownership rows (vehicle_user_permissions) require evidence-of-ownership gate.
  - Service-role bypass writes are how the 1974 Blazer auto-promotion happened (2026-05-23).

If this is a legitimate maintenance/migration/cockpit path that genuinely needs raw write,
include the literal comment '-- ALLOW_RAW_TESTIMONY_WRITE' in the SQL to bypass.
The marker must be typed deliberately — that's the friction by design.
EOF
  exit 2
fi

if printf '%s' "$sql_text" | grep -qiE "(UPDATE|DELETE[[:space:]]+FROM)[[:space:]]+(public\.)?($TESTIMONY)\b"; then
  cat >&2 <<EOF
BLOCKED: UPDATE/DELETE on testimony table.

Testimony is immutable per the trust invariant. The K5/GAA-43671 incident (2026-05-01)
is the cautionary tale: a delete orphaned a real vehicle from its auction history forever.

Use supersession instead:
  - Write a new row.
  - Set the old row's is_superseded=true, superseded_by=<new_id>, superseded_at=now().
  - This preserves the audit trail and lets readers walk lineage.

See docs/library/intellectual/contemplations/the-trust-invariant.md.

If you genuinely need raw write (recovery from a corruption you authored, etc.),
include '-- ALLOW_RAW_TESTIMONY_WRITE' in the SQL. Friction is the feature.
EOF
  exit 2
fi

exit 0
