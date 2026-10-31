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
//            for a visitor; the owner's Library and Garage precede it.
//   PROFILE  the owner's record (own when signed in, the sample in explore
//            mode); other profiles via handle search. Receipt-first: a
//            signed-in owner's FIRST landing is still their own record.
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
        // Discard another account's navigation and private screen state. Merely
        // returning from a sheet or another tab must preserve the user's place.
        .id(accountScope)
        .onChange(of: accountScope, initial: true) { _, _ in tab = landingTab() }
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
            }
        }
    }

    private var profileTab: some View {
        // Explore mode passes nil → sample profile + a Sign In door in the
        // ProfileTab toolbar (not-signing-in is never a dead end).
        ProfileTab(
            ownUserId: session.isSignedIn ? SupabaseService.currentUserId : nil,
            onSignIn: session.isSignedIn ? nil : { exploreMode = false }
        )
    }

    /// Signed-in owners land on their LIBRARY (the foundation) when full access
    /// exists; otherwise their record; anon visitors land on Explore.
    private func landingTab() -> Tab {
        if session.isSignedIn { return fullAccess ? .library : .profile }
        return .explore
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
