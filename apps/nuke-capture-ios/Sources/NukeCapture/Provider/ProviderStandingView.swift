// ProviderStandingView.swift — your standing as a provider, in one place.
//
// Your technician-profile links with the evidence behind each (my_identity_read, then
// actor_link_claim_evidence_read per link), your work days over the last 90 days
// (provider_productivity_read), the vouches you've given (my_vouches_read, on its own page), and,
// when the register names you, the Signs agents executed on your behalf (owner_delegated_signs_read).
// Vouches you've received stay on the profile face, where visitors see the same list.

import SwiftUI

struct ProviderStandingView: View {
    let userId: String

    @State private var identity: JobLoad<MyIdentity> = .loading
    @State private var productivity: JobLoad<ProviderProductivity> = .loading
    @State private var delegated: JobLoad<DelegatedSigns> = .loading

    var body: some View {
        ProviderStandingContent(userId: userId, identity: identity, productivity: productivity, delegated: delegated)
            .task { await load() }
            .refreshable { await load() }
    }

    private func load() async {
        async let i = JobReaders.myIdentity()
        async let p = ProviderStandingReaders.productivity(userId: userId)
        async let d = ProviderStandingReaders.delegatedSigns()
        let (loadedIdentity, loadedProductivity, loadedDelegated) = await (i, p, d)
        identity = loadedIdentity
        productivity = loadedProductivity
        delegated = loadedDelegated
    }
}

struct ProviderStandingContent: View {
    let userId: String
    let identity: JobLoad<MyIdentity>
    let productivity: JobLoad<ProviderProductivity>
    let delegated: JobLoad<DelegatedSigns>

    var body: some View {
        List {
            linkSection
            ProviderProductivityContent(read: productivity)
            Section {
                NavigationLink { ProviderProductivityView(userId: userId) } label: {
                    Label("Day by day", systemImage: "calendar")
                }
                NavigationLink { WorkDaySignView() } label: {
                    Label("Confirm your work days", systemImage: "checkmark.seal")
                }
            }
            vouchSection
            if Self.showsDelegated(delegated, userId: userId) {
                DelegatedSignsContent(read: delegated)
                Section {
                    NavigationLink { DelegatedSignsView() } label: { Label("Every agent-signed Sign", systemImage: "signature") }
                }
            }
        }
        .navigationTitle("Provider standing")
        .navigationBarTitleDisplayMode(.inline)
    }

    /// Only once the register has loaded and names this profile's account as its owner.
    static func showsDelegated(_ read: JobLoad<DelegatedSigns>, userId: String) -> Bool {
        if case .loaded(let r) = read { return r.applies(toUserId: userId) }
        return false
    }

    @ViewBuilder private var linkSection: some View {
        Section {
            switch identity {
            case .loading:
                HStack(spacing: 8) { ProgressView(); Text("Loading…").font(.footnote).foregroundStyle(.secondary) }
            case .refused(let refusal):
                JobRefusalRow(refusal: refusal)
            case .loaded(let me):
                RootedValueView(label: "Status", value: JobCopy.technicianLink(me.bridge) ?? "Not available",
                                status: me.bridge == "evidenced" ? .attributed : (me.bridge == nil ? .facade : .recorded))
                ForEach(me.claims) { claim in
                    NavigationLink { ClaimEvidenceView(claim: claim) } label: {
                        RootedValueView(label: claim.actorName ?? "Technician profile", value: JobCopy.claimStatus(claim.status),
                                        status: ProviderLinkView.rung(claim.status), decay: ProviderLinkView.claimLine(claim))
                    }
                }
            }
            NavigationLink { ProviderLinkView() } label: {
                Label("Find and link your technician profile", systemImage: "wrench.and.screwdriver")
            }
        } header: {
            Text("Technician profile")
        } footer: {
            Text("Open a link to see the evidence Nuke found for it. " + JobCopy.linkExplainer)
        }
    }

    @ViewBuilder private var vouchSection: some View {
        Section {
            NavigationLink { MyVouchesView() } label: { Label("Vouches you've given", systemImage: "hand.thumbsup") }
        } header: {
            Text("Vouches")
        } footer: {
            Text("Vouches others gave you show on your profile, as visitors see them.")
        }
    }
}
