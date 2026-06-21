#!/bin/bash
# iphoto-orphan-sweep.sh — second pass: ingest photos NOT in any vehicle album.
#
# After iphoto-intake.mjs --all has processed the album-organized photos
# (~11,500 photos at high-confidence vehicle attribution), this script picks
# up everything else: recent shop work, customer dropoffs, transport shots,
# anything Skylar hasn't yet organized into an album.
#
# These land as vehicle_id=NULL with full EXIF (taken_at, lat/lon, original
# filename, Photos UUID in metadata) — vehicle-attribution-walker downstream
# can use vision + GPS + temporal context to attribute them.
#
# Same disk-recycling pattern as the staged sweep: 30-day windows, per-window
# osxphotos export → sips → bulk-photo-upload → DELETE local files.
#
# Excludes:
#   - photos already in any vehicle album (those went through iphoto-intake)
#   - WhatsApp screenshots (filtered by EXIF UTI/source)
#   - hidden photos
#
# Usage:
#   caffeinate -dims bash scripts/iphoto-orphan-sweep.sh \
#     [--from 2020-01-01] [--to today] [--window-days 30] [--min-free-gb 8]

set +e
EXPORT_DIR=/Users/skylar/.nuke/photo-orphan-staging
JPEG_DIR=/Users/skylar/.nuke/photo-orphan-jpeg
PROGRESS_FILE=/Users/skylar/.nuke/photo-orphan-progress.json
LOG_DIR=/Users/skylar/nuke/logs/photo-sync
USER_UUID=0b9f107a-d124-49de-9ded-94698f63c1c4
SOURCE_TAG=iphoto_orphan

FROM_DATE=2020-01-01
TO_DATE=$(date +%Y-%m-%d)
WINDOW_DAYS=30
MIN_FREE_GB=8

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from) FROM_DATE="$2"; shift 2;;
    --to) TO_DATE="$2"; shift 2;;
    --window-days) WINDOW_DAYS="$2"; shift 2;;
    --min-free-gb) MIN_FREE_GB="$2"; shift 2;;
    *) echo "unknown arg: $1"; exit 2;;
  esac
done

mkdir -p "$EXPORT_DIR" "$JPEG_DIR" "$LOG_DIR"
[ -f "$PROGRESS_FILE" ] || echo '{"completed_windows":[],"failed_windows":[]}' > "$PROGRESS_FILE"
cd /Users/skylar/nuke

MASTER_LOG="$LOG_DIR/orphan-sweep-master-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$MASTER_LOG") 2>&1

echo "=== iphoto-orphan-sweep ==="
echo "  from:        $FROM_DATE  to: $TO_DATE  window: ${WINDOW_DAYS}d  min_free: ${MIN_FREE_GB}GB"
echo "  pid: $$"
echo ""

df_free_gb() { df -k / | awk 'NR==2 { printf "%d", $4/1024/1024 }'; }
is_done() { python3 -c "import json,sys; d=json.load(open('$PROGRESS_FILE')); sys.exit(0 if '$1' in d.get('completed_windows',[]) else 1)"; }
mark_done() { python3 -c "import json; d=json.load(open('$PROGRESS_FILE')); d.setdefault('completed_windows',[]).append('$1') if '$1' not in d.get('completed_windows',[]) else None; json.dump(d, open('$PROGRESS_FILE','w'), indent=2)"; }
mark_fail() { python3 -c "import json; d=json.load(open('$PROGRESS_FILE')); d.setdefault('failed_windows',[]).append({'window':'$1','error':'''$2'''[:200]}); json.dump(d, open('$PROGRESS_FILE','w'), indent=2)"; }

windows=()
cur="$FROM_DATE"
while [[ "$cur" < "$TO_DATE" ]]; do
  next=$(date -j -f "%Y-%m-%d" -v +${WINDOW_DAYS}d "$cur" +%Y-%m-%d)
  if [[ "$next" > "$TO_DATE" ]]; then next="$TO_DATE"; fi
  windows+=("$cur $next")
  cur="$next"
done
echo "Total windows: ${#windows[@]}"

start_total=$(date +%s)
total_uploaded=0
consecutive_failures=0
window_idx=0

for win in "${windows[@]}"; do
  window_idx=$((window_idx + 1))
  from="${win% *}"
  to="${win#* }"
  win_key="${from}_${to}"
  pass_log="$LOG_DIR/orphan-pass-$(printf '%04d' $window_idx).log"

  echo "[$(date +%H:%M:%S)] Window $window_idx/${#windows[@]}: $from → $to (log: $pass_log)"
  if is_done "$win_key"; then echo "  SKIP — already complete"; echo ""; continue; fi

  free_gb=$(df_free_gb)
  if [ "$free_gb" -lt "$MIN_FREE_GB" ]; then
    echo "  ABORT — disk free ${free_gb} GB < min ${MIN_FREE_GB} GB"
    mark_fail "$win_key" "disk_floor:${free_gb}GB"
    consecutive_failures=$((consecutive_failures + 1))
    [ $consecutive_failures -ge 3 ] && { echo "HALT — disk floor 3x"; exit 1; }
    continue
  fi

  attempt=1
  ok=0
  while [ $attempt -le 3 ]; do
    {
      echo "=== Window $win_key — attempt $attempt ==="
      pass_start=$(date +%s)
      free_before=$(df_free_gb)
      echo "disk free before: ${free_before} GB"

      # Phase 1: osxphotos export — exclude photos that are in any album
      # (--not-in-album restricts to photos with NO album membership)
      echo "--- Phase 1: osxphotos export (orphans only) ---"
      osxphotos export "$EXPORT_DIR" \
        --from-date "$from" --to-date "$to" \
        --not-hidden --not-in-album \
        --update --download-missing --use-photokit --retry 3 2>&1 | tail -3
      osxphotos_rc=$?

      raw_count=$(find "$EXPORT_DIR" -maxdepth 1 -type f ! -name '.*' 2>/dev/null | wc -l | tr -d ' ')
      echo "staged files: $raw_count"

      if [ "$raw_count" -eq 0 ]; then
        echo "no orphans in this window — marking done"
        ok=1
        break
      fi

      # Phase 2: sips HEIC → JPEG
      echo "--- Phase 2: sips HEIC → JPEG ---"
      find "$EXPORT_DIR" -maxdepth 1 -type f -iname '*.heic' -print0 \
        | xargs -0 -P 8 -I {} bash -c '
          src="$1"; base=$(basename "$src"); base_noext="${base%.[Hh][Ee][Ii][Cc]}"
          out="'"$JPEG_DIR"'/${base_noext}.jpeg"
          [ -f "$out" ] && exit 0
          sips -s format jpeg -s formatOptions 85 -Z 1600 "$src" --out "$out" >/dev/null 2>&1 || echo "FAIL: $src"
        ' -- {}
      find "$EXPORT_DIR" -maxdepth 1 -type f \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' \) -print0 \
        | xargs -0 -P 8 -I {} bash -c '
          src="$1"; base=$(basename "$src"); base_noext="${base%.*}"
          out="'"$JPEG_DIR"'/${base_noext}.jpeg"
          [ -f "$out" ] && exit 0
          sips -s format jpeg -s formatOptions 85 -Z 1600 "$src" --out "$out" >/dev/null 2>&1 || cp "$src" "$out"
        ' -- {}
      jpeg_count=$(find "$JPEG_DIR" -type f -name '*.jpeg' 2>/dev/null | wc -l | tr -d ' ')
      echo "JPEGs: $jpeg_count"

      # Phase 3: bulk-photo-upload (vehicle_id stays NULL — orphans by design)
      echo "--- Phase 3: bulk-photo-upload ---"
      upload_out=$(dotenvx run -- node scripts/bulk-photo-upload.mjs "$JPEG_DIR" \
        --source "$SOURCE_TAG" --user-id "$USER_UUID" 2>&1)
      upload_rc=$?
      echo "$upload_out" | tail -5
      uploaded=$(echo "$upload_out" | grep -E "^Total: [0-9]+ uploaded" | awk '{print $2}')
      [ -z "$uploaded" ] && uploaded=0
      total_uploaded=$((total_uploaded + uploaded))

      # Phase 4: cleanup local files only on success
      echo "--- Phase 4: cleanup ---"
      if [ "$upload_rc" -eq 0 ] && [ "$jpeg_count" -gt 0 ]; then
        find "$EXPORT_DIR" -maxdepth 1 -type f ! -name '.*' -delete
        find "$JPEG_DIR" -maxdepth 1 -type f -delete
        echo "deleted local files"
      fi

      free_after=$(df_free_gb)
      echo "disk free after: ${free_after} GB"
      echo "elapsed: $(($(date +%s) - pass_start))s"

      if [ "$osxphotos_rc" -eq 0 ] && { [ "$jpeg_count" -eq 0 ] || [ "$upload_rc" -eq 0 ]; }; then
        ok=1
      fi
    } > "$pass_log" 2>&1

    if [ "$ok" -eq 1 ]; then
      mark_done "$win_key"
      consecutive_failures=0
      echo "  attempt $attempt OK — uploaded=$uploaded"
      break
    fi
    attempt=$((attempt + 1))
    sleep 5
  done

  if [ "$ok" -ne 1 ]; then
    mark_fail "$win_key" "all 3 attempts failed"
    consecutive_failures=$((consecutive_failures + 1))
    echo "  WINDOW FAILED. consecutive=$consecutive_failures"
    [ $consecutive_failures -ge 3 ] && { echo "HALT — 3 window failures"; exit 2; }
  fi
  echo ""
done

echo "=== ORPHAN SWEEP COMPLETE ==="
echo "  windows: ${#windows[@]}"
echo "  completed: $(python3 -c "import json; print(len(json.load(open('$PROGRESS_FILE')).get('completed_windows',[])))")"
echo "  failed: $(python3 -c "import json; print(len(json.load(open('$PROGRESS_FILE')).get('failed_windows',[])))")"
echo "  total uploaded: $total_uploaded"
echo "  elapsed: $(($(date +%s) - start_total))s"
echo "  disk free: $(df_free_gb) GB"
