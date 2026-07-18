// MainTabView.swift — the app spine: LIBRARY · EXPLORE · PROFILE · TODAY.
//
// LIBRARY is the FOUNDATION for a signed-in owner with full access — their whole
// photo library at Photos speed (the source); everything else rides on top as
// glasses. Tabs, left to right (Library shown only when signed in + full access):
//
//   EXPLORE  the front door (LEFTMOST). The populated world of vehicles + the
//            cohort market terminal — reachable signed-out, no wall. An anon
//            visitor lands here; "not signing in" is never a dead end (Sign In
//            lives in the Profile toolbar). Explore being the leftmost tab makes
//            the front-door ruling STRUCTURAL, not a selection trick — the cure
//            for "dumped in my back office / there's no actual exploring."
//   PROFILE  the owner's record (own when signed in, the sample in explore
//            mode); other profiles via handle search. Receipt-first: a
//            signed-in owner's FIRST landing is still their own record.
//   TODAY    only when signed in AND the photo grant exists — the capture gauge
//            + pause toggle (the consent surface) and the live-analysis
//            worklight. Conditional BY DESIGN (no upload button; the gauge is
//            the consent surface) — not a bug to "fix" by always-showing it.
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

    enum Tab: Hashable { case library, profile, explore, today }

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

            // EXPLORE — the FRONT DOOR for anon visitors: the populated world +
            // the cohort market terminal. The anon spine reads explore-first.
            ExploreView()
                .tag(Tab.explore)
                .tabItem { Label("Explore", systemImage: "magnifyingglass") }

            profileTab
                .tag(Tab.profile)
                .tabItem { Label("Profile", systemImage: "person") }

            // ENGINE (was "Today") — the engine room: the live worklight (the agent
            // reading your photos) + the workbench (operator tools). Renamed because a
            // "Today" that reads 0 most days was the old cloud-relay paradigm leaking
            // through; in the local-first model this is honestly the engine, not a feed.
            if session.isSignedIn && photoGrant {
                TodayView()
                    .tag(Tab.today)
                    .tabItem { Label("Engine", systemImage: "gauge.medium") }
            }
        }
        .onAppear { tab = landingTab() }
        .onChange(of: session.isSignedIn) { _, _ in tab = landingTab() }
        .onChange(of: scenePhase) { _, phase in
            // Settings round-trips can change the grant — re-read it.
            if phase == .active {
                photoGrant = Self.currentPhotoGrant()
                fullAccess = (PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized)
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

    /// Photo grant exists = .authorized or .limited (matches SyncEngine).
    static func currentPhotoGrant() -> Bool {
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        return status == .authorized || status == .limited
    }
}
