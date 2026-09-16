#!/bin/bash
# retire-dead-daemons.sh — unload + archive the dead com.nuke.* launchd jobs.
# This is what's filling System Settings → Login Items with anonymous "bash" rows.
# REVERSIBLE: plists are MOVED to ~/Library/LaunchAgents/_retired-20260609/, never deleted.
# Keeps the live organs: ag.nuke.photo-sync (new), byok-image-analysis, mail-intake,
# poll-feeds, nuke-backup.weekly.
# Evidence per daemon: ~/nuke/.claude/ISSUES.md ("Daemon graveyard" entry, 2026-06-09).
set -u
cd ~/Library/LaunchAgents || exit 1
mkdir -p _retired-20260609

DEAD=(
  com.nuke.extraction-daemon      # crash-loops every 10s since Feb; carries plaintext DB password
  com.nuke.photo-ingest-watch     # script deleted from disk; exits 2 on every Photos write
  com.nuke.data-inventory-delta   # exit 127 — script deleted Jun 1
  com.nuke.tax-progress-audit     # exit 127 — script deleted
  com.nuke.daily-audit            # exit 127 — script deleted
  com.nuke.yono-health            # exit 127 — yono offline 5+ months
  com.nuke.build-plan-status      # exit 127 — script deleted
  com.nuke.atlas-gap-research     # mission complete / script gone
  com.nuke.bank-extract           # exit 127 — script deleted
  com.nuke.cluster-sync           # exit 2 — script deleted
  com.nuke.fb-sweep-g1            # FB blocks every request; 0 yield, 5MB logs
  com.nuke.fb-sweep-g2
  com.nuke.fb-sweep-g3
  com.nuke.fb-sweep-g4
  com.nuke.fb-enrich
  com.nuke.fb-saved-sync          # superseded by fb-scraper skill + MCP import
  com.nuke.work-photos            # osxphotos fails every run; superseded by photo-sync
  com.nuke.receipt-extract        # script deleted, unrecoverable
  com.nuke.photos-db-snapshot     # unloaded, log empty since Apr 10
  com.nuke.bat-bid-backfill       # superseded by server-side bat-import-queue-worker cron
)

for j in "${DEAD[@]}"; do
  launchctl unload "$j.plist" 2>/dev/null
  [ -f "$j.plist" ] && mv "$j.plist" _retired-20260609/ && echo "retired: $j"
done

# Disabled/backup plist litter (photo-auto-sync.DISABLED holds plaintext creds)
for f in com.nuke.photo-auto-sync.plist.DISABLED com.nuke.photo-sync.plist.DISABLED \
         com.nuke.imessage-vehicle-sync.plist.DISABLED com.nuke.fb-sweep.plist.disabled \
         com.nuke.receipt-extract.plist.bak.20260426-214710; do
  [ -f "$f" ] && mv "$f" _retired-20260609/ && echo "archived: $f"
done

echo "── remaining loaded nuke jobs ──"
launchctl list | grep -iE "nuke" | sort
echo "Done. To restore any: mv it back from _retired-20260609/ and launchctl load it."
