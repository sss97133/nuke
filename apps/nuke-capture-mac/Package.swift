// swift-tools-version: 6.0
//
// NukeCapture — macOS menu-bar capture relay for the Nuke vehicle platform.
//
// Replaces the unsigned CLI chain (launchd → dotenvx → node → osxphotos) that
// could never hold a TCC Photos grant and produced ~96 permission popups/day.
// A signed native app gets ONE persistent Photos permission.
//
// Build:  swift build          (dev — see README for signing/distribution)
// Run:    swift run NukeCapture
import PackageDescription

let package = Package(
    name: "NukeCapture",
    platforms: [
        .macOS(.v14)
    ],
    dependencies: [
        // Official Supabase Swift SDK — auth (Keychain-persisted session),
        // storage uploads, and PostgREST inserts. Latest stable major: 2.x.
        .package(url: "https://github.com/supabase/supabase-swift", from: "2.0.0")
    ],
    targets: [
        .executableTarget(
            name: "NukeCapture",
            dependencies: [
                .product(name: "Supabase", package: "supabase-swift")
            ],
            swiftSettings: [
                // Swift 5 language mode on the Swift 6.2 toolchain: AppKit +
                // PhotoKit delegate callbacks (PHPhotoLibraryChangeObserver
                // arrives on a background queue) predate strict Sendable
                // checking. Migrate to .v6 when the PhotoKit surface is
                // annotated; nothing here relies on unchecked data races —
                // all mutable state is confined to the main actor by hand.
                .swiftLanguageMode(.v5)
            ],
            linkerSettings: [
                // Embed Info.plist into the bare executable's __TEXT,__info_plist
                // section so TCC can read NSPhotoLibraryUsageDescription even in
                // dev (`swift run`) before the app is bundled/signed in Xcode.
                // Without this, PhotoKit access from an unbundled binary is
                // denied outright instead of prompting.
                .unsafeFlags([
                    "-Xlinker", "-sectcreate",
                    "-Xlinker", "__TEXT",
                    "-Xlinker", "__info_plist",
                    "-Xlinker", "Info.plist",
                ])
            ]
        )
    ]
)
