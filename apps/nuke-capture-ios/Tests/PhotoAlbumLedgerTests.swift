import XCTest
import GRDB
@testable import NukeAlbumLedger

final class PhotoAlbumLedgerTests: XCTestCase {
    private let method = "synthetic-method-v1"
    private let photo = LocalAlbumPhoto(localIdentifier: "synthetic-photo", sourceVersion: "source-v1")

    private func album(_ id: String = "synthetic-album", name: String = "Human grouping", photos: [LocalAlbumPhoto]? = nil) -> LocalPhotoAlbum {
        LocalPhotoAlbum(id: id, name: name, folderPath: ["Work"], sourceKind: "regular", photos: photos ?? [photo])
    }

    private func review(_ photo: LocalAlbumPhoto, method: String? = nil, id: String = UUID().uuidString, vehicle: Bool = true) -> LocalAlbumImageReview {
        LocalAlbumImageReview(id: id, localIdentifier: photo.localIdentifier, sourceVersion: photo.sourceVersion,
            inputSHA256: "synthetic-content-sha", methodVersion: method ?? self.method, analyzedAt: Date(),
            isVehicle: vehicle, hasPerson: false, labelsJSON: "[\"car\"]", vinCandidatesJSON: "[]", textLinesJSON: "[\"SYNTHETIC12345\"]")
    }

    func testHumanHistoryRetainsRenameMembershipChangesAndReturningState() throws {
        let queue = try DatabaseQueue()
        let store = try LocalStore(databaseQueue: queue)
        let first = LocalAlbumCatalog(accessScope: "full", observedAt: Date(), albums: [album()])
        try store.recordAlbumCatalog(first)
        try store.recordAlbumCatalog(first) // unchanged refresh does not duplicate the event
        let second = LocalAlbumCatalog(accessScope: "full", observedAt: Date(), albums: [album(name: "Renamed", photos: [])])
        try store.recordAlbumCatalog(second)
        try store.recordAlbumCatalog(first) // A → B → A is a new event, not ignored
        XCTAssertEqual(try store.latestAlbumCatalog()?.albums, first.albums)
        XCTAssertEqual(try queue.read { try Int.fetchOne($0, sql: "SELECT COUNT(*) FROM photo_album_catalog") }, 3)
        let payloads = try queue.read { try String.fetchAll($0, sql: "SELECT payload FROM photo_album_catalog ORDER BY rowid") }
        XCTAssertTrue(payloads[1].contains("Renamed"))
        XCTAssertTrue(payloads[0].contains("Human grouping"))
    }

    func testNativeOutboxRetriesIdenticalContentAndPreservesOrderedOfflineChanges() throws {
        let store = try LocalStore(databaseQueue: DatabaseQueue())
        func save(_ name: String) throws {
            try store.recordAlbumCatalog(LocalAlbumCatalog(accessScope: "full", observedAt: Date(), albums: [album(name: name)]))
        }
        try save("A")
        let first = try XCTUnwrap(store.nextNativeAlbumCapture(userId: "account-one"))
        XCTAssertEqual(try store.nextNativeAlbumCapture(userId: "account-one")?.payloadJSON, first.payloadJSON)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(first.payloadJSON.utf8)) as? [String: Any])
        XCTAssertTrue(json["previous_capture_id"] is NSNull)
        XCTAssertEqual(json.count, 7)
        try save("B")
        try save("A")
        // A landed response, rather than a network attempt, acknowledges this state.
        try store.acknowledgeNativeAlbumCapture(first, setId: "first-set", captureId: first.requestId)
        let second = try XCTUnwrap(store.nextNativeAlbumCapture(userId: "account-one"))
        XCTAssertTrue(second.payloadJSON.contains("\"name\":\"B\""))
        XCTAssertTrue(second.payloadJSON.contains(first.requestId))
        try store.acknowledgeNativeAlbumCapture(second, setId: "second-set", captureId: second.requestId)
        let third = try XCTUnwrap(store.nextNativeAlbumCapture(userId: "account-one"))
        XCTAssertTrue(third.payloadJSON.contains("\"name\":\"A\""))
        XCTAssertNotEqual(third.requestId, first.requestId)
        try store.acknowledgeNativeAlbumCapture(third, setId: "third-set", captureId: third.requestId)
        XCTAssertNil(try store.nextNativeAlbumCapture(userId: "account-one"))
        // A different account starts at the currently observed state, not B's history.
        let other = try XCTUnwrap(store.nextNativeAlbumCapture(userId: "account-two"))
        XCTAssertTrue(other.payloadJSON.contains("\"name\":\"A\""))
        XCTAssertFalse(other.payloadJSON.contains(third.requestId))
        XCTAssertTrue(other.payloadJSON.contains("\"previous_capture_id\":null"))
    }

    func testNativeOutboxLimitedAccessDoesNotDeleteAndFullRemovalAppendsTombstone() throws {
        let store = try LocalStore(databaseQueue: DatabaseQueue())
        try store.recordAlbumCatalog(LocalAlbumCatalog(accessScope: "full", observedAt: Date(), albums: [album()]))
        let first = try XCTUnwrap(store.nextNativeAlbumCapture(userId: "account"))
        try store.acknowledgeNativeAlbumCapture(first, setId: "set", captureId: first.requestId)
        try store.recordAlbumCatalog(LocalAlbumCatalog(accessScope: "limited", observedAt: Date(), albums: []))
        XCTAssertNil(try store.nextNativeAlbumCapture(userId: "account"))
        try store.recordAlbumCatalog(LocalAlbumCatalog(accessScope: "full", observedAt: Date(), albums: []))
        let removed = try XCTUnwrap(store.nextNativeAlbumCapture(userId: "account"))
        XCTAssertTrue(removed.payloadJSON.contains("\"present\":false"))
        XCTAssertTrue(removed.payloadJSON.contains("\"photos\":[]"))
        XCTAssertTrue(removed.payloadJSON.contains(first.requestId))
    }

    func testNativeOutboxDoesNotInventAnAlbumForUnorganizedPhotos() throws {
        let store = try LocalStore(databaseQueue: DatabaseQueue())
        try store.recordAlbumCatalog(LocalAlbumCatalog(accessScope: "full", observedAt: Date(), albums: [], photos: [photo]))
        XCTAssertNil(try store.nextNativeAlbumCapture(userId: "account"))
        XCTAssertEqual(try store.latestAlbumCatalog()?.photos, [photo])
    }

    func testNativeByteLinksRemainPendingOfflineAndExcludeStaleOrRejectedReads() throws {
        let store = try LocalStore(databaseQueue: DatabaseQueue())
        try store.recordAlbumCatalog(LocalAlbumCatalog(accessScope: "full", observedAt: Date(), albums: [album()]))
        let request = try XCTUnwrap(store.nextNativeAlbumCapture(userId: "account"))
        try store.acknowledgeNativeAlbumCapture(request, setId: "set", captureId: request.requestId)
        try store.recordAlbumImageReview(review(LocalAlbumPhoto(localIdentifier: photo.localIdentifier, sourceVersion: "old-version")))
        XCTAssertNil(try store.nextNativeAlbumLinks(userId: "account", methodVersion: method))
        try store.recordAlbumImageReview(review(photo))
        let first = try XCTUnwrap(store.nextNativeAlbumLinks(userId: "account", methodVersion: method))
        let retry = try XCTUnwrap(store.nextNativeAlbumLinks(userId: "account", methodVersion: method))
        XCTAssertEqual(first.witnesses.map(\.read_id), retry.witnesses.map(\.read_id))
        XCTAssertEqual(first.capture.requestId, request.requestId)
        XCTAssertNil(try store.nextNativeAlbumLinks(userId: "other-account", methodVersion: method))
        store.setOwnerVerdict([photo.localIdentifier], verdict: "rejected")
        XCTAssertNil(try store.nextNativeAlbumLinks(userId: "account", methodVersion: method))
        let encoded = String(decoding: try JSONEncoder().encode(first.witnesses), as: UTF8.self)
        XCTAssertFalse(encoded.contains("textLines"))
        XCTAssertFalse(encoded.contains("vinCandidates"))
    }

    func testOverlappingAlbumsKeepSeparateHumanMembershipsAndShareOneRead() throws {
        let store = try LocalStore(databaseQueue: DatabaseQueue())
        let first = album("one", name: "Owned")
        let second = album("two", name: "Customer work")
        try store.recordAlbumCatalog(LocalAlbumCatalog(accessScope: "full", observedAt: Date(), albums: [first, second]))
        try store.recordAlbumImageReview(review(photo))
        XCTAssertEqual(try store.latestAlbumCatalog()?.albums.count, 2)
        XCTAssertEqual(try store.albumCoverage(first, methodVersion: method).reviewed, 1)
        XCTAssertEqual(try store.albumCoverage(second, methodVersion: method).reviewed, 1)
    }

    func testExistingCloudAssignmentDoesNotConfirmAnAlbum() throws {
        let store = try LocalStore(databaseQueue: DatabaseQueue())
        store.cacheCloudVerdict(localIdentifier: photo.localIdentifier, narrative: "Synthetic cached opinion",
            intent: "labor", scene: nil, confidence: 0.99, buildPhase: nil,
            vehicleId: "synthetic-old-binding", agentModel: "synthetic-model", analyzedAt: Date())
        let coverage = try store.albumCoverage(album(), methodVersion: method)
        XCTAssertEqual(coverage.cachedDeepReads, 1)
        XCTAssertEqual(coverage.reviewed, 0)
        XCTAssertEqual(coverage.vehicleFrames, 0)
    }

    func testSourceAndRecipeChangesWithholdStaleReads() throws {
        let store = try LocalStore(databaseQueue: DatabaseQueue())
        try store.recordAlbumImageReview(review(photo))
        XCTAssertNotNil(try store.albumImageReview(for: photo, methodVersion: method))
        let edited = LocalAlbumPhoto(localIdentifier: photo.localIdentifier, sourceVersion: "source-v2")
        XCTAssertNil(try store.albumImageReview(for: edited, methodVersion: method))
        XCTAssertEqual(try store.albumCoverage(album(photos: [edited]), methodVersion: method).reviewed, 0)
        XCTAssertNil(try store.albumImageReview(for: photo, methodVersion: "synthetic-method-v2"))
        XCTAssertEqual(try store.albumCoverage(album(), methodVersion: "synthetic-method-v2").reviewed, 0)
    }

    func testReviewPreservesOwnerVerdictBindingAndUndatedPhotos() throws {
        let queue = try DatabaseQueue()
        let store = try LocalStore(databaseQueue: queue)
        store.ingest(localIdentifier: photo.localIdentifier, phashHex: "synthetic-hash", vehicleId: "synthetic-binding")
        store.setOwnerVerdict([photo.localIdentifier], verdict: "approved")
        store.classify(localIdentifier: photo.localIdentifier, isVehicle: false, isPersonal: true, hasPerson: true, labels: [])
        let result = review(photo, id: "synthetic-immutable-review", vehicle: false)
        try store.recordAlbumImageReview(result)
        try store.recordAlbumImageReview(review(photo, id: result.id, vehicle: true))
        XCTAssertEqual(store.ownerVerdicts(for: [photo.localIdentifier])[photo.localIdentifier], true)
        XCTAssertEqual(store.ledger(for: photo.localIdentifier)?.vehicleId, "synthetic-binding")
        XCTAssertEqual(try store.albumImageReview(for: photo, methodVersion: method)?.textLines, ["SYNTHETIC12345"])
        XCTAssertNil(store.ledger(for: photo.localIdentifier)?.takenAt)
        XCTAssertEqual(try store.albumCoverage(album(), methodVersion: method).otherFrames, 1)
        XCTAssertEqual(try queue.read { try Int.fetchOne($0, sql: "SELECT COUNT(*) FROM photo_album_image_review") }, 1)
    }

    func testLimitedAccessRetainsHistoryAndReportsUnknownAlbumCoverage() throws {
        let queue = try DatabaseQueue()
        let store = try LocalStore(databaseQueue: queue)
        try store.recordAlbumCatalog(LocalAlbumCatalog(accessScope: "full", observedAt: Date(), albums: [album()]))
        try store.recordAlbumCatalog(LocalAlbumCatalog(accessScope: "limited", observedAt: Date(), albums: []))
        XCTAssertEqual(try store.latestAlbumCatalog()?.accessScope, "limited")
        XCTAssertEqual(try queue.read { try Int.fetchOne($0, sql: "SELECT COUNT(*) FROM photo_album_catalog") }, 2)
        let unknown = LocalAlbumPhoto(localIdentifier: photo.localIdentifier, sourceVersion: nil)
        try store.recordAlbumImageReview(review(unknown))
        XCTAssertNil(try store.albumImageReview(for: unknown, methodVersion: method))
        XCTAssertEqual(try store.albumCoverage(album(photos: [unknown]), methodVersion: method).reviewed, 0)
    }

    func testSavedHumanAndAgentPassesReopenWithoutNetwork() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let path = dir.appendingPathComponent("ledger.sqlite").path
        do {
            let store = try LocalStore(databaseQueue: DatabaseQueue(path: path))
            try store.recordAlbumCatalog(LocalAlbumCatalog(accessScope: "full", observedAt: Date(), albums: [album()]))
            try store.recordAlbumImageReview(review(photo))
        }
        let reopened = try LocalStore(databaseQueue: DatabaseQueue(path: path))
        XCTAssertEqual(try reopened.latestAlbumCatalog()?.albums.first?.folderPath, ["Work"])
        XCTAssertEqual(try reopened.albumCoverage(album(), methodVersion: method).reviewed, 1)
    }

    private func vehicle(_ id: String, vin: String? = "SYNTHETIC12345") -> GarageVehicle {
        GarageVehicle(vehicle_id: id, year: 1973, make: "Synthetic", model: "Same model",
            trim_name: nil, image_url: "old-cover", current_value: nil, image_count: 1, relationship: "owner", vin: vin)
    }

    func testProfileIncludesUnalbumedPhotosWithoutDoubleCountingHumanGroups() throws {
        let store = try LocalStore(databaseQueue: DatabaseQueue())
        let ungrouped = LocalAlbumPhoto(localIdentifier: "ungrouped", sourceVersion: "v1")
        try store.recordAlbumCatalog(LocalAlbumCatalog(accessScope: "full", observedAt: Date(),
            albums: [album("one"), album("two")], photos: [photo, ungrouped]))
        try store.recordAlbumImageReview(review(photo))
        store.cacheGarage(userId: "account", vehicles: [vehicle("one")])
        let evidence = try XCTUnwrap(store.profileEvidence(userId: "account", methodVersion: method))
        XCTAssertEqual(evidence.photos.count, 2)
        XCTAssertEqual(evidence.reviewed, 1)
        XCTAssertEqual(evidence.matched, 1)
        XCTAssertEqual(evidence.photos.first { $0.photo == ungrouped }?.candidateVehicleIds, [])
        XCTAssertNil(evidence.photos.first { $0.photo == photo }?.takenAt)
        XCTAssertEqual(evidence.catalog.albums.count, 2)
    }

    func testSerialConflictAndChangedSourceRemainOpenWithoutInheritedAssignment() throws {
        let store = try LocalStore(databaseQueue: DatabaseQueue())
        try store.recordAlbumCatalog(LocalAlbumCatalog(accessScope: "full", observedAt: Date(),
            albums: [album(name: "Synthetic same model")], photos: [photo]))
        try store.recordAlbumImageReview(review(photo))
        store.cacheGarage(userId: "account", vehicles: [vehicle("one"), vehicle("two")])
        var evidence = try XCTUnwrap(store.profileEvidence(userId: "account", methodVersion: method))
        XCTAssertEqual(evidence.conflicted, 1)
        XCTAssertEqual(evidence.matched, 0)
        XCTAssertEqual(evidence.photos[0].candidateVehicleIds, ["one", "two"])
        store.cacheGarage(userId: "account", vehicles: [vehicle("one", vin: "OTHER123456789")])
        store.cacheCloudVerdict(localIdentifier: photo.localIdentifier, narrative: "Existing assignment",
            intent: "labor", scene: nil, confidence: 1, buildPhase: nil, vehicleId: "one", agentModel: "model", analyzedAt: Date())
        evidence = try XCTUnwrap(store.profileEvidence(userId: "account", methodVersion: method))
        XCTAssertEqual(evidence.unresolved, 1)
        XCTAssertEqual(evidence.matched, 0)
        let edited = LocalAlbumPhoto(localIdentifier: photo.localIdentifier, sourceVersion: "source-v2")
        try store.recordAlbumCatalog(LocalAlbumCatalog(accessScope: "full", observedAt: Date(), albums: [], photos: [edited]))
        evidence = try XCTUnwrap(store.profileEvidence(userId: "account", methodVersion: method))
        XCTAssertEqual(evidence.reviewed, 0)
        XCTAssertNil(evidence.photos[0].review)
    }

    func testLimitedLibraryRetainsAccessibleReadCoverageAndAccountIsolation() throws {
        let store = try LocalStore(databaseQueue: DatabaseQueue())
        try store.recordAlbumCatalog(LocalAlbumCatalog(accessScope: "limited", observedAt: Date(), albums: [], photos: [photo]))
        try store.recordAlbumImageReview(review(photo))
        store.cacheGarage(userId: "first", vehicles: [vehicle("one")])
        let first = try XCTUnwrap(store.profileEvidence(userId: "first", methodVersion: method))
        let second = try XCTUnwrap(store.profileEvidence(userId: "second", methodVersion: method))
        XCTAssertEqual(first.catalog.accessScope, "limited")
        XCTAssertEqual(first.catalog.albums.count, 0)
        XCTAssertEqual(first.reviewed, 1)
        XCTAssertEqual(first.matched, 1)
        XCTAssertEqual(second.matched, 0)
        XCTAssertTrue(second.vehicles.isEmpty)
    }

    func testActualCorrectionTransportAndOfflineMirrorPreserveRolesDatesAndCover() throws {
        let json = """
        [{"id":"statement","vehicle_id":"one","observed_at":"2026-10-07","cover_image_url":null,
          "correction":{"relationship":{"roles":["claimed_interest","shared_interest"],
          "ownership_denied":false,"title_status":"not_in_name","disputed":true,"start_date":null,"end_date":null}}},
         {"id":"cover","vehicle_id":"one","observed_at":"2026-10-07","cover_image_url":"chosen-cover",
          "correction":{"cover_image_id":"chosen-image"}}]
        """
        let corrections = try JSONDecoder().decode([GarageOwnerCorrection].self, from: Data(json.utf8))
        let projected = GarageVehicle.applying(corrections, to: [vehicle("one")])
        XCTAssertEqual(projected[0].relationship, "claimed_interest")
        XCTAssertEqual(projected[0].image_url, "chosen-cover")
        XCTAssertEqual(projected[0].relationshipStatement?.roles, ["claimed_interest", "shared_interest"])
        XCTAssertNil(projected[0].relationshipStatement?.end_date)
        XCTAssertEqual(projected[0].relationshipEvidenceIds, ["cover", "statement"])
        XCTAssertEqual(projected[0].relationshipObservedAt, "2026-10-07")
        XCTAssertTrue(projected[0].relationshipDetail?.contains("shared interest") == true)
        XCTAssertEqual(projected[0].relationshipPeriod, "Start unknown → End unspecified")
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let path = dir.appendingPathComponent("ledger.sqlite").path
        do {
            let store = try LocalStore(databaseQueue: DatabaseQueue(path: path))
            store.cacheGarage(userId: "first", vehicles: projected)
        }
        let reopened = try LocalStore(databaseQueue: DatabaseQueue(path: path))
        XCTAssertEqual(reopened.cachedGarage(userId: "first")?.vehicles.map(\.projection), projected)
        XCTAssertNil(reopened.cachedGarage(userId: "second"))
    }

    func testConflictingAccountStatementsAndUnavailableChosenImageNeverRestoreOldClaims() throws {
        let relationship = GarageRelationshipStatement(roles: ["owner_past"], ownership_denied: false,
            title_status: "unknown", disputed: false, start_date: nil, end_date: nil)
        let statement = GarageOwnerCorrection(id: "one", vehicle_id: "one",
            correction: .init(relationship: relationship, cover_image_id: nil), observed_at: "today", cover_image_url: nil)
        let fork = GarageOwnerCorrection(id: "fork", vehicle_id: "one",
            correction: .init(relationship: relationship, cover_image_id: nil), observed_at: "later", cover_image_url: nil)
        let cover = GarageOwnerCorrection(id: "cover", vehicle_id: "one",
            correction: .init(relationship: nil, cover_image_id: "unavailable"), observed_at: "today", cover_image_url: nil)
        let result = GarageVehicle.applying([statement, fork, cover], to: [vehicle("one")])[0]
        XCTAssertEqual(result.relationship, "relationship_review")
        XCTAssertTrue(result.statementConflict == true)
        XCTAssertNil(result.image_url)
    }
}
