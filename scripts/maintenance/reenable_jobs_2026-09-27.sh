#!/bin/bash
# WROTE PROD. Recovered 2026-10-15 from the untracked, gitignored ~/nuke/scripts/data/; committed unchanged (this header excepted).
# What it did: re-enabled the cron jobs 499 478 479 500 487 one at a time with cron.alter_job, 10 minutes of watch each.
# When: 2026-09-27 15:13Z-16:05Z (plan step P1.3). All five stayed on. The log shows jobs 501, 504, 503, 502 and 188 enabled later
# the same day (not by this script). The run log (job-reenable.log) holds job names and timings only; it stays on the machine.
# Do not re-run as is: the job ids are those of 2026-09-27.
# Plan step P1.3 (approved 2026-09-27): bring the useful jobs back one at a time, 10-minute watch each.
# A job stays on only if its failure rate stays <= 20% and REST p50 stays <= 1.5 s; otherwise it is paused
# again and the sequence stops. Log: scripts/data/job-reenable.log
Q=/Users/skylar/nuke/scripts/data/q.sh
LOG=/Users/skylar/nuke/scripts/data/job-reenable.log
cd /Users/skylar/nuke
say(){ echo "[$(date -u +%H:%M:%SZ)] $*" | tee -a "$LOG"; }
p50(){ dotenvx run -q -- bash -c 'K="${VITE_SUPABASE_ANON_KEY:-$SUPABASE_ANON_KEY}"; for i in 1 2 3 4 5; do curl -sS -o /dev/null -w "%{time_total}\n" --max-time 15 "$VITE_SUPABASE_URL/rest/v1/vehicles?select=id&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K"; sleep 1; done' | sort -n | sed -n 3p; }
for J in 499 478 479 500 487; do
  NAME=$($Q "select jobname from cron.job where jobid=$J" | jq -r '.[0].jobname')
  $Q "select cron.alter_job(job_id := $J, active := true)" >/dev/null
  say "enabled $J $NAME (REST p50 before: $(p50)s)"
  if [ "$J" = 499 ]; then
    for i in $(seq 1 20); do N=$($Q "SET statement_timeout='120s'; select public.derive_vehicle_image_attribution_sweep(2000) n" | jq -r '.[0].n // .message'); say "  sweep pass $i enqueued: $N"; [ "$N" = "0" ] && break; sleep 5; done
  fi
  sleep 600
  R=$($Q "SET statement_timeout='60s'; select count(*) n, count(*) filter (where status='failed') f from cron.job_run_details where jobid=$J and runid > (select max(runid) from cron.job_run_details) - 600 and start_time > now() - interval '11 minutes'")
  N=$(echo "$R" | jq -r '.[0].n'); F=$(echo "$R" | jq -r '.[0].f'); P=$(p50)
  say "  after 10 min: runs=$N failed=$F REST p50=${P}s"
  BAD=$(awk -v n="$N" -v f="$F" -v p="$P" 'BEGIN{ if ((n>0 && f/n>0.2) || p>1.5) print 1; else print 0 }')
  if [ "$BAD" = 1 ]; then $Q "select cron.alter_job(job_id := $J, active := false)" >/dev/null; say "  PAUSED $J again (over threshold); stopping sequence"; exit 1; fi
  say "  kept $J on"
done
say "sequence complete: 499 478 479 500 487 on"
