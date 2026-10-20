// SyncWatermarkTests.swift — the sync cursor must step past a full page. On 2026-10-19 the owner's phone
// reported watermark 2026-06-20 on every pass for four months: 200 photos fell inside the 3-day overlap,
// so "last photo read" minus the overlap re-read the same page forever.

import XCTest
@testable import NukeCapture

final class SyncWatermarkTests: XCTestCase {
    private let overlap: TimeInterval = 3 * 24 * 3600
    private let now = Date(timeIntervalSince1970: 1_792_000_000)

    func testCaughtUpPassMovesToRunStart() {
        let w = SyncEngine.nextWatermark(pageFull: false, lastReadAt: now.addingTimeInterval(-9_000),
                                         previous: now.addingTimeInterval(-86_400), runStarted: now, overlap: overlap)
        XCTAssertEqual(w, now)
    }

    func testFullPageInsideTheOverlapStillMakesProgress() {
        // The stuck case: the page's last photo is 2 days after the cursor, less than the overlap.
        let cursor = now.addingTimeInterval(-120 * 86_400)
        let last = cursor.addingTimeInterval(2 * 86_400)
        let w = SyncEngine.nextWatermark(pageFull: true, lastReadAt: last, previous: cursor, runStarted: now, overlap: overlap)
        XCTAssertGreaterThan(w, cursor)
        // The next fetch starts one second before the last photo read, so no photo after it is skipped.
        XCTAssertEqual(w.addingTimeInterval(-overlap), last.addingTimeInterval(-1))
    }

    func testRepeatedFullPagesWalkForward() {
        var cursor = now.addingTimeInterval(-120 * 86_400)
        for _ in 0..<5 {
            let last = cursor.addingTimeInterval(-overlap + 2 * 86_400) // page ends 2 days after its own start
            let next = SyncEngine.nextWatermark(pageFull: true, lastReadAt: last, previous: cursor, runStarted: now, overlap: overlap)
            XCTAssertGreaterThan(next, cursor)
            cursor = next
        }
    }

    func testNeverMovesBackwardOrPastNow() {
        let prev = now.addingTimeInterval(-3_600)
        XCTAssertEqual(SyncEngine.nextWatermark(pageFull: true, lastReadAt: now.addingTimeInterval(-90 * 86_400),
                                                previous: prev, runStarted: now, overlap: overlap), prev)
        XCTAssertEqual(SyncEngine.nextWatermark(pageFull: true, lastReadAt: now, previous: prev, runStarted: now, overlap: overlap), now)
    }
}
