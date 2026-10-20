// ToolActionShotsTests.swift — "Seen at work" as user_tool_action_shots_read states it: groups
// decode tolerantly, a label is worded as a tool type the analysis saw (never as the person's own
// tool), counts keep their scan coverage, and failures read as JobReaders states them.

import XCTest
import Supabase
@testable import NukeCapture

final class ToolActionShotsTests: XCTestCase {
    private func decode(_ json: String) throws -> ToolActionShots {
        try JobReaders.decode(ToolActionShots.self, from: Data(json.utf8))
    }

    // MARK: Decoding

    func testSelfDecodesTheMigrationShape() throws {
        let s = try decode(ToolActionShotsFixtures.read(isSelf: true))
        XCTAssertTrue(s.isSelf)
        XCTAssertEqual(s.userId, ToolActionShotsFixtures.userId)
        XCTAssertNil(s.labelFilter)
        XCTAssertEqual(s.groups.map(\.label), ["two-post lift", "air compressor"])  // empty and unlabelled groups are dropped
        let lift = s.groups[0]
        XCTAssertEqual(lift.photos, 12)
        XCTAssertEqual(lift.shots.count, 2)                                          // a shot with no image is dropped
        XCTAssertEqual(lift.shots[0].vehicle?.vehicleId, "00000000-0000-4000-8000-0000000000c7")
        XCTAssertEqual(lift.shots[1].vehicle?.label, "1985 Fixture Pickup")
        XCTAssertNil(lift.shots[1].vehicle?.vehicleId)
        XCTAssertNil(lift.shots[1].takenAt)
        XCTAssertEqual(s.coverage?.photosWithTools, 13)
        XCTAssertEqual(s.coverage?.imagesScanned, 1000)
        XCTAssertEqual(s.coverage?.framesAnalyzed, 640)
        XCTAssertEqual(s.basis["photos"], "distinct photos per label among the scanned photos; not distinct objects")
    }

    func testVisitorAndFilteredReads() throws {
        let v = try decode(ToolActionShotsFixtures.read(isSelf: false))
        XCTAssertFalse(v.isSelf)
        XCTAssertNil(v.groups[0].shots[1].vehicle)                                   // a null vehicle stays absent
        let f = try decode(ToolActionShotsFixtures.filtered)
        XCTAssertEqual(f.labelFilter, "floor jack")
        XCTAssertEqual(f.coverage?.perLabel, 48)
        XCTAssertEqual(f.groups.first?.shots.count, 2)
    }

    func testMissingBlocksReadAsNotReported() throws {
        let s = try decode("{}")
        XCTAssertFalse(s.isSelf)
        XCTAssertTrue(s.groups.isEmpty)
        XCTAssertNil(s.coverage)
        XCTAssertNil(ActionShotsCopy.coverage(s))
        XCTAssertNil(ActionShotsCopy.capNote(s))
        XCTAssertNil(ActionShotsCopy.jumpLabel(s))
    }

    // MARK: Wording

    func testLabelsAreToolTypesNeverTheirOwnTool() throws {
        for isSelf in [true, false] {
            let s = try decode(ToolActionShotsFixtures.read(isSelf: isSelf))
            var words = [ActionShotsCopy.basis(isSelf: isSelf), ActionShotsCopy.scope(isSelf: isSelf), ActionShotsCopy.title]
            for g in s.groups {
                words.append(ActionShotsCopy.groupTitle(g))
                words.append(ActionShotsCopy.photoCaption(label: g.label, isSelf: isSelf))
                for shot in g.shots { words += [ActionShotsCopy.day(shot), ActionShotsCopy.vehicle(shot)] }
            }
            for w in words {
                let lower = w.lowercased()
                for g in s.groups {
                    XCTAssertFalse(lower.contains("your \(g.label)"), w)
                    XCTAssertFalse(lower.contains("their \(g.label)"), w)
                }
                XCTAssertFalse(lower.contains("your tool "), w)
                XCTAssertFalse(lower.contains("your tools"), w)
            }
            XCTAssertTrue(ActionShotsCopy.basis(isSelf: isSelf).contains("not identified tools from"))
        }
        XCTAssertEqual(ActionShotsCopy.photoCaption(label: "two-post lift", isSelf: true),
                       "The image analysis saw a two-post lift in this photo. That's a tool type, not an identified tool from your toolbox.")
        XCTAssertEqual(ActionShotsCopy.photoCaption(label: "air compressor", isSelf: false),
                       "The image analysis saw an air compressor in this photo. That's a tool type, not an identified tool from their toolbox.")
        XCTAssertEqual(ActionShotsCopy.basis(isSelf: true),
                       "Tool types the image analysis saw in your photos; not identified tools from your toolbox.")
    }

    func testGroupAndPhotoFormatting() throws {
        let s = try decode(ToolActionShotsFixtures.read(isSelf: true))
        XCTAssertEqual(ActionShotsCopy.groupTitle(s.groups[0]), "Two-post lift · 12 photos")
        XCTAssertEqual(ActionShotsCopy.groupTitle(s.groups[1]), "Air compressor · 1 photo")
        XCTAssertEqual(ActionShotsCopy.photos(1_234), "1,234 photos")
        XCTAssertEqual(ActionShotsCopy.photos(nil), "photos not counted")
        XCTAssertEqual(ActionShotsCopy.shown(s.groups[0]), "Showing 2 of 12 photos, newest first")
        XCTAssertNil(ActionShotsCopy.shown(s.groups[1]))
        XCTAssertEqual(ActionShotsCopy.day(s.groups[0].shots[0]), "Taken Oct 12, 2026")
        XCTAssertEqual(ActionShotsCopy.day(s.groups[0].shots[1]), "Date not recorded")
        XCTAssertEqual(ActionShotsCopy.vehicle(s.groups[0].shots[0]), "1970 Fixture Coupe")
        let visitor = try decode(ToolActionShotsFixtures.read(isSelf: false))
        XCTAssertEqual(ActionShotsCopy.vehicle(visitor.groups[0].shots[1]), "No vehicle on record")
        XCTAssertNotEqual(ActionShotsCopy.transitionID(label: "a", shot: s.groups[0].shots[0]),
                          ActionShotsCopy.transitionID(label: "b", shot: s.groups[0].shots[0]))
    }

    func testCoverageStatesItsScan() throws {
        let s = try decode(ToolActionShotsFixtures.read(isSelf: true))
        XCTAssertEqual(ActionShotsCopy.coverage(s), "13 photos with tools among 1,000 scanned · 640 with an image analysis")
        XCTAssertEqual(ActionShotsCopy.capNote(s), "The scan reads the newest 1,000 eligible photos; older photos aren't counted.")
        XCTAssertEqual(ActionShotsCopy.jumpLabel(s), "Seen at work · 13 photos")
        XCTAssertNil(ActionShotsCopy.capNote(try decode(ToolActionShotsFixtures.filtered)))   // under the cap: no note
        XCTAssertEqual(ActionShotsCopy.scope(isSelf: false), "Photos of public vehicles only.")
    }

    func testThumbnailsGoThroughTheRenderEndpoint() throws {
        let shot = try decode(ToolActionShotsFixtures.read(isSelf: true)).groups[0].shots[0]
        XCTAssertEqual(ActionShotsCopy.thumbURL(shot)?.absoluteString,
                       "https://fixture.supabase.example/storage/v1/render/image/public/vehicle-photos/users/fixture/1-thumb.jpg?width=320&quality=85&resize=contain")
        XCTAssertTrue(ActionShotsCopy.photoURL(shot)?.absoluteString.contains("/1.jpg?width=1400") ?? false)
    }

    // MARK: Reader

    func testPerLabelIsClampedToTheReadersRange() {
        XCTAssertEqual(ToolActionShotsReaders.clamp(0), 1)
        XCTAssertEqual(ToolActionShotsReaders.clamp(6), 6)
        XCTAssertEqual(ToolActionShotsReaders.clamp(500), 48)
    }

    func testRefusalMapping() {
        let pending = ToolActionShotsReaders.refusal(PostgrestError(code: "PGRST202", message: "Could not find the function"), signedIn: true)
        XCTAssertEqual(pending.kind, .readerPending)
        XCTAssertEqual(pending.reader, "user_tool_action_shots_read")
        let timeout = ToolActionShotsReaders.refusal(PostgrestError(code: "57014", message: "canceling statement due to statement timeout"), signedIn: true)
        XCTAssertEqual(timeout.kind, .failed)
        XCTAssertEqual(timeout.detail, "The database ran out of time on this read.")
        XCTAssertEqual(ToolActionShotsReaders.refusal(PostgrestError(code: "42501", message: "permission denied"), signedIn: true).kind,
                       .notPermitted)
    }
}
