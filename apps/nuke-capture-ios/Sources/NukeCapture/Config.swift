// Config.swift — public connection constants + the on-device privacy gate.
//
// PORTED from apps/nuke-capture-mac/Sources/NukeCapture/Config.swift — values
// are kept IDENTICAL except where marked "iOS:".
//
// The URL and anon key are PUBLIC BY DESIGN: they ship in every browser that
// loads nuke.ag (see nuke_frontend/src/lib/supabase.ts — same values). All
// write authority comes from the signed-in user's JWT; RLS scopes every
// storage object and vehicle_images row to that user. The service-role key
// must NEVER appear in this app.

import Foundation

enum Config {
    // ─── Supabase project (mirrors nuke_frontend env) ────────────────────────
    static let supabaseURL = URL(string: "https://qkgaybvrernstplzjaam.supabase.co")!
    static let supabaseAnonKey =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
        "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0." +
        "lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk"

    // Same bucket + path convention as the Mac relay. The path is shared on
    // purpose: if the SAME photo reaches both devices (iCloud), the second
    // upload hits the storage "already exists" tolerance and the row insert's
    // duplicate tolerance — cross-device dedupe falls out of the path scheme.
    static let storageBucket = "vehicle-photos"
    /// Storage prefix inside the bucket: users/<userId>/capture-relay/<filename>
    static func storagePath(userId: String, filename: String) -> String {
        "users/\(userId)/capture-relay/\(filename)"
    }

    /// iOS: `source` column value — 'capture_relay_ios' (Mac uses
    /// 'capture_relay', the retired daemon used 'iphoto') so provenance
    /// records exactly which organ uploaded each photo.
    static let sourceTag = "capture_relay_ios"

    /// iOS: exif_data.synced_by tag, same provenance idea as sourceTag.
    static let syncedByTag = "capture-relay-ios"

    // ─── On-device privacy gate: the GPS shop-gate ───────────────────────────
    // IDENTICAL to the Mac relay: a photo shot at a registered shop is work
    // evidence by definition; photos with no GPS or off-shop NEVER leave the
    // phone (they're counted on the Today screen, nothing more). The SERVER
    // pipeline (photo-pipeline-orchestrator vision gate) remains the second
    // gate for everything that uploads.
    //
    // SHOP_LOCATIONS copied verbatim from the Mac relay / photo-sync-daemon.mjs
    // — add shops here as they're confirmed (lat, lon, ~550 m tolerance).
    struct ShopLocation {
        let name: String
        let lat: Double
        let lon: Double
    }

    static let shopLocations: [ShopLocation] = [
        ShopLocation(name: "ernies_upholstery", lat: 35.977, lon: -114.854),
    ]

    /// ± degrees of latitude/longitude (~550 m) — same as the daemon's SHOP_TOL.
    static let shopTolerance = 0.005

    /// True when the coordinate falls inside any registered shop box.
    static func isAtShop(latitude: Double, longitude: Double) -> Bool {
        shopLocations.contains { shop in
            abs(latitude - shop.lat) < shopTolerance &&
            abs(longitude - shop.lon) < shopTolerance
        }
    }

    // ─── Sync tuning (identical to Mac) ──────────────────────────────────────
    /// Safety valve per sync pass (mirrors the daemon's MAX_PER_RUN).
    static let maxPerRun = 200
    /// Dedupe seen-set cap in UserDefaults.
    static let seenSetCap = 1000
    /// First run looks back this far when no watermark exists yet.
    static let firstRunLookback: TimeInterval = 24 * 3600

    // ─── iOS-only ────────────────────────────────────────────────────────────
    /// BGAppRefreshTask identifier — must match
    /// BGTaskSchedulerPermittedIdentifiers in project.yml.
    static let refreshTaskID = "ag.nuke.capture.refresh"

    /// "View on Nuke" deep link on the Today screen.
    static let profileURL = URL(string: "https://nuke.ag/profile")!

    /// How many recently-uploaded asset identifiers to keep for the Today
    /// screen's thumbnail strip.
    static let recentUploadsCap = 24
}
