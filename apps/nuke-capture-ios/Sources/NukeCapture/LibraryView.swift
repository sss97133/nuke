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

    private var thumbOptions: PHImageRequestOptions {
        let o = PHImageRequestOptions()
        o.deliveryMode = .highQualityFormat   // single callback — no double-resume
        o.resizeMode = .fast
        o.isNetworkAccessAllowed = true        // pull the small iCloud thumb if the original is optimized off-device
        return o
    }

    /// Thumbnail for one cell. Async, cached, off the main render pass.
    func thumbnail(for asset: PHAsset) async -> UIImage? {
        await withCheckedContinuation { cont in
            imageManager.requestImage(
                for: asset, targetSize: thumbSize, contentMode: .aspectFill, options: thumbOptions
            ) { image, _ in cont.resume(returning: image) }
        }
    }

    /// Warm a forward window so scrolling stays Photos-smooth.
    func prefetch(around index: Int, window: Int = 30) {
        let lower = max(0, index)
        let upper = min(assets.count, index + window)
        guard lower < upper else { return }
        var batch: [PHAsset] = []
        batch.reserveCapacity(upper - lower)
        for i in lower..<upper { batch.append(assets.object(at: i)) }
        imageManager.startCachingImages(for: batch, targetSize: thumbSize,
                                        contentMode: .aspectFill, options: thumbOptions)
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

private struct LibraryCell: View {
    let index: Int
    @ObservedObject private var store = LibraryStore.shared
    @ObservedObject private var overlay = LibraryOverlayStore.shared
    @State private var image: UIImage?
    @State private var localID: String?

    var body: some View {
        Color(.secondarySystemFill)
            .aspectRatio(1, contentMode: .fill)
            .overlay {
                if let image {
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
            .task(id: index) {
                guard let asset = store.asset(at: index) else { return }
                localID = asset.localIdentifier
                store.prefetch(around: index)
                overlay.note(asset.localIdentifier)     // async glasses; never blocks
                image = await store.thumbnail(for: asset)
            }
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
