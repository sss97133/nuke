// NukeCaptureApp.swift — @main entry point.
//
// Responsibilities:
//   1. Register the BGAppRefreshTask handler (id ag.nuke.capture.refresh)
//      BEFORE app launch finishes — Apple requires registration during
//      launch, so it lives in App.init().
//   2. Schedule the next refresh whenever the app backgrounds.
//   3. Sync on every foreground (scenePhase .active) — iOS gives no daemon,
//      so foreground + periodic background refresh is the heartbeat. The
//      common path is the honest one: the owner takes photos at the shop,
//      opens the app (or iOS wakes it within hours), photos upload.
//   4. Route: signed out → SignInView, signed in → TodayView.

import SwiftUI
import BackgroundTasks

@main
struct NukeCaptureApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var session = SessionStore()
    // Shared singleton — the BG task handler drives the same engine.
    @ObservedObject private var engine = SyncEngine.shared

    init() {
        // Must happen during launch: registering after didFinishLaunching
        // returns is a runtime error. SwiftUI App.init() runs early enough.
        Self.registerBackgroundRefresh()
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if session.isSignedIn {
                    TodayView()
                } else {
                    SignInView()
                }
            }
            .environmentObject(session)
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                // Foreground sync: requests Photos permission on first run,
                // then catches up on anything taken since the last pass.
                guard session.isSignedIn else { return }
                Task { await SyncEngine.shared.start() }
            case .background:
                // Ask iOS to wake us later. The system decides when (earliest
                // 15 min out; in practice it learns usage patterns).
                Self.scheduleBackgroundRefresh()
            default:
                break
            }
        }
    }

    // ─── BGTaskScheduler plumbing ────────────────────────────────────────────

    private static func registerBackgroundRefresh() {
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: Config.refreshTaskID,
            using: nil
        ) { task in
            guard let refreshTask = task as? BGAppRefreshTask else {
                task.setTaskCompleted(success: false)
                return
            }
            handleBackgroundRefresh(refreshTask)
        }
    }

    private static func handleBackgroundRefresh(_ task: BGAppRefreshTask) {
        // Always re-arm first — if this run is killed, the next one is booked.
        scheduleBackgroundRefresh()

        let work = Task { @MainActor in
            let success = await SyncEngine.shared.sync()
            task.setTaskCompleted(success: success)
        }

        // ~30 s budget. On expiration, cancel the loop — SyncEngine checks
        // Task.isCancelled per asset and stops cleanly; the watermark won't
        // advance, so unfinished assets retry next wake.
        task.expirationHandler = {
            work.cancel()
        }
    }

    private static func scheduleBackgroundRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: Config.refreshTaskID)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            // Duplicate submissions and simulator unsupported-errors are
            // expected; log, never crash over scheduling.
            NSLog("NukeCapture: BG refresh submit failed: %@", String(describing: error))
        }
    }
}

/// Watches supabase-swift's auth state stream so the root view flips between
/// SignInView and TodayView the moment sign-in/out/deletion completes.
@MainActor
final class SessionStore: ObservableObject {
    @Published var isSignedIn: Bool = SupabaseService.currentUserId != nil

    private var watcher: Task<Void, Never>?

    init() {
        watcher = Task { [weak self] in
            // Restore the Keychain session (currentUser is only populated
            // after the SDK loads/refreshes it once).
            _ = try? await SupabaseService.client.auth.session
            self?.isSignedIn = SupabaseService.currentUserId != nil

            // Then follow every subsequent auth event.
            for await _ in SupabaseService.client.auth.authStateChanges {
                self?.isSignedIn = SupabaseService.currentUserId != nil
            }
        }
    }

    deinit {
        watcher?.cancel()
    }
}
