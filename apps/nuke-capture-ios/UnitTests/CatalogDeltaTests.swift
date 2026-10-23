// CatalogDeltaTests.swift — library changes update the album catalog incrementally
// (PHChange inserted/removed/changed) instead of re-enumerating the whole library.

import XCTest
@testable import NukeCapture

final class CatalogDeltaTests: XCTestCase {
    private func p(_ id: String, _ v: String? = "1") -> LocalAlbumPhoto { .init(localIdentifier: id, sourceVersion: v) }

    func testRemoveInsertAndChange() {
        let delta = CatalogDelta(removed: ["b"], upserted: [p("c", "2"), p("d")])
        XCTAssertEqual(delta.applied(to: [p("a"), p("b"), p("c")]), [p("a"), p("c", "2"), p("d")])
    }

    func testNoDuplicatesAndRemovedWins() {
        let delta = CatalogDelta(removed: ["x"], upserted: [p("a", "2"), p("a", "3"), p("x")])
        XCTAssertEqual(delta.applied(to: [p("a")]), [p("a", "3")])
    }

    func testEmptyDeltaIsIdentity() {
        let photos = [p("a"), p("b")]
        XCTAssertEqual(CatalogDelta(removed: [], upserted: []).applied(to: photos), photos)
    }

    func testCatalogMergeTouchesOnlyChangedAlbums() {
        let a1 = LocalPhotoAlbum(id: "A1", name: "1972 K10", folderPath: [], sourceKind: "2", photos: [p("a")])
        let a2 = LocalPhotoAlbum(id: "A2", name: "Shop", folderPath: ["Work"], sourceKind: "2", photos: [p("b")])
        let catalog = LocalAlbumCatalog(accessScope: "full", observedAt: Date(timeIntervalSince1970: 0),
                                        albums: [a1, a2], photos: [p("a"), p("b")])
        let now = Date(timeIntervalSince1970: 100)
        let merged = LibraryStore.applying(catalog,
            photos: CatalogDelta(removed: [], upserted: [p("c")]),
            albums: ["A1": CatalogDelta(removed: ["a"], upserted: [p("c")])], at: now)
        XCTAssertEqual(merged.photos, [p("a"), p("b"), p("c")])
        XCTAssertEqual(merged.albums[0].photos, [p("c")])
        XCTAssertEqual(merged.albums[0].name, "1972 K10")
        XCTAssertEqual(merged.albums[1], a2)
        XCTAssertEqual(merged.observedAt, now)
        XCTAssertEqual(merged.accessScope, "full")
    }

    func testNoPhotoDeltaKeepsPhotos() {
        let catalog = LocalAlbumCatalog(accessScope: "limited", observedAt: Date(), albums: [], photos: [p("a")])
        XCTAssertEqual(LibraryStore.applying(catalog, photos: nil, albums: [:], at: Date()).photos, [p("a")])
    }
}
