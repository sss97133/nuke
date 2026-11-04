// VideoSyncConfig.swift — the switch and the numbers for vehicle-video sync.
//
// The whole feature is OFF by default: nothing here reads a video, samples a frame, exports a preview or opens a
// connection unless `isEnabled` is true, and nothing in the app turns it on. A video is attributed to a vehicle only
// by CONTENT: frames read on the phone by the same classifier, VIN/plate readers and filing gate as photos
// (MediaAttributionGate). Time and place only narrow which vehicles are candidates (VideoCaptureMatcher); they never
// attribute. Anything below the gate stays on the phone, nothing about it is sent, and the user is never prompted.
// Plan: docs/VIDEO_SYNC_PLAN.md.

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

    // ─── Candidate narrowing (VideoCaptureMatcher) ──────────────────────────
    /// A clip's candidate vehicles are the vehicles of photos already filed within this long of it (before it
    /// starts or after it ends)…
    static let photoTimeWindow: TimeInterval = 30 * 60
    /// …and shot within this distance of the clip's GPS fix. Same as Config.siteMinRadiusMeters.
    static let photoRadiusMeters: Double = 150
    /// Longer clips are never read: a long clip is not a quick vehicle walk-around.
    static let maxClipSeconds: TimeInterval = 10 * 60

    // ─── Scope of one pass ──────────────────────────────────────────────────
    /// Only videos made inside this window are considered. No history, no bulk sync.
    static let lookback: TimeInterval = 14 * 24 * 3600
    /// PhotoKit video assets listed per pass (metadata only).
    static let maxAssetsPerPass = 60
    /// Clips whose frames are read per pass (frame reading is the expensive step).
    static let maxClipsReadPerPass = 6
    /// Frames sampled per clip, evenly spaced, each read on the phone like a photo.
    static let framesPerClip = 12
    /// Recorded on every row this feature writes (auto_suggestion_reasons and exif_data.media.match.rule).
    static let gateVersion = "media_gate_v1"
    /// A filed clip's attribution is retried this many passes when the server defers or is unreachable.
    static let maxFilingAttempts = 8

    // ─── Preview ────────────────────────────────────────────────────────────
    /// The preview is the first seconds of the clip, video track only (no audio), 640x480 or less.
    static let previewMaxSeconds: TimeInterval = 60
    static let previewMaxBytes = 25 * 1024 * 1024

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

    /// Both objects are keyed by the vehicle_images row id so the storage policy can find the row by primary key
    /// and refuse the object unless the filing gate has already set that row's vehicle_id.
    static func previewPath(userID: String, rowID: String, fileExtension: String = "mp4") -> String {
        "users/\(userID)/previews/\(rowID.lowercased()).\(fileExtension.lowercased())"
    }
    static func fullPath(userID: String, rowID: String, fileExtension: String) -> String {
        "users/\(userID)/full/\(rowID.lowercased()).\(fileExtension.lowercased())"
    }
}
