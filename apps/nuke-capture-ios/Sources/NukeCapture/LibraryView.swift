// LibraryView.swift — THE FOUNDATION surface: the user's whole photo library as a
// Photos-grade grid (smooth opportunistic scroll + pinch density), the owner's home
// tab. Everything else in Nuke is built on top of this.
//
// Operating table (so each phase is safe to reopen):
//   • data source + image requests + caching → LibraryStore.swift
//   • glasses (classification / badges / personal) → LibraryGlasses.swift
//   • fullscreen pager + zoom → LibraryDetail.swift
//   • THIS file → the grid screen + its cell, nothing else.

import Photos
import PhotosUI
import SwiftUI

struct LibraryView: View {
    @ObservedObject private var store = LibraryStore.shared
    @State private var detailIndex: Int?
    // Nuke is a vehicle library: irrelevant (personal, no-vehicle) photos are softened
    // by DEFAULT, the owner reveals via this toggle or Select. Was `.show` — which opened
    // the whole camera roll wide (79k daycare/family shots) in a vehicle app.
    @AppStorage("personalMode.v2") private var personalMode = PersonalMode.blur
    @AppStorage("showVisionTags") private var showVisionTags = false
    @Namespace private var zoomNS
    @ObservedObject private var overlay = LibraryOverlayStore.shared
    @State private var selectMode = false
    @State private var selected: Set<Int> = []
    @State private var showDays = false
    @State private var showAlbums = false

    @State private var columns = 3
    @State private var gestureStartColumns: Int?
    private let columnSteps = [2, 3, 4, 6]      // pinch density stops: big ↔ dense (gentle gaps)
    private let spacing: CGFloat = 2

    /// Pinch to change grid density — spread = fewer/bigger, pinch = more/denser.
    /// Simultaneous with scroll (2-finger pinch vs 1-finger scroll). Symmetric +
    /// gentle: one density step per ~45% pinch in either direction, so it's
    /// controllable instead of jumping multiple stops at once.
    private var densityPinch: some Gesture {
        MagnifyGesture()
            .onChanged { value in
                if gestureStartColumns == nil { gestureStartColumns = columns }
                let startIdx = columnSteps.firstIndex(of: gestureStartColumns ?? columns) ?? 1
                let m = max(value.magnification, 0.05)
                // Log-symmetric: spread (m>1) → fewer columns; pinch (m<1) → more.
                let step = Int((-log(m) / log(1.45)).rounded(.towardZero))
                let newIdx = min(max(startIdx + step, 0), columnSteps.count - 1)
                if columnSteps[newIdx] != columns {
                    withAnimation(.spring(response: 0.32, dampingFraction: 0.88)) {
                        columns = columnSteps[newIdx]
                    }
                }
            }
            .onEnded { _ in gestureStartColumns = nil }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(
                    columns: Array(repeating: GridItem(.flexible(), spacing: spacing), count: columns),
                    spacing: spacing
                ) {
                    ForEach(0..<store.count, id: \.self) { idx in
                        LibraryCell(index: idx, selecting: selectMode, isSelected: selected.contains(idx))
                            .matchedTransitionSource(id: idx, in: zoomNS)
                            .onTapGesture {
                                if selectMode {
                                    if selected.contains(idx) { selected.remove(idx) } else { selected.insert(idx) }
                                } else {
                                    detailIndex = idx
                                }
                            }
                    }
                }
            }
            .simultaneousGesture(densityPinch)
            .navigationTitle(selectMode ? "\(selected.count) selected" : "Library")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(selectMode ? "Done" : "Select") {
                        withAnimation { selectMode.toggle() }
                        selected.removeAll()
                    }
                }
                if !selectMode {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { showAlbums = true } label: { Image(systemName: "rectangle.stack") }
                            .accessibilityLabel("Albums")
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { showDays = true } label: { Image(systemName: "calendar") }
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            Picker("Personal photos", selection: $personalMode) {
                                Label("Show", systemImage: "eye").tag(PersonalMode.show)
                                Label("Blur", systemImage: "drop.fill").tag(PersonalMode.blur)
                                Label("Hide", systemImage: "eye.slash").tag(PersonalMode.black)
                            }
                            Divider()
                            Toggle(isOn: $showVisionTags) {
                                Label("Show vision tags", systemImage: "tag")
                            }
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: personalMode == .show ? "slider.horizontal.3" : "eye.slash.circle.fill")
                                    .font(.caption)
                                Text("\(store.count)").font(.subheadline).monospacedDigit()
                            }
                            .foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .safeAreaInset(edge: .bottom) {
                if selectMode {
                    HStack(spacing: 12) {
                        Button(role: .destructive) { applyVerdict(approved: false) } label: {
                            Label("Reject", systemImage: "eye.slash").frame(maxWidth: .infinity)
                        }
                        Button { applyVerdict(approved: true) } label: {
                            Label("Approve", systemImage: "checkmark.circle").frame(maxWidth: .infinity)
                        }
                        .tint(.green)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(selected.isEmpty)
                    .padding(.horizontal).padding(.vertical, 8)
                    .background(.ultraThinMaterial)
                }
            }
        }
        .fullScreenCover(item: Binding(
            get: { detailIndex.map(IndexBox.init) },
            set: { detailIndex = $0?.id }
        )) { box in
            LibraryDetailView(startIndex: box.id)
                .navigationTransition(.zoom(sourceID: box.id, in: zoomNS))
        }
        .sheet(isPresented: $showDays) { LibraryDaysView() }   // the local-first day receipt
        .sheet(isPresented: $showAlbums) { LibraryAlbumsView() }
    }

    private func applyVerdict(approved: Bool) {
        let lids = selected.compactMap { LibraryStore.shared.asset(at: $0)?.localIdentifier }
        overlay.setVerdict(lids, approved: approved)
        withAnimation { selected.removeAll() }
    }
}

/// The human grouping and the agent pass share the original Photos grid. Album
/// names and memberships remain visible even before a vehicle identity is known.
private struct LibraryAlbumsView: View {
    @ObservedObject private var store = LibraryStore.shared
    @ObservedObject private var ingest = LibraryIngest.shared
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Your existing albums are the starting groups. Nuke reads each photo separately; an album can contain several vehicles.")
                        .font(.subheadline).foregroundStyle(.secondary)
                    if let error = store.albumError { Text(error).foregroundStyle(.secondary) }
                    if store.refreshingAlbums && store.albumCatalog == nil { ProgressView("Reading albums…") }
                }
                if let catalog = store.albumCatalog, catalog.accessScope == "full" {
                    Section("Photos albums · \(catalog.albums.count)") {
                        ForEach(catalog.albums.sorted { ($0.name ?? "").localizedStandardCompare($1.name ?? "") == .orderedAscending }) { album in
                            NavigationLink {
                                LibraryAlbumPhotosView(albumId: album.id)
                            } label: {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(album.name ?? "Album name unavailable")
                                    if !album.folderPath.isEmpty {
                                        Text(album.folderPath.joined(separator: " / ")).font(.caption).foregroundStyle(.secondary)
                                    }
                                    Text("\(album.photos.count) photos").font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                    Section("On-device pass") {
                        Button("Analyze library") {
                            Task { await ingest.runAlbumReview() }
                        }.disabled(ingest.running)
                        Text("Albums first, then ungrouped photos. Each run makes bounded progress and reuses unchanged reads. Vehicle identity and your relationship stay open until supported.")
                            .font(.caption).foregroundStyle(.secondary)
                        if ingest.running { ProgressView("\(ingest.albumReviewDone) photos read this pass") }
                        if let summary = ingest.albumReviewSummary { Text(summary).font(.caption).foregroundStyle(.secondary) }
                    }
                } else if let catalog = store.albumCatalog {
                    Section {
                        Text(catalog.accessScope == "limited"
                            ? "Photos provides selected images but hides your albums with limited access. Album coverage is unknown."
                            : "Albums are unavailable with the current Photos access.")
                    }
                }
            }
            .navigationTitle("Albums")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
            .task { await store.refreshAlbums() }
            .refreshable { await store.refreshAlbums() }
        }
    }
}

private struct LibraryAlbumPhotosView: View {
    let albumId: String
    @ObservedObject private var store = LibraryStore.shared
    @ObservedObject private var ingest = LibraryIngest.shared
    @State private var indices: [String: Int] = [:]
    @State private var coverage: LocalAlbumCoverage?
    @State private var readError: String?
    @State private var detailIndex: Int?

    private var album: LocalPhotoAlbum? {
        guard store.albumCatalog?.accessScope == "full" else { return nil }
        return store.albumCatalog?.albums.first { $0.id == albumId }
    }

    var body: some View {
        ScrollView {
            if let album {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Photos album grouping").font(.caption).foregroundStyle(.secondary)
                    if let coverage {
                        Text("\(coverage.reviewed) / \(coverage.total) photos read on-device · \(coverage.vehicleFrames) vehicle/work frames")
                            .font(.subheadline).monospacedDigit()
                        if coverage.otherFrames > 0 {
                            Text("\(coverage.otherFrames) other frames to review").font(.caption).foregroundStyle(.secondary)
                        }
                        if !coverage.vinReadings.isEmpty {
                            Text("\(coverage.vinReadings.count) distinct VIN-shaped text readings · vehicle identity needs review")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        if coverage.cachedDeepReads > 0 {
                            Text("\(coverage.cachedDeepReads) photos also have cached deep analysis")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    if let readError { Text(readError).font(.caption).foregroundStyle(.secondary) }
                    Button(ingest.running ? "Reading photos…" : "Analyze album") {
                        Task { await ingest.runAlbumReview(albumId: albumId); await reload() }
                    }.disabled(ingest.running || album.photos.isEmpty)
                    Text("The pass preserves your grouping and owner corrections. Visual tags and VIN text do not establish ownership or who performed work.")
                        .font(.caption).foregroundStyle(.secondary)
                }.padding()
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 2), count: 3), spacing: 2) {
                    ForEach(album.photos, id: \.localIdentifier) { photo in
                        if let index = indices[photo.localIdentifier] {
                            LibraryCell(index: index, selecting: false, isSelected: false)
                                .onTapGesture { detailIndex = index }
                        }
                    }
                }
                if indices.count < album.photos.count {
                    Text("\(album.photos.count - indices.count) photos are currently unavailable.")
                        .font(.caption).foregroundStyle(.secondary).padding()
                }
            } else {
                Text("This album is currently unavailable.").foregroundStyle(.secondary).padding()
            }
        }
        .navigationTitle(album?.name ?? "Album")
        .navigationBarTitleDisplayMode(.inline)
        .task { await reload() }
        .onReceive(store.$albumCatalog) { _ in Task { await reload() } }
        .onChange(of: ingest.running) { _, running in if !running { Task { await reload() } } }
        .fullScreenCover(item: Binding(get: { detailIndex.map(IndexBox.init) }, set: { detailIndex = $0?.id })) {
            LibraryDetailView(startIndex: $0.id)
        }
    }

    @MainActor private func reload() async {
        guard let album else { indices = [:]; coverage = nil; return }
        indices = store.indexMap(forLocalIdentifiers: album.photos.map(\.localIdentifier))
        let method = LibraryIngest.albumMethodVersion
        do {
            coverage = try await Task.detached { try LocalStore.shared.albumCoverage(album, methodVersion: method) }.value
            readError = nil
        } catch { coverage = nil; readError = "Analysis coverage could not load. Totals are unknown." }
    }
}

/// Identifiable wrapper so an Int index can drive .fullScreenCover(item:).
/// Non-private: the day-receipt drill (LibraryDaysView) reuses it.
struct IndexBox: Identifiable { let id: Int }

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

/// Non-private: the day-receipt drill (LibraryDaysView → DayPhotosView) reuses this
/// cell over a day's global indices.
struct LibraryCell: View {
    let index: Int
    var selecting: Bool = false
    var isSelected: Bool = false
    @ObservedObject private var overlay = LibraryOverlayStore.shared
    @StateObject private var loader = LibraryThumbLoader()
    @State private var localID: String?
    @AppStorage("personalMode.v2") private var personalMode = PersonalMode.blur
    @AppStorage("showVisionTags") private var showVisionTags = false

    /// Owner verdict wins, else the auto verdict (the Select tool's whole point).
    private var shouldHide: Bool { localID.map { overlay.shouldHide($0) } ?? false }
    /// The on-device vision label for this cell, once the live classifier read it.
    private var visionTag: String? { localID.flatMap { overlay.label(for: $0) } }
    /// Unnecessary clutter (screenshot/doc/shopping) — the Vision gate softens it out
    /// of the way by DEFAULT (independent of the personal toggle). Owner-approve reveals.
    private var gatedJunk: Bool { localID.map { overlay.isGatedJunk($0) } ?? false }

    var body: some View {
        Color(.secondarySystemFill)
            .aspectRatio(1, contentMode: .fill)
            .overlay {
                if let image = loader.image {
                    Image(uiImage: image).resizable().scaledToFill()
                        .blur(radius: (gatedJunk || (personalMode == .blur && shouldHide)) ? 14 : 0)
                }
            }
            .overlay {
                if personalMode == .black && shouldHide {
                    Color.black   // "Hide" = blacked out; keeps the grid layout intact
                }
            }
            .overlay {
                if gatedJunk {
                    // Clutter set aside by default: a faint scrim + a glyph so it reads as
                    // "filtered noise", still tappable to reveal, never fully removed.
                    Color.black.opacity(0.28)
                }
            }
            .overlay(alignment: .center) {
                if gatedJunk {
                    Image(systemName: "rectangle.on.rectangle.slash")
                        .font(.body)
                        .foregroundStyle(.white.opacity(0.7))
                }
            }
            .overlay { if selecting && isSelected { Color.accentColor.opacity(0.28) } }
            .overlay(alignment: .topLeading) {
                if selecting {
                    Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                        .font(.title3)
                        .symbolRenderingMode(.palette)
                        .foregroundStyle(.white, isSelected ? Color.accentColor : Color.black.opacity(0.35))
                        .padding(4)
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
            .overlay(alignment: .bottomLeading) {
                // Vision-tag propagation, made visible (Blur has this; Nuke didn't): the
                // label appears the instant the live classifier reads the photo; a dim dot
                // means "not read yet". Toggle in the toolbar menu.
                if showVisionTags && !selecting {
                    Text(visionTag ?? "·")
                        .font(.system(size: 8, weight: .semibold))
                        .lineLimit(1)
                        .padding(.horizontal, 3).padding(.vertical, 1)
                        .background(.black.opacity(0.55), in: Capsule())
                        .foregroundStyle(visionTag == nil ? .white.opacity(0.5) : .white)
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
