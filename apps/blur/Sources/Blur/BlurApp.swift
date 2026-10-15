// BlurApp.swift — @main entry point.
//
// Unlike the Nuke capture app this is forked from, Blur v0 has NO sign-in
// wall: the free tier is pure local utility, so the app opens straight to the
// galleries. (Accounts appear only at the paid upgrade, a later phase.)
//
// Responsibilities:
//   1. Register the BGAppRefreshTask handler (id ag.nuke.blur.refresh) during
//      launch — Apple requires registration before didFinishLaunching returns,
//      so it lives in App.init().
//   2. Re-scan the library on every foreground (scenePhase .active) and ask
//      iOS to wake us periodically so organization stays current passively.

import SwiftUI
import BackgroundTasks

@main
struct BlurApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var library = LibraryEngine.shared

    init() {
        Self.registerBackgroundRefresh()
    }

    var body: some Scene {
        WindowGroup {
            GalleriesView()
                .environmentObject(library)
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                Task { await LibraryEngine.shared.start() }
            case .background:
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
            let success = await LibraryEngine.shared.rescan()
            task.setTaskCompleted(success: success)
        }

        task.expirationHandler = { work.cancel() }
    }

    private static func scheduleBackgroundRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: Config.refreshTaskID)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 60 * 60)
        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            // Duplicate submissions and simulator unsupported-errors are
            // expected; log, never crash over scheduling.
            NSLog("Blur: BG refresh submit failed: %@", String(describing: error))
        }
    }
}
