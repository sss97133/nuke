// SignInView.swift — auth UI: sign in, sign out, and account deletion.
//
// PRIMARY sign-in is Sign in with Apple (Face ID / Touch ID, zero typing):
// SwiftUI SignInWithAppleButton → ASAuthorizationAppleIDCredential →
// identityToken → SupabaseService.signInWithApple (signInWithIdToken).
// The nonce dance: a fresh random nonce is SHA-256-hashed into the Apple
// request, Apple bakes that hash into the ID token's `nonce` claim, and
// Supabase receives the RAW nonce to verify the hash — replay protection.
// SIWA also preempts App Store Guideline 4.8 (Login Services): offering it
// natively means no equivalent-privacy-login findings at review.
//
// Email/password (same account as nuke.ag) stays as the secondary path.
// Either way the session persists in the device Keychain via
// supabase-swift's default storage — sign in once per device.
//
// Account deletion is REQUIRED by App Store Review Guideline 5.1.1(v): any
// app that supports sign-in must let the user initiate full account deletion
// in-app. The button calls SupabaseService.requestAccountDeletion(), which
// invokes the `request_account_deletion` RPC. If that server function is not
// deployed yet, the call fails and the error is shown verbatim — deploying
// it is a PRE-SUBMISSION TODO tracked in apps/APP_STORE_LAUNCH.md §2.

import AuthenticationServices
import CryptoKit
import SwiftUI

// ─── Sign in ─────────────────────────────────────────────────────────────────

struct SignInView: View {
    @State private var email = ""
    @State private var password = ""
    @State private var isWorking = false
    @State private var errorMessage: String?
    /// Raw nonce for the in-flight Apple request; its SHA-256 hash rides in
    /// the request, the raw value goes to Supabase for verification.
    @State private var appleNonce: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Sign in with your Nuke account. Photos you take at your registered work locations upload to your own account — nothing else leaves the phone.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section {
                    SignInWithAppleButton(.signIn) { request in
                        let nonce = AppleNonce.random()
                        appleNonce = nonce
                        request.requestedScopes = [.fullName, .email]
                        request.nonce = AppleNonce.sha256(nonce)
                    } onCompletion: { result in
                        handleAppleSignIn(result)
                    }
                    .signInWithAppleButtonStyle(.black)
                    .frame(height: 48)
                    .listRowInsets(EdgeInsets())
                    .disabled(isWorking)
                } footer: {
                    Text("Face ID, no password. Or use your nuke.ag email below.")
                }

                // Google door — config-gated until the Supabase Google
                // provider is set up for this bundle id (Config.swift).
                // SIWA stays first-class above (App Store Guideline 4.8).
                if Config.enableGoogleSignIn {
                    Section {
                        Button {
                            // TODO(google-auth): client.auth.signInWithOAuth(
                            //   provider: .google) once the provider is
                            // configured server-side. Gate stays OFF until
                            // then — no dead buttons in a shipped build.
                        } label: {
                            Label("Sign in with Google", systemImage: "g.circle")
                                .frame(maxWidth: .infinity)
                        }
                        .disabled(true)
                    }
                }

                Section("Nuke account") {
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
            .navigationTitle("Nuke Capture")
        }
    }

    private func signIn() {
        isWorking = true
        errorMessage = nil
        Task {
            do {
                try await SupabaseService.signIn(email: email, password: password)
                // SessionStore observes authStateChanges — the root view
                // flips to TodayView on its own; nothing else to do here.
            } catch {
                errorMessage = error.localizedDescription
            }
            isWorking = false
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
                    // SessionStore flips the root view to TodayView.
                } catch {
                    errorMessage = error.localizedDescription
                }
                isWorking = false
            }
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

// ─── Account sheet (sign out + delete) ───────────────────────────────────────

/// Presented from TodayView's toolbar. Holds the two account actions Apple
/// review looks for: sign out, and full account deletion (5.1.1(v)).
struct AccountView: View {
    @Environment(\.dismiss) private var dismiss
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
