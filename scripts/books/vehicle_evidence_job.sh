#!/bin/bash
# One incremental pass of the vehicle-evidence pipeline (launchd job ag.nuke.vehicle-evidence, hourly):
#   1. mail_attachments.py   new purchase-agreement / bill-of-sale PDFs from Mail.app (cursor: last Envelope Index row)
#   2. vehicle_evidence.py   parse only new or changed PDFs (cursor: path+mtime+size), extract candidates, reconcile, and land only
#                            vehicles whose candidate set changed (cursor: digest); a heartbeat cell every 6 h feeds the DB-side
#                            watch (cron watch-vehicle-evidence -> v_job_health).
# Load budget: one run at a time (lock), nice 15, at most 20 messages fetched and 60 dossiers written per run, 1 s between writes,
# every DB statement under the 30 s / 5 s timeouts of schedule_c_rulings.psql. Credentials come only from `dotenvx run`.
# Private data (owner statements, mail attachments, cursors, receipts) lives in ~/nuke-logs/vehicle-evidence, never in the repo.
# Setup once: python3 -m venv ~/nuke-logs/vehicle-evidence/venv && ~/nuke-logs/vehicle-evidence/venv/bin/pip install pypdf
set -uo pipefail
OWNER="${VE_OWNER:-0b9f107a-d124-49de-9ded-94698f63c1c4}"
OWNER_NAME="${VE_OWNER_NAME:-Skylar}"
D="$HOME/nuke-logs/vehicle-evidence"
CACHE="$HOME/Library/Caches/nuke-vehicle-evidence-runner"
mkdir -p "$D/mail" "$CACHE" "$D/runs"
if ! mkdir "$D/lock" 2>/dev/null; then
  # a lock older than 3 hours is a dead run
  find "$D/lock" -maxdepth 0 -mmin +180 -exec rmdir {} \; 2>/dev/null
  mkdir "$D/lock" 2>/dev/null || { echo "$(date -u +%FT%TZ) another run holds the lock"; exit 0; }
fi
trap 'rmdir "$D/lock"' EXIT
cd "$HOME/nuke" || exit 1
git fetch -q origin main || exit 1
for f in vehicle_evidence.py mail_attachments.py schedule_c_rulings.py; do git show "origin/main:scripts/books/$f" > "$CACHE/$f" || exit 1; done
echo "$(date -u +%FT%TZ) origin/main $(git rev-parse --short origin/main)"
PY="$D/venv/bin/python"
START=$(date -u +%FT%TZ)
nice -n 15 "$PY" "$CACHE/mail_attachments.py" --out "$D/mail" --cursor "$D/mail/cursor.json" --limit 20 > "$D/runs/mail.json" || echo "mail step failed; continuing with what is on disk"
nice -n 15 dotenvx run -q -- "$PY" "$CACHE/vehicle_evidence.py" run --owner "$OWNER" --owner-name "$OWNER_NAME" \
  --work "$D/work" --cursor "$D/cursor.json" --pdf-root "$D/mail/pdf" --emails "$D/mail/emails.json" \
  --facts "$D/owner_facts.json" --max-land 60 --land-sleep 1 --heartbeat-hours 6 2> >(grep -v 'Ignoring wrong pointing' >&2) > "$D/runs/run-$START.json"
RC=$?
echo "$(date -u +%FT%TZ) exit $RC; receipt $D/runs/run-$START.json"
find "$D/runs" -name 'run-*.json' -mtime +14 -delete 2>/dev/null
exit $RC
