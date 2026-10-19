// JobFacilitySection.swift — the job page's shop-space requirement and its booking state.
//
// "Booked: Lift A, Tue Oct 21, 9 AM–12 PM" from the shop's calendar (job ids are shown to parties
// only), "Requested at <shop> — waiting for the shop" after you send a request, else what the
// facility input found. No reader lists a job's pending requests, so a request shows here only in the
// session that sent it; the shop sees it in its signature queue.

import SwiftUI

struct JobFacilitySection: View {
    let workOrderId: String
    let facility: JobLoad<JobFacility>
    /// The server decides who may book (customer or accepted technician); visitors aren't offered it.
    let viewerIsParty: Bool
    @Binding var requested: FacilityReservation?
    var onChanged: (() -> Void)? = nil

    @State private var booking = false
    @State private var cancelling = false
    @State private var cancelFailure: String?

    var body: some View {
        switch facility {
        case .loaded(let f) where !f.requirements.isEmpty:
            Section {
                ForEach(f.requirements) { r in
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Shop space").font(.caption).foregroundStyle(.secondary)
                        Text(r.description ?? "Shop space for this job").font(.subheadline)
                        if let m = r.match {
                            Label(FacilityCopy.match(m), systemImage: OfferCopy.symbol(m.result).name)
                                .font(.caption).foregroundStyle(.secondary)
                            if m.next == "plan_b_supplier_needed" {
                                Text("Needs a backup: another shop with this kind of space.").font(.caption2).foregroundStyle(.tertiary)
                            }
                        }
                    }
                }
                state(f)
                if viewerIsParty, !f.choices.isEmpty, f.bookings.isEmpty, pending(f) == nil {
                    Button { booking = true } label: { Label("Book a bay", systemImage: "calendar.badge.plus") }
                }
                ForEach(shops(f), id: \.id) { shop in
                    NavigationLink {
                        FacilityView(organizationId: shop.id, nameHint: shop.name, bookingFor: viewerIsParty ? workOrderId : nil,
                                     onBooked: { requested = $0 })
                    } label: {
                        Label("See \(shop.name ?? "the shop")'s space and calendar", systemImage: "building.2")
                    }
                }
            } header: {
                Text("Shop space")
                    .sheet(isPresented: $booking) {
                        BookFacilitySheet(workOrderId: workOrderId, choices: f.choices) { r in requested = r; onChanged?() }
                    }
            } footer: {
                Text("A booking holds space only once the shop confirms it. Nuke doesn't take payment for it.")
            }
        case .refused(let refusal):
            Section("Shop space") { JobRefusalRow(refusal: refusal) }
        default:
            EmptyView()
        }
    }

    private func pending(_ f: JobFacility) -> FacilityReservation? {
        guard let r = requested, r.state == "requested", !f.bookings.contains(where: { $0.reservationId == r.reservationId }) else { return nil }
        return r
    }

    @ViewBuilder private func state(_ f: JobFacility) -> some View {
        ForEach(f.bookings) { b in
            Label(FacilityCopy.booked(b), systemImage: "checkmark.seal.fill").font(.footnote).foregroundStyle(.green)
        }
        if let r = pending(f) {
            let shop = f.choices.first { $0.assetId == r.assetId }?.organizationName
            VStack(alignment: .leading, spacing: 4) {
                Label(FacilityCopy.requested(shop: shop, window: FacilityCopy.window(r.from, r.until)), systemImage: "hourglass")
                    .font(.footnote)
                Button("Cancel the request", role: .destructive) { cancelling = true }
                    .font(.footnote)
                    .confirmationDialog("Cancel this booking request?", isPresented: $cancelling, titleVisibility: .visible) {
                        Button("Cancel the request", role: .destructive) { Task { await cancel(r) } }
                    } message: {
                        Text("The shop won't be able to confirm it.")
                    }
                if let cancelFailure { Text(cancelFailure).font(.caption).foregroundStyle(.red) }
            }
        } else if f.bookings.isEmpty {
            Text("Not booked yet.").font(.footnote).foregroundStyle(.secondary)
        }
    }

    private func shops(_ f: JobFacility) -> [(id: String, name: String?)] {
        var out: [(id: String, name: String?)] = []
        for c in f.choices { if let id = c.organizationId, !out.contains(where: { $0.id == id }) { out.append((id, c.organizationName)) } }
        for b in f.bookings { if let id = b.organizationId, !out.contains(where: { $0.id == id }) { out.append((id, b.organizationName)) } }
        return out
    }

    private func cancel(_ r: FacilityReservation) async {
        struct P: Encodable, Sendable { let p_reservation_id: String }
        switch await FacilityWriters.write("cancel_facility_reservation", P(p_reservation_id: r.reservationId)) {
        case .failure(let f): cancelFailure = f.text
        case .success: cancelFailure = nil; requested = nil; onChanged?()
        }
    }
}
