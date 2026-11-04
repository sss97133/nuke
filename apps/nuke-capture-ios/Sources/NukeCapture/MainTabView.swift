// MainTabView.swift — LIBRARY · GARAGE · EXPLORE · PROFILE · WORK.
//
// LIBRARY is the FOUNDATION for a signed-in owner with full access — their whole
// photo library at Photos speed (the source); everything else rides on top as
// glasses. Garage is the direct route to the account's vehicle profiles, with
// no Photos grant required. Library is shown only with full Photos access.
//
//   GARAGE   the signed-in account's vehicle records, searchable by vehicle or
//            VIN. A row opens the full profile, including zero-photo records.
//   EXPLORE  the signed-out front door. The populated world of vehicles + the
//            cohort market terminal — reachable signed-out, no wall. An anon
//            visitor lands here; "not signing in" is never a dead end (Sign In
//            lives in the Profile toolbar). It remains the leftmost destination
//            for a visitor; the owner's Library and Garage precede it. Explore
//            is also the first tab selected after sign-in.
//   PROFILE  the owner's record (own when signed in, the sample in explore
//            mode); other profiles via handle search.
//   WORK     every signed-in account: signature queue, jobs in motion (each
//            opens JobView), open requirements. Its Capture section (the
//            capture gauge + pause toggle, the consent surface, and the
//            live-analysis worklight) shows only when the photo grant exists,
//            conditional BY DESIGN as the old Engine tab was.
//
// MAP stays cut from 1.0 — it returns in Build 2 as the pulse map
// (BUILD_2_SCOPE.md §5); Explore is its 1.0 stand-in. Recover MapTab from git
// when Build 2 needs it.

import Photos
import SwiftUI

struct MainTabView: View {
    @EnvironmentObject private var session: SessionStore
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("exploreMode") private var exploreMode = false
    @State private var photoGrant = Self.currentPhotoGrant()
    @State private var fullAccess = (PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized)
    @State private var tab: Tab = .explore
    @ObservedObject private var inboxBadge = InboxBadgeStore.shared
    /// The saved "What brings you here?" answer: picks the tab the app opens on and the one-line tip.
    @ObservedObject private var personas = PersonaStore.shared
    /// The friendly line shown at the top of the landing tab until it is dismissed.
    @State private var tip: String?
    /// Live per-photo progress for this shooting session (the slim bar at the top).
    @StateObject private var ingest = CaptureIngestStore()

    enum Tab: Hashable { case library, garage, profile, explore, today }

    private var accountScope: String {
        session.isSignedIn ? (SupabaseService.currentUserId ?? "signed-in") : "visitor"
    }

    var body: some View {
        TabView(selection: $tab) {
            // LIBRARY — the FOUNDATION (home for owners): the whole on-device
            // photo library at Photos speed (LibraryView). Maximum visibility to
            // the source; the DB rides on top as async glasses.
            if session.isSignedIn && fullAccess {
                LibraryView()
                    .tag(Tab.library)
                    .tabItem { Label("Library", systemImage: "photo.on.rectangle.angled") }
            }

            // Vehicle records are a primary destination, independent of Photos
            // access, ownership status and whether any photos have been filed.
            if session.isSignedIn, let userId = SupabaseService.currentUserId {
                NavigationStack { GarageView(userId: userId) }
                    .tag(Tab.garage)
                    .tabItem { Label("Garage", systemImage: "car.2") }
            }

            // EXPLORE — the FRONT DOOR for anon visitors: the populated world +
            // the cohort market terminal. The anon spine reads explore-first.
            ExploreView()
                .tag(Tab.explore)
                .tabItem { Label("Explore", systemImage: "magnifyingglass") }

            profileTab
                .tag(Tab.profile)
                .tabItem { Label("Profile", systemImage: "person") }

            // WORK (was "Engine", before that "Today") — what needs you now: signatures,
            // jobs in motion, open requirements. Every signed-in account has it, so a
            // client without a photo grant still has a console. The Engine's capture
            // sections live inside as "Capture", still gated on the photo grant.
            if session.isSignedIn {
                WorkConsoleView(showCapture: photoGrant)
                    .tag(Tab.today)
                    .tabItem { Label("Work", systemImage: "wrench.and.screwdriver") }
                    .badge(inboxBadge.badge)
            }
        }
        // The live ingest status bar: pinned above every tab, hidden when the session has nothing.
        // Beneath it, the persona tip (one friendly line) until it is dismissed.
        .safeAreaInset(edge: .top, spacing: 0) {
            VStack(spacing: 0) {
                if session.isSignedIn { CaptureIngestBar(store: ingest) }
                if let tip { PersonaTipBanner(text: tip, onDismiss: dismissTip) }
            }
        }
        .task(id: accountScope) {
            guard session.isSignedIn, let uid = SupabaseService.currentUserId else { return }
            #if DEBUG
            if FixtureBackend.isActive { return }   // UI tests run on a fake host; no Realtime there
            #endif
            await ingest.run(userId: uid)
        }
        // Discard another account's navigation and private screen state. Merely
        // returning from a sheet or another tab must preserve the user's place.
        .id(accountScope)
        .onChange(of: accountScope, initial: true) { _, _ in applyPersona() }
        // Answered (or changed from Profile) while the tabs are up: go there and say what to do.
        .onChange(of: personas.revision) { _, _ in applyPersona() }
        .onChange(of: fullAccess) { _, _ in
            tab = Self.availableTab(tab, signedIn: session.isSignedIn, fullAccess: fullAccess)
        }
        .task(id: accountScope) { await inboxBadge.refresh() }
        .onChange(of: scenePhase) { _, phase in
            // Settings round-trips can change the grant — re-read it.
            if phase == .active {
                photoGrant = Self.currentPhotoGrant()
                fullAccess = (PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized)
                Task { await inboxBadge.refresh() }
                Task { await ingest.refresh() }
            }
        }
    }

    /// Lands on the tab the person's answer points at (Explore with no answer) and shows the
    /// one-line tip once, if it has not been dismissed.
    private func applyPersona() {
        let persona = personas.choice(for: accountScope)
        tab = Self.startTab(for: persona, signedIn: session.isSignedIn, fullAccess: fullAccess)
        if let persona, personas.tipPending(for: accountScope) {
            tip = persona.tip(signedIn: session.isSignedIn)
        } else {
            tip = nil
        }
    }

    private func dismissTip() {
        tip = nil
        personas.dismissTip(for: accountScope)
    }

    private var profileTab: some View {
        // Explore mode passes nil → sample profile + a Sign In door in the
        // ProfileTab toolbar (not-signing-in is never a dead end).
        ProfileTab(
            ownUserId: session.isSignedIn ? SupabaseService.currentUserId : nil,
            onSignIn: session.isSignedIn ? nil : { exploreMode = false }
        )
    }

    /// Everyone lands on Explore: the populated world is the front door for a visitor, and for a
    /// signed-in owner it is the answer to "what is this app". Library, Garage, Profile and Work
    /// are one tap away. The first-run photo scan (IgnitionView) runs BEFORE this view exists,
    /// so a new account still gets its intro and scan first and lands here when it finishes.
    static let defaultTab: Tab = .explore

    /// The tab a person starts on: where their answer to "What brings you here?" points, or Explore
    /// with no answer. Work and Garage need an account, so a visitor starts on Explore instead.
    static func startTab(for persona: Persona?, signedIn: Bool, fullAccess: Bool) -> Tab {
        let wanted: Tab
        switch persona?.landing {
        case .work: wanted = signedIn ? .today : defaultTab
        case .garage: wanted = signedIn ? .garage : defaultTab
        case .explore, nil: wanted = defaultTab
        }
        return availableTab(wanted, signedIn: signedIn, fullAccess: fullAccess)
    }

    static func availableTab(_ selected: Tab, signedIn: Bool, fullAccess: Bool) -> Tab {
        if selected == .library && !(signedIn && fullAccess) { return signedIn ? .profile : .explore }
        if selected == .today && !signedIn { return .explore }
        if selected == .garage && !signedIn { return .explore }
        return selected
    }

    /// Photo grant exists = .authorized or .limited (matches SyncEngine).
    static func currentPhotoGrant() -> Bool {
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        return status == .authorized || status == .limited
    }
}

/// One friendly line under the top of the screen, with a close button. Big text, one sentence.
struct PersonaTipBanner: View {
    let text: String
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: NukeSpace.md) {
            Image(systemName: "lightbulb")
                .font(.title3)
                .foregroundStyle(Color.accentColor)
                .accessibilityHidden(true)
            Text(text)
                .font(.system(.body, design: .rounded).weight(.medium))
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.footnote.weight(.bold))
                    .frame(width: NukeSize.minTap, height: NukeSize.minTap)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Dismiss tip")
            .accessibilityIdentifier("persona.tip.dismiss")
        }
        .padding(.leading, NukeSpace.lg)
        .padding(.vertical, NukeSpace.xs)
        .background(Color(.secondarySystemGroupedBackground))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("persona.tip")
    }
}
