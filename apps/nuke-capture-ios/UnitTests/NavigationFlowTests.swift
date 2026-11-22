import XCTest
import Combine
@testable import NukeCapture

@MainActor
final class NavigationFlowTests: XCTestCase {
    private func refusal(_ reader: String) -> JobRefusal {
        JobRefusal(reader: reader, kind: .failed, title: reader, detail: "Controlled test response")
    }

    private func reads() -> WorkConsoleReader.Reads {
        WorkConsoleReader.Reads(
            signatures: { .refused(self.refusal("signatures")) },
            jobs: { _ in .refused(self.refusal("jobs")) },
            identity: { .refused(self.refusal("identity")) },
            inbox: { .refused(self.refusal("inbox")) },
            open: { .refused(self.refusal("open")) },
            notifications: { .refused(self.refusal("notifications")) },
            listings: { .refused(self.refusal("listings")) })
    }

    private func page(_ clock: String, next: String? = nil) throws -> MyWorkOrders {
        let data = try JSONSerialization.data(withJSONObject: ["rows": [], "as_of": clock, "next_after": next as Any? ?? NSNull()])
        return try JobReaders.decode(MyWorkOrders.self, from: data)
    }

    func testAccountSwitchDiscardsOldListingResult() async throws {
        let started = expectation(description: "listing read started")
        let gate = ControlledRead<JobLoad<ListingSubmissionPage>> { _ in started.fulfill() }
        var sources = reads()
        sources.listings = { await gate.next() }
        var account = "first"
        let reader = WorkConsoleReader(reads: sources, account: { account })
        let loading = Task { await reader.loadListings() }
        await fulfillment(of: [started], timeout: 3)
        account = "second"
        gate.finish(0, with: .loaded(ListingSubmissionPage(rows: [], total: 0)))
        await loading.value
        if case .loading = reader.listings {} else { XCTFail("old account listing must not publish") }
    }

    func testJobsPublishWhileSignatureReaderIsStillWaiting() async throws {
        let signatureStarted = expectation(description: "signature request started")
        let jobsPublished = expectation(description: "jobs published independently")
        let gate = ControlledRead<JobLoad<SignatureQueue>> { _ in signatureStarted.fulfill() }
        var sources = reads()
        let ready = try page("current")
        sources.signatures = { await gate.next() }
        sources.jobs = { _ in .loaded(ready) }
        let reader = WorkConsoleReader(reads: sources, account: { "test-account" })
        let observer = reader.$jobs.sink { if case .loaded = $0 { jobsPublished.fulfill() } }
        let loading = Task { await reader.load() }
        await fulfillment(of: [signatureStarted, jobsPublished], timeout: 3)
        if case .loading = reader.signatures {} else { XCTFail("signature source must still be waiting") }
        gate.finish(0, with: .refused(refusal("signature finished")))
        await loading.value
        observer.cancel()
    }

    func testAnOlderInboxResponseCannotReplaceARefresh() async {
        let firstStarted = expectation(description: "first request")
        let secondStarted = expectation(description: "refresh request")
        let gate = ControlledRead<JobLoad<ContactInbox>> { i in
            if i == 0 { firstStarted.fulfill() } else { secondStarted.fulfill() }
        }
        var sources = reads()
        sources.inbox = { await gate.next() }
        let reader = WorkConsoleReader(reads: sources, account: { "test-account" })
        let first = Task { await reader.loadInbox() }
        await fulfillment(of: [firstStarted], timeout: 3)
        let second = Task { await reader.loadInbox() }
        await fulfillment(of: [secondStarted], timeout: 3)
        let fresh = refusal("fresh response")
        gate.finish(1, with: .refused(fresh))
        await second.value
        gate.finish(0, with: .refused(refusal("old response")))
        await first.value
        if case .refused(let result) = reader.inbox { XCTAssertEqual(result, fresh) }
        else { XCTFail("refresh result must remain") }
    }

    func testLateResponseForAnotherAccountIsNotPublished() async {
        let started = expectation(description: "account A request")
        let gate = ControlledRead<JobLoad<ContactInbox>> { _ in started.fulfill() }
        var sources = reads()
        sources.inbox = { await gate.next() }
        var account = "account-A"
        let reader = WorkConsoleReader(reads: sources, account: { account })
        let loading = Task { await reader.loadInbox() }
        await fulfillment(of: [started], timeout: 3)
        account = "account-B"
        gate.finish(0, with: .refused(refusal("account A response")))
        await loading.value
        if case .loading = reader.inbox {} else { XCTFail("another account's response leaked into the screen") }
    }

    func testARefreshSupersedesAnInFlightJobPage() async throws {
        let started = expectation(description: "old next page requested")
        let gate = ControlledRead<JobLoad<MyWorkOrders>> { _ in started.fulfill() }
        let original = try page("original", next: "page-2")
        let refreshed = try page("refreshed")
        var starts = 0
        var sources = reads()
        sources.jobs = { after in
            if after != nil { return await gate.next() }
            starts += 1
            return .loaded(starts == 1 ? original : refreshed)
        }
        let reader = WorkConsoleReader(reads: sources, account: { "test-account" })
        await reader.loadJobs()
        let loadingMore = Task { await reader.loadMoreJobs() }
        await fulfillment(of: [started], timeout: 3)
        await reader.loadJobs()
        gate.finish(0, with: .loaded(try page("stale page")))
        await loadingMore.value
        if case .loaded(let result) = reader.jobs { XCTAssertEqual(result.asOf, "refreshed"); XCTAssertNil(result.nextAfter) }
        else { XCTFail("refreshed page must remain") }
        XCTAssertFalse(reader.loadingMore)
    }

    func testFailedPaginationKeepsThePageAndReportsTheFailure() async throws {
        let original = try page("original", next: "page-2")
        let failure = refusal("next page failed")
        var sources = reads()
        sources.jobs = { after in after == nil ? .loaded(original) : .refused(failure) }
        let reader = WorkConsoleReader(reads: sources, account: { "test-account" })
        await reader.loadJobs()
        await reader.loadMoreJobs()
        if case .loaded(let result) = reader.jobs { XCTAssertEqual(result, original) }
        else { XCTFail("failed pagination discarded the existing page") }
        XCTAssertEqual(reader.jobsPageFailure, failure)
        XCTAssertFalse(reader.loadingMore)
    }

    func testReturningToWorkRefreshesLoadedDepthAndStopsAtTheCurrentEnd() async throws {
        let first = try page("first", next: "page-2")
        let oldSecond = try page("old second")
        let freshSecond = try page("fresh second")
        var cursors: [String?] = []
        var secondReads = 0
        var fewerPages = false
        let currentEnd = try page("current end")
        var sources = reads()
        sources.jobs = { after in
            cursors.append(after)
            if after == nil { return .loaded(fewerPages ? currentEnd : first) }
            secondReads += 1
            return .loaded(secondReads == 1 ? oldSecond : freshSecond)
        }
        let reader = WorkConsoleReader(reads: sources, account: { "test-account" })
        await reader.loadJobs()
        await reader.loadMoreJobs()
        await reader.load()
        XCTAssertEqual(cursors, [nil, "page-2", nil, "page-2"])
        if case .loaded(let page) = reader.jobs { XCTAssertEqual(page.asOf, "fresh second") }
        else { XCTFail("the refreshed loaded window must publish") }
        fewerPages = true
        await reader.loadJobs()
        fewerPages = false
        await reader.load()
        XCTAssertEqual(cursors, [nil, "page-2", nil, "page-2", nil, nil])
    }

    func testFailedDepthRefreshReportsFailureAndRetriesTheSameWindow() async throws {
        let first = try page("first", next: "page-2")
        let second = try page("second")
        let failure = refusal("return page failed")
        var cursors: [String?] = []
        var failSecond = false
        var sources = reads()
        sources.jobs = { after in
            cursors.append(after)
            if after == nil { return .loaded(first) }
            return failSecond ? .refused(failure) : .loaded(second)
        }
        let reader = WorkConsoleReader(reads: sources, account: { "test-account" })
        await reader.loadJobs()
        await reader.loadMoreJobs()
        failSecond = true
        await reader.loadJobs()
        if case .refused(let result) = reader.jobs { XCTAssertEqual(result, failure) }
        else { XCTFail("a partial refresh must not publish as a complete or empty window") }
        failSecond = false
        await reader.loadJobs()
        XCTAssertEqual(cursors, [nil, "page-2", nil, "page-2", nil, "page-2"])
        if case .loaded(let result) = reader.jobs { XCTAssertEqual(result.asOf, "second") }
        else { XCTFail("retry must restore the same loaded scope") }
        XCTAssertFalse(reader.loadingJobs)
    }

    func testNewRefreshDiscardsTheOldDepthRefreshSecondPage() async throws {
        let started = expectation(description: "return refresh second page started")
        let gate = ControlledRead<JobLoad<MyWorkOrders>> { _ in started.fulfill() }
        let first = try page("first", next: "page-2")
        let second = try page("second")
        let newest = try page("newest")
        var starts = 0
        var secondReads = 0
        var sources = reads()
        sources.jobs = { after in
            if after == nil {
                starts += 1
                return .loaded(starts < 3 ? first : newest)
            }
            secondReads += 1
            return secondReads == 1 ? .loaded(second) : await gate.next()
        }
        let reader = WorkConsoleReader(reads: sources, account: { "test-account" })
        await reader.loadJobs()
        await reader.loadMoreJobs()
        let returning = Task { await reader.loadJobs() }
        await fulfillment(of: [started], timeout: 3)
        await reader.loadJobs()
        gate.finish(0, with: .loaded(try page("stale second")))
        await returning.value
        if case .loaded(let page) = reader.jobs { XCTAssertEqual(page.asOf, "newest") }
        else { XCTFail("late return response must not overwrite the newer refresh") }
        XCTAssertFalse(reader.loadingJobs)
    }

    func testQueryReturningToTheSameTextDoesNotReviveAnOlderRequest() {
        var requests = ReadRequestGuard()
        let old = requests.begin()
        let otherQuery = requests.begin()
        let repeatedQuery = requests.begin()
        XCTAssertFalse(requests.isCurrent(old))
        XCTAssertFalse(requests.isCurrent(otherQuery))
        XCTAssertTrue(requests.isCurrent(repeatedQuery))
    }

    func testLosingPhotoAccessLeavesAReachableTabWithoutMovingOtherTabs() {
        XCTAssertEqual(MainTabView.availableTab(.library, signedIn: true, fullAccess: false), .profile)
        XCTAssertEqual(MainTabView.availableTab(.today, signedIn: true, fullAccess: false), .today)
        XCTAssertEqual(MainTabView.availableTab(.explore, signedIn: true, fullAccess: false), .explore)
        XCTAssertEqual(MainTabView.availableTab(.library, signedIn: false, fullAccess: false), .explore)
        XCTAssertEqual(MainTabView.availableTab(.today, signedIn: false, fullAccess: false), .explore)
        XCTAssertEqual(MainTabView.availableTab(.garage, signedIn: true, fullAccess: false), .garage)
        XCTAssertEqual(MainTabView.availableTab(.garage, signedIn: false, fullAccess: false), .explore)
    }

    func testGarageFindsAnExistingZeroPhotoProfileByVehicleNotVINWithoutClaimingOwnership() {
        let record = GarageVehicle(vehicle_id: "test-record", year: 1973, make: "Pontiac", model: "Firebird",
                                   trim_name: nil, image_url: nil, current_value: nil, image_count: 0,
                                   relationship: "profile_record", vin: "TEST1234567")
        let unrelated = GarageVehicle(vehicle_id: "other-record", year: 1973, make: "Fixture", model: "Coupe",
                                      trim_name: nil, image_url: nil, current_value: nil, image_count: 0, relationship: "contributor")
        let rows = [unrelated, record]
        XCTAssertEqual(GarageSections.matching(rows, query: "1973 firebird").map(\.id), [record.id])
        XCTAssertTrue(GarageSections.matching(rows, query: "1234567").isEmpty, "the garage is not searched by VIN")
        XCTAssertTrue(GarageSections.matching(rows, query: "1973 mustang").isEmpty)
        XCTAssertEqual(GarageSections.matching(rows, query: "  ").map(\.id), rows.map(\.id))
        XCTAssertFalse(GarageRelation.isOwned(record))
    }
}

@MainActor
private final class ControlledRead<Value> {
    private var nextID = 0
    private var waiting: [Int: CheckedContinuation<Value, Never>] = [:]
    private let started: (Int) -> Void
    init(started: @escaping (Int) -> Void) { self.started = started }
    func next() async -> Value {
        await withCheckedContinuation { continuation in
            let id = nextID
            nextID += 1
            waiting[id] = continuation
            started(id)
        }
    }
    func finish(_ id: Int, with value: Value) { waiting.removeValue(forKey: id)!.resume(returning: value) }
}
