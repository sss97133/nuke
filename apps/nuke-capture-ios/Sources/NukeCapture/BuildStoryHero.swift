// BuildStoryHero.swift — the lead image as a cinematic TITLE CARD, not a strip.
//
// The hero opens the build story: full-bleed latest/primary view of the asset
// with the identity on a scrim, its decay date (when this view was true), and the
// affordance that tapping the photo drills into the data that made the image.
// Loads the width=1000 render-thumb (never the raw original — that was a measured
// 2.9MB main-thread decode). Falls back to a flat plate when there's no image.
//
// The identity is NOT a dead string — it renders as DRILLABLE entity-chips
// (IdentityChips). Each word taps into the vehicle's real market cohort
// (CohortTerminalView), so the design IS the function: the title you read is the
// door you open. Chips only become tappable when the cohort node is real
// (make+model+year present); otherwise they render as honest flat identity.

import SwiftUI

struct BuildStoryHero: View {
    let imageURL: String?
    let year: Int?
    let make: String?
    let model: String?
    let trim: String?
    let takenAt: String?
    let loaded: Bool
    let onTap: () -> Void
    /// Non-nil ⇔ the cohort node is real (make+model+year present). Tapping any
    /// identity chip drills to that one cohort instrument. nil ⇒ flat, no fake
    /// affordance (a chip may only look tappable when its node exists).
    let onDrillCohort: (() -> Void)?

    var body: some View {
        if let urlStr = imageURL {
            // Chips as an OVERLAY on the photo button, NOT a ZStack sibling. An overlay
            // is sized to its source (the photo = screen width), so the identity can
            // never force the hero wider than the photo. As a ZStack sibling, the
            // chips' FlowLayout could be proposed an UNBOUNDED width (when the image's
            // sizing pass defers), lay every chip on one line, blow past the screen and
            // shove the whole page left (the left-clip bug). Overlay buttons still fire:
            // they sit ON TOP of the photo button, not inside it, so chip taps win in
            // their frame and the rest of the hero still drills to the photo.
            Button(action: onTap) { heroPhoto(urlStr) }
                .buttonStyle(.plain)
                .overlay(alignment: .bottomLeading) {
                    IdentityChips(year: year, make: make, model: model, trim: trim,
                                  onScrim: true, onDrill: onDrillCohort)
                        .padding(16)
                        .allowsHitTesting(onDrillCohort != nil)
                }
        } else if loaded {
            // Loaded, no image — a flat plate, never a broken frame.
            Color(.secondarySystemFill)
                .frame(maxWidth: .infinity)
                .frame(height: 160)
                .overlay {
                    VStack(spacing: 8) {
                        Image(systemName: "car.side").font(.largeTitle).foregroundStyle(.secondary)
                        IdentityChips(year: year, make: make, model: model, trim: trim,
                                      onScrim: false, onDrill: onDrillCohort)
                    }
                }
        }
    }

    // Extracted so the type-checker handles the image + its overlays as one
    // small unit (the inline chain timed out). Photo only — identity lives on top.
    // Each overlay references a named sub-view to keep inference trivial.
    @ViewBuilder private func heroPhoto(_ urlStr: String) -> some View {
        // A fixed-size box is the AUTHORITATIVE sizer (full-width × 300); the image is
        // a non-layout-affecting overlay that fills + clips. Critical: with the image
        // as the sizer (scaledToFill + frame(maxWidth:.infinity)), a SMALL source
        // (e.g. a 480×271 photo) lets the scaled image's intrinsic width propagate into
        // layout and shove the whole page sideways. As an overlay on a fixed box it
        // can never affect layout, whatever the source dimensions.
        Color(.secondarySystemFill)
            .frame(maxWidth: .infinity)
            .frame(height: 300)
            .overlay {
                CachedAsyncImage(url: NukeImage.thumb(urlStr, width: 1000)) { image in
                    image.resizable().scaledToFill()
                } placeholder: { ProgressView() }
            }
            .clipped()
            .contentShape(Rectangle())
            .overlay(alignment: .bottom) { heroScrim }
            .overlay(alignment: .topLeading) { decayBadge }
            .overlay(alignment: .topTrailing) { dataAffordance }
    }

    // Cinematic scrim — carries the identity chips' legibility on the photo.
    private var heroScrim: some View {
        LinearGradient(colors: [.clear, .black.opacity(0.78)],
                       startPoint: .center, endPoint: .bottom)
    }

    // Decay: when this view of the asset was actually true.
    @ViewBuilder private var decayBadge: some View {
        if let at = takenAt, !at.isEmpty {
            Text(String(at.prefix(10)))
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(.white)
                .padding(.horizontal, 6).padding(.vertical, 3)
                .background(.black.opacity(0.4), in: Capsule())
                .padding(8)
        }
    }

    // Affordance that the lead drills to its data (not just zoom).
    private var dataAffordance: some View {
        Image(systemName: "rectangle.and.text.magnifyingglass")
            .font(.caption2.weight(.semibold))
            .foregroundStyle(.white)
            .padding(6)
            .background(.black.opacity(0.35), in: Circle())
            .padding(8)
    }
}

// ─── Drillable identity ─────────────────────────────────────────────────────
/// The vehicle identity as entity-chips, each a button into its real market
/// cohort. Wraps (never truncates — a cut-off identity is forbidden). When the
/// cohort node isn't real (onDrill == nil) the chips render flat: no pill, no
/// affordance, honest text — never a tappable-looking dead end.
struct IdentityChips: View {
    let year: Int?
    let make: String?
    let model: String?
    let trim: String?
    var onScrim: Bool = true          // white on the hero scrim vs primary on a plate
    let onDrill: (() -> Void)?

    private var parts: [String] {
        var p: [String] = []
        if let year { p.append(String(year)) }   // String(): avoid "1,977" locale formatting
        if let make, !make.isEmpty { p.append(make) }
        if let model, !model.isEmpty { p.append(model) }
        if let trim, !trim.isEmpty { p.append(trim) }
        return p
    }

    var body: some View {
        FlowLayout(spacing: 6) {
            ForEach(Array(parts.enumerated()), id: \.offset) { _, word in
                if let onDrill {
                    Button(action: onDrill) { chip(word, drillable: true) }
                        .buttonStyle(.plain)
                } else {
                    chip(word, drillable: false)
                }
            }
        }
    }

    @ViewBuilder private func chip(_ word: String, drillable: Bool) -> some View {
        let ink: Color = onScrim ? .white : .primary
        Text(word)
            .font(.title3.weight(.bold))
            .foregroundStyle(ink)
            .padding(.horizontal, drillable ? 9 : 0)
            .padding(.vertical, drillable ? 4 : 0)
            .background {
                if drillable {
                    Capsule().fill(onScrim ? AnyShapeStyle(.white.opacity(0.16))
                                           : AnyShapeStyle(Color(.tertiarySystemFill)))
                }
            }
            .overlay {
                if drillable {
                    Capsule().strokeBorder(onScrim ? .white.opacity(0.22) : .secondary.opacity(0.25),
                                           lineWidth: 0.5)
                }
            }
    }
}

// ─── FlowLayout ─────────────────────────────────────────────────────────────
/// Minimal wrapping flow (iOS 16+ Layout): lays children left→right, wrapping to
/// the next line when the row fills. So the identity wraps instead of truncating.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0, lineWidth: CGFloat = 0
        var totalHeight: CGFloat = 0, rowHeight: CGFloat = 0
        for sv in subviews {
            let s = sv.sizeThatFits(.unspecified)
            if x + s.width > maxWidth, x > 0 {
                totalHeight += rowHeight + spacing
                lineWidth = max(lineWidth, x - spacing)
                x = 0; rowHeight = 0
            }
            x += s.width + spacing
            rowHeight = max(rowHeight, s.height)
        }
        totalHeight += rowHeight
        lineWidth = max(lineWidth, x - spacing)
        return CGSize(width: maxWidth.isFinite ? maxWidth : lineWidth, height: totalHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for sv in subviews {
            let s = sv.sizeThatFits(.unspecified)
            if x + s.width > bounds.maxX, x > bounds.minX {
                x = bounds.minX; y += rowHeight + spacing; rowHeight = 0
            }
            sv.place(at: CGPoint(x: x, y: y), anchor: .topLeading, proposal: ProposedViewSize(s))
            x += s.width + spacing
            rowHeight = max(rowHeight, s.height)
        }
    }
}
