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
    static let supabaseURL: URL = {
        #if DEBUG
        // Screenshot-loop hook ONLY (same DEBUG-gated convention as the
        // NUKE_DEBUG_SCREEN/_VEHICLE_ID deep-links in NukeCaptureApp.swift):
        // NUKE_DEBUG_FORCE_OFFLINE=1 points the client at localhost on a port
        // nothing listens on, so every live call gets an immediate TCP
        // connection-refused (no 60s connect-timeout wait like a black-holed
        // IP would cause) — proves the offline-cache fallback path for real,
        // fast enough for a screenshot loop. DEBUG builds only; never
        // compiled into a release/TestFlight binary.
        if ProcessInfo.processInfo.environment["NUKE_DEBUG_FORCE_OFFLINE"] == "1" {
            return URL(string: "https://127.0.0.1:65535")!
        }
        #endif
        return URL(string: "https://qkgaybvrernstplzjaam.supabase.co")!
    }()
    // The project's publishable key, public by design: it ships in every client. The legacy anon JWT that stood
    // here stopped working when the legacy API keys were disabled (key switch, 2026-10-14 05:28Z).
    static let supabaseAnonKey = "sb_publishable_jJ4IIdHqsgd7Gd5c55t-5g_SceqkkXU"

    // Content-addressed under the relay's folder: users/<userId>/capture-relay/<sha256>/<filename>.
    // The path used to be the filename alone, but iPhone names wrap at IMG_9999 and repeat across
    // years, so a new photo met an older photo's object, the upload's "already exists" tolerance
    // passed, and its row pointed at the older bytes: 586 paths held rows of different photos
    // (2026-10-15, 1,266 rows). Keyed by the bytes, "already exists" means the same photo, so the
    // tolerance is true again, and the same photo from two devices still lands on one object.
    static let storageBucket = "vehicle-photos"
    static func storagePath(userId: String, sha256: String, filename: String) -> String {
        "users/\(userId)/capture-relay/\(sha256)/\(filename)"
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
    /// Assets already settled (uploaded, or definitively not this camera's), by PHAsset
    /// localIdentifier, checked before any byte is read. Cap in UserDefaults (~45 B each).
    static let seenAssetCap = 5000
    /// Attempts an asset gets before a pass stops waiting on it. Without a limit one photo that
    /// always fails held the watermark forever, and every open re-read the same originals.
    static let maxAttemptsPerAsset = 3
    /// Steady-state fallback: how far sync() looks back when no watermark
    /// exists. First run proper is the IGNITION full-library scan
    /// (IgnitionEngine) — it sets the watermark to the scan moment and the
    /// backfill owns everything older; this lookback only applies if sync
    /// somehow runs with no watermark at all.
    static let firstRunLookback: TimeInterval = 24 * 3600

    // ─── Ignition (first-run scan + site clustering + backfill) ──────────────
    /// Grid cell edge for GPS clustering (~75 m).
    static let siteCellMeters: Double = 75
    /// A cluster needs at least this many photos to be proposed as a site.
    static let siteMinPhotos = 5
    /// How many site candidates ignition presents, ranked by photo count.
    static let siteMaxCandidates = 3
    /// Floor on a confirmed site's gate radius.
    static let siteMinRadiusMeters: Double = 150
    /// Backfill upload batch size (UPLOAD N runs in caps of this).
    static let backfillBatchSize = 50
    /// How many queued photos a FOREGROUND pass may push before handing the rest to the
    /// power + Wi-Fi background job. Each one loads original bytes, runs on-device triage
    /// and uploads; an unbounded foreground drain made the phone hot on every open
    /// (owner, 2026-10-13). The background drain (drainUntilEmpty) is not budgeted.
    static let foregroundBackfillBudget = 40
    /// The pause between queued photos in a foreground pass, so the drain shares the
    /// device with the screen the owner is looking at.
    static let foregroundBackfillPaceMs = 400

    // ─── iOS-only ────────────────────────────────────────────────────────────
    /// BGAppRefreshTask identifier — must match
    /// BGTaskSchedulerPermittedIdentifiers in project.yml.
    static let refreshTaskID = "ag.nuke.capture.refresh"
    /// BGProcessingTask identifier for the backfill drain — must match
    /// BGTaskSchedulerPermittedIdentifiers in project.yml.
    static let backfillTaskID = "ag.nuke.capture.backfill"

    /// Background backfill drain runs only on un-metered Wi-Fi (BGProcessingTaskRequest has no Wi-Fi-only flag; NetworkMonitor enforces it).
    static let backfillRequiresWiFi = true

    /// How many recently-uploaded asset identifiers to keep for the Today
    /// screen's thumbnail strip.
    static let recentUploadsCap = 24

    /// Google sign-in door — gated OFF until the Supabase Google provider is
    /// configured for this bundle id. The constellation renders the button
    /// only when this is true; signInWithOAuth(.google) is wired (see
    /// SupabaseService.signInWithGoogle). Runtime dependency: the Supabase
    /// project's Google auth provider must be enabled AND oauthRedirectURL
    /// must be in its Auth → URL Configuration redirect allow-list, or the
    /// ASWebAuthenticationSession returns an error. Flip to true once both
    /// are in place.
    static let enableGoogleSignIn = false

    /// GitHub sign-in door — same gating contract as enableGoogleSignIn.
    /// signInWithOAuth(.github) is wired (SupabaseService.signInWithGitHub).
    /// Runtime dependency: enable the GitHub provider in Supabase and add
    /// oauthRedirectURL to the redirect allow-list before flipping to true.
    static let enableGithubSignIn = false

    /// OAuth callback URL for the ASWebAuthenticationSession providers
    /// (Google, GitHub). The scheme is registered in project.yml's
    /// CFBundleURLTypes; this exact URL must also appear in the Supabase
    /// Auth → URL Configuration redirect allow-list at runtime.
    static let oauthRedirectURL = URL(string: "ag.nuke.capture://login-callback")!

    /// Explore mode's sample profile (the Profile tab with no session) —
    /// a real prod profile with a deep day record, never a fixture.
    /// profiles.id for handle "skylar".
    static let sampleProfileUserId = "0b9f107a-d124-49de-9ded-94698f63c1c4"
}
