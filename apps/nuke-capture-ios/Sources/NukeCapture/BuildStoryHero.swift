// BuildStoryHero.swift — the lead image as a cinematic TITLE CARD, not a strip.
//
// The hero opens the build story: full-bleed latest/primary view of the asset
// with the title on a scrim, its decay date (when this view was true), and the
// affordance that tapping drills into the data that made the image. Loads the
// width=1000 render-thumb (never the raw original — that was a measured 2.9MB
// main-thread decode). Falls back to a flat plate when there's no image.

import SwiftUI

struct BuildStoryHero: View {
    let imageURL: String?
    let title: String
    let takenAt: String?
    let loaded: Bool
    let onTap: () -> Void

    var body: some View {
        if let urlStr = imageURL {
            Button(action: onTap) {
                CachedAsyncImage(url: NukeImage.thumb(urlStr, width: 1000)) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Color(.secondarySystemFill).overlay { ProgressView() }
                }
                .frame(maxWidth: .infinity)
                .frame(height: 300)
                .clipped()
                .overlay(alignment: .bottom) {
                    // Cinematic scrim carrying the title.
                    LinearGradient(colors: [.clear, .black.opacity(0.78)],
                                   startPoint: .center, endPoint: .bottom)
                        .overlay(alignment: .bottomLeading) {
                            Text(title.isEmpty ? "VEHICLE" : title)
                                .font(.title2.weight(.bold))
                                .foregroundStyle(.white)
                                .padding(16)
                        }
                }
                .overlay(alignment: .topLeading) {
                    // Decay: when this view of the asset was actually true.
                    if let at = takenAt, !at.isEmpty {
                        Text(String(at.prefix(10)))
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 6).padding(.vertical, 3)
                            .background(.black.opacity(0.4), in: Capsule())
                            .padding(8)
                    }
                }
                .overlay(alignment: .topTrailing) {
                    // Affordance that the lead drills to its data (not just zoom).
                    Image(systemName: "rectangle.and.text.magnifyingglass")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.white)
                        .padding(6)
                        .background(.black.opacity(0.35), in: Circle())
                        .padding(8)
                }
            }
            .buttonStyle(.plain)
        } else if loaded {
            // Loaded, no image — a flat plate, never a broken frame.
            Color(.secondarySystemFill)
                .frame(maxWidth: .infinity)
                .frame(height: 160)
                .overlay {
                    VStack(spacing: 8) {
                        Image(systemName: "car.side").font(.largeTitle).foregroundStyle(.secondary)
                        Text(title.isEmpty ? "VEHICLE" : title)
                            .font(.headline).foregroundStyle(.primary)
                    }
                }
        }
    }
}
