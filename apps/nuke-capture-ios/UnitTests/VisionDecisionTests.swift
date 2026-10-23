import XCTest
import CoreGraphics
import GRDB
@testable import NukeCapture

final class VisionDecisionTests: XCTestCase {
    private func image() throws -> CGImage {
        let c = try XCTUnwrap(CGContext(data: nil, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        return try XCTUnwrap(c.makeImage())
    }
    private func d(_ l: [(String, Float)], vehicle: Bool = false, face: Bool = false, shot: Bool = false) -> VisionDecision {
        VisionDecision.decide(labels: l, isVehicle: vehicle, face: face, isScreenshot: shot)
    }

    func testRulesSeparateNotWorkFromSensitive() {
        XCTAssertEqual(d([("car", 0.9)], vehicle: true), .init(category: .work, reason: "vehicle"))
        XCTAssertEqual(d([("machine", 0.6)]).category, .work)
        XCTAssertEqual(d([("car", 0.9)], vehicle: true, shot: true), .init(category: .notWork, reason: "screenshot"))
        XCTAssertEqual(d([("website", 0.8)]), .init(category: .notWork, reason: "capture_website"))
        XCTAssertEqual(d([("id_card", 0.8)]), .init(category: .sensitive, reason: "id_document"))
        XCTAssertEqual(d([("receipt", 0.7), ("car", 0.2)], vehicle: true), .init(category: .sensitive, reason: "document"))
        // A selfie with no vehicle or shop context stays rejected, as sensitive.
        XCTAssertEqual(d([("people", 0.9), ("adult", 0.8)], face: true), .init(category: .sensitive, reason: "personal_face"))
        XCTAssertTrue(d([("people", 0.9)], face: true).isPersonal)
    }

    func testPeopleWithWorkContextAreASoftSignalButPixelsStayOnThePhone() {
        for labels: [(String, Float)] in [[("people", 0.9), ("wrench", 0.3)], [("people", 0.9), ("tire", 0.2)], [("workshop", 0.5)]] {
            let r = d(labels, face: true)
            XCTAssertEqual(r.category, .workWithPeople, "\(labels)")
            XCTAssertFalse(r.isPersonal)          // counted as work, not hidden as personal
            XCTAssertFalse(r.pixelsEligible)      // never uploaded raw: no pre-upload redaction exists
        }
        XCTAssertEqual(d([("people", 0.9)], vehicle: true, face: true).category, .workWithPeople)
        // Below the context threshold a faint tool label does not rescue a portrait.
        XCTAssertEqual(d([("people", 0.9), ("wrench", 0.05)], face: true).category, .sensitive)
    }

    func testPeoplePlusVehicleTriageAndContributorNeverReleasePixels() throws {
        let cg = try image()
        let cls = VisionEngine.Classification(labels: [("car", 0.8), ("people", 0.6)], isVehicle: true, maxCoreConfidence: 0.8)
        let t = VisionEngine.triage(cg, classifyImage: { _ in cls }, detectFace: { _ in true })
        XCTAssertFalse(t.pixelsEligible)
        XCTAssertEqual(t.decision?.category, .workWithPeople)
        XCTAssertTrue(t.hasFace)
        XCTAssertEqual(VisionEngine.contributorVerdict(cg, classifyImage: { _ in cls }, detectFace: { _ in true }),
                       .hold(reason: "people_in_frame"))
        XCTAssertEqual(VisionEngine.contributorVerdict(cg, classifyImage: { _ in cls }, detectFace: { _ in false }), .allow)
    }

    func testLogEncodingRoundTripsIdsAndLabelsOnly() throws {
        let log = try VisionDecisionLog(DatabaseQueue())
        let r = VisionDecisionRecord(assetId: "A/L0/001", source: "library", decision: d([("car", 0.9)], vehicle: true),
            labels: [("car", 0.91234), ("tire", 0.5), ("road", 0.4), ("wheel", 0.3), ("garage", 0.2), ("sky", 0.1)], hasFace: false,
            decidedAt: Date(timeIntervalSince1970: 1_800_000_000))
        XCTAssertEqual(r.labels.count, 5)
        XCTAssertEqual(r.labels.first, .init(id: "car", score: 0.912))
        XCTAssertTrue(VisionDecisionLog.encodeLabels(r.labels).hasPrefix(#"[{"id":"car","score":0.912},"#))
        XCTAssertEqual(VisionDecisionLog.decodeLabels(VisionDecisionLog.encodeLabels(r.labels)), r.labels)
        log.record(r)
        log.record(r)   // upsert, not a duplicate
        XCTAssertEqual(log.records(), [r])
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(r)) as? [String: Any]
        XCTAssertEqual(Set(json.map { Array($0.keys) } ?? []), ["assetId", "source", "category", "reason", "labels", "hasFace", "decidedAt"])
    }

    func testCountsByReasonKeepCategoriesApart() throws {
        let log = try VisionDecisionLog(DatabaseQueue())
        log.record(.init(assetId: "1", source: "library", decision: d([("website", 0.9)]), labels: [], hasFace: false))
        log.record(.init(assetId: "2", source: "library", decision: d([("people", 0.9)], face: true), labels: [], hasFace: true))
        log.record(.init(assetId: "3", source: "library", decision: d([("people", 0.9)], face: true), labels: [], hasFace: true))
        log.record(.init(assetId: "4", source: "sync", category: VisionDecisionRecord.gateCategory, reason: "no_location"))
        XCTAssertEqual(Set(log.counts()), [
            .init(category: "not_work", reason: "capture_website", count: 1),
            .init(category: "sensitive", reason: "personal_face", count: 2),
            .init(category: "gate", reason: "no_location", count: 1),
        ])
        XCTAssertEqual(log.counts(source: "sync").count, 1)
    }

    func testSensitiveRejectsAreNeverInTheUploadPayloadAndUploadIsOffByDefault() async throws {
        let recs: [VisionDecisionRecord] = [
            .init(assetId: "id-card", source: "library", decision: d([("id_card", 0.9)]), labels: [("id_card", 0.9)], hasFace: false),
            .init(assetId: "selfie", source: "library", decision: d([("people", 0.9)], face: true), labels: [("people", 0.9)], hasFace: true),
            .init(assetId: "shot", source: "library", decision: d([], shot: true), labels: [], hasFace: false),
            .init(assetId: "work", source: "library", decision: d([("car", 0.9)], vehicle: true), labels: [("car", 0.9)], hasFace: false),
        ]
        let p = VisionRejectUpload.payload(recs)
        XCTAssertEqual(p.map(\.asset_id), ["shot"])
        let body = String(decoding: try JSONEncoder().encode(p), as: UTF8.self)
        XCTAssertFalse(body.contains("id-card")); XCTAssertFalse(body.contains("selfie")); XCTAssertFalse(body.contains("sensitive"))
        UserDefaults.standard.removeObject(forKey: VisionRejectUpload.enabledKey)
        XCTAssertFalse(VisionRejectUpload.isEnabled)
        let sent = await VisionRejectUpload.uploadIfEnabled(log: try VisionDecisionLog(DatabaseQueue()))
        XCTAssertEqual(sent, 0)
    }
}
