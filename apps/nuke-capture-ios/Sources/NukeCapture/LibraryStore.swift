// LibraryStore.swift — the live, lazy data source onto the ENTIRE on-device library.
//
// PhotoKit is the source of truth; the DB is GLASSES laid over it (LibraryGlasses.swift),
// never the container. The scroll path touches ZERO network and ZERO database — every
// cell renders straight from PHCachingImageManager off a lazy PHFetchResult, the exact
// machinery Photos.app uses. The moment the grid waits on a query it stops being
// Photos-fast, so it never does.
//
// Operating table: this file owns ONLY the source + image requests + caching window.
// Glasses → LibraryGlasses.swift · grid screen → LibraryView.swift · fullscreen →
// LibraryDetail.swift.

import Photos
import PhotosUI
import SwiftUI

@MainActor
final class LibraryStore: NSObject, ObservableObject, PHPhotoLibraryChangeObserver {
    static let shared = LibraryStore()

    @Published private(set) var assets: PHFetchResult<PHAsset>
    @Published private(set) var count: Int
    @Published private(set) var albumCatalog: LocalAlbumCatalog?
    @Published private(set) var albumError: String?
    @Published private(set) var refreshingAlbums = false
    private var albumRefreshPending = false

    private let imageManager = PHCachingImageManager()
    private let scale = UIScreen.main.scale
    /// 3-up grid → ~130pt cells; 2x for retina crispness.
    private lazy var thumbSize = CGSize(width: 130 * scale, height: 130 * scale)

    private override init() {
        let opts = PHFetchOptions()
        opts.predicate = NSPredicate(format: "mediaType == %d", PHAssetMediaType.image.rawValue)
        opts.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        let result = PHAsset.fetchAssets(with: opts)
        assets = result
        count = result.count
        super.init()
        albumCatalog = try? LocalStore.shared.latestAlbumCatalog()
        PHPhotoLibrary.shared().register(self)
    }

    func asset(at index: Int) -> PHAsset? {
        guard index >= 0, index < assets.count else { return nil }
        return assets.object(at: index)
    }

    /// Snapshot the newest `limit` assets (newest-first, the fetch order) for the
    /// background LocalStore ingest pass. Main-actor read of the PHFetchResult.
    func newestAssets(_ limit: Int) -> [PHAsset] {
        let n = min(assets.count, limit)
        guard n > 0 else { return [] }
        var out: [PHAsset] = []; out.reserveCapacity(n)
        for i in 0..<n { out.append(assets.object(at: i)) }
        return out
    }

    /// Map local identifiers → their index in THIS fetch result (the grid's index
    /// space), so a day's photos (ordered by EXIF takenAt) can drive the existing
    /// global-index pager + cell. The grid sorts by creationDate, the day by takenAt,
    /// so a day's photos are NOT contiguous here — map per id. Ids no longer in the
    /// library (deleted) drop out (NSNotFound), never a phantom. Main-actor read.
    func indexMap(forLocalIdentifiers lids: [String]) -> [String: Int] {
        guard !lids.isEmpty else { return [:] }
        let fetched = PHAsset.fetchAssets(withLocalIdentifiers: lids, options: nil)
        var out: [String: Int] = [:]
        fetched.enumerateObjects { asset, _, _ in
            let i = self.assets.index(of: asset)
            if i != NSNotFound { out[asset.localIdentifier] = i }
        }
        return out
    }

    /// Metadata-only human pass. No parsing album titles into vehicle IDs, no
    /// photo uploads, and no change to Photos. Limited access cannot fetch user
    /// albums; retain that coverage boundary instead of reporting an empty garage.
    func refreshAlbums() async {
        if refreshingAlbums { albumRefreshPending = true; return }
        refreshingAlbums = true
        defer { refreshingAlbums = false }
        repeat {
            albumRefreshPending = false
            let catalog = await Task.detached(priority: .utility) { Self.readAlbums() }.value
            albumCatalog = catalog
            do {
                try await Task.detached { try LocalStore.shared.recordAlbumCatalog(catalog) }.value
                albumError = nil
            } catch {
                albumError = "Album organization could not be saved. Try again."
            }
        } while albumRefreshPending
    }

    private nonisolated static func readAlbums() -> LocalAlbumCatalog {
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard status == .authorized || status == .limited else {
            return LocalAlbumCatalog(accessScope: "unavailable", observedAt: Date(), albums: [], photos: [])
        }
        let options = PHFetchOptions()
        options.predicate = NSPredicate(format: "mediaType == %d", PHAssetMediaType.image.rawValue)
        var visible: [LocalAlbumPhoto] = []
        PHAsset.fetchAssets(with: options).enumerateObjects { asset, _, _ in
            visible.append(LocalAlbumPhoto(localIdentifier: asset.localIdentifier,
                sourceVersion: asset.modificationDate.map { String($0.timeIntervalSince1970) }))
        }
        if status == .limited {
            return LocalAlbumCatalog(accessScope: "limited", observedAt: Date(), albums: [], photos: visible)
        }
        var paths: [String: [String]] = [:]
        func walk(_ collections: PHFetchResult<PHCollection>, path: [String]) {
            collections.enumerateObjects { collection, _, _ in
                if let folder = collection as? PHCollectionList {
                    let next = path + (folder.localizedTitle.map { [$0] } ?? [])
                    walk(PHCollection.fetchCollections(in: folder, options: nil), path: next)
                } else if let album = collection as? PHAssetCollection {
                    paths[album.localIdentifier] = path
                }
            }
        }
        walk(PHCollectionList.fetchTopLevelUserCollections(with: nil), path: [])
        let collections = PHAssetCollection.fetchAssetCollections(with: .album, subtype: .any, options: nil)
        var albums: [LocalPhotoAlbum] = []
        collections.enumerateObjects { album, _, _ in
            var photos: [LocalAlbumPhoto] = []
            PHAsset.fetchAssets(in: album, options: options).enumerateObjects { asset, _, _ in
                // Modification time is a source-version hint, never a capture date.
                let version = asset.modificationDate.map { String($0.timeIntervalSince1970) }
                photos.append(LocalAlbumPhoto(localIdentifier: asset.localIdentifier, sourceVersion: version))
            }
            albums.append(LocalPhotoAlbum(id: album.localIdentifier, name: album.localizedTitle,
                folderPath: paths[album.localIdentifier] ?? [],
                sourceKind: String(album.assetCollectionSubtype.rawValue), photos: photos))
        }
        return LocalAlbumCatalog(accessScope: "full", observedAt: Date(), albums: albums.sorted { $0.id < $1.id }, photos: visible)
    }

    /// Grid request options — OPPORTUNISTIC: PhotoKit delivers a cached low-res
    /// frame instantly, then refines to sharp (the handler fires more than once).
    /// That is the Photos-app feel. (highQualityFormat made every cell wait for the
    /// full-quality thumb before showing anything — the grey-tile-then-pop clunk.)
    /// The SAME options object feeds both requestImage and startCachingImages so
    /// the cache actually hits.
    private let gridOptions: PHImageRequestOptions = {
        let o = PHImageRequestOptions()
        o.deliveryMode = .opportunistic
        o.resizeMode = .fast
        o.isNetworkAccessAllowed = true
        return o
    }()

    /// Request one cell's thumbnail. The completion may fire TWICE (low-res →
    /// sharp); the caller applies each. Returns the request id so the cell can
    /// cancel it the instant it scrolls off — no wasted decode on a fast flick.
    @discardableResult
    func requestThumbnail(for asset: PHAsset, allowNetwork: Bool = true, _ completion: @escaping (UIImage?) -> Void) -> PHImageRequestID {
        let options = PHImageRequestOptions()
        options.deliveryMode = gridOptions.deliveryMode
        options.resizeMode = gridOptions.resizeMode
        options.isNetworkAccessAllowed = allowNetwork
        return imageManager.requestImage(
            for: asset, targetSize: thumbSize, contentMode: .aspectFill, options: options
        ) { image, _ in if let image { completion(image) } }
    }

    func cancel(_ id: PHImageRequestID) { imageManager.cancelImageRequest(id) }

    /// Slide the caching window WITH the scroll: cache a forward run, STOP caching
    /// what is now far behind. Bounded memory → no thrash on a 75K library. (The old
    /// prefetch only ever started caching and never stopped — the memory-thrash jank.)
    private var cachedRange: Range<Int> = 0..<0
    func updateCache(around index: Int) {
        let ahead = 60, behind = 24
        let target = max(0, index - behind) ..< min(assets.count, index + ahead)
        guard target != cachedRange else { return }
        let stop  = cachedRange.filter { !target.contains($0) }
        let start = target.filter { !cachedRange.contains($0) }
        if !stop.isEmpty {
            imageManager.stopCachingImages(for: stop.map { assets.object(at: $0) },
                                           targetSize: thumbSize, contentMode: .aspectFill, options: gridOptions)
        }
        if !start.isEmpty {
            imageManager.startCachingImages(for: start.map { assets.object(at: $0) },
                                            targetSize: thumbSize, contentMode: .aspectFill, options: gridOptions)
        }
        cachedRange = target
    }

    /// Full-resolution image for the detail pager (large target, not the raw original).
    func fullImage(for asset: PHAsset, allowNetwork: Bool = true, original: Bool = false) async -> UIImage? {
        let o = PHImageRequestOptions()
        if original { o.version = .original }
        o.deliveryMode = .highQualityFormat
        o.resizeMode = .fast
        o.isNetworkAccessAllowed = allowNetwork
        let side = max(UIScreen.main.bounds.width, UIScreen.main.bounds.height) * scale
        let target = CGSize(width: side, height: side)
        return await withCheckedContinuation { cont in
            imageManager.requestImage(
                for: asset, targetSize: target, contentMode: .aspectFit, options: o
            ) { image, _ in cont.resume(returning: image) }
        }
    }

    nonisolated func photoLibraryDidChange(_ changeInstance: PHChange) {
        Task { @MainActor in
            if let details = changeInstance.changeDetails(for: assets) {
                assets = details.fetchResultAfterChanges
                count = assets.count
            }
            // An album rename/member edit can happen without changing the global
            // asset fetch. It must still produce a new human/source snapshot.
            await refreshAlbums()
        }
    }
}
