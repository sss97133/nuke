// MainTabView.swift — the app: PROFILE · TODAY.
//
// The 1.0 Jobs cut (2026-06-11): the app does ONE thing — your photos
// develop into your record. Two tabs, one story:
//
//   PROFILE  always — own record signed in, the sample profile in explore
//            mode; other profiles via handle search either way. First tab:
//            the app lands on YOUR record (receipt-first ruling).
//   TODAY    only when signed in AND the photo grant exists — the capture
//            gauge + the pause toggle (the consent surface)
//
// MAP is cut from 1.0 — a directory of strangers diluted the story. It
// returns in Build 2 as the pulse map, a window onto analysis
// (BUILD_2_SCOPE.md §5). MapTab.swift stays in the target for that return.
//
// Explore mode (signed out): sample Profile, read-only. Sign In lives in
// the Profile toolbar so not-signing-in is never a dead end and the way
// back in is always one tap.

import Photos
import SwiftUI

struct MainTabView: View {
    @EnvironmentObject private var session: SessionStore
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("exploreMode") private var exploreMode = false
    @State private var photoGrant = Self.currentPhotoGrant()

    var body: some View {
        TabView {
            profileTab
                .tabItem { Label("Profile", systemImage: "person") }

            // EXPLORE — Build-2 §5: search the real record, drill into a
            // vehicle. Works signed-out too (not-signing-in is never a dead end).
            ExploreView()
                .tabItem { Label("Explore", systemImage: "magnifyingglass") }

            if session.isSignedIn && photoGrant {
                TodayView()
                    .tabItem { Label("Today", systemImage: "clock") }
            }
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
