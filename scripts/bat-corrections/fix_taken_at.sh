#!/bin/bash
# fix_taken_at.sh [chunk_ids=400] [max_calls=100000]
# BaT link photos stamped with the IMPORT time as their capture time (extract-bat-core ≤ 3.x wrote
# taken_at = now(); v4 writes NULL since 360378cc2). Corrects them to NULL through the sanctioned
# chokepoint correct_image_provenance (original + citation kept in ai_scan_metadata.provenance_corrections).
# Selection: user_id IS NULL AND source = 'bat_import' AND taken_at::date = created_at::date, walked by
# created_at day (index idx_vehicle_images_user_capture_stats (user_id, source, created_at, taken_at)).
# Never a raw UPDATE. Logs every call; a REST probe before each day; stops if REST > 3 s five times.
set -u
CHUNK=${1:-400}; MAX=${2:-100000}
W=${BATW:-$HOME/nuke-logs/bat-corrections}; mkdir -p "$W"
Q=/Users/skylar/nuke/scripts/data/q.sh
LOG=$W/fix_taken_at.log
cd /Users/skylar/nuke
probe() { dotenvx run -q -- bash -c 'curl -s -o /dev/null --max-time 15 -w "%{time_total}" "$VITE_SUPABASE_URL/rest/v1/vehicles?select=id&limit=1" -H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY"'; }
SRC='{"type":"import_rule","ref":"extract-bat-core:3.x trySaveImages taken_at = import time (fixed in v4, commit 360378cc2: link rows carry taken_at NULL)","reason":"a BaT listing photo has no capture time on the page; the importer stamped the import moment, which the timeline then plotted as the photo date","method":"user_id IS NULL AND source = bat_import AND taken_at::date = created_at::date","session":"cb179857","asserted_at":"'"$(date -u +%FT%TZ)"'"}'
calls=0; fixed=0; slow=0
# days with stamped rows, oldest first (one indexed range read per day)
# every day since the first BaT import (a DISTINCT over the whole index timed out at 55 s on the box);
# a day with no stamped rows costs one indexed range read and moves on
days=$(python3 -c "import datetime as d; s=d.date(2025,12,14); e=d.date.today(); print(' '.join((s+d.timedelta(i)).isoformat() for i in range((e-s).days+1)))")
for d in $days; do
  t=$(probe); if [ "$(echo "$t > 3" | bc -l)" = "1" ]; then slow=$((slow+1)); echo "$(date -u +%FT%TZ) probe ${t}s; pausing 120s" >> "$LOG"; sleep 120; [ "$slow" -ge 5 ] && { echo "STOP: prod slow" >> "$LOG"; exit 2; }; fi
  while :; do
    ids=$($Q "set statement_timeout='55s'; select id from vehicle_images where user_id is null and source = 'bat_import' and taken_at is not null and created_at >= '$d' and created_at < ('$d'::date + 1) and taken_at::date = created_at::date and not coalesce((ai_scan_metadata->'provenance_corrections') @> '[{\"field\":\"taken_at\",\"corrected\":null}]'::jsonb, false) limit $CHUNK" | jq -r '.[].id' 2>/dev/null)
    n=$(echo "$ids" | grep -c .); [ "$n" = "0" ] && break
    arr=$(echo "$ids" | awk '{printf "%s'"'"'%s'"'"'::uuid", (NR>1?",":""), $1}')
    s0=$(date +%s%N)
    res=$($Q "set statement_timeout='55s'; select correct_image_provenance(array[$arr], 'taken_at', null, \$s\$${SRC}\$s\$::jsonb, 'bat-archive-2026-09-27')")
    calls=$((calls+1))
    if echo "$res" | grep -q '"images_corrected"'; then c=$(echo "$res" | jq -r '.[0].correct_image_provenance.images_corrected // 0'); fixed=$((fixed+c)); echo "$(date -u +%FT%TZ) day $d: $c corrected in $(( ($(date +%s%N) - s0) / 1000000 )) ms (total $fixed, calls $calls)" >> "$LOG"; else echo "$(date -u +%FT%TZ) day $d call $calls FAILED: $(echo "$res" | head -c 240)" >> "$LOG"; sleep 30; fi
    [ "$calls" -ge "$MAX" ] && break 2
    sleep 1
  done
done
echo "$(date -u +%FT%TZ) done: $fixed corrected in $calls calls" >> "$LOG"
