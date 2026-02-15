#!/bin/zsh
# photos-db-query.sh — Query Apple Photos SQLite database
# Handles TCC by trying direct access first, then using osascript's
# "do shell script" which inherits the user's TCC grants silently.
#
# Usage: photos-db-query.sh <sql> <output-json-path>

set -euo pipefail

DB="$HOME/Pictures/Photos Library.photoslibrary/database/Photos.sqlite"
SQL="$1"
OUTPUT="$2"

# Method 1: Direct access (works from Terminal, fails from launchd)
if /usr/bin/sqlite3 -json "$DB" "$SQL" > "$OUTPUT" 2>/dev/null; then
    exit 0
fi

# Method 2: osascript "do shell script" — runs silently (no Terminal window)
# and inherits the user's TCC context
/usr/bin/osascript -e "do shell script \"/usr/bin/sqlite3 -json '${DB}' '${SQL}'\"" > "$OUTPUT" 2>/dev/null
exit $?
