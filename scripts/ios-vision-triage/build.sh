#!/usr/bin/env bash
# Build the Mac runner of the iOS app's photo rule: VisionEngine.swift compiled unchanged, for the Mac Catalyst
# target so its UIKit and Photos imports resolve, beside main.swift. Prints the binary path ($OUT, default
# $TMPDIR/ios-triage).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
sdk="$(xcrun --sdk macosx --show-sdk-path)"
out="${OUT:-${TMPDIR:-/tmp}/ios-triage}"
swiftc -O -target "$(uname -m)-apple-ios17.0-macabi" -sdk "$sdk" \
  -Fsystem "$sdk/System/iOSSupport/System/Library/Frameworks" \
  "$repo/apps/nuke-capture-ios/Sources/NukeCapture/DevicePrivacyReceipt.swift" \
  "$repo/apps/nuke-capture-ios/Sources/NukeCapture/VisionEngine.swift" "$here/main.swift" -o "$out"
echo "$out"
