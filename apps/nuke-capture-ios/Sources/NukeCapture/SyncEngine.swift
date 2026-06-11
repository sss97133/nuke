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
import Photos

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
    /// Ignition backfill queue depth — TodayView shows this as a ledger row
    /// while the queue drains. 0 = no backfill in flight.
    @Published private(set) var backfillRemaining = 0
    /// The pause toggle (Today tab) — the consent surface now that backfill
    /// starts automatically after site confirm. Paused = nothing uploads:
    /// sync() refuses to run and the backfill loop stops between assets
    /// (the persisted queue keeps the remainder for resume).
    @Published private(set) var isPaused: Bool

    // ─── Persistence (UserDefaults) ──────────────────────────────────────────
    // UserDefaults use is declared in PrivacyInfo.xcprivacy (required-reason
    // API, reason CA92.1 — accessing our own app's defaults).
    private let defaults = UserDefaults.standard
    private enum Key {
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

        for asset in assets {
            // iOS: BGAppRefreshTask expiration cancels this task — stop
            // cleanly; un-processed assets retry next pass because the
            // watermark below only advances on failures == 0.
            if Task.isCancelled { failed += 1; break }

            // ── Gate 1 (privacy, on-device): GPS site-gate ──
            // Confirmed ignition sites; falls back to the hardcoded
            // Config.shopLocations when none are confirmed (migration).
            guard let loc = asset.location,
                  SiteStore.shared.isAtSite(latitude: loc.coordinate.latitude,
                                            longitude: loc.coordinate.longitude) else {
                skipped += 1
                continue
            }

            let filename = Self.originalFilename(for: asset)

            do {
                // Export the ORIGINAL bytes (downloads from iCloud if the
                // local copy is optimized away). Same PHImageManager path as
                // the Mac relay — bytes stay in memory, no temp file needed
                // at shop-photo sizes (3–10 MB).
                let data = try await Self.requestOriginalData(for: asset)

                // ── Dedupe: (filename, size) seen-set ──
                let key = "\(filename)|\(data.count)"
                if seenSet.contains(key) { deduped += 1; continue }

                let meta = PhotoMeta(
                    assetIdentifier: asset.localIdentifier,
                    filename: filename,
                    creationDate: asset.creationDate,
                    latitude: asset.location?.coordinate.latitude,
                    longitude: asset.location?.coordinate.longitude
                )
                try await SupabaseService.uploadPhoto(data: data, meta: meta, userId: userId)

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

        totalSkippedOffShop += skipped
        defaults.set(totalSkippedOffShop, forKey: Key.totalSkipped)

        // Silent-failure law (same as the daemon): advance the watermark ONLY
        // when nothing failed — a failed asset must be retried next pass.
        advanceWatermark(to: runStarted, failures: failed)

        NSLog("NukeCapture sync: %d uploaded, %d off-shop skipped, %d deduped, %d failed",
              uploaded, skipped, deduped, failed)
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
                guard let loc = asset.location,
                      SiteStore.shared.isAtSite(latitude: loc.coordinate.latitude,
                                                longitude: loc.coordinate.longitude) else {
                    skipped += 1
                    continue
                }

                let filename = Self.originalFilename(for: asset)
                do {
                    let data = try await Self.requestOriginalData(for: asset)
                    let key = "\(filename)|\(data.count)"
                    if seenSet.contains(key) {
                        deduped += 1
                        continue
                    }
                    let meta = PhotoMeta(
                        assetIdentifier: asset.localIdentifier,
                        filename: filename,
                        creationDate: asset.creationDate,
                        latitude: asset.location?.coordinate.latitude,
                        longitude: asset.location?.coordinate.longitude
                    )
                    try await SupabaseService.uploadPhoto(data: data, meta: meta, userId: userId)
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
            await Task.yield()
        }

        NSLog("NukeCapture backfill: %d uploaded, %d off-site skipped, %d deduped, %d failed",
              uploaded, skipped, deduped, failed)
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

    // ─── PhotoKit plumbing (identical to Mac) ────────────────────────────────

    /// Original filename (IMG_1234.HEIC) from the asset's resources.
    static func originalFilename(for asset: PHAsset) -> String {
        let resources = PHAssetResource.assetResources(for: asset)
        let photo = resources.first { $0.type == .photo } ?? resources.first
        return photo?.originalFilename ?? "\(asset.localIdentifier.prefix(8)).jpg"
    }

    /// Full-quality original image data; allowed to hit the network for
    /// iCloud-optimized libraries.
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
