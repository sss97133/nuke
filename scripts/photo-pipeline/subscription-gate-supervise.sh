#!/usr/bin/env bash
# subscription-gate-supervise.sh STATE_DIR [PYTHON]: keeps subscription_gate_reader.py alive (restart within 5 min) from
# this checkout, resuming from STATE_DIR/gate_reader_state.json. Stops for good once the reader logged a halt (a failed
# self-agreement calibration). Needs SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) in the environment;
# refuses ANTHROPIC_API_KEY so the read stays on the owner's subscription.
set -u
STATE="${1:?state dir}"; PY="${2:-python3}"; HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then echo "refusing: ANTHROPIC_API_KEY set"; exit 2; fi
mkdir -p "$STATE"
while true; do
  if ! pgrep -f "[s]ubscription_gate_reader.py --state-dir $STATE" >/dev/null; then
    grep -q '"ev": "halt"' "$STATE/gate_reader.jsonl" 2>/dev/null && { echo "$(date) reader halted; supervisor exits"; exit 0; }
    nohup "$PY" "$HERE/subscription_gate_reader.py" --state-dir "$STATE" >> "$STATE/gate_reader.out" 2>&1 &
    echo "$(date) started reader pid $!"
  fi
  sleep 300
done
