#!/bin/bash
# install-photo-sync.sh — installs the passive photo-sync daemon on this Mac.
#
#   bash scripts/install-photo-sync.sh
#
# What it does:
#   1. Verifies osxphotos + dotenvx + node are available
#   2. Writes a LaunchAgent (ag.nuke.photo-sync) that runs the daemon every
#      15 minutes via a FIXED binary path — this is what kills the popup
#      plague: macOS TCC grants permission per-binary, and the old cron setup
#      invoked photos access through varying interpreter paths, so it asked
#      every time. One stable path = ONE grant, forever.
#   3. Loads the agent and fires the first run.
#
# THE ONE POPUP: on first run, macOS asks once to allow access to Photos
# (or grant Full Disk Access to node in System Settings → Privacy & Security
# → Full Disk Access for fully silent operation). After that: zero touches.
# iPhone photos flow: phone → iCloud → Photos.app → nuke, every 15 minutes.
#
# Watch it work:  tail -f ~/.nuke/photo-sync.log
# Uninstall:      launchctl unload ~/Library/LaunchAgents/ag.nuke.photo-sync.plist

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/ag.nuke.photo-sync.plist"
NODE_BIN="$(command -v node)"
DOTENVX_BIN="$(command -v dotenvx || true)"

echo "── nuke photo-sync installer ──"

command -v osxphotos >/dev/null || { echo "❌ osxphotos missing: pipx install osxphotos (or pip3 install osxphotos)"; exit 1; }
[ -n "$NODE_BIN" ] || { echo "❌ node not found"; exit 1; }
[ -f "$REPO_DIR/.env" ] || echo "⚠ no .env at repo root — daemon needs VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY"

# Runner script: stable single entrypoint (TCC-friendly), env via dotenvx if present
RUNNER="$HOME/.nuke/run-photo-sync.sh"
mkdir -p "$HOME/.nuke"
cat > "$RUNNER" <<EOF
#!/bin/bash
cd "$REPO_DIR"
export PATH="\$PATH:/usr/local/bin:/opt/homebrew/bin"
${DOTENVX_BIN:+"$DOTENVX_BIN" run -- }"$NODE_BIN" scripts/photo-sync-daemon.mjs >> "$HOME/.nuke/photo-sync.log" 2>&1
EOF
chmod +x "$RUNNER"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>ag.nuke.photo-sync</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$RUNNER</string>
  </array>
  <key>StartInterval</key><integer>900</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$HOME/.nuke/photo-sync-launchd.log</string>
  <key>StandardErrorPath</key><string>$HOME/.nuke/photo-sync-launchd.log</string>
</dict>
</plist>
EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo "✅ installed — runs every 15 min, first run starting now"
echo "   one-time: if macOS asks for Photos access, click Allow (once)."
echo "   silent mode: System Settings → Privacy & Security → Full Disk Access → add $NODE_BIN"
echo "   watch: tail -f ~/.nuke/photo-sync.log"
