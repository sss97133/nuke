#!/usr/bin/env bash
# subscription-reader-batch.sh — one bounded fire of the owner's subscription readers, for launchd.
#
# Owner decision 2026-11-08: "ai read should be fueled by my subscription". Both readers run `claude -p` under the owner's
# Claude Code login on this Mac (OAuth; ANTHROPIC_API_KEY is refused by the scripts), and post results to the edge
# functions, whose writers land them. This wrapper:
#   1. refreshes a checkout of origin/main (the stable ~/nuke checkout is on another branch and must not be moved),
#   2. runs the document reader (receipt-photo-ocr intake) for a bounded batch,
#   3. runs the frame classifier (photo-pipeline-orchestrator intake) for a bounded batch,
#   4. writes one heartbeat row per reader to job_assay_readings so a dead reader is never silent.
# Runs in the login shell (launchd), never inside Claude Code's sandbox. Secrets come from ~/nuke/.env via dotenvx and
# are never printed. Idempotent: each reader's work list excludes frames already read.
#
#   subscription-reader-batch.sh [docs_limit=20] [frames_limit=20]
set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin:$PATH"
DOCS_LIMIT="${1:-20}"; FRAMES_LIMIT="${2:-20}"
OWNER="${NUKE_OWNER_ID:-0b9f107a-d124-49de-9ded-94698f63c1c4}"
ENV_FILE="$HOME/nuke/.env"
MAIN="$HOME/.worktrees/nuke-main"
LOGDIR="$HOME/nuke/logs"; mkdir -p "$LOGDIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

if [ -n "${ANTHROPIC_API_KEY:-}" ]; then echo "refusing: ANTHROPIC_API_KEY set in the launchd environment"; exit 2; fi
if pgrep -f "subscription-document-reader.mjs|subscription-frame-classifier.mjs" >/dev/null; then echo "$STAMP a reader is already running; skipping this fire"; exit 0; fi

# 1. a checkout of origin/main for the scripts (detached, fast-forwarded each fire)
if [ ! -d "$MAIN/.git" ] && [ ! -f "$MAIN/.git" ]; then
  git -C "$HOME/nuke" worktree add --detach "$MAIN" origin/main >/dev/null 2>&1 || { echo "$STAMP cannot create $MAIN"; exit 1; }
fi
git -C "$MAIN" fetch -q origin main && git -C "$MAIN" checkout -q --detach origin/main || echo "$STAMP warning: main checkout not refreshed; running what is there"

run_reader() { # name script args...
  local name="$1"; shift
  local out="$LOGDIR/$name-$STAMP.json"
  local started_s; started_s=$(date +%s)
  local summary
  summary="$(cd "$HOME/nuke" && dotenvx run -q -f "$ENV_FILE" -- node "$@" --owner "$OWNER" --out "$out" 2>>"$LOGDIR/subscription-reader.log" | tail -1)"
  [ -n "$summary" ] || summary='{"error":"no summary"}'
  echo "$STAMP $name $summary"
  # 4. heartbeat: record_reader_heartbeat (service role only) upserts one job_assay_readings row per reader; the cron job
  #    subscription-reader-watch fails when either row is older than 40 minutes, so v_job_health shows a silent reader.
  local elapsed_ms=$(( ( $(date +%s) - started_s ) * 1000 ))
  dotenvx run -q -f "$ENV_FILE" -- bash -c 'curl -sS --max-time 20 -o /dev/null -w "%{http_code}" -X POST "$SUPABASE_URL/rest/v1/rpc/record_reader_heartbeat" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "Content-Type: application/json" \
    -d "{\"p_jobname\":\"'"$name"'\",\"p_reading\":'"$summary"',\"p_elapsed_ms\":'"$elapsed_ms"'}"' \
    | { read -r code; [ "$code" = "200" ] || echo "$STAMP heartbeat for $name returned HTTP $code"; }
}

# 2. documents, then 3. frames (failed first, then pending)
run_reader subscription-document-reader "$MAIN/scripts/photo-pipeline/subscription-document-reader.mjs" --limit "$DOCS_LIMIT" --concurrency 2
run_reader subscription-frame-classifier "$MAIN/scripts/photo-pipeline/subscription-frame-classifier.mjs" --limit "$FRAMES_LIMIT" --concurrency 2 --status failed,pending
