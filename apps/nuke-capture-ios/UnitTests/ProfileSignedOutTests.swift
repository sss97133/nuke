// ProfileSignedOutTests.swift — signed out, the Profile tab opens on no one: no real account stands in as a
// sample. A visitor sees the public view of whichever profile they search for and open.

import XCTest
@testable import NukeCapture

final class ProfileSignedOutTests: XCTestCase {
    func testSignedOutOpensOnNoProfile() {
        XCTAssertNil(ProfileTab.rootUserId(signedInAs: nil))
        XCTAssertNil(ProfileTab.rootUserId(signedInAs: ""))
        XCTAssertNil(ProfileTab.rootUserId(signedInAs: "  "))
    }

    func testSignedInOpensOnYourOwnProfile() {
        let me = "00000000-0000-4000-8000-0000000000c1"
        XCTAssertEqual(ProfileTab.rootUserId(signedInAs: me), me)
    }
}
