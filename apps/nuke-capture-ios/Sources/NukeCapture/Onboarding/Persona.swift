// Persona.swift — what brought this person to the app, saved on the phone and keyed to them.
//
// Asked once, right after a first sign-in (or after "Look around first"): four plain choices,
// each of which picks the tab to land on and one short, friendly line about what to do there.
// The choice only steers where the app opens and which tip is shown. It never gates a feature,
// is never sent anywhere, and never changes what any screen reads or shows.
//
// Storage: UserDefaults under `personaChoice.<scope>`, where the scope is the signed-in user's id
// (lowercased) or "visitor" for someone looking around signed out. A visitor's choice follows them
// into their first sign-in so they are not asked twice.

import Foundation

/// The four answers to "What brings you here?".
enum Persona: String, CaseIterable, Identifiable, Equatable {
    case tech, buyerSeller, shop, browsing

    var id: String { rawValue }

    /// The big words on the card.
    var title: String {
        switch self {
        case .tech: return "I fix or work on cars"
        case .buyerSeller: return "I'm buying or selling a car"
        case .shop: return "I run a shop or dealership"
        case .browsing: return "Just browsing"
        }
    }

    /// The one small line under it.
    var detail: String {
        switch self {
        case .tech: return "Find work near you"
        case .buyerSeller: return "See what cars really sell for"
        case .shop: return "Hire techs, manage inventory"
        case .browsing: return "Look around, no pressure"
        }
    }

    /// Shown on the card when its photo has not loaded (or never does).
    var symbol: String {
        switch self {
        case .tech: return "wrench.and.screwdriver"
        case .buyerSeller: return "tag"
        case .shop: return "building.2"
        case .browsing: return "eye"
        }
    }

    /// Where this person starts. The tab itself is chosen by `MainTabView.startTab`.
    var landing: PersonaLanding {
        switch self {
        case .tech: return .work
        case .shop: return .garage
        case .buyerSeller, .browsing: return .explore
        }
    }

    /// The one friendly line shown on the landing tab. Only points at screens that exist today.
    /// Work and Garage need an account, so a visitor is pointed at signing in instead.
    func tip(signedIn: Bool) -> String {
        switch self {
        case .tech:
            return signedIn ? "Open jobs are in Work. Tap one to see what's needed."
                            : "Sign in from Profile to see open jobs."
        case .buyerSeller:
            return "Tap any car to see its photos and real prices."
        case .shop:
            return signedIn ? "Open a car in Garage to post a job and find a tech."
                            : "Sign in from Profile to add your cars and hire techs."
        case .browsing:
            return "Tap any car to look closer."
        }
    }
}

/// A destination in app terms, kept apart from `MainTabView.Tab` so this file stays pure.
enum PersonaLanding: Equatable {
    case work, garage, explore
}

/// Where the choice is filed.
struct PersonaStorage {
    var defaults: UserDefaults = .standard

    static let visitorScope = "visitor"
    static let choicePrefix = "personaChoice."
    static let tipPrefix = "personaTipPending."

    /// The signed-in user's id, or "visitor". A signed-in session with no id yet files under "signed-in".
    static func scope(userId: String?, signedIn: Bool) -> String {
        guard signedIn else { return visitorScope }
        let id = userId?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
        return id.isEmpty ? "signed-in" : id
    }

    static func choiceKey(_ scope: String) -> String { choicePrefix + scope.lowercased() }
    static func tipKey(_ scope: String) -> String { tipPrefix + scope.lowercased() }

    func choice(for scope: String) -> Persona? {
        defaults.string(forKey: Self.choiceKey(scope)).flatMap(Persona.init(rawValue:))
    }

    /// Saves the choice and arms the one-time tip on the landing tab.
    func save(_ persona: Persona, for scope: String) {
        defaults.set(persona.rawValue, forKey: Self.choiceKey(scope))
        defaults.set(true, forKey: Self.tipKey(scope))
    }

    func clear(scope: String) {
        defaults.removeObject(forKey: Self.choiceKey(scope))
        defaults.removeObject(forKey: Self.tipKey(scope))
    }

    func tipPending(for scope: String) -> Bool { defaults.bool(forKey: Self.tipKey(scope)) }

    func dismissTip(for scope: String) { defaults.removeObject(forKey: Self.tipKey(scope)) }

    /// A signed-in user with no choice of their own takes the one a visitor made on this phone, once,
    /// so "Look around first" then signing in does not ask the same question twice. The visitor's
    /// slot is emptied so the next person to sign in here starts clean. Returns the user's choice.
    @discardableResult
    func choiceAdoptingVisitor(for scope: String) -> Persona? {
        if let own = choice(for: scope) { return own }
        guard scope != Self.visitorScope, let visitor = choice(for: Self.visitorScope) else { return nil }
        save(visitor, for: scope)
        dismissTip(for: scope)   // they have already been through the tip as a visitor
        clear(scope: Self.visitorScope)
        return visitor
    }
}

/// When the question is asked.
enum PersonaGate {
    /// Once per person: only while there is no saved choice. UI-test and fixture launches skip it.
    static func shouldShow(hasChoice: Bool, skip: Bool) -> Bool { !hasChoice && !skip }
}

/// The live copy of the storage, so the root view and the tabs update the moment a choice is made.
@MainActor
final class PersonaStore: ObservableObject {
    static let shared = PersonaStore()

    /// Bumps on every save. Views that depend on the choice read it so SwiftUI refreshes them.
    @Published private(set) var revision = 0

    private let storage: PersonaStorage

    init(storage: PersonaStorage = PersonaStorage()) { self.storage = storage }

    func choice(for scope: String) -> Persona? {
        storage.choiceAdoptingVisitor(for: scope)
    }

    func choose(_ persona: Persona, for scope: String) {
        storage.save(persona, for: scope)
        revision += 1
    }

    func tipPending(for scope: String) -> Bool { storage.tipPending(for: scope) }

    /// Quiet on purpose: closing the tip must not bump `revision`, which moves the tabs.
    func dismissTip(for scope: String) { storage.dismissTip(for: scope) }
}
