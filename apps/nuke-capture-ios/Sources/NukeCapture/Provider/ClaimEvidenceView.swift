// ClaimEvidenceView.swift — the evidence behind one technician-profile link, over
// actor_link_claim_evidence_read (the claimant and admins only).
//
// Direct evidence apart from corroborating, each item with why it was found and what approval
// could accept it for. The reader approves nothing and offers no action: a reviewer decides,
// through a separate writer. What it does not assess is listed, so a count is never read as proof.

import SwiftUI

struct ClaimEvidenceView: View {
    let claim: ProviderClaim

    @State private var read: JobLoad<ActorClaimEvidence> = .loading

    var body: some View {
        ClaimEvidenceContent(claim: claim, read: read)
            .task { await load() }
            .refreshable { await load() }
    }

    private func load() async {
        read = await ProviderStandingReaders.claimEvidence(claimId: claim.claimId)
    }
}

struct ClaimEvidenceContent: View {
    let claim: ProviderClaim
    let read: JobLoad<ActorClaimEvidence>

    @State private var showAll = false

    static let preview = 25

    var body: some View {
        List {
            claimSection
            switch read {
            case .loading:
                Section { HStack(spacing: 8) { ProgressView(); Text("Finding evidence…").font(.footnote).foregroundStyle(.secondary) } }
            case .refused(let refusal):
                Section { JobRefusalRow(refusal: refusal) }
            case .loaded(let e):
                countsSection(e)
                itemsSection("Direct", e.direct, total: e.counts?.direct,
                             footer: "Your own records tied to this profile's work on the same vehicle and day.")
                itemsSection("Corroborating", e.corroborating, total: e.counts?.corroborating,
                             footer: "Records that fit, but don't place you at the work on their own.")
                reviewSection(e)
            }
        }
        .navigationTitle("Link evidence")
        .navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder private var claimSection: some View {
        Section {
            RootedValueView(label: claim.actorName ?? "Technician profile", value: JobCopy.claimStatus(evidenceStatus ?? claim.status),
                            status: ProviderLinkView.rung(evidenceStatus ?? claim.status),
                            decay: [JobCopy.claimRung(evidenceRung ?? claim.rung), JobCopy.day(claim.filedAt).map { "filed \($0)" }]
                                .compactMap { $0 }.joined(separator: " · "))
        } header: {
            Text("Your link")
        }
    }

    private var evidenceStatus: String? { if case .loaded(let e) = read { return e.status } else { return nil } }
    private var evidenceRung: String? { if case .loaded(let e) = read { return e.rung } else { return nil } }

    @ViewBuilder private func countsSection(_ e: ActorClaimEvidence) -> some View {
        Section {
            RootedValueView(label: "Evidence found", value: ProviderStandingCopy.counts(e.counts), status: .attributed,
                            decay: JobClock.text(e.asOf).map { "as of \($0)" })
            ForEach(e.counts?.byKind.keys.sorted() ?? [], id: \.self) { k in
                RootedValueView(label: ProviderStandingCopy.evidenceKind(k), value: JobCopy.count(e.counts?.byKind[k] ?? 0), status: .attributed)
            }
            if e.unreadableItems > 0 {
                Text(JobCopy.newerVersion(e.unreadableItems)).font(.footnote).foregroundStyle(.secondary)
            }
        } footer: {
            Text("Found by joining your own records to the work this profile is credited with. Names, phones and e-mails are never compared.")
        }
    }

    @ViewBuilder private func itemsSection(_ title: String, _ items: [ActorClaimEvidence.Item], total: Int?, footer: String) -> some View {
        if !items.isEmpty {
            let shown = showAll ? items : Array(items.prefix(Self.preview))
            Section {
                ForEach(shown) { i in
                    VStack(alignment: .leading, spacing: 2) {
                        RootedValueView(label: i.vehicleLabel ?? ProviderStandingCopy.evidenceKind(i.kind),
                                        value: ProviderStandingCopy.evidenceKind(i.kind), status: .attributed,
                                        decay: [JobCopy.day(i.date), ProviderStandingCopy.approvable(i.approvableFor)]
                                            .compactMap { $0 }.joined(separator: " · "))
                        if let why = i.why {
                            Text(ProviderStandingCopy.sentence(why)).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                if let line = ProviderStandingCopy.shown(shown.count, of: total ?? items.count) {
                    Button(showAll ? line : "\(line) · show all") { showAll = true }
                        .font(.footnote).disabled(showAll || shown.count == items.count)
                }
            } header: {
                Text(title)
            } footer: {
                Text(footer)
            }
        }
    }

    @ViewBuilder private func reviewSection(_ e: ActorClaimEvidence) -> some View {
        Section {
            if let needs = e.workEvidenceNeeds {
                RootedValueView(label: "Backed by your work needs", value: needs, status: .recorded)
            }
            if e.autoApproved == false {
                Text("Nothing here approves the link by itself. A Nuke reviewer checks the evidence and decides.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        } header: {
            Text("Review")
        } footer: {
            if !e.notAssessed.isEmpty {
                Text("Not assessed: " + e.notAssessed.joined(separator: "; ") + ".")
            }
        }
    }
}
