// BuildStoryHero.swift — the vehicle's photos as the page's title card.
//
// The hero is a directly swipeable pager over the lead photo and the first gallery page (no
// arrow buttons). Tapping a photo opens the full-screen gallery at that photo; analysis stays
// one step further, behind the gallery's own "Analysis" action. Each page loads the width=1000
// render-thumb (never the raw original — that was a measured 2.9MB main-thread decode). Falls
// back to a flat plate when there's no image.
//
// The identity sits on the scrim as ONE line and ONE door (VehicleIdentityTitle) into the
// vehicle's real market cohort (CohortTerminalView), with the make's wordmark in place. It is
// only tappable when the cohort node is real (make+model+year present).

import SwiftUI

struct BuildStoryHero: View {
    /// The photos to page through, lead first. Each carries its gallery row id so a tap can open
    /// the gallery at that exact photo.
    struct Page: Identifiable, Equatable {
        let id: String
        let url: String
    }

    let pages: [Page]
    let year: Int?
    let make: String?
    let model: String?
    let trim: String?
    /// Identity tokens from the document's masthead (the web's rule), nil before the read lands.
    var identityTokens: [String]? = nil
    /// When the lead photo was taken; shown on the lead page only.
    let takenAt: String?
    let loaded: Bool
    /// Opens the full-screen gallery at the tapped page.
    let onOpenPhoto: (Int) -> Void
    /// Non-nil ⇔ the cohort node is real (make+model+year present). nil ⇒ flat title, no fake affordance.
    let onDrillCohort: (() -> Void)?

    static let height: CGFloat = 300

    @State private var index = 0

    private var words: [String] {
        VehicleFirstScreen.titleWords(year: year, make: make, model: model, trim: trim, tokens: identityTokens)
    }

    var body: some View {
        if !pages.isEmpty {
            // The title is an OVERLAY sized to the pager (screen width), so it can never force the
            // hero wider than the photo (the old left-clip bug). It sits on top of the pager, so a
            // tap on the title goes to the cohort and a tap anywhere else opens the photo.
            pager
                .frame(maxWidth: .infinity)
                .frame(height: Self.height)
                .overlay(alignment: .bottom) { heroScrim.allowsHitTesting(false) }
                .overlay(alignment: .topLeading) {
                    if index == 0 { decayBadge.allowsHitTesting(false) }
                }
                .overlay(alignment: .bottomLeading) {
                    VehicleIdentityTitle(words: words, make: make, onScrim: true, onDrill: onDrillCohort)
                        .padding(.horizontal, NukeSpace.lg)
                        .padding(.bottom, pages.count > 1 ? NukeSpace.xl : NukeSpace.sm)
                }
                .onChange(of: pages.count) { _, n in if index >= n { index = 0 } }
        } else if loaded {
            // Loaded, no image — a flat plate, never a broken frame.
            Color(.secondarySystemFill)
                .frame(maxWidth: .infinity)
                .frame(height: 160)
                .overlay {
                    VStack(spacing: NukeSpace.sm) {
                        Image(systemName: "car.side").font(.largeTitle).foregroundStyle(.secondary)
                        VehicleIdentityTitle(words: words, make: make, onScrim: false, onDrill: onDrillCohort)
                        Text("No photo yet")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    .padding(.horizontal, NukeSpace.lg)
                }
        } else {
            // Still loading: a shimmering photo-shaped block, never a blank gap.
            Color(.tertiarySystemFill)
                .frame(maxWidth: .infinity)
                .frame(height: Self.height)
                .nukeShimmer()
                .accessibilityHidden(true)
        }
    }

    /// Swipe directly between photos; tap one to open the gallery there. Page dots only when
    /// there is more than one photo.
    private var pager: some View {
        TabView(selection: $index) {
            ForEach(Array(pages.enumerated()), id: \.element.id) { i, page in
                Button { onOpenPhoto(i) } label: { photo(page.url) }
                    .buttonStyle(.plain)
                    .tag(i)
                    .accessibilityLabel(Text("Photo \(i + 1) of \(pages.count)"))
                    .accessibilityHint(Text("Opens the gallery"))
            }
        }
        .tabViewStyle(.page(indexDisplayMode: pages.count > 1 ? .always : .never))
    }

    // A fixed-size box is the AUTHORITATIVE sizer (full-width × 300); the image is a
    // non-layout-affecting overlay that fills + clips, so a small source can never push the page
    // sideways.
    private func photo(_ urlStr: String) -> some View {
        Color(.secondarySystemFill)
            .frame(maxWidth: .infinity)
            .frame(height: Self.height)
            .overlay {
                CachedAsyncImage(url: NukeImage.thumb(urlStr, width: 1000)) { image in
                    image.resizable().scaledToFill()
                } placeholder: { Color(.tertiarySystemFill).nukeShimmer() }
            }
            .clipped()
            .contentShape(Rectangle())
    }

    // Scrim — carries the title's legibility on the photo.
    private var heroScrim: some View {
        LinearGradient(colors: [.clear, .black.opacity(0.7)],
                       startPoint: .center, endPoint: .bottom)
    }

    // Decay: when the lead view of the asset was actually true.
    @ViewBuilder private var decayBadge: some View {
        if let at = takenAt, !at.isEmpty {
            Text(String(at.prefix(10)))
                .font(.nukePill)
                .foregroundStyle(.white)
                .padding(.horizontal, NukeSpace.sm).padding(.vertical, 4)
                .background(.black.opacity(0.4), in: Capsule())
                .padding(NukeSpace.sm)
        }
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
    /// The document's identity tokens (VehicleIdentity, the web's rule) when the read is present;
    /// the raw row fields above are the fallback before the read lands.
    var tokens: [String]? = nil
    var onScrim: Bool = true          // white on the hero scrim vs primary on a plate
    let onDrill: (() -> Void)?

    private var parts: [String] {
        if let tokens, !tokens.isEmpty { return tokens }
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
        Group {
            if let make, word.trimmingCharacters(in: .whitespacesAndNewlines)
                .caseInsensitiveCompare(make.trimmingCharacters(in: .whitespacesAndNewlines)) == .orderedSame {
                MakeIdentityView(make: make, height: 22, maxWidth: 150)
            } else {
                Text(word)
            }
        }
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
