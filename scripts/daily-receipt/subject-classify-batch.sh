#!/usr/bin/env bash
# subject-classify-batch.sh — TEXT-ONLY subject classification on the SUBSCRIPTION.
#
# Reads the narratives the deep-analysis drain already wrote (NO new vision, no API
# tokens) and asks Claude which OWNED vehicle each frame depicts, so mis-attributed
# frames can be flagged/re-homed. Auth is the Claude subscription via
# CLAUDE_CODE_OAUTH_TOKEN (same as the analysis drain); we never set ANTHROPIC_API_KEY.
#
# Usage: subject-classify-batch.sh <user-id> [batch_size]
set -u
cd "$(dirname "$0")/../.." || exit 1
USER_ID="${1:?usage: subject-classify-batch.sh <user-id> [batch_size]}"
BATCH="${2:-40}"
MODEL="${BYOK_MODEL:-claude-sonnet-4-6}"
DIR="$(mktemp -d)"; JOB="$DIR/job.json"; PROMPT="$DIR/prompt.txt"; OUT="$DIR/out.json"
log(){ echo "$(date -u '+%F %T') | subject-classify | $*"; }
trap 'rm -rf "$DIR"' EXIT

# 1) PREPARE — owned candidates + a batch of unclassified analyzed frames (narratives).
dotenvx run -- node scripts/classify-image-subjects.mjs prepare --user-id "$USER_ID" --limit "$BATCH" > "$JOB" 2>/dev/null
FRAMES=$(node -e 'const j=require(process.argv[1]);process.stdout.write(String((j.frames||[]).length))' "$JOB" 2>/dev/null || echo 0)
CANDS=$(node -e 'const j=require(process.argv[1]);process.stdout.write(String((j.candidates||[]).length))' "$JOB" 2>/dev/null || echo 0)
if [ "${FRAMES:-0}" -eq 0 ]; then log "no unclassified frames — done"; exit 3; fi
if [ "${CANDS:-0}" -eq 0 ]; then log "no owned candidate vehicles — abort"; exit 1; fi
log "classifying $FRAMES frames against $CANDS owned vehicles"

# 2) BUILD PROMPT — text only: the owner's vehicles + the frame narratives.
{
  echo "You are reconciling which of an owner's OWN vehicles each photo depicts, using the"
  echo "analyst's one-line description of each photo. You are NOT guessing from pixels — you"
  echo "have the descriptions. Match each photo to exactly one vehicle from the OWNER'S LIST,"
  echo "or NONE if it depicts no vehicle on the list (a building, a document, a tool, or a"
  echo "vehicle the owner does not own)."
  echo
  echo "OWNER'S VEHICLES:"
  node -e 'const j=require(process.argv[1]);for(const c of j.candidates)console.log(`  ${c.letter}) ${c.label}`)' "$JOB"
  echo
  echo "PHOTOS (image_id :: description):"
  node -e 'const j=require(process.argv[1]);for(const f of j.frames)console.log(`  ${f.image_id} :: ${f.narrative}`)' "$JOB"
  echo
  echo "Output ONLY JSON lines, one per photo, no prose:"
  echo '  {"image_id":"<uuid>","vehicle_letter":"<A..Z or NONE>","confidence":<0..1>}'
  echo "Be conservative: if the description does not clearly match one listed vehicle, use NONE."
  echo "Write the JSON lines to: $OUT"
  echo "Write nothing else. When done, stop."
} > "$PROMPT"

# 3) CLASSIFY — subscription-billed claude --print (NOT --bare; reads prompt from stdin).
env -u CLAUDE_EFFORT -u ANTHROPIC_API_KEY timeout 600 \
  claude --print --model "$MODEL" --permission-mode bypassPermissions --add-dir "$DIR" \
  < "$PROMPT" >>"$DIR/claude.log" 2>&1 || log "claude --print returned non-zero (ingesting whatever landed)"

if [ ! -s "$OUT" ]; then
  # Fallback: some runs echo the JSON to stdout instead of writing the file.
  grep -oE '\{"image_id".*\}' "$DIR/claude.log" > "$OUT" 2>/dev/null || true
fi
LINES=$(grep -c '{' "$OUT" 2>/dev/null || echo 0)
if [ "${LINES:-0}" -eq 0 ]; then log "no classifications produced — abort ingest"; exit 1; fi
log "got $LINES classifications; ingesting"

# 4) INGEST — flags + reversible proposals (never moves images).
dotenvx run -- node scripts/classify-image-subjects.mjs ingest --user-id "$USER_ID" --results "$OUT" 2>&1 | sed 's/^/  /'
