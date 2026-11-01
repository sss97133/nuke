import XCTest
@testable import NukeCapture

final class CachedNativeSourceReviewTests: XCTestCase {
    private let sourceHash = String(repeating: "a", count: 64)
    private let identifier = "fixture-asset/L0/001"
    private let version = "12345.0"
    private let method = "fixture-current-method"

    private func review(id: String? = nil, version: String? = "12345.0", method: String? = nil,
                        inputHash: String? = nil, vehicle: Bool = true, person: Bool = false,
                        text: [String] = ["2S87R3N100001"], observations: [OnDeviceObservation]? = nil) -> LocalAlbumImageReview {
        let source = OnDeviceObservation.Source(framework: "Apple Vision", model: "VNRecognizeTextRequest",
            revision: 3, os_version: "fixture", method: NativeIdentityOCR.methodVersion)
        let observed = observations ?? text.map { OnDeviceObservation(kind: .ocrText, value: $0, confidence: 1, source: source) }
        return .init(id: "fixture-review", localIdentifier: id ?? identifier, sourceVersion: version,
            inputSHA256: inputHash ?? sourceHash, methodVersion: method ?? self.method, analyzedAt: Date(timeIntervalSince1970: 12345),
            isVehicle: vehicle, hasPerson: person, labelsJSON: "[]", vinCandidatesJSON: "[]",
            textLinesJSON: String(decoding: try! JSONEncoder().encode(text), as: UTF8.self),
            onDeviceJSON: OnDeviceAnalysis.encode(observed))
    }

    private func qualify(_ review: LocalAlbumImageReview?, hash: String? = String(repeating: "a", count: 64),
                         version: String? = "12345.0") -> CachedNativeSourceReview {
        .qualify(review: review, localIdentifier: identifier, currentSourceVersion: version,
                 method: method, uploadedHash: hash)
    }

    func testExactCurrentRelationshipAndBytesRetainReading() {
        let result = qualify(review())
        XCTAssertEqual(result.state, .bound)
        XCTAssertEqual(result.lines.map(\.text), ["2S87R3N100001"])
        XCTAssertNotNil(result.readAt)
    }

    func testMissingUploadedHashIsExplicitlyByteUnbound() {
        let result = qualify(review(), hash: nil)
        XCTAssertEqual(result.state, .byteUnbound)
        XCTAssertEqual(result.lines.count, 1)
        XCTAssertTrue(result.explanation.contains("Uploaded byte identity is not bound"))
    }

    func testDifferentUploadedBytesRemainExplicitlyLocal() {
        let result = qualify(review(), hash: String(repeating: "b", count: 64))
        XCTAssertEqual(result.state, .byteConflict)
        XCTAssertTrue(result.explanation.contains("local source only"))
    }

    func testStaleVersionOrMethodNeverDisplaysObservations() {
        for reading in [review(version: "older"), review(version: nil), review(method: "older")] {
            let result = qualify(reading)
            XCTAssertEqual(result.state, .stale)
            XCTAssertTrue(result.lines.isEmpty)
        }
    }

    func testAbsentCurrentVersionOrWrongSourceCannotReuseCache() {
        for result in [qualify(review(), version: nil), qualify(nil), qualify(review(id: "another-asset")),
                       qualify(review(inputHash: "not-a-hash"))] {
            XCTAssertEqual(result.state, .unavailable)
            XCTAssertTrue(result.lines.isEmpty)
        }
    }

    func testDocumentAndPersonalTextDoNotLeakIntoVehicleReading() {
        for reading in [review(vehicle: false), review(person: true),
                        review(text: ["CERTIFICATE OF TITLE", "PRIVATE NAME", "VIN 2S87R3N100001"])] {
            let result = qualify(reading)
            XCTAssertEqual(result.state, .unavailable)
            XCTAssertTrue(result.lines.isEmpty)
        }
    }

    func testContradictoryOriginalPassIsPreservedWithoutSelectingIdentifier() {
        func observation(_ value: String, seed: Bool) -> OnDeviceObservation {
            .init(kind: .ocrText, value: value, confidence: 1,
                  source: .init(framework: "Apple Vision", model: "VNRecognizeTextRequest", revision: 3,
                                os_version: "fixture", method: seed ? NativeIdentityOCR.seedMethodVersion : NativeIdentityOCR.methodVersion))
        }
        let result = qualify(review(observations: [observation("2S87R3N100001", seed: false), observation("2S87R3N100009", seed: true)]))
        XCTAssertEqual(result.lines.map(\.text), ["2S87R3N100001", "2S87R3N100009"])
        XCTAssertEqual(result.lines.map(\.isSeed), [false, true])
        XCTAssertTrue(result.hasMultipleIdentifierReadings)
    }
}
