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
    func requestThumbnail(for asset: PHAsset, _ completion: @escaping (UIImage?) -> Void) -> PHImageRequestID {
        imageManager.requestImage(
            for: asset, targetSize: thumbSize, contentMode: .aspectFill, options: gridOptions
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
    func fullImage(for asset: PHAsset) async -> UIImage? {
        let o = PHImageRequestOptions()
        o.deliveryMode = .highQualityFormat
        o.resizeMode = .fast
        o.isNetworkAccessAllowed = true
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
            guard let details = changeInstance.changeDetails(for: assets) else { return }
            assets = details.fetchResultAfterChanges
            count = assets.count
        }
    }
}
