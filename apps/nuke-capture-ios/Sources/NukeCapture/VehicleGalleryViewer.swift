// VehicleGalleryViewer.swift — the Photos-style full-screen viewer for a vehicle's gallery.
// Moved verbatim out of VehicleDetailView.swift (no behavior change).

import SwiftUI
import UIKit

// A real photo viewer (the Photos-app idiom): swipe between, pinch/pan/double-tap zoom,
// a filmstrip scrubber, date caption, cached full-res. Tap toggles chrome. Analysis is
// still one tap away (the drill survives) — never a parallel atom view (don't-mint).
struct FullScreenGalleryView: View {
    let photos: [VehicleGalleryImage]
    var onAnalyze: ((VehicleGalleryImage) -> Void)? = nil
    @State private var index: Int
    @State private var showChrome = true
    @Environment(\.dismiss) private var dismiss

    init(photos: [VehicleGalleryImage], startIndex: Int = 0,
         onAnalyze: ((VehicleGalleryImage) -> Void)? = nil) {
        self.photos = photos
        self.onAnalyze = onAnalyze
        _index = State(initialValue: min(max(startIndex, 0), max(photos.count - 1, 0)))
    }
    // Legacy shim — the two callers that pass bare URL strings (hero fallback, cohort zoom).
    init(images: [String]) {
        self.init(photos: images.map {
            VehicleGalleryImage(id: UUID(), image_url: $0, thumbnail_url: nil, is_primary: nil,
                                taken_at: nil, labels: nil, ai_processing_status: nil,
                                image_category: nil, created_at: nil, vision_gate_agent_reasoning: nil)
        })
    }

    private var current: VehicleGalleryImage? { photos.indices.contains(index) ? photos[index] : nil }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            TabView(selection: $index) {
                ForEach(Array(photos.enumerated()), id: \.offset) { i, img in
                    ZoomableImage(url: img.image_url).tag(i).ignoresSafeArea()
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .onTapGesture { withAnimation(.easeInOut(duration: 0.2)) { showChrome.toggle() } }

            if showChrome {
                VStack(spacing: 0) {
                    HStack {
                        Button { dismiss() } label: {
                            Image(systemName: "xmark").font(.headline.weight(.semibold))
                                .foregroundStyle(.white).padding(10).background(.black.opacity(0.4), in: Circle())
                        }
                        Spacer()
                        if let c = current, onAnalyze != nil {
                            Button { onAnalyze?(c) } label: {
                                Label("Analysis", systemImage: "sparkle.magnifyingglass")
                                    .font(.subheadline.weight(.medium)).foregroundStyle(.white)
                                    .padding(.horizontal, 12).padding(.vertical, 8)
                                    .background(.black.opacity(0.4), in: Capsule())
                            }
                        }
                    }
                    .padding(.horizontal, 16).padding(.top, 8)
                    Spacer()
                    if let image = current, image.isImported {
                        Text("Listing photo · capture date unknown").font(.footnote.weight(.medium)).foregroundStyle(.white)
                            .padding(.horizontal, 10).padding(.vertical, 5)
                            .background(.black.opacity(0.4), in: Capsule())
                            .padding(.bottom, 6)
                    } else if let at = current?.taken_at, !at.isEmpty {
                        Text(prettyDate(at)).font(.footnote.weight(.medium)).foregroundStyle(.white)
                            .padding(.horizontal, 10).padding(.vertical, 5)
                            .background(.black.opacity(0.4), in: Capsule())
                            .padding(.bottom, 6)
                    }
                    scrubber.padding(.bottom, 8)
                }
                .transition(.opacity)
            }
        }
        .statusBarHidden()
    }

    private var scrubber: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 4) {
                    ForEach(Array(photos.enumerated()), id: \.offset) { i, img in
                        Button { withAnimation(.snappy(duration: 0.2)) { index = i } } label: {
                            CachedAsyncImage(url: NukeImage.thumb(img.image_url, width: 120)) { im in
                                im.resizable().scaledToFill()
                            } placeholder: { Color.white.opacity(0.1) }
                            .frame(width: i == index ? 46 : 34, height: i == index ? 46 : 34)
                            .clipShape(RoundedRectangle(cornerRadius: 4))
                            .overlay(RoundedRectangle(cornerRadius: 4)
                                .strokeBorder(.white, lineWidth: i == index ? 2 : 0))
                            .id(i)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
            }
            .frame(height: 54)
            .onChange(of: index) { _, new in withAnimation { proxy.scrollTo(new, anchor: .center) } }
        }
    }

    private func prettyDate(_ s: String) -> String {
        let iso = ISO8601DateFormatter(); iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let d = iso.date(from: s) ?? {
            let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; return f.date(from: String(s.prefix(10)))
        }()
        guard let d else { return String(s.prefix(10)) }
        let out = DateFormatter(); out.dateStyle = .long
        return out.string(from: d)
    }
}

// Pinch-to-zoom + pan-while-zoomed + double-tap toggle, clamped 1…4×. A 2048-pixel render
// (enough for 2× zoom on a phone), not the raw original: a 3–10 MB HEIC decoded whole per page
// was the "loads full res" heat (owner, 2026-10-15). Resets on page change.
private struct ZoomableImage: View {
    let url: String?
    @State private var scale: CGFloat = 1
    @State private var lastScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero

    var body: some View {
        GeometryReader { geo in
            CachedAsyncImage(url: NukeImage.thumb(url, width: 2048)) { image in
                image.resizable().scaledToFit()
            } placeholder: {
                Color.black.overlay { ProgressView().tint(.white) }
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .scaleEffect(scale)
            .offset(offset)
            .gesture(MagnificationGesture()
                .onChanged { v in scale = min(max(lastScale * v, 1), 4) }
                .onEnded { _ in
                    lastScale = scale
                    if scale <= 1 { withAnimation(.spring) { offset = .zero; lastOffset = .zero } }
                })
            .simultaneousGesture(DragGesture()
                .onChanged { v in
                    if scale > 1 {
                        offset = CGSize(width: lastOffset.width + v.translation.width,
                                        height: lastOffset.height + v.translation.height)
                    }
                }
                .onEnded { _ in lastOffset = offset })
            .onTapGesture(count: 2) {
                withAnimation(.spring) {
                    if scale > 1 { scale = 1; lastScale = 1; offset = .zero; lastOffset = .zero }
                    else { scale = 2.5; lastScale = 2.5 }
                }
            }
        }
    }
}
