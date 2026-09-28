#!/bin/bash
# run_streams.sh <run-dir> [streams=4] [pace_s=2]
# Keeps drive_reader.sh running over <run-dir>/slice_<i>.txt (i = 0..streams-1) until every slice has had
# one clean pass. Built to outlive the session that starts it: launchd runs it (RunAtLoad, restart on a
# non-zero exit) under caffeinate -i, so a closed terminal or a reboot doesn't end the load (on 2026-09-28
# the streams died with their session at 08:07Z and nobody saw it for 7 hours).
#
# - The reader is <run-dir>/drive_reader.sh (a pinned copy), so the run never depends on a worktree.
# - Every stream re-run skips URLs its log already has as a success, so a restart is always safe.
# - Governor: one anon REST read every 30 s into rest_samples.log ("ts http seconds"). When the p50 of the
#   last 10 samples is over 1 s the streams are paused (SIGSTOP; a call in flight finishes) and resumed
#   when it is back under 1 s. drive_reader's own probe (every 25 calls, > 3 s, 5 strikes) stays on; a
#   stream that stops on it is restarted after 10 min.
# - A stream exiting 0 marks slice_<i>.passed. When all are passed, <run-dir>/DONE is written and the
#   supervisor exits 0; a later start sees DONE and exits at once.
# - Status: <run-dir>/supervisor.log (one line per 10 min: calls ok/failed per stream, REST p50, paused).
set -u
D=$1; N=${2:-4}; PACE=${3:-2}
cd "$D" || exit 1
[ -f DONE ] && { echo "$(date -u +%FT%TZ) DONE already present; nothing to do" >> supervisor.log; exit 0; }
READER="$D/drive_reader.sh"
[ -x "$READER" ] || { echo "$(date -u +%FT%TZ) missing $READER" >> supervisor.log; exit 1; }
log() { echo "$(date -u +%FT%TZ) $*" >> supervisor.log; }
sample() {
  (cd /Users/skylar/nuke && dotenvx run -q -- bash -c 'curl -s -o /dev/null --max-time 15 -w "%{http_code} %{time_total}" "$VITE_SUPABASE_URL/rest/v1/vehicles?select=id&limit=1" -H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY"') 2>/dev/null
}
p50() { tail -n 10 rest_samples.log 2>/dev/null | awk '{print $3}' | sort -n | awk '{a[NR]=$1} END {if (NR == 0) print 0; else print a[int((NR+1)/2)]}'; }
declare -a PID; declare -a NEXT
for ((i = 0; i < N; i++)); do PID[$i]=0; NEXT[$i]=0; done
paused=0; tick=0
trap 'log "supervisor stopping (signal)"; pkill -CONT -f "$READER" 2>/dev/null; pkill -f "$READER" 2>/dev/null; exit 1' TERM INT
log "supervisor up: $N streams, pace ${PACE}s, reader $READER"
while :; do
  now=$(date +%s)
  all_passed=1
  for ((i = 0; i < N; i++)); do
    [ -f "slice_$i.passed" ] && continue
    all_passed=0
    if [ "${PID[$i]}" -gt 0 ] && kill -0 "${PID[$i]}" 2>/dev/null; then continue; fi
    if [ "${PID[$i]}" -gt 0 ]; then
      wait "${PID[$i]}"; rc=$?; PID[$i]=0
      if [ "$rc" -eq 0 ]; then touch "slice_$i.passed"; log "stream $i finished its pass"; continue; fi
      if [ "$rc" -eq 2 ]; then NEXT[$i]=$((now + 600)); log "stream $i stopped on its REST probe; restart in 10 min"
      else NEXT[$i]=$((now + 60)); log "stream $i exited $rc; restart in 1 min"; fi
    fi
    [ "$now" -lt "${NEXT[$i]}" ] && continue
    [ "$paused" -eq 1 ] && continue
    "$READER" "$D/slice_$i.txt" "$D/reader_s$i.log" 100000 "$PACE" >> "$D/reader_s$i.out" 2>> "$D/reader_s$i.err" &
    PID[$i]=$!; log "stream $i started (pid ${PID[$i]})"
  done
  if [ "$all_passed" -eq 1 ]; then
    ok=$(cat reader_s*.log 2>/dev/null | grep -c '"success":true'); bad=$(cat reader_s*.log 2>/dev/null | grep -c '"success":false')
    log "all $N slices passed: $ok ok lines, $bad failed lines"; date -u +%FT%TZ > DONE; exit 0
  fi
  s=$(sample); echo "$(date -u +%FT%TZ) ${s:-000 15}" >> rest_samples.log
  m=$(p50)
  if [ "$paused" -eq 0 ] && [ "$(echo "$m > 1" | bc -l)" = "1" ]; then
    pkill -STOP -f "$READER" 2>/dev/null; paused=1; log "paused: REST p50 ${m}s over the last 10 samples"
  elif [ "$paused" -eq 1 ] && [ "$(echo "$m <= 1" | bc -l)" = "1" ]; then
    pkill -CONT -f "$READER" 2>/dev/null; paused=0; log "resumed: REST p50 ${m}s"
  fi
  tick=$((tick + 1))
  if [ $((tick % 20)) -eq 0 ]; then
    st=""; for ((i = 0; i < N; i++)); do
      st="$st s$i=$(grep -c '"success":true' reader_s$i.log 2>/dev/null)/$(grep -c '"success":false' reader_s$i.log 2>/dev/null)"
    done
    log "ok/failed:$st · REST p50 ${m}s · paused=$paused"
  fi
  sleep 30
done
