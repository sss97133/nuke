// SignInView.swift — the login constellation, plus the account sheet.
//
// First screen: NUKE wordmark above the full provider row —
//
//   Sign in with Apple      (primary — Face ID, zero typing, Guideline 4.8)
//   Continue with Google    (renders only when Config.enableGoogleSignIn —
//                            hidden until the Supabase Google provider is
//                            configured; disabled placeholders risk a 2.1
//                            App Review rejection)
//   Continue with email     (same account as nuke.ag)
//   Explore                 (no auth — read-only Map + sample profile;
//                            not-signing-in is not a dead end)
//
// SIWA nonce dance: a fresh random nonce is SHA-256-hashed into the Apple
// request, Apple bakes that hash into the ID token's `nonce` claim, and
// Supabase receives the RAW nonce to verify the hash — replay protection.
//
// Account deletion (AccountView below) is REQUIRED by App Store Review
// Guideline 5.1.1(v) — the `request_account_deletion` RPC is live in prod
// (apps/APP_STORE_LAUNCH.md §2, DONE 2026-06-10).

import AuthenticationServices
import CryptoKit
import SwiftUI

// ─── The constellation ───────────────────────────────────────────────────────

struct SignInView: View {
    @AppStorage("exploreMode") private var exploreMode = false
    @State private var isWorking = false
    @State private var errorMessage: String?
    /// Raw nonce for the in-flight Apple request; its SHA-256 hash rides in
    /// the request, the raw value goes to Supabase for verification.
    @State private var appleNonce: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                Spacer()

                Text("NUKE")
                    .font(.system(size: 40, weight: .heavy))
                    .kerning(4)

                Spacer()

                SignInWithAppleButton(.signIn) { request in
                    let nonce = AppleNonce.random()
                    appleNonce = nonce
                    request.requestedScopes = [.fullName, .email]
                    request.nonce = AppleNonce.sha256(nonce)
                } onCompletion: { result in
                    handleAppleSignIn(result)
                }
                .signInWithAppleButtonStyle(.black)
                .frame(height: 50)
                .disabled(isWorking)

                // Google: render only when the provider is configured — a
                // visibly disabled button reads as placeholder UI to App
                // Review (Guideline 2.1). Flip Config.enableGoogleSignIn to
                // bring it back once the Supabase provider exists.
                if Config.enableGoogleSignIn {
                    Button {
                        // TODO(google-auth): client.auth.signInWithOAuth(
                        //   provider: .google) once the Supabase provider is
                        //   configured for ag.nuke.capture.
                    } label: {
                        Text("Continue with Google")
                            .frame(maxWidth: .infinity, minHeight: 34)
                    }
                    .buttonStyle(.bordered)
                    .disabled(isWorking)
                }

                NavigationLink {
                    EmailSignInView()
                } label: {
                    Text("Continue with email")
                        .frame(maxWidth: .infinity, minHeight: 34)
                }
                .buttonStyle(.bordered)
                .disabled(isWorking)

                if let errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                }

                Button("Explore") {
                    exploreMode = true
                }
                .padding(.top, 12)
                .disabled(isWorking)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
    }

    private func handleAppleSignIn(_ result: Result<ASAuthorization, Error>) {
        switch result {
        case .failure(let error):
            // User dismissing the Apple sheet is not an error worth showing.
            if let authError = error as? ASAuthorizationError, authError.code == .canceled {
                return
            }
            errorMessage = error.localizedDescription

        case .success(let authorization):
            guard
                let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                let tokenData = credential.identityToken,
                let idToken = String(data: tokenData, encoding: .utf8),
                let nonce = appleNonce
            else {
                errorMessage = "Apple returned no identity token — try again."
                return
            }
            appleNonce = nil
            isWorking = true
            errorMessage = nil
            Task {
                do {
                    try await SupabaseService.signInWithApple(idToken: idToken, nonce: nonce)
                    // SessionStore flips the root view on auth change.
                } catch {
                    errorMessage = error.localizedDescription
                }
                isWorking = false
            }
        }
    }
}

// ─── Email door ──────────────────────────────────────────────────────────────

/// Email/password — the same account as nuke.ag. Pushed from the
/// constellation's "Continue with email".
struct EmailSignInView: View {
    @State private var email = ""
    @State private var password = ""
    @State private var isWorking = false
    @State private var errorMessage: String?

    var body: some View {
        Form {
            Section {
                TextField("Email", text: $email)
                    .keyboardType(.emailAddress)
                    .textContentType(.username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                SecureField("Password", text: $password)
                    .textContentType(.password)
            }

            if let errorMessage {
                Section {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
            }

            Section {
                Button {
                    signIn()
                } label: {
                    if isWorking {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                    } else {
                        Text("Sign In")
                            .frame(maxWidth: .infinity)
                    }
                }
                .disabled(isWorking || email.isEmpty || password.isEmpty)
            }
        }
        .navigationTitle("Email")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func signIn() {
        isWorking = true
        errorMessage = nil
        Task {
            do {
                try await SupabaseService.signIn(email: email, password: password)
                // SessionStore observes authStateChanges — the root view
                // flips on its own; nothing else to do here.
            } catch {
                errorMessage = error.localizedDescription
            }
            isWorking = false
        }
    }
}

// ─── Apple nonce helpers ─────────────────────────────────────────────────────

/// Standard SIWA nonce pair (Apple's documented pattern): a cryptographically
/// random string whose SHA-256 hex digest is what Apple signs into the ID
/// token. Shared by any view that hosts a SignInWithAppleButton.
enum AppleNonce {
    /// Cryptographically secure random nonce (SecRandomCopyBytes).
    static func random(length: Int = 32) -> String {
        let charset = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._")
        var result = ""
        var remaining = length
        while remaining > 0 {
            var randoms = [UInt8](repeating: 0, count: 16)
            let status = SecRandomCopyBytes(kSecRandomDefault, randoms.count, &randoms)
            precondition(status == errSecSuccess, "SecRandomCopyBytes failed: \(status)")
            for random in randoms where remaining > 0 {
                // Rejection sampling (charset.count = 65 < 256) avoids modulo bias.
                if random < charset.count {
                    result.append(charset[Int(random)])
                    remaining -= 1
                }
            }
        }
        return result
    }

    /// Hex-encoded SHA-256 — the form Apple expects in `request.nonce`.
    static func sha256(_ input: String) -> String {
        SHA256.hash(data: Data(input.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
    }
}

// ─── Account sheet (sign out + delete + sites) ───────────────────────────────

/// Presented from TodayView's toolbar. Sign out, full account deletion
/// (5.1.1(v)), and the confirmed-sites list — naming a site is optional and
/// it happens here, not in the ignition flow.
struct AccountView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var siteStore = SiteStore.shared
    @State private var confirmingDeletion = false
    @State private var isWorking = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Signed in as") {
                    Text(SupabaseService.currentUserEmail ?? "—")
                        .foregroundStyle(.secondary)
                }

                // The photo grant, reported as a fact. Off → the one action
                // that exists (Settings). On-grant ignition re-arms at the
                // app level (NukeCaptureApp scenePhase handler).
                if !MainTabView.currentPhotoGrant() {
                    Section {
                        LabeledContent("Photos") {
                            Text("Off")
                        }
                        Button("Settings") {
                            if let url = URL(string: UIApplication.openSettingsURLString) {
                                UIApplication.shared.open(url)
                            }
                        }
                    }
                }

                // Confirmed work sites — rename in place (optional, never
                // required; ignition confirms with one tap and defaults the
                // name to SITE NN).
                if !siteStore.sites.isEmpty {
                    Section("Sites") {
                        ForEach(siteStore.sites.indices, id: \.self) { i in
                            TextField(
                                String(format: "SITE %02d", i + 1),
                                text: Binding(
                                    get: { siteStore.sites[i].name },
                                    set: { siteStore.rename(at: i, to: $0) }
                                )
                            )
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                        }
                    }
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                }

                Section {
                    Button("Sign Out") {
                        run { try await SupabaseService.signOut() }
                    }
                } footer: {
                    Text("Signing out stops all uploads from this device. Your photos and account are unaffected.")
                }

                Section {
                    Button("Delete Account", role: .destructive) {
                        confirmingDeletion = true
                    }
                } footer: {
                    Text("Permanently deletes your Nuke account and the data associated with it. This cannot be undone.")
                }
            }
            .navigationTitle("Account")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
            .disabled(isWorking)
            .confirmationDialog(
                "Delete your Nuke account?",
                isPresented: $confirmingDeletion,
                titleVisibility: .visible
            ) {
                Button("Delete Account", role: .destructive) {
                    run { try await SupabaseService.requestAccountDeletion() }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Your account and associated data will be permanently deleted. This cannot be undone.")
            }
        }
    }

    /// Shared async-action runner: spinner + verbatim error surfacing.
    private func run(_ action: @escaping () async throws -> Void) {
        isWorking = true
        errorMessage = nil
        Task {
            do {
                try await action()
                dismiss()
            } catch {
                // Surfaced verbatim on purpose — if the deletion RPC is
                // missing server-side, this is where we find out honestly.
                errorMessage = error.localizedDescription
            }
            isWorking = false
        }
    }
}
