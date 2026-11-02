#!/usr/bin/env bash
# ship-testflight.sh — archive apps/nuke-capture-ios on this Mac and upload it to TestFlight.
#
# The CLI ship (the owner's preferred path). It needs ONE of:
#   a) Xcode signed into the team's Apple ID (Xcode → Settings → Accounts), or
#   b) the App Store Connect API key for the Nuke team, read from ~/.appstoreconnect/asc-nuke.env:
#        NUKE_ASC_ISSUER_ID, NUKE_ASC_KEY_ID (77637BYL66), NUKE_ASC_KEY_PATH, NUKE_APPLE_TEAM_ID (JZ28MFU3VB; K474YLCACB was the June team, the app moved)
#      Falls back to ~/.appstoreconnect/asc.env (ASC_ISSUER_ID, ASC_KEY_ID, ASC_KEY_PATH),
#      shared with scripts/asc_*.rb. The Nuke-specific file and variables take precedence.
# Nothing secret is printed. The build number is an epoch timestamp so uploads never collide;
# note Xcode Cloud stamps its own small run counter, so after a CLI upload under one marketing
# version, bump MARKETING_VERSION before the next Xcode Cloud ship of that version.
# Runs on the stock macOS bash 3.2 (no empty-array expansion under set -u).
# When neither credential is available, push the commit to fable5/ignition-ios instead and let
# Xcode Cloud ship it (apps/nuke-capture-ios/README.md, "Shipping to TestFlight").
#
# Usage: scripts/ios/ship-testflight.sh [--keep]     (--keep leaves the build dir for inspection)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP="$ROOT/apps/nuke-capture-ios"
WORK="${NUKE_IOS_BUILD_DIR:-/tmp/nuke-ios-ship}"
KEEP=0; [[ "${1:-}" == "--keep" ]] && KEEP=1

ENV_FILE="$HOME/.appstoreconnect/asc-nuke.env"
AUTH=()
[[ -f "$ENV_FILE" ]] || ENV_FILE="$HOME/.appstoreconnect/asc.env"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  ASC_SHIP_ISSUER="${NUKE_ASC_ISSUER_ID:-${ASC_ISSUER_ID:-}}"
  ASC_SHIP_KEY_ID="${NUKE_ASC_KEY_ID:-${ASC_KEY_ID:-}}"
  ASC_SHIP_KEY_PATH="${NUKE_ASC_KEY_PATH:-${ASC_KEY_PATH:-}}"
  if [[ -n "$ASC_SHIP_ISSUER" && -n "$ASC_SHIP_KEY_ID" && -f "$ASC_SHIP_KEY_PATH" ]]; then
    AUTH=(-authenticationKeyPath "$ASC_SHIP_KEY_PATH" -authenticationKeyID "$ASC_SHIP_KEY_ID" -authenticationKeyIssuerID "$ASC_SHIP_ISSUER")
    echo "▸ signing and upload through the App Store Connect key (issuer and key id loaded, not printed)"
  fi
fi
TEAM="${NUKE_APPLE_TEAM_ID:-JZ28MFU3VB}"
[[ ${#AUTH[@]} -eq 0 ]] && echo "▸ no App Store Connect key on disk; relying on the Apple ID signed into Xcode"

cd "$APP"
BUILD_NUM="$(date +%s)"
# CURRENT_PROJECT_VERSION must change BEFORE xcodegen: the generated Info.plist substitutes it at build time.
# Keep a copy of project.yml and restore THAT copy, so an uncommitted edit (a MARKETING_VERSION bump)
# is never discarded by a git checkout.
PROJECT_BACKUP="$(mktemp -t project.yml)"
cp project.yml "$PROJECT_BACKUP"
trap 'cp "$PROJECT_BACKUP" "$APP/project.yml" 2>/dev/null || true; rm -f "$PROJECT_BACKUP"; [[ $KEEP -eq 1 ]] || rm -rf "$WORK"' EXIT
sed -i '' "s/CURRENT_PROJECT_VERSION: .*/CURRENT_PROJECT_VERSION: $BUILD_NUM/" project.yml
xcodegen generate >/dev/null
mkdir -p NukeCapture-iOS.xcodeproj/project.xcworkspace/xcshareddata/swiftpm
cp Package.resolved NukeCapture-iOS.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved
VERSION="$(grep -E '^\s*MARKETING_VERSION:' project.yml | head -1 | sed -E 's/.*"([^"]+)".*/\1/')"
echo "▸ archiving $VERSION ($BUILD_NUM) from $(git rev-parse --short HEAD)"

rm -rf "$WORK"; mkdir -p "$WORK"
xcodebuild archive \
  -project NukeCapture-iOS.xcodeproj -scheme NukeCapture-iOS -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath "$WORK/NukeCapture.xcarchive" -derivedDataPath "$WORK/dd" \
  -allowProvisioningUpdates ${AUTH[@]+"${AUTH[@]}"} \
  DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Automatic \
  > "$WORK/archive.log" 2>&1 || { grep -E "error:|Unable to log in|No Account|No profiles" "$WORK/archive.log" | head -5 || true; echo "✗ archive failed (log: $WORK/archive.log; pass --keep)"; KEEP=1; exit 65; }
echo "▸ archived"

cat > "$WORK/ExportOptions.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>$TEAM</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
</dict></plist>
EOF
xcodebuild -exportArchive \
  -archivePath "$WORK/NukeCapture.xcarchive" -exportPath "$WORK/export" \
  -exportOptionsPlist "$WORK/ExportOptions.plist" \
  -allowProvisioningUpdates ${AUTH[@]+"${AUTH[@]}"} \
  > "$WORK/export.log" 2>&1 || { grep -E "error:|Unable|rejected|must be higher" "$WORK/export.log" | head -5 || true; echo "✗ upload failed (log: $WORK/export.log; pass --keep)"; KEEP=1; exit 66; }
echo "✓ uploaded $VERSION ($BUILD_NUM) to App Store Connect; TestFlight processes it in a few minutes"
