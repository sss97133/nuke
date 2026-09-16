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

                // Google / GitHub: render only when the provider is configured
                // — a visibly disabled button reads as placeholder UI to App
                // Review (Guideline 2.1). Flip the Config flag to bring each
                // back once the matching Supabase OAuth provider exists.
                if Config.enableGoogleSignIn {
                    Button {
                        runOAuth { try await SupabaseService.signInWithGoogle() }
                    } label: {
                        Text("Continue with Google")
                            .frame(maxWidth: .infinity, minHeight: 34)
                    }
                    .buttonStyle(.bordered)
                    .disabled(isWorking)
                }

                if Config.enableGithubSignIn {
                    Button {
                        runOAuth { try await SupabaseService.signInWithGitHub() }
                    } label: {
                        Text("Continue with GitHub")
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

    /// Shared runner for the ASWebAuthenticationSession OAuth providers
    /// (Google, GitHub). Spinner + verbatim error surfacing; a user-canceled
    /// web sheet is not an error worth showing. SessionStore flips the root
    /// view on the resulting auth change.
    private func runOAuth(_ action: @escaping () async throws -> Void) {
        isWorking = true
        errorMessage = nil
        Task {
            do {
                try await action()
            } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
                // User dismissed the web sheet — silent, like the Apple cancel.
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
    /// Sign in (existing account) vs create (new). The server's
    /// handle_new_user() trigger auto-creates the profile on first auth, so
    /// "create" is just signUp(email,password) — no extra profile step.
    private enum Mode: String, CaseIterable {
        case signIn = "Sign In"
        case createAccount = "Create Account"
    }

    @State private var mode: Mode = .signIn
    @State private var email = ""
    @State private var password = ""
    @State private var isWorking = false
    @State private var errorMessage: String?

    var body: some View {
        Form {
            Section {
                Picker("Mode", selection: $mode) {
                    ForEach(Mode.allCases, id: \.self) { mode in
                        Text(mode.rawValue).tag(mode)
                    }
                }
                .pickerStyle(.segmented)
            }

            Section {
                TextField("Email", text: $email)
                    .keyboardType(.emailAddress)
                    .textContentType(.username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                SecureField("Password", text: $password)
                    .textContentType(mode == .createAccount ? .newPassword : .password)
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
                    submit()
                } label: {
                    if isWorking {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                    } else {
                        Text(mode.rawValue)
                            .frame(maxWidth: .infinity)
                    }
                }
                .disabled(isWorking || email.isEmpty || password.isEmpty)
            } footer: {
                if mode == .createAccount {
                    Text("Creating an account uses the same login as nuke.ag. If email confirmation is on, check your inbox to finish.")
                }
            }
        }
        .navigationTitle("Email")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func submit() {
        isWorking = true
        errorMessage = nil
        let mode = mode
        Task {
            do {
                switch mode {
                case .signIn:
                    try await SupabaseService.signIn(email: email, password: password)
                case .createAccount:
                    try await SupabaseService.signUp(email: email, password: password)
                }
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

/// Presented from TodayView's and ProfileTab's toolbar. Sign out, full account
/// deletion (5.1.1(v)), and the confirmed work-sites list.
///
/// Destructive actions are separated deliberately — Sign Out is mid-form,
/// Delete Account is the last section with a confirmation alert.
struct AccountView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var siteStore = SiteStore.shared
    @ObservedObject private var sync = SyncEngine.shared
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

                // What you choose to link — your AI subscriptions (BYOK) + accounting.
                Section {
                    NavigationLink {
                        ConnectedAccountsView()
                    } label: {
                        Label("Connected accounts", systemImage: "link")
                    }
                }

                // Contributor mode — the crew safety gate. ON when this device
                // contributes to a shop's SHARED pool: every at-site photo must
                // clear the on-device firewall (affirmative vehicle label AND no
                // prominent face) before it uploads, so a private photo shot at
                // the shop never crosses. OFF = owner mode (your own at-site
                // photos upload ungated). Held photos stay on the phone.
                Section {
                    Toggle("Contributing to a shop", isOn: Binding(
                        get: { sync.contributorMode },
                        set: { sync.setContributorMode($0) }
                    ))
                    if sync.contributorMode, sync.totalHeldPrivate > 0 {
                        LabeledContent("Kept private (held back)") {
                            Text("\(sync.totalHeldPrivate)").monospacedDigit()
                        }
                    }
                } footer: {
                    Text("When on, only clear vehicle/work photos upload to the shop. Anything with a face — or not work-related — stays on your phone and is never sent.")
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
                // name to SITE NN). "Sites" → "Work sites" per owner feedback.
                if !siteStore.sites.isEmpty {
                    Section("Work sites") {
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

                // Re-arm the first-run flow: clears the ignitionComplete flag
                // and the sync watermark so NukeCaptureApp re-pushes
                // IgnitionView on the next routing pass. The seen-set is kept,
                // so already-uploaded photos aren't re-sent.
                // "Re-run ignition" → "Re-scan my library" (softer label).
                Section {
                    Button("Re-scan my library") {
                        UserDefaults.standard.set(false, forKey: IgnitionEngine.completeKey)
                        SyncEngine.shared.resetForReignition()
                        dismiss()
                    }
                } footer: {
                    Text("Re-detects your work sites and re-confirms what uploads. Already-uploaded photos are not sent again.")
                }

                // ── Sign Out — separated from Delete Account ──────────────────
                Section {
                    Button("Sign Out") {
                        run { try await SupabaseService.signOut() }
                    }
                } footer: {
                    Text("Stops uploads from this device. Your photos and account are unaffected.")
                }

                // ── Delete Account — last, de-emphasized, behind a confirm ────
                // Deliberately last in the form and behind a confirmation alert
                // so it cannot be tapped by accident.
                Section {
                    Button(role: .destructive) {
                        confirmingDeletion = true
                    } label: {
                        Text("Delete Account")
                            .foregroundStyle(.red.opacity(0.7))
                    }
                } footer: {
                    Text("Anonymizes your account and disables sign-in. This cannot be undone.")
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Account")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
            .disabled(isWorking)
            .alert("Delete your account?", isPresented: $confirmingDeletion) {
                // Alert (not confirmationDialog) — shows title + message inline,
                // less alarming than the modal sheet but still requires an
                // explicit tap on the red button to proceed.
                Button("Delete Account", role: .destructive) {
                    run { try await SupabaseService.requestAccountDeletion() }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This anonymizes your account and disables sign-in. Your uploaded photos remain in the record.")
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
