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
    @AppStorage("personalMode") private var personalMode = PersonalMode.show
    @Namespace private var zoomNS
    @ObservedObject private var overlay = LibraryOverlayStore.shared
    @State private var selectMode = false
    @State private var selected: Set<Int> = []
    @State private var showDays = false

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
                        Button { showDays = true } label: { Image(systemName: "calendar") }
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            Picker("Personal photos", selection: $personalMode) {
                                Label("Show", systemImage: "eye").tag(PersonalMode.show)
                                Label("Blur", systemImage: "drop.fill").tag(PersonalMode.blur)
                                Label("Hide", systemImage: "eye.slash").tag(PersonalMode.black)
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
    }

    private func applyVerdict(approved: Bool) {
        let lids = selected.compactMap { LibraryStore.shared.asset(at: $0)?.localIdentifier }
        overlay.setVerdict(lids, approved: approved)
        withAnimation { selected.removeAll() }
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
    var selecting: Bool = false
    var isSelected: Bool = false
    @ObservedObject private var overlay = LibraryOverlayStore.shared
    @StateObject private var loader = LibraryThumbLoader()
    @State private var localID: String?
    @AppStorage("personalMode") private var personalMode = PersonalMode.show

    /// Owner verdict wins, else the auto verdict (the Select tool's whole point).
    private var shouldHide: Bool { localID.map { overlay.shouldHide($0) } ?? false }

    var body: some View {
        Color(.secondarySystemFill)
            .aspectRatio(1, contentMode: .fill)
            .overlay {
                if let image = loader.image {
                    Image(uiImage: image).resizable().scaledToFill()
                        .blur(radius: (personalMode == .blur && shouldHide) ? 14 : 0)
                }
            }
            .overlay {
                if personalMode == .black && shouldHide {
                    Color.black   // "Hide" = blacked out; keeps the grid layout intact
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
