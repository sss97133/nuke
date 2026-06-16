// ShareCard.swift — the build story as a shareable artifact (the DTC growth move).
//
// One tap composes the record into a card you post: hero + title + worth bracket
// + a photo strip + nuke.ag. Rendered with ImageRenderer, which snapshots
// SYNCHRONOUSLY and will NOT await async image loads — so the caller pre-decodes
// every image to a UIImage via RemoteImageCache and passes them in. Composed only
// from values that exist; a brand-new vehicle degrades to a title card or, with no
// image at all, the caller falls back to sharing just the URL.

import SwiftUI
import UIKit

struct ShareCardContent: View {
    let hero: UIImage?
    let title: String
    let valuation: VehicleValuation?
    let strip: [UIImage]

    private static let W: CGFloat = 1080
    private static let H: CGFloat = 1350

    var body: some View {
        VStack(spacing: 0) {
            // Hero block with title + worth on a scrim.
            ZStack(alignment: .bottomLeading) {
                if let hero {
                    Image(uiImage: hero).resizable().scaledToFill()
                } else {
                    Color(white: 0.12)
                }
                LinearGradient(colors: [.clear, .black.opacity(0.85)],
                               startPoint: .center, endPoint: .bottom)
                VStack(alignment: .leading, spacing: 12) {
                    Text(title.isEmpty ? "VEHICLE" : title)
                        .font(.system(size: 54, weight: .bold)).foregroundStyle(.white)
                        .lineLimit(2).minimumScaleFactor(0.6)
                    if let v = valuation, let mid = v.value, mid > 0 {
                        worthLine(mid: mid, lo: v.value_low, hi: v.value_high)
                    }
                }
                .padding(44)
            }
            .frame(width: Self.W, height: 858)
            .clipped()

            // Photo strip (up to 3), only if present.
            if !strip.isEmpty {
                HStack(spacing: 6) {
                    ForEach(Array(strip.prefix(3).enumerated()), id: \.offset) { _, img in
                        Image(uiImage: img).resizable().scaledToFill()
                            .frame(width: (Self.W - 12) / 3, height: 342).clipped()
                    }
                }
                .frame(width: Self.W, height: 342)
            } else {
                Color(white: 0.12).frame(width: Self.W, height: 342)
            }

            // Footer.
            HStack(alignment: .firstTextBaseline) {
                Text("nuke.ag")
                    .font(.system(size: 34, weight: .semibold, design: .monospaced))
                    .foregroundStyle(.white)
                Spacer()
                Text("verified build record")
                    .font(.system(size: 24, design: .monospaced))
                    .foregroundStyle(.white.opacity(0.55))
            }
            .padding(.horizontal, 44)
            .frame(width: Self.W, height: 150)
            .background(Color.black)
        }
        .frame(width: Self.W, height: Self.H)
        .background(Color.black)
    }

    @ViewBuilder private func worthLine(mid: Double, lo: Double?, hi: Double?) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text("WORTH")
                .font(.system(size: 26, weight: .medium, design: .monospaced))
                .foregroundStyle(.white.opacity(0.7))
            Text(money0(mid))
                .font(.system(size: 46, weight: .bold)).monospacedDigit()
                .foregroundStyle(.white)
            if let lo, let hi {
                Text("\(money0(lo))–\(money0(hi)) · est")
                    .font(.system(size: 24, design: .monospaced))
                    .foregroundStyle(.white.opacity(0.6))
            }
        }
    }

    private func money0(_ v: Double) -> String {
        v.formatted(.currency(code: "USD").precision(.fractionLength(0)))
    }
}

/// Render the card to a UIImage. @MainActor — ImageRenderer is main-actor-bound.
@MainActor
func renderShareCard(hero: UIImage?, title: String,
                     valuation: VehicleValuation?, strip: [UIImage]) -> UIImage? {
    let content = ShareCardContent(hero: hero, title: title, valuation: valuation, strip: strip)
    let renderer = ImageRenderer(content: content)
    renderer.scale = 1   // the frame is already sized in pixels (1080×1350)
    return renderer.uiImage
}
