// PersonaOnboardingTests.swift — "What brings you here?": the four answers, where each one lands,
// how the choice is saved per user, when the question is asked, and when the camera is explained.

import AVFoundation
import XCTest
@testable import NukeCapture

final class PersonaCopyTests: XCTestCase {
    func testFourChoicesInOrderWithTheAgreedWords() {
        XCTAssertEqual(Persona.allCases, [.tech, .buyerSeller, .shop, .browsing])
        XCTAssertEqual(Persona.allCases.map(\.title), [
            "I fix or work on cars",
            "I'm buying or selling a car",
            "I run a shop or dealership",
            "Just browsing",
        ])
        XCTAssertEqual(Persona.tech.detail, "Find work near you")
        XCTAssertEqual(Persona.shop.detail, "Hire techs, manage inventory")
    }

    func testEveryChoiceHasAShortTipForVisitorsAndMembers() {
        for persona in Persona.allCases {
            for signedIn in [true, false] {
                let tip = persona.tip(signedIn: signedIn)
                XCTAssertFalse(tip.isEmpty)
                XCTAssertLessThanOrEqual(tip.count, 70, "one short line: \(tip)")
            }
            XCTAssertFalse(persona.symbol.isEmpty)
        }
    }

    func testVisitorTipsForAccountScreensPointAtSigningIn() {
        XCTAssertTrue(Persona.tech.tip(signedIn: false).contains("Sign in"))
        XCTAssertTrue(Persona.shop.tip(signedIn: false).contains("Sign in"))
        XCTAssertFalse(Persona.buyerSeller.tip(signedIn: false).contains("Sign in"))
    }
}

final class PersonaRoutingTests: XCTestCase {
    func testEachChoiceLandsOnASensibleTabWhenSignedIn() {
        XCTAssertEqual(MainTabView.startTab(for: .tech, signedIn: true, fullAccess: false), .today)
        XCTAssertEqual(MainTabView.startTab(for: .shop, signedIn: true, fullAccess: false), .garage)
        XCTAssertEqual(MainTabView.startTab(for: .buyerSeller, signedIn: true, fullAccess: false), .explore)
        XCTAssertEqual(MainTabView.startTab(for: .browsing, signedIn: true, fullAccess: true), .explore)
    }

    func testVisitorsNeverLandOnATabThatNeedsAnAccount() {
        for persona in Persona.allCases {
            XCTAssertEqual(MainTabView.startTab(for: persona, signedIn: false, fullAccess: false), .explore)
        }
    }

    func testNoAnswerKeepsTheDefaultTab() {
        XCTAssertEqual(MainTabView.startTab(for: nil, signedIn: true, fullAccess: true), MainTabView.defaultTab)
        XCTAssertEqual(MainTabView.startTab(for: nil, signedIn: false, fullAccess: false), .explore)
    }
}

final class PersonaStorageTests: XCTestCase {
    private func freshStorage() -> PersonaStorage {
        let name = "PersonaStorageTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        addTeardownBlock { defaults.removePersistentDomain(forName: name) }
        return PersonaStorage(defaults: defaults)
    }

    func testScopeIsTheLowercasedUserOrVisitor() {
        XCTAssertEqual(PersonaStorage.scope(userId: "ABC-123", signedIn: true), "abc-123")
        XCTAssertEqual(PersonaStorage.scope(userId: "ABC-123", signedIn: false), "visitor")
        XCTAssertEqual(PersonaStorage.scope(userId: nil, signedIn: false), "visitor")
        XCTAssertEqual(PersonaStorage.scope(userId: nil, signedIn: true), "signed-in")
        XCTAssertEqual(PersonaStorage.scope(userId: "  ", signedIn: true), "signed-in")
    }

    func testChoiceIsSavedPerUserAndCaseInsensitiveOnTheId() {
        let storage = freshStorage()
        XCTAssertNil(storage.choice(for: "u1"))
        storage.save(.tech, for: "U1")
        XCTAssertEqual(storage.choice(for: "u1"), .tech)
        XCTAssertNil(storage.choice(for: "u2"), "another account on this phone is asked for itself")
        storage.save(.shop, for: "u1")
        XCTAssertEqual(storage.choice(for: "u1"), .shop, "changing it from Profile replaces the old answer")
    }

    func testSavedValueIsThePlainRawNameUnderTheDocumentedKey() {
        let storage = freshStorage()
        storage.save(.buyerSeller, for: "u1")
        XCTAssertEqual(storage.defaults.string(forKey: "personaChoice.u1"), "buyerSeller")
    }

    func testAnUnknownStoredValueCountsAsNoAnswer() {
        let storage = freshStorage()
        storage.defaults.set("astronaut", forKey: PersonaStorage.choiceKey("u1"))
        XCTAssertNil(storage.choice(for: "u1"))
    }

    func testTipIsArmedBySavingAndDismissedOnce() {
        let storage = freshStorage()
        XCTAssertFalse(storage.tipPending(for: "u1"))
        storage.save(.tech, for: "u1")
        XCTAssertTrue(storage.tipPending(for: "u1"))
        storage.dismissTip(for: "u1")
        XCTAssertFalse(storage.tipPending(for: "u1"))
        XCTAssertEqual(storage.choice(for: "u1"), .tech, "dismissing the tip keeps the answer")
    }

    func testAVisitorsAnswerFollowsThemIntoTheirFirstSignInOnce() {
        let storage = freshStorage()
        storage.save(.shop, for: PersonaStorage.visitorScope)
        XCTAssertEqual(storage.choiceAdoptingVisitor(for: "u1"), .shop)
        XCTAssertEqual(storage.choice(for: "u1"), .shop)
        XCTAssertFalse(storage.tipPending(for: "u1"), "they already saw the tip as a visitor")
        XCTAssertNil(storage.choice(for: PersonaStorage.visitorScope), "the next person to sign in here starts clean")
        XCTAssertNil(storage.choiceAdoptingVisitor(for: "u2"))
    }

    func testOwnAnswerBeatsTheVisitorsAndTheVisitorSlotIsLeftAlone() {
        let storage = freshStorage()
        storage.save(.tech, for: "u1")
        storage.save(.browsing, for: PersonaStorage.visitorScope)
        XCTAssertEqual(storage.choiceAdoptingVisitor(for: "u1"), .tech)
        XCTAssertEqual(storage.choice(for: PersonaStorage.visitorScope), .browsing)
    }

    func testTheVisitorScopeNeverAdoptsFromItself() {
        let storage = freshStorage()
        XCTAssertNil(storage.choiceAdoptingVisitor(for: PersonaStorage.visitorScope))
        storage.save(.browsing, for: PersonaStorage.visitorScope)
        XCTAssertEqual(storage.choiceAdoptingVisitor(for: PersonaStorage.visitorScope), .browsing)
    }

    func testClearForgetsTheAnswerAndTheTip() {
        let storage = freshStorage()
        storage.save(.tech, for: "u1")
        storage.clear(scope: "u1")
        XCTAssertNil(storage.choice(for: "u1"))
        XCTAssertFalse(storage.tipPending(for: "u1"))
    }
}

final class PersonaGateTests: XCTestCase {
    func testAskedOnlyUntilAnswered() {
        XCTAssertTrue(PersonaGate.shouldShow(hasChoice: false, skip: false))
        XCTAssertFalse(PersonaGate.shouldShow(hasChoice: true, skip: false))
    }

    func testFixtureAndUITestLaunchesSkipIt() {
        XCTAssertFalse(PersonaGate.shouldShow(hasChoice: false, skip: true))
    }
}

@MainActor
final class PersonaStoreTests: XCTestCase {
    private func freshStore() -> PersonaStore {
        let name = "PersonaStoreTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        addTeardownBlock { defaults.removePersistentDomain(forName: name) }
        return PersonaStore(storage: PersonaStorage(defaults: defaults))
    }

    func testChoosingSavesAndBumpsTheRevision() {
        let store = freshStore()
        let before = store.revision
        XCTAssertNil(store.choice(for: "u1"))
        store.choose(.tech, for: "u1")
        XCTAssertEqual(store.choice(for: "u1"), .tech)
        XCTAssertEqual(store.revision, before + 1)
        XCTAssertTrue(store.tipPending(for: "u1"))
    }

    func testDismissingTheTipDoesNotMoveTheTabs() {
        let store = freshStore()
        store.choose(.shop, for: "u1")
        let revision = store.revision
        store.dismissTip(for: "u1")
        XCTAssertEqual(store.revision, revision, "a bump would send the person back to the landing tab")
        XCTAssertFalse(store.tipPending(for: "u1"))
    }
}

final class PermissionPrimerTests: XCTestCase {
    func testExplainsOnlyBeforeIOSHasEverAsked() {
        XCTAssertTrue(PermissionPrimer.shouldExplain(.notDetermined))
        XCTAssertFalse(PermissionPrimer.shouldExplain(.granted))
        XCTAssertFalse(PermissionPrimer.shouldExplain(.denied))
    }

    func testCameraStatusMapping() {
        XCTAssertEqual(PermissionPrimer.state(for: .notDetermined), .notDetermined)
        XCTAssertEqual(PermissionPrimer.state(for: .authorized), .granted)
        XCTAssertEqual(PermissionPrimer.state(for: .denied), .denied)
        XCTAssertEqual(PermissionPrimer.state(for: .restricted), .denied)
    }

    func testCameraPrimerIsOneShortPlainSentenceAboutScanning() {
        let message = PermissionKind.camera.message
        XCTAssertTrue(message.contains("Scan receipts, work orders and titles"))
        XCTAssertFalse(PermissionKind.camera.title.isEmpty)
    }
}
