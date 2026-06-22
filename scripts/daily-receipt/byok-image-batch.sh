#!/usr/bin/env bash
# byok-image-batch.sh — one bounded batch of BYOK deep image analysis.
#
# Architecture note (READ THIS before "fixing" the network):
#   The "API error" that stalled image processing for weeks was NOT the DB and
#   NOT a vision API. It was Claude Code's default Bash *sandbox* silently dropping
#   the connection to Supabase (HTTP 000 / 15s hang). The remote DB answers in
#   ~0.07s when reached from a normal (un-sandboxed) shell.
#   => Therefore the network steps (prepare / download / ingest) run HERE, in a
#      plain launchd/login shell (full network). The vision step is the ONLY part
#      that uses `claude --print`, and it touches NO network — it just Reads the
#      already-downloaded local JPEGs and Writes a verdicts JSONL. Sandbox can't
#      bite a step that makes no network calls.
#
# Pipeline:  prepare worklist -> download images -> claude analyzes -> ingest
# Idempotent: prepare only pulls images still ai_processing_status='pending'.
#
# Usage:  byok-image-batch.sh <vehicle-id> [batch_size]
set -u
cd "$(dirname "$0")/../.." || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin:$PATH"

VEHICLE_ID="${1:?usage: byok-image-batch.sh <vehicle-id> [batch_size] [shard_count] [shard_index]}"
BATCH="${2:-8}"
SHARD_COUNT="${3:-1}"
SHARD_INDEX="${4:-0}"
RUN="byok-$(echo "$VEHICLE_ID" | cut -c1-8)-s${SHARD_INDEX}-$$"
DIR="/tmp/dia/$RUN"
WORK="$DIR/work.jsonl"
SINK="$DIR/verdicts.jsonl"
IMG="$DIR/img"
LOG_DIR="${NUKE_LOG_DIR:-/Users/skylar/nuke/logs}"
LOG="$LOG_DIR/byok-image-batch.log"
LOCK="/tmp/byok-image-batch-${SHARD_COUNT}-${SHARD_INDEX}.lock"
mkdir -p "$DIR" "$IMG" "$LOG_DIR"

log(){ echo "$(date '+%F %T') | $*" | tee -a "$LOG"; }

# One batch at a time across all invocations (cron + manual)
if [ -f "$LOCK" ]; then
  pid=$(cat "$LOCK" 2>/dev/null)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then log "already running (PID $pid) — skip"; exit 0; fi
fi
echo $$ > "$LOCK"; trap 'rm -f "$LOCK"; rm -rf "$DIR"' EXIT

log "=== batch start vehicle=$VEHICLE_ID size=$BATCH run=$RUN ==="

# 1) PREPARE (network) — pull the next DAY's pending frames for this vehicle.
# --by-day: the day is the unit of analysis; workers shard by day, never split one.
dotenvx run -- node scripts/deep-image-analysis-byok.mjs prepare \
  --vehicle-id "$VEHICLE_ID" --limit "$BATCH" --worklist "$WORK" --by-day \
  --shard-count "$SHARD_COUNT" --shard-index "$SHARD_INDEX" >>"$LOG" 2>&1
PREP_RC=$?
N=$( [ -f "$WORK" ] && wc -l < "$WORK" | tr -d ' ' || echo 0 )
# CRITICAL: a NETWORK failure in prepare (exit!=0) is NOT a drain. Before this guard,
# prepare's exit(1) produced an empty worklist (N=0) and the script treated it
# identically to a legit empty queue — exit 3 (drained) — so the burn-all loop marked
# the vehicle COMPLETE and skipped it. One network blip silently skipped the whole
# fleet (2026-06-02 incident). Distinguish the two: prepare rc!=0 => transient, back
# off and exit 1 so the caller RETRIES; only rc==0 with N==0 is a true drain (exit 3).
if [ "$PREP_RC" -ne 0 ]; then
  log "prepare FAILED (rc=$PREP_RC) vehicle=$VEHICLE_ID shard ${SHARD_INDEX}/${SHARD_COUNT} — transient (network?); backing off, NOT draining"
  sleep $(( (SHARD_INDEX + 1) * 5 ))   # staggered backoff relieves the port-exhaustion that causes these
  exit 1
fi
if [ "$N" -eq 0 ]; then log "no pending days for shard ${SHARD_INDEX}/${SHARD_COUNT} — drained."; exit 3; fi
DAY=$( [ -f "$WORK.date" ] && tr -d ' \n' < "$WORK.date" || echo "" )
log "prepared $N frames from work day ${DAY:-unknown}"

# 2) DOWNLOAD (network) — fetch each image local so the vision step needs no net
dotenvx run -- python3 - "$WORK" "$IMG" >>"$LOG" 2>&1 <<'PY'
import json,sys,os
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
work,imgdir=sys.argv[1],sys.argv[2]
# ONE pooled keep-alive session for the whole batch. The old urlretrieve opened a
# FRESH socket per image with no reuse — at 8 workers that exhausted the machine's
# ephemeral ports and seized the entire TCP stack (32k stuck TIME_WAIT, 2026-06-02).
# A pooled session reuses ~4 connections and backs off on failure instead of
# storming the port table. This is the regulator the drivetrain was missing.
sess=requests.Session()
retry=Retry(total=4, backoff_factor=0.5, status_forcelist=[429,500,502,503,504], allowed_methods=["GET"])
adapter=HTTPAdapter(pool_connections=4, pool_maxsize=4, max_retries=retry)
sess.mount("https://", adapter); sess.mount("http://", adapter)
ok=0
for l in open(work):
    r=json.loads(l); out=os.path.join(imgdir, r["file_name"])
    if os.path.exists(out): ok+=1; continue
    try:
        with sess.get(r["image_url"], timeout=30, stream=True) as resp:
            resp.raise_for_status()
            with open(out,"wb") as f:
                for chunk in resp.iter_content(65536): f.write(chunk)
        ok+=1
    except Exception as e:
        print("DL-ERR",r["file_name"],e)
sess.close()
print("downloaded", ok, "files (pooled keep-alive session)")
PY

# 2.5) CONTEXT (network) — the fact base the detective must KNOW before analyzing:
# vehicle identity, the build so far, and where THIS day sits in the timeline arc.
CTX="$DIR/context.md"
dotenvx run -- node scripts/deep-image-analysis-byok.mjs context \
  --vehicle-id "$VEHICLE_ID" --date "$DAY" --out "$CTX" >>"$LOG" 2>&1 || log "context assembly failed (proceeding thin)"

# 3) ANALYZE (NO network) — headless Claude reads each local image, writes verdicts
PROMPT_FILE="$DIR/prompt.txt"
{
  # PERSONA — the agent operates as the owner's knowledgeable build detective, not a captioner.
  echo "# YOU ARE THE OWNER'S EXPERT BUILD ANALYST — a knowledgeable detective working on their behalf."
  echo "You are NOT labeling isolated photos. You KNOW this specific vehicle and its whole build:"
  echo "its history, its parts, its quirks, where it is in the restoration. Internalize the fact base"
  echo "below, hold the entire build in your head, then read each frame as evidence you already"
  echo "understand — recognizing known parts, placing the moment in the timeline, and reasoning about"
  echo "what the owner was doing and why. Be the expert who would say 'that's the Dana 44 going back"
  echo "together with the new DuraStop brakes' — not 'a metal disc on a floor.'"
  echo
  if [ -f "$CTX" ]; then cat "$CTX"; echo; fi
  cat scripts/daily-receipt/byok-vision-prompt.md
  echo
  echo "## THIS IS ONE WORK DAY: ${DAY:-unknown}"
  echo "All $N frames below were shot on the SAME day — treat them as a single work"
  echo "session, not isolated photos. Before writing verdicts, look across the whole"
  echo "set: identify the day's build phase, follow one component across angles and"
  echo "before/after (e.g. rusty rotor -> new rotor at the same wheel station), and let"
  echo "each frame's narrative reference the day's activity. Granular per-image verdicts,"
  echo "but informed by the whole day. (The day rolls up into a work_session afterward.)"
  echo
  echo "WORKLIST — each frame's hard EXIF evidence (you CANNOT see this in the pixels; use it)."
  echo "Resolve gps against the Location legend above. Set camera_pose.exif_present=true when shot_at/gps"
  echo "is given; set presence.place_hint to the resolved location; use scene_type=off_property when the"
  echo "gps is away from the main shop. Read EACH local file and emit one verdict line per image:"
  python3 - "$WORK" "$IMG" <<'PY'
import json,sys,os
work,imgdir=sys.argv[1],sys.argv[2]
for l in open(work):
    r=json.loads(l); e=r.get("exif",{}) or {}
    g=e.get("gps"); gps=f'{g["lat"]},{g["lon"]}' if g else "none"
    path=os.path.join(imgdir, r["file_name"])
    print(f'- image_id={r["image_id"]} file={path}')
    print(f'    shot_at={e.get("shot_at") or r.get("taken_at")} | gps={gps} | location={e.get("location_name") or "?"} | camera={e.get("camera") or "?"}')
PY
  echo
  echo "Write ALL verdict lines (one compact JSON per line) to: $SINK"
  echo "Do not write anything else. When done, stop."
} > "$PROMPT_FILE"

log "invoking claude for vision on $N images"
# Prompt MUST go via stdin (the positional-arg form is unreliable with --add-dir).
# Sonnet is fast + accurate enough for the bulk drain; never force CLAUDE_EFFORT=high
# here (it makes a per-batch agent run for 10+ min). 90s/image ceiling as a backstop.
# MODEL is hoisted so provenance (stamped in sanitize below) can never drift from
# the model that actually ran — numbers carry source DNA.
MODEL="${BYOK_MODEL:-claude-opus-4-8}"
RESULT_JSON="$DIR/claude_result.json"
T_VISION_START=$(date +%s)
env -u CLAUDE_EFFORT timeout $(( N * 150 + 60 )) \
  claude --print --output-format json --model "$MODEL" --permission-mode bypassPermissions --add-dir "$DIR" \
  < "$PROMPT_FILE" >"$RESULT_JSON" 2>>"$LOG" || log "claude --print returned non-zero/timeout (ingesting whatever landed)"
BATCH_MS=$(( ( $(date +%s) - T_VISION_START ) * 1000 ))

# Capture REAL token usage + cost for the batch. --output-format json makes the CLI emit
# total_cost_usd + usage even on the subscription (it computes the API-equivalent cost
# from actual tokens), so every run finally records what an image costs — the per-image
# unit-economics signal the pipeline never had (provenance was hard-coded $0 before).
read COST_USD IN_TOK OUT_TOK CACHE_TOK < <(node -e '
  try{const j=require(process.argv[1]); const u=j.usage||{};
    process.stdout.write([j.total_cost_usd||0, u.input_tokens||0, u.output_tokens||0, (u.cache_creation_input_tokens||0)+(u.cache_read_input_tokens||0)].join(" "));
  }catch(e){process.stdout.write("0 0 0 0");}' "$RESULT_JSON" 2>/dev/null || echo "0 0 0 0")
log "vision cost: \$$COST_USD for $N imgs | tokens in=$IN_TOK out=$OUT_TOK cache=$CACHE_TOK | model=$MODEL"

V=$( [ -f "$SINK" ] && wc -l < "$SINK" | tr -d ' ' || echo 0 )
log "claude wrote $V verdict lines"
if [ "$V" -eq 0 ]; then log "no verdicts produced — abort ingest"; exit 1; fi

# SANITIZE — repair the two things the model gets wrong without discarding good work:
#  (1) IDs are the harness's job, not the model's. Force vehicle_id, and force each
#      verdict's image_id to a real worklist UUID (the agent sometimes echoes the VIN
#      or mislabels). Match by position when the echoed image_id isn't a worklist id.
#  (2) Drop localized elements missing a valid bbox (the validator rejects the whole
#      verdict otherwise) — keep the rest so the image still lands.
python3 - "$SINK" "$WORK" "$VEHICLE_ID" "$MODEL" "$BATCH_MS" "$RUN" "$N" "$COST_USD" "$IN_TOK" "$OUT_TOK" "$CACHE_TOK" >>"$LOG" 2>&1 <<'PY'
import json,sys
sink,work,vehicle_id=sys.argv[1],sys.argv[2],sys.argv[3]
model,batch_ms,run_id,n_imgs=sys.argv[4],int(sys.argv[5]),sys.argv[6],max(1,int(sys.argv[7]))
cost_usd=float(sys.argv[8]) if len(sys.argv)>8 else 0.0
in_tok =int(sys.argv[9])  if len(sys.argv)>9  else 0
out_tok=int(sys.argv[10]) if len(sys.argv)>10 else 0
cache_tok=int(sys.argv[11]) if len(sys.argv)>11 else 0
wl=[json.loads(l) for l in open(work) if l.strip()]
ids=[w["image_id"] for w in wl]; idset=set(ids)
by_id={w["image_id"]:w for w in wl}
def okbox(b): return isinstance(b,list) and len(b)==4 and all(isinstance(n,(int,float)) and 0<=n<=999 for n in b)
SCENES={"engine_bay","body_exterior","body_interior","undercarriage","receipt_document","data_plate","hand_drawn_diagram","shop_context","fabrication_in_progress","paint_booth","wheel_assembly","road_test","off_property","cross_reference","product_screenshot","spreadsheet","unknown"}
PHASES={"discovery","teardown","metalwork","paint_prep","paint_application","mechanical_assembly","wiring","interior","final_assembly","drivable","show_finish","unknown"}
INTENTS={"labor","inspection","parts_sourcing","communication","acquisition","documentation","unknown"}
import re
out=[]; dropped=0; fixed_ids=0; coerced=0
raw=[l for l in open(sink) if l.strip()]
for i,l in enumerate(raw):
    try: v=json.loads(l)
    except: continue
    # IDs + timestamps are the harness's job — the model only produces analysis.
    v["vehicle_id"]=vehicle_id
    if v.get("image_id") not in idset:
        v["image_id"]=ids[i] if i < len(ids) else ids[0]; fixed_ids+=1
    w=by_id.get(v["image_id"], wl[i] if i < len(wl) else {})
    v["taken_at"]=w.get("taken_at"); v["created_at"]=w.get("created_at")  # proper ISO, never EXIF colon-format
    # coerce invented enum values to 'unknown' rather than fail the whole verdict
    if v.get("scene_type") not in SCENES: v["scene_type"]="unknown"; coerced+=1
    if v.get("build_phase_guess") not in PHASES: v["build_phase_guess"]="unknown"; coerced+=1
    if v.get("intent") not in INTENTS: v["intent"]="unknown"; v["needs_clarification"]=True; coerced+=1
    if isinstance(v.get("intent_confidence"),(int,float)) and v["intent_confidence"]<0.6: v["needs_clarification"]=True
    # scrub the banned "3/4"/"three-quarter" phrasing from camera_pose
    cp=v.get("camera_pose")
    if isinstance(cp,dict):
        for k,val in list(cp.items()):
            if isinstance(val,str) and re.search(r"3\s*/\s*4|three[- ]?quarter",val,re.I):
                cp[k]=re.sub(r"3\s*/\s*4|three[- ]?quarter","angled",val,flags=re.I); coerced+=1
    for arr in ("components_seen","text_regions","damage_localized"):
        if isinstance(v.get(arr),list):
            keep=[x for x in v[arr] if isinstance(x,dict) and okbox(x.get("bbox"))]
            dropped+=len(v[arr])-len(keep); v[arr]=keep
    # PROVENANCE — stamped by the harness, never the model. Source DNA for
    # every verdict: which model, how invoked, which run, how long, what cost.
    v["provenance"]={
        "agent_model":model,
        "agent_tier":"caller-byok",
        "extraction_method":"byok_claude_print_read_tool",
        "harness":"byok-image-batch.sh",
        "run_id":run_id,
        "batch_duration_ms":batch_ms,
        "agent_duration_ms":batch_ms//n_imgs,
        "images_in_batch":n_imgs,
        # REAL per-image economics, amortized from the batch's measured usage/cost.
        # cost is the API-equivalent the CLI reports (true even on subscription).
        "agent_cost_cents":round(cost_usd*100/n_imgs,4),
        "batch_cost_usd":cost_usd,
        "input_tokens_per_image":in_tok//n_imgs,
        "output_tokens_per_image":out_tok//n_imgs,
        "cache_tokens_per_image":cache_tok//n_imgs,
        "cost_basis":"metered_from_usage" if cost_usd>0 else "byok_subscription_flat",
    }
    out.append(json.dumps(v))
open(sink,"w").write("\n".join(out)+"\n")
print(f"sanitize: kept {len(out)} verdicts, forced vehicle_id+taken_at, fixed {fixed_ids} ids, coerced {coerced} enums/phrases, dropped {dropped} un-boxed elements")
PY

# 4) INGEST (network) — schema-validate + write cascade to remote DB
dotenvx run -- node scripts/deep-image-analysis-byok.mjs ingest --sink "$SINK" >>"$LOG" 2>&1
WROTE=$(tail -5 "$LOG" | grep -oE "ingest: wrote [0-9]+" | grep -oE "[0-9]+" | tail -1 || echo "?")
log "ingest wrote $WROTE / $N for day ${DAY:-unknown}"

# 5) ROLL UP THE DAY (network) — refresh the work_session / daily receipt for this
# date. Idempotent: safe to run after every chunk of a big multi-pass day.
if [ -n "$DAY" ]; then
  dotenvx run -- node scripts/daily-receipt/build-day.mjs \
    --vehicle-id "$VEHICLE_ID" --date "$DAY" >>"$LOG" 2>&1 \
    && log "rolled up work_session for $DAY" \
    || log "build-day rollup for $DAY returned non-zero (non-fatal)"
fi
log "=== batch done: day ${DAY:-unknown}, ingest $WROTE / $N ==="
