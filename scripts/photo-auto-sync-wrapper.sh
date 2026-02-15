#!/bin/zsh
# Wrapper for photo-auto-sync-daemon
# Sources env vars directly instead of using dotenvx, so that Python.app
# is the top-level process for macOS TCC (Full Disk Access) checks.
cd /Users/skylar/nuke

# Source secrets directly — dotenvx as parent process breaks TCC inheritance
export VITE_SUPABASE_URL="https://qkgaybvrernstplzjaam.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczODM2OTAyMSwiZXhwIjoyMDUzOTQ1MDIxfQ.NEbqSnSamR5f7Fqon25ierv5yJgdDy_o2nrixOej_Xg"
export SUPABASE_DB_PASSWORD="RbzKq32A0uhqvJMQ"

exec /Library/Frameworks/Python.framework/Versions/3.13/bin/python3 -u scripts/photo-auto-sync-daemon.py 2>&1
