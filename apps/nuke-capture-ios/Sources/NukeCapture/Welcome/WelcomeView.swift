// WelcomeView.swift — the first-launch welcome: four swipeable full-bleed photo pages, then
// the way in. Shown once, before sign-in (see WelcomeGate).
//
// The pitch is "LinkedIn plus Uber for car guys". Each page is one plain sentence and one
// supporting line over a real vehicle photo (WelcomePhotos); a gradient shows until the photo
// loads, or for good if it never does. The last page ends in one big Sign in with Apple
// button, a clear "Look around first" that opens Explore signed out, and a smaller email door.

import AuthenticationServices
import SwiftUI

struct WelcomePage: Equatable {
    let headline: String
    let detail: String
    /// Shown above the headline on the first page only.
    let kicker: String?
    let gradient: [Color]

    static let all: [WelcomePage] = [
        WelcomePage(
            headline: "Find work near you.",
            detail: "See the jobs people near you need done on their cars, and pick the ones you want.",
            kicker: "LinkedIn plus Uber for car guys.",
            gradient: [Color(red: 0.05, green: 0.16, blue: 0.30), Color(red: 0.02, green: 0.04, blue: 0.10)]),
        WelcomePage(
            headline: "Show off your work.",
            detail: "Your photos become proof. Every job you finish adds to a record anyone can check.",
            kicker: nil,
            gradient: [Color(red: 0.28, green: 0.10, blue: 0.08), Color(red: 0.07, green: 0.03, blue: 0.03)]),
        WelcomePage(
            headline: "Hire a tech.",
            detail: "Post what your car needs, get offers, and look at each tech's past work before you choose.",
            kicker: nil,
            gradient: [Color(red: 0.06, green: 0.24, blue: 0.20), Color(red: 0.02, green: 0.07, blue: 0.06)]),
        WelcomePage(
            headline: "See what cars really sell for.",
            detail: "Real auction bids and asking prices from real listings. No guessing.",
            kicker: nil,
            gradient: [Color(red: 0.20, green: 0.14, blue: 0.30), Color(red: 0.05, green: 0.03, blue: 0.09)]),
    ]
}

struct WelcomeView: View {
    @AppStorage("exploreMode") private var exploreMode = false
    @AppStorage(WelcomeGate.seenKey) private var welcomeSeen = false
    @StateObject private var photos = WelcomePhotoModel(pages: WelcomePage.all.count)
    /// Which page is showing. Driven by a scroll position (not a page-style TabView, whose
    /// selection did not follow programmatic changes: the dots moved but the photo did not).
    @State private var position: Int? = 0
    private var page: Int { position ?? 0 }
    @State private var isWorking = false
    @State private var errorMessage: String?
    /// Raw nonce for the in-flight Apple request (its hash rides in the request).
    @State private var appleNonce: String?

    private let pages = WelcomePage.all
    /// Room the page text leaves for the controls pinned at the bottom.
    private let controlsReserve: CGFloat = 310

    private var isLast: Bool { page == pages.count - 1 }

    var body: some View {
        NavigationStack {
            ZStack {
                ScrollView(.horizontal) {
                    LazyHStack(spacing: 0) {
                        ForEach(pages.indices, id: \.self) { index in
                            pageView(index)
                                .containerRelativeFrame(.horizontal)
                                .id(index)
                        }
                    }
                    .scrollTargetLayout()
                }
                .scrollTargetBehavior(.paging)
                .scrollPosition(id: $position)
                .scrollIndicators(.hidden)
                .ignoresSafeArea()

                VStack(spacing: 0) {
                    topBar
                    Spacer()
                    controls
                }
            }
            .background(Color.black)
            .toolbar(.hidden, for: .navigationBar)
        }
        .preferredColorScheme(.dark)
        .task { await photos.load() }
    }

    // ─── Pages ───────────────────────────────────────────────────────────────

    private func pageView(_ index: Int) -> some View {
        let copy = pages[index]
        let item = photos.items[index]
        return ZStack(alignment: .bottomLeading) {
            LinearGradient(colors: copy.gradient, startPoint: .top, endPoint: .bottom)

            if let item, let url = NukeImage.thumb(item.image, width: 1170) {
                // Color.clear + overlay keeps a scaledToFill photo from stretching the layout.
                Color.clear
                    .overlay {
                        CachedAsyncImage(url: url, maxPixel: 1800) { image in
                            image.resizable().scaledToFill()
                        } placeholder: {
                            Color.clear
                        }
                    }
                    .clipped()
            }

            // Scrim so white text stays readable on any photo.
            LinearGradient(colors: [.black.opacity(0.35), .clear, .black.opacity(0.85)],
                           startPoint: .top, endPoint: .bottom)

            VStack(alignment: .leading, spacing: 14) {
                if let kicker = copy.kicker {
                    Text(kicker)
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(.white.opacity(0.92))
                }
                Text(copy.headline)
                    .font(.largeTitle.weight(.heavy))
                    .foregroundStyle(.white)
                    .minimumScaleFactor(0.7)
                    .accessibilityAddTraits(.isHeader)
                Text(copy.detail)
                    .font(.title3)
                    .foregroundStyle(.white.opacity(0.95))
                    .fixedSize(horizontal: false, vertical: true)
                if let item {
                    Text(photoCredit(item))
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.7))
                        .lineLimit(1)
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, controlsReserve)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private func photoCredit(_ item: ExploreFeedItem) -> String {
        "Photo: \(item.title) · \(item.source)"
    }

    // ─── Chrome ──────────────────────────────────────────────────────────────

    private var topBar: some View {
        HStack {
            Text("NUKE")
                .font(.title3.weight(.heavy))
                .kerning(3)
                .foregroundStyle(.white)
            Spacer()
            if !isLast {
                Button {
                    withAnimation { position = pages.count - 1 }
                } label: {
                    Text("Skip")
                        .font(.headline)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 16)
                        .frame(minHeight: 44)
                }
                .accessibilityIdentifier("welcome.skip")
            }
        }
        .padding(.horizontal, 24)
        .padding(.top, 8)
    }

    private var dots: some View {
        HStack(spacing: 10) {
            ForEach(pages.indices, id: \.self) { index in
                Capsule()
                    .fill(index == page ? Color.white : Color.white.opacity(0.4))
                    .frame(width: index == page ? 28 : 10, height: 10)
            }
        }
        .animation(.easeInOut(duration: 0.2), value: page)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Page \(page + 1) of \(pages.count)")
    }

    private var controls: some View {
        VStack(spacing: 14) {
            dots
                .padding(.bottom, 6)

            if isLast {
                if let errorMessage {
                    // Stays on this page, in plain words, until the next attempt.
                    Text(errorMessage)
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.center)
                        .padding(12)
                        .frame(maxWidth: .infinity)
                        .background(Color.red.opacity(0.55), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .accessibilityIdentifier("welcome.error")
                }

                // The one primary action. Apple's own button (its label is fixed by Apple's
                // guidelines): Face ID or a passkey, no browser hop, no password to type.
                Text("Get started")
                    .font(.title2.weight(.bold))
                    .foregroundStyle(.white)
                    .accessibilityAddTraits(.isHeader)

                SignInWithAppleButton(.signIn) { request in
                    appleNonce = AppleSignIn.prepare(request)
                } onCompletion: { result in
                    let nonce = appleNonce
                    appleNonce = nil
                    isWorking = true
                    errorMessage = nil
                    Task {
                        errorMessage = await AppleSignIn.complete(result, nonce: nonce)
                        isWorking = false
                    }
                }
                .signInWithAppleButtonStyle(.white)
                .frame(height: 58)
                .disabled(isWorking)
                .accessibilityIdentifier("welcome.apple")

                Button {
                    welcomeSeen = true
                    exploreMode = true
                } label: {
                    Text("Look around first")
                        .font(.headline)
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, minHeight: 48)
                }
                .disabled(isWorking)
                .accessibilityIdentifier("welcome.lookAround")

                NavigationLink {
                    EmailSignInView()
                } label: {
                    Text("Use email instead")
                        .font(.body)
                        .underline()
                        .foregroundStyle(.white.opacity(0.9))
                        .frame(minHeight: 44)
                }
                .disabled(isWorking)
                .accessibilityIdentifier("welcome.email")
            } else {
                Button {
                    withAnimation { position = min(page + 1, pages.count - 1) }
                } label: {
                    Text("Next")
                        .font(.headline)
                        .foregroundStyle(.black)
                        .frame(maxWidth: .infinity, minHeight: 58)
                        .background(.white, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .accessibilityIdentifier("welcome.next")
            }
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 24)
    }
}
