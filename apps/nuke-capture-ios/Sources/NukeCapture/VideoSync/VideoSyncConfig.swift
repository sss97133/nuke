// VideoSyncConfig.swift — the switch and the numbers for video, screen-recording and screenshot sync.
//
// The whole feature is OFF by default: nothing here reads a video or screenshot, exports a preview or
// opens a connection unless `isEnabled` is true, and nothing in the app turns it on. A clip or screenshot
// is picked up only when it falls inside an existing vehicle capture context (VideoCaptureMatcher) or,
// for a screenshot only, when on-device OCR finds vehicle terms (ScreenshotVehicleTerms). Anything
// that does not match stays on the phone and is never uploaded. Plan: docs/VIDEO_SYNC_PLAN.md.

import CoreGraphics
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
    /// A camera video or screenshot matches a filed photo taken within this long of it (before it starts
    /// or after it ends).
    static let photoTimeWindow: TimeInterval = 30 * 60
    /// …and shot within this distance of that photo's GPS fix. Same as Config.siteMinRadiusMeters.
    static let photoRadiusMeters: Double = 150
    /// A screen recording or screenshot matches only when it was made from this many days before a vehicle's
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
    /// Screenshots are read for OCR on the phone only (nothing is sent); at most this many per pass.
    static let maxScreenshotOCRPerPass = 25
    /// Screenshot previews exported and queued per pass.
    static let maxScreenshotPreviewsPerPass = 10

    // ─── Preview ────────────────────────────────────────────────────────────
    /// The preview is the first seconds of the clip, video track only (no audio), 640x480 or less.
    static let previewMaxSeconds: TimeInterval = 60
    static let previewMaxBytes = 25 * 1024 * 1024
    /// A screenshot preview is a JPEG of at most this many pixels on the long edge, with no metadata.
    static let screenshotPreviewLongEdge: CGFloat = 1280
    static let screenshotPreviewQuality: CGFloat = 0.6
    static let screenshotPreviewMaxBytes = 2 * 1024 * 1024
    /// The longest edge handed to on-device text recognition. The text itself is never stored or sent.
    static let ocrLongEdge: CGFloat = 1600

    // ─── Storage ────────────────────────────────────────────────────────────
    /// A PRIVATE bucket (the migration creates it). vehicle-photos and vehicle-images are public, and
    /// vehicle-images only allows image mime types, so none of this goes there.
    static let bucket = "capture-media"
    /// The vehicle_images row is the record (is_video, duration_seconds, video_codec, video_resolution, mime_type).
    static let table = "vehicle_images"
    /// Its own source, so the photo pipeline's capture_relay_ios triggers and readers never see these rows.
    static let rowSource = "capture_relay_ios_media"
    /// Supabase's resumable endpoint requires exactly 6 MiB chunks (the last may be shorter).
    static let tusChunkBytes = 6 * 1024 * 1024

    static func previewPath(userID: String, assetKey: String, fileExtension: String = "mp4") -> String {
        "users/\(userID)/previews/\(assetKey).\(fileExtension.lowercased())"
    }
    /// Keyed by the vehicle_images row id, so the storage policy can look the row up by primary key and
    /// refuse the object unless that row is attributed.
    static func fullPath(userID: String, rowID: String, fileExtension: String) -> String {
        "users/\(userID)/full/\(rowID.lowercased()).\(fileExtension.lowercased())"
    }
}
