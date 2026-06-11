// AppDelegate.swift — the menu-bar UI.
//
// One NSStatusItem, one menu:
//   ● Synced 12 · watching          (status line, disabled)
//   ● Held back 3 (off-shop/no GPS) (privacy-gate counter, disabled)
//   ─────────────
//   Sync now
//   Pause / Resume
//   ─────────────
//   Sign in… / Sign out (email)
//   Start at Login                  (SMAppService.mainApp toggle)
//   ─────────────
//   Quit

import AppKit
import AuthenticationServices
import ServiceManagement

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {

    private var statusItem: NSStatusItem!
    private let engine = SyncEngine()
    /// Retained for the lifetime of the app — ASAuthorizationController's
    /// delegate callbacks need a live object while the Apple sheet is up.
    private let appleSignIn = AppleSignInCoordinator()

    private let statusLine = NSMenuItem(title: "Starting…", action: nil, keyEquivalent: "")
    private let skippedLine = NSMenuItem(title: "", action: nil, keyEquivalent: "")
    private let errorLine = NSMenuItem(title: "", action: nil, keyEquivalent: "")
    private let pauseItem = NSMenuItem(title: "Pause", action: #selector(togglePause), keyEquivalent: "")
    private let signInItem = NSMenuItem(title: "Sign in…", action: #selector(signInOrOut), keyEquivalent: "")
    private let loginItem = NSMenuItem(title: "Start at Login", action: #selector(toggleStartAtLogin), keyEquivalent: "")

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.image = NSImage(
            systemSymbolName: "car.fill",
            accessibilityDescription: "Nuke Capture"
        )

        let menu = NSMenu()
        menu.delegate = self
        for item in [statusLine, skippedLine, errorLine] { item.isEnabled = false }
        menu.addItem(statusLine)
        menu.addItem(skippedLine)
        menu.addItem(errorLine)
        menu.addItem(.separator())
        menu.addItem(makeItem("Sync now", #selector(syncNow)))
        menu.addItem(pauseItem)
        menu.addItem(.separator())
        menu.addItem(signInItem)
        menu.addItem(loginItem)
        menu.addItem(.separator())
        menu.addItem(makeItem("Quit Nuke Capture", #selector(NSApplication.terminate(_:)), key: "q"))
        for item in menu.items where item.action != #selector(NSApplication.terminate(_:)) {
            item.target = self
        }
        statusItem.menu = menu

        engine.onStateChange = { [weak self] in self?.refreshMenu() }
        refreshMenu()

        Task {
            if SupabaseService.currentUserId == nil {
                // No Keychain session yet — first run. Prompt immediately;
                // the engine still starts so the Photos permission dialog
                // appears on launch rather than after sign-in.
                promptSignIn()
            }
            await engine.start()
        }
    }

    private func makeItem(_ title: String, _ action: Selector, key: String = "") -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.target = self
        return item
    }

    // ─── Menu state ──────────────────────────────────────────────────────────

    func menuNeedsUpdate(_ menu: NSMenu) { refreshMenu() }

    private func refreshMenu() {
        let synced = engine.totalSynced
        if SupabaseService.currentUserId == nil {
            statusLine.title = "Not signed in"
        } else if engine.authorizationDenied {
            statusLine.title = "Photos access denied"
        } else if engine.isSyncing {
            statusLine.title = "Synced \(synced) · syncing…"
        } else if engine.isPaused {
            statusLine.title = "Synced \(synced) · paused"
        } else {
            statusLine.title = "Synced \(synced) · watching"
        }

        // The privacy gate made visible: photos that never left the Mac.
        skippedLine.title = "Held back \(engine.totalSkippedOffShop) (off-shop/no GPS)"
        skippedLine.isHidden = engine.totalSkippedOffShop == 0

        errorLine.title = engine.lastError.map { "⚠ \($0)" } ?? ""
        errorLine.isHidden = engine.lastError == nil

        pauseItem.title = engine.isPaused ? "Resume" : "Pause"

        if let email = SupabaseService.currentUserEmail {
            signInItem.title = "Sign out (\(email))"
        } else {
            signInItem.title = "Sign in…"
        }

        loginItem.state = SMAppService.mainApp.status == .enabled ? .on : .off
    }

    // ─── Actions ─────────────────────────────────────────────────────────────

    @objc private func syncNow() {
        Task { await engine.sync() }
    }

    @objc private func togglePause() {
        engine.setPaused(!engine.isPaused)
    }

    @objc private func signInOrOut() {
        if SupabaseService.currentUserId != nil {
            Task {
                try? await SupabaseService.signOut()
                refreshMenu()
            }
        } else {
            promptSignIn()
        }
    }

    /// Sign-in prompt as an NSAlert: "Sign in with Apple" (primary, no
    /// password) alongside the email/password accessory fields. Session lands
    /// in the Keychain (supabase-swift default storage) either way; this runs
    /// once per machine.
    private func promptSignIn() {
        NSApp.activate(ignoringOtherApps: true)

        let alert = NSAlert()
        alert.messageText = "Sign in to Nuke"
        alert.informativeText = "Your photos upload to your own Nuke account. You only do this once — the session is stored in your Keychain."
        alert.addButton(withTitle: "Sign In")                  // .alertFirstButtonReturn (email/password)
        alert.addButton(withTitle: "Sign in with Apple")      // .alertSecondButtonReturn
        alert.addButton(withTitle: "Cancel")                   // .alertThirdButtonReturn (Esc via title)

        let email = NSTextField(frame: NSRect(x: 0, y: 32, width: 260, height: 24))
        email.placeholderString = "email"
        let password = NSSecureTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24))
        password.placeholderString = "password"
        let box = NSView(frame: NSRect(x: 0, y: 0, width: 260, height: 60))
        box.addSubview(email)
        box.addSubview(password)
        alert.accessoryView = box
        alert.window.initialFirstResponder = email

        switch alert.runModal() {
        case .alertSecondButtonReturn:
            signInWithApple()
            return
        case .alertFirstButtonReturn:
            break
        default:
            return
        }
        let emailValue = email.stringValue.trimmingCharacters(in: .whitespaces)
        let passwordValue = password.stringValue
        guard !emailValue.isEmpty, !passwordValue.isEmpty else { return }

        Task {
            do {
                try await SupabaseService.signIn(email: emailValue, password: passwordValue)
                refreshMenu()
                await engine.sync()
            } catch {
                showSignInFailure(error.localizedDescription)
            }
        }
    }

    /// Apple authorization sheet → identity token → Supabase session.
    /// From a bare `swift run` binary the controller fails with
    /// ASAuthorizationError 1000 — the entitlement only exists in the
    /// bundled, signed app (see README → Sign in with Apple), so that case
    /// gets an explanatory message instead of a bare "Unknown error".
    private func signInWithApple() {
        Task {
            do {
                let result = try await appleSignIn.signIn()
                try await SupabaseService.signInWithApple(
                    idToken: result.idToken,
                    nonce: result.nonce
                )
                refreshMenu()
                await engine.sync()
            } catch {
                if let authError = error as? ASAuthorizationError {
                    switch authError.code {
                    case .canceled:
                        return // user dismissed the sheet — not an error
                    case .unknown:
                        showSignInFailure(
                            "Sign in with Apple needs the bundled, signed NukeCapture.app "
                            + "with the Sign in with Apple entitlement — it cannot run from "
                            + "a dev `swift run` binary. Use email/password for dev, or build "
                            + "the signed app (README → Sign in with Apple)."
                        )
                        return
                    default:
                        break
                    }
                }
                showSignInFailure(error.localizedDescription)
            }
        }
    }

    private func showSignInFailure(_ message: String) {
        let fail = NSAlert()
        fail.alertStyle = .warning
        fail.messageText = "Sign-in failed"
        fail.informativeText = message
        fail.runModal()
        refreshMenu()
    }

    /// Launch-at-login via the modern SMAppService API (macOS 13+). Only
    /// works for a BUNDLED app (NukeCapture.app); from a bare `swift run`
    /// binary registration throws — we surface that instead of failing
    /// silently.
    @objc private func toggleStartAtLogin() {
        do {
            if SMAppService.mainApp.status == .enabled {
                try SMAppService.mainApp.unregister()
            } else {
                try SMAppService.mainApp.register()
            }
        } catch {
            let alert = NSAlert()
            alert.alertStyle = .warning
            alert.messageText = "Couldn't change Start at Login"
            alert.informativeText = "\(error.localizedDescription)\n\nNote: this only works for the bundled, signed NukeCapture.app — not a dev `swift run` binary. See README → Signing & Distribution."
            alert.runModal()
        }
        refreshMenu()
    }
}
