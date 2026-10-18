#!/bin/bash
# One command for the capture machine, run once in Terminal on the iMac after copying the app into ~/nuke-fb/app.
# 1) log in to Facebook in the dedicated profile  2) slow probe of the URL variants  3) start the two launchd jobs.
set -euo pipefail
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/bin:/bin"
APP="$HOME/nuke-fb/app/playwright"; GUI="gui/$(id -u)"
echo "Step 1/3: a Chrome window opens. Log in to Facebook, open Marketplace > Vehicles once, then close the window."
node "$APP/runner.mjs" --mode login
echo "Step 2/3: probing the Vehicles page (about 8 minutes, one slow page at a time). Do not touch the browser window."
node "$APP/runner.mjs" --mode probe
if [ -f "$HOME/nuke-fb/state/STOP.json" ]; then echo "STOPPED by Facebook, not starting jobs:"; cat "$HOME/nuke-fb/state/STOP.json"; exit 2; fi
echo "Step 3/3: starting the capture and revisit jobs."
mkdir -p "$HOME/Library/LaunchAgents"
for j in ag.nuke.fb-capture ag.nuke.fb-revisit; do
  cp "$APP/launchd/$j.plist" "$HOME/Library/LaunchAgents/$j.plist"
  launchctl bootout "$GUI/$j" 2>/dev/null || true
  launchctl bootstrap "$GUI" "$HOME/Library/LaunchAgents/$j.plist"
done
launchctl kickstart "$GUI/ag.nuke.fb-capture"
echo "Running. First pass lands within about 5 minutes; log: ~/nuke-fb/logs/capture.log"
