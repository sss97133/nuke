// ProviderLinkView.swift — linking this account to a technician profile on Nuke.
//
// Reads my_identity_read().provider_link (the link state and every claim with its rung) and
// lets the person find their technician profile by name (actors: id, name, type only; contact
// columns are service-only) and file "this is me" as a pending self-claim in
// account_link_claims. A Sign step: an explicit confirm, never automatic, never matched by name
// on the person's behalf. The claim stays "Linked by you" until reviewed work evidence promotes
// it; the server's guard refuses any other starting rung.

import SwiftUI

struct ProviderLinkView: View {
    @State private var identity: JobLoad<MyIdentity>
    @State private var query: String
    @State private var hits: [JobReaders.ActorHit]
    @State private var searched: Bool
    @State private var searchFailure: JobRefusal?
    @State private var searching = false
    @State private var confirming: JobReaders.ActorHit?
    @State private var filing = false
    @State private var fileFailure: String?
    @State private var filedName: String?
    private let loadOnAppear: Bool

    init(identity: JobLoad<MyIdentity> = .loading, query: String = "", hits: [JobReaders.ActorHit] = [],
         loadOnAppear: Bool = true) {
        _identity = State(initialValue: identity)
        _query = State(initialValue: query)
        _hits = State(initialValue: hits)
        _searched = State(initialValue: !hits.isEmpty)
        self.loadOnAppear = loadOnAppear
    }

    var body: some View {
        List {
            statusSection
            claimsSection
            searchSection
        }
        .navigationTitle("Technician profile")
        .navigationBarTitleDisplayMode(.inline)
        .task { if loadOnAppear { await loadIdentity() } }
        .refreshable { await loadIdentity() }
        .confirmationDialog(confirming.map { "Link your account to \($0.name ?? "this profile")?" } ?? "",
                            isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } }),
                            titleVisibility: .visible,
                            presenting: confirming) { hit in
            Button("Link my account") { Task { await file(hit) } }
            Button("Cancel", role: .cancel) {}
        } message: { hit in
            Text("This says you are \(hit.name ?? "this technician"). It shows as \"Linked by you\" until your work backs it up.")
        }
    }

    // MARK: Status

    @ViewBuilder private var statusSection: some View {
        Section {
            switch identity {
            case .loading:
                HStack(spacing: 8) { ProgressView(); Text("Loading…").font(.footnote).foregroundStyle(.secondary) }
            case .refused(let refusal):
                JobRefusalRow(refusal: refusal)
            case .loaded(let me):
                RootedValueView(label: "Status",
                                value: JobCopy.technicianLink(me.bridge) ?? "Not available",
                                status: me.bridge == "evidenced" ? .attributed : (me.bridge == nil ? .facade : .recorded))
            }
            if let filedName {
                Label("Linked by you to \(filedName)", systemImage: "checkmark.circle")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        } footer: {
            Text(JobCopy.linkExplainer)
        }
    }

    // MARK: Claims

    @ViewBuilder private var claimsSection: some View {
        if case .loaded(let me) = identity, !me.claims.isEmpty {
            Section("Your links") {
                ForEach(me.claims) { claim in
                    RootedValueView(label: claim.actorName ?? "Technician profile",
                                    value: JobCopy.claimStatus(claim.status),
                                    status: Self.rung(claim.status),
                                    decay: Self.claimLine(claim))
                }
            }
        }
    }

    static func rung(_ status: String?) -> RootStatus {
        switch status {
        case "approved"?: return .attributed
        case "pending"?: return .pending
        case "rejected"?: return .refuted
        default: return .recorded
        }
    }

    static func claimLine(_ claim: ProviderClaim) -> String {
        var parts = [JobCopy.claimRung(claim.rung)]
        if let filed = JobCopy.day(claim.filedAt) { parts.append("filed \(filed)") }
        if claim.evidenceEntries > 0 {
            parts.append("\(claim.evidenceEntries) piece\(claim.evidenceEntries == 1 ? "" : "s") of evidence")
        }
        return parts.joined(separator: " · ")
    }

    // MARK: Search and link

    @ViewBuilder private var searchSection: some View {
        Section {
            HStack {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Search technician profiles by name", text: $query)
                    .textInputAutocapitalization(.words)
                    .autocorrectionDisabled()
                    .submitLabel(.search)
                    .onSubmit { Task { await search() } }
                if searching { ProgressView() }
            }
            if let searchFailure {
                JobRefusalRow(refusal: searchFailure)
            } else if searched && hits.isEmpty {
                Text("No technician profiles match that name.").font(.footnote).foregroundStyle(.secondary)
            }
            ForEach(hits) { hit in
                let linked = claimedIds.contains(hit.id)
                Button {
                    confirming = hit
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(hit.name ?? "Unnamed profile").foregroundStyle(.primary)
                            if let type = hit.actor_type, !type.isEmpty {
                                Text(JobCopy.sentence(type)).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        Text(linked ? "Linked" : "This is me")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(linked ? Color.secondary : Color.accentColor)
                    }
                }
                .disabled(linked || filing)
            }
            if let fileFailure {
                Text(fileFailure).font(.footnote).foregroundStyle(.secondary)
            }
        } header: {
            Text("Find your profile")
        } footer: {
            Text("Linking is your own statement. Nuke never links accounts by name for you.")
        }
    }

    private var claimedIds: Set<String> {
        if case .loaded(let me) = identity { return me.claimedActorIds }
        return []
    }

    private func loadIdentity() async {
        identity = await JobReaders.myIdentity()
    }

    private func search() async {
        guard JobReaders.actorSearchTerm(query) != nil else { return }
        searching = true
        defer { searching = false }
        switch await JobReaders.searchActors(query) {
        case .success(let found):
            hits = found
            searchFailure = nil
        case .failure(let refusal):
            hits = []
            searchFailure = refusal
        }
        searched = true
    }

    private func file(_ hit: JobReaders.ActorHit) async {
        filing = true
        fileFailure = nil
        defer { filing = false }
        if let reason = await JobReaders.fileActorClaim(actorId: hit.id) {
            fileFailure = "Couldn't link. \(reason)"
        } else {
            filedName = hit.name ?? "this profile"
            await loadIdentity()
        }
    }
}
