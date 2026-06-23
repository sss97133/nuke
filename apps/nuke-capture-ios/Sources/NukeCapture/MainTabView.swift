// MainTabView.swift — the app spine: EXPLORE · PROFILE · TODAY.
//
// Three tabs, left to right:
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
    @State private var tab: Tab = .explore

    enum Tab: Hashable { case profile, explore, today }

    var body: some View {
        TabView(selection: $tab) {
            // EXPLORE — the FRONT DOOR (leftmost): open the app already in the
            // populated world + the cohort market terminal, never dumped in the
            // back-office Profile. The anon spine reads explore-first.
            ExploreView()
                .tag(Tab.explore)
                .tabItem { Label("Explore", systemImage: "magnifyingglass") }

            profileTab
                .tag(Tab.profile)
                .tabItem { Label("Profile", systemImage: "person") }

            if session.isSignedIn && photoGrant {
                TodayView()
                    .tag(Tab.today)
                    .tabItem { Label("Today", systemImage: "clock") }
            }
        }
        .onAppear {
            // Signed-in owners land on THEIR record (receipt-first); everyone
            // else lands on Explore — exploring is the front door, not a profile.
            tab = session.isSignedIn ? .profile : .explore
        }
        .onChange(of: session.isSignedIn) { _, signedIn in
            tab = signedIn ? .profile : .explore
        }
        .onChange(of: scenePhase) { _, phase in
            // Settings round-trips can change the grant — re-read it.
            if phase == .active { photoGrant = Self.currentPhotoGrant() }
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

    /// Photo grant exists = .authorized or .limited (matches SyncEngine).
    static func currentPhotoGrant() -> Bool {
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        return status == .authorized || status == .limited
    }
}
