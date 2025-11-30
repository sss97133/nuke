#!/bin/bash

# Remove Local BAT Scraping Cron Jobs
# Run this after verifying the remote Supabase cron is working

echo "🗑️  Removing local BAT scraping cron jobs..."

# Backup current crontab
BACKUP_FILE="$HOME/crontab-backup-$(date +%Y%m%d-%H%M%S).txt"
crontab -l > "$BACKUP_FILE" 2>/dev/null
echo "✅ Backed up current crontab to: $BACKUP_FILE"

# Remove BAT-related cron jobs
NEW_CRONTAB=$(crontab -l 2>/dev/null | grep -v "bat-scrape\|monitor-bat-seller\|run-bat-scrape-automated" || true)

if [ -z "$NEW_CRONTAB" ]; then
  echo "⚠️  No crontab entries found, or all entries were BAT-related"
  echo "   Removing all cron jobs..."
  crontab -r 2>/dev/null || true
else
  echo "$NEW_CRONTAB" | crontab -
  echo "✅ Removed BAT scraping cron jobs"
fi

echo ""
echo "📋 Remaining cron jobs:"
crontab -l 2>/dev/null || echo "   (none)"

echo ""
echo "✅ Done! Your BAT scraping now runs on Supabase servers."
echo "   Verify it's working: Check Supabase Dashboard → Database → Cron Jobs"

