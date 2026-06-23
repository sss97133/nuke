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
//   4. Route: signed out → SignInView (the constellation; its Explore path
//      flips exploreMode), exploring → MainTabView (read-only Map + sample
//      profile), signed in + ignition pending → IgnitionView (first-run
//      full-library scan), signed in + ignition complete → MainTabView
//      (MAP · PROFILE · TODAY).

import SwiftUI
import BackgroundTasks

@main
struct NukeCaptureApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var session = SessionStore()
    // Shared singleton — the BG task handler drives the same engine.
    @ObservedObject private var engine = SyncEngine.shared
    /// Ignition phase drives the denied-grant detour (below).
    @ObservedObject private var ignition = IgnitionEngine.shared
    /// Flipped by IgnitionEngine when the first-run sequence completes.
    @AppStorage(IgnitionEngine.completeKey) private var ignitionComplete = false
    /// The constellation's Explore path — the app without auth (read-only
    /// Map + sample profile). Cleared by the Profile tab's Sign In door.
    @AppStorage("exploreMode") private var exploreMode = false

    init() {
        // Must happen during launch: registering after didFinishLaunching
        // returns is a runtime error. SwiftUI App.init() runs early enough.
        Self.registerBackgroundRefresh()
        Self.registerBackgroundBackfill()
        // Existing installs ran the pre-ignition app: they keep the
        // hardcoded shop gate and skip ignition entirely.
        if SyncEngine.hasExistingWatermark,
           !UserDefaults.standard.bool(forKey: IgnitionEngine.completeKey) {
            UserDefaults.standard.set(true, forKey: IgnitionEngine.completeKey)
        }
    }

    var body: some Scene {
        WindowGroup {
            Group {
                #if DEBUG
                // Dev screenshot deep-link: NUKE_DEBUG_VEHICLE_ID=<uuid> roots the
                // app on that vehicle's profile so the build→screenshot→critique
                // loop lands deterministically on the page under work (no fragile
                // coordinate-tapping). DEBUG builds only; never ships.
                if let dbgCohort = ProcessInfo.processInfo.environment["NUKE_DEBUG_COHORT"],
                   !dbgCohort.isEmpty {
                    // NUKE_DEBUG_COHORT="year|make|model" roots on the cohort terminal
                    // so the screenshot loop lands on it without tab/tap navigation.
                    DebugCohortDeepLink(spec: dbgCohort)
                } else if ProcessInfo.processInfo.environment["NUKE_DEBUG_SCREEN"] == "today" {
                    DebugTodayDeepLink()
                } else if ProcessInfo.processInfo.environment["NUKE_DEBUG_SCREEN"] == "signdays" {
                    DebugScreenDeepLink()
                } else if let dbgVehicle = ProcessInfo.processInfo.environment["NUKE_DEBUG_VEHICLE_ID"],
                   !dbgVehicle.isEmpty {
                    DebugVehicleDeepLink(
                        vehicleId: dbgVehicle,
                        field: ProcessInfo.processInfo.environment["NUKE_DEBUG_PROVENANCE_FIELD"]
                    )
                } else {
                    rootView
                }
                #else
                rootView
                #endif
            }
            .environmentObject(session)
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                // Back from Settings with the grant now on? Re-arm ignition
                // (retryAfterSettings no-ops unless phase == .denied).
                if session.isSignedIn, !ignitionComplete {
                    Task { await IgnitionEngine.shared.retryAfterSettings() }
                }
                // Retry geocoding any sites still holding SITE-serial names.
                SiteStore.shared.geocodeStaleSerials()
                // Foreground sync — only once ignition is done. During the
                // scan NOTHING may upload (the UPLOADED 0 gauge is real).
                guard session.isSignedIn, ignitionComplete else { return }
                // BUG #1 defect (c): book the processing-task drain the moment
                // we learn work exists — not only on .background. If on-site
                // photos are owed (backfill queue or fresh captures), the drain
                // is scheduled now so it can run with the screen off later.
                Task {
                    await SyncEngine.shared.start()
                    if SyncEngine.shared.backfillRemaining > 0 {
                        Self.scheduleBackgroundBackfill()
                    }
                }
            case .background:
                // Ask iOS to wake us later. The system decides when (earliest
                // 15 min out; in practice it learns usage patterns).
                Self.scheduleBackgroundRefresh()
                Self.scheduleBackgroundBackfill()
            default:
                break
            }
        }
    }

    /// The normal root routing (extracted so the DEBUG deep-link can bypass it).
    @ViewBuilder private var rootView: some View {
        Group {
            if session.isSignedIn {
                    if ignitionComplete {
                        MainTabView()
                    } else if ignition.phase == .denied {
                        // Photos denied is NOT a dead end: capture is one
                        // grant, not the app. The world (Map + Profile)
                        // stays; Today stays hidden (no grant); Photos·Off
                        // + Settings live in the Account sheet. Granting in
                        // Settings re-arms ignition (scenePhase below).
                        MainTabView()
                    } else {
                        IgnitionView()
                    }
                } else if exploreMode {
                    // Explore: the populated world, read-only. No Today tab
                    // (no grant), Sign In one tap away in Profile.
                    MainTabView()
                } else {
                    SignInView()
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

    // ─── BGProcessingTask: backfill drain ────────────────────────────────────
    // Processing tasks get longer budgets than refresh tasks (~minutes vs ~30 s)
    // and can require power + network — the right vehicle for a 32 K-photo drain.

    private static func registerBackgroundBackfill() {
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: Config.backfillTaskID,
            using: nil
        ) { task in
            guard let processingTask = task as? BGProcessingTask else {
                task.setTaskCompleted(success: false)
                return
            }
            handleBackgroundBackfill(processingTask)
        }
    }

    private static func handleBackgroundBackfill(_ task: BGProcessingTask) {
        // Re-arm before doing any work — if this run is killed, next one is booked.
        scheduleBackgroundBackfill()

        let work = Task { @MainActor in
            // BUG #1: the processing task is the real drain organ — it runs
            // sync() (new on-site photos) AND drainBackfill() (history) until
            // empty, gated to un-metered Wi-Fi (charging is the requiresExternalPower
            // half below). Screen-off ingestion lives here.
            let drained = await SyncEngine.shared.drainUntilEmpty(
                requireWiFi: Config.backfillRequiresWiFi
            )
            // Then ATTRIBUTE: route the day's freshly-uploaded orphans home
            // on-device (VIN-match + session inheritance). This is the nightly
            // charging-window slot — upload, then send photos to their vehicle.
            await AttributionEngine.shared.run()
            // Reschedule when work remains — either the queue still has assets,
            // or the drain bailed early (metered link / paused / cancelled).
            if SyncEngine.shared.backfillRemaining > 0 || !drained {
                scheduleBackgroundBackfill()
            }
            task.setTaskCompleted(success: drained)
        }

        task.expirationHandler = {
            // Cancel the drain loop; the persisted queue keeps the remainder.
            work.cancel()
        }
    }

    /// Schedule the backfill drain processing task.
    /// Safe to call multiple times; duplicate submissions are logged and ignored.
    static func scheduleBackgroundBackfill() {
        let request = BGProcessingTaskRequest(identifier: Config.backfillTaskID)
        request.requiresExternalPower = true
        request.requiresNetworkConnectivity = true
        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            NSLog("NukeCapture: BG backfill submit failed: %@", String(describing: error))
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
        #if DEBUG
        // Simulator walk-through bypass: `-DebugBypassAuth` fakes a signed-in
        // session so the ignition UI can be exercised without a real
        // account. DEBUG builds only; uploads still fail closed (no JWT).
        if ProcessInfo.processInfo.arguments.contains("-DebugBypassAuth") {
            isSignedIn = true
            return
        }
        #endif
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

#if DEBUG
/// Screenshot-loop deep link. Optionally injects a real session (so owner-gated
/// surfaces — ASSET window, investment proof, CONFIRM — render as the actual
/// owner) BEFORE showing the vehicle. Tokens come from NUKE_DEBUG_ACCESS_TOKEN /
/// NUKE_DEBUG_REFRESH_TOKEN, minted out-of-band. DEBUG only; never ships.
private struct DebugVehicleDeepLink: View {
    let vehicleId: String
    let field: String?
    @State private var ready = false

    var body: some View {
        Group {
            if ready {
                VehicleDetailView(vehicleId: vehicleId, debugOpenField: field)
            } else {
                Color(.systemBackground).overlay { ProgressView() }
            }
        }
        .task {
            let env = ProcessInfo.processInfo.environment
            if let at = env["NUKE_DEBUG_ACCESS_TOKEN"], !at.isEmpty,
               let rt = env["NUKE_DEBUG_REFRESH_TOKEN"], !rt.isEmpty,
               SupabaseService.currentUserId == nil {
                do {
                    _ = try await SupabaseService.client.auth.setSession(accessToken: at, refreshToken: rt)
                } catch {
                    NSLog("NukeCapture DEBUG setSession failed: %@", String(describing: error))
                }
                NSLog("NukeCapture DEBUG session injected: currentUserId=%@",
                      SupabaseService.currentUserId ?? "nil")
            }
            ready = true
        }
    }
}

/// Screenshot-loop deep link for the day-confirm surface.
/// NUKE_DEBUG_SCREEN=signdays → roots the app on WorkDaySignView (authed). DEBUG only.
private struct DebugScreenDeepLink: View {
    @State private var ready = false
    var body: some View {
        Group {
            if ready {
                NavigationStack { WorkDaySignView() }
            } else {
                Color(.systemBackground).overlay { ProgressView() }
            }
        }
        .task {
            let env = ProcessInfo.processInfo.environment
            if let at = env["NUKE_DEBUG_ACCESS_TOKEN"], !at.isEmpty,
               let rt = env["NUKE_DEBUG_REFRESH_TOKEN"], !rt.isEmpty,
               SupabaseService.currentUserId == nil {
                _ = try? await SupabaseService.client.auth.setSession(accessToken: at, refreshToken: rt)
            }
            ready = true
        }
    }
}

/// Screenshot-loop deep link for the live-pipeline / Today surface.
/// NUKE_DEBUG_SCREEN=today → roots the app on TodayView (authed) so the ENGINE
/// worklight (the live analysis stream) renders for the real owner. DEBUG only.
private struct DebugTodayDeepLink: View {
    @State private var ready = false
    var body: some View {
        Group {
            if ready {
                TodayView()
            } else {
                Color(.systemBackground).overlay { ProgressView() }
            }
        }
        .task {
            let env = ProcessInfo.processInfo.environment
            if let at = env["NUKE_DEBUG_ACCESS_TOKEN"], !at.isEmpty,
               let rt = env["NUKE_DEBUG_REFRESH_TOKEN"], !rt.isEmpty,
               SupabaseService.currentUserId == nil {
                _ = try? await SupabaseService.client.auth.setSession(accessToken: at, refreshToken: rt)
            }
            ready = true
        }
    }
}

/// Screenshot-loop deep link for the cohort terminal.
/// NUKE_DEBUG_COHORT="year|make|model" → roots the app on that cohort. DEBUG only.
private struct DebugCohortDeepLink: View {
    let spec: String
    private var parsed: (make: String, model: String, year: Int)? {
        let p = spec.split(separator: "|").map(String.init)
        guard p.count == 3, let yr = Int(p[0]) else { return nil }
        return (p[1], p[2], yr)
    }
    var body: some View {
        Group {
            if let c = parsed {
                NavigationStack {
                    CohortTerminalView(make: c.make, model: c.model, year: c.year)
                }
            } else {
                Color(.systemBackground)
            }
        }
    }
}
#endif
