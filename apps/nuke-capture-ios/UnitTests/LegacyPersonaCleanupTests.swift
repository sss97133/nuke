// LegacyPersonaCleanupTests.swift — the removed persona screen's keys are cleared once, nothing else is.

import XCTest
@testable import NukeCapture

final class LegacyPersonaCleanupTests: XCTestCase {
    private var suite: String!
    private var defaults: UserDefaults!

    override func setUp() {
        super.setUp()
        suite = "LegacyPersonaCleanupTests.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suite)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suite)
        super.tearDown()
    }

    func testClearsPersonaKeysOnceAndLeavesOthers() {
        defaults.set("tech", forKey: "personaChoice.abc")
        defaults.set("browsing", forKey: "personaChoice.visitor")
        defaults.set(true, forKey: "personaTipPending.abc")
        defaults.set(true, forKey: "welcomeSeen")

        let removed = LegacyPersonaCleanup.run(defaults: defaults)

        XCTAssertEqual(removed, ["personaChoice.abc", "personaChoice.visitor", "personaTipPending.abc"])
        XCTAssertNil(defaults.object(forKey: "personaChoice.abc"))
        XCTAssertNil(defaults.object(forKey: "personaChoice.visitor"))
        XCTAssertNil(defaults.object(forKey: "personaTipPending.abc"))
        XCTAssertTrue(defaults.bool(forKey: "welcomeSeen"))

        defaults.set("tech", forKey: "personaChoice.later")
        XCTAssertEqual(LegacyPersonaCleanup.run(defaults: defaults), [])
        XCTAssertEqual(defaults.string(forKey: "personaChoice.later"), "tech")
    }
}
