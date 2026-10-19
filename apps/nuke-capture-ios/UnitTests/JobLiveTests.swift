// JobLiveTests.swift — the live job screen's feed: decoding, wording, merge and polling arithmetic.
//
// The feed says how each event is known (Signed, Recorded, Card processor, Message · not verified), the
// headline is the latest kind of event on record, and new events merge in once, newest first.

import XCTest
@testable import NukeCapture

final class JobLiveTests: XCTestCase {
    private let feedJSON = """
    {"work_order_id":"00000000-0000-4000-8000-0000000000a1","as_of":"2026-10-19T22:00:00.123456+00:00","since":null,
     "events":[
      {"kind":"evidence","ref_id":"00000000-0000-4000-8000-0000000000e1","at":"2026-10-19T21:50:00+00:00","recorded_at":"2026-10-19T21:50:01.5+00:00",
       "basis":"authenticated_sign","role":"accepted_provider","title":"2 photos added",
       "media":{"thumbnails":["https://img.example/1t.jpg"],"withheld":1}},
      {"kind":"message","ref_id":"00000000-0000-4000-8000-0000000000f1","at":"2026-10-19T20:00:00+00:00","recorded_at":"2026-10-19T20:05:00+00:00",
       "basis":"message_testimony","role":"provider","title":"Message from the shop: work finished","media":null},
      {"kind":"work_started","ref_id":"00000000-0000-4000-8000-0000000000b1","at":"2026-10-19T18:00:00+00:00","recorded_at":"2026-10-19T18:00:00+00:00",
       "basis":"authenticated_sign","role":"accepted_provider","title":"Work started","media":null},
      {"kind":"broken"}
     ],
     "live":{"latest_at":"2026-10-19T21:50:00+00:00","latest_recorded_at":"2026-10-19T21:50:01.5+00:00","events_total":3,
       "version":"fixture-version-1","phase":"in_progress","poll_after_seconds":15},
     "viewer":{"party":true}}
    """

    private func feed() throws -> JobActivity { try JobReaders.decode(JobActivity.self, from: Data(feedJSON.utf8)) }

    func testDecodesEventsAndSkipsABrokenOne() throws {
        let a = try feed()
        XCTAssertEqual(a.events.map(\.kind), ["evidence", "message", "work_started"])
        XCTAssertEqual(a.events[0].media, JobActivity.Media(thumbnails: ["https://img.example/1t.jpg"], withheld: 1))
        XCTAssertNil(a.events[1].media)
        XCTAssertEqual(a.live.phase, "in_progress")
        XCTAssertEqual(a.live.pollAfterSeconds, 15)
        XCTAssertEqual(a.live.eventsTotal, 3)
        XCTAssertTrue(a.party)
    }

    func testBasisWordingNeverPromotesAMessage() {
        XCTAssertEqual(ActivityCopy.basisLabel("authenticated_sign"), "Signed")
        XCTAssertEqual(ActivityCopy.basisLabel("record"), "Recorded")
        XCTAssertEqual(ActivityCopy.basisLabel("processor_record"), "Card processor")
        XCTAssertEqual(ActivityCopy.basisLabel("message_testimony"), "Message · not verified")
        XCTAssertFalse(ActivityCopy.basisLabel("message_testimony").contains("Signed"))
    }

    func testHeadlinesAndLiveDot() {
        XCTAssertEqual(ActivityCopy.headline("requested"), "No provider booked yet")
        XCTAssertEqual(ActivityCopy.headline("in_progress"), "Work in progress")
        XCTAssertEqual(ActivityCopy.headline("settled"), "Paid")
        XCTAssertEqual(ActivityCopy.headline("something_new"), "On record")
        XCTAssertTrue(ActivityCopy.isActive("in_progress"))
        XCTAssertFalse(ActivityCopy.isActive("settled"))
    }

    func testRoleLabels() {
        XCTAssertEqual(ActivityCopy.roleLabel("client"), "Customer")
        XCTAssertEqual(ActivityCopy.roleLabel("accepted_provider"), "Provider")
        XCTAssertEqual(ActivityCopy.roleLabel("payee"), "Payee")
        XCTAssertNil(ActivityCopy.roleLabel(nil))
    }

    func testRelativeClock() {
        let now = JobClock.date("2026-10-19T22:00:00+00:00")!
        XCTAssertEqual(ActivityCopy.relative("2026-10-19T21:59:30+00:00", now: now), "just now")
        XCTAssertEqual(ActivityCopy.relative("2026-10-19T21:50:00.5+00:00", now: now), "9 min ago")
        XCTAssertEqual(ActivityCopy.relative("2026-10-19T19:00:00+00:00", now: now), "3 h ago")
        XCTAssertEqual(ActivityCopy.relative("2026-10-18T20:00:00+00:00", now: now), "yesterday")
        XCTAssertEqual(ActivityCopy.relative("not a clock", now: now), "not a clock")
    }

    func testMergeKeepsOneRowPerEventNewestFirstAndFlagsFresh() throws {
        let a = try feed()
        let newer = JobActivity.Event(kind: "completion_attested", refId: "c1", at: "2026-10-19T21:55:00+00:00",
                                      basis: "authenticated_sign", role: "accepted_provider", title: "Work marked complete")
        let merged = ActivityCopy.merge(a.events, [newer, a.events[0]])
        XCTAssertEqual(merged.map(\.kind), ["completion_attested", "evidence", "message", "work_started"])
        XCTAssertEqual(ActivityCopy.fresh(a.events, [newer, a.events[0]]), ["completion_attested:c1"])
    }

    func testProgressFromServerSteps() {
        func step(_ key: String, _ state: String) -> JobProviderPlace.Step {
            JobProviderPlace.Step(key: key, label: key, state: .init(state), evidence: nil, clock: nil, clockBasis: nil,
                                  basis: nil, reports: 0, conflicting: false, customerAccepted: false)
        }
        XCTAssertEqual(ActivityCopy.progress([]), 0)
        XCTAssertEqual(ActivityCopy.progress([step("a", "reached"), step("b", "partial"), step("c", "not_yet"), step("d", "status_only")]),
                       0.375, accuracy: 0.0001)
    }

    func testPollIntervalIsBounded() throws {
        XCTAssertEqual(ActivityCopy.pollInterval(nil), 60)
        XCTAssertEqual(ActivityCopy.pollInterval(try feed().live), 15)
        let tiny = try JobReaders.decode(JobActivity.self, from: Data(feedJSON.replacingOccurrences(of: "\"poll_after_seconds\":15", with: "\"poll_after_seconds\":1").utf8))
        XCTAssertEqual(ActivityCopy.pollInterval(tiny.live), 10)
    }

    func testDefaultModeIsLiveOutsideTheFixtureBackend() {
        if !FixtureBackend.isActive { XCTAssertEqual(JobView.defaultMode, .live) }
    }
}
