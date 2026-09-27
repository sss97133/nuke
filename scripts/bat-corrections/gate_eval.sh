#!/bin/bash
# gate_eval.sh — evaluates the prod write gate from the lead's 30-second probe log (probes.log):
#   last 10 REST probes: all 200, median < 1s, none > 3s; health entries in the window all ok;
#   "holds for 15 minutes" = the last 30 probes (≈15 min) all satisfy the same.
LOG=${BATW:-scripts/data/bat-corrections}/probes.log
win() { # $1 = number of trailing lines
  tail -n "$1" "$LOG" | awk '
    { n++; code=$2; sub("rest=","",code); t=$3; sub("s$","",t); times[n]=t+0; if (code!="200") bad++; if (t+0>3) slow++;
      if ($0 ~ /"ok":false/) hbad++; if ($0 ~ /"n":"db"/) hseen++ }
    END { asort(times); med=(n%2)?times[int(n/2)+1]:(times[n/2]+times[n/2+1])/2;
          printf "probes=%d non200=%d over3s=%d median=%.2fs max=%.2fs health_seen=%d health_bad=%d\n", n, bad, slow, med, times[n], hseen, hbad;
          exit (bad==0 && slow==0 && med<1 && hbad==0 && hseen>0) ? 0 : 1 }'
}
last=$(tail -1 "$LOG" | cut -c1-20)
if r10=$(win 10) && r30=$(win 30); then echo "GATE PASS (as of $last) | last10: $r10 | last30: $r30"; exit 0; fi
echo "GATE FAIL (as of $last) | last10: $(win 10) | last30: $(win 30)"; exit 1
