// MainTabView.swift — the app: MAP · PROFILE · TODAY.
//
// The app opens onto an already-populated world (real org pins, real
// profiles) — the phonebook effect. Capture is one grant, not the app:
//
//   MAP      always — real organization pins from prod
//   PROFILE  always — own profile signed in, the sample profile in explore
//            mode; other profiles via handle search either way
//   TODAY    only when signed in AND the photo grant exists — the capture
//            gauge + the pause toggle (the consent surface)
//
// Explore mode (signed out): Map + sample Profile, read-only. Sign In lives
// in the Profile toolbar so not-signing-in is never a dead end and the way
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
            MapTab()
                .tabItem { Label("Map", systemImage: "map") }

            profileTab
                .tabItem { Label("Profile", systemImage: "person") }

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
