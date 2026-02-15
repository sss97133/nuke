#!/bin/zsh
# photos-db-snapshot.sh — Copy Photos.sqlite to a location the daemon can read
# Run via cron or launchd using Terminal.app context
# The daemon reads the snapshot instead of the live DB

PHOTOS_DB="$HOME/Pictures/Photos Library.photoslibrary/database/Photos.sqlite"
SNAPSHOT_DIR="$HOME/.nuke/photos-db-snapshot"
SNAPSHOT="$SNAPSHOT_DIR/Photos.sqlite"

mkdir -p "$SNAPSHOT_DIR"

# Copy the main DB + WAL for consistency
cp "$PHOTOS_DB" "$SNAPSHOT" 2>/dev/null
cp "${PHOTOS_DB}-wal" "${SNAPSHOT}-wal" 2>/dev/null
cp "${PHOTOS_DB}-shm" "${SNAPSHOT}-shm" 2>/dev/null

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$SNAPSHOT_DIR/last-snapshot"
