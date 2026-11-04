// LegacyPersonaCleanup.swift — clears what the removed "What brings you here?" screen (#2993) left
// on the phone. That screen asked people to declare a role; it is gone (CONSTRAINTS.md C2: never ask
// for what we can read). Its answers lived only in UserDefaults under `personaChoice.<scope>` and
// `personaTipPending.<scope>`; this removes them once, at launch, and then never runs again.

import Foundation

enum LegacyPersonaCleanup {
    static let doneKey = "legacyPersonaCleanupDone"
    static let prefixes = ["personaChoice.", "personaTipPending."]

    /// Removes every key with a legacy persona prefix, once. Returns the keys removed.
    @discardableResult
    static func run(defaults: UserDefaults = .standard) -> [String] {
        guard !defaults.bool(forKey: doneKey) else { return [] }
        let stale = defaults.dictionaryRepresentation().keys.filter { key in
            prefixes.contains { key.hasPrefix($0) }
        }
        stale.forEach { defaults.removeObject(forKey: $0) }
        defaults.set(true, forKey: doneKey)
        return stale.sorted()
    }
}
