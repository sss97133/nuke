// BeforeAfterPair.swift — the build narrative in two frames.
//
// The earliest and latest photos of the asset by CAPTURE date, side by side with
// their real dates — "how far it came." Honest bookends only: real photos, real
// taken_at dates, fetched via the vehicle_images_taken_date index (fast). Suppressed
// by the caller when there aren't two distinct dated frames (a before/after with no
// time gap would be a lie). Tapping either opens that frame's analysis.

import SwiftUI

struct BeforeAfterPair: View {
    let before: VehicleGalleryImage
    let after: VehicleGalleryImage
    let onTap: (VehicleGalleryImage) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("THE BUILD")
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 16)
            HStack(spacing: 2) {
                tile(before, label: "BEFORE")
                tile(after, label: "AFTER")
            }
        }
        .padding(.bottom, 16)
    }

    @ViewBuilder private func tile(_ img: VehicleGalleryImage, label: String) -> some View {
        Button { onTap(img) } label: {
            Color(.secondarySystemFill)
                .aspectRatio(1, contentMode: .fit)
                .overlay {
                    CachedAsyncImage(url: NukeImage.thumb(img.image_url, width: 600)) { image in
                        image.resizable().scaledToFill()
                    } placeholder: {
                        Image(systemName: "car.side").foregroundStyle(.secondary)
                    }
                }
                .clipped()
                .overlay(alignment: .topLeading) {
                    Text(label)
                        .font(.system(size: 10, weight: .semibold, design: .monospaced))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6).padding(.vertical, 3)
                        .background(.black.opacity(0.5), in: Capsule())
                        .padding(8)
                }
                .overlay(alignment: .bottomLeading) {
                    if let at = img.taken_at, !at.isEmpty {
                        Text(String(at.prefix(10)))
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 6).padding(.vertical, 3)
                            .background(.black.opacity(0.4), in: Capsule())
                            .padding(8)
                    }
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
