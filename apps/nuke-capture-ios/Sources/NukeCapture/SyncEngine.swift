// SyncEngine.swift — the capture relay's heart, iOS edition.
//
// PORTED from apps/nuke-capture-mac/Sources/NukeCapture/SyncEngine.swift.
// Logic is identical — watermark + 3-day overlap, (filename,size) seen-set
// capped at 1000, GPS shop-gate, original-bytes export, silent-failure law
// (watermark only advances on a clean pass). Differences from the Mac relay
// are marked "iOS:".
//
//   iOS: ObservableObject + @Published instead of an onStateChange closure
//        (SwiftUI renders state directly).
//   iOS: extra Today-screen counters (uploads today, last sync time, recent
//        upload identifiers for the thumbnail strip).
//   iOS: cancellation checks inside the loop — BGAppRefreshTask gives ~30 s
//        and fires an expiration handler; the loop must stop cleanly so the
//        unfinished assets are retried next pass (watermark won't advance).
//
// Privacy gate parity: the first gate is GPS-at-shop only — a photo shot at
// a registered work location is work evidence by definition; photos with no
// GPS or off-shop are SKIPPED on-device (counted on the Today screen, never
// uploaded). The SERVER pipeline (photo-pipeline-orchestrator vision gate)
// remains the second gate for everything that does upload.

import Foundation
import ImageIO
import Photos
import Supabase
import UIKit

/// One on-device T0 detection — what Apple Vision read off a just-captured frame,
/// on-device, in milliseconds. A DETECTION (a label + confidence), never a claim
/// of labor, value, or intent (those need owner confirmation — the $410 rule).
struct T0Atom: Identifiable, Sendable {
    let assetID: String
    let label: String
    let confidence: Float
    let isVehicle: Bool
    var id: String { assetID }
}

@MainActor
final class SyncEngine: ObservableObject {

    /// iOS: one shared instance — the BGAppRefreshTask handler and the
    /// SwiftUI views must drive the same watermark/seen-set state.
    static let shared = SyncEngine()

    // ─── Published state (SwiftUI renders this) ──────────────────────────────
    @Published private(set) var totalSynced: Int
    @Published private(set) var totalSkippedOffShop: Int
    @Published private(set) var isSyncing = false
    @Published private(set) var lastError: String?
    /// Set when the server refused the session or the app's key (HTTP 401) during a pass. Every
    /// upload stops until a pass succeeds again; the screens say so instead of looking stuck.
    @Published private(set) var authProblem: String?
    /// Photos that failed Config.maxAttemptsPerAsset times and no longer hold the pass back.
    @Published private(set) var gaveUpCount = 0
    /// What the last live pass did, in counts, for the Engine tab: "0 uploaded, 200 failed" was
    /// invisible before, so a stalled sync read as stuck analysis.
    @Published private(set) var lastPassSummary: String?
    @Published private(set) var authorizationDenied = false
    @Published private(set) var lastSyncDate: Date?
    @Published private(set) var uploadsToday: Int
    /// PHAsset.localIdentifier of recent uploads, newest first — the Today
    /// screen renders local thumbnails from these (no network round-trip).
    @Published private(set) var recentUploadIDs: [String]
    /// On-device T0 detections from LIVE captures, newest first — the photo just
    /// shot at the site, read on-device (Apple Vision) the instant it uploads.
    /// Today streams these so the user watches analysis land in seconds. A T0 atom
    /// is a DETECTION (a label), never confirmed labor/value/intent.
    @Published private(set) var liveT0Atoms: [T0Atom] = []
    /// Reconcile pass progress — repairs already-synced rows whose taken_at/GPS
    /// were written from PHAsset.creationDate by an older build. Empty when idle.
    @Published private(set) var reconcileStatus: String = ""
    @Published private(set) var isReconciling = false
    /// Ignition backfill queue depth — TodayView shows this as a ledger row
    /// while the queue drains. 0 = no backfill in flight.
    @Published private(set) var backfillRemaining = 0
    @Published private(set) var backfillError: String?
    /// The pause toggle (Today tab) — the consent surface now that backfill
    /// starts automatically after site confirm. Paused = nothing uploads:
    /// sync() refuses to run and the backfill loop stops between assets
    /// (the persisted queue keeps the remainder for resume).
    @Published private(set) var isPaused: Bool
    /// Count of the user's capture photos that have been vision-analyzed
    /// server-side. Fetched via get_user_analyzed_count RPC after each sync.
    /// This is the SAME predicate the "Analyzed" drill (get_user_analyzed_photos)
    /// uses — source='capture_relay_ios' AND ai_processing_status='analyzed' —
    /// so the count on the gauge and the photos behind it always agree.
    @Published var analyzedCount: Int = 0
    /// The user's REAL server record (not this device's local counters) —
    /// total_images is the full library (~22K), not just what this phone
    /// uploaded. Fetched via get_user_capture_stats. THE web-parity fix:
    /// TodayView headline numbers must read this, never the UserDefaults
    /// counters (see docs/design/WEB_PARITY.md).
    @Published var serverStats: CaptureStats = .zero
    /// False until the FIRST successful get_user_capture_stats load. Today shows
    /// "…" (not a fake "0") for the server metrics while this is false — the cold
    /// RPC can take ~9s, and a 0 placeholder reads as a dead, empty record.
    @Published private(set) var statsLoaded = false
    /// True when the FIRST stats load failed (and none has ever succeeded). Lets
    /// Today distinguish a genuine cold load ("…") from a stuck/failed one
    /// ("couldn't load · retry") instead of an ellipsis that never resolves.
    @Published private(set) var statsError = false

    struct CaptureStats: Decodable {
        let total_images: Int
        let uploaded_today: Int
        let analyzed: Int
        let contribution_days: Int
        static let zero = CaptureStats(total_images: 0, uploaded_today: 0, analyzed: 0, contribution_days: 0)
    }

    /// Ignition scan denominators (PhotoKit). The funnel the owner asked for:
    /// libraryTotal = the WHOLE on-device library counted at ignition (e.g. 76K),
    /// relevantTotal = the confirmed at-site set handed to backfill. Today shows
    /// LIBRARY → RELEVANT instead of only an uploaded count. Written by
    /// IgnitionEngine, read here. RUNS ON: IgnitionEngine.scan (C2/C3).
    @Published private(set) var libraryTotal: Int = 0
    @Published private(set) var relevantTotal: Int = 0
    /// Observed upload throughput of the CURRENT drain (uploads ÷ elapsed
    /// minutes). 0 until a real rate is measured — the ETA reads "estimating…"
    /// rather than fabricating a number (C4: every number real).
    @Published private(set) var uploadsPerMinute: Double = 0

    /// CONTRIBUTOR MODE — true when this device contributes to a shared org
    /// pool rather than the signer's own record. Off by default: the owner flow
    /// is unchanged (an owner's own at-site photos upload ungated — founder
    /// ruling). When ON, every at-site frame must clear the default-exclude
    /// firewall (VisionEngine.contributorVerdict) BEFORE it leaves the phone, so
    /// a private photo shot at the shop never reaches the pool.
    @Published private(set) var contributorMode: Bool
    /// Frames the contributor gate held back (clutter, or a prominent face and
    /// no vehicle). Honest counter — the held photos stayed on the device, never sent.
    @Published private(set) var totalHeldPrivate: Int

    // ─── Persistence (UserDefaults) ──────────────────────────────────────────
    // UserDefaults use is declared in PrivacyInfo.xcprivacy (required-reason
    // API, reason CA92.1 — accessing our own app's defaults).
    private let defaults = UserDefaults.standard
    // Internal (not private): IgnitionEngine writes libraryTotal/relevantTotal
    // through these same keys so there is one source of key strings.
    enum Key {
        static let watermark = "lastSyncWatermark"      // Date — creationDate high-water mark
        static let seenSet = "seenUploads"              // [String] "filename|bytes", capped
        static let totalSynced = "totalSynced"
        static let totalSkipped = "totalSkippedOffShop"
        static let lastSyncDate = "lastSyncDate"        // iOS: Today screen
        static let todayKey = "uploadsTodayKey"         // iOS: "yyyy-MM-dd" the count belongs to
        static let todayCount = "uploadsTodayCount"     // iOS: uploads on that day
        static let recentUploads = "recentUploadIDs"    // iOS: [String] asset identifiers
        static let paused = "syncPaused"                // Bool — the Today pause toggle
        static let backfillQueue = "backfillQueue"      // [String] asset ids still owed
        static let libraryTotal = "libraryPhotoTotal"   // Int — whole library counted at ignition
        static let relevantTotal = "relevantPhotoTotal" // Int — confirmed at-site set handed to backfill
        static let contributorMode = "contributorMode"  // Bool — this device contributes to an org pool
        static let totalHeldPrivate = "totalHeldPrivate" // Int — frames the contributor gate held back
        static let seenAssets = "seenAssetIDs"          // [String] PHAsset ids settled, capped (Config.seenAssetCap)
        static let failedAttempts = "assetFailedAttempts" // [String: Int] attempts per asset that failed
    }

    /// Dedupe set: "filename|size" of everything already uploaded. Ordered
    /// oldest→newest so capping drops the oldest entries.
    private var seenSet: [String]
    /// PHAsset ids already settled, oldest first; the Set mirrors it for lookups.
    private var seenAssetOrder: [String]
    private var seenAssetIDs: Set<String>
    private var failedAttempts: [String: Int]

    private var changeObserver: PhotoLibraryObserver?

    // ─── Thermal and power hold ────────────────────────────────────────────────
    // The drain and the sync pass stop between photos when iOS reports the device
    // seriously hot or Low Power Mode is on, and resume on their own when it cools or
    // the mode is turned off. The queue is persisted, so nothing is lost. Before this,
    // nothing in the app read the thermal state (owner, 2026-10-13: "the phone gets
    // HELLA hot once I open the app").
    @Published private(set) var thermalHold = false
    /// Set when a foreground pass stopped at its budget with work left for the background job.
    @Published private(set) var foregroundBudgetReached = false
    private var thermalObserver: NSObjectProtocol?
    private var powerObserver: NSObjectProtocol?
    private var batteryObserver: NSObjectProtocol?

    /// True when the device should not be doing bulk photo work right now.
    /// Warm already (fair or above) or Low Power Mode: a foreground backfill slice waits for the
    /// background job instead of adding heat while the owner holds the phone.
    static var deviceWarm: Bool {
        let p = ProcessInfo.processInfo
        return p.thermalState.rawValue >= ProcessInfo.ThermalState.fair.rawValue || lowPowerHolds
    }
    /// Plugged in (charging or full).
    static var onExternalPower: Bool {
        let d = UIDevice.current
        if !d.isBatteryMonitoringEnabled { d.isBatteryMonitoringEnabled = true }
        return d.batteryState == .charging || d.batteryState == .full
    }
    /// Low Power Mode holds photo work only on battery. On a charger the battery it protects is
    /// filling, so only heat holds uploads. On 2026-10-15 the owner's phone (build 116) kept Low
    /// Power Mode on all day, and its charging background job at 19:35Z on Wi-Fi uploaded nothing.
    static var lowPowerHolds: Bool {
        ProcessInfo.processInfo.isLowPowerModeEnabled && !onExternalPower
    }
    /// Seriously hot: nothing reads originals, not even the newest photos.
    static var deviceTooHot: Bool {
        let t = ProcessInfo.processInfo.thermalState
        return t == .serious || t == .critical
    }
    static var deviceTooHotOrLow: Bool {
        deviceTooHot || lowPowerHolds
    }
    private func refreshThermalHold() {
        let hold = Self.deviceTooHotOrLow
        if hold != thermalHold { thermalHold = hold }
    }
    private func observeThermalAndPower() {
        let center = NotificationCenter.default
        thermalObserver = center.addObserver(forName: ProcessInfo.thermalStateDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in await self?.thermalOrPowerChanged() }
        }
        powerObserver = center.addObserver(forName: .NSProcessInfoPowerStateDidChange, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in await self?.thermalOrPowerChanged() }
        }
        // Plugging in lifts a Low Power Mode hold.
        UIDevice.current.isBatteryMonitoringEnabled = true
        batteryObserver = center.addObserver(forName: UIDevice.batteryStateDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in await self?.thermalOrPowerChanged() }
        }
        refreshThermalHold()
    }
    private func thermalOrPowerChanged() async {
        let was = thermalHold
        refreshThermalHold()
        // Cooled down, Low Power Mode off, or plugged in: pick the persisted queue back up.
        if was, !thermalHold, started, !isPaused { await resumeBackfillIfNeeded() }
    }
    private var pendingRescan: Task<Void, Never>?
    private var started = false

    private init() {
        defer { observeThermalAndPower() }
        totalSynced = defaults.integer(forKey: Key.totalSynced)
        totalSkippedOffShop = defaults.integer(forKey: Key.totalSkipped)
        seenSet = defaults.stringArray(forKey: Key.seenSet) ?? []
        seenAssetOrder = defaults.stringArray(forKey: Key.seenAssets) ?? []
        seenAssetIDs = Set(seenAssetOrder)
        failedAttempts = (defaults.dictionary(forKey: Key.failedAttempts) as? [String: Int]) ?? [:]
        gaveUpCount = failedAttempts.values.filter { $0 >= Config.maxAttemptsPerAsset }.count
        lastSyncDate = defaults.object(forKey: Key.lastSyncDate) as? Date
        recentUploadIDs = defaults.stringArray(forKey: Key.recentUploads) ?? []
        isPaused = defaults.bool(forKey: Key.paused)
        backfillRemaining = (defaults.stringArray(forKey: Key.backfillQueue) ?? []).count
        libraryTotal = defaults.integer(forKey: Key.libraryTotal)
        relevantTotal = defaults.integer(forKey: Key.relevantTotal)
        contributorMode = defaults.bool(forKey: Key.contributorMode)
        totalHeldPrivate = defaults.integer(forKey: Key.totalHeldPrivate)
        // Day-scoped counter: only valid if it was written today.
        if defaults.string(forKey: Key.todayKey) == Self.dayKey(for: Date()) {
            uploadsToday = defaults.integer(forKey: Key.todayCount)
        } else {
            uploadsToday = 0
        }
    }

    // ─── Lifecycle ───────────────────────────────────────────────────────────

    /// Request Photos read-write access (write: future phases mark synced
    /// assets), register the change observer, run the first sync. Safe to
    /// call repeatedly (foreground transitions) — sync and queued history resume.
    func start() async {
        if started {
            await sync()
            // One open spends one foreground budget: when the live pass used it, the queue waits.
            if !foregroundBudgetReached { await resumeBackfillIfNeeded() }
            return
        }

        let status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        guard status == .authorized || status == .limited else {
            authorizationDenied = true
            lastError = "Photos access denied — enable it in Settings → Privacy & Security → Photos → Nuke"
            return
        }
        authorizationDenied = false
        started = true

        // PHPhotoLibraryChangeObserver: the library pokes us whenever assets
        // change while the app is alive — same event-driven idle as the Mac
        // relay. (In the background, BGAppRefreshTask is the heartbeat —
        // see NukeCaptureApp.swift.)
        let observer = PhotoLibraryObserver { [weak self] in
            Task { @MainActor in self?.scheduleSync() }
        }
        PHPhotoLibrary.shared().register(observer)
        changeObserver = observer

        await sync()
        // A backfill interrupted by an app kill (or a pause) left its queue
        // persisted — pick it back up.
        await resumeBackfillIfNeeded()
        await refreshAnalyzedCount()
        // Pull server sites (F5 — survive fresh installs)
        await SiteStore.shared.fetchAndMergeServerSites()
    }

    /// The Today tab's pause toggle. Pausing stops the backfill loop between
    /// assets (queue stays persisted) and blocks sync passes; resuming
    /// restarts the drain immediately.
    func setPaused(_ paused: Bool) {
        isPaused = paused
        defaults.set(paused, forKey: Key.paused)
        if !paused {
            Task { await self.resumeBackfillIfNeeded(); await self.sync() }
        }
    }

    /// Turn the contributor firewall on/off for this device. Set from
    /// onboarding when the signer joins an org as crew (membership confirmed via
    /// SupabaseService.fetchActiveOrgMemberships). Persisted; survives relaunch.
    func setContributorMode(_ on: Bool) {
        contributorMode = on
        defaults.set(on, forKey: Key.contributorMode)
    }

    /// The contributor firewall. A hold keeps this frame out of the
    /// pool. Loads the LOCAL downscaled frame (no network) and runs
    /// `VisionEngine.contributorVerdict`, the device rule of record (hold clutter
    /// and personal). Only ever consulted when contributorMode is true.
    private func contributorGateVerdict(assetID: String) async -> VisionEngine.ContributorVerdict {
        guard let cg = await VisionEngine.loadCGImage(assetID: assetID, allowNetwork: false) else {
            // No local frame (an iCloud-only original): requestOriginalData defers it, and once the
            // bytes are local `prepare` runs the same triage, so clutter and personal frames upload
            // as metadata only.
            return .allow
        }
        return VisionEngine.contributorVerdict(cg)
    }

    private func recordHeldPrivate(_ n: Int) {
        guard n > 0 else { return }
        totalHeldPrivate += n
        defaults.set(totalHeldPrivate, forKey: Key.totalHeldPrivate)
    }

    /// Debounce: library changes arrive in bursts (iCloud import storms);
    /// coalesce into one pass 5 s after the last poke.
    func scheduleSync() {
        pendingRescan?.cancel()
        pendingRescan = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            guard !Task.isCancelled else { return }
            await self?.sync()
        }
    }

    // ─── Analyzed count (vision pipeline) ───────────────────────────────────

    /// Fetch the count of this user's capture photos that have been
    /// vision-analyzed. Fast + capture-scoped (get_user_analyzed_count is a
    /// sargable count over source='capture_relay_ios'); never the all-sources
    /// aggregate that times out on heavy libraries. No-op when not signed in.
    /// Silent on error — the metric is informational, never an error banner.
    func refreshAnalyzedCount() async {
        guard let userId = SupabaseService.currentUserId else {
            serverStats = .zero
            analyzedCount = 0
            return
        }
        do {
            // serverStats = the capture record: total_images / uploaded_today /
            // contribution_days. WARNING: get_user_capture_stats.analyzed is the
            // work_sessions image_count ROLLUP (frames TOUCHED by work sessions,
            // ~12,100) — NOT the count of vision-analyzed images. We deliberately
            // do NOT bind the "analyzed" metric to it (that 68x-inflated number is
            // what the headline used to show while the drill resolved to 176).
            let response = try await SupabaseService.client
                .rpc("get_user_capture_stats", params: ["p_user_id": userId])
                .execute()
            if let stats = try JSONDecoder().decode([CaptureStats].self, from: response.data).first {
                serverStats = stats
                statsLoaded = true
                statsError = false
            } else if !statsLoaded {
                // 200 but an empty/undecodable body before any success — surface it,
                // don't sit on a permanent "…" (the request "worked" but gave nothing).
                statsError = true
            }
            // analyzedCount = the REAL vision-analyzed image count
            // (get_user_analyzed_count — sargable over source='capture_relay_ios',
            // = 176), which is EXACTLY what the AnalyzedPhotos drill resolves to.
            // This is the number the "ANALYZED" headline must show.
            let countResp = try await SupabaseService.client
                .rpc("get_user_analyzed_count", params: ["p_user_id": userId])
                .execute()
            if let n = (try? JSONDecoder().decode(Int.self, from: countResp.data))
                        ?? (try? JSONDecoder().decode([Int].self, from: countResp.data))?.first {
                analyzedCount = n
            }
        } catch {
            // Only flag while we've never loaded — a failed REFRESH must not blank
            // numbers already on screen.
            if !statsLoaded { statsError = true }
            NSLog("NukeCapture: refreshAnalyzedCount failed: %@", String(describing: error))
        }
    }

    /// Re-read the ignition denominators. Called by IgnitionEngine right after
    /// it writes them, because this singleton may have initialized before the
    /// first-run scan finished (init would have read zeros).
    func refreshLibraryCounts() {
        libraryTotal = defaults.integer(forKey: Key.libraryTotal)
        relevantTotal = defaults.integer(forKey: Key.relevantTotal)
    }

    // ─── The sync pass ───────────────────────────────────────────────────────

    /// One full pass. Returns true when the pass completed with zero
    /// failures (the BGAppRefreshTask handler reports this to the system via
    /// setTaskCompleted(success:)).
    @discardableResult
    func sync() async -> Bool {
        guard !isSyncing else { return false }
        guard !authorizationDenied, !isPaused else {
            report("ios_sync_skipped", [:], extra: ["reason": isPaused ? "paused" : "photos_denied"])
            return false
        }
        guard let userId = SupabaseService.currentUserId else {
            lastError = "Not signed in"
            return false
        }
        isSyncing = true
        lastError = nil
        defer {
            isSyncing = false
            lastSyncDate = Date()
            defaults.set(lastSyncDate, forKey: Key.lastSyncDate)
        }

        let runStarted = Date()
        let watermark = (defaults.object(forKey: Key.watermark) as? Date)
            ?? Date(timeIntervalSinceNow: -Config.firstRunLookback)

        // Watermark caveat (same as Mac): PHAsset has no public "date added
        // to library", so we watermark on creationDate. iCloud can deliver a
        // photo days after it was taken, so we re-scan a 3-day overlap behind
        // the watermark and let the seen-set dedupe re-finds.
        let overlap: TimeInterval = 3 * 24 * 3600
        let fetchFrom = watermark.addingTimeInterval(-overlap)

        let options = PHFetchOptions()
        options.predicate = NSPredicate(
            format: "creationDate > %@ AND mediaType == %d",
            fetchFrom as NSDate, PHAssetMediaType.image.rawValue
        )
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: true)]
        options.fetchLimit = Config.maxPerRun

        let fetch = PHAsset.fetchAssets(with: options)
        var assets: [PHAsset] = []
        fetch.enumerateObjects { asset, _, _ in assets.append(asset) }

        // Newest first: the last three days lead every pass, so a frame shot this morning uploads
        // on the next open even while the watermark window is months behind. On 2026-10-15 the
        // owner's window started in June; every pass re-read the same 200 June photos (all in
        // iCloud, deferred) and the morning's measurement shots never came up.
        let recentOptions = PHFetchOptions()
        recentOptions.predicate = NSPredicate(
            format: "creationDate > %@ AND mediaType == %d",
            Date(timeIntervalSinceNow: -Config.recentFirstWindow) as NSDate, PHAssetMediaType.image.rawValue
        )
        recentOptions.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        recentOptions.fetchLimit = Config.maxPerRun
        var recent: [PHAsset] = []
        PHAsset.fetchAssets(with: recentOptions).enumerateObjects { asset, _, _ in recent.append(asset) }
        let recentIDs = Set(recent.map(\.localIdentifier))
        let ordered = recent + assets.filter { !recentIDs.contains($0.localIdentifier) }

        guard !ordered.isEmpty else {
            advanceWatermark(to: runStarted, failures: 0)
            await SubjectResolutionEngine.shared.runAfterSync(userId: userId)
            await SubjectResolutionEngine.shared.runHistoricalAfterSync(userId: userId)
            return true
        }

        var uploaded = 0, skipped = 0, deduped = 0, failed = 0
        var heldPrivate = 0   // contributor-mode firewall holds (face / not-a-vehicle)
        var metadataOnly = 0  // owner-triage: row uploaded WITHOUT pixels (personal/sensitive — alibi metadata only)
        var t0Fired = 0   // cap on-device T0 per sync — never thrash the ANE on a bulk catch-up
        var deferred = 0  // originals in iCloud, left for the background job
        // With the app open, a pass reads and uploads at most the foreground budget, paced, and
        // leaves the rest to the next pass or the background job. A phone months behind (its
        // watermark stuck since June) would otherwise push ~200 originals on the first open.
        let foreground = UIApplication.shared.applicationState != .background
        var byteWork = 0
        foregroundBudgetReached = false
        // Originals only in iCloud go to the backfill queue, which the background job drains with
        // network; they no longer hold the watermark (a window of them used to stall it for good).
        var deferredIDs: [String] = []
        var gates: [String: Int] = [:]      // why photos were skipped, for the pass report
        var stopReason: String?

        for asset in ordered {
            // iOS: BGAppRefreshTask expiration cancels this task — stop
            // cleanly; un-processed assets retry next pass because the
            // watermark below only advances on failures == 0.
            if Task.isCancelled { failed += 1; break }
            // A seriously hot device stops here; the watermark does not advance past this pass
            // (failures > 0), so the remainder is re-found when it cools.
            if Self.deviceTooHot { refreshThermalHold(); failed += 1; stopReason = "hot"; break }
            // Low Power Mode is a battery choice the owner may keep on all day: it used to stop
            // every upload (build 116 sent nothing). Now the last three days still upload, in a
            // smaller slice; the older window waits until it is off or the phone is plugged in.
            let lowPower = Self.lowPowerHolds
            if lowPower, !recentIDs.contains(asset.localIdentifier) {
                failed += 1; stopReason = "low_power_window"; break
            }
            let budget = lowPower ? Config.lowPowerRecentBudget : Config.foregroundBackfillBudget
            if foreground, byteWork >= budget {
                foregroundBudgetReached = true
                failed += 1   // holds the watermark; settled photos are skipped cheaply next pass
                stopReason = "budget"
                break
            }

            var stop = false
            let outcome = await processAsset(asset, userId: userId)
            switch outcome {
            case .uploaded, .notOwnCamera, .failed:
                byteWork += 1
                if foreground { try? await Task.sleep(for: .milliseconds(Config.foregroundBackfillPaceMs)) }
            default: break
            }
            switch outcome {
            case .uploaded(let pixels):
                uploaded += 1
                if !pixels { metadataOnly += 1 }
                // LIVE T0: read the just-captured frame on-device (Apple Vision)
                // the instant it uploads, so the user watches the analysis land in
                // seconds. LIVE sync ONLY (this loop) — NEVER the backfill drain,
                // which would thrash the Neural Engine over thousands of frames.
                if t0Fired < 8 {
                    t0Fired += 1
                    let t0id = asset.localIdentifier
                    Task { [weak self] in
                        guard let self, let atom = await SyncEngine.analyzeT0(assetID: t0id) else { return }
                        self.addLiveT0(atom)
                    }
                }
            case .offSite(let reason):
                skipped += 1
                gates[reason, default: 0] += 1
                VisionDecisionLog.shared.record(.init(assetId: asset.localIdentifier, source: "sync",
                    category: VisionDecisionRecord.gateCategory, reason: reason))
            case .notOwnCamera:
                skipped += 1
                gates["not_own_camera", default: 0] += 1
                VisionDecisionLog.shared.record(.init(assetId: asset.localIdentifier, source: "sync",
                    category: VisionDecisionRecord.gateCategory, reason: "not_own_camera"))
            case .heldPrivate:
                heldPrivate += 1
            case .deduped:
                deduped += 1
            case .gaveUp:
                gates["gave_up", default: 0] += 1   // failed Config.maxAttemptsPerAsset times; holds nothing back
            case .deferred:
                // In iCloud only: the background job downloads it on Wi-Fi. Not an attempt against
                // the photo, and not a failure that holds the watermark.
                deferred += 1
                deferredIDs.append(asset.localIdentifier)
            case .authFailed:
                failed += 1
                stop = true
                stopReason = "auth"
            case .failed(let retry):
                if retry { failed += 1 }
                gates["failed", default: 0] += 1
            }
            if stop { break }
        }
        report("ios_sync_pass", [
            "uploaded": uploaded, "metadata_only": metadataOnly, "deduped": deduped, "deferred": deferred,
            "held_private": heldPrivate, "failed": failed, "recent": recent.count, "window": assets.count,
            "page_full": assets.count >= Config.maxPerRun ? 1 : 0,  // a full page every pass with an unmoved watermark = a stuck cursor
        ], extra: ["gates": gates, "stop": stopReason ?? "end",
                   "watermark": ISO8601DateFormatter().string(from: watermark)])
        lastPassSummary = [
            "\(uploaded) uploaded", "\(deduped) already up",
            gates.isEmpty ? nil : "skipped: " + gates.sorted { $0.key < $1.key }
                .map { "\($0.value) \($0.key.replacingOccurrences(of: "_", with: " "))" }.joined(separator: ", "),
            stopReason == "low_power_window" ? "Low Power Mode: older photos wait" : nil,
            stopReason == "hot" ? "phone hot: paused" : nil,
            deferred > 0 ? "\(deferred) in iCloud, wait for the charging job" : nil,
            heldPrivate > 0 ? "\(heldPrivate) held private" : nil,
            failed > 0 ? "\(failed) failed or left for the next pass" : nil,
        ].compactMap { $0 }.joined(separator: " · ") + " · of \(ordered.count) photos in this pass, newest first"
        enqueueBackfill(deferredIDs)

        persistSeenAssets()
        totalSkippedOffShop += skipped
        defaults.set(totalSkippedOffShop, forKey: Key.totalSkipped)
        recordHeldPrivate(heldPrivate)

        // Silent-failure law (same as the daemon): advance the watermark ONLY
        // when nothing failed — a failed asset must be retried next pass.
        // A full page (fetchLimit) means more photos sit past the last one read: move the watermark
        // only to that photo, or the rest of the window would be skipped for good.
        let reachedTo = Self.nextWatermark(pageFull: assets.count >= Config.maxPerRun,
                                           lastReadAt: assets.last?.creationDate,
                                           previous: watermark, runStarted: runStarted, overlap: overlap)
        advanceWatermark(to: reachedTo, failures: failed)

        NSLog("NukeCapture sync: %d uploaded (%d metadata-only), %d off-shop skipped, %d held(private), %d deduped, %d failed",
              uploaded, metadataOnly, skipped, heldPrivate, deduped, failed)
        await refreshAnalyzedCount()
        // A PhotoKit-triggered pass or refresh wake can upload without reopening the app.
        // File mapped albums after that pass too; this path reads metadata, never originals.
        if uploaded > metadataOnly, !Task.isCancelled {
            await AttributionEngine.shared.runAutomatic(limit: 500, ocrBudget: 0)
        }
        // One bounded comparison of already acknowledged sources, including retries from an
        // earlier pass. Visual analysis availability never changes upload or filing success.
        await SubjectResolutionEngine.shared.runAfterSync(userId: userId)
        await SubjectResolutionEngine.shared.runHistoricalAfterSync(userId: userId)
        return failed == 0
    }

    // ─── Pass report ────────────────────────────────────────────────────────────
    //
    // One app_events row per sync pass (insert-only for signed-in clients): the counts, why photos
    // were skipped, what stopped the pass, the device state. Build 113 and 116 uploaded nothing on
    // the owner's phone and the server could not tell why; this is the thing that notices. No
    // coordinates, file names or photo ids leave the phone in it. At most one row a minute.
    private var lastReportAt: Date?
    private func report(_ event: String, _ counts: [String: Int], extra: [String: Any]) {
        if let last = lastReportAt, Date().timeIntervalSince(last) < 60 { return }
        lastReportAt = Date()
        let p = ProcessInfo.processInfo
        var props: [String: AnyJSON] = counts.mapValues { .integer($0) }
        props["build"] = .string(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?")
        props["foreground"] = .bool(UIApplication.shared.applicationState != .background)
        props["thermal"] = .integer(p.thermalState.rawValue)
        props["low_power"] = .bool(p.isLowPowerModeEnabled)
        props["charging"] = .bool(Self.onExternalPower)
        props["paused"] = .bool(isPaused)
        props["sites"] = .integer(SiteStore.shared.sites.count)
        props["backfill_queue"] = .integer(backfillRemaining)
        for (k, v) in extra {
            if let s = v as? String { props[k] = .string(s) }
            else if let d = v as? [String: Int] { props[k] = .object(d.mapValues { .integer($0) }) }
        }
        struct Row: Encodable { let event: String; let props: [String: AnyJSON]; let user_id: String?; let path: String }
        let row = Row(event: event, props: props, user_id: SupabaseService.currentUserId, path: "ios/sync")
        Task.detached {
            do { try await SupabaseService.client.from("app_events").insert(row).execute() }
            catch { NSLog("NukeCapture pass report failed: %@", String(describing: error)) }
        }
    }

    /// Adds assets to the persisted backfill queue (deduplicated), for the background job.
    private func enqueueBackfill(_ ids: [String]) {
        guard !ids.isEmpty else { return }
        var queue = defaults.stringArray(forKey: Key.backfillQueue) ?? []
        var known = Set(queue)
        let add = ids.filter { known.insert($0).inserted }
        guard !add.isEmpty else { return }
        queue.append(contentsOf: add)
        defaults.set(queue, forKey: Key.backfillQueue)
        backfillRemaining = queue.count
    }

    /// Where the cursor goes after a clean pass. A caught-up pass moves to the run start. A full page
    /// moves so the next fetch (cursor minus the overlap) starts one second before the last photo
    /// read. Storing the last photo itself made the next fetch start `overlap` earlier, and when the
    /// page spanned less than the overlap that was the same page again: the owner's cursor sat at
    /// 2026-06-20 for four months (200 photos in about three days). Never moves backward.
    nonisolated static func nextWatermark(pageFull: Bool, lastReadAt: Date?, previous: Date,
                              runStarted: Date, overlap: TimeInterval) -> Date {
        guard pageFull, let last = lastReadAt else { return runStarted }
        let stepped = min(last.addingTimeInterval(overlap - 1), runStarted)
        return max(stepped, previous)
    }

    private func advanceWatermark(to date: Date, failures: Int) {
        if failures == 0 { defaults.set(date, forKey: Key.watermark) }
    }

    /// True when a sync watermark already exists — i.e. this install ran the
    /// pre-ignition app. NukeCaptureApp uses it to skip ignition for
    /// existing users (their gate stays the hardcoded shop list).
    static var hasExistingWatermark: Bool {
        UserDefaults.standard.object(forKey: Key.watermark) != nil
    }

    /// Ignition sets the steady-state starting line: everything before the
    /// scan moment belongs to the backfill, everything after to sync().
    /// Never moves an existing watermark backward or forward.
    func setInitialWatermark(_ date: Date) {
        if defaults.object(forKey: Key.watermark) == nil {
            defaults.set(date, forKey: Key.watermark)
        }
    }

    /// Re-arm ignition: drop the sync watermark (so hasExistingWatermark goes
    /// false and NukeCaptureApp re-pushes IgnitionView) and clear any
    /// in-flight backfill queue. The "ignitionComplete" flag is cleared by
    /// the caller (AccountView). Keeps the seen-set so a re-ignition doesn't
    /// re-upload everything; the server's dedupe tolerance covers the rest.
    func resetForReignition() {
        defaults.removeObject(forKey: Key.watermark)
        defaults.removeObject(forKey: Key.backfillQueue)
        backfillRemaining = 0
    }

    // ─── Ignition backfill ───────────────────────────────────────────────────
    //
    // Starts AUTOMATICALLY after site confirmation (founder ruling: the
    // "UPLOAD N" button gate is gone; consent = the live gauge + the pause
    // toggle in Today). Uploads the given assets (oldest first) through the
    // SAME per-asset path as sync() — site-gate, original bytes,
    // (filename,size) dedupe, vehicle_images row — in capped batches so
    // memory stays flat and the UI breathes between batches.
    //
    // The queue PERSISTS (Key.backfillQueue): an app kill or a pause mid-
    // drain loses nothing — start()/setPaused(false) resume the remainder.
    //
    // Cap note: a multi-thousand-photo backfill overflows the seen-set cap
    // (Config.seenSetCap = 1000); long-tail dedupe is then carried by the
    // server side (storage "already exists" + row duplicate tolerance),
    // same as the Mac relay re-run story.

    func backfill(assetIdentifiers: [String]) async {
        guard !assetIdentifiers.isEmpty else { return }
        var queue = defaults.stringArray(forKey: Key.backfillQueue) ?? []
        var known = Set(queue)
        queue.append(contentsOf: assetIdentifiers.filter { known.insert($0).inserted })
        defaults.set(queue, forKey: Key.backfillQueue)
        backfillRemaining = queue.count
        // Ignition runs with the app open: the same bounded slice as any foreground pass; the
        // charging + Wi-Fi background job carries the rest.
        await drainBackfill(foregroundBudget: Config.foregroundBackfillBudget)
    }

    /// Resume a persisted queue (after relaunch or un-pause). No-op when
    /// the queue is empty.
    /// Foreground resume: budgeted, so an open of the app pushes a bounded slice and
    /// the power + Wi-Fi background job carries the rest.
    func resumeBackfillIfNeeded() async {
        let queue = defaults.stringArray(forKey: Key.backfillQueue) ?? []
        guard !queue.isEmpty else { return }
        backfillRemaining = queue.count
        await drainBackfill(foregroundBudget: Config.foregroundBackfillBudget)
    }

    private func drainBackfill(foregroundBudget: Int? = nil) async {
        guard !isSyncing, !isPaused else { return }
        refreshThermalHold()
        if thermalHold { return }                       // the queue persists; thermalOrPowerChanged resumes it
        if foregroundBudget != nil, Self.deviceWarm { return }   // the background job carries it
        foregroundBudgetReached = false
        var attemptedInPass = 0
        guard let userId = SupabaseService.currentUserId else {
            lastError = "Not signed in"
            return
        }
        isSyncing = true
        lastError = nil
        backfillError = nil
        var uploaded = 0, skipped = 0, deduped = 0, failed = 0
        var heldPrivate = 0   // contributor-mode firewall holds
        var metadataOnly = 0  // owner-triage: row uploaded WITHOUT pixels (alibi metadata only)
        defer {
            isSyncing = false
            lastSyncDate = Date()
            defaults.set(lastSyncDate, forKey: Key.lastSyncDate)
            recordHeldPrivate(heldPrivate)
            NSLog("NukeCapture backfill: %d uploaded (%d metadata-only), %d off-site skipped, %d held(private), %d deduped, %d failed",
                  uploaded, metadataOnly, skipped, heldPrivate, deduped, failed)
        }

        let drainStart = Date()
        var attempted = Set<String>()
        let recoveryMessage = "Some photos couldn't be read or uploaded. They remain queued for retry."

        while true {
            let queue = defaults.stringArray(forKey: Key.backfillQueue) ?? []
            guard !queue.isEmpty else { break }
            if Task.isCancelled || isPaused { return }   // queue stays persisted

            // A failed item stays queued, but gets only one attempt in this pass.
            let slice = Array(queue.lazy.filter { !attempted.contains($0) }
                .prefix(Config.backfillBatchSize))
            guard !slice.isEmpty else { break }
            attempted.formUnion(slice)
            var settled = Set<String>()
            defer {
                // Checkpoint successes and definitive exclusions even on pause
                // or cancellation; preserve failures and newly queued assets.
                let pending = defaults.stringArray(forKey: Key.backfillQueue) ?? []
                let remaining = pending.filter { !settled.contains($0) }
                persistSeenAssets()
                defaults.set(remaining, forKey: Key.backfillQueue)
                backfillRemaining = remaining.count
            }

            let fetch = PHAsset.fetchAssets(withLocalIdentifiers: slice, options: nil)
            var assets: [PHAsset] = []
            fetch.enumerateObjects { asset, _, _ in assets.append(asset) }
            // fetchAssets(withLocalIdentifiers:) does not guarantee order —
            // restore oldest-first inside the batch.
            assets.sort { ($0.creationDate ?? .distantPast) < ($1.creationDate ?? .distantPast) }
            let unresolved = Set(slice).subtracting(assets.map(\.localIdentifier))
            if !unresolved.isEmpty {
                failed += unresolved.count
                backfillError = recoveryMessage
            }

            for asset in assets {
                if Task.isCancelled || isPaused { return }
                if Self.deviceTooHotOrLow { refreshThermalHold(); return }   // persisted; resumes on cool-down
                if let budget = foregroundBudget {
                    if attemptedInPass >= budget { foregroundBudgetReached = true; return }
                    attemptedInPass += 1
                    if attemptedInPass > 1 { try? await Task.sleep(for: .milliseconds(Config.foregroundBackfillPaceMs)) }
                }

                // Same per-photo path and gates as sync(): backfill candidates came from
                // confirmed clusters, but the gate is the gate.
                let outcome = await processAsset(asset, userId: userId)
                if Task.isCancelled || isPaused { return }
                switch outcome {
                case .uploaded(let pixels):
                    uploaded += 1
                    if !pixels { metadataOnly += 1 }
                    settled.insert(asset.localIdentifier)
                case .offSite, .notOwnCamera:
                    skipped += 1
                    settled.insert(asset.localIdentifier)
                case .heldPrivate:
                    heldPrivate += 1
                    settled.insert(asset.localIdentifier)
                case .deduped:
                    deduped += 1
                    settled.insert(asset.localIdentifier)
                case .gaveUp:
                    settled.insert(asset.localIdentifier)
                case .deferred:
                    failed += 1                      // stays queued for a Wi-Fi pass
                case .authFailed:
                    failed += 1
                    return                           // queue persists; nothing more can land until sign-in
                case .failed(let retry):
                    if retry {
                        failed += 1
                        backfillError = recoveryMessage
                    } else {
                        settled.insert(asset.localIdentifier)
                    }
                }
            }

            // Honest ETA fuel: the observed rate of THIS drain (uploads ÷
            // elapsed minutes), never an assumed constant (C4).
            let mins = Date().timeIntervalSince(drainStart) / 60.0
            if uploaded > 0, mins > 0.05 { uploadsPerMinute = Double(uploaded) / mins }
            await Task.yield()
        }

    }

    // ─── Unified background drain (BUG #1: ingest with the screen off) ───────
    //
    // The BGProcessingTask's one job. Three defects this fixes, in order:
    //   (a) sync() now runs in the background too — new on-site photos taken
    //       after ignition upload without the app ever being foregrounded.
    //   (b) the Wi-Fi gate (requireWiFi) — a BGProcessingTaskRequest can only
    //       demand "any network", so cellular drains are blocked HERE via
    //       NetworkMonitor before a single byte moves.
    //   (c) the caller reschedules whenever this returns false or leaves the
    //       backfill queue non-empty.
    //
    // This reads LOCAL Photos and uploads them — it must NEVER re-download
    // already-uploaded images from Supabase storage. It does NOT duplicate the
    // per-asset path: it composes the existing sync() (steady-state, advances
    // the watermark only on a clean pass) and drainBackfill() (historical
    // queue) organs, both of which carry the same privacy/ownership gates.
    //
    // Loop shape: one sync() pass picks up post-ignition on-site photos, then
    // drainBackfill() empties the historical queue. We re-loop ONLY while real
    // progress is being made AND the backfill queue is still non-empty, capped
    // at a few iterations so a stuck queue (failing assets) can't spin. Any of
    // {cancelled, paused, link going metered} bails immediately — the persisted
    // queue keeps the remainder for the next scheduled run.
    @discardableResult
    func drainUntilEmpty(requireWiFi: Bool) async -> Bool {
        // (b) Wi-Fi gate — refuse to drain on a metered link; caller reschedules.
        if requireWiFi && !NetworkMonitor.shared.isUnmetered { return false }
        guard !isPaused else { return false }
        guard SupabaseService.currentUserId != nil else {
            lastError = "Not signed in"
            return false
        }

        // Hard cap so a queue that can't drain (every asset failing) can't spin.
        let maxIterations = 5
        var iteration = 0

        while iteration < maxIterations {
            iteration += 1

            // Bail conditions re-checked each iteration: cancellation, the pause
            // toggle, and the link slipping off Wi-Fi mid-drain.
            if Task.isCancelled || isPaused { return false }
            if requireWiFi && !NetworkMonitor.shared.isUnmetered { return false }

            let before = backfillRemaining

            // (a) Steady-state pass — new on-site photos since the watermark.
            // sync() upholds the silent-failure law itself (watermark only
            // advances on failures == 0), so we don't touch the watermark here.
            let syncClean = await sync()

            // Historical queue — drains in batches, persists the remainder.
            await drainBackfill()

            // Done when the queue is empty.
            if backfillRemaining == 0 {
                // Fully drained only counts as success if the sync pass that ran
                // alongside it was also clean (no failed uploads to retry).
                return syncClean
            }
            // A later scheduled/user pass retries failures. Do not repeatedly
            // retry them now just because other photos made progress.
            if backfillError != nil { return false }

            // Re-loop only if the backfill queue actually shrank — otherwise we
            // are wedged (failing/unresolvable assets) and looping won't help.
            if backfillRemaining >= before { return false }
        }

        // Hit the iteration cap with work still owed — caller reschedules.
        return false
    }

    // ─── One photo, the same path for the live pass and the backfill ─────────

    enum AssetOutcome {
        case uploaded(pixels: Bool)
        case offSite(reason: String)   // no_location, off_site, not_library or screenshot
        case notOwnCamera     // no Apple camera EXIF (received, edited elsewhere)
        case heldPrivate      // contributor firewall
        case deduped
        case gaveUp           // failed Config.maxAttemptsPerAsset times already
        case deferred         // original only in iCloud and the link is metered
        case authFailed       // the server refused the session or key: stop the pass
        case failed(retry: Bool)  // retry == false: this failure used the last attempt
    }

    /// What the on-device read of one original found. Computed off the main actor: EXIF parse,
    /// a 512 px decode and the Vision triage used to run on the main thread for every photo.
    struct PreparedOriginal: Sendable {
        let cameraMake: String?
        let cameraModel: String?
        let exifCaptureDate: Date?
        let pixelsEligible: Bool
        let labels: [String]
        var privacyReceipt: DevicePrivacyReceipt? = nil
        /// The on-device rule outcome, for the local decision log (ids and labels only).
        var decision: VisionDecision? = nil
        var scoredLabels: [(String, Float)] = []
        var hasFace = false
    }

    nonisolated static func prepare(_ data: Data, userId: String? = nil,
        cameraInfo: (Data) -> (String?, String?) = { CameraEXIF.cameraInfo(from: $0) },
        decode: (Data) -> CGImage? = { downsampledCGImage(from: $0) },
        triage: (CGImage) -> VisionEngine.TriageResult = { VisionEngine.triage($0) }
    ) async throws -> PreparedOriginal {
        let (make, model) = cameraInfo(data)
        var eligible = false
        var labels: [String] = []
        var privacyReceipt: DevicePrivacyReceipt?
        var decision: VisionDecision?, scored: [(String, Float)] = [], face = false
        // Owner triage only matters for our own camera's frames; skip the decode otherwise.
        if make == "Apple" {
            guard let cg = decode(data) else { throw VisionEngine.TriageFailure.imageUndecodable }
            let t = triage(cg)
            if let failure = t.failure { throw failure }
            labels = t.labels
            eligible = t.pixelsEligible
            decision = t.decision; scored = t.scoredLabels; face = t.hasFace
            if eligible, let evidence = t.privacyEvidence, let userId {
                privacyReceipt = DevicePrivacyReceipt.make(original: data, image: cg, evidence: evidence, userId: userId)
            }
        }
        return PreparedOriginal(cameraMake: make, cameraModel: model,
                                exifCaptureDate: CameraEXIF.captureDate(from: data),
                                pixelsEligible: eligible, labels: labels, privacyReceipt: privacyReceipt,
                                decision: decision, scoredLabels: scored, hasFace: face)
    }

    /// Gates first on metadata alone (no bytes read), then the original, then the upload.
    private func processAsset(_ asset: PHAsset, userId: String) async -> AssetOutcome {
        let id = asset.localIdentifier
        // ── Gate 1 (privacy, on-device): GPS site-gate + ownership check ──
        // Confirmed ignition sites; falls back to the hardcoded
        // Config.shopLocations when none are confirmed (migration).
        // sourceType + mediaSubtypes filter: only user-originated, non-screenshot images.
        guard asset.sourceType == .typeUserLibrary else { return .offSite(reason: "not_library") }
        guard !asset.mediaSubtypes.contains(.photoScreenshot) else { return .offSite(reason: "screenshot") }
        guard let loc = asset.location else { return .offSite(reason: "no_location") }
        guard SiteStore.shared.isAtSite(latitude: loc.coordinate.latitude, longitude: loc.coordinate.longitude) else {
            return .offSite(reason: "off_site")
        }
        // Settled before: skip without reading the original again. The 3-day overlap re-finds
        // every recent photo on each pass, and re-reading those originals was most of a pass.
        if seenAssetIDs.contains(id) { return .deduped }
        if (failedAttempts[id] ?? 0) >= Config.maxAttemptsPerAsset { return .gaveUp }

        // ── Gate 1b (contributor firewall): default-exclude before upload ──
        // Contributor mode only. A private photo shot AT the shop (selfie,
        // paycheck, a person) clears the GPS gate but must NEVER reach the
        // shared pool — hold clutter and personal frames (the triage rule).
        // Owner mode skips this entirely.
        if contributorMode {
            switch await contributorGateVerdict(assetID: id) {
            case .allow: break
            case .hold: return .heldPrivate
            case .unavailable(let reason): return noteFailure(id, message: reason)
            }
        }

        let filename = Self.originalFilename(for: asset)
        let data: Data
        do {
            // The ORIGINAL bytes. An original that lives only in iCloud downloads in the background
            // job on an unmetered link, never while the app is open: it waits (.deferred) instead.
            data = try await Self.requestOriginalData(for: asset, allowNetwork: Self.mayDownloadOriginals)
        } catch is OriginalInCloud {
            return .deferred
        } catch {
            return noteFailure(id, message: "\(filename): \(error.localizedDescription)")
        }

        let prep: PreparedOriginal
        do { prep = try await Self.prepare(data, userId: userId) }
        catch { return noteFailure(id, message: "\(filename): \(error.localizedDescription)") }
        if let decision = prep.decision {
            VisionDecisionLog.shared.record(.init(assetId: id, source: "sync", decision: decision,
                                                  labels: prep.scoredLabels, hasFace: prep.hasFace))
        }
        // ── Gate 2 (ownership): require Apple camera EXIF ──
        // iMessage-received photos have EXIF stripped → make == nil.
        guard prep.cameraMake == "Apple" else { markAssetSeen(id); return .notOwnCamera }

        // ── Dedupe: (filename, size) seen-set, for rows written before asset-level dedupe ──
        let key = "\(filename)|\(data.count)"
        if seenSet.contains(key) { markAssetSeen(id); return .deduped }

        // ── Owner triage (on-device): pixels vs metadata-only ──
        // The completed on-device triage chooses pixels or metadata-only.
        // Clutter and personal frames upload metadata
        // only (EXIF alibi) with the pixels left on the phone. An unavailable
        // privacy read returned above as a retryable failure, never a verdict.
        let meta = PhotoMeta(
            assetIdentifier: id,
            filename: filename,
            creationDate: asset.creationDate,
            exifCaptureDate: prep.exifCaptureDate,
            latitude: asset.location?.coordinate.latitude,
            longitude: asset.location?.coordinate.longitude,
            cameraMake: prep.cameraMake,
            cameraModel: prep.cameraModel,
            sourceType: Self.sourceTypeLabel(for: asset)
        )
        do {
            let acknowledgedHash = try await SupabaseService.uploadPhoto(
                data: data, meta: meta, userId: userId,
                uploadPixels: prep.pixelsEligible, appleMLLabels: prep.labels
            )
            if let acknowledgedHash {
                SubjectResolutionEngine.shared.acknowledge(localIdentifier: id, sourceHash: acknowledgedHash, userId: userId,
                    privacyReceipt: prep.privacyReceipt)
            }
        } catch {
            if SupabaseService.isAuthFailure(error) {
                authProblem = "The server refused this sign-in, so nothing is uploading. Sign out and sign in again."
                lastError = authProblem
                return .authFailed
            }
            return noteFailure(id, message: "\(filename): \(error.localizedDescription)")
        }

        authProblem = nil
        markSeen(key)
        markAssetSeen(id)
        if failedAttempts.removeValue(forKey: id) != nil {
            defaults.set(failedAttempts, forKey: Key.failedAttempts)
        }
        recordUpload(assetIdentifier: id)
        totalSynced += 1
        defaults.set(totalSynced, forKey: Key.totalSynced)
        return .uploaded(pixels: prep.pixelsEligible)
    }

    /// Counts one failed attempt. The last allowed attempt returns retry == false, so the caller
    /// stops holding the watermark or the queue for this photo.
    private func noteFailure(_ id: String, message: String) -> AssetOutcome {
        lastError = message
        let n = (failedAttempts[id] ?? 0) + 1
        failedAttempts[id] = n
        defaults.set(failedAttempts, forKey: Key.failedAttempts)
        if n >= Config.maxAttemptsPerAsset {
            gaveUpCount += 1
            return .failed(retry: false)
        }
        return .failed(retry: true)
    }

    /// iCloud downloads of originals: background (the charging job, a refresh wake) on Wi-Fi only.
    private static var mayDownloadOriginals: Bool {
        NetworkMonitor.shared.isUnmetered && UIApplication.shared.applicationState == .background
    }

    private func markAssetSeen(_ id: String) {
        guard seenAssetIDs.insert(id).inserted else { return }
        seenAssetOrder.append(id)
        if seenAssetOrder.count > Config.seenAssetCap {
            let drop = seenAssetOrder.count - Config.seenAssetCap
            seenAssetOrder.prefix(drop).forEach { seenAssetIDs.remove($0) }
            seenAssetOrder.removeFirst(drop)
        }
        // Written every 25 and at the end of each pass, not per photo (a 5,000-id array).
        if seenAssetOrder.count % 25 == 0 { persistSeenAssets() }
    }

    private func persistSeenAssets() {
        defaults.set(seenAssetOrder, forKey: Key.seenAssets)
    }

    private func markSeen(_ key: String) {
        seenSet.append(key)
        if seenSet.count > Config.seenSetCap {
            seenSet.removeFirst(seenSet.count - Config.seenSetCap)
        }
        defaults.set(seenSet, forKey: Key.seenSet)
    }

    // ─── iOS: Today-screen bookkeeping ───────────────────────────────────────

    private static func dayKey(for date: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = .current
        return f.string(from: date)
    }

    private func recordUpload(assetIdentifier: String) {
        // Day counter — resets when the calendar day changes.
        let today = Self.dayKey(for: Date())
        if defaults.string(forKey: Key.todayKey) != today {
            defaults.set(today, forKey: Key.todayKey)
            uploadsToday = 0
        }
        uploadsToday += 1
        defaults.set(uploadsToday, forKey: Key.todayCount)

        // Thumbnail strip — newest first, capped.
        recentUploadIDs.removeAll { $0 == assetIdentifier }
        recentUploadIDs.insert(assetIdentifier, at: 0)
        if recentUploadIDs.count > Config.recentUploadsCap {
            recentUploadIDs.removeLast(recentUploadIDs.count - Config.recentUploadsCap)
        }
        defaults.set(recentUploadIDs, forKey: Key.recentUploads)
    }

    // ─── On-device T0 (live captures) ────────────────────────────────────────
    //
    // Apple Vision reads the just-captured LOCAL frame in milliseconds — $0, no
    // network, offline-capable. nonisolated so the classify runs OFF the main
    // actor; returns a Sendable atom. Local-only (allowNetwork:false) — never
    // re-downloads from storage. A DETECTION, never confirmed value.

    nonisolated static func analyzeT0(assetID: String) async -> T0Atom? {
        guard let cg = await VisionEngine.loadCGImage(assetID: assetID, allowNetwork: false),
              let cls = VisionEngine.classify(cg),
              let top = cls.labels.first else { return nil }
        return T0Atom(assetID: assetID, label: top.0, confidence: top.1, isVehicle: cls.isVehicle)
    }

    func addLiveT0(_ atom: T0Atom) {
        liveT0Atoms.removeAll { $0.assetID == atom.assetID }
        liveT0Atoms.insert(atom, at: 0)
        if liveT0Atoms.count > 12 { liveT0Atoms.removeLast(liveT0Atoms.count - 12) }
    }

    // ─── Reconcile: repair already-synced rows from the asset's true EXIF ─────
    //
    // Rows written by older builds stored PHAsset.creationDate (the iCloud
    // re-add / migration date) as taken_at and dropped GPS — proven 6 months
    // off on real frames, with the wrong device, while the shutter truth sat in
    // the file the whole time. The forward path (SupabaseService.uploadPhoto)
    // already prefers exifCaptureDate; this is the one-shot mop for the backlog.
    //
    // We DON'T re-walk the library — we drive off the destination rows and join
    // back to the source asset by the localIdentifier stored at upload time
    // (exif_data.uuid), so we touch only rows we actually wrote. Re-reading the
    // asset's original bytes on-device is the same extraction the live sync
    // uses, so the repaired value is identical to a fresh sync. Idempotent.
    func reconcileLibrary() async {
        guard !isReconciling else { return }
        isReconciling = true
        reconcileStatus = "loading…"
        defer { isReconciling = false }

        let targets = await SupabaseService.fetchReconcileTargets()
        guard !targets.isEmpty else { reconcileStatus = "nothing to reconcile"; return }

        var fixed = 0, missing = 0, failed = 0, processed = 0
        for t in targets {
            if Task.isCancelled { break }
            processed += 1
            guard let uuid = t.exif_data?.uuid else { continue }

            // Join destination row → source asset via the stored localIdentifier.
            let fetch = PHAsset.fetchAssets(withLocalIdentifiers: [uuid], options: nil)
            guard let asset = fetch.firstObject else { missing += 1; continue }

            let lat = asset.location?.coordinate.latitude
            let lon = asset.location?.coordinate.longitude
            do {
                let data = try await Self.requestOriginalData(for: asset)
                let exifDate = CameraEXIF.captureDate(from: data)
                // Nothing recoverable ⇒ skip (don't issue an empty PATCH).
                guard exifDate != nil || lat != nil else { continue }
                try await SupabaseService.reconcilePhoto(
                    id: t.id, takenAt: exifDate, latitude: lat, longitude: lon
                )
                fixed += 1
            } catch {
                failed += 1
                lastError = "reconcile \(uuid.prefix(8)): \(error.localizedDescription)"
            }
            if processed % 25 == 0 {
                reconcileStatus = "\(fixed) repaired · \(missing) gone · \(failed) failed (\(processed)/\(targets.count))"
            }
        }
        reconcileStatus = "done: \(fixed) repaired · \(missing) not in library · \(failed) failed"
    }

    // ─── PhotoKit plumbing (identical to Mac) ────────────────────────────────

    /// Human-readable label for PHAsset.sourceType (stored in exif_data).
    static func sourceTypeLabel(for asset: PHAsset) -> String {
        switch asset.sourceType {
        case .typeUserLibrary:  return "user_library"
        case .typeCloudShared:  return "cloud_shared"
        case .typeiTunesSynced: return "itunes_synced"
        default:                return "unknown"
        }
    }

    /// Original filename (IMG_1234.HEIC) from the asset's resources.
    static func originalFilename(for asset: PHAsset) -> String {
        let resources = PHAssetResource.assetResources(for: asset)
        let photo = resources.first { $0.type == .photo } ?? resources.first
        return photo?.originalFilename ?? "\(asset.localIdentifier.prefix(8)).jpg"
    }

    /// Full-quality original image data; allowed to hit the network for
    /// iCloud-optimized libraries.
    /// Decode the already-fetched original bytes into a small CGImage for the
    /// on-device triage classify — reuses the bytes from requestOriginalData
    /// (no second PhotoKit/iCloud round-trip) and thumbnails at ~512px so the
    /// Neural Engine isn't handed a 48 MP original. Returns nil on undecodable
    /// data → upload preparation reports a retryable privacy-read failure.
    nonisolated static func downsampledCGImage(from data: Data, maxPixel: CGFloat = 512) -> CGImage? {
        guard let src = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let opts: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixel,
        ]
        return CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary)
    }

    /// The request is cancelled when the calling task is cancelled or after `timeout` (90 s with
    /// network, 20 s without). With neither, one stalled iCloud download held a pass's lanes and its
    /// `running` flag indefinitely, so every later pass returned at once and analysis looked stuck.
    static func requestOriginalData(for asset: PHAsset, allowNetwork: Bool = true,
                                    timeout: TimeInterval? = nil) async throws -> Data {
        let options = PHImageRequestOptions()
        options.version = .original
        options.deliveryMode = .highQualityFormat
        options.isNetworkAccessAllowed = allowNetwork
        options.isSynchronous = false

        let request = ImageRequestBox()
        let limit = timeout ?? (allowNetwork ? 90 : 20)
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                let id = PHImageManager.default().requestImageDataAndOrientation(
                    for: asset, options: options
                ) { data, _, _, info in
                    guard request.finish() else { return }
                    if let data {
                        continuation.resume(returning: data)
                    } else if !allowNetwork, (info?[PHImageResultIsInCloudKey] as? Bool) == true {
                        continuation.resume(throwing: OriginalInCloud())
                    } else if (info?[PHImageCancelledKey] as? Bool) == true {
                        continuation.resume(throwing: CancellationError())
                    } else {
                        let underlying = info?[PHImageErrorKey] as? NSError
                        continuation.resume(throwing: underlying ?? NSError(
                            domain: "NukeCapture", code: 1,
                            userInfo: [NSLocalizedDescriptionKey: "no image data returned"]
                        ))
                    }
                }
                request.start(id: id, timeout: limit)
            }
        } onCancel: {
            request.cancel()
        }
    }
}

/// One PhotoKit request's id, its timeout, and whether its handler already ran (thread-safe:
/// the handler, the timeout and task cancellation arrive on different threads).
private final class ImageRequestBox: @unchecked Sendable {
    private let lock = NSLock()
    private var id: PHImageRequestID = PHInvalidImageRequestID
    private var done = false
    private var cancelRequested = false
    private var timer: Task<Void, Never>?

    func start(id: PHImageRequestID, timeout: TimeInterval) {
        lock.lock()
        self.id = id
        let cancelNow = cancelRequested && !done
        if !done {
            timer = Task.detached { [weak self] in
                try? await Task.sleep(for: .seconds(timeout))
                if !Task.isCancelled { self?.cancel() }
            }
        }
        lock.unlock()
        if cancelNow { PHImageManager.default().cancelImageRequest(id) }
    }

    /// True the first time only; the handler resumes the continuation exactly once.
    func finish() -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard !done else { return false }
        done = true
        timer?.cancel()
        return true
    }

    func cancel() {
        lock.lock()
        cancelRequested = true
        let id = self.id
        let live = !done && id != PHInvalidImageRequestID
        lock.unlock()
        if live { PHImageManager.default().cancelImageRequest(id) }
    }
}

/// The original is only in iCloud and this request may not download it.
struct OriginalInCloud: Error {}

/// Tiny NSObject shim — PHPhotoLibraryChangeObserver calls arrive on a
/// background queue; we just forward a poke and let SyncEngine hop to the
/// main actor. (Identical to the Mac relay.)
private final class PhotoLibraryObserver: NSObject, PHPhotoLibraryChangeObserver {
    private let onChange: () -> Void
    init(onChange: @escaping () -> Void) { self.onChange = onChange }
    func photoLibraryDidChange(_ changeInstance: PHChange) { onChange() }
}
