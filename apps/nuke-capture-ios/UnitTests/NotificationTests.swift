// NotificationTests.swift — user_notifications decoding, which screen each row opens, the Work
// badge and the plain words. No test calls mark_notification_read, mark_all_notifications_read
// or any other writer.

import XCTest
import Supabase
@testable import NukeCapture

final class NotificationTests: XCTestCase {
    private func page() throws -> NotificationPage {
        try NotificationPage.decode(Data(NotificationFixtures.page.utf8), total: 20, unread: 3, limit: 50)
    }

    private func row(_ json: String) throws -> UserNotification {
        try JSONDecoder().decode(UserNotification.self, from: Data(json.utf8))
    }

    func testPageDecodesLiveShapesAndCountsUnreadableRows() throws {
        let p = try page()
        XCTAssertEqual(p.rows.count, 5)
        XCTAssertEqual(p.unreadableRows, 1)                      // the row without an id is counted, not shown
        XCTAssertEqual(p.unread, 3)
        XCTAssertEqual(p.coverage, "Latest 5 of 20 notifications.")
        XCTAssertEqual(p.rows[0].kind, "profile_import_ready")
        XCTAssertFalse(p.rows[0].isRead)
        XCTAssertEqual(p.rows[1].kind, "vehicle_merged")          // notification_type null: the type column (web coalesce)
        XCTAssertTrue(p.rows[1].isRead)
        XCTAssertEqual(p.rows[1].readAt, "2026-01-12T08:00:00+00:00")
        XCTAssertEqual(p.rows[4].organizationId, NotificationFixtures.organizationId)
        XCTAssertEqual(p.rows[3].metadata["event"]?.stringValue, "comp_found")
        XCTAssertNil(try row(NotificationFixtures.row()).message)
    }

    func testCoverageSentences() {
        XCTAssertEqual(NotificationPage(rows: [], total: nil, unread: nil, limit: 50).coverage, "Latest 0 shown. Total not available.")
        let one = try? row(NotificationFixtures.row())
        XCTAssertEqual(NotificationPage(rows: [one!], total: 1, unread: 1, limit: 50).coverage, "1 notification.")
    }

    func testEachLiveShapeOpensItsScreen() throws {
        let p = try page()
        XCTAssertEqual(p.rows[0].route, .web(URL(string: "https://nuke.ag/claim-identity?platform=bat&handle=fixture_handle")!))
        XCTAssertEqual(p.rows[1].route, .vehicle(id: NotificationFixtures.mergedVehicleId))
        XCTAssertEqual(p.rows[2].route, .none)                    // the web follows action_url, not metadata.action_url
        XCTAssertEqual(p.rows[3].route, .vehicle(id: NotificationFixtures.vehicleId))
        XCTAssertEqual(p.rows[4].route, .organization(id: NotificationFixtures.organizationId))
        XCTAssertEqual(try row(NotificationFixtures.paymentReceived).route, .none)   // link_url in metadata: no route on the web either
        XCTAssertEqual(try row(NotificationFixtures.paymentReceived).kind, "payment_received")
    }

    func testRouteOrder() throws {
        let job = NotificationFixtures.row(actionUrl: "/vehicle/\(NotificationFixtures.vehicleId)",
                                           metadata: #"{"work_order_id":"\#(NotificationFixtures.workOrderId)"}"#)
        XCTAssertEqual(try row(job).route, .job(workOrderId: NotificationFixtures.workOrderId))
        let thread = NotificationFixtures.row(metadata: #"{"contact_request_id":"\#(NotificationFixtures.contactRequestId)","work_order_id":"\#(NotificationFixtures.workOrderId)"}"#)
        XCTAssertEqual(try row(thread).route, .contactThread(requestId: NotificationFixtures.contactRequestId))
        let placeholder = NotificationFixtures.row(metadata: #"{"work_order_id":"not an id"}"#)
        XCTAssertEqual(try row(placeholder).route, .none)
        let byColumn = NotificationFixtures.row(vehicleId: NotificationFixtures.vehicleId, organizationId: NotificationFixtures.organizationId)
        XCTAssertEqual(try row(byColumn).route, .vehicle(id: NotificationFixtures.vehicleId))
        let foreign = NotificationFixtures.row(actionUrl: "https://example.invalid/x", organizationId: NotificationFixtures.organizationId)
        XCTAssertEqual(try row(foreign).route, .organization(id: NotificationFixtures.organizationId))
    }

    func testWebPaths() {
        let v = NotificationFixtures.vehicleId, o = NotificationFixtures.organizationId
        XCTAssertEqual(NotificationRoute.path("/vehicle/\(v)/work"), .vehicle(id: v))
        XCTAssertEqual(NotificationRoute.path("/vehicles/\(v)"), .vehicle(id: v))
        XCTAssertEqual(NotificationRoute.path("/org/\(o)"), .organization(id: o))
        XCTAssertEqual(NotificationRoute.path("/organization/\(o)"), .organization(id: o))
        XCTAssertEqual(NotificationRoute.path("https://www.nuke.ag/vehicle/\(v)"), .vehicle(id: v))
        XCTAssertEqual(NotificationRoute.path("/vehicle/list"), .web(URL(string: "https://nuke.ag/vehicle/list")!))
        XCTAssertEqual(NotificationRoute.path("/wallet"), .web(URL(string: "https://nuke.ag/wallet")!))
        XCTAssertEqual(NotificationRoute.path("//example.invalid/x"), .none)
        XCTAssertEqual(NotificationRoute.path("http://nuke.ag/wallet"), .none)
        XCTAssertEqual(NotificationRoute.path("https://example.invalid/vehicle/\(v)"), .none)
        XCTAssertEqual(NotificationRoute.path("javascript:alert(1)"), .none)
    }

    func testBadgeAddsOnlyStatedParts() throws {
        XCTAssertEqual(InboxBadgeStore.badge(unread: nil, toSign: nil), 0)
        XCTAssertEqual(InboxBadgeStore.badge(unread: 2, toSign: nil), 2)
        XCTAssertEqual(InboxBadgeStore.badge(unread: 2, toSign: 3), 5)
        XCTAssertEqual(InboxBadgeStore.badge(unread: -1, toSign: 0), 0)
        let q = try JobReaders.decode(SignatureQueue.self, from: Data(JobFixtures.signatureQueue.utf8))
        XCTAssertEqual(InboxBadgeStore.toSign(.loaded(q)), 7)    // the queue's stated total, not the rows returned
        XCTAssertNil(InboxBadgeStore.toSign(.refused(JobReaders.pending(JobReaders.signatureQueueName))))
        XCTAssertNil(InboxBadgeStore.toSign(.loading))
    }

    func testWords() {
        XCTAssertEqual(NotificationCopy.header(nil), "Notifications")
        XCTAssertEqual(NotificationCopy.header(0), "Notifications")
        XCTAssertEqual(NotificationCopy.header(4), "Notifications · 4 unread")
        XCTAssertEqual(NotificationCopy.markedAll(1), "Marked 1 notification read.")
        XCTAssertEqual(NotificationCopy.markedAll(3), "Marked 3 notifications read.")
        XCTAssertEqual(NotificationCopy.kind("vin_needed"), "VIN needed")
        XCTAssertEqual(NotificationCopy.opens(.vehicle(id: "x")), "Opens the vehicle")
        XCTAssertNil(NotificationCopy.opens(.none))
        XCTAssertEqual(NotificationCopy.failure(PostgrestError(code: "42501",
                       message: "mark_notification_read: you can only mark your own notifications")),
                       "The server didn't recognize this account. Sign in again.")
    }
}
