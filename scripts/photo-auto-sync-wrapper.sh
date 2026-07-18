#!/bin/zsh
# Wrapper for photo-auto-sync-daemon
# Sources env vars directly instead of using dotenvx, so that Python.app
# is the top-level process for macOS TCC (Full Disk Access) checks.
cd /Users/skylar/nuke

# Source secrets from outside the repo (never commit real keys here —
# dotenvx as parent process breaks TCC inheritance, so we can't wrap this
# in `dotenvx run --`; ~/.config/nuke/local-secrets.env is gitignored-by-location).
source ~/.config/nuke/local-secrets.env

exec /Library/Frameworks/Python.framework/Versions/3.13/bin/python3 -u scripts/photo-auto-sync-daemon.py 2>&1
