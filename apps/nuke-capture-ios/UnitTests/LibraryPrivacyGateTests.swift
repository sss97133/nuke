import XCTest
@testable import NukeCapture

final class LibraryPrivacyGateTests: XCTestCase {
    private func read(personal: Bool = false, labels: [String] = ["car"], screenshot: Bool = false) -> LibraryDeviceRead {
        LibraryDeviceRead(isPersonal: personal, hasPerson: personal, labels: labels, isScreenshot: screenshot)
    }

    func testNoVerdictFailsClosed() {
        XCTAssertEqual(LibraryPrivacyGate.verdict(ownerApproved: nil, serverBlockReason: nil, device: nil), .unchecked)
        XCTAssertFalse(LibraryPixelVerdict.unchecked.paintsPixels)
    }

    func testCleanWorkPhotoPaints() {
        let v = LibraryPrivacyGate.verdict(ownerApproved: nil, serverBlockReason: nil, device: read())
        XCTAssertEqual(v, .clear)
        XCTAssertTrue(v.paintsPixels)
    }

    func testDevicePersonalBlocks() {
        XCTAssertFalse(LibraryPrivacyGate.verdict(ownerApproved: nil, serverBlockReason: nil, device: read(personal: true)).paintsPixels)
    }

    /// The bug: a document the device withholds from upload as sensitive was only softened as
    /// clutter, so "Hide" blacked out faces but left IDs and receipts readable.
    func testSensitiveDocumentBlocksWithoutAFace() {
        for label in ["id_card", "receipt", "document", "invoice"] {
            let v = LibraryPrivacyGate.verdict(ownerApproved: nil, serverBlockReason: nil, device: read(labels: [label, "car"]))
            XCTAssertFalse(v.paintsPixels, label)
        }
        XCTAssertEqual(LibraryPrivacyGate.verdict(ownerApproved: nil, serverBlockReason: nil, device: read(labels: ["id_card"])),
                       .blocked(reason: "ID document"))
    }

    /// The bug: the server's own privacy verdicts never reached the Library.
    func testServerBlockWinsOverACleanDeviceRead() {
        let v = LibraryPrivacyGate.verdict(ownerApproved: nil, serverBlockReason: "Private photo", device: read())
        XCTAssertEqual(v, .blocked(reason: "Private photo"))
    }

    func testServerBlockCoversAPhotoTheDeviceCouldNotRead() {
        XCTAssertEqual(LibraryPrivacyGate.verdict(ownerApproved: nil, serverBlockReason: "Personal photo", device: nil),
                       .blocked(reason: "Personal photo"))
    }

    func testOwnerVerdictIsFinal() {
        XCTAssertEqual(LibraryPrivacyGate.verdict(ownerApproved: false, serverBlockReason: nil, device: read()),
                       .blocked(reason: "Hidden by you"))
        XCTAssertEqual(LibraryPrivacyGate.verdict(ownerApproved: true, serverBlockReason: "Private photo", device: read(personal: true)),
                       .clear)
    }

    func testScreenshotIsClutterNotPrivacy() {
        // Screenshots stay with the clutter gate (softened), not the privacy cover.
        XCTAssertEqual(LibraryPrivacyGate.verdict(ownerApproved: nil, serverBlockReason: nil, device: read(labels: ["website"], screenshot: true)),
                       .clear)
    }

    func testServerReasons() {
        XCTAssertEqual(LibraryPrivacyGate.serverBlockReason(isSensitive: true, sensitiveType: "child", visionGateStatus: nil,
                                                            isDocument: nil, docFlag: nil, documentCategory: nil), "Child in photo")
        XCTAssertEqual(LibraryPrivacyGate.serverBlockReason(isSensitive: false, sensitiveType: nil, visionGateStatus: "rejected_personal",
                                                            isDocument: nil, docFlag: nil, documentCategory: nil), "Personal photo")
        XCTAssertEqual(LibraryPrivacyGate.serverBlockReason(isSensitive: nil, sensitiveType: nil, visionGateStatus: "approved",
                                                            isDocument: true, docFlag: nil, documentCategory: "title"), "Title document")
        // An unnamed paper stays covered.
        XCTAssertEqual(LibraryPrivacyGate.serverBlockReason(isSensitive: nil, sensitiveType: nil, visionGateStatus: nil,
                                                            isDocument: nil, docFlag: true, documentCategory: nil), "Document")
        // Factory references are vehicle evidence, not private.
        XCTAssertNil(LibraryPrivacyGate.serverBlockReason(isSensitive: false, sensitiveType: nil, visionGateStatus: "approved",
                                                          isDocument: true, docFlag: nil, documentCategory: "window_sticker"))
        // Filing states are not privacy.
        XCTAssertNil(LibraryPrivacyGate.serverBlockReason(isSensitive: false, sensitiveType: nil, visionGateStatus: "rejected_misattributed",
                                                          isDocument: false, docFlag: false, documentCategory: nil))
        XCTAssertNil(LibraryPrivacyGate.serverBlockReason(isSensitive: nil, sensitiveType: nil, visionGateStatus: nil,
                                                          isDocument: nil, docFlag: nil, documentCategory: nil))
    }
}
