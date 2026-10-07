#!/bin/bash
# scripts/night-run/run.sh: one bounded nightly Claude Code session that works the repair loop and opens PRs
# for the lead's morning review. It runs on the owner's subscription through `claude -p`, never on API billing
# (ANTHROPIC_API_KEY is unset for the child). The session never merges, deploys, pushes to main or loads jobs;
# prompt.md holds the work order and the rails.
#
#   bash scripts/night-run/run.sh            # the nightly run (ag.nuke.night-run.plist)
#   bash scripts/night-run/run.sh --dry-run  # prepare the worktree and the report header, ask nothing
#
# Env: NIGHT_RUN_REPO (default ~/nuke, used for git and the dotenvx .env only), NIGHT_RUN_CAP (default 45m),
#      NIGHT_RUN_MODEL (default claude-opus-5-5).
set -euo pipefail

DATE=$(date -u +%Y-%m-%d)
REPO=${NIGHT_RUN_REPO:-$HOME/nuke}
WT=$HOME/.worktrees/night-run-$DATE
LOG_DIR=$HOME/nuke-logs/night-run
REPORT=$LOG_DIR/$DATE.md
CAP=${NIGHT_RUN_CAP:-45m}
MODEL=${NIGHT_RUN_MODEL:-claude-opus-5-5}
SCHEMA_LAW_DIR=$HOME/lofficiel-concierge/supabase

mkdir -p "$LOG_DIR"
git -C "$REPO" fetch -q origin main
# One worktree per night, detached at origin/main; the session branches from it for each PR.
[ -d "$WT" ] || git -C "$REPO" worktree add -q --detach "$WT" origin/main
# The pre-commit hook type-checks the frontend; share the main checkout's node_modules.
[ -e "$WT/nuke_frontend/node_modules" ] || ln -s "$REPO/nuke_frontend/node_modules" "$WT/nuke_frontend/node_modules"

PROMPT=$WT/scripts/night-run/prompt.md
{
  echo
  echo "## Run $(date -u +%FT%TZ)"
  echo "model $MODEL · cap $CAP · worktree $WT · main $(git -C "$WT" rev-parse --short HEAD)"
} >> "$REPORT"

if [ "${1:-}" = "--dry-run" ]; then
  echo "- dry run: would ask $MODEL with $PROMPT in $WT" | tee -a "$REPORT"
  exit 0
fi

cd "$WT"
set +e
/usr/bin/caffeinate -i /opt/homebrew/bin/gtimeout -k 60 "$CAP" \
  /opt/homebrew/bin/dotenvx run -q -f "$REPO/.env" -- \
  env -u ANTHROPIC_API_KEY claude -p "$(cat "$PROMPT")" \
    --model "$MODEL" \
    --permission-mode acceptEdits \
    --add-dir "$SCHEMA_LAW_DIR" \
    --allowedTools "Read" "Edit" "Write" "Grep" "Glob" \
      "Bash(git status*)" "Bash(git diff*)" "Bash(git log*)" "Bash(git show*)" "Bash(git fetch*)" \
      "Bash(git switch*)" "Bash(git checkout*)" "Bash(git add*)" "Bash(git commit*)" "Bash(git push -u origin night/*)" \
      "Bash(gh pr create*)" "Bash(gh pr view*)" "Bash(gh pr list*)" "Bash(gh pr checks*)" \
      "Bash(scripts/data/q.sh*)" "Bash(node --test*)" "Bash(ls*)" "Bash(date*)" "Bash(wc*)" \
    --disallowedTools "Bash(gh pr merge*)" "Bash(git push origin main*)" "Bash(git push --force*)" \
      "Bash(launchctl*)" "Bash(supabase*)" "Bash(psql*)" "Bash(curl*)" \
    --output-format text >> "$LOG_DIR/$DATE.transcript.txt" 2>&1
rc=$?
set -e

case $rc in
  0) echo "- session finished (exit 0)" >> "$REPORT" ;;
  124) echo "- session stopped at the $CAP cap" >> "$REPORT" ;;
  *) echo "- session failed (exit $rc); see $DATE.transcript.txt" >> "$REPORT" ;;
esac
exit 0
