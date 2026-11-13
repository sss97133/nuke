// GarageActivityWorkTests.swift — job updates in the garage feed come from the job's own activity
// reader at the event's own clock; evidence photos are left to the photo source.

import XCTest
@testable import NukeCapture

final class GarageActivityWorkTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_793_742_000)   // 2026-11-03 21:40 UTC
    private let vehicleId = "00000000-0000-4000-8000-0000000000a1"

    private func order(_ vehicle: String?) throws -> JobRow {
        let v = vehicle.map { #""vehicle_id":"\#($0)","# } ?? ""
        let json = #"{"work_order_id":"00000000-0000-4000-8000-0000000000b1",\#(v)"title":"Paint job","slots":["customer"],"stage_states":{}}"#
        return try JobReaders.decode(JobRow.self, from: Data(json.utf8))
    }

    private let feedJSON = """
    {"work_order_id":"00000000-0000-4000-8000-0000000000b1","as_of":"2026-11-03T21:40:00+00:00",
     "events":[
      {"kind":"evidence","ref_id":"e1","at":"2026-11-03T21:00:00+00:00","recorded_at":"2026-11-03T21:00:01+00:00","basis":"authenticated_sign","role":"accepted_provider","title":"2 photos added"},
      {"kind":"work_started","ref_id":"w1","at":"2026-11-03T18:00:00+00:00","recorded_at":"2026-11-03T18:00:05+00:00","basis":"authenticated_sign","role":"accepted_provider","title":"Paint job moved to In progress"},
      {"kind":"status_changed","ref_id":"s1","at":"2026-11-03T23:30:00+00:00","recorded_at":"2026-11-03T23:30:00+00:00","basis":"record","title":"Clock is ahead"},
      {"kind":"quote","ref_id":"q1","at":"not a clock","recorded_at":"2026-11-02T18:00:05+00:00","basis":"record","title":"Quote sent"}
     ],
     "live":{"latest_at":"2026-11-03T21:00:00+00:00","events_total":4,"version":"v","phase":"in_progress","poll_after_seconds":15},
     "viewer":{"party":true}}
    """

    func testJobEventsKeepTheirOwnClockAndSkipEvidenceFutureAndUnreadableClocks() throws {
        let vehicle = GarageVehicle(vehicle_id: vehicleId, year: 1967, make: "Ford", model: "Mustang", trim_name: nil, image_url: nil,
                                    current_value: nil, image_count: 0, relationship: "owner")
        let activity = try JobReaders.decode(JobActivity.self, from: Data(feedJSON.utf8))
        let events = GarageActivityBuild.jobEvents(workOrder: try order(vehicleId), activity: activity,
                                                   vehicles: GarageActivityVehicles([vehicle]), now: now)
        XCTAssertEqual(events.map(\.headline), ["Paint job moved to In progress"])
        XCTAssertEqual(events.first?.kind, .work)
        XCTAssertEqual(events.first?.vehicleTitle, "1967 Ford Mustang")
        XCTAssertEqual(events.first?.at, ISO8601DateFormatter().date(from: "2026-11-03T18:00:00+00:00"))
        XCTAssertEqual(events.first?.detail, "Paint job · Provider")
    }

    func testAJobWithNoVehicleIsNotTiedToTheGarage() throws {
        let activity = try JobReaders.decode(JobActivity.self, from: Data(feedJSON.utf8))
        XCTAssertTrue(GarageActivityBuild.jobEvents(workOrder: try order(nil), activity: activity,
                                                    vehicles: GarageActivityVehicles([]), now: now).isEmpty)
    }
}
