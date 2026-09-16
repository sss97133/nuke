// LibraryEngine.swift — the on-device organizer.
//
// FORKED from the Nuke capture app's SyncEngine, with the upload path and GPS
// gate REMOVED — Blur never sends a photo anywhere. What remains is the
// PhotoKit scanning half, repurposed: instead of uploading assets, we read
// Apple's own organization (user albums + smart albums) and present it as
// galleries. The "hidden" set (the blur/curate flags) is persisted locally.
//
// This is the free tier in full. The paid upgrade layers passive clustering
// (Vision feature-prints) on top of this same scan — it does not replace it.

import Foundation
import Photos

@MainActor
final class LibraryEngine: ObservableObject {

    /// One shared instance — the BGAppRefreshTask handler and the SwiftUI
    /// views drive the same state.
    static let shared = LibraryEngine()

    // ─── Published state (SwiftUI renders this) ──────────────────────────────
    @Published private(set) var galleries: [Gallery] = []
    @Published private(set) var isScanning = false
    @Published private(set) var authorizationDenied = false
    @Published private(set) var lastScanDate: Date?

    /// Asset localIdentifiers the user has marked hidden (blurred). Rendered
    /// with a heavy blur and hidden entirely in "Show mode".
    @Published private(set) var hiddenAssetIDs: Set<String> = []

    // ─── Persistence (UserDefaults; required-reason CA92.1) ──────────────────
    private let defaults = UserDefaults.standard
    private enum Key {
        static let hidden = "hiddenAssetIDs"
        static let lastScan = "lastScanDate"
    }

    private var changeObserver: LibraryObserver?
    private var started = false

    private init() {
        if let saved = defaults.stringArray(forKey: Key.hidden) {
            hiddenAssetIDs = Set(saved)
        }
        lastScanDate = defaults.object(forKey: Key.lastScan) as? Date
    }

    // ─── Lifecycle ───────────────────────────────────────────────────────────

    /// Request read access, register the change observer, run the first scan.
    /// Safe to call repeatedly (foreground transitions) — only the scan re-runs.
    func start() async {
        if started { await rescan(); return }

        let status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        guard status == .authorized || status == .limited else {
            authorizationDenied = true
            return
        }
        authorizationDenied = false
        started = true

        let observer = LibraryObserver { [weak self] in
            Task { @MainActor in await self?.rescan() }
        }
        PHPhotoLibrary.shared().register(observer)
        changeObserver = observer

        await rescan()
    }

    // ─── The scan ──────────────────────────────────────────────────────────--

    /// Rebuild the gallery list from Apple's on-device organization. Returns
    /// true on a clean pass (the BG task reports this via setTaskCompleted).
    @discardableResult
    func rescan() async -> Bool {
        guard !isScanning, !authorizationDenied else { return false }
        isScanning = true
        defer {
            isScanning = false
            lastScanDate = Date()
            defaults.set(lastScanDate, forKey: Key.lastScan)
        }

        var built: [Gallery] = []
        built.append(contentsOf: collectGalleries(in: .album, source: .userAlbum))
        built.append(contentsOf: smartGalleries())

        // Drop empties (house rule: no empty shells) and sort user albums first,
        // then by size descending.
        galleries = built
            .filter { $0.count > 0 }
            .sorted { lhs, rhs in
                if lhs.source != rhs.source { return lhs.source == .userAlbum }
                return lhs.count > rhs.count
            }
        return true
    }

    /// User-created albums.
    private func collectGalleries(in type: PHAssetCollectionType, source: GallerySource) -> [Gallery] {
        let collections = PHAssetCollection.fetchAssetCollections(with: type, subtype: .any, options: nil)
        var out: [Gallery] = []
        collections.enumerateObjects { collection, _, _ in
            if let gallery = Self.gallery(from: collection, source: source) { out.append(gallery) }
        }
        return out
    }

    /// A curated set of Apple's smart albums — the free "seed" layer.
    private func smartGalleries() -> [Gallery] {
        let subtypes: [PHAssetCollectionSubtype] = [
            .smartAlbumFavorites,
            .smartAlbumSelfies,
            .smartAlbumScreenshots,
            .smartAlbumPanoramas,
            .smartAlbumBursts,
            .smartAlbumRecentlyAdded,
        ]
        var out: [Gallery] = []
        for subtype in subtypes {
            let collections = PHAssetCollection.fetchAssetCollections(with: .smartAlbum, subtype: subtype, options: nil)
            collections.enumerateObjects { collection, _, _ in
                if let gallery = Self.gallery(from: collection, source: .smartAlbum) { out.append(gallery) }
            }
        }
        return out
    }

    /// Materialize one collection into a Gallery (image assets only, newest first).
    private static func gallery(from collection: PHAssetCollection, source: GallerySource) -> Gallery? {
        let options = PHFetchOptions()
        options.predicate = NSPredicate(format: "mediaType == %d", PHAssetMediaType.image.rawValue)
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]

        let assets = PHAsset.fetchAssets(in: collection, options: options)
        guard assets.count > 0 else { return nil }

        var ids: [String] = []
        ids.reserveCapacity(assets.count)
        assets.enumerateObjects { asset, _, _ in ids.append(asset.localIdentifier) }

        return Gallery(
            id: collection.localIdentifier,
            title: collection.localizedTitle ?? "Untitled",
            source: source,
            assetIDs: ids,
            coverAssetID: ids.first
        )
    }

    // ─── Hidden (blur/curate) state ──────────────────────────────────────────

    func isHidden(_ assetID: String) -> Bool { hiddenAssetIDs.contains(assetID) }

    func toggleHidden(_ assetID: String) {
        if hiddenAssetIDs.contains(assetID) {
            hiddenAssetIDs.remove(assetID)
        } else {
            hiddenAssetIDs.insert(assetID)
        }
        defaults.set(Array(hiddenAssetIDs), forKey: Key.hidden)
    }
}

/// Tiny NSObject shim — PHPhotoLibraryChangeObserver calls arrive on a
/// background queue; forward a poke and let the engine hop to the main actor.
private final class LibraryObserver: NSObject, PHPhotoLibraryChangeObserver {
    private let onChange: () -> Void
    init(onChange: @escaping () -> Void) { self.onChange = onChange }
    func photoLibraryDidChange(_ changeInstance: PHChange) { onChange() }
}
