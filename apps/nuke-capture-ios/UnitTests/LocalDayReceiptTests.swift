import XCTest
import GRDB
#if canImport(NukeCapture)
@testable import NukeCapture
#else
@testable import NukeAlbumLedger
#endif

final class LocalDayReceiptTests: XCTestCase {
    private let first = Date(timeIntervalSince1970: 1_700_000_000)

    private func day(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    private func add(_ id: String, to store: LocalStore, at date: Date?, intent: String = "labor") {
        store.ingest(localIdentifier: id, takenAt: date)
        store.cacheCloudVerdict(localIdentifier: id, narrative: "Synthetic scene analysis",
            intent: intent, scene: nil, confidence: 1, buildPhase: nil,
            vehicleId: nil, agentModel: "synthetic-test", analyzedAt: first)
    }

    func testOneLaborLabeledPhotoRetainsInterpretationWithoutInventingWorkTimeOrPerformer() throws {
        let store = try LocalStore(databaseQueue: DatabaseQueue())
        add("single", to: store, at: first)
        let receipt = try XCTUnwrap(store.dayReceipt(onDay: day(first)))
        XCTAssertEqual(receipt.count, 1)
        XCTAssertEqual(receipt.firstShot, first)
        XCTAssertEqual(receipt.lastShot, first)
        XCTAssertEqual(receipt.analysisSummary, "Retained analysis: 1 of 1 frames · 1 labeled \"labor\"")
        XCTAssertNil(receipt.agentVehicleId)
    }

    func testSeparatedPhotosKeepCaptureSpanAndBurstsWithoutTurningGapIntoLabor() throws {
        let store = try LocalStore(databaseQueue: DatabaseQueue())
        let second = first.addingTimeInterval(90 * 60)
        add("first", to: store, at: first)
        add("second", to: store, at: second)
        let receipt = try XCTUnwrap(store.dayReceipt(onDay: day(first)))
        XCTAssertEqual(receipt.firstShot, first)
        XCTAssertEqual(receipt.lastShot, second)
        XCTAssertEqual(receipt.bursts, 2)
        XCTAssertEqual(receipt.analysisSummary, "Retained analysis: 2 of 2 frames · 2 labeled \"labor\"")
    }

    func testUndatedAndUnanalyzedSourcesCannotBecomeDatedLaborEvidence() throws {
        let store = try LocalStore(databaseQueue: DatabaseQueue())
        add("undated", to: store, at: nil)
        store.ingest(localIdentifier: "unread", takenAt: first)
        let receipt = try XCTUnwrap(store.dayReceipt(onDay: day(first)))
        XCTAssertEqual(receipt.count, 1)
        XCTAssertEqual(receipt.read, 0)
        XCTAssertTrue(receipt.intents.isEmpty)
        XCTAssertEqual(receipt.analysisSummary, "Retained analysis: 0 of 1 frames")
    }
}
