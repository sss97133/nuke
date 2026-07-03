#!/bin/zsh
# Wrapper for photo-auto-sync-daemon
# Sources env vars directly instead of using dotenvx, so that Python.app
# is the top-level process for macOS TCC (Full Disk Access) checks.
cd /Users/skylar/nuke

# Source secrets directly — dotenvx as parent process breaks TCC inheritance
export VITE_SUPABASE_URL="https://qkgaybvrernstplzjaam.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY must be set (source it from an untracked secrets file)}"
export SUPABASE_DB_PASSWORD="${SUPABASE_DB_PASSWORD}"

exec /Library/Frameworks/Python.framework/Versions/3.13/bin/python3 -u scripts/photo-auto-sync-daemon.py 2>&1
