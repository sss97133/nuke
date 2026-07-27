// GalleryFocusView.swift — one gallery, the curate + show surface.
//
// This is where "Blur" earns its name. Two modes:
//
//   • Curate (default): every photo is visible; tap any photo to hide it
//     (it blurs). This is the passive curation gesture — mark the ones you
//     wouldn't want to flash past when showing someone.
//   • Show: a single toggle. Hidden photos disappear entirely, so you can hand
//     someone your phone and flip through this exact group with confidence —
//     no frantic scrolling, no accidental reveal.
//
// All state is local (LibraryEngine.hiddenAssetIDs). Nothing leaves the device.

import SwiftUI

struct GalleryFocusView: View {
    let gallery: Gallery
    @EnvironmentObject private var library: LibraryEngine
    @State private var showMode = false

    private let columns = [GridItem(.adaptive(minimum: 110), spacing: 4)]

    /// In Show mode, hidden photos are removed from the grid entirely.
    private var visibleAssetIDs: [String] {
        showMode ? gallery.assetIDs.filter { !library.isHidden($0) } : gallery.assetIDs
    }

    var body: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 4) {
                ForEach(visibleAssetIDs, id: \.self) { assetID in
                    Button {
                        if !showMode { library.toggleHidden(assetID) }
                    } label: {
                        AssetThumbnail(
                            assetIdentifier: assetID,
                            side: 110,
                            cornerRadius: 4,
                            blurred: library.isHidden(assetID)
                        )
                    }
                    .buttonStyle(.plain)
                    .disabled(showMode)
                }
            }
            .padding(4)
        }
        .navigationTitle(gallery.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Toggle(isOn: $showMode) {
                    Label("Show mode", systemImage: showMode ? "eye" : "eye.slash")
                }
                .toggleStyle(.button)
            }
        }
        .safeAreaInset(edge: .bottom) {
            if !showMode {
                Text("Tap a photo to hide it. Turn on Show mode to present this gallery safely.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity)
                    .background(.ultraThinMaterial)
            }
        }
    }
}
