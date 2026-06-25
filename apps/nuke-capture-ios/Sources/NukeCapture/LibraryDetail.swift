// LibraryDetail.swift — the fullscreen pager: swipe between photos, pinch-zoom/pan
// into one (the Photos pattern), opened via the iOS 26 zoom transition from the grid.
//
// Operating table: source → LibraryStore.swift · glasses → LibraryGlasses.swift ·
// grid screen → LibraryView.swift. (The info page / ledger will hang off here.)

import Photos
import SwiftUI
import UIKit

struct LibraryDetailView: View {
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
        ZStack {
            if let image {
                ZoomableImage(image: image)
            } else {
                ProgressView().tint(.white)
            }
        }
        .task(id: index) {
            guard let asset = LibraryStore.shared.asset(at: index) else { return }
            image = await LibraryStore.shared.fullImage(for: asset)
        }
    }
}

/// Pinch-zoom / pan / double-tap image — UIScrollView-backed, the Photos pattern.
/// Scrolling is DISABLED at min zoom so the page-swipe (TabView) takes over; once
/// you zoom in, panning moves within the photo. Double-tap toggles 1× ↔ 2.5×.
private struct ZoomableImage: UIViewRepresentable {
    let image: UIImage

    func makeUIView(context: Context) -> UIScrollView {
        let scroll = UIScrollView()
        scroll.delegate = context.coordinator
        scroll.minimumZoomScale = 1
        scroll.maximumZoomScale = 4
        scroll.bouncesZoom = true
        scroll.showsVerticalScrollIndicator = false
        scroll.showsHorizontalScrollIndicator = false
        scroll.contentInsetAdjustmentBehavior = .never
        scroll.backgroundColor = .clear
        scroll.isScrollEnabled = false                 // min zoom → TabView pages

        let iv = UIImageView(image: image)
        iv.contentMode = .scaleAspectFit
        iv.isUserInteractionEnabled = true
        scroll.addSubview(iv)
        context.coordinator.imageView = iv
        context.coordinator.scrollView = scroll

        let dt = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.doubleTap(_:)))
        dt.numberOfTapsRequired = 2
        iv.addGestureRecognizer(dt)
        return scroll
    }

    func updateUIView(_ scroll: UIScrollView, context: Context) {
        let c = context.coordinator
        if c.imageView?.image !== image { c.imageView?.image = image }
        if scroll.zoomScale <= scroll.minimumZoomScale, let iv = c.imageView,
           scroll.bounds.size != .zero, iv.frame.size != scroll.bounds.size {
            iv.frame = CGRect(origin: .zero, size: scroll.bounds.size)
            scroll.contentSize = scroll.bounds.size
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, UIScrollViewDelegate {
        weak var scrollView: UIScrollView?
        weak var imageView: UIImageView?

        func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }

        func scrollViewDidZoom(_ scrollView: UIScrollView) {
            let b = scrollView.bounds.size, c = scrollView.contentSize
            let x = max(0, (b.width - c.width) / 2), y = max(0, (b.height - c.height) / 2)
            scrollView.contentInset = UIEdgeInsets(top: y, left: x, bottom: y, right: x)
            scrollView.isScrollEnabled = scrollView.zoomScale > scrollView.minimumZoomScale
        }

        @objc func doubleTap(_ g: UITapGestureRecognizer) {
            guard let scroll = scrollView else { return }
            if scroll.zoomScale > scroll.minimumZoomScale {
                scroll.setZoomScale(scroll.minimumZoomScale, animated: true)
            } else {
                let p = g.location(in: imageView)
                let z: CGFloat = 2.5
                let size = CGSize(width: scroll.bounds.width / z, height: scroll.bounds.height / z)
                scroll.zoom(to: CGRect(x: p.x - size.width / 2, y: p.y - size.height / 2,
                                       width: size.width, height: size.height), animated: true)
            }
        }
    }
}
