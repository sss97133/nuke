// JoinLinkView.swift — the screen a garage join link opens: preview (garage, role offered) -> sign in if needed ->
// Join -> "Waiting for <garage> to approve you" -> active. Presented as a sheet from NukeCaptureApp for the route
// JoinLinkCoordinator holds. Logic and states: GarageJoin.swift. Every state is in words; none is a placeholder.

import SwiftUI

struct JoinLinkView: View {
    @EnvironmentObject private var session: SessionStore
    @StateObject private var model: JoinLinkModel
    let close: () -> Void

    @MainActor init(token: String, session: SessionStore, close: @escaping () -> Void) {
        _model = StateObject(wrappedValue: JoinLinkModel(
            token: token,
            isSignedIn: { [weak session] in session?.isSignedIn ?? false },
            onTerminal: { JoinLinkCoordinator.shared.finish() }))
        self.close = close
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                Spacer(minLength: 24)
                content
                Spacer()
            }
            .padding(24)
            .frame(maxWidth: .infinity)
            .navigationTitle("Join a garage")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Not now", action: close) }
            }
        }
        .task { await model.load() }
        .onChange(of: session.isSignedIn) { _, signedIn in
            if signedIn { Task { await model.signedInNow() } }
        }
        .interactiveDismissDisabled(model.phase == .working)
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .loading, .working:
            ProgressView().accessibilityIdentifier("join.progress")
        case .offer(let p):
            message(title: Self.offerTitle(p), detail: "You'll join as \(Self.roleLabel(p.role)). Someone at the garage approves each person.")
            Button("Join") { Task { await model.accept() } }
                .buttonStyle(.borderedProminent).controlSize(.large)
                .accessibilityIdentifier("join.accept")
        case .signInNeeded(let p):
            message(title: Self.offerTitle(p), detail: "Sign in or create an account to join. Your invitation is kept until you do.")
            Button("Sign in to join", action: close)
                .buttonStyle(.borderedProminent).controlSize(.large)
                .accessibilityIdentifier("join.signin")
        case .pending(let garage, _):
            message(title: "Waiting for \(garage ?? "the garage") to approve you",
                    detail: "You're on the list. You'll have access as soon as a manager approves you. You can close this; nothing else is needed.")
            Button("Check again") { Task { await model.accept() } }
                .accessibilityIdentifier("join.check")
            Button("Done", action: close).buttonStyle(.borderedProminent).controlSize(.large)
        case .active(let garage, let role):
            message(title: "You're in at \(garage ?? "the garage")",
                    detail: "You joined as \(Self.roleLabel(role)). Photos and work you capture can now be shared with this garage.")
            Button("Done", action: close).buttonStyle(.borderedProminent).controlSize(.large)
                .accessibilityIdentifier("join.done")
        case .invalid(let reason, let garage):
            message(title: reason.title, detail: garage.map { "\(reason.detail) (\($0))" } ?? reason.detail)
            Button("Close", action: close)
        case .notAvailable:
            message(title: JoinError.notAvailableTitle, detail: JoinError.notAvailableDetail)
                .accessibilityIdentifier("join.notAvailable")
            Button("Close", action: close)
        case .blocked(let text):
            message(title: "Can't join right now", detail: text)
            Button("Close", action: close)
        case .failed(let text):
            message(title: "Couldn't reach the garage", detail: text)
            Button("Try again") { Task { await model.load() } }
                .buttonStyle(.borderedProminent)
        }
    }

    private func message(title: String, detail: String) -> some View {
        VStack(spacing: 8) {
            Text(title).font(.title3.weight(.semibold)).multilineTextAlignment(.center)
            Text(detail).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }
    }

    static func offerTitle(_ p: JoinPreview) -> String {
        "\(p.garageName ?? "A garage") invited you"
    }

    static func roleLabel(_ role: String?) -> String {
        guard let role, !role.isEmpty else { return "a member" }
        let article = "aeiou".contains(role.first ?? "x") ? "an" : "a"
        return "\(article) \(role)"
    }
}
