// VideoSyncConfig.swift — the switch and the numbers for video and screen-recording sync.
//
// The whole feature is OFF by default: nothing here reads a video, exports a preview or opens a
// connection unless `isEnabled` is true, and nothing in the app turns it on. A video is picked up
// only when it falls inside an existing vehicle capture context (VideoCaptureMatcher). Anything
// that does not match stays on the phone and is never uploaded. Plan: docs/VIDEO_SYNC_PLAN.md.

import Foundation

enum VideoSyncConfig {
    /// UserDefaults keys. A missing key means OFF (enabled) and ON (Wi-Fi only).
    static let enabledKey = "videoSync.enabled"
    static let wifiOnlyKey = "videoSync.wifiOnly"

    /// The feature flag. Default OFF: `bool(forKey:)` is false when the key was never written.
    static func isEnabled(_ defaults: UserDefaults = .standard) -> Bool {
        defaults.bool(forKey: enabledKey)
    }

    /// Wi-Fi only unless explicitly set otherwise. Previews are small, the full file is not.
    static func wifiOnly(_ defaults: UserDefaults = .standard) -> Bool {
        (defaults.object(forKey: wifiOnlyKey) as? Bool) ?? true
    }

    // ─── Matching rules (VideoCaptureMatcher) ───────────────────────────────
    /// A camera video matches a filed photo taken within this long of the clip (before it starts or
    /// after it ends).
    static let photoTimeWindow: TimeInterval = 30 * 60
    /// …and shot within this distance of that photo's GPS fix. Same as Config.siteMinRadiusMeters.
    static let photoRadiusMeters: Double = 150
    /// A screen recording matches only when it was made from this many days before a vehicle's
    /// purchase date (the negotiation) to this many days after it (the paperwork).
    static let acquisitionDaysBefore = 7
    static let acquisitionDaysAfter = 2
    /// Longer clips are never picked up: a long screen recording is a conversation, not evidence.
    static let maxClipSeconds: TimeInterval = 10 * 60

    // ─── Scope of one pass ──────────────────────────────────────────────────
    /// Only videos made inside this window are considered. No history, no bulk sync.
    static let lookback: TimeInterval = 14 * 24 * 3600
    /// PhotoKit assets read per pass.
    static let maxAssetsPerPass = 60
    /// Previews exported and queued per pass.
    static let maxPreviewsPerPass = 3

    // ─── Preview ────────────────────────────────────────────────────────────
    /// The preview is the first seconds of the clip, video track only (no audio), 640x480 or less.
    static let previewMaxSeconds: TimeInterval = 60
    static let previewMaxBytes = 25 * 1024 * 1024

    // ─── Storage ────────────────────────────────────────────────────────────
    /// A PRIVATE bucket (the migration creates it). vehicle-photos is public, so a video never goes there.
    static let bucket = "capture-video"
    static let table = "capture_video_assets"
    /// Supabase's resumable endpoint requires exactly 6 MiB chunks (the last may be shorter).
    static let tusChunkBytes = 6 * 1024 * 1024

    static func previewPath(userID: String, assetKey: String) -> String {
        "users/\(userID)/previews/\(assetKey).mp4"
    }
    static func fullPath(userID: String, assetKey: String, fileExtension: String) -> String {
        "users/\(userID)/full/\(assetKey).\(fileExtension.lowercased())"
    }
}
