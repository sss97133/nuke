// SignInView.swift — auth UI: sign in, sign out, and account deletion.
//
// Sign-in is email/password against Supabase auth (same account as nuke.ag).
// The session persists in the device Keychain via supabase-swift's default
// storage — sign in once per device.
//
// Account deletion is REQUIRED by App Store Review Guideline 5.1.1(v): any
// app that supports sign-in must let the user initiate full account deletion
// in-app. The button calls SupabaseService.requestAccountDeletion(), which
// invokes the `request_account_deletion` RPC. If that server function is not
// deployed yet, the call fails and the error is shown verbatim — deploying
// it is a PRE-SUBMISSION TODO tracked in apps/APP_STORE_LAUNCH.md §2.

import SwiftUI

// ─── Sign in ─────────────────────────────────────────────────────────────────

struct SignInView: View {
    @State private var email = ""
    @State private var password = ""
    @State private var isWorking = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Sign in with your Nuke account. Photos you take at your registered work locations upload to your own account — nothing else leaves the phone.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
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
