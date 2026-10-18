import XCTest
import GRDB
#if canImport(NukeCapture)
@testable import NukeCapture
#else
@testable import NukeAlbumLedger
#endif

final class SubjectProfileTests: XCTestCase {
    private let subjectOwner = "11111111-1111-4111-8111-111111111111"
    private let otherSubjectOwner = "22222222-2222-4222-8222-222222222222"
    private func subjectRead() throws -> ObservedCarRead {
        try JSONDecoder().decode(ObservedCarRead.self, from: Data(#"{"subjects":[{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","label":"Observed coupe","identity_status":"unresolved","image_count":2,"cover_image_url":"https://example.test/one.jpg","observed_at":"2026-10-18T01:00:00Z","images":[{"id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","image_url":"https://example.test/one.jpg","taken_at":null}],"asserted_identity":{"make":"Porsche"},"coverage":{"assessed":3,"eligible":2,"excluded":1,"as_of":"2026-10-18T01:00:00.123456Z","truncated":true}}],"coverage":{"assessed":3,"eligible":2,"excluded":1,"as_of":"2026-10-18T01:00:00Z","truncated":true},"next_offset":24}"#.utf8))
    }

    func testObservedSubjectDecodePreservesUnknownIdentityAndBoundedPhotoCoverage() throws {
        let read = try subjectRead()
        XCTAssertTrue(read.isQualified)
        XCTAssertEqual(read.subjects[0].asserted_identity.labels, ["Porsche"])
        XCTAssertEqual(read.subjects[0].identity_status, "unresolved")
        XCTAssertNil(read.subjects[0].images[0].taken_at)
        XCTAssertEqual(read.subjects[0].image_count, 2)
        XCTAssertEqual(read.subjects[0].images.count, 1)
        XCTAssertTrue(read.coverage.truncated)
        XCTAssertNotNil(read.subjects[0].coverage.clock)
        XCTAssertEqual(read.next_offset, 24)
    }

    func testObservedSubjectCacheIsOwnAccountOnlyAndPreservesExactBackendProjection() throws {
        let store = try LocalStore(databaseQueue: DatabaseQueue()), read = try subjectRead()
        let now = Date(timeIntervalSince1970: 1000)
        try store.cacheObservedCars(userId: subjectOwner.uppercased(), activeUserId: subjectOwner, read: read, now: now)
        let saved = try XCTUnwrap(store.cachedObservedCars(userId: subjectOwner, activeUserId: subjectOwner))
        XCTAssertEqual(saved.read, read)
        XCTAssertEqual(saved.cachedAt, now)
        XCTAssertNil(try store.cachedObservedCars(userId: subjectOwner, activeUserId: nil))
        XCTAssertNil(try store.cachedObservedCars(userId: subjectOwner, activeUserId: otherSubjectOwner))
        XCTAssertNil(try store.cachedObservedCars(userId: otherSubjectOwner, activeUserId: otherSubjectOwner))
        XCTAssertThrowsError(try store.cacheObservedCars(userId: subjectOwner, activeUserId: otherSubjectOwner, read: read))
        XCTAssertThrowsError(try store.cacheObservedCars(userId: subjectOwner, activeUserId: nil, read: read))
        XCTAssertNil(ObservedCarRead.ownAccount("sample-profile", activeUserId: "sample-profile"))
    }

    func testFreshObservedSubjectReadClearsWithdrawnPagesAndKeepsDetailScopeSeparate() throws {
        let store = try LocalStore(databaseQueue: DatabaseQueue()), read = try subjectRead(), subject = read.subjects[0].id
        try store.cacheObservedCars(userId: subjectOwner, activeUserId: subjectOwner, read: read)
        let continuation = ObservedCarRead(subjects: read.subjects, coverage: read.coverage, next_offset: nil)
        try store.cacheObservedCars(userId: subjectOwner, activeUserId: subjectOwner, offset: 24, read: continuation)
        XCTAssertThrowsError(try store.cacheObservedCars(userId: subjectOwner, activeUserId: subjectOwner, offset: 24, read: read))
        try store.cacheObservedCars(userId: subjectOwner, activeUserId: subjectOwner, clusterId: subject, read: read)
        let empty = ObservedCarRead(subjects: [], coverage: read.coverage, next_offset: nil)
        try store.cacheObservedCars(userId: subjectOwner, activeUserId: subjectOwner, read: empty)
        XCTAssertEqual(try store.cachedObservedCars(userId: subjectOwner, activeUserId: subjectOwner)?.read.subjects, [])
        XCTAssertNil(try store.cachedObservedCars(userId: subjectOwner, activeUserId: subjectOwner, offset: 24))
        XCTAssertEqual(try store.cachedObservedCars(userId: subjectOwner, activeUserId: subjectOwner, clusterId: subject)?.read, read)
        XCTAssertThrowsError(try store.cacheObservedCars(userId: subjectOwner, activeUserId: subjectOwner, clusterId: UUID(), read: read))
        try store.cacheObservedCars(userId: subjectOwner, activeUserId: subjectOwner, clusterId: subject, read: empty)
        XCTAssertEqual(try store.cachedObservedCars(userId: subjectOwner, activeUserId: subjectOwner, clusterId: subject)?.read.subjects, [])
    }

}
