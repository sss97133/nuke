// WelcomeTests.swift — the first-launch flag logic, the welcome copy, the photo pick, and the
// handling of the full name Apple provides once.

import XCTest
@testable import NukeCapture

final class WelcomeGateTests: XCTestCase {
    private func freshDefaults() -> UserDefaults {
        let name = "WelcomeTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        addTeardownBlock { defaults.removePersistentDomain(forName: name) }
        return defaults
    }

    func testFreshSignedOutInstallSeesTheWelcome() {
        XCTAssertTrue(WelcomeGate.shouldShow(seen: false, signedIn: false, exploring: false, skip: false))
    }

    func testSeenFlagHidesTheWelcome() {
        XCTAssertFalse(WelcomeGate.shouldShow(seen: true, signedIn: false, exploring: false, skip: false))
    }

    func testSignedInUserNeverSeesTheWelcomeEvenIfTheFlagWasNeverSet() {
        XCTAssertFalse(WelcomeGate.shouldShow(seen: false, signedIn: true, exploring: false, skip: false))
    }

    func testExploringSignedOutNeverSeesTheWelcome() {
        XCTAssertFalse(WelcomeGate.shouldShow(seen: false, signedIn: false, exploring: true, skip: false))
    }

    func testSkipFlagHidesTheWelcome() {
        XCTAssertFalse(WelcomeGate.shouldShow(seen: false, signedIn: false, exploring: false, skip: true))
    }

    func testFlagPersistsOnceMarked() {
        let defaults = freshDefaults()
        XCTAssertFalse(WelcomeGate.hasSeen(defaults))
        WelcomeGate.markSeen(defaults)
        XCTAssertTrue(WelcomeGate.hasSeen(defaults))
        XCTAssertTrue(defaults.bool(forKey: "welcomeSeen"), "the root view reads this exact key through @AppStorage")
    }

    func testFixtureAndExplicitArgumentLaunchesSkipTheWelcome() {
        XCTAssertTrue(WelcomeGate.launchSkips(arguments: [], fixtureActive: true))
        XCTAssertTrue(WelcomeGate.launchSkips(arguments: ["-NukeSkipWelcome"], fixtureActive: false))
        XCTAssertFalse(WelcomeGate.launchSkips(arguments: ["-other"], fixtureActive: false))
    }

    func testExploreIsTheDefaultTab() {
        XCTAssertEqual(MainTabView.defaultTab, .explore)
    }
}

final class WelcomeCopyTests: XCTestCase {
    func testFourPagesInOrderWithPlainWords() {
        XCTAssertEqual(WelcomePage.all.map(\.headline), [
            "Find work near you.",
            "Show off your work.",
            "Hire a tech.",
            "See what cars really sell for.",
        ])
        XCTAssertEqual(WelcomePage.all.first?.kicker, "LinkedIn plus Uber for car guys.")
        XCTAssertTrue(WelcomePage.all.dropFirst().allSatisfy { $0.kicker == nil })
        XCTAssertTrue(WelcomePage.all.allSatisfy { !$0.detail.isEmpty && $0.gradient.count >= 2 })
    }

    private func item(_ id: String, make: String?, image: String?) -> ExploreFeedItem {
        ExploreFeedItem(id: id, kind: .classified, title: id, image: image, amount: nil, amountLabel: "Asking",
                        endsAt: nil, source: "S", location: nil, facts: nil, seen: nil, vehicleId: nil,
                        year: nil, make: make, model: nil, link: nil)
    }

    func testPhotoPickSpreadsAcrossMakesAndSkipsMissingOrRepeatedPhotos() {
        let items = [
            item("a", make: "Ford", image: "https://x/1.jpg"),
            item("b", make: "Ford", image: "https://x/2.jpg"),
            item("c", make: "Porsche", image: nil),
            item("d", make: "Porsche", image: "https://x/1.jpg"),   // same photo as a
            item("e", make: "Porsche", image: "https://x/3.jpg"),
            item("f", make: "Honda", image: "https://x/4.jpg"),
        ]
        XCTAssertEqual(WelcomePhotos.pick(from: items, count: 3).map(\.id), ["a", "e", "f"])
        XCTAssertEqual(WelcomePhotos.pick(from: items, count: 4).map(\.id), ["a", "e", "f", "b"])
    }

    func testPhotoPickWithNothingGivesNothing() {
        XCTAssertTrue(WelcomePhotos.pick(from: [], count: 4).isEmpty)
        XCTAssertTrue(WelcomePhotos.pick(from: [item("a", make: nil, image: "")], count: 4).isEmpty)
        XCTAssertTrue(WelcomePhotos.pick(from: [item("a", make: nil, image: "https://x/1.jpg")], count: 0).isEmpty)
    }
}

final class ProfileDisplayNameTests: XCTestCase {
    private func freshStore() -> ProfileDisplayName {
        let name = "ProfileDisplayNameTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        addTeardownBlock { defaults.removePersistentDomain(forName: name) }
        return ProfileDisplayName(defaults: defaults)
    }

    func testFullNameJoinsGivenAndFamilyAndTrims() {
        var parts = PersonNameComponents()
        parts.givenName = " Ada "
        parts.familyName = "Lovelace"
        XCTAssertEqual(ProfileDisplayName.fullName(from: parts), "Ada Lovelace")
    }

    func testFullNameWithOnlyOnePartOrNothingIsHandled() {
        var given = PersonNameComponents()
        given.givenName = "Ada"
        XCTAssertEqual(ProfileDisplayName.fullName(from: given), "Ada")
        XCTAssertNil(ProfileDisplayName.fullName(from: PersonNameComponents()))
        XCTAssertNil(ProfileDisplayName.fullName(from: nil), "later Apple sign-ins carry no name")
        var blank = PersonNameComponents()
        blank.givenName = "  "
        XCTAssertNil(ProfileDisplayName.fullName(from: blank))
    }

    func testServerNameWinsWhenItIsReal() {
        XCTAssertEqual(ProfileDisplayName.resolve(profileName: "Sam Rivera", email: "sam@x.com", savedName: "Samuel R"), "Sam Rivera")
    }

    func testSavedNameReplacesBlankOrAutoGeneratedServerNames() {
        XCTAssertEqual(ProfileDisplayName.resolve(profileName: nil, email: nil, savedName: "Ada Lovelace"), "Ada Lovelace")
        XCTAssertEqual(ProfileDisplayName.resolve(profileName: "  ", email: nil, savedName: "Ada Lovelace"), "Ada Lovelace")
        XCTAssertEqual(ProfileDisplayName.resolve(profileName: "User", email: nil, savedName: "Ada Lovelace"), "Ada Lovelace")
        XCTAssertEqual(ProfileDisplayName.resolve(profileName: "ada.l", email: "Ada.L@privaterelay.appleid.com", savedName: "Ada Lovelace"), "Ada Lovelace")
        XCTAssertEqual(ProfileDisplayName.resolve(profileName: "ada@x.com", email: nil, savedName: "Ada Lovelace"), "Ada Lovelace")
    }

    func testNoSavedNameKeepsWhateverTheServerHas() {
        XCTAssertEqual(ProfileDisplayName.resolve(profileName: "User", email: nil, savedName: nil), "User")
        XCTAssertNil(ProfileDisplayName.resolve(profileName: nil, email: nil, savedName: nil), "the header then says Unnamed builder")
    }

    func testSaveAndReadIsPerAccountAndCaseInsensitiveOnTheId() {
        let store = freshStore()
        store.save("Ada Lovelace", for: "ABC-123")
        XCTAssertEqual(store.saved(for: "abc-123"), "Ada Lovelace")
        XCTAssertNil(store.saved(for: "other-user"))
        store.forget(userId: "abc-123")
        XCTAssertNil(store.saved(for: "abc-123"))
    }

    func testCommitFilesAFreshNameUnderTheAccount() {
        let store = freshStore()
        store.commit(appleUser: "apple-1", newName: "Ada Lovelace", userId: "u1")
        XCTAssertEqual(store.saved(for: "u1"), "Ada Lovelace")
    }

    func testCommitWithoutANameKeepsTheExistingOne() {
        let store = freshStore()
        store.save("Ada Lovelace", for: "u1")
        store.commit(appleUser: "apple-1", newName: nil, userId: "u1")
        XCTAssertEqual(store.saved(for: "u1"), "Ada Lovelace", "Apple sends no name after the first time")
    }

    func testPendingNameSurvivesAFailedExchangeAndAttachesOnRetry() {
        let store = freshStore()
        store.stashPending(name: "Ada Lovelace", appleUser: "apple-1")
        // Exchange failed; the retry carries no name.
        store.commit(appleUser: "apple-1", newName: nil, userId: "u1")
        XCTAssertEqual(store.saved(for: "u1"), "Ada Lovelace")
        XCTAssertNil(store.pendingName(appleUser: "apple-1"), "the pending slot clears once filed")
    }

    func testPendingNameNeverAttachesToADifferentAppleUser() {
        let store = freshStore()
        store.stashPending(name: "Ada Lovelace", appleUser: "apple-1")
        store.commit(appleUser: "apple-2", newName: nil, userId: "u2")
        XCTAssertNil(store.saved(for: "u2"))
    }
}
