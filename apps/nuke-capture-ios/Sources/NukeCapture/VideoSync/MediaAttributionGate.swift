// MediaAttributionGate.swift — the photo filing gate, applied to a clip's frames. Pure value logic.
//
// Owner rule (2026-11-04): no confirm tap. A video is attributed to a vehicle only when its CONTENT clears the same
// confidence threshold photos use. Time and GPS never attribute; they only narrow the candidates
// (VideoCaptureMatcher).
//
// What "the same gate as photos" is, taken from AttributionEngine pass A/B and the server's device_file_images:
//   on the phone (per frame; VideoSyncEngine computes FrameEvidence with the photo code itself):
//     • VisionEngine.classify + prominent-face check → VisionDecision.decide. Pixels may leave only for `.work`.
//       Photos with a person, a document, a screenshot or a web capture never upload pixels.
//     • OnDeviceAnalysis.analyzeIdentity (the identity text reader) → VisionEngine.matchSerial against the owner's
//       own vehicles' VIN/serials; the read must be EXACT (edit distance 0), a single identifier on the frame, from a
//       qualified Apple Vision source at confidence ≥ 0.9, not repaired (AttributionEngine.qualifiedIdentityRead),
//       and the frame must not be a document (VisionEngine.isIdentityDocument).
//     • confidence is the photo formula: 0.99 for a vehicle with a 17-character VIN (method vin_ocr), 0.97 for an
//       older serial (method serial_ocr).
//   on the server (device_file_images → attribute_testimony; the phone cannot run these):
//     • the row belongs to the caller, is not superseded, its vision gate is not rejected;
//     • the vehicle is one of the caller's associated vehicles;
//     • method vin_ocr / serial_ocr with confidence ≥ 0.9 (and the vehicle's VIN length fits the method);
//     • first attribution only, with an audit row (reattribution_audit).
//
// A clip clears only when EVERY sampled frame passes the privacy decision (the preview uploads those pixels) and at
// least one frame has an exact read of exactly one candidate vehicle, with no other identifier read anywhere in
// the clip. Everything else is refused and the clip stays on the phone.

import Foundation

/// What the photo code concluded about one sampled frame.
struct FrameEvidence: Equatable, Sendable {
    /// VisionDecision.decide for this frame (screenshot flag false: PhotoKit calls a clip's frames video, and the
    /// engine refuses screen recordings before reading them).
    var decision: VisionDecision.Category
    /// VisionEngine.isIdentityDocument on this frame's labels and text.
    var isDocument: Bool
    /// The owner's vehicle named by an exact, qualified, single-identifier read on this frame.
    var exactVehicleID: String?
    /// Every vehicle any read on this frame points at, exact or not. An inexact read is only a suggestion for
    /// photos; inside a clip it blocks, because another vehicle may be in the frame.
    var readVehicleIDs: Set<String>
    /// A valid VIN or labelled serial that is not one of the owner's vehicles, or several serial-shaped values.
    var unrecognizedIdentifier: Bool
}

enum MediaRefusal: String, Equatable, Sendable {
    case screenCapture = "screen_capture"
    case unreadableFrame = "unreadable_frame"
    case privacy = "privacy"
    case document = "document"
    case noIdentifierRead = "no_identifier_read"
    case conflictingReads = "conflicting_reads"
    case outsideCandidates = "outside_candidates"
    case belowThreshold = "below_threshold"
}

struct MediaClearance: Equatable, Sendable {
    let vehicleID: String
    /// device_file_images method: "vin_ocr" or "serial_ocr".
    let method: String
    let confidence: Double
    let exactFrames: Int
}

enum MediaGateVerdict: Equatable, Sendable {
    case cleared(MediaClearance)
    case refused(MediaRefusal)
    var isCleared: Bool { if case .cleared = self { return true } else { return false } }
}

enum MediaAttributionGate {
    /// The server floor for vin_ocr and serial_ocr in device_file_images_as (0.9). Photos file at or above it.
    static let confidenceFloor = 0.9
    static let fullVINConfidence = 0.99      // AttributionEngine: full 17-character VIN, edit distance 0
    static let classicSerialConfidence = 0.97 // AttributionEngine: shorter serial, edit distance 0

    static func evaluate(isScreenCapture: Bool,
                         frames: [FrameEvidence],
                         framesRequested: Int,
                         candidates: Set<String>,
                         vinLengthByVehicle: [String: Int]) -> MediaGateVerdict {
        if isScreenCapture { return .refused(.screenCapture) }
        guard framesRequested > 0, frames.count == framesRequested else { return .refused(.unreadableFrame) }
        // The preview uploads these pixels, so each frame must pass the photo pixel rule.
        if frames.contains(where: { $0.decision != .work }) { return .refused(.privacy) }
        if frames.contains(where: \.isDocument) { return .refused(.document) }
        let exact = Set(frames.compactMap(\.exactVehicleID))
        guard !exact.isEmpty else { return .refused(.noIdentifierRead) }
        let reads = frames.reduce(into: Set<String>()) { $0.formUnion($1.readVehicleIDs) }
        if exact.count > 1 || reads != exact || frames.contains(where: \.unrecognizedIdentifier) {
            return .refused(.conflictingReads)
        }
        let vehicleID = exact.first!
        // Time and place narrowed the vehicles; a read of a vehicle outside them is not accepted.
        guard candidates.contains(vehicleID) else { return .refused(.outsideCandidates) }
        guard let length = vinLengthByVehicle[vehicleID], length >= 8 else { return .refused(.belowThreshold) }
        let full = length == 17
        let confidence = full ? fullVINConfidence : classicSerialConfidence
        guard confidence >= confidenceFloor else { return .refused(.belowThreshold) }
        return .cleared(MediaClearance(vehicleID: vehicleID, method: full ? "vin_ocr" : "serial_ocr",
                                       confidence: confidence, exactFrames: frames.filter { $0.exactVehicleID != nil }.count))
    }
}

/// One of the owner's vehicles as the filing gate knows it (the same roster pass B of AttributionEngine uses:
/// user_associated_vehicle_ids → vehicles).
struct MediaRosterVehicle: Equatable, Sendable {
    let id: String
    let vin: String?
}

extension MediaAttributionGate {
    /// The photo identity gate (AttributionEngine pass A + the pass B qualifiers), reduced to one frame. Pure: the
    /// engine feeds it the outputs of the photo readers (classifier decision, text lines, VIN candidates and
    /// on-device observations from OnDeviceAnalysis.analyzeIdentity), so the unit tests drive it without Vision.
    static func frameEvidence(decision: VisionDecision.Category,
                              labels: [String],
                              textLines: [String],
                              vinCandidates: [String],
                              observations: [OnDeviceObservation],
                              roster: [MediaRosterVehicle]) -> FrameEvidence {
        let isDocument = VisionEngine.isIdentityDocument(labels: labels, isScreenshot: false, ocrLines: textLines)
        if isDocument {
            return FrameEvidence(decision: decision, isDocument: true, exactVehicleID: nil,
                                 readVehicleIDs: [], unrecognizedIdentifier: false)
        }
        let known = roster.compactMap { $0.vin?.uppercased() }.filter { $0.count >= 8 }
        let vinToVehicle = AttributionEngine.unambiguousSerialVehicles(roster.compactMap { v in
            v.vin.map { (serial: $0, vehicleId: v.id) }
        })
        let lines = textLines + vinCandidates
        let classic = Set(VisionEngine.labelledClassicSerialCandidates(in: textLines))
        var identifiers = vinCandidates.filter { VisionEngine.isValidVIN($0) || classic.contains($0) }
        let onDevice = OnDeviceAnalysis.uploadable(observations, isDocument: false)
        let match = known.isEmpty ? nil : VisionEngine.matchSerial(in: lines, known: known)
        // A physical pre-1981 plate has no printed label: it may match an already-known identifier exactly.
        if let match, match.editDistance == 0, match.vin.count < 17,
           AttributionEngine.qualifiedIdentityRead(match.vin, observations: onDevice, allowKnownClassicSerial: true) {
            identifiers = Array(Set(identifiers + [match.vin])).sorted()
        }
        let classicIdentifiers = Set(VisionEngine.labelledClassicSerialCandidates(in: lines))
        let raw = VisionEngine.vinCandidates(in: lines) + Array(classicIdentifiers)
        let unknown = match == nil && raw.contains {
            (VisionEngine.isValidVIN($0) || classicIdentifiers.contains($0)) && !known.contains($0)
        }
        let vehicleID = match.flatMap { vinToVehicle[$0.vin] }
        var exactID: String?
        if let match, let vehicleID, match.editDistance == 0, Set(identifiers).count == 1,
           AttributionEngine.qualifiedIdentityRead(match.vin, observations: onDevice, allowKnownClassicSerial: true) {
            exactID = vehicleID
        }
        // A match to a serial two vehicles share, or a second identifier on the same frame, is not a clean read.
        let ambiguous = (match != nil && vehicleID == nil) || Set(identifiers).count > 1
        return FrameEvidence(decision: decision, isDocument: false, exactVehicleID: exactID,
                             readVehicleIDs: vehicleID.map { [$0] } ?? [],
                             unrecognizedIdentifier: unknown || ambiguous)
    }
}
