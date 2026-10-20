// JobOffersSection.swift — offers on a job's requests, from work_order_offers_read.
//
// Who is taking the work on (accepted providers), then each request with its offers: provider by
// handle or "Unnamed party" and the rung they offered at, open price terms, availability and
// acceptance. Make an offer, Withdraw and Accept offer appear only when the server's actions name
// them for this viewer.

import SwiftUI

struct JobOffersSection: View {
    let offers: JobLoad<WorkOrderOffers>
    var onChanged: (() -> Void)? = nil

    @State private var offering: OfferBox?
    @State private var accepting: AcceptBox?
    @State private var cosigning: AcceptBox?
    @State private var failure: String?

    private struct OfferBox: Identifiable { let action: JobAction; let title: String; var id: String { action.id } }
    private struct AcceptBox: Identifiable { let action: JobAction; let offer: JobOffer; let title: String; var id: String { offer.offerId } }

    var body: some View {
        Section {
            switch offers {
            case .loading:
                Text("Loading…").font(.footnote).foregroundStyle(.secondary)
            case .refused(let refusal):
                JobRefusalRow(refusal: refusal)
            case .loaded(let o):
                ForEach(Array(o.acceptedProviders.enumerated()), id: \.offset) { _, p in
                    RootedValueView(label: "Taking this on", value: p.who, status: .proven,
                                    decay: [p.role.map(JobCopy.role), JobCopy.day(p.acceptedAt).map { "accepted \($0)" }]
                                        .compactMap { $0 }.joined(separator: " · "))
                }
                if o.requirements.isEmpty {
                    Text("This job lists no requests for help.").font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(o.requirements) { req in
                    requirement(req, o)
                }
                if let failure { Text(failure).font(.footnote).foregroundStyle(.secondary) }
            }
        } header: {
            Text("Offers")
        } footer: {
            Text("Offer prices are open to everyone. Nothing is booked or paid until the customer accepts.")
        }
        // Presented from the job page's list: a header scrolled out of view can't host a sheet.
        .jobSheet(item: $offering) { box in
            OfferSheet(action: box.action, requirementTitle: box.title) { onChanged?() }
        }
        .jobSheet(item: $accepting) { box in
            AcceptOfferSheet(action: box.action, offer: box.offer, requirementTitle: box.title) { onChanged?() }
        }
        .jobSheet(item: $cosigning) { box in
            CosignSheet(action: box.action, technician: box.offer.who, requestTitle: box.title) { onChanged?() }
        }
    }

    static func title(_ req: RequirementOffers) -> String {
        let kind = OfferCopy.kind(req.kind ?? "requirement")
        guard let d = req.description, !d.isEmpty else { return kind }
        return "\(kind): \(d)"
    }

    @ViewBuilder private func requirement(_ req: RequirementOffers, _ o: WorkOrderOffers) -> some View {
        let title = Self.title(req)
        VStack(alignment: .leading, spacing: 2) {
            Text(OfferCopy.kind(req.kind ?? "requirement")).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            if let d = req.description { Text(d).font(.footnote).lineLimit(3) }
            if req.offers.isEmpty { Text("No offers yet.").font(.caption).foregroundStyle(.tertiary) }
        }
        .padding(.vertical, 2)
        ForEach(req.offers) { offer in
            VStack(alignment: .leading, spacing: 4) {
                OfferFromRow(label: "Offer from", offer: offer)
                ForEach(offer.lines) { line in
                    RootedValueView(label: JobCopy.lineLabel(line), value: JobCopy.linePrice(line),
                                    status: line.amount == nil ? .recorded : .attributed)
                }
                if let w = OfferCopy.window(offer.availableFrom, offer.availableUntil) {
                    RootedValueView(label: "Available", value: w, status: .attributed)
                }
                ForEach(offer.coSigns) { c in
                    Label(CosignCopy.line(c), systemImage: "person.2.badge.gearshape").font(.caption).foregroundStyle(.secondary)
                }
                RootedValueView(label: "Status", value: OfferCopy.acceptance(offer.acceptanceState),
                                status: offer.acceptanceState == "accepted" ? .proven
                                    : (offer.acceptanceState == "withheld" ? .conflicting : .pending))
                HStack(spacing: 12) {
                    if let a = o.acceptAction(for: offer) {
                        Button("Accept offer") { accepting = AcceptBox(action: a, offer: offer, title: title) }
                            .buttonStyle(.borderedProminent)
                    }
                    if let a = o.withdrawAction(for: offer.offerId) {
                        Button("Withdraw") { Task { await withdraw(a) } }.buttonStyle(.bordered)
                    }
                    if let a = o.cosignAction(for: offer) {
                        Button("Co-sign this technician") { cosigning = AcceptBox(action: a, offer: offer, title: title) }
                            .buttonStyle(.bordered)
                    }
                }
                .controlSize(.small)
            }
        }
        if let a = o.offerAction(for: req.requirementId) {
            Button {
                offering = OfferBox(action: a, title: title)
            } label: {
                Label("Make an offer", systemImage: "hand.raised")
            }
        }
    }

    private func withdraw(_ action: JobAction) async {
        failure = nil
        if let reason = await OfferReaders.withdraw(action) { failure = "Couldn't withdraw. \(reason)" } else { onChanged?() }
    }
}

/// Who an offer is from and the rung it was made at; an organization offer also carries its on_nuke label as a badge.
struct OfferFromRow: View {
    let label: String
    let offer: JobOffer
    var value: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            RootedValueView(label: label, value: value ?? offer.who,
                            status: offer.acceptanceState == "accepted" ? .proven : .attributed,
                            decay: OfferCopy.rung(offer.offerRung))
            if offer.offerKind == "organization", let badge = offer.onNuke { OnNukeBadge(label: badge) }
        }
    }
}
