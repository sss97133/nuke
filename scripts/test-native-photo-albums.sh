#!/usr/bin/env bash
# Exercise the real local ledger with the app's pinned, already-present GRDB.
# No package downloads, account, UI fixtures or production data are involved.
set -euo pipefail
repo_root=$(cd "$(dirname "$0")/.." && pwd)
: "${GRDB_SOURCE_DIR:?Set GRDB_SOURCE_DIR to the installed GRDB 6.29.3 checkout}"
expected_revision=$(python3 - "$repo_root/apps/nuke-capture-ios/Package.resolved" <<'PY'
import json,sys
pins=json.load(open(sys.argv[1]))['pins']
print(next(p['state']['revision'] for p in pins if p['identity']=='grdb.swift'))
PY
)
actual_revision=$(git -C "$GRDB_SOURCE_DIR" rev-parse HEAD)
[[ "$actual_revision" == "$expected_revision" ]] || { echo 'GRDB checkout differs from the app lockfile' >&2; exit 1; }
test_dir=$(mktemp -d "${TMPDIR:-/tmp}/nuke-album-tests.XXXXXX")
trap 'rm -rf "$test_dir"' EXIT
mkdir -p "$test_dir/Sources/NukeAlbumLedger" "$test_dir/Tests/NukeAlbumLedgerTests"
cp "$repo_root/apps/nuke-capture-ios/Sources/NukeCapture/LocalStore.swift" "$test_dir/Sources/NukeAlbumLedger/"
cp "$repo_root/apps/nuke-capture-ios/Tests/PhotoAlbumLedgerTests.swift" "$test_dir/Tests/NukeAlbumLedgerTests/"
# This display DTO is the only UIKit-side type referenced by the ledger. The
# database, migrations and all album writers/readers are the production source.
cat > "$test_dir/Sources/NukeAlbumLedger/DisplayDTO.swift" <<'SWIFT'
struct LibraryDecoration { let known: Bool; let glyph: String }
SWIFT
python3 - "$test_dir/Package.swift" "$GRDB_SOURCE_DIR" <<'PY'
import json,sys
path=json.dumps(sys.argv[2])
open(sys.argv[1],'w').write('''// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "NukeAlbumLedger", platforms: [.macOS(.v13)],
 dependencies: [.package(name: "GRDB", path: '''+path+''')],
 targets: [.target(name: "NukeAlbumLedger", dependencies: [.product(name: "GRDB", package: "GRDB")]),
 .testTarget(name: "NukeAlbumLedgerTests", dependencies: ["NukeAlbumLedger", .product(name: "GRDB", package: "GRDB")])])
''')
PY
swift test --package-path "$test_dir" --scratch-path "${ALBUM_TEST_BUILD_DIR:-$test_dir/.build}" --jobs 2 -q
