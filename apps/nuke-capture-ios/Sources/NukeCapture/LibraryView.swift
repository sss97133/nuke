// LibraryView.swift — THE FOUNDATION.
//
// The user's WHOLE photo library, browsed on-device at Photos-app speed.
// PhotoKit is the source of truth; the database is GLASSES laid over it, never
// the container. Everything else in Nuke is built on top of this surface.
//
// Hard constraint (founder ruling): the scroll path touches ZERO network and
// ZERO database. Every cell renders straight from PHCachingImageManager off a
// lazy PHFetchResult — exactly the machinery Photos.app uses. DB intelligence
// (vehicle, day, worth, analysis) arrives ONLY as async, non-blocking overlays
// (LibraryOverlayStore); a cell is always there at full speed whether or not
// the glasses have anything to say about it yet. The moment the grid waits on a
// query it stops being Photos-fast — so it never does.

import Photos
import PhotosUI
import SwiftUI

// ─── The source: a live, lazy view onto the entire on-device library ─────────

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

// ─── The glasses: DB intelligence as async, non-blocking decoration ──────────
//
// Keyed by PHAsset.localIdentifier (the same id the app stamps into
// exif_data.uuid on upload), so a cell can be matched back to what the database
// knows about it. v1 is an empty, ready seam: cells call note() as they appear;
// a future batched lookup-by-localIdentifier fills `decorations` off the scroll
// path and the cell shows a badge when known. NEVER blocks a cell.

struct LibraryDecoration {
    let known: Bool          // the DB has an observation/upload for this content
    let glyph: String        // SF Symbol, e.g. "car.fill" (attributed) / "sparkles" (analyzed)
}

@MainActor
final class LibraryOverlayStore: ObservableObject {
    static let shared = LibraryOverlayStore()
    @Published private(set) var decorations: [String: LibraryDecoration] = [:]

    /// A cell appeared; enqueue its asset id for the (future) batched DB resolve.
    /// No-op in v1 — the foundation must stand without the glasses wired.
    func note(_ localIdentifier: String) { /* glasses layer wires the batched resolve next */ }

    func decoration(for localIdentifier: String) -> LibraryDecoration? {
        decorations[localIdentifier]
    }
}

// ─── The home surface ────────────────────────────────────────────────────────

struct LibraryView: View {
    @ObservedObject private var store = LibraryStore.shared
    @State private var detailIndex: Int?

    private let columns = 3
    private let spacing: CGFloat = 2

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(
                    columns: Array(repeating: GridItem(.flexible(), spacing: spacing), count: columns),
                    spacing: spacing
                ) {
                    ForEach(0..<store.count, id: \.self) { idx in
                        LibraryCell(index: idx)
                            .onTapGesture { detailIndex = idx }
                    }
                }
            }
            .navigationTitle("Library")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Text("\(store.count)").font(.subheadline).monospacedDigit()
                        .foregroundStyle(.secondary)
                }
            }
        }
        .fullScreenCover(item: Binding(
            get: { detailIndex.map(IndexBox.init) },
            set: { detailIndex = $0?.id }
        )) { box in
            LibraryDetailView(startIndex: box.id)
        }
    }
}

/// Identifiable wrapper so an Int index can drive .fullScreenCover(item:).
private struct IndexBox: Identifiable { let id: Int }

// ─── One cell — pure PhotoKit, decorated async ───────────────────────────────

/// Per-cell thumbnail loader: owns the PhotoKit request so it can be cancelled
/// the instant the cell scrolls off, and receives the opportunistic low-res→sharp
/// updates. A class (not @State) so the escaping PhotoKit handler updates real state.
@MainActor
final class LibraryThumbLoader: ObservableObject {
    @Published var image: UIImage?
    private var requestID: PHImageRequestID?

    func load(index: Int) {
        guard image == nil else { return }            // already have it → instant on re-appear
        cancel()
        guard let asset = LibraryStore.shared.asset(at: index) else { return }
        requestID = LibraryStore.shared.requestThumbnail(for: asset) { [weak self] img in
            self?.image = img
        }
    }

    func cancel() {
        if let id = requestID { LibraryStore.shared.cancel(id); requestID = nil }
    }
}

private struct LibraryCell: View {
    let index: Int
    @ObservedObject private var overlay = LibraryOverlayStore.shared
    @StateObject private var loader = LibraryThumbLoader()
    @State private var localID: String?

    var body: some View {
        Color(.secondarySystemFill)
            .aspectRatio(1, contentMode: .fill)
            .overlay {
                if let image = loader.image {
                    Image(uiImage: image).resizable().scaledToFill()
                }
            }
            .overlay(alignment: .bottomTrailing) {
                if let localID, let deco = overlay.decoration(for: localID), deco.known {
                    Image(systemName: deco.glyph)
                        .font(.caption2)
                        .foregroundStyle(.white)
                        .padding(3)
                        .background(.black.opacity(0.45), in: Circle())
                        .padding(3)
                }
            }
            .clipped()
            .contentShape(Rectangle())
            .onAppear {
                let asset = LibraryStore.shared.asset(at: index)
                localID = asset?.localIdentifier
                LibraryStore.shared.updateCache(around: index)   // slide the cache window
                if let lid = asset?.localIdentifier { overlay.note(lid) }  // async glasses; never blocks
                loader.load(index: index)
            }
            .onDisappear { loader.cancel() }
    }
}

// ─── Detail — swipeable full-res pager, Photos-style ─────────────────────────

private struct LibraryDetailView: View {
    let startIndex: Int
    @Environment(\.dismiss) private var dismiss
    @State private var index: Int

    init(startIndex: Int) {
        self.startIndex = startIndex
        _index = State(initialValue: startIndex)
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.black.ignoresSafeArea()
            TabView(selection: $index) {
                ForEach(0..<LibraryStore.shared.count, id: \.self) { idx in
                    LibraryDetailPage(index: idx).tag(idx)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .ignoresSafeArea()

            Button { dismiss() } label: {
                Image(systemName: "xmark")
                    .font(.headline).foregroundStyle(.white)
                    .padding(10).background(.black.opacity(0.4), in: Circle())
            }
            .padding()
        }
    }
}

private struct LibraryDetailPage: View {
    let index: Int
    @State private var image: UIImage?

    var body: some View {
        GeometryReader { geo in
            ZStack {
                if let image {
                    Image(uiImage: image).resizable().scaledToFit()
                        .frame(width: geo.size.width, height: geo.size.height)
                } else {
                    ProgressView().tint(.white)
                        .frame(width: geo.size.width, height: geo.size.height)
                }
            }
        }
        .task(id: index) {
            guard let asset = LibraryStore.shared.asset(at: index) else { return }
            image = await LibraryStore.shared.fullImage(for: asset)
        }
    }
}
