// PersonaOnboardingView.swift — "What brings you here?": four big photo cards, one tap each.
//
// Shown once right after a first sign-in (or after "Look around first"), and again from Profile
// when someone wants to change their answer. The photos are the same real vehicle photos the
// welcome uses (WelcomePhotoModel); a gradient and an icon stand in until one loads or if none
// does. No permission is asked here; that waits until a feature needs it (PermissionPrimer).

import SwiftUI

struct PersonaOnboardingView: View {
    enum Mode: Equatable {
        /// First time: no way to leave without answering ("Just browsing" is the easy out).
        case first
        /// Changing it later from Profile: the current answer is marked and the sheet can be closed.
        case change(current: Persona?)
    }

    let scope: String
    var mode: Mode = .first
    /// Called after the choice is saved (the sheet uses it to close itself).
    var onChosen: (() -> Void)? = nil

    @ObservedObject private var store = PersonaStore.shared
    @StateObject private var photos = WelcomePhotoModel(pages: Persona.allCases.count)

    private var current: Persona? {
        if case .change(let current) = mode { return current }
        return nil
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NukeSpace.lg) {
                VStack(alignment: .leading, spacing: NukeSpace.xs) {
                    Text("What brings you here?")
                        .font(.largeTitle.weight(.heavy))
                        .accessibilityAddTraits(.isHeader)
                    Text("Pick one. You can change it later in Profile.")
                        .font(.title3)
                        .foregroundStyle(.secondary)
                }
                .padding(.top, NukeSpace.lg)

                ForEach(Array(Persona.allCases.enumerated()), id: \.element.id) { index, persona in
                    PersonaCard(persona: persona,
                                item: photos.items[index],
                                selected: persona == current) {
                        store.choose(persona, for: scope)
                        onChosen?()
                    }
                }
            }
            .padding(.horizontal, NukeSpace.lg)
            .padding(.bottom, NukeSpace.xl)
        }
        .background(Color(.systemGroupedBackground))
        .task { await photos.load() }
    }
}

/// One big tappable card: a vehicle photo behind the words, in the same look as the welcome pages.
struct PersonaCard: View {
    let persona: Persona
    let item: ExploreFeedItem?
    var selected = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack(alignment: .bottomLeading) {
                LinearGradient(colors: Self.gradient(persona), startPoint: .topLeading, endPoint: .bottomTrailing)

                Image(systemName: persona.symbol)
                    .font(.system(size: 54, weight: .light))
                    .foregroundStyle(.white.opacity(0.35))
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                    .padding(NukeSpace.xl)
                    .accessibilityHidden(true)

                if let item, let url = NukeImage.thumb(item.image, width: 1170) {
                    // Color.clear + overlay keeps a scaledToFill photo from stretching the layout.
                    Color.clear
                        .overlay {
                            CachedAsyncImage(url: url, maxPixel: 1280) { image in
                                image.resizable().scaledToFill()
                            } placeholder: {
                                Color.clear
                            }
                        }
                        .clipped()
                }

                // Scrim so white text stays readable on any photo.
                LinearGradient(colors: [.black.opacity(0.15), .clear, .black.opacity(0.8)],
                               startPoint: .top, endPoint: .bottom)

                VStack(alignment: .leading, spacing: NukeSpace.xs) {
                    Text(persona.title)
                        .font(.title.weight(.bold))
                        .foregroundStyle(.white)
                        .minimumScaleFactor(0.8)
                        .multilineTextAlignment(.leading)
                    Text(persona.detail)
                        .font(.title3)
                        .foregroundStyle(.white.opacity(0.95))
                    if let item {
                        Text("Photo: \(item.title) · \(item.source)")
                            .font(.caption)
                            .foregroundStyle(.white.opacity(0.65))
                            .lineLimit(1)
                            .padding(.top, 2)
                    }
                }
                .padding(NukeSpace.lg)
                .frame(maxWidth: .infinity, alignment: .leading)

                if selected {
                    Label("Your pick", systemImage: "checkmark.circle.fill")
                        .font(.nukePill)
                        .foregroundStyle(.white)
                        .padding(.horizontal, NukeSpace.md).padding(.vertical, 6)
                        .background(Capsule().fill(Color.accentColor))
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                        .padding(NukeSpace.md)
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 176)
            .clipShape(RoundedRectangle(cornerRadius: NukeRadius.hero, style: .continuous))
            .shadow(color: .black.opacity(0.12), radius: 10, y: 4)
            .contentShape(RoundedRectangle(cornerRadius: NukeRadius.hero, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(persona.title). \(persona.detail)")
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
        .accessibilityIdentifier("persona.\(persona.rawValue)")
    }

    static func gradient(_ persona: Persona) -> [Color] {
        switch persona {
        case .tech: return [Color(red: 0.05, green: 0.16, blue: 0.30), Color(red: 0.02, green: 0.04, blue: 0.10)]
        case .buyerSeller: return [Color(red: 0.28, green: 0.10, blue: 0.08), Color(red: 0.07, green: 0.03, blue: 0.03)]
        case .shop: return [Color(red: 0.06, green: 0.24, blue: 0.20), Color(red: 0.02, green: 0.07, blue: 0.06)]
        case .browsing: return [Color(red: 0.20, green: 0.14, blue: 0.30), Color(red: 0.05, green: 0.03, blue: 0.09)]
        }
    }
}

/// The Profile door: shows the current answer and reopens the question in a sheet.
struct PersonaProfileSection: View {
    let scope: String
    @ObservedObject private var store = PersonaStore.shared
    @State private var showing = false

    var body: some View {
        let current = store.choice(for: scope)
        Section {
            Button {
                showing = true
            } label: {
                HStack(spacing: NukeSpace.md) {
                    Image(systemName: current?.symbol ?? "questionmark.circle")
                        .font(.title2)
                        .frame(width: 32)
                        .foregroundStyle(Color.accentColor)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("What brings you here?").font(.nukeCardTitle).foregroundStyle(.primary)
                        Text(current?.title ?? "Not picked yet").font(.nukeDetail).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text("Change").font(.nukePill).foregroundStyle(Color.accentColor)
                }
                .frame(minHeight: NukeSize.minTap)
                .contentShape(Rectangle())
            }
            .accessibilityIdentifier("profile.persona")
            .sheet(isPresented: $showing) {
                NavigationStack {
                    PersonaOnboardingView(scope: scope, mode: .change(current: current)) { showing = false }
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            ToolbarItem(placement: .topBarLeading) { Button("Cancel") { showing = false } }
                        }
                }
            }
        }
    }
}
