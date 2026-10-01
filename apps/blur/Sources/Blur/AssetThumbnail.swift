// AssetThumbnail.swift — a single local PhotoKit thumbnail.
//
// PORTED from the Nuke capture app's TodayView thumbnail loader, generalized
// to a configurable size and an optional blur. Pure PhotoKit — zero network.
// Identifiers that no longer resolve (deleted photo) render a placeholder.

import SwiftUI
import Photos

struct AssetThumbnail: View {
    let assetIdentifier: String
    var side: CGFloat = 120
    var cornerRadius: CGFloat = 10
    /// When true, the image is rendered with a heavy blur (the "hidden" state).
    var blurred: Bool = false

    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .blur(radius: blurred ? 28 : 0)
            } else {
                Rectangle()
                    .fill(Color(.secondarySystemFill))
            }
        }
        .frame(width: side, height: side)
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
        .task(id: assetIdentifier) {
            image = await Self.loadThumbnail(for: assetIdentifier, side: side)
        }
    }

    /// Fetch the asset by identifier and request a square thumbnail.
    /// deliveryMode .highQualityFormat ⇒ the handler fires exactly once, so the
    /// checked continuation cannot double-resume.
    private static func loadThumbnail(for identifier: String, side: CGFloat) async -> UIImage? {
        let fetch = PHAsset.fetchAssets(withLocalIdentifiers: [identifier], options: nil)
        guard let asset = fetch.firstObject else { return nil }

        let options = PHImageRequestOptions()
        options.deliveryMode = .highQualityFormat
        options.resizeMode = .fast
        options.isNetworkAccessAllowed = false   // thumbs are local-only

        let scale = await MainActor.run { UIScreen.main.scale }
        let target = CGSize(width: side * scale, height: side * scale)

        return await withCheckedContinuation { continuation in
            PHImageManager.default().requestImage(
                for: asset,
                targetSize: target,
                contentMode: .aspectFill,
                options: options
            ) { image, _ in
                continuation.resume(returning: image)
            }
        }
    }
}
