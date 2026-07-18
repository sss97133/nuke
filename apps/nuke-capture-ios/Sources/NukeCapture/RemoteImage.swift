// RemoteImage.swift — one render-thumbnail URL builder + one cached image view,
// consolidating four byte-identical (and identically BROKEN) copies that had
// drifted across VehicleDetailView / ExploreView / AnalyzedPhotosView / ProfileTab.
//
// THE BUG these replace (prod-verified 2026-06-14): every copy built
//     <supabaseURL>/render/image/public/vehicle-photos/<path>
// but the Supabase render service lives at
//     <supabaseURL>/storage/v1/render/image/public/...
// so every thumbnail 404'd (37-byte body) and the UI fell back to a placeholder
// or — worse — a full-res original. Measured for one K5 frame: broken thumb =
// HTTP 404; correct render thumb (width 200) = 7.7 KB; the raw original the hero
// was loading = 2.9 MB (≈380× the bytes, decoded on the main thread, uncached).
// That broken path + the absence of any cache WAS the reported sluggishness.
//
// Mirrors nuke_frontend/src/lib/imageOptimizer.ts: rewrite the public-object URL
// to the render path, append width/quality, and force resize=contain (the default
// `cover` crops portrait iPhone photos — standing rule).

import SwiftUI
import UIKit

enum NukeImage {
    /// Render-endpoint thumbnail URL for a stored image, sized for its frame.
    /// - A Supabase public-object URL (any bucket) is rewritten to the render
    ///   endpoint and sized.
    /// - A non-Supabase CDN url (BaT/Cars&Bids/Craigslist) passes through
    ///   untouched — the render service can't transcode those.
    /// Returns nil only for empty input.
    static func thumb(_ raw: String?, width: Int, quality: Int = 85) -> URL? {
        guard let raw, !raw.isEmpty else { return nil }
        // Canonical case: .../storage/v1/object/public/<bucket>/<path>
        if let r = raw.range(of: "/storage/v1/object/public/") {
            let base = raw[..<r.lowerBound]
            let path = raw[r.upperBound...]
            return URL(string: "\(base)/storage/v1/render/image/public/\(path)?width=\(width)&quality=\(quality)&resize=contain")
        }
        // Bucket-relative fallback (".../vehicle-photos/<path>" with no object prefix).
        if let r = raw.range(of: "/vehicle-photos/") {
            let path = raw[r.upperBound...]
            return URL(string: "\(Config.supabaseURL.absoluteString)/storage/v1/render/image/public/vehicle-photos/\(path)?width=\(width)&quality=\(quality)&resize=contain")
        }
        return URL(string: raw)   // external CDN: use as-is (render can't transcode it)
    }
}

/// Decoded-bitmap + HTTP cache shared by every CachedAsyncImage. Plain SwiftUI
/// AsyncImage keeps no persistent cache and re-decodes on every re-appear; in a
/// scrolling grid that means re-download + re-decode per cell on every pass.
/// Two layers fix it: a generously sized URLCache (the HTTP bytes survive) and
/// an NSCache of already-decoded UIImages (a re-appearing cell is a dict hit).
final class RemoteImageCache {
    static let shared = RemoteImageCache()
    private let decoded = NSCache<NSURL, UIImage>()
    private let session: URLSession

    private init() {
        let cache = URLCache(memoryCapacity: 64 * 1024 * 1024,
                             diskCapacity: 512 * 1024 * 1024,
                             directory: nil)
        let cfg = URLSessionConfiguration.default
        cfg.urlCache = cache
        cfg.requestCachePolicy = .returnCacheDataElseLoad
        session = URLSession(configuration: cfg)
        decoded.countLimit = 400
    }

    /// Synchronous decoded-cache hit (lets the view show instantly, no flash).
    func cached(_ url: URL) -> UIImage? { decoded.object(forKey: url as NSURL) }

    /// Fetch (HTTP-cached) and decode once off the main thread; memoize the bitmap.
    func image(_ url: URL) async -> UIImage? {
        if let hit = decoded.object(forKey: url as NSURL) { return hit }
        do {
            let (data, _) = try await session.data(from: url)
            guard let raw = UIImage(data: data) else { return nil }
            let img = raw.preparingForDisplay() ?? raw   // force decode off the draw path
            decoded.setObject(img, forKey: url as NSURL)
            return img
        } catch {
            return nil
        }
    }
}

/// Drop-in replacement for AsyncImage(url:content:placeholder:) with a real
/// cache. Same call shape, so the four scrolling surfaces swap 1:1.
struct CachedAsyncImage<Content: View, Placeholder: View>: View {
    let url: URL?
    @ViewBuilder let content: (Image) -> Content
    @ViewBuilder let placeholder: () -> Placeholder

    @State private var image: UIImage?

    init(url: URL?,
         @ViewBuilder content: @escaping (Image) -> Content,
         @ViewBuilder placeholder: @escaping () -> Placeholder) {
        self.url = url
        self.content = content
        self.placeholder = placeholder
        // Seed from the decoded cache so a re-appearing cell paints with no flash.
        if let url, let hit = RemoteImageCache.shared.cached(url) {
            _image = State(initialValue: hit)
        }
    }

    var body: some View {
        Group {
            if let image {
                content(Image(uiImage: image))
            } else {
                placeholder()
            }
        }
        .task(id: url) {
            guard let url else { image = nil; return }
            if let hit = RemoteImageCache.shared.cached(url) { image = hit; return }
            image = await RemoteImageCache.shared.image(url)
        }
    }
}
