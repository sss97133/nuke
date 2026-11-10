// DesignSystem.swift — the small shared kit every polished screen draws from.
//
// One spacing scale, one corner-radius scale, a handful of type styles, a card with a large
// hero photo, shimmer skeletons for loading, and a friendly empty state. The goal is the
// "wife test": a first-time, non-technical person can look at a screen and know what it is
// and what to tap, with photos leading and as little text as the facts allow.
//
// Rules this kit keeps (and callers must keep):
//   • It only DISPLAYS values the record carries. A missing value is hidden, never estimated
//     (`NukeDisplay.money` / `.text` return nil for blank or zero-as-unknown input).
//   • Every tappable thing is at least `NukeSize.minTap` points tall.
//   • Motion respects Reduce Motion (shimmer holds still).

import SwiftUI

// MARK: Spacing, radius, size

/// The spacing scale. Use these instead of one-off numbers.
enum NukeSpace {
    static let xs: CGFloat = 4
    static let sm: CGFloat = 8
    static let md: CGFloat = 12
    static let lg: CGFloat = 16
    static let xl: CGFloat = 24
    static let xxl: CGFloat = 32
}

/// The corner-radius scale.
enum NukeRadius {
    /// Small chips and thumbnails.
    static let small: CGFloat = 10
    /// Cards and grouped panels.
    static let card: CGFloat = 16
    /// Large hero photos.
    static let hero: CGFloat = 22
}

enum NukeSize {
    /// Apple's minimum comfortable tap target.
    static let minTap: CGFloat = 44
    /// Width ÷ height of a hero card's photo: tall enough that the car fills the screen.
    static let heroPhotoAspect: CGFloat = 5.0 / 4.0
}

// MARK: Type styles

extension Font {
    /// A big friendly headline on a hero photo or an empty state.
    static var nukeHeadline: Font { .system(.title3, design: .rounded).weight(.bold) }
    /// A card title.
    static var nukeCardTitle: Font { .system(.headline, design: .rounded) }
    /// A big number, e.g. a price on a photo.
    static var nukeBigNumber: Font { .system(size: 28, weight: .bold, design: .rounded).monospacedDigit() }
    /// Supporting line under a title.
    static var nukeDetail: Font { .subheadline }
    /// Tiny label on a pill.
    static var nukePill: Font { .system(.caption, design: .rounded).weight(.semibold) }
}

// MARK: Display helpers (pure, unit-tested)

/// Turns record values into display text without ever inventing one.
enum NukeDisplay {
    /// The trimmed text, or nil when it is missing or blank. A blank never renders as a placeholder.
    static func text(_ raw: String?) -> String? {
        guard let t = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty else { return nil }
        return t
    }

    /// Joins only the parts that exist.
    static func joined(_ parts: [String?], separator: String = " · ") -> String? {
        let present = parts.compactMap(text)
        return present.isEmpty ? nil : present.joined(separator: separator)
    }

    /// "$12,500", or nil for a missing or non-positive amount (a zero price is "not recorded", not "free").
    static func money(_ amount: Double?) -> String? {
        guard let amount, amount > 0, amount.isFinite else { return nil }
        return "$" + Int(amount.rounded()).formatted()
    }

    /// "1 photo" / "12 photos".
    static func count(_ n: Int, _ singular: String, _ plural: String? = nil) -> String {
        "\(n.formatted()) " + (n == 1 ? singular : (plural ?? singular + "s"))
    }

    /// "1973 Ford Mustang" from the parts that exist, in the casing the record carries.
    static func vehicleName(year: Int?, make: String?, model: String?) -> String? {
        joined([year.map { String($0) }, make, model], separator: " ")
    }
}

// MARK: Shimmer skeletons

/// A soft highlight sweeping across a placeholder so loading reads as alive, not stuck.
struct NukeShimmer: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var phase: CGFloat = 0

    func body(content: Content) -> some View {
        content
            .overlay {
                if !reduceMotion {
                    GeometryReader { geo in
                        LinearGradient(colors: [.clear, Color.white.opacity(0.32), .clear],
                                       startPoint: .leading, endPoint: .trailing)
                            .frame(width: geo.size.width * 0.55)
                            .offset(x: -geo.size.width * 0.55 + phase * geo.size.width * 1.55)
                    }
                    .allowsHitTesting(false)
                }
            }
            .clipped()
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.linear(duration: 1.25).repeatForever(autoreverses: false)) { phase = 1 }
            }
    }
}

extension View {
    /// Shimmer for a loading placeholder.
    func nukeShimmer() -> some View { modifier(NukeShimmer()) }

    /// The standard card surface: soft fill, one corner radius, no hard edges.
    func nukeSurface(radius: CGFloat = NukeRadius.card) -> some View {
        background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: radius, style: .continuous))
    }
}

/// A rounded grey block that shimmers.
struct NukeSkeletonBlock: View {
    var height: CGFloat? = nil
    var radius: CGFloat = NukeRadius.small

    var body: some View {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
            .fill(Color(.tertiarySystemFill))
            .frame(height: height)
            .nukeShimmer()
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
            .accessibilityHidden(true)
    }
}

/// A loading stand-in shaped like `NukeHeroCard`: a big photo and two lines of text.
struct NukeHeroCardSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: NukeSpace.md) {
            NukeSkeletonBlock(radius: NukeRadius.hero)
                .aspectRatio(NukeSize.heroPhotoAspect, contentMode: .fit)
            NukeSkeletonBlock(height: 18).frame(maxWidth: 240)
            NukeSkeletonBlock(height: 12).frame(maxWidth: 160)
        }
        .padding(.horizontal, NukeSpace.lg)
    }
}

/// A few skeleton cards with one plain sentence, for a screen's first load.
struct NukeFeedSkeleton: View {
    let message: String
    var cards = 3

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NukeSpace.xl) {
                Text(message)
                    .font(.nukeDetail).foregroundStyle(.secondary)
                    .padding(.horizontal, NukeSpace.lg)
                ForEach(0..<cards, id: \.self) { _ in NukeHeroCardSkeleton() }
            }
            .padding(.top, NukeSpace.lg)
        }
        .scrollDisabled(true)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(message)
    }
}

/// Skeleton rows for list screens (Work, Profile).
struct NukeRowSkeleton: View {
    var body: some View {
        HStack(spacing: NukeSpace.md) {
            NukeSkeletonBlock(radius: NukeRadius.small).frame(width: 72, height: 54)
            VStack(alignment: .leading, spacing: NukeSpace.sm) {
                NukeSkeletonBlock(height: 14).frame(maxWidth: 200)
                NukeSkeletonBlock(height: 10).frame(maxWidth: 120)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, NukeSpace.xs)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading")
    }
}

// MARK: Empty and error states

/// A friendly "nothing here" or "something went wrong" screen: an icon, one plain headline,
/// one sentence, and at most one clearly labelled button.
struct NukeEmptyState: View {
    let icon: String
    let title: String
    var message: String? = nil
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: NukeSpace.md) {
            Image(systemName: icon)
                .font(.system(size: 40, weight: .regular))
                .foregroundStyle(.secondary)
                .padding(.bottom, NukeSpace.xs)
            Text(title)
                .font(.nukeHeadline)
                .multilineTextAlignment(.center)
            if let message {
                Text(message)
                    .font(.nukeDetail).foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(NukePrimaryButtonStyle())
                    .padding(.top, NukeSpace.sm)
            }
        }
        .padding(NukeSpace.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// The standard "a read failed" state: one friendly sentence and a Try again button. Use this
/// wherever a load throws, instead of an empty screen or a silent `try?`.
struct NukeLoadFailed: View {
    var title = "We couldn't load this"
    var message: String? = "Check your connection and try again."
    let retry: () -> Void

    var body: some View {
        NukeEmptyState(icon: "wifi.exclamationmark", title: title, message: message,
                       actionTitle: "Try again", action: retry)
    }
}

/// The one main button style: full-height tap target, rounded, accent fill.
struct NukePrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(.body, design: .rounded).weight(.semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, NukeSpace.xl)
            .frame(minHeight: NukeSize.minTap + 4)
            .background(Color.accentColor, in: Capsule())
            .opacity(configuration.isPressed ? 0.8 : 1)
            .contentShape(Capsule())
    }
}

/// A quieter button for a second action.
struct NukeSecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(.body, design: .rounded).weight(.semibold))
            .foregroundStyle(Color.accentColor)
            .padding(.horizontal, NukeSpace.xl)
            .frame(minHeight: NukeSize.minTap)
            .background(Color.accentColor.opacity(0.12), in: Capsule())
            .opacity(configuration.isPressed ? 0.7 : 1)
            .contentShape(Capsule())
    }
}

// MARK: Pills

/// A small rounded label ("Bring a Trailer", "No reserve").
struct NukePill: View {
    let text: String
    var icon: String? = nil
    var onPhoto = false
    /// Overrides the text and icon color (Explore's time left is red); nil keeps white on a photo, secondary elsewhere.
    var textColor: Color? = nil

    var body: some View {
        HStack(spacing: 4) {
            if let icon { Image(systemName: icon).font(.caption2.weight(.bold)) }
            Text(text).lineLimit(1)
        }
        .font(.nukePill)
        .foregroundStyle(textColor ?? (onPhoto ? Color.white : Color.secondary))
        .padding(.horizontal, NukeSpace.sm + 2).padding(.vertical, 5)
        .background {
            if onPhoto { Capsule().fill(.ultraThinMaterial) } else { Capsule().fill(Color(.tertiarySystemFill)) }
        }
    }
}

/// A source's hosted mark at pill height on a white rounded rectangle, never a circle: square marks
/// (BaT's) carry their own white, and cropping them into a white disc cut the mark. VoiceOver reads
/// the source's name; until the mark loads, or if it never does, the text pill shows instead.
struct NukeSourceLogo: View {
    let url: URL
    let name: String

    var body: some View {
        CachedAsyncImage(url: url, maxPixel: 160) { image in
            image.resizable().scaledToFit()
                .frame(height: 26)
                .padding(.horizontal, 4)
                .background(Color.white, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                .accessibilityLabel(Text(name))
        } placeholder: {
            NukePill(text: name)
        }
    }
}

// MARK: Photos

/// A cached photo that fills its frame, with a shimmer while it loads and a calm plate when
/// there is no photo. Never a spinner, never a broken frame.
struct NukePhoto: View {
    let url: URL?
    var maxPixel: CGFloat = RemoteImageCache.defaultMaxPixel
    var emptyIcon = "car.side"

    var body: some View {
        Color(.tertiarySystemFill)
            .overlay {
                if url == nil {
                    Image(systemName: emptyIcon).font(.largeTitle).foregroundStyle(.tertiary)
                } else {
                    CachedAsyncImage(url: url, maxPixel: maxPixel) { image in
                        image.resizable().scaledToFill()
                    } placeholder: {
                        Color(.tertiarySystemFill).nukeShimmer()
                    }
                }
            }
            .clipped()
    }
}

/// The signature card: a large rounded photo, an optional overlay (price, time left), and a
/// title block beneath. Used by the Explore feed and anywhere a car should lead with its photo.
struct NukeHeroCard<Overlay: View>: View {
    let imageURL: URL?
    let title: String
    var subtitle: String? = nil
    var pills: [String] = []
    /// The source's mark, shown ahead of the pills; leave nil to show the source as a text pill.
    var sourceLogoURL: URL? = nil
    var sourceName: String = ""
    @ViewBuilder let overlay: () -> Overlay

    var body: some View {
        VStack(alignment: .leading, spacing: NukeSpace.md) {
            NukePhoto(url: imageURL, maxPixel: 1280)
                .aspectRatio(NukeSize.heroPhotoAspect, contentMode: .fit)
                .overlay(alignment: .bottom) {
                    LinearGradient(colors: [.clear, .black.opacity(0.6)], startPoint: .center, endPoint: .bottom)
                        .allowsHitTesting(false)
                }
                .overlay(alignment: .bottomLeading) { overlay().padding(NukeSpace.lg) }
                .clipShape(RoundedRectangle(cornerRadius: NukeRadius.hero, style: .continuous))
                .shadow(color: .black.opacity(0.12), radius: 10, y: 4)
            VStack(alignment: .leading, spacing: NukeSpace.xs) {
                Text(title).font(.nukeCardTitle).lineLimit(2)
                if let subtitle {
                    Text(subtitle).font(.nukeDetail).foregroundStyle(.secondary).lineLimit(2)
                }
                if !pills.isEmpty || sourceLogoURL != nil {
                    HStack(spacing: NukeSpace.sm) {
                        if let sourceLogoURL { NukeSourceLogo(url: sourceLogoURL, name: sourceName) }
                        ForEach(pills, id: \.self) { NukePill(text: $0) }
                    }
                    .padding(.top, 2)
                }
            }
            .padding(.horizontal, NukeSpace.xs)
        }
        .padding(.horizontal, NukeSpace.lg)
        .contentShape(Rectangle())
    }
}

/// A compact vehicle tile for two-up grids (search results, a pulse's cars): photo on top,
/// the car's name and place beneath. The name never sits on the photo, so the photo stays clear.
struct NukeVehicleTile: View {
    let imageURL: URL?
    let name: String?
    var detail: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: NukeSpace.sm) {
            NukePhoto(url: imageURL, maxPixel: 640)
                .aspectRatio(4.0 / 3.0, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: NukeRadius.card, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                if let name { Text(name).font(.subheadline.weight(.semibold)).lineLimit(2) }
                if let detail { Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 2)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// A grid of shimmering tiles while a search or filter loads.
struct NukeTileGridSkeleton: View {
    var message: String
    private let columns = [GridItem(.flexible(), spacing: NukeSpace.md), GridItem(.flexible(), spacing: NukeSpace.md)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NukeSpace.md) {
                Text(message).font(.nukeDetail).foregroundStyle(.secondary)
                LazyVGrid(columns: columns, spacing: NukeSpace.lg) {
                    ForEach(0..<6, id: \.self) { _ in
                        VStack(alignment: .leading, spacing: NukeSpace.sm) {
                            NukeSkeletonBlock(radius: NukeRadius.card).aspectRatio(4.0 / 3.0, contentMode: .fit)
                            NukeSkeletonBlock(height: 12).frame(maxWidth: 110)
                        }
                    }
                }
            }
            .padding(NukeSpace.lg)
        }
        .scrollDisabled(true)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(message)
    }
}
