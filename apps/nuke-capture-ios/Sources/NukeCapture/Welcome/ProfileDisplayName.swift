// ProfileDisplayName.swift — the name Apple hands over once, kept on the phone.
//
// Sign in with Apple returns the person's full name only on the FIRST authorization for this
// app; every later sign-in carries nil. The app has no client-side write to profiles.full_name
// (and this change adds no database write), so the name is stored locally, keyed by the
// account's user id, and the profile header uses it whenever the server's name is empty or an
// auto-generated stand-in (the sign-up trigger fills full_name from the e-mail prefix).
//
// If the Supabase exchange fails after Apple already showed the name, it is held as "pending"
// against Apple's stable user id and attached on the retry, so a flaky network cannot lose it.

import Foundation

struct ProfileDisplayName {
    let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    // ─── Pure helpers ────────────────────────────────────────────────────────

    /// "Given Family" from Apple's name components; nil when Apple gave nothing usable.
    static func fullName(from components: PersonNameComponents?) -> String? {
        guard let components else { return nil }
        let parts = [components.givenName, components.familyName]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: " ")
    }

    /// What the profile header should say. The server's name wins when it is a real one;
    /// the saved name replaces a blank or auto-generated server name; nil means "no name known".
    static func resolve(profileName: String?, email: String?, savedName: String?) -> String? {
        let server = clean(profileName)
        let saved = clean(savedName)
        if let server, !isPlaceholder(server, email: email) { return server }
        return saved ?? server
    }

    /// The sign-up trigger falls back to "User" or the e-mail prefix when no name was given.
    static func isPlaceholder(_ name: String, email: String?) -> Bool {
        let lower = name.lowercased()
        if lower == "user" || lower.contains("@") { return true }
        if let email, let prefix = email.split(separator: "@").first, lower == prefix.lowercased() { return true }
        return false
    }

    private static func clean(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else { return nil }
        return trimmed
    }

    // ─── Local store ─────────────────────────────────────────────────────────

    private static let pendingKey = "profileDisplayName.pending"

    private func key(_ userId: String) -> String { "profileDisplayName.\(userId.lowercased())" }

    func saved(for userId: String) -> String? {
        Self.clean(defaults.string(forKey: key(userId)))
    }

    func save(_ name: String, for userId: String) {
        guard let name = Self.clean(name) else { return }
        defaults.set(name, forKey: key(userId))
    }

    func forget(userId: String) {
        defaults.removeObject(forKey: key(userId))
    }

    /// Hold a name Apple just gave us until the Supabase exchange succeeds.
    func stashPending(name: String, appleUser: String) {
        guard let name = Self.clean(name) else { return }
        defaults.set(["appleUser": appleUser, "name": name], forKey: Self.pendingKey)
    }

    func pendingName(appleUser: String) -> String? {
        guard let pending = defaults.dictionary(forKey: Self.pendingKey) as? [String: String],
              pending["appleUser"] == appleUser else { return nil }
        return Self.clean(pending["name"])
    }

    /// After a successful sign-in: file the name under the account. A fresh name from Apple wins;
    /// otherwise a pending name for the same Apple user is attached. Clears the pending slot.
    func commit(appleUser: String, newName: String?, userId: String) {
        if let name = Self.clean(newName) ?? pendingName(appleUser: appleUser) {
            save(name, for: userId)
        }
        defaults.removeObject(forKey: Self.pendingKey)
    }
}
