#!/usr/bin/env bash
# subscription-reader-batch.sh — one bounded fire of the owner's subscription readers, for launchd.
#
# Owner decision 2026-11-08: "ai read should be fueled by my subscription". Both readers run `claude -p` under the owner's
# Claude Code login on this Mac (OAuth; ANTHROPIC_API_KEY is refused by the scripts), and post results to the edge
# functions, whose writers land them. This wrapper:
#   1. refreshes a checkout of origin/main (the stable ~/nuke checkout is on another branch and must not be moved),
#   2. runs the document reader (receipt-photo-ocr intake) for a bounded batch,
#   3. runs the frame classifier (photo-pipeline-orchestrator intake) for a bounded batch: first reads, then (same process)
#      deep readings and keyed values from the stage ledger, each bounded (DEEP_LIMIT, KEYED_LIMIT),
#   4. writes one heartbeat row per reader to job_assay_readings so a dead reader is never silent.
# Runs in the login shell (launchd), never inside Claude Code's sandbox. Secrets come from ~/nuke/.env via dotenvx and
# are never printed. Idempotent: each reader's work list excludes frames already read.
#
# Cadence (2026-11-20). launchd starts this every minute. A FULL fire is the one described above; it runs when the last
# one started FULL_EVERY seconds ago or more (default 570, so every tenth fire). Every other fire is a FAST one: it asks
# the ledger what it may start (subscription-frame-classifier.mjs --probe: first reads of newly landed photos that are
# queued and due, held to the hourly ceiling; three requests, about half a second) and runs the frame reader for first
# reads alone only when the answer is above zero, again while more are due, up to FAST_ROUNDS batches. So a photo is
# read within a minute or two of landing instead of at the next ten-minute fire, and a minute with nothing to read
# costs those requests: no checklist call, no CLI, no log line, no file.
# A fast fire that does not end clean (the subscription is spent, the reader failed, or it claimed nothing although
# the ledger said work was due) leaves a hold file, and fast fires stay off until a full fire's frame reader ends
# clean. With the subscription spent, the readers therefore run exactly as often as they did before fast fires.
#
#   subscription-reader-batch.sh [docs_limit=20] [frames_limit=20] [deep_limit=20] [keyed_limit=60]
set -u
# NUKE_READER_BIN: a directory searched before everything else (the wrapper's test puts its stand-ins there).
export PATH="${NUKE_READER_BIN:+$NUKE_READER_BIN:}/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin:$PATH"
DOCS_LIMIT="${1:-20}"; FRAMES_LIMIT="${2:-20}"; DEEP_LIMIT="${3:-20}"; KEYED_LIMIT="${4:-60}"
OWNER="${NUKE_OWNER_ID:-0b9f107a-d124-49de-9ded-94698f63c1c4}"
ENV_FILE="$HOME/nuke/.env"
MAIN="$HOME/.worktrees/nuke-main"
LOGDIR="$HOME/nuke/logs"; mkdir -p "$LOGDIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

if [ -n "${ANTHROPIC_API_KEY:-}" ]; then echo "refusing: ANTHROPIC_API_KEY set in the launchd environment"; exit 2; fi
FULL_EVERY="${NUKE_READER_FULL_EVERY:-570}"; FAST_ROUNDS="${NUKE_READER_FAST_ROUNDS:-6}"
FULL_STAMP="$LOGDIR/.subscription-reader-last-full"; FAST_HOLD="$LOGDIR/.subscription-reader-fast-hold"
last_full="$(cat "$FULL_STAMP" 2>/dev/null)"; case "$last_full" in ''|*[!0-9]*) last_full=0;; esac
if [ $(( $(date +%s) - last_full )) -ge "$FULL_EVERY" ]; then MODE=full; else MODE=fast; fi
[ "$MODE" = fast ] && [ -e "$FAST_HOLD" ] && exit 0
if pgrep -f "subscription-document-reader.mjs|subscription-frame-classifier.mjs" >/dev/null; then
  # a full fire that is due stays due (the stamp is not written), so it runs on the first minute the reader is free
  [ "$MODE" = full ] && echo "$STAMP a reader is already running; skipping this fire"
  exit 0
fi

# 1. a checkout of origin/main for the scripts (detached, fast-forwarded each full fire; a fast fire runs what is there)
if [ "$MODE" = full ]; then
  date +%s > "$FULL_STAMP"
  if [ ! -d "$MAIN/.git" ] && [ ! -f "$MAIN/.git" ]; then
    git -C "$HOME/nuke" worktree add --detach "$MAIN" origin/main >/dev/null 2>&1 || { echo "$STAMP cannot create $MAIN"; exit 1; }
  fi
  git -C "$MAIN" fetch -q origin main && git -C "$MAIN" checkout -q --detach origin/main || echo "$STAMP warning: main checkout not refreshed; running what is there"
fi

run_reader() { # name script args...
  local name="$1"; shift
  local out="$LOGDIR/$name-$STAMP${OUT_TAG:-}.json"   # OUT_TAG: a fast fire's batch number, so two batches in one second keep their own files
  local started_s; started_s=$(date +%s)
  local summary
  # the reader's own exit status, not tail's: a reader that crashed must not look like one that reported
  # READER_PATH_FIRST: a directory searched ahead of the rest of PATH for this reader only. On 2026-11-20 /usr/local/bin/claude
  # (2.1.20, no --safe-mode) shadowed ~/.local/bin/claude (2.1.329); the frame reader's lean calls need the newer one, and the
  # reader falls back to its old call when the CLI it finds cannot take them.
  summary="$(cd "$HOME/nuke" && PATH="${READER_PATH_FIRST:+$READER_PATH_FIRST:}$PATH" dotenvx run -q -f "$ENV_FILE" -- node "$@" --owner "$OWNER" --out "$out" 2>>"$LOGDIR/subscription-reader.log" | tail -1; exit "${PIPESTATUS[0]}")"
  local rc=$?
  echo "$STAMP $name exit=$rc ${summary:-no summary}"
  # How the fire ended, for the fast fires: the photos it claimed, and whether it ended clean (exit 0, first reads not
  # stopped). Both are read from the start of the summary line, ahead of anything a model wrote; the reader's own test
  # (subscription-frame-classifier.test.mjs, SUMMARY_HEAD and SUMMARY_CLEAN) holds the line to these two patterns.
  LAST_FRAMES="$(printf '%s' "$summary" | sed -n 's/^{"cli":"[a-z_]*","frames":\([0-9][0-9]*\),.*/\1/p')"; LAST_FRAMES="${LAST_FRAMES:-0}"
  LAST_CLEAN=0
  if [ "$rc" -eq 0 ] && printf '%s' "$summary" | grep -Eq '^\{"cli":"[a-z_]+","frames":[0-9]+,"source":"[a-z-]+","read":[0-9]+,"accepted":[0-9]+,"classifier_rejected":[0-9]+,"errors":[0-9]+,"error_classes":\{[^}]*\},"receipts":[0-9]+,"receipt_errors":[0-9]+,"stopped":null,'; then LAST_CLEAN=1; fi
  # A fire that did nothing leaves no receipt file behind: it claimed no frame and every count of work in its summary
  # is zero (a document fire that only re-landed pages keeps its file). On 2026-11-20, 352 of the 1,059 frame files and
  # 840 of the 1,053 document files in ~/nuke/logs held no rows.
  if [ "$rc" -eq 0 ] && printf '%s' "$summary" | grep -q '"frames":0,' \
     && ! printf '%s' "$summary" | grep -Eq '"(claimed|landed|to_land|relanded|reland_vehicle_document|reland_errors|errors|receipt_errors)":[1-9]'; then rm -f "$out"; fi
  # 4. heartbeat: record_reader_heartbeat (service role only) upserts one job_assay_readings row per reader; the cron job
  #    subscription-reader-watch fails when either row is older than 40 minutes, so v_job_health shows a silent reader.
  #    The summary is model-derived text (by_type keys are read off photographed documents). It travels in the
  #    environment and reader-heartbeat.mjs parses it as JSON; it is never part of a shell command line.
  local elapsed_ms=$(( ( $(date +%s) - started_s ) * 1000 ))
  #    No heartbeat is posted when the reader exited non-zero or printed no JSON summary (exit 3), so the watch sees it.
  local beat
  beat="$(READER_NAME="$name" READER_SUMMARY="$summary" READER_EXIT="$rc" READER_ELAPSED_MS="$elapsed_ms" \
    dotenvx run -q -f "$ENV_FILE" -- node "$MAIN/scripts/photo-pipeline/reader-heartbeat.mjs" 2>>"$LOGDIR/subscription-reader.log")"
  [ $? -eq 0 ] || echo "$STAMP heartbeat for $name did not land: ${beat:-no output}"
}

FRAME_READER="$MAIN/scripts/photo-pipeline/subscription-frame-classifier.mjs"
if [ "$MODE" = fast ]; then
  round=0
  while [ "$round" -lt "$FAST_ROUNDS" ]; do
    round=$((round + 1))
    # What may start now. A probe that cannot see the ledger says so in one line, starts nothing and holds the fast fires.
    probe="$(cd "$HOME/nuke" && dotenvx run -q -f "$ENV_FILE" -- node "$FRAME_READER" --owner "$OWNER" --probe 2>&1)"
    start="$(printf '%s\n' "$probe" | sed -n 's/^{"probe":true,.*"start":\([0-9][0-9]*\)}$/\1/p' | tail -1)"
    if [ -z "$start" ]; then
      date +%s > "$FAST_HOLD"
      echo "$STAMP probe failed: $(printf '%s\n' "$probe" | grep -v '^[[:space:]]*$' | head -1 | cut -c1-160); fast fires wait for a clean full fire"
      exit 0
    fi
    [ "$start" -gt 0 ] || exit 0
    [ "$start" -lt "$FRAMES_LIMIT" ] || start="$FRAMES_LIMIT"
    STAMP="$(date -u +%Y%m%dT%H%M%SZ)"; OUT_TAG="-$round"
    READER_PATH_FIRST="$HOME/.local/bin" run_reader subscription-frame-classifier "$FRAME_READER" --limit "$start" --concurrency 2 --status failed,pending --deep-limit 0 --keyed-limit 0
    if [ "$LAST_CLEAN" -ne 1 ] || [ "$LAST_FRAMES" -lt 1 ]; then
      date +%s > "$FAST_HOLD"
      echo "$STAMP fast fire did not end clean or claimed none of the $start due; fast fires wait for a clean full fire"
      exit 0
    fi
  done
  exit 0
fi

# 2. documents, then 3. frames (failed first, then pending). Both readers name the model in full (claude-sonnet-5-5) and
#    need the newer CLI for it, so both search ~/.local/bin first.
READER_PATH_FIRST="$HOME/.local/bin" run_reader subscription-document-reader "$MAIN/scripts/photo-pipeline/subscription-document-reader.mjs" --limit "$DOCS_LIMIT" --concurrency 2
READER_PATH_FIRST="$HOME/.local/bin" run_reader subscription-frame-classifier "$FRAME_READER" --limit "$FRAMES_LIMIT" --concurrency 2 --status failed,pending --deep-limit "$DEEP_LIMIT" --keyed-limit "$KEYED_LIMIT"
# fast fires run only after a full fire whose first reads ended clean; a full fire that holds them says so
if [ "$LAST_CLEAN" -eq 1 ]; then rm -f "$FAST_HOLD"; else
  date +%s > "$FAST_HOLD"
  echo "$STAMP the frame reader did not end clean; fast fires wait for a clean full fire"
fi
