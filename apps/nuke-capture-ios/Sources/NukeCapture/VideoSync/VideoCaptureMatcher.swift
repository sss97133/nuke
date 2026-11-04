// VideoCaptureMatcher.swift — which vehicles a clip could belong to. It NEVER attributes.
//
// Owner rule (2026-11-04): time and GPS only NARROW the candidate vehicles. A video is attributed only when its
// frames, read on the phone, clear the photo filing gate (MediaAttributionGate) for one of these candidates.
//
//   Camera video     → candidates = the vehicles of photos ALREADY FILED to a vehicle that were taken within
//                      `photoTimeWindow` (30 min) of the clip (before it starts or after it ends) AND within
//                      `photoRadiusMeters` (150 m) of the clip's GPS fix. No GPS, or no filed photo nearby,
//                      means no candidates: the clip is not read at all and stays on the phone. Two vehicles
//                      nearby is fine here: it is a candidate SET, and the frames choose between them.
//   Screen recording → never read and never uploaded: the photo gate treats a screen capture as a document
//                      (VisionEngine.isUnnecessary: isScreenshot), and a VIN printed on a document cannot file a
//                      photo. See docs/VIDEO_SYNC_PLAN.md decision 1.
//   Any video        → longer than `maxClipSeconds` (10 min) or with no duration is not read.
//
// Pure value logic (no PhotoKit, no network) so the unit tests drive it directly.

import Foundation

enum VideoKind: String, Codable, Sendable {
    case cameraVideo = "camera_video"
    case screenRecording = "screen_recording"
}

/// What PhotoKit says about one video, reduced to what the rule needs.
struct VideoCandidate: Equatable, Sendable {
    let assetKey: String          // sha256(userID|localIdentifier): the id the server sees, never the PhotoKit id
    let kind: VideoKind
    let startedAt: Date
    let duration: TimeInterval
    let latitude: Double?
    let longitude: Double?
    var endedAt: Date { startedAt.addingTimeInterval(max(0, duration)) }
}

/// A photo the owner's record already files to a vehicle (vehicle_images.vehicle_id is set).
struct FiledPhotoAnchor: Equatable, Sendable {
    let vehicleID: String
    let takenAt: Date
    let latitude: Double
    let longitude: Double
}

enum VideoSkipReason: String, Equatable, Sendable {
    case screenCapture = "screen_capture"
    case badDuration = "bad_duration"
    case noLocation = "no_location"
    case noFiledPhotoNearby = "no_filed_photo_nearby"
}

enum VideoNarrowing: Equatable, Sendable {
    /// The vehicles this clip could belong to (never empty) and how many filed photos named them.
    case candidates(Set<String>, anchors: Int)
    /// Not read: the clip stays on the phone.
    case skip(VideoSkipReason)

    var vehicleIDs: Set<String> { if case .candidates(let v, _) = self { return v } else { return [] } }
    var isReadable: Bool { if case .candidates = self { return true } else { return false } }
}

enum VideoCaptureMatcher {
    static func narrow(_ video: VideoCandidate, photos: [FiledPhotoAnchor]) -> VideoNarrowing {
        guard video.kind == .cameraVideo else { return .skip(.screenCapture) }
        guard video.duration > 0, video.duration <= VideoSyncConfig.maxClipSeconds else { return .skip(.badDuration) }
        guard let lat = video.latitude, let lon = video.longitude else { return .skip(.noLocation) }
        let from = video.startedAt.addingTimeInterval(-VideoSyncConfig.photoTimeWindow)
        let to = video.endedAt.addingTimeInterval(VideoSyncConfig.photoTimeWindow)
        let near = photos.filter {
            $0.takenAt >= from && $0.takenAt <= to
                && distanceMeters(lat, lon, $0.latitude, $0.longitude) <= VideoSyncConfig.photoRadiusMeters
        }
        guard !near.isEmpty else { return .skip(.noFiledPhotoNearby) }
        return .candidates(Set(near.map(\.vehicleID)), anchors: near.count)
    }

    /// Great-circle distance in meters (haversine).
    static func distanceMeters(_ lat1: Double, _ lon1: Double, _ lat2: Double, _ lon2: Double) -> Double {
        let r = 6_371_000.0
        let p1 = lat1 * .pi / 180, p2 = lat2 * .pi / 180
        let dp = (lat2 - lat1) * .pi / 180, dl = (lon2 - lon1) * .pi / 180
        let a = sin(dp / 2) * sin(dp / 2) + cos(p1) * cos(p2) * sin(dl / 2) * sin(dl / 2)
        return 2 * r * atan2(sqrt(a), sqrt(1 - a))
    }
}
