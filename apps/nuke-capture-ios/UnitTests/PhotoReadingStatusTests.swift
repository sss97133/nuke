// PhotoReadingStatusTests.swift — the photo reading status: tolerant decoding of the server's answer, the
// words and tones the bar shows, when the bar is hidden, the "checked N min ago" clock and the refresh
// back-off. Pure model tests; no network. Every id and sentence here is made up.

import XCTest
@testable import NukeCapture

final class PhotoReadingStatusTests: XCTestCase {
    /// Decoded the way the app decodes the reader's answer.
    private func reading(_ json: String) -> PhotoReadingStatus? {
        CaptureLedgerReporter.decodeOptional(PhotoReadingStatus.self, from: Data(json.utf8))
    }

    private func clock(_ iso: String) -> Date {
        ISO8601DateFormatter().date(from: iso)!
    }

    private let movingJSON = """
    {"as_of":"2026-01-15T20:00:00.123456+00:00","state":"moving","headline":"Reading your photos",
     "summary":"12 read in the last hour · on photos from May 2018","reasons":[],
     "lines":["12 read in the last hour, 40 in the last day.",
              "Now on photos taken in May 2018. Your photos run from January 2015 to January 2026.",
              "Worked through 1,200 of 9,000 photos in date order.",
              "40 photos read since Jan 14. Readings made before then are not counted here.",
              "250 are with the reader now.",
              "2 could not be opened and will be tried again."],
     "photos_total":9000,"worked_through":1200,"read_since_start":40,"counting_since":"2026-01-14T08:00:00+00:00",
     "could_not_read":2,"skipped":1,"retrying":3,"with_reader":250,"read_1h":12,"read_24h":40,
     "last_read_at":"2026-01-15T19:58:00+00:00","last_attempt_at":"2026-01-15T19:59:00+00:00",
     "reading_from":"2018-05-06T17:20:00+00:00","library_from":"2015-01-03T10:00:00+00:00",
     "library_to":"2026-01-14T23:10:00+00:00","library_walked_at":null,
     "reader_checked_in_at":"2026-01-15T19:55:00+00:00"}
    """

    private let stalledJSON = """
    {"as_of":"2026-01-15T20:00:00+00:00","state":"stalled","headline":"Photo reading has stalled",
     "summary":"The reader on the Mac has not checked in for about 3 hours. It runs only while the Mac is awake and signed in.",
     "reasons":["The reader on the Mac has not checked in for about 3 hours. It runs only while the Mac is awake and signed in.",
                "The job that lines photos up last ran about 2 hours ago."],
     "lines":["250 are with the reader now."],"photos_total":9000,"with_reader":250,"read_1h":0,"read_24h":5}
    """

    // MARK: Decoding

    func testDecodesEveryKey() throws {
        let r = try XCTUnwrap(reading(movingJSON))
        XCTAssertEqual(r.as_of, "2026-01-15T20:00:00.123456+00:00")
        XCTAssertEqual(r.state, "moving")
        XCTAssertEqual(r.headline, "Reading your photos")
        XCTAssertEqual(r.summary, "12 read in the last hour · on photos from May 2018")
        XCTAssertEqual(r.reasons?.count, 0)
        XCTAssertEqual(r.lines?.count, 6)
        XCTAssertEqual(r.photos_total, 9000)
        XCTAssertEqual(r.worked_through, 1200)
        XCTAssertEqual(r.read_since_start, 40)
        XCTAssertEqual(r.counting_since, "2026-01-14T08:00:00+00:00")
        XCTAssertEqual(r.could_not_read, 2)
        XCTAssertEqual(r.skipped, 1)
        XCTAssertEqual(r.retrying, 3)
        XCTAssertEqual(r.with_reader, 250)
        XCTAssertEqual(r.read_1h, 12)
        XCTAssertEqual(r.read_24h, 40)
        XCTAssertEqual(r.last_read_at, "2026-01-15T19:58:00+00:00")
        XCTAssertEqual(r.last_attempt_at, "2026-01-15T19:59:00+00:00")
        XCTAssertEqual(r.reading_from, "2018-05-06T17:20:00+00:00")
        XCTAssertEqual(r.library_from, "2015-01-03T10:00:00+00:00")
        XCTAssertEqual(r.library_to, "2026-01-14T23:10:00+00:00")
        XCTAssertNil(r.library_walked_at)
        XCTAssertEqual(r.reader_checked_in_at, "2026-01-15T19:55:00+00:00")
    }

    func testDecodesWithMissingKeys() throws {
        let r = try XCTUnwrap(reading(#"{"state":"idle","headline":"Photo reading is waiting"}"#))
        XCTAssertEqual(r.state, "idle")
        XCTAssertEqual(r.headline, "Photo reading is waiting")
        XCTAssertNil(r.as_of)
        XCTAssertNil(r.summary)
        XCTAssertNil(r.reasons)
        XCTAssertNil(r.lines)
        XCTAssertNil(r.photos_total)
        XCTAssertNil(r.reader_checked_in_at)
        // An empty object is still an answer; it simply says nothing.
        let empty = try XCTUnwrap(reading("{}"))
        XCTAssertEqual(empty, PhotoReadingStatus())
        XCTAssertEqual(PhotoReadingWords.tone(empty), .absent)
    }

    func testDecodesWithNulls() throws {
        let r = try XCTUnwrap(reading("""
        {"as_of":null,"state":"off","headline":"Photo reading is not switched on for this account","summary":null,
         "reasons":null,"lines":null,"photos_total":9000,"worked_through":null,"read_since_start":0,
         "counting_since":null,"could_not_read":0,"skipped":0,"retrying":0,"with_reader":0,"read_1h":0,"read_24h":0,
         "last_read_at":null,"last_attempt_at":null,"reading_from":null,"library_from":null,"library_to":null,
         "library_walked_at":null,"reader_checked_in_at":null}
        """))
        XCTAssertEqual(r.state, "off")
        XCTAssertNil(r.as_of)
        XCTAssertNil(r.summary)
        XCTAssertNil(r.reasons)
        XCTAssertNil(r.lines)
        XCTAssertNil(r.worked_through)
        XCTAssertEqual(r.photos_total, 9000)
        XCTAssertEqual(r.read_since_start, 0)
        XCTAssertEqual(PhotoReadingWords.rows(r), [])
        XCTAssertNil(PhotoReadingWords.checkedAgo(r, now: clock("2026-01-15T22:00:00Z")))
    }

    func testAJsonbNullAndANonObjectAreNoReading() {
        XCTAssertNil(reading("null"))
        XCTAssertNil(reading("[]"))
        XCTAssertNil(reading("\"moving\""))
        XCTAssertNil(reading("not json"))
    }

    func testOneMalformedFieldNeverSinksTheRest() throws {
        let r = try XCTUnwrap(reading("""
        {"state":"stalled","headline":"Photo reading has stalled","reasons":["First reason.",null,7,"Second reason."],
         "lines":"not a list","photos_total":"many","read_1h":{"n":1},"as_of":12}
        """))
        XCTAssertEqual(r.state, "stalled")
        XCTAssertEqual(r.reasons ?? [], ["First reason.", "Second reason."])
        XCTAssertNil(r.lines)
        XCTAssertNil(r.photos_total)
        XCTAssertNil(r.read_1h)
        XCTAssertNil(r.as_of)
        XCTAssertEqual(PhotoReadingWords.collapsed(r), "Photo reading has stalled · First reason.")
    }

    func testAnUnknownStateWordIsQuietAndNeverShown() throws {
        let r = try XCTUnwrap(reading(#"{"state":"catching_up","headline":"Photo reading is catching up","lines":["12 waiting to be retried."]}"#))
        XCTAssertEqual(PhotoReadingWords.tone(r), .idle)
        XCTAssertFalse(PhotoReadingWords.leads(r))
        XCTAssertEqual(PhotoReadingWords.headline(r), "Photo reading is catching up")
        XCTAssertEqual(PhotoReadingWords.rows(r), ["12 waiting to be retried."])
        let shown = ([PhotoReadingWords.collapsed(r)].compactMap { $0 } + PhotoReadingWords.rows(r)).joined(separator: " ")
        XCTAssertFalse(shown.contains("_"))
        XCTAssertFalse(shown.contains("catching_up"))
        // No headline and an unknown word: nothing is invented for it.
        XCTAssertNil(PhotoReadingWords.headline(PhotoReadingStatus(state: "catching_up")))
    }

    // MARK: Tones

    func testStateWordsMapToTones() {
        XCTAssertEqual(PhotoReadingTone(serverValue: "moving"), .moving)
        XCTAssertEqual(PhotoReadingTone(serverValue: "stalled"), .stalled)
        XCTAssertEqual(PhotoReadingTone(serverValue: "idle"), .idle)
        XCTAssertEqual(PhotoReadingTone(serverValue: "off"), .off)
        XCTAssertEqual(PhotoReadingTone(serverValue: " Stalled "), .stalled)
        XCTAssertEqual(PhotoReadingTone(serverValue: nil), .absent)
        XCTAssertEqual(PhotoReadingTone(serverValue: "  "), .absent)
        XCTAssertEqual(PhotoReadingWords.tone(nil), .absent)
    }

    // MARK: Words

    func testMovingShowsTheServerHeadlineThenItsSummary() throws {
        let r = try XCTUnwrap(reading(movingJSON))
        XCTAssertEqual(PhotoReadingWords.tone(r), .moving)
        XCTAssertTrue(PhotoReadingWords.leads(r))
        XCTAssertEqual(PhotoReadingWords.headline(r), "Reading your photos")
        XCTAssertEqual(PhotoReadingWords.summary(r), "12 read in the last hour · on photos from May 2018")
        XCTAssertEqual(PhotoReadingWords.collapsed(r), "Reading your photos · 12 read in the last hour · on photos from May 2018")
        XCTAssertEqual(PhotoReadingWords.reasons(r), [])
        // The detail lines are the server's sentences, in its order, untouched.
        XCTAssertEqual(PhotoReadingWords.rows(r), r.lines ?? [])
        XCTAssertEqual(PhotoReadingWords.rows(r).count, 6)
        XCTAssertEqual(PhotoReadingWords.rows(r).first, "12 read in the last hour, 40 in the last day.")
        XCTAssertEqual(PhotoReadingWords.rows(r)[4], "250 are with the reader now.")
    }

    func testStalledListsReasonsBeforeLines() throws {
        let r = try XCTUnwrap(reading(stalledJSON))
        XCTAssertEqual(PhotoReadingWords.tone(r), .stalled)
        XCTAssertTrue(PhotoReadingWords.leads(r))
        XCTAssertEqual(PhotoReadingWords.headline(r), "Photo reading has stalled")
        XCTAssertEqual(PhotoReadingWords.summary(r), r.reasons?.first)
        XCTAssertEqual(PhotoReadingWords.rows(r), [
            "The reader on the Mac has not checked in for about 3 hours. It runs only while the Mac is awake and signed in.",
            "The job that lines photos up last ran about 2 hours ago.",
            "250 are with the reader now.",
        ])
    }

    func testAStallIsNeverSilent() {
        // A stalled answer that lost its headline and summary still says so, and leads with its first reason.
        let bare = PhotoReadingStatus(state: "stalled", reasons: ["The reading subscription is out of usage for now; reading resumes when it resets."])
        XCTAssertEqual(PhotoReadingWords.headline(bare), "Photo reading has stalled")
        XCTAssertEqual(PhotoReadingWords.summary(bare), "The reading subscription is out of usage for now; reading resumes when it resets.")
        XCTAssertEqual(PhotoReadingWords.headline(PhotoReadingStatus(state: "moving")), "Reading your photos")
        XCTAssertEqual(PhotoReadingWords.collapsed(PhotoReadingStatus(state: "moving")), "Reading your photos")
    }

    func testIdleAndOffKeepTheirWordsButDoNotLead() {
        let idle = PhotoReadingStatus(state: "idle", headline: "Photo reading is waiting", summary: "Nothing waiting right now",
                                      reasons: [], lines: ["The whole library has been looked at once as of Jan 9."])
        XCTAssertEqual(PhotoReadingWords.tone(idle), .idle)
        XCTAssertFalse(PhotoReadingWords.leads(idle))
        XCTAssertEqual(PhotoReadingWords.headline(idle), "Photo reading is waiting")
        XCTAssertEqual(PhotoReadingWords.rows(idle), ["The whole library has been looked at once as of Jan 9."])

        let off = PhotoReadingStatus(state: "off", headline: "Photo reading is not switched on for this account")
        XCTAssertEqual(PhotoReadingWords.tone(off), .off)
        XCTAssertFalse(PhotoReadingWords.leads(off))
        XCTAssertEqual(PhotoReadingWords.collapsed(off), "Photo reading is not switched on for this account")
        XCTAssertNil(PhotoReadingWords.headline(PhotoReadingStatus(state: "idle")))
        XCTAssertNil(PhotoReadingWords.headline(PhotoReadingStatus(state: "off")))
    }

    func testAbsentSaysNothing() {
        XCTAssertNil(PhotoReadingWords.headline(nil))
        XCTAssertNil(PhotoReadingWords.summary(nil))
        XCTAssertNil(PhotoReadingWords.collapsed(nil))
        XCTAssertEqual(PhotoReadingWords.rows(nil), [])
        XCTAssertNil(PhotoReadingWords.checkedAgo(nil, now: Date()))
        // Sentences without a state are not a reading.
        let stateless = PhotoReadingStatus(headline: "Reading your photos", summary: "12 read in the last hour",
                                           reasons: ["A reason."], lines: ["A line."])
        XCTAssertEqual(PhotoReadingWords.tone(stateless), .absent)
        XCTAssertNil(PhotoReadingWords.collapsed(stateless))
        XCTAssertEqual(PhotoReadingWords.rows(stateless), [])
    }

    func testBlankSentencesAreDropped() {
        let r = PhotoReadingStatus(state: "moving", headline: "  ", summary: "", reasons: [" "], lines: ["", "One line.", "  "])
        XCTAssertEqual(PhotoReadingWords.headline(r), "Reading your photos")
        XCTAssertNil(PhotoReadingWords.summary(r))
        XCTAssertEqual(PhotoReadingWords.rows(r), ["One line."])
    }

    // MARK: The "checked" clock

    func testCheckedAgoAppearsOnlyAfterTenMinutes() throws {
        let r = try XCTUnwrap(reading(movingJSON))      // as of 20:00:00 UTC, with microseconds
        XCTAssertNil(PhotoReadingWords.checkedAgo(r, now: clock("2026-01-15T20:00:30Z")))
        XCTAssertNil(PhotoReadingWords.checkedAgo(r, now: clock("2026-01-15T20:09:59Z")))
        XCTAssertEqual(PhotoReadingWords.checkedAgo(r, now: clock("2026-01-15T20:14:30Z")), "Checked 14 min ago")
        XCTAssertEqual(PhotoReadingWords.checkedAgo(r, now: clock("2026-01-15T23:05:00Z")), "Checked 3 h ago")
        XCTAssertEqual(PhotoReadingWords.checkedAgo(r, now: clock("2026-01-18T20:30:00Z")), "Checked 3 days ago")
        // A phone clock behind the server's never reads as stale.
        XCTAssertNil(PhotoReadingWords.checkedAgo(r, now: clock("2026-01-15T19:00:00Z")))
    }

    func testCheckedAgoNeedsAReadableClock() {
        XCTAssertNil(PhotoReadingWords.checkedAgo(PhotoReadingStatus(state: "moving"), now: Date()))
        XCTAssertNil(PhotoReadingWords.checkedAgo(PhotoReadingStatus(as_of: "yesterday", state: "moving"), now: Date()))
    }

    // MARK: Bar visibility

    func testBarIsHiddenUnlessThereArePhotosOrReadingLeads() throws {
        let moving = try XCTUnwrap(reading(movingJSON))
        let stalled = try XCTUnwrap(reading(stalledJSON))
        let idle = PhotoReadingStatus(state: "idle", headline: "Photo reading is waiting")
        let off = PhotoReadingStatus(state: "off", headline: "Photo reading is not switched on for this account")
        // No photos in this session: only a moving or stalled reading brings the bar up.
        XCTAssertFalse(PhotoReadingWords.barIsHidden(hasRows: false, reading: moving))
        XCTAssertFalse(PhotoReadingWords.barIsHidden(hasRows: false, reading: stalled))
        XCTAssertTrue(PhotoReadingWords.barIsHidden(hasRows: false, reading: idle))
        XCTAssertTrue(PhotoReadingWords.barIsHidden(hasRows: false, reading: off))
        XCTAssertTrue(PhotoReadingWords.barIsHidden(hasRows: false, reading: nil))
        XCTAssertTrue(PhotoReadingWords.barIsHidden(hasRows: false, reading: PhotoReadingStatus()))
        // With photos it shows as it always has, whatever the reading says.
        XCTAssertFalse(PhotoReadingWords.barIsHidden(hasRows: true, reading: nil))
        XCTAssertFalse(PhotoReadingWords.barIsHidden(hasRows: true, reading: idle))
        XCTAssertFalse(PhotoReadingWords.barIsHidden(hasRows: true, reading: off))
        XCTAssertFalse(PhotoReadingWords.barIsHidden(hasRows: true, reading: stalled))
    }

    @MainActor
    func testAStoreThatNeverRanHasNoReadingAndStaysHidden() {
        let store = CaptureIngestStore()
        XCTAssertNil(store.reading)
        XCTAssertTrue(store.rows.isEmpty)
        XCTAssertTrue(store.isHidden)
    }

    // MARK: Refresh back-off

    func testWaitDoublesAfterAFailureAndReturnsOnSuccess() {
        XCTAssertEqual(PhotoReadingReader.interval, 120)
        XCTAssertEqual(PhotoReadingReader.longestWait, 600)
        var wait = PhotoReadingReader.interval
        var waits: [TimeInterval] = []
        for _ in 0..<5 {
            wait = PhotoReadingReader.nextWait(after: wait, succeeded: false)
            waits.append(wait)
        }
        XCTAssertEqual(waits, [240, 480, 600, 600, 600])
        XCTAssertEqual(PhotoReadingReader.nextWait(after: wait, succeeded: true), 120)
        XCTAssertEqual(PhotoReadingReader.nextWait(after: 120, succeeded: true), 120)
    }

    func testTheReaderIsCalledByItsOneName() {
        XCTAssertEqual(PhotoReadingReader.functionName, "photo_reading_status")
    }
}
