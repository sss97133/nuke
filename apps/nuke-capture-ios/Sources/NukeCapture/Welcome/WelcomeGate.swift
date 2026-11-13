// WelcomeGate.swift — when the first-launch welcome shows, and the flag that says it was seen.
//
// The welcome runs once, before sign-in, on a fresh install. It never shows to a signed-in
// user, never while exploring signed out, and never in UI-test / fixture launches. The flag
// flips when the person leaves the welcome ("Look around first") or ends up signed in by any
// route (Apple, email), so signing out later lands on the plain sign-in screen, not the tour.

import Foundation

enum WelcomeGate {
    /// UserDefaults key the root view reads through @AppStorage.
    static let seenKey = "welcomeSeen"

    /// Launch argument that skips the welcome (UI tests, screenshot loops). DEBUG launches
    /// also skip it whenever the fixture backend is active.
    static let skipArgument = "-NukeSkipWelcome"

    static func shouldShow(seen: Bool, signedIn: Bool, exploring: Bool, skip: Bool) -> Bool {
        !seen && !signedIn && !exploring && !skip
    }

    /// Whether this launch must bypass the welcome. `fixtureActive` is only ever true in DEBUG.
    static func launchSkips(arguments: [String], fixtureActive: Bool) -> Bool {
        fixtureActive || arguments.contains(skipArgument)
    }

    static func hasSeen(_ defaults: UserDefaults = .standard) -> Bool {
        defaults.bool(forKey: seenKey)
    }

    static func markSeen(_ defaults: UserDefaults = .standard) {
        defaults.set(true, forKey: seenKey)
    }
}
