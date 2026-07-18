#!/usr/bin/env bash
# PreToolUse hook: stop an agent from minting a NEW edge function whose name the
# ledger already rules (canonical owner exists, or the name is DEAD — a resurrection).
#
# Fires on Write|Edit. Only acts when the target is a NEW supabase/functions/<name>/
# file (file doesn't exist yet = a mint; edits to existing functions pass untouched —
# extending a canonical function is exactly what we want agents to do).
#
# Exit 0  = allow.   Exit 2 = block; stderr is fed back to the agent with the reason.
# Escape hatch for a deliberate, human-approved mint: create the file manually first,
# or run:  MINT_OK=1 <agent command>  (hook honors MINT_OK).
set -u
[ "${MINT_OK:-0}" = "1" ] && exit 0

INPUT=$(cat)
FILE=$(printf '%s' "$INPUT" | node -e "
  let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
    try{process.stdout.write(JSON.parse(s).tool_input?.file_path||'')}catch{}
  })" 2>/dev/null)

[ -z "$FILE" ] && exit 0
case "$FILE" in
  */supabase/functions/*/*) : ;;
  *) exit 0 ;;
esac
# Existing file = an edit, not a mint. Allow.
[ -e "$FILE" ] && exit 0
# Function name = the segment right after functions/. Derive the checkout root from
# the file's own path so git worktrees are handled correctly (no hardcoded home).
FN=$(printf '%s' "$FILE" | sed -E 's#.*/supabase/functions/([^/]+)/.*#\1#')
ROOT=${FILE%%/supabase/functions/*}
# New file inside an EXISTING function dir = extending, not minting. Allow.
[ -d "$ROOT/supabase/functions/$FN" ] && exit 0
[ "${FN#_}" != "$FN" ] && exit 0   # _shared etc.

RESULT=$(node /Users/skylar/nuke/scripts/guardrails/check-capability-before-mint.mjs "$FN" 2>&1)
if [ $? -eq 1 ]; then
  {
    echo "MINT BLOCKED: '$FN' — the ledger already rules this name/capability."
    echo "$RESULT" | head -12
    echo "Extend the canonical owner instead (docs/ledger/CAPABILITY_MAP.md)."
    echo "Deliberate new capability? Ask Skylar, then re-run with MINT_OK=1."
  } >&2
  exit 2
fi
exit 0
