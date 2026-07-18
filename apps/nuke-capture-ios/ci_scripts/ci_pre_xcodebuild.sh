#!/bin/sh

# Xcode Cloud pre-xcodebuild step — set a monotonically increasing build number.
#
# TestFlight rejects any upload whose CFBundleVersion isn't strictly greater than
# the highest previously uploaded build. Builds 29 AND 30 both collided ("The
# bundle version must be higher than the previously uploaded version"), so the
# number already on TestFlight is >= 30 and we can't know it from here (querying
# App Store Connect needs the API issuer ID we don't have on the runner). Xcode
# Cloud's own CI_BUILD_NUMBER is a small per-workflow counter, also below what's
# on TestFlight. A Unix timestamp solves it permanently: it is always greater
# than any prior integer build number AND any earlier timestamp, and it fits in
# CFBundleVersion's uint32 ceiling (max 4294967295; epoch is ~1.78e9 today).
#
# Runs AFTER ci_post_clone's `xcodegen generate`, so Generated/Info.plist exists
# with CFBundleVersion=$(CURRENT_PROJECT_VERSION); we overwrite that with a
# literal. The target uses an explicit INFOPLIST_FILE (not GENERATE_INFOPLIST_FILE),
# so this literal is what lands in the archived bundle — verified locally: the
# built NukeCapture.app carried the timestamp, not the project.yml value.

set -e

cd "$CI_PRIMARY_REPOSITORY_PATH/apps/nuke-capture-ios"
PLIST="Generated/Info.plist"
BUILD_NUM=$(date +%s)

echo "▸ Setting CFBundleVersion to $BUILD_NUM in $PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $BUILD_NUM" "$PLIST"
echo "▸ CFBundleVersion now: $(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$PLIST")"
