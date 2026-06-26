// PerceptualHash.swift — the content-identity / dedup spine, computed on-device.
//
// A 64-bit dHash (difference hash): downsample to 9×8 grayscale, compare each pixel
// to its right neighbor → 8×8 = 64 bits → 16 hex chars. Robust to resize, re-encode,
// and brightness shifts; dependency-free (CoreGraphics); sub-millisecond.
//
// WHY this is the spine (HARD_RULES §5/§6): identity is the CONTENT, not the
// filename — two appearances of the same shot hash equal, so they collapse onto ONE
// `image_identity` row locally (the local twin of prod `image_identities`). It is
// computed from the SOURCE bytes only — never a render/processed/cloud image — and it
// is orientation-STABLE (kCGImageSourceCreateThumbnailWithTransform), so the same
// photo in any EXIF orientation produces the same hash. Perceptual, not cryptographic:
// near-identical frames may share a hash — intended for de-dup, not integrity proof
// (`contentSha256` stays the slot for that).

import CoreGraphics
import Foundation
import ImageIO

enum PerceptualHash {

    /// 64-bit dHash of the image in `data` → 16 lowercase hex chars, or nil if the
    /// bytes can't be decoded. Pure; safe off the main actor.
    static func dHash(from data: Data) -> String? {
        guard let src = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let opts: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,   // orientation-stable
            kCGImageSourceThumbnailMaxPixelSize: 32,            // one cheap downsample
        ]
        guard let thumb = CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary) else { return nil }
        return dHash(of: thumb)
    }

    /// dHash of an already-decoded image — lets the ingest pass reuse a CGImage it
    /// already made (e.g. the classify thumbnail) instead of decoding twice. The image
    /// should already be orientation-corrected. Redraws to 9×8 grayscale internally.
    static func dHash(of image: CGImage) -> String? {
        let w = 9, h = 8
        var gray = [UInt8](repeating: 0, count: w * h)
        guard let ctx = CGContext(data: &gray, width: w, height: h, bitsPerComponent: 8,
                                  bytesPerRow: w, space: CGColorSpaceCreateDeviceGray(),
                                  bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return nil }
        ctx.interpolationQuality = .low
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        var bits: UInt64 = 0
        for r in 0 ..< h {
            for c in 0 ..< (w - 1) {
                bits <<= 1
                if gray[r * w + c] > gray[r * w + c + 1] { bits |= 1 }
            }
        }
        return String(format: "%016llx", bits)   // exactly 64 comparisons
    }
}
