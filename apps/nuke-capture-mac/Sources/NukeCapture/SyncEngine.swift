// SyncEngine.swift — the capture relay's heart.
//
// On launch and on every Photos-library change: find image assets newer than
// the watermark, run the GPS shop-gate, export originals, upload + insert.
//
// Privacy gate parity with photo-sync-daemon.mjs: the daemon's FIRST gate was
// Apple's on-device labels (VEHICLE_LABEL_RE) — PhotoKit exposes no labels
// API on macOS, so this app's first gate is GPS-at-shop only: a photo shot at
// a registered work location is work evidence by definition; photos with no
// GPS or off-shop are SKIPPED on-device (counted in the menu, never
// uploaded). The SERVER pipeline (photo-pipeline-orchestrator vision gate)
// remains the second gate for everything that does upload.

import Foundation
import Photos

@MainActor
final class SyncEngine {

    // ─── Published state (AppDelegate renders this into the menu) ───────────
    private(set) var totalSynced: Int
    private(set) var totalSkippedOffShop: Int
    private(set) var isPaused = false
    private(set) var isSyncing = false
    private(set) var lastError: String?
    private(set) var authorizationDenied = false

    /// Fired on the main actor whenever state changes — menu refresh hook.
    var onStateChange: (() -> Void)?

    // ─── Persistence (UserDefaults) ──────────────────────────────────────────
    private let defaults = UserDefaults.standard
    private enum Key {
        static let watermark = "lastSyncWatermark"      // Date — creationDate high-water mark
        static let seenSet = "seenUploads"              // [String] "filename|bytes", capped
        static let totalSynced = "totalSynced"
        static let totalSkipped = "totalSkippedOffShop"
    }

    /// Dedupe set: "filename|size" of everything already uploaded. Ordered
    /// oldest→newest so capping drops the oldest entries.
    private var seenSet: [String]

    private var changeObserver: PhotoLibraryObserver?
    private var pendingRescan: Task<Void, Never>?

    init() {
        totalSynced = defaults.integer(forKey: Key.totalSynced)
        totalSkippedOffShop = defaults.integer(forKey: Key.totalSkipped)
        seenSet = defaults.stringArray(forKey: Key.seenSet) ?? []
    }

    // ─── Lifecycle ───────────────────────────────────────────────────────────

    /// Request Photos read-write access (write: future phases mark synced
    /// assets), register the change observer, run the first sync.
    func start() async {
        let status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        guard status == .authorized || status == .limited else {
            authorizationDenied = true
            lastError = "Photos access denied — grant it in System Settings → Privacy & Security → Photos"
            onStateChange?()
            return
        }

        // PHPhotoLibraryChangeObserver: the library pokes us whenever assets
        // change — this is what lets the app sit idle at ~0% CPU instead of
        // polling like the old launchd daemon did every 15 minutes.
        let observer = PhotoLibraryObserver { [weak self] in
            Task { @MainActor in self?.scheduleSync() }
        }
        PHPhotoLibrary.shared().register(observer)
        changeObserver = observer

        await sync()
    }

    func setPaused(_ paused: Bool) {
        isPaused = paused
        onStateChange?()
        if !paused { scheduleSync() }
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

    func sync() async {
        guard !isPaused, !isSyncing, !authorizationDenied else { return }
        guard let userId = SupabaseService.currentUserId else {
            lastError = "Not signed in"
            onStateChange?()
            return
        }
        isSyncing = true
        lastError = nil
        onStateChange?()
        defer { isSyncing = false; onStateChange?() }

        let runStarted = Date()
        let watermark = (defaults.object(forKey: Key.watermark) as? Date)
            ?? Date(timeIntervalSinceNow: -Config.firstRunLookback)

        // Watermark caveat: PHAsset has no public "date added to library", so
        // we watermark on creationDate. iCloud can deliver a photo days after
        // it was taken (phone offline at the shop), so we re-scan a 3-day
        // overlap behind the watermark and let the seen-set dedupe re-finds.
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
            return
        }

        var uploaded = 0, skipped = 0, deduped = 0, failed = 0

        for asset in assets {
            // ── Gate 1 (privacy, on-device): GPS shop-gate ──
            guard let loc = asset.location,
                  Config.isAtShop(latitude: loc.coordinate.latitude,
                                  longitude: loc.coordinate.longitude) else {
                skipped += 1
                continue
            }

            let filename = Self.originalFilename(for: asset)

            do {
                // Export the ORIGINAL bytes (downloads from iCloud if the
                // local copy is optimized away).
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
                uploaded += 1
                totalSynced += 1
                defaults.set(totalSynced, forKey: Key.totalSynced)
                onStateChange?()
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
    }

    private func advanceWatermark(to date: Date, failures: Int) {
        if failures == 0 { defaults.set(date, forKey: Key.watermark) }
    }

    private func markSeen(_ key: String) {
        seenSet.append(key)
        if seenSet.count > Config.seenSetCap {
            seenSet.removeFirst(seenSet.count - Config.seenSetCap)
        }
        defaults.set(seenSet, forKey: Key.seenSet)
    }

    // ─── PhotoKit plumbing ───────────────────────────────────────────────────

    /// Original filename (IMG_1234.HEIC) from the asset's resources.
    static func originalFilename(for asset: PHAsset) -> String {
        let resources = PHAssetResource.assetResources(for: asset)
        let photo = resources.first { $0.type == .photo } ?? resources.first
        return photo?.originalFilename ?? "\(asset.localIdentifier.prefix(8)).jpg"
    }

    /// Full-quality original image data; allowed to hit the network for
    /// iCloud-optimized libraries (parity with osxphotos --download-missing).
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
/// main actor.
private final class PhotoLibraryObserver: NSObject, PHPhotoLibraryChangeObserver {
    private let onChange: () -> Void
    init(onChange: @escaping () -> Void) { self.onChange = onChange }
    func photoLibraryDidChange(_ changeInstance: PHChange) { onChange() }
}
