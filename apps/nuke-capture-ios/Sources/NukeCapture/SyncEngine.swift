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
    /// Ignition backfill queue depth — TodayView shows this as a ledger row
    /// while the queue drains. 0 = no backfill in flight.
    @Published private(set) var backfillRemaining = 0
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
    /// Frames the contributor gate held back (not a vehicle, or a prominent
    /// face). Honest counter — the held photos stayed on the device, never sent.
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
    }

    /// Dedupe set: "filename|size" of everything already uploaded. Ordered
    /// oldest→newest so capping drops the oldest entries.
    private var seenSet: [String]

    private var changeObserver: PhotoLibraryObserver?
    private var pendingRescan: Task<Void, Never>?
    private var started = false

    private init() {
        totalSynced = defaults.integer(forKey: Key.totalSynced)
        totalSkippedOffShop = defaults.integer(forKey: Key.totalSkipped)
        seenSet = defaults.stringArray(forKey: Key.seenSet) ?? []
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
    /// call repeatedly (foreground transitions) — only the sync re-runs.
    func start() async {
        if started { await sync(); return }

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

    /// The contributor firewall. True ⇒ HOLD this frame (do not upload to the
    /// pool). Loads the LOCAL downscaled frame (no network) and runs the
    /// default-exclude verdict: an affirmative vehicle label AND no prominent
    /// face are both required to pass. On image-load failure it HOLDS — a frame
    /// we cannot classify must never auto-cross into a shared pool (fail-safe).
    /// Only ever consulted when contributorMode is true.
    private func contributorGateHolds(assetID: String) async -> Bool {
        guard let cg = await VisionEngine.loadCGImage(assetID: assetID, allowNetwork: false) else {
            return true
        }
        if case .allow = VisionEngine.contributorVerdict(cg) { return false }
        return true
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
        guard !isSyncing, !authorizationDenied, !isPaused else { return false }
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
        guard !assets.isEmpty else {
            advanceWatermark(to: runStarted, failures: 0)
            return true
        }

        var uploaded = 0, skipped = 0, deduped = 0, failed = 0
        var heldPrivate = 0   // contributor-mode firewall holds (face / not-a-vehicle)
        var metadataOnly = 0  // owner-triage: row uploaded WITHOUT pixels (personal/sensitive — alibi metadata only)
        var t0Fired = 0   // cap on-device T0 per sync — never thrash the ANE on a bulk catch-up

        for asset in assets {
            // iOS: BGAppRefreshTask expiration cancels this task — stop
            // cleanly; un-processed assets retry next pass because the
            // watermark below only advances on failures == 0.
            if Task.isCancelled { failed += 1; break }

            // ── Gate 1 (privacy, on-device): GPS site-gate + ownership check ──
            // Confirmed ignition sites; falls back to the hardcoded
            // Config.shopLocations when none are confirmed (migration).
            // sourceType + mediaSubtypes filter: only user-originated, non-screenshot images.
            guard let loc = asset.location,
                  SiteStore.shared.isAtSite(latitude: loc.coordinate.latitude,
                                            longitude: loc.coordinate.longitude),
                  asset.sourceType == .typeUserLibrary,
                  !asset.mediaSubtypes.contains(.photoScreenshot) else {
                skipped += 1
                continue
            }

            // ── Gate 1b (contributor firewall): default-exclude before upload ──
            // Contributor mode only. A private photo shot AT the shop (selfie,
            // paycheck, a person) clears the GPS gate but must NEVER reach the
            // shared pool — hold anything without an affirmative vehicle label
            // or with a prominent face. Owner mode skips this entirely.
            if contributorMode, await contributorGateHolds(assetID: asset.localIdentifier) {
                heldPrivate += 1
                continue
            }

            let filename = Self.originalFilename(for: asset)

            do {
                // Export the ORIGINAL bytes (downloads from iCloud if the
                // local copy is optimized away). Same PHImageManager path as
                // the Mac relay — bytes stay in memory, no temp file needed
                // at shop-photo sizes (3–10 MB).
                let data = try await Self.requestOriginalData(for: asset)

                // ── Gate 2 (ownership): require Apple camera EXIF ──
                // iMessage-received photos have EXIF stripped → make == nil.
                // Screenshots are pre-filtered above but double-gated here.
                let (cameraMake, cameraModel) = CameraEXIF.cameraInfo(from: data)
                guard cameraMake == "Apple" else { skipped += 1; continue }

                // ── Dedupe: (filename, size) seen-set ──
                let key = "\(filename)|\(data.count)"
                if seenSet.contains(key) { deduped += 1; continue }

                // ── Owner triage (on-device): pixels vs metadata-only ──
                // Classify the already-fetched bytes (no second PhotoKit fetch).
                // Pixels upload ONLY when it's vehicle work, no prominent face,
                // and not flagged sensitive; everything else uploads metadata
                // only (EXIF alibi) with the pixels left on the phone. Fail-safe:
                // undecodable/unclassifiable ⇒ metadata-only (mirrors the
                // contributor firewall's "hold if unclassifiable").
                var pixelsEligible = false
                var mlLabels: [String] = []
                if let cg = Self.downsampledCGImage(from: data) {
                    let t = VisionEngine.triage(cg)
                    mlLabels = t.labels
                    pixelsEligible = t.pixelsEligible
                }
                if !pixelsEligible { metadataOnly += 1 }

                let sourceTypeLabel = Self.sourceTypeLabel(for: asset)
                let meta = PhotoMeta(
                    assetIdentifier: asset.localIdentifier,
                    filename: filename,
                    creationDate: asset.creationDate,
                    exifCaptureDate: CameraEXIF.captureDate(from: data),
                    latitude: asset.location?.coordinate.latitude,
                    longitude: asset.location?.coordinate.longitude,
                    cameraMake: cameraMake,
                    cameraModel: cameraModel,
                    sourceType: sourceTypeLabel
                )
                try await SupabaseService.uploadPhoto(
                    data: data, meta: meta, userId: userId,
                    uploadPixels: pixelsEligible, appleMLLabels: mlLabels
                )

                markSeen(key)
                recordUpload(assetIdentifier: asset.localIdentifier)
                uploaded += 1
                totalSynced += 1
                defaults.set(totalSynced, forKey: Key.totalSynced)

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
            } catch {
                failed += 1
                lastError = "\(filename): \(error.localizedDescription)"
            }
        }

        totalSkippedOffShop += skipped
        defaults.set(totalSkippedOffShop, forKey: Key.totalSkipped)
        recordHeldPrivate(heldPrivate)

        // Silent-failure law (same as the daemon): advance the watermark ONLY
        // when nothing failed — a failed asset must be retried next pass.
        advanceWatermark(to: runStarted, failures: failed)

        NSLog("NukeCapture sync: %d uploaded (%d metadata-only), %d off-shop skipped, %d held(private), %d deduped, %d failed",
              uploaded, metadataOnly, skipped, heldPrivate, deduped, failed)
        await refreshAnalyzedCount()
        return failed == 0
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
        defaults.set(assetIdentifiers, forKey: Key.backfillQueue)
        backfillRemaining = assetIdentifiers.count
        await drainBackfill()
    }

    /// Resume a persisted queue (after relaunch or un-pause). No-op when
    /// the queue is empty.
    func resumeBackfillIfNeeded() async {
        let queue = defaults.stringArray(forKey: Key.backfillQueue) ?? []
        guard !queue.isEmpty else { return }
        backfillRemaining = queue.count
        await drainBackfill()
    }

    private func drainBackfill() async {
        guard !isSyncing, !isPaused else { return }
        guard let userId = SupabaseService.currentUserId else {
            lastError = "Not signed in"
            return
        }
        isSyncing = true
        lastError = nil
        defer {
            isSyncing = false
            lastSyncDate = Date()
            defaults.set(lastSyncDate, forKey: Key.lastSyncDate)
        }

        var uploaded = 0, skipped = 0, deduped = 0, failed = 0
        var heldPrivate = 0   // contributor-mode firewall holds
        var metadataOnly = 0  // owner-triage: row uploaded WITHOUT pixels (alibi metadata only)
        let drainStart = Date()

        while true {
            var queue = defaults.stringArray(forKey: Key.backfillQueue) ?? []
            guard !queue.isEmpty else { break }
            if Task.isCancelled || isPaused { return }   // queue stays persisted

            let slice = Array(queue.prefix(Config.backfillBatchSize))

            let fetch = PHAsset.fetchAssets(withLocalIdentifiers: slice, options: nil)
            var assets: [PHAsset] = []
            fetch.enumerateObjects { asset, _, _ in assets.append(asset) }
            // fetchAssets(withLocalIdentifiers:) does not guarantee order —
            // restore oldest-first inside the batch.
            assets.sort { ($0.creationDate ?? .distantPast) < ($1.creationDate ?? .distantPast) }

            for asset in assets {
                if Task.isCancelled || isPaused { return }

                // Same gate as sync() — backfill candidates came from
                // confirmed clusters, but the gate is the gate.
                // sourceType + mediaSubtypes mirror the sync pass filter.
                guard let loc = asset.location,
                      SiteStore.shared.isAtSite(latitude: loc.coordinate.latitude,
                                                longitude: loc.coordinate.longitude),
                      asset.sourceType == .typeUserLibrary,
                      !asset.mediaSubtypes.contains(.photoScreenshot) else {
                    skipped += 1
                    continue
                }

                // Contributor firewall (default-exclude) before any historical
                // photo joins the pool — same gate as the live sync pass.
                if contributorMode, await contributorGateHolds(assetID: asset.localIdentifier) {
                    heldPrivate += 1
                    continue
                }

                let filename = Self.originalFilename(for: asset)
                do {
                    let data = try await Self.requestOriginalData(for: asset)

                    // Gate 2: require Apple camera EXIF (same as sync pass).
                    let (cameraMake, cameraModel) = CameraEXIF.cameraInfo(from: data)
                    guard cameraMake == "Apple" else { skipped += 1; continue }

                    let key = "\(filename)|\(data.count)"
                    if seenSet.contains(key) {
                        deduped += 1
                        continue
                    }

                    // Owner triage — same on-device pixels-vs-metadata-only
                    // decision as the live sync pass (fail-safe to metadata-only).
                    var pixelsEligible = false
                    var mlLabels: [String] = []
                    if let cg = Self.downsampledCGImage(from: data) {
                        let t = VisionEngine.triage(cg)
                        mlLabels = t.labels
                        pixelsEligible = t.pixelsEligible
                    }
                    if !pixelsEligible { metadataOnly += 1 }

                    let sourceTypeLabel = Self.sourceTypeLabel(for: asset)
                    let meta = PhotoMeta(
                        assetIdentifier: asset.localIdentifier,
                        filename: filename,
                        creationDate: asset.creationDate,
                        exifCaptureDate: CameraEXIF.captureDate(from: data),
                        latitude: asset.location?.coordinate.latitude,
                        longitude: asset.location?.coordinate.longitude,
                        cameraMake: cameraMake,
                        cameraModel: cameraModel,
                        sourceType: sourceTypeLabel
                    )
                    try await SupabaseService.uploadPhoto(
                        data: data, meta: meta, userId: userId,
                        uploadPixels: pixelsEligible, appleMLLabels: mlLabels
                    )
                    markSeen(key)
                    recordUpload(assetIdentifier: asset.localIdentifier)
                    uploaded += 1
                    totalSynced += 1
                    defaults.set(totalSynced, forKey: Key.totalSynced)
                } catch {
                    failed += 1
                    lastError = "\(filename): \(error.localizedDescription)"
                }
            }

            // The whole slice is settled (uploaded / skipped / deduped /
            // failed-and-reported) — drop it from the persisted queue.
            // Identifiers that no longer resolve to assets fall out here too.
            queue.removeFirst(min(slice.count, queue.count))
            defaults.set(queue, forKey: Key.backfillQueue)
            backfillRemaining = queue.count
            // Honest ETA fuel: the observed rate of THIS drain (uploads ÷
            // elapsed minutes), never an assumed constant (C4).
            let mins = Date().timeIntervalSince(drainStart) / 60.0
            if uploaded > 0, mins > 0.05 { uploadsPerMinute = Double(uploaded) / mins }
            await Task.yield()
        }

        recordHeldPrivate(heldPrivate)
        NSLog("NukeCapture backfill: %d uploaded (%d metadata-only), %d off-site skipped, %d held(private), %d deduped, %d failed",
              uploaded, metadataOnly, skipped, heldPrivate, deduped, failed)
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

            // Re-loop only if the backfill queue actually shrank — otherwise we
            // are wedged (failing/unresolvable assets) and looping won't help.
            if backfillRemaining >= before { return false }
        }

        // Hit the iteration cap with work still owed — caller reschedules.
        return false
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
    /// data → the caller fails safe to metadata-only.
    nonisolated static func downsampledCGImage(from data: Data, maxPixel: CGFloat = 512) -> CGImage? {
        guard let src = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let opts: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixel,
        ]
        return CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary)
    }

    static func requestOriginalData(for asset: PHAsset) async throws -> Data {
        let options = PHImageRequestOptions()
        options.version = .original
        options.deliveryMode = .highQualityFormat
        options.isNetworkAccessAllowed = true
        options.isSynchronous = false

        return try await withCheckedThrowingContinuation { continuation in
            PHImageManager.default().requestImageDataAndOrientation(
                for: asset, options: options
            ) { data, _, _, info in
                if let data {
                    continuation.resume(returning: data)
                } else {
                    let underlying = info?[PHImageErrorKey] as? NSError
                    continuation.resume(throwing: underlying ?? NSError(
                        domain: "NukeCapture", code: 1,
                        userInfo: [NSLocalizedDescriptionKey: "no image data returned"]
                    ))
                }
            }
        }
    }
}

/// Tiny NSObject shim — PHPhotoLibraryChangeObserver calls arrive on a
/// background queue; we just forward a poke and let SyncEngine hop to the
/// main actor. (Identical to the Mac relay.)
private final class PhotoLibraryObserver: NSObject, PHPhotoLibraryChangeObserver {
    private let onChange: () -> Void
    init(onChange: @escaping () -> Void) { self.onChange = onChange }
    func photoLibraryDidChange(_ changeInstance: PHChange) { onChange() }
}
