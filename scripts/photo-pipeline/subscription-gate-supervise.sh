#!/usr/bin/env bash
# subscription-gate-supervise.sh STATE_DIR [PYTHON]: keeps the photo landing runner alive from this checkout, checking
# every 5 min:
#   * landing_drain_loop.py (day queue -> proposals + pre-gate samples; cursor = capture_set_rescore_queue), restarted
#     whenever it exits; logs to STATE_DIR/drain.log. Extra args via DRAIN_ARGS (default "--hours 40"). Touch
#     STATE_DIR/drain.stop to stop restarting it.
#   * subscription_gate_reader.py (visual gate), resuming from STATE_DIR/gate_reader_state.json; stops for good once the
#     reader logged a halt (a failed self-agreement calibration).
# Needs SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) in the environment; refuses ANTHROPIC_API_KEY
# so the read stays on the owner's subscription.
set -u
STATE="${1:?state dir}"; PY="${2:-python3}"; HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DRAIN_ARGS="${DRAIN_ARGS:---hours 40}"
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then echo "refusing: ANTHROPIC_API_KEY set"; exit 2; fi
mkdir -p "$STATE"
reader_halted=0
while true; do
  if [ ! -e "$STATE/drain.stop" ] && ! pgrep -f "[l]anding_drain_loop.py" >/dev/null; then
    # shellcheck disable=SC2086
    nohup "$PY" "$HERE/landing_drain_loop.py" $DRAIN_ARGS >> "$STATE/drain.log" 2>&1 &
    echo "$(date) started drain pid $!"
  fi
  if [ "$reader_halted" = 0 ] && ! pgrep -f "[s]ubscription_gate_reader.py --state-dir $STATE" >/dev/null; then
    if grep -q '"ev": "halt"' "$STATE/gate_reader.jsonl" 2>/dev/null; then
      echo "$(date) reader halted; not restarting it (drain keeps running)"; reader_halted=1
    else
      nohup "$PY" "$HERE/subscription_gate_reader.py" --state-dir "$STATE" >> "$STATE/gate_reader.out" 2>&1 &
      echo "$(date) started reader pid $!"
    fi
  fi
  sleep 300
done
