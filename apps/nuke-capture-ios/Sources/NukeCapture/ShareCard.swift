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
import CoreImage.CIFilterBuiltins

struct ShareCardContent: View {
    let hero: UIImage?
    let title: String
    let valuation: VehicleValuation?
    let strip: [UIImage]
    let days: [DayRecord]
    let vehicleId: String

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

            // Footer — the traceable fingerprint baked into the shared image:
            // the origin code + the build's barcode (its unfakeable rhythm) + a
            // scannable QR back to the record. Any screenshot now traces home.
            HStack(alignment: .center, spacing: 28) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("nuke.ag")
                        .font(.system(size: 34, weight: .semibold, design: .monospaced))
                        .foregroundStyle(.white)
                    Text(BuildBarcode.originCode(vehicleId))
                        .font(.system(size: 20, weight: .medium, design: .monospaced))
                        .foregroundStyle(.white.opacity(0.6))
                }
                if !days.isEmpty {
                    BuildBarcode(days: days, height: 44)
                        .frame(maxWidth: .infinity)
                } else {
                    Spacer()
                }
                if let qr = qrImage("https://nuke.ag/vehicle/\(vehicleId)") {
                    Image(uiImage: qr)
                        .interpolation(.none)
                        .resizable()
                        .frame(width: 104, height: 104)
                        .padding(7)
                        .background(Color.white)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                }
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
                     valuation: VehicleValuation?, strip: [UIImage],
                     days: [DayRecord], vehicleId: String) -> UIImage? {
    let content = ShareCardContent(hero: hero, title: title, valuation: valuation,
                                   strip: strip, days: days, vehicleId: vehicleId)
    let renderer = ImageRenderer(content: content)
    renderer.scale = 1   // the frame is already sized in pixels (1080×1350)
    return renderer.uiImage
}

/// A scannable QR of the vehicle URL — black modules on a clear ground, so it sits
/// on the card's white tile. Mirrors the web WorkOrderStatement QR of the same URL.
func qrImage(_ string: String) -> UIImage? {
    let filter = CIFilter.qrCodeGenerator()
    filter.message = Data(string.utf8)
    filter.correctionLevel = "M"
    guard let out = filter.outputImage else { return nil }
    let scaled = out.transformed(by: CGAffineTransform(scaleX: 12, y: 12))
    let ctx = CIContext()
    guard let cg = ctx.createCGImage(scaled, from: scaled.extent) else { return nil }
    return UIImage(cgImage: cg)
}
