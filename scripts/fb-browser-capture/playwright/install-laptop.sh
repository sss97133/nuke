#!/bin/bash
# Copy the laptop-side capture scripts to a stable home (they must outlive any git worktree) and write the two
# launchd plists next to them, pointing at that copy. Loads nothing. Re-run to refresh after a change.
set -euo pipefail
SRC="$(cd "$(dirname "$0")/../../.." && pwd)"; BIN="${NUKE_FB_BIN:-$HOME/nuke-logs/fb-playwright/bin}"
FILES="scripts/fb-browser-capture/bridge.mjs scripts/fb-browser-capture/extension/core.mjs scripts/fb-browser-capture/playwright/pull-spool.mjs scripts/fb-browser-capture/playwright/make-revisit-list.mjs scripts/fb-import-urls.ts scripts/data/q.sh supabase/functions/extract-facebook-marketplace/capture.ts"
mkdir -p "$BIN" "$HOME/nuke-logs/fb-playwright"
for f in $FILES; do mkdir -p "$BIN/$(dirname "$f")"; cp "$SRC/$f" "$BIN/$f"; done
echo '{"type":"module","private":true}' > "$BIN/package.json"
ln -sfn "$HOME/nuke/node_modules" "$BIN/node_modules"
for pair in "ag.nuke.fb-spool-pull:pull-spool.mjs:300:pull.log" "ag.nuke.fb-revisit-list:make-revisit-list.mjs:3600:revisit-list.log"; do
  IFS=: read -r label script every log <<< "$pair"
  cat > "$BIN/$label.plist" <<P
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$label</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>-c</string>
        <string>export PATH="/opt/homebrew/bin:/usr/bin:/bin"; cd "$BIN" &amp;&amp; exec /opt/homebrew/bin/node --import tsx scripts/fb-browser-capture/playwright/$script</string>
    </array>
    <key>StartInterval</key>
    <integer>$every</integer>
    <key>StandardOutPath</key>
    <string>$HOME/nuke-logs/fb-playwright/$log</string>
    <key>StandardErrorPath</key>
    <string>$HOME/nuke-logs/fb-playwright/$log</string>
</dict>
</plist>
P
  plutil -lint "$BIN/$label.plist"
done
echo "Installed to $BIN. To start: for j in ag.nuke.fb-spool-pull ag.nuke.fb-revisit-list; do cp $BIN/\$j.plist ~/Library/LaunchAgents/ && launchctl bootstrap gui/\$(id -u) ~/Library/LaunchAgents/\$j.plist; done"
