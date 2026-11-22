// WorkLiveActivity.swift — drives the photo-work Live Activity (Dynamic Island + Lock Screen).
//
// Replaces the old top-of-app ingest bar (CaptureIngestBar as a safeAreaInset), which showed whenever
// ANY capture_upload_status row existed in the last six hours, finished or not. Rows the server
// leaves at stage "uploaded" for days kept it up indefinitely, and as a top inset it pushed every
// tab down and opened a 340 pt list over the screen when touched.
//
// The rule now: the activity exists only while work is actually moving, and ends itself when it
// stops.
//   * Analysis is live while a row is unsettled AND was created or touched in the last
//     `stallWindow`. A row the server has not moved for that long is not "in progress" any more.
//   * Upload is live while the phone is sending (SyncEngine.isSyncing or a transfer in flight),
//     not while a queue merely waits for a charger, a pause or a cool phone.
//   * Counts are real: analysis shows settled / rows in this run; upload shows photos still owed;
//     the ETA comes only from SyncEngine's measured upload rate. Unknown size = indeterminate.
//   * Updates are coalesced (`minUpdateInterval`) and skipped when nothing visible changed; the
//     end is debounced (`endGrace`) so the gap between an upload pass and the server's first
//     write does not flap the island.
//   * On launch any activity left by an earlier process is adopted only if work is still live
//     after the first read; otherwise it is ended.

import ActivityKit
import Combine
import Foundation

// MARK: - Pure derivation (unit-tested)

enum WorkLiveProgress {
    /// An unsettled row untouched for longer than this is waiting, not working.
    static let stallWindow: TimeInterval = 45 * 60

    struct Uploads: Equatable {
        var sending = false
        var owed = 0
        var perMinute: Double = 0
        /// Paused, too hot or Low Power: nothing will move, so nothing is "in progress".
        var held = false

        static let idle = Uploads()
    }

    /// The rows that are live analysis work right now.
    static func liveRows(_ rows: [CaptureUploadRow], now: Date) -> [CaptureUploadRow] {
        rows.filter { row in
            guard !row.stage.isSettled else { return false }
            guard let touched = [row.updatedAt, row.stepUpdatedAt, row.createdAt].compactMap({ $0 }).max() else { return false }
            return now.timeIntervalSince(touched) <= stallWindow
        }
    }

    /// The earliest moment of the run the live rows belong to (where counting starts).
    static func runStart(_ rows: [CaptureUploadRow], now: Date) -> Date? {
        liveRows(rows, now: now).compactMap { $0.createdAt ?? $0.updatedAt }.min()
    }

    /// The state to show, or nil when nothing is moving (the activity should end).
    /// `since` is when the current run began; rows created since then count toward its total.
    static func state(rows: [CaptureUploadRow], names: [String: String], uploads: Uploads,
                      since: Date?, now: Date) -> NukeWorkAttributes.ContentState? {
        let live = liveRows(rows, now: now)
        let owed = max(0, uploads.owed)
        let uploading = uploads.sending && !uploads.held

        if !live.isEmpty {
            let start = [since, runStart(rows, now: now)].compactMap { $0 }.min() ?? now
            let liveIDs = Set(live.map(\.id))
            let run = rows.filter { row in
                if liveIDs.contains(row.id) { return true }
                guard let t = row.createdAt ?? row.updatedAt else { return false }
                return t >= start
            }
            let settled = run.filter { $0.stage.isSettled }
            let failed = run.filter { $0.stage == .failed }.count
            return .init(phase: .analyzing, completed: settled.count, total: run.count,
                         toUpload: uploading ? owed : 0, failed: failed, etaMinutes: nil,
                         detail: live.allSatisfy({ $0.stage == .uploaded }) && settled.isEmpty
                            ? "waiting for the server" : vehicleDetail(run, names: names))
        }
        if uploading {
            var eta: Int?
            if owed > 0, uploads.perMinute > 0.5 { eta = Int((Double(owed) / uploads.perMinute).rounded(.up)) }
            return .init(phase: .uploading, completed: 0, total: nil, toUpload: owed, failed: 0,
                         etaMinutes: eta, detail: nil)
        }
        return nil
    }

    /// The final frame shown as the activity ends: what this run finished.
    static func doneState(rows: [CaptureUploadRow], since: Date?, last: NukeWorkAttributes.ContentState?) -> NukeWorkAttributes.ContentState {
        var run: [CaptureUploadRow] = []
        if let since {
            run = rows.filter { row in
                guard let t = row.createdAt ?? row.updatedAt else { return false }
                return t >= since
            }
        }
        let settled = run.filter { $0.stage.isSettled }.count
        let failed = run.filter { $0.stage == .failed }.count
        return .init(phase: .done, completed: settled, total: settled > 0 ? settled : last?.total,
                     toUpload: 0, failed: failed, etaMinutes: nil, detail: nil)
    }

    /// "on 1973 Firebird" when the run's attached photos are on one vehicle; nil otherwise.
    static func vehicleDetail(_ run: [CaptureUploadRow], names: [String: String]) -> String? {
        let named = Set(run.filter { $0.isOnVehicle && $0.stage != .failed }
            .map { CaptureIngestSummary.vehicleName(for: $0, names: names) })
            .subtracting([CaptureIngestSummary.fallbackVehicleName])
        guard named.count == 1, let name = named.first else { return nil }
        return "on \(name)"
    }

    /// The fields the island shows; updates that leave these unchanged are skipped.
    static func visiblyDiffers(_ a: NukeWorkAttributes.ContentState?, _ b: NukeWorkAttributes.ContentState?) -> Bool {
        a != b
    }
}

// MARK: - Controller

@MainActor
final class WorkLiveActivityController {
    static let shared = WorkLiveActivityController()

    /// At most one ActivityKit update per this interval; the latest state is sent at the end of it.
    static let minUpdateInterval: TimeInterval = 3
    /// Work must stay gone this long before the activity ends (avoids flapping between phases).
    static let endGrace: TimeInterval = 10
    /// How long the final "Done" frame stays on the Lock Screen.
    static let doneLinger: TimeInterval = 2 * 60
    /// If the app stops updating (suspended), the system marks the activity stale after this.
    static let staleAfter: TimeInterval = 10 * 60
    /// Re-evaluate on a clock too, so a row that stalls ends the activity without a new event.
    static let tick: TimeInterval = 30

    private weak var store: CaptureIngestStore?
    private var cancellables: Set<AnyCancellable> = []
    private var activity: Activity<NukeWorkAttributes>?
    private var runSince: Date?
    private var lastSent: NukeWorkAttributes.ContentState?
    private var lastSentAt: Date = .distantPast
    private var pendingUpdate: Task<Void, Never>?
    private var pendingEnd: Task<Void, Never>?
    private var ticker: Task<Void, Never>?
    private var firstReadDone = false

    private init() {}

    /// True when the user (or the system) allows Live Activities for Nuke.
    var activitiesEnabled: Bool { ActivityAuthorizationInfo().areActivitiesEnabled }

    /// Start following work for the signed-in account. Safe to call again with the same store.
    func attach(store: CaptureIngestStore) {
        if self.store === store, !cancellables.isEmpty { return }
        detachObservers()
        self.store = store
        adoptOrphans()
        let sync = SyncEngine.shared, uploader = BackgroundUploader.shared
        // objectWillChange fires before the value lands; hop a runloop turn and coalesce.
        Publishers.MergeMany(store.objectWillChange.map { _ in () }.eraseToAnyPublisher(),
                             sync.objectWillChange.map { _ in () }.eraseToAnyPublisher(),
                             uploader.objectWillChange.map { _ in () }.eraseToAnyPublisher())
            .debounce(for: .milliseconds(400), scheduler: DispatchQueue.main)
            .sink { [weak self] in MainActor.assumeIsolated { self?.evaluate() } }
            .store(in: &cancellables)
        ticker = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(Self.tick))
                self?.evaluate()
            }
        }
        // The store seeds asynchronously; give the first read a moment before judging orphans.
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(8))
            self?.firstReadDone = true
            self?.evaluate()
        }
        evaluate()
    }

    /// Sign-out / account change: stop following and end whatever is showing.
    func detach() {
        detachObservers()
        store = nil
        Task { await endAll(immediately: true) }
    }

    private func detachObservers() {
        cancellables.removeAll()
        ticker?.cancel(); ticker = nil
        pendingUpdate?.cancel(); pendingUpdate = nil
        pendingEnd?.cancel(); pendingEnd = nil
        firstReadDone = false
    }

    /// Activities a previous process left running: keep at most one (re-judged once the first read
    /// lands), end the rest now.
    private func adoptOrphans() {
        let existing = Activity<NukeWorkAttributes>.activities
        guard activity == nil else { return }
        activity = existing.first
        lastSent = existing.first?.content.state
        for extra in existing.dropFirst() {
            Task { await extra.end(nil, dismissalPolicy: .immediate) }
        }
    }

    private func uploads() -> WorkLiveProgress.Uploads {
        let sync = SyncEngine.shared, uploader = BackgroundUploader.shared
        let owed = max(sync.backfillRemaining, uploader.queuedCount + uploader.inFlightCount)
        return .init(sending: sync.isSyncing || uploader.inFlightCount > 0,
                     owed: owed, perMinute: sync.uploadsPerMinute,
                     held: sync.isPaused || sync.thermalHold)
    }

    func evaluate(now: Date = Date()) {
        guard let store else { return }
        let next = WorkLiveProgress.state(rows: store.rows, names: store.vehicleNames,
                                          uploads: uploads(), since: runSince, now: now)
        if let next {
            pendingEnd?.cancel(); pendingEnd = nil
            if runSince == nil {
                runSince = WorkLiveProgress.runStart(store.rows, now: now) ?? now
            }
            show(next)
        } else if activity != nil || runSince != nil {
            // Orphan from an earlier launch: wait for the first read before ending it.
            if !firstReadDone && lastSentAt == .distantPast { return }
            scheduleEnd()
        }
    }

    // MARK: Start / update (throttled)

    private func show(_ state: NukeWorkAttributes.ContentState) {
        guard activity != nil || activitiesEnabled else { return }
        pendingUpdate?.cancel(); pendingUpdate = nil
        guard WorkLiveProgress.visiblyDiffers(lastSent, state) || activity == nil else { return }
        let wait = Self.minUpdateInterval - Date().timeIntervalSince(lastSentAt)
        if wait <= 0 {
            send(state)
        } else {
            pendingUpdate = Task { [weak self] in
                try? await Task.sleep(for: .seconds(wait))
                guard !Task.isCancelled else { return }
                self?.send(state)
            }
        }
    }

    private func send(_ state: NukeWorkAttributes.ContentState) {
        lastSent = state
        lastSentAt = Date()
        let content = ActivityContent(state: state, staleDate: Date().addingTimeInterval(Self.staleAfter))
        if let activity, activity.activityState == .active || activity.activityState == .stale {
            Task { await activity.update(content) }
            return
        }
        // The old one was dismissed by the user or ended by the system: start a fresh one.
        activity = nil
        do {
            activity = try Activity.request(attributes: NukeWorkAttributes(), content: content, pushType: nil)
        } catch {
            // Starting is refused in the background and when the user switched Live Activities off.
            NSLog("NukeCapture live activity not started: %@", String(describing: error))
        }
    }

    // MARK: End

    private func scheduleEnd() {
        guard pendingEnd == nil else { return }
        pendingEnd = Task { [weak self] in
            try? await Task.sleep(for: .seconds(Self.endGrace))
            guard !Task.isCancelled else { return }
            await self?.finish()
        }
    }

    private func finish() async {
        pendingEnd = nil
        pendingUpdate?.cancel(); pendingUpdate = nil
        let rows = store?.rows ?? []
        let done = WorkLiveProgress.doneState(rows: rows, since: runSince, last: lastSent)
        runSince = nil
        lastSent = nil
        lastSentAt = .distantPast
        guard let activity else { return }
        self.activity = nil
        let content = ActivityContent(state: done, staleDate: nil)
        await activity.end(content, dismissalPolicy: .after(Date().addingTimeInterval(Self.doneLinger)))
        // Anything else of ours still around (a second process's request) goes too.
        for other in Activity<NukeWorkAttributes>.activities where other.id != activity.id {
            await other.end(nil, dismissalPolicy: .immediate)
        }
    }

    private func endAll(immediately: Bool) async {
        activity = nil
        runSince = nil
        lastSent = nil
        lastSentAt = .distantPast
        for a in Activity<NukeWorkAttributes>.activities {
            await a.end(nil, dismissalPolicy: immediately ? .immediate : .default)
        }
    }
}

// MARK: - Deep link

/// The Live Activity's tap lands here: MainTabView presents the per-photo list.
@MainActor
final class WorkProgressRoute: ObservableObject {
    static let shared = WorkProgressRoute()
    @Published var showList = false

    static func handles(_ url: URL) -> Bool {
        url.scheme == NukeWorkFormat.deepLink.scheme && url.host == NukeWorkFormat.deepLinkHost
    }
}
