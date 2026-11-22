// WorkLiveActivityTests.swift — the photo-work Live Activity's rules: it shows only while work is
// moving, counts only real rows, goes indeterminate when the size is unknown, and ends (nil) when
// work finishes or stalls. Pure model tests; no ActivityKit, no network.

import XCTest
@testable import NukeCapture

final class WorkLiveActivityTests: XCTestCase {
    private let now = ISO8601DateFormatter().date(from: "2026-11-22T06:00:00Z")!

    private func iso(_ minutesAgo: Double) -> String {
        ISO8601DateFormatter().string(from: now.addingTimeInterval(-minutesAgo * 60))
    }

    private func row(_ id: String, stage: String, createdMinAgo: Double, updatedMinAgo: Double? = nil,
                     attached: Bool? = nil, vehicle: String? = nil) -> CaptureUploadRow {
        var json: [String: Any] = ["image_id": id, "stage": stage,
                                   "created_at": iso(createdMinAgo),
                                   "updated_at": iso(updatedMinAgo ?? createdMinAgo)]
        if let attached { json["attached"] = attached }
        if let vehicle { json["vehicle_id"] = vehicle }
        return CaptureUploadRow(json: json)!
    }

    func testFinishedRowsShowNothing() {
        // The old bar's bug: settled rows from the last six hours kept it up.
        let rows = [row("a", stage: "classified", createdMinAgo: 30), row("b", stage: "attached", createdMinAgo: 20, attached: true)]
        XCTAssertNil(WorkLiveProgress.state(rows: rows, names: [:], uploads: .idle, since: nil, now: now))
    }

    func testStalledQueuedRowsShowNothing() {
        // Rows the server left at "uploaded" for hours are waiting, not in progress.
        let rows = (0..<120).map { row("q\($0)", stage: "uploaded", createdMinAgo: 180) }
        XCTAssertNil(WorkLiveProgress.state(rows: rows, names: [:], uploads: .idle, since: nil, now: now))
        XCTAssertTrue(WorkLiveProgress.liveRows(rows, now: now).isEmpty)
    }

    func testAnalysisCountsTheRun() throws {
        let rows = [
            row("old", stage: "classified", createdMinAgo: 300),     // earlier session, not in this run
            row("a", stage: "classified", createdMinAgo: 10, updatedMinAgo: 2),
            row("b", stage: "classifying", createdMinAgo: 9, updatedMinAgo: 1),
            row("c", stage: "uploaded", createdMinAgo: 8),
            row("d", stage: "failed", createdMinAgo: 7, updatedMinAgo: 3),
        ]
        let state = try XCTUnwrap(WorkLiveProgress.state(rows: rows, names: [:], uploads: .idle, since: nil, now: now))
        XCTAssertEqual(state.phase, .analyzing)
        XCTAssertEqual(state.total, 3)          // b, c are live; the run starts at b's creation (9 min ago)
        XCTAssertEqual(state.completed, 1)      // d settled (failed) inside the run
        XCTAssertEqual(state.failed, 1)
        XCTAssertEqual(state.headline, "Analyzing 1 / 3 photos")
        XCTAssertEqual(state.compactValue, "33%")
    }

    func testSinceWidensTheRun() throws {
        let rows = [
            row("a", stage: "classified", createdMinAgo: 10, updatedMinAgo: 2),
            row("b", stage: "classifying", createdMinAgo: 5, updatedMinAgo: 1),
        ]
        let since = now.addingTimeInterval(-11 * 60)
        let state = try XCTUnwrap(WorkLiveProgress.state(rows: rows, names: [:], uploads: .idle, since: since, now: now))
        XCTAssertEqual(state.total, 2)
        XCTAssertEqual(state.completed, 1)
    }

    func testOnlyQueuedRowsSayWaiting() throws {
        let rows = [row("a", stage: "uploaded", createdMinAgo: 2)]
        let state = try XCTUnwrap(WorkLiveProgress.state(rows: rows, names: [:], uploads: .idle, since: nil, now: now))
        XCTAssertEqual(state.detail, "waiting for the server")
        XCTAssertEqual(state.headline, "Analyzing 0 / 1 photos")
    }

    func testUploadIsIndeterminateWithRealETAOnly() throws {
        var uploads = WorkLiveProgress.Uploads(sending: true, owed: 37, perMinute: 0, held: false)
        var state = try XCTUnwrap(WorkLiveProgress.state(rows: [], names: [:], uploads: uploads, since: nil, now: now))
        XCTAssertEqual(state.phase, .uploading)
        XCTAssertNil(state.total)
        XCTAssertNil(state.fraction)
        XCTAssertNil(state.etaMinutes)          // no measured rate, no ETA
        XCTAssertEqual(state.headline, "Uploading 37 photos")
        XCTAssertEqual(state.compactValue, "37")

        uploads.perMinute = 10
        state = try XCTUnwrap(WorkLiveProgress.state(rows: [], names: [:], uploads: uploads, since: nil, now: now))
        XCTAssertEqual(state.etaMinutes, 4)
        XCTAssertEqual(state.subline, "about 4 min left")
    }

    func testWaitingQueueIsNotProgress() {
        // Owed photos waiting for a charger (not sending), or held by pause/heat, show nothing.
        XCTAssertNil(WorkLiveProgress.state(rows: [], names: [:],
                                            uploads: .init(sending: false, owed: 500, perMinute: 0, held: false),
                                            since: nil, now: now))
        XCTAssertNil(WorkLiveProgress.state(rows: [], names: [:],
                                            uploads: .init(sending: true, owed: 500, perMinute: 3, held: true),
                                            since: nil, now: now))
    }

    func testDoneFrame() {
        let since = now.addingTimeInterval(-15 * 60)
        let rows = [row("a", stage: "classified", createdMinAgo: 10), row("b", stage: "failed", createdMinAgo: 9)]
        let done = WorkLiveProgress.doneState(rows: rows, since: since, last: nil)
        XCTAssertEqual(done.phase, .done)
        XCTAssertEqual(done.headline, "Done · 2 photos")
        XCTAssertEqual(done.subline, "1 failed")
        XCTAssertNil(done.compactValue)
    }

    func testOneVehicleDetail() throws {
        let rows = [row("a", stage: "attached", createdMinAgo: 5, attached: true, vehicle: "v1"),
                    row("b", stage: "classifying", createdMinAgo: 4)]
        let state = try XCTUnwrap(WorkLiveProgress.state(rows: rows, names: ["v1": "1973 Firebird"],
                                                         uploads: .idle, since: nil, now: now))
        XCTAssertEqual(state.detail, "on 1973 Firebird")
    }

    func testShortCounts() {
        XCTAssertEqual(NukeWorkFormat.short(999), "999")
        XCTAssertEqual(NukeWorkFormat.short(1240), "1.2k")
        XCTAssertEqual(NukeWorkFormat.short(29_749), "29k")
    }
}
