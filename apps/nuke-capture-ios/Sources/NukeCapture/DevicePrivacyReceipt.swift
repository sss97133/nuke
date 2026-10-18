import Foundation
import CryptoKit
import CoreGraphics

/// Attributed device testimony for private subject reads, not attestation,
/// public approval, physical identity or a claim about classifier accuracy.
struct DevicePrivacyReceipt: Codable, Equatable, Sendable {
    struct Label: Codable, Equatable, Sendable { let identifier: String; let confidence: Double }
    struct Decode: Codable, Equatable, Sendable {
        var contract = "imageio_thumbnail_512_v1"
        var max_pixel = 512
        var orientation_applied = true
        let input_sha256: String
        let width: Int
        let height: Int
        let byte_length: Int
    }
    var method = "device_privacy_v1"
    var policy_version = 1
    var purpose = "own_private_visual_subjects"
    let owner_user_id: String
    let source_sha256: String
    let source_byte_length: Int
    let observed_at: String
    let classifier_revision: Int
    let face_revision: Int
    let os_major: Int
    var classifier_completed = true
    var face_completed = true
    var pixels_eligible = true
    var clutter = false
    var personal = false
    let prominent_face: Bool
    let is_vehicle: Bool
    let max_core_confidence: Double
    let total_vehicle_confidence: Double
    var face_threshold = 0.045
    let labels: [Label]
    let decode: Decode

    struct Evidence {
        let labels: [(String, Float)]
        let prominentFace: Bool
        let isVehicle: Bool
        let maxCoreConfidence: Float
        let totalVehicleConfidence: Float
    }
    static func make(original: Data, image: CGImage, evidence: Evidence, userId: String, observedAt: Date = Date(), osMajor: Int = ProcessInfo.processInfo.operatingSystemVersion.majorVersion) -> Self? {
        guard (1...4_194_304).contains(original.count), image.width <= 512, image.height <= 512,
              let pixels = image.dataProvider?.data, CFDataGetLength(pixels) > 0, CFDataGetLength(pixels) <= 4_194_304,
              let bytes = CFDataGetBytePtr(pixels) else { return nil }
        let hash = { (data: Data) in SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
        let format = ISO8601DateFormatter(); format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return Self(owner_user_id: userId.lowercased(), source_sha256: hash(original), source_byte_length: original.count, observed_at: format.string(from: observedAt),
            classifier_revision: 2, face_revision: 3, os_major: osMajor, prominent_face: evidence.prominentFace,
            is_vehicle: evidence.isVehicle, max_core_confidence: Double(evidence.maxCoreConfidence), total_vehicle_confidence: Double(evidence.totalVehicleConfidence),
            labels: evidence.labels.prefix(12).map { Label(identifier: $0.0, confidence: Double($0.1)) },
            decode: Decode(input_sha256: hash(Data(bytes: bytes, count: CFDataGetLength(pixels))), width: image.width, height: image.height, byte_length: CFDataGetLength(pixels)))
    }
}
