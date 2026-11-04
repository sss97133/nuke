// VideoCaptureMatcher.swift — the rule that decides whether a video may leave the phone at all.
//
// A video is picked up only inside an existing vehicle capture context:
//
//   Camera video  → a photo ALREADY FILED to a vehicle was taken within `photoTimeWindow` (30 min) of
//                   the clip (before it starts or after it ends) AND within `photoRadiusMeters` (150 m)
//                   of the clip's GPS fix. No GPS on the clip = no match. Filed photos naming more than
//                   one vehicle in that window and radius = ambiguous = no match.
//   Screen recording → it was made inside one vehicle's acquisition window: from
//                   `acquisitionDaysBefore` (7) days before the vehicle's purchase date through
//                   `acquisitionDaysAfter` (2) days after it. A screen recording has no GPS, so time
//                   inside the window is the only evidence. Windows of two vehicles overlapping the
//                   recording = ambiguous = no match.
//   Screenshot    → a filed photo within 30 min (and within 150 m when the screenshot carries GPS; most do
//                   not, then time alone), or the screen-recording acquisition window. Otherwise, and only
//                   then, on-device OCR (ScreenshotVehicleTerms) may match it with no vehicle suggested.
//   Videos        → a clip longer than `maxClipSeconds` (10 min) or with no duration never matches.
//
// A match only makes the clip eligible for a low-resolution, silent, private PREVIEW plus metadata.
// The full file stays on the phone until a vehicle is attributed (server state), and a screen
// recording additionally needs the owner's explicit confirmation. No match = nothing leaves the phone.
//
// Pure value logic (no PhotoKit, no network) so the unit tests drive it directly.

import Foundation

enum VideoKind: String, Codable, Sendable {
    case cameraVideo = "camera_video"
    case screenRecording = "screen_recording"
    case screenshot = "screenshot"
    var isVideo: Bool { self != .screenshot }
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

/// A vehicle's purchase date (vehicles.purchase_date, a calendar day).
struct AcquisitionAnchor: Equatable, Sendable {
    let vehicleID: String
    let purchaseDay: Date
}

enum VideoMatchRule: String, Codable, Sendable {
    case filedPhotoTimeAndPlace = "filed_photo_time_place_v1"
    case filedPhotoTime = "filed_photo_time_v1"          // a screenshot with no GPS: time only
    case onDeviceText = "ocr_vehicle_terms_v1"           // a screenshot whose on-device text names a vehicle
    case acquisitionWindow = "acquisition_window_v1"
}

enum VideoUnmatchedReason: String, Equatable, Sendable {
    case badDuration = "bad_duration"
    case noLocation = "no_location"
    case noFiledPhotoNearby = "no_filed_photo_nearby"
    case outsideAcquisitionWindow = "outside_acquisition_window"
    case ambiguousVehicles = "ambiguous_vehicles"
}

enum VideoMatch: Equatable, Sendable {
    /// `vehicleID` is nil only for an OCR match: the phone found vehicle terms but cannot name the vehicle.
    case matched(vehicleID: String?, rule: VideoMatchRule, anchors: Int)
    case unmatched(VideoUnmatchedReason)
    var vehicleID: String? { if case .matched(let v, _, _) = self { return v } else { return nil } }
    var isMatch: Bool { if case .matched = self { return true } else { return false } }
}

enum VideoCaptureMatcher {
    static func evaluate(_ video: VideoCandidate,
                         photos: [FiledPhotoAnchor],
                         acquisitions: [AcquisitionAnchor],
                         calendar: Calendar = .current) -> VideoMatch {
        if video.kind.isVideo {
            guard video.duration > 0, video.duration <= VideoSyncConfig.maxClipSeconds else {
                return .unmatched(.badDuration)
            }
        }
        switch video.kind {
        case .cameraVideo: return matchCamera(video, photos: photos)
        case .screenRecording: return matchScreenRecording(video, acquisitions: acquisitions, calendar: calendar)
        case .screenshot: return matchScreenshot(video, photos: photos, acquisitions: acquisitions, calendar: calendar)
        }
    }

    static func matchCamera(_ video: VideoCandidate, photos: [FiledPhotoAnchor]) -> VideoMatch {
        guard let lat = video.latitude, let lon = video.longitude else { return .unmatched(.noLocation) }
        let from = video.startedAt.addingTimeInterval(-VideoSyncConfig.photoTimeWindow)
        let to = video.endedAt.addingTimeInterval(VideoSyncConfig.photoTimeWindow)
        let near = photos.filter {
            $0.takenAt >= from && $0.takenAt <= to
                && distanceMeters(lat, lon, $0.latitude, $0.longitude) <= VideoSyncConfig.photoRadiusMeters
        }
        let vehicles = Set(near.map(\.vehicleID))
        if vehicles.isEmpty { return .unmatched(.noFiledPhotoNearby) }
        if vehicles.count > 1 { return .unmatched(.ambiguousVehicles) }
        return .matched(vehicleID: vehicles.first!, rule: .filedPhotoTimeAndPlace, anchors: near.count)
    }

    /// A screenshot: a filed photo within 30 min (and 150 m when the screenshot has GPS), else the acquisition
    /// window. Never OCR: the caller reads the text only when this returns unmatched.
    static func matchScreenshot(_ shot: VideoCandidate, photos: [FiledPhotoAnchor], acquisitions: [AcquisitionAnchor],
                                calendar: Calendar) -> VideoMatch {
        let from = shot.startedAt.addingTimeInterval(-VideoSyncConfig.photoTimeWindow)
        let to = shot.startedAt.addingTimeInterval(VideoSyncConfig.photoTimeWindow)
        let near = photos.filter { p in
            guard p.takenAt >= from && p.takenAt <= to else { return false }
            if let lat = shot.latitude, let lon = shot.longitude {
                return distanceMeters(lat, lon, p.latitude, p.longitude) <= VideoSyncConfig.photoRadiusMeters
            }
            return true
        }
        let vehicles = Set(near.map(\.vehicleID))
        if vehicles.count > 1 { return .unmatched(.ambiguousVehicles) }
        if let only = vehicles.first {
            return .matched(vehicleID: only, rule: shot.latitude == nil ? .filedPhotoTime : .filedPhotoTimeAndPlace,
                            anchors: near.count)
        }
        let byWindow = matchScreenRecording(shot, acquisitions: acquisitions, calendar: calendar)
        if byWindow.isMatch || byWindow == .unmatched(.ambiguousVehicles) { return byWindow }
        return .unmatched(.noFiledPhotoNearby)
    }

    /// The acquisition window of a purchase day: [day − 7 days, end of day + 2 days).
    static func acquisitionWindow(purchaseDay: Date, calendar: Calendar) -> Range<Date> {
        let day = calendar.startOfDay(for: purchaseDay)
        let start = calendar.date(byAdding: .day, value: -VideoSyncConfig.acquisitionDaysBefore, to: day) ?? day
        let end = calendar.date(byAdding: .day, value: VideoSyncConfig.acquisitionDaysAfter + 1, to: day) ?? day
        return start..<end
    }

    static func matchScreenRecording(_ video: VideoCandidate, acquisitions: [AcquisitionAnchor],
                                     calendar: Calendar) -> VideoMatch {
        let inside = acquisitions.filter {
            acquisitionWindow(purchaseDay: $0.purchaseDay, calendar: calendar).contains(video.startedAt)
        }
        let vehicles = Set(inside.map(\.vehicleID))
        if vehicles.isEmpty { return .unmatched(.outsideAcquisitionWindow) }
        if vehicles.count > 1 { return .unmatched(.ambiguousVehicles) }
        return .matched(vehicleID: vehicles.first!, rule: .acquisitionWindow, anchors: inside.count)
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
